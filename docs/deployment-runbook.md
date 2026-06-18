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

| Var                                                                 | Notes                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                      | Postgres connection string with `?sslmode=require` for managed providers                    |
| `NEXTAUTH_URL`                                                      | Public base URL, e.g. `https://hmp.bits-wilp.example`                                       |
| `NEXTAUTH_SECRET`                                                   | `openssl rand -base64 32`                                                                   |
| `AUTH_MODE`                                                         | `credentials` for dev, `sso` once SAML/OAuth is wired                                       |
| `SSO_*`                                                             | IdP metadata; supply when team completes SSO adapter                                        |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY`     | Object storage credentials. Omit `S3_ENDPOINT` for real AWS S3                              |
| `LMS_EXPORTS_BUCKET` / `HANDOUT_ATTACHMENTS_BUCKET`                 | Bucket names (default `hmp-lms-exports` / `hmp-handout-attachments`)                        |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email transport                                                                             |
| `REDIS_URL`                                                         | For queues                                                                                  |
| `CRON_SECRET`                                                       | Required by `/api/cron/reminders`. `openssl rand -hex 32`                                   |
| `AI_PROVIDER`                                                       | `openai` or `anthropic`                                                                     |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`                             | Provider key. Without it, AI features fall back to heuristic-only                           |
| `AI_MONTHLY_BUDGET_USD`                                             | Soft monthly AI budget (default 200). Over-budget → in-portal admin alert; AI stays enabled |
| `ERP_*`, `TAXILA_*`                                                 | Real ERP + LMS endpoints. Supplied by BITS WILP IT                                          |
| `NODE_ENV`                                                          | `production`                                                                                |
| `LOG_LEVEL`                                                         | `info` or `warn` in prod                                                                    |

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

## Corpus import (BITS handout corpus — Prompts 11f-a/b1/b2)

One-time (idempotent, re-runnable) ingestion of the prior-semester BITS WILP handout
corpus into the `HandoutImport` table. Approved rows then feed the faculty editor's
auto-fetch **Tier 2** — when a faculty member opens an allocation whose course code
matches an approved import, the editor pre-populates from the corpus content.

The parser + import + admin approval UI all already exist; this is an **operational run**,
not a code step. The pipeline is failure-tolerant (per-file, non-halting) and idempotent
(rows keyed on the source file's absolute path; re-running an unchanged file is a no-op,
a changed file forces re-parse). The corpus is BITS IP — **gitignored, never committed**;
it lives only on the operator's machine.

### Prerequisites

- `HMP_CORPUS_DIR` — absolute path to the directory of `.docx` handouts. The scan is
  **flat (non-recursive)** — point it at the directory that directly contains the files
  (mind nested extract folders, e.g. `…-001\COURSE HANDOUT FIRST SEMESTER 2025-2026`).
- A reachable `DATABASE_URL` (the import writes `HandoutImport` rows).

### Run

```
# PowerShell
$env:HMP_CORPUS_DIR = "<absolute path to the .docx directory>"
pnpm --filter @hmp/db exec tsx scripts/run-corpus-import.ts
```

Or trigger it from the UI: **Admin → `/admin/corpus-imports` → "Run import"** (the path
field defaults to `HMP_CORPUS_DIR`; runs inline, ~20–60 s for ~384 files).

### What it does per file

`.docx` → parsed via `parseDocxToHandout` (three-tier: mammoth-structured → text-fallback
→ fail). `.doc` / `.pdf` → recorded as `SKIPPED_FORMAT` (mammoth can't read them; no
LibreOffice conversion). Non-Word files (`.jpg`, `.xlsx`, …) are excluded at the directory
scan and never get a row. Every outcome is captured in `extractionMethod` +
`parseWarnings` / `parseErrors` on the row.

### Expected output

A summary (printed by the CLI, shown in the UI, and written to a `corpus.import.run`
**audit-log row**):

```
scanned · succeeded (MAMMOTH_STRUCTURED + TEXT_FALLBACK-with-data) · failed
· skippedFormat (.doc/.pdf) · skippedSize (>3 MB) · skippedModule · unchanged · durationMs
```

### Post-import admin review

1. Open **`/admin/corpus-imports`** — header pills show the count per `extractionMethod`;
   filter via `?method=…`, `?approved=…`, `?prefix=…`.
2. **Bulk-approve** the clean cohort with the widget. Eligibility:
   `extractionMethod = MAMMOTH_STRUCTURED` **AND** `bitsCourseNumber` present **AND**
   `parseWarnings ≤ 1` **AND** not already approved. The widget shows a pre-flight count
   - sample course numbers before committing.
3. Triage the rest per-row (approve despite warnings / re-parse / reject). Rows whose
   course code has no matching `Course` row show a **"Course row not found — create it?"**
   link that prefills `/admin/programmes` — imports are kept regardless; the match
   happens later when the `Course` is created.
4. Only `approvedForReuse = true` rows with non-null `data` surface to faculty auto-fetch.

### First real run (First Semester 2025-2026 corpus, 2026-06-17)

418 files scanned in **16.6 s**. Authoritative breakdown (from the DB / admin grid):

| outcome                      | count | note                                                           |
| ---------------------------- | ----- | -------------------------------------------------------------- |
| `MAMMOTH_STRUCTURED`         | 294   | structured + course code; **226 bulk-approved** (warnings ≤ 1) |
| `SKIPPED_SIZE` (>3 MB)       | 84    | known gap — see below                                          |
| `SKIPPED_FORMAT` (.doc/.pdf) | 34    | 33 `.doc` + 1 `.pdf`                                           |
| `SKIPPED_NARRATIVE_PROSE`    | 5     | deferred template variant                                      |
| `FAILED`                     | 1     | the only genuine parser failure                                |

Smoke test: `SE ZG501` auto-fetch Tier 2 returned its corpus handout (banner
`Imported corpus handout: SE ZG501`, 3 objectives / 3 LOs / 2 text books / 16 Part B
sessions / 2 eval components — real content, not placeholders). ~16 s / 418 files is a
useful sizing benchmark for future imports.

### Troubleshooting

- **84 `.docx` skipped on the 3 MB size cap (~22% of the corpus).** Not failures —
  image-heavy files skipped _before_ parsing. **Recoverable** as a separate idempotent
  pass via the `maxBytes` override, but the 3 MB cap is a deliberate parser-safety
  threshold (see audit doc §5) — **do not raise it without a Phase 1 survey of what fails
  at higher sizes.** Faculty can also re-upload an affected handout as a trimmed `.docx`.
- **CLI summary undercounts by the `SKIPPED_NARRATIVE_PROSE` count** (the tally `switch`
  has no case for it). The rows ARE imported — cross-check **`/admin/corpus-imports`** for
  authoritative per-method numbers, not the console summary.
- **Multi-match (cross-listed codes):** Tier 2 picks the **most-recently-imported** row
  (`findFirst` / `importedAt desc`) — no chooser, latest wins silently. Re-import order
  therefore determines which corpus row a cross-listed course inherits.
- **Path is scanned flat.** If the run reports `scanned: 0`, `HMP_CORPUS_DIR` is pointing
  one level above the files (a nested extract folder) — point it at the directory that
  directly contains the `.docx`.

## Word + PDF export (Prompt 23-b)

Faculty/IC/HOG download approved/submitted handouts as **.docx** (always available) or
**.pdf** (requires LibreOffice). Route: `GET /api/handouts/<requestId>/export/<docx|pdf>`.

### Prerequisites

- **Word (.docx):** none — generated in-process via the `docx` library.
- **PDF:** **LibreOffice headless** + a metric-compatible Arial font. On the EC2 host:

  ```
  sudo apt-get update && sudo apt-get install -y libreoffice fonts-liberation
  ```

  `fonts-liberation` provides Liberation Sans (metric-compatible with Arial) so PDFs
  render with correct line/page breaks even though Arial itself isn't redistributable on
  Linux. Verify: `soffice --version`.

- **`SOFFICE_BIN`** (optional) — path to the LibreOffice binary if not on `PATH`
  (default `soffice`).

### Behaviour / operations

- Each PDF conversion spawns LibreOffice with a **per-invocation `-env:UserInstallation`**
  (unique temp profile) so concurrent conversions don't collide on the profile lock and
  hang. A **30s timeout** kills a stalled conversion. Temp files are cleaned up after.
- If LibreOffice is **absent**, PDF requests return **503** (`pdf_unavailable`,
  `kind: missing-binary`); Word still works. This is the local-dev default (no LibreOffice,
  like MinIO) — install it on EC2 for PDF.
- Export requires **structured handout data**; legacy handouts (pre-Prompt-11, `data:null`)
  return 404 and are not exportable.

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
- **AI cost**: `/admin/ai-metrics` shows month-to-date AI spend vs `AI_MONTHLY_BUDGET_USD`, a 6-month trend, and per-user / per-handout / per-operation breakdowns (sourced from the `AiUsageLog` cost ledger — one row per real provider call). Over-budget fires a once-a-month in-portal alert to admins (soft cap; AI stays enabled). Update `packages/ai/src/pricing.ts` when provider list prices change (see its "Verified" comment).

## Security headers + rate limiting (Prompt 20)

**Verify security headers after deploy** (all set globally — static ones via `next.config.mjs headers()`, CSP per-request via middleware):

```
curl -sI https://<host>/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy'
```

Expect: `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a `Content-Security-Policy` containing `'nonce-…'` in `script-src`. (HSTS only takes effect over HTTPS — inert on plain-HTTP localhost.)

**Rate limiting** requires `REDIS_URL` (the same Redis as BullMQ; uses a separate fast-fail client). Limits: login 5 / 15 min per IP, attachment upload 10 / hour per user, AI generation 20 / hour per user. **Fail-open:** if Redis is unreachable, requests are allowed and a `ratelimit.unavailable` audit row is written each time — monitor that action's frequency as a Redis-outage signal. Without `REDIS_URL`, rate limiting is silently disabled (degraded-open) — acceptable for dev, **set it in production**.

## Backups

- Managed Postgres: enable daily snapshots, 7-day retention minimum.
- **S3 attachments bucket: enable versioning** (accidental-delete recovery) — run `pnpm --filter @hmp/integrations exec tsx scripts/setup-s3-lifecycle.ts` once per environment; it enables versioning + installs the Glacier lifecycle rule (idempotent). Noncurrent-version expiry is left unset (a retention tuning knob — set it if storage cost of old versions matters).
- **Verify backups** weekly: `pnpm --filter @hmp/integrations exec tsx scripts/verify-backups.ts` checks S3 versioning + lifecycle in code and prints the `aws rds describe-db-instances` command to confirm `BackupRetentionPeriod` + a recent `LatestRestorableTime`.
- Test restore **quarterly** into a staging DB and run the verification SQL — full procedure + restore drill in **[disaster-recovery.md](./disaster-recovery.md)**. A backup you've never restored is a hope, not a backup.

## Disaster recovery

Restore procedures for each failure class (RDS data loss, S3 attachment loss, auth outage, notification failure, total region failure) — detection signals, exact commands, post-restore verification SQL, and escalation — live in **[disaster-recovery.md](./disaster-recovery.md)**. Read it before go-live; keep its contact table current.

### Reconciliation sweep

Best-effort side effects that silently failed are repaired by a daily sweep: schedule an authenticated HTTPS POST to `/api/cron/reconcile` with `Authorization: Bearer <CRON_SECRET>` (same pattern + scheduler as `/api/cron/reminders`, off-peak e.g. 03:00 IST). It currently re-applies the `archived=true` S3 tag to ARCHIVED-handout attachments that missed it; returns a per-effect `{ found, reconciled, failed }` summary. Monitor `reconciliation.failed` audit-row frequency — a sustained nonzero count signals a chronic repair failure (e.g. S3 unreachable).

## Cutover checklist

- [ ] DNS pointed at production host.
- [ ] TLS cert valid (Let's Encrypt or platform-managed).
- [ ] `prisma migrate deploy` clean.
- [ ] Admin user created + can log in.
- [ ] Test request created end-to-end (IC → HOG → PC → Faculty → publish).
- [ ] Mailhog/SMTP delivered notifications received.
- [ ] `/api/cron/reminders` reachable with bearer.
- [ ] `/api/cron/reconcile` reachable with bearer + scheduled (daily, off-peak).
- [ ] S3 attachments bucket: versioning enabled + lifecycle present (`verify-backups.ts`).
- [ ] DR runbook contact table filled in; quarterly restore drill scheduled.
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
