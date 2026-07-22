# HMP production deploy (single EC2 host)

Reference layout: **t3a.medium / Ubuntu**, **RDS PostgreSQL 16**, **S3** (two buckets or one), local or ElastiCache **Redis**, **LibreOffice** for PDF export, **Nginx** + **PM2**. Deploy path assumed `/home/ubuntu/wilp-hmp` (adjust in `ecosystem.config.cjs` + `nginx.conf`).

## Host prerequisites

```bash
# Node 20+ (24 recommended — the worker uses node --env-file), pnpm, pm2
sudo apt-get update
sudo apt-get install -y libreoffice nginx        # LibreOffice = PDF export; else /export/pdf 503s
npm i -g pnpm pm2
```

- **EC2 instance role** attached, granting the S3 policy documented above `getS3Client` in `packages/integrations/src/storage.ts` (Get/Put on both buckets, Delete+PutObjectTagging on attachments, ListBucket for the HeadBucket probe). **No static S3 keys** — the app uses the instance role via the SDK default chain.
- Both S3 buckets **pre-created** (CreateBucket is not granted). `S3_ENDPOINT` stays **unset** (it's MinIO-only).

## One-time setup

```bash
cd /home/ubuntu/wilp-hmp
pnpm install                                   # include devDependencies — the worker runs via tsx
cp apps/web/.env.production.template apps/web/.env.production
#   → fill every <PLACEHOLDER>. Leave S3_ACCESS_KEY / S3_SECRET_KEY EMPTY (instance role).
#   → generate NEXTAUTH_SECRET (openssl rand -base64 32) and the admin bcrypt hash.

pnpm --filter @hmp/web build

# Migrations — reproduces schema.prisma exactly (verified via fresh-DB replay).
DATABASE_URL="<same as .env.production>" pnpm --filter @hmp/db exec prisma migrate deploy

# Production seed — RBAC/templates/config + ONE admin from env. NOT the dev seed.
ADMIN_EMAIL="<...>" ADMIN_INITIAL_PASSWORD_HASH="<bcrypt>" \
  NODE_ENV=production pnpm --filter @hmp/db db:seed:prod
```

> The dev seed (`db:seed`) refuses to run when `NODE_ENV=production` — it creates demo users with a default password. Always use `db:seed:prod` on the server.

## Start services

```bash
pm2 start /home/ubuntu/wilp-hmp/deploy/ecosystem.config.cjs   # hmp-web (:3000) + hmp-worker
pm2 save                                        # persist across reboots
pm2 startup                                      # generate the systemd unit (follow its output)

sudo cp /home/ubuntu/wilp-hmp/deploy/nginx.conf /etc/nginx/sites-available/hmp
sudo ln -s /etc/nginx/sites-available/hmp /etc/nginx/sites-enabled/hmp
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain            # TLS (or skip for bare-IP http testing)
```

## Updating — `deploy.sh`

After the one-time setup, every subsequent deploy (and re-deploys) run through one script:

```bash
cd /home/ubuntu/wilp-hmp
./deploy/deploy.sh
```

> **Before the first production run:** run `shellcheck deploy/deploy.sh` on the EC2 instance (`sudo apt install shellcheck` if absent). It surfaces quoting bugs and shell pitfalls that `bash -n` misses — cheap insurance on a script that runs `git reset --hard` + `prisma migrate deploy`. If it flags anything genuinely wrong, fix it in a follow-up commit **before** running the deploy — don't run past shellcheck errors on faith.

It is **idempotent**, **fails fast** (`set -euo pipefail`), and writes a full timestamped log to `/home/ubuntu/logs/deploy-<ts>.log`. Each major step is prefixed `==> [HH:MM:SS]`, and it ends with a single **`DEPLOY SUCCESSFUL`** or **`DEPLOY FAILED at step: <name>`** line so a non-developer can read the outcome.

**What it does:** preconditions (user, repo, `.env.production` keys present, `node`/`pnpm`/`pm2`/`soffice` on PATH, Node ≥ 20.6) → `git fetch` + `reset --hard origin/main` (prints old→new SHA) → `pnpm install --frozen-lockfile` → `prisma generate` → `prisma migrate deploy` → `pnpm build` → `pm2 reload … --update-env` → verifies **both** `hmp-web` and `hmp-worker` are `online` → web health check (`/api/health`, falling back to `/` since that route doesn't exist yet — a 404 on `/api/health` is expected) → worker health (online ≥ 30 s + no Redis/Postgres connection errors in its log) → scans recent logs for `ERROR`/`FATAL`.

**Flags** (fast partial redeploys — each requires `YES_I_KNOW=1` as deliberate friction):

| Flag             | Skips                   | Use when                          |
| ---------------- | ----------------------- | --------------------------------- |
| `--skip-deps`    | `pnpm install`          | only code changed, deps unchanged |
| `--skip-build`   | `pnpm build`            | env-only change                   |
| `--skip-migrate` | `prisma migrate deploy` | code hotfix, **no** schema change |

```bash
YES_I_KNOW=1 ./deploy/deploy.sh --skip-migrate     # e.g. a code-only hotfix
SKIP_LOG_CHECK=1 ./deploy/deploy.sh                 # first deploy, if the log scan is noisy
```

**Rollback contract:** the script **never auto-rolls-back**. A failed `prisma migrate deploy` can leave the DB partially migrated, and only the operator should decide how to resolve that. On any failure after the working tree is moved, it **prints** the exact rollback block (reset to the previous SHA, reinstall/generate/build, `pm2 reload`, then **`pm2 list` to confirm both `hmp-web` and `hmp-worker` are `online`**) — with an explicit warning to check `prisma migrate status` before resetting if the migration step was the one that failed.

## Post-launch scope re-enablement

Two launch-scope decisions (Prompt 6 hardening) are deliberately reversible:

**Attachments** are disabled for launch — `ATTACHMENTS_DISABLED` in `apps/web/src/lib/attachments-feature.ts`. The upload route returns **501**, the delete action is guarded, and the faculty upload UI is hidden; the full implementation is **preserved, not deleted**. To re-enable when re-scoped:

1. Confirm the scope change with IT — the spec sheet committed "handouts only"; attachments move S3 sizing from ~5 GB Year-1 to GB–TB scale, with cost and possibly vendor-quote impact. Not a silent flip.
2. Provision + size `HANDOUT_ATTACHMENTS_BUCKET` (lifecycle/archive tiering) and confirm the instance-role S3 policy covers it.
3. Flip `ATTACHMENTS_DISABLED` to `false` and restore the faculty page's `canUpload` to `EDITABLE.has(status)`.
4. Verify capacity headroom (uploads add memory + bandwidth on the shared box).

**Login rate limits** — per-IP 30/15min + per-username 5/15min (`RATE_LIMITS` in `apps/web/src/lib/rate-limit.ts`). If legitimate users behind a shared campus NAT hit lockouts in the first week, **raising `loginIp.limit` is expected and low-risk** (e.g. → 60) — the per-username limit still bounds brute-force. Leave `loginUser` tight. Tune + redeploy.

## Notes / gotchas

- **Worker env:** the worker is TypeScript run via `tsx`; it does **not** load `.env` itself (dotenv isn't a dependency). `ecosystem.config.cjs` uses `node --env-file=apps/web/.env.production` so it reads the same file as the web app. This is why `pnpm install` must include devDependencies (for `tsx`).
- **WORKERS_ENABLED=true** is set for both processes' behaviour: the web app _enqueues_ jobs to Redis, and `hmp-worker` _consumes_ them. Without the worker running, notifications/AI jobs never process (the web app falls back to inline synchronous execution only if `WORKERS_ENABLED` is unset).
- **Capacity (t3a.medium, 4 GB):** web + worker + LibreOffice is tight. Watch memory under concurrent PDF exports; if pressured, move Redis to ElastiCache or split the worker to a second host.
- **Security headers** (HSTS, CSP nonce, etc.) come from the Next app/middleware — Nginx forwards them and must **not** re-add CSP (it would break the per-request nonce).
- **`X-Forwarded-Proto`** is set in `nginx.conf` — required for NextAuth's `trustHost` + secure cookies behind TLS termination.
