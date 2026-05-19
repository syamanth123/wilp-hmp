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

| Var                                                                           | Notes                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                | Postgres connection string with `?sslmode=require` for managed providers |
| `NEXTAUTH_URL`                                                                | Public base URL, e.g. `https://hmp.bits-wilp.example`                    |
| `NEXTAUTH_SECRET`                                                             | `openssl rand -base64 32`                                                |
| `AUTH_MODE`                                                                   | `credentials` for dev, `sso` once SAML/OAuth is wired                    |
| `SSO_*`                                                                       | IdP metadata; supply when team completes SSO adapter                     |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object storage                                                           |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`           | Email transport                                                          |
| `REDIS_URL`                                                                   | For queues                                                               |
| `CRON_SECRET`                                                                 | Required by `/api/cron/reminders`. `openssl rand -hex 32`                |
| `AI_PROVIDER`                                                                 | `openai` or `anthropic`                                                  |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`                                       | Provider key. Without it, AI features fall back to heuristic-only        |
| `ERP_*`, `TAXILA_*`                                                           | Real ERP + LMS endpoints. Supplied by BITS WILP IT                       |
| `NODE_ENV`                                                                    | `production`                                                             |
| `LOG_LEVEL`                                                                   | `info` or `warn` in prod                                                 |

## First deploy

1. **Provision DB**: create the managed Postgres instance and the `hmp` database.
2. **Configure env**: set every var above in your platform's secret store.
3. **Migrate**: `pnpm --filter @hmp/db exec prisma migrate deploy`. Do **not** run `prisma migrate dev` in prod.
4. **Seed (optional)**: only run `pnpm db:seed` if you want the demo data set. For real cutover, seed only the admin user via a one-shot script + the Workflow Config row.
5. **Build**: `pnpm install --frozen-lockfile && pnpm --filter @hmp/web build`.
6. **Start**: `pnpm --filter @hmp/web start` (or platform default).

### Migration lifecycle (dev vs CI vs prod)

| Environment | Command | Why |
|---|---|---|
| Local dev (creating a new migration) | `pnpm --filter @hmp/db exec prisma migrate dev --name <slug>` | Generates a new migration file, applies it, regenerates the client. |
| Local dev (reset to a known state) | `pnpm --filter @hmp/db exec prisma migrate reset --force` | Drops + recreates the DB, re-runs every migration, re-runs the seed. Destructive — dev only. |
| CI (every PR / push) | `pnpm --filter @hmp/db push` *(current)* — fast, schema-only sync against the per-run service container. | A fresh `_prisma_migrations`-less DB each run, so `push` is faster than re-running every historical migration. Acceptable while CI doesn't need to verify migration-file integrity. |
| **Production** | `pnpm --filter @hmp/db exec prisma migrate deploy` | Applies pending migrations in order, idempotent. **Never use `db push` or `migrate dev` in production.** |

Migrations now live under [`packages/db/prisma/migrations/`](../packages/db/prisma/migrations) — the `*_init` migration captures the 28-model pre-SME baseline; `*_add_sme_nomination` adds the SME nomination model, bringing the schema to 29 models.

## Scheduled jobs

Schedule a daily HTTPS POST to `/api/cron/reminders` with `Authorization: Bearer <CRON_SECRET>`.

- **Railway**: use Cron services.
- **Vercel**: add `vercel.json` `crons` entry.
- **GitHub Actions**: scheduled workflow + `curl`.

## Monitoring

- **Sentry** (or alternative): wire the DSN in `apps/web/sentry.{client,server}.config.ts` (not yet committed; add when go-live nears).
- **Uptime check**: hit `/login` every minute.
- **Logs**: structured JSON to stdout. Pipe to platform log drain.

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
