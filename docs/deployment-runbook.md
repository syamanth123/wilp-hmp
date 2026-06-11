# Deployment Runbook

Production cutover steps for the HMP portal.

## Prerequisites

- PostgreSQL 16 (managed: AWS RDS / Railway / Render Postgres).
- Redis 7 (managed: Upstash / Railway).
- S3-compatible object store (AWS S3 / Cloudflare R2 / MinIO on a VPS).
- SMTP relay (SendGrid / AWS SES / SMTP2GO).
- Node 20 runtime (Vercel, Railway, Fly.io, or Docker on a VPS).

## Environment variables

Copy `.env.example` and fill every value. Required in production:

| Var                                                                 | Notes                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                                                      | Postgres connection string with `?sslmode=require` for managed providers |
| `NEXTAUTH_URL`                                                      | Public base URL, e.g. `https://hmp.bits-wilp.example`                    |
| `NEXTAUTH_SECRET`                                                   | `openssl rand -base64 32`                                                |
| `AUTH_MODE`                                                         | `credentials` for dev, `sso` once SAML/OAuth is wired                    |
| `SSO_*`                                                             | IdP metadata; supply when team completes SSO adapter                     |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`     | Object storage credentials. Omit `S3_ENDPOINT` for real AWS S3           |
| `LMS_EXPORTS_BUCKET` / `HANDOUT_ATTACHMENTS_BUCKET`                 | Bucket names (default `hmp-lms-exports` / `hmp-handout-attachments`)     |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email transport                                                          |
| `REDIS_URL`                                                         | For queues                                                               |
| `CRON_SECRET`                                                       | Required by `/api/cron/reminders`. `openssl rand -hex 32`                |
| `AI_PROVIDER`                                                       | `openai` or `anthropic`                                                  |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`                             | Provider key. Without it, AI features fall back to heuristic-only        |
| `ERP_*`, `TAXILA_*`                                                 | Real ERP + LMS endpoints. Supplied by BITS WILP IT                       |
| `NODE_ENV`                                                          | `production`                                                             |
| `LOG_LEVEL`                                                         | `info` or `warn` in prod                                                 |

## First deploy

1. **Provision DB**: create the managed Postgres instance and the `hmp` database.
2. **Configure env**: set every var above in your platform's secret store.
3. **Migrate**: `pnpm --filter @hmp/db exec prisma migrate deploy`. Do **not** run `prisma migrate dev` in prod.
4. **Seed (optional)**: only run `pnpm db:seed` if you want the demo data set. For real cutover, seed only the admin user via a one-shot script + the Workflow Config row.
5. **Build**: `pnpm install --frozen-lockfile && pnpm --filter @hmp/web build`.
6. **Start**: `pnpm --filter @hmp/web start` (or platform default).

### Migration lifecycle (dev vs CI vs prod)

| Environment                          | Command                                                                                                  | Why                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev (creating a new migration) | `pnpm --filter @hmp/db exec prisma migrate dev --name <slug>`                                            | Generates a new migration file, applies it, regenerates the client.                                                                                                                 |
| Local dev (reset to a known state)   | `pnpm --filter @hmp/db exec prisma migrate reset --force`                                                | Drops + recreates the DB, re-runs every migration, re-runs the seed. Destructive — dev only.                                                                                        |
| CI (every PR / push)                 | `pnpm --filter @hmp/db push` _(current)_ — fast, schema-only sync against the per-run service container. | A fresh `_prisma_migrations`-less DB each run, so `push` is faster than re-running every historical migration. Acceptable while CI doesn't need to verify migration-file integrity. |
| **Production**                       | `pnpm --filter @hmp/db exec prisma migrate deploy`                                                       | Applies pending migrations in order, idempotent. **Never use `db push` or `migrate dev` in production.**                                                                            |

Migrations now live under [`packages/db/prisma/migrations/`](../packages/db/prisma/migrations) — the `*_init` migration captures the 28-model pre-SME baseline; `*_add_sme_nomination` adds the SME nomination model, bringing the schema to 29 models.

## Object storage & handout attachments (Prompt 16)

Two buckets are used, kept separate on purpose so their access policies and
lifecycle rules don't bleed into each other:

- **`LMS_EXPORTS_BUCKET`** (default `hmp-lms-exports`) — Taxila Mode B export ZIPs.
- **`HANDOUT_ATTACHMENTS_BUCKET`** (default `hmp-handout-attachments`) — faculty-uploaded
  supplementary files (PDF/DOCX/XLSX/PPTX/PNG/JPEG, ≤ 50 MB). Objects are stored under
  opaque UUID keys (`attachments/<requestId>/<uuid>`) — never the user-supplied filename.

### One-time setup per environment

1. **Create the buckets.** The app calls `ensureBucket` on first write, so this is
   optional on S3/MinIO that allow auto-create — but create them explicitly in prod
   so you control region + encryption:

   ```
   aws s3api create-bucket --bucket hmp-handout-attachments --region <region> \
     --create-bucket-configuration LocationConstraint=<region>
   aws s3api put-bucket-encryption --bucket hmp-handout-attachments \
     --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   ```

   Keep both buckets **private** (block all public access) — downloads are always via
   short-lived presigned URLs minted by the app, never public objects.

2. **IAM.** The app's S3 credentials (`S3_ACCESS_KEY` / `S3_SECRET_KEY`) need, scoped to
   the two bucket ARNs: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`,
   `s3:PutObjectTagging` (for archive tagging), and `s3:ListBucket` /
   `s3:CreateBucket` / `s3:PutLifecycleConfiguration` if you let the app / setup script
   create + configure buckets. Prefer creating + configuring buckets out-of-band and
   granting the runtime only the object-level verbs + `PutObjectTagging`.

3. **Install the lifecycle policy** (cold-storage transition for archived handouts):

   ```
   pnpm --filter @hmp/integrations exec tsx scripts/setup-s3-lifecycle.ts
   ```

   This installs one rule: objects tagged `archived=true` → Glacier **DEEP_ARCHIVE**
   after 30 days, **no expiry** (attachments are retained indefinitely, just cheaply).
   The app tags a request's attachments `archived=true`, best-effort, when it transitions
   to ARCHIVED. Idempotent — re-running replaces the config with exactly this rule.
   (DEEP_ARCHIVE is an AWS-S3 feature; MinIO accepts the config but won't transition.)

4. **Smoke test** the wiring end-to-end (bucket reachable → upload → presigned download
   round-trips → lifecycle present → cleanup):
   ```
   pnpm --filter @hmp/integrations exec tsx scripts/smoke-test-s3.ts
   ```
   Exits non-zero on the first hard failure. The lifecycle check is advisory (warns,
   doesn't fail) so the smoke test is also usable against dev MinIO.

## Scheduled jobs

Schedule a daily HTTPS POST to `/api/cron/reminders` with `Authorization: Bearer <CRON_SECRET>`.

- **Railway**: use Cron services.
- **Vercel**: add `vercel.json` `crons` entry.
- **GitHub Actions**: scheduled workflow + `curl`.

## Running workers in production

Background processing (notifications, on-submit AI quality reports) is **opt-in**. To enable it:

1. Set `WORKERS_ENABLED=true` and a reachable `REDIS_URL` in the **web** service env. With this set, those side-effects are enqueued instead of run inline; with it unset, everything runs synchronously (the default — no Redis needed).
2. Run the **worker process** as a long-lived service alongside web: `pnpm workers` (it runs `apps/web/src/workers/start.ts` via tsx). Give it the same `DATABASE_URL`, `REDIS_URL`, and `SMTP_*` env as web.
   - Railway/Render/Fly: a second service/process from the same repo, command `pnpm workers`.
   - Docker Compose (full stack): `docker compose --profile workers up`.
3. **Critical:** enabling `WORKERS_ENABLED=true` without a running worker means jobs queue but never process (silent backlog). Always run the worker when the flag is on.

The worker handles `SIGTERM`/`SIGINT` gracefully — it stops accepting new jobs and drains in-flight ones before exiting, so rolling deploys don't drop work.

## Monitoring

- **Sentry** (or alternative): wire the DSN in `apps/web/sentry.{client,server}.config.ts` (not yet committed; add when go-live nears).
- **Uptime check**: hit `/login` every minute.
- **Logs**: structured JSON to stdout. Pipe to platform log drain.
- **Queue health**: `/admin/queues` shows per-queue counts, failed jobs (with retry/delete), and a **worker heartbeat** — a "⚠ Workers may not be running" banner appears if no heartbeat in 5 min. Monitor queue **waiting** depth: sustained growth means the worker is down or under-provisioned.

## Backups

- Managed Postgres: enable daily snapshots, 7-day retention minimum.
- Test restore quarterly into a staging DB and run the seeded smoke test (`pnpm test`).

## Cutover checklist

- [ ] DNS pointed at production host.
- [ ] TLS cert valid (Let's Encrypt or platform-managed).
- [ ] `prisma migrate deploy` clean.
- [ ] Admin user created + can log in.
- [ ] Test request created end-to-end (IC → HOG → PC → Faculty → publish).
- [ ] Mailhog/SMTP delivered notifications received.
- [ ] `/api/cron/reminders` reachable with bearer.
- [ ] AI provider key validated (if set) — `/admin/ai-metrics` shows provider OK.
- [ ] Sentry receiving events.
- [ ] Backup restore drill passed in staging within last 30 days.

## Rollback

1. Switch DNS / platform routing back to the previous release.
2. If a migration is the issue: restore the most recent snapshot, then redeploy the prior release tag.

## Outstanding team-owned items

- Real ERP API integration (replace CSV importer).
- Real Taxila LMS integration (replace stub in `packages/integrations/src/taxila.ts`).
- Real SSO (SAML/OAuth) — plug into the existing `SsoProvider` adapter.
- BITS IdP metadata + DNS + SSL — owned by infra team.
