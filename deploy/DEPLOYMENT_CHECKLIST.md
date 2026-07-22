# HMP — Production Deployment Checklist

A **standalone, tickable runbook** for a first-time deployment of the Handout Management Portal (HMP) to a single EC2 host. You do **not** need prior context — follow the phases top to bottom. Reflects everything landed across the hardening work (Prompts 1–6).

**Reference stack:** EC2 `t3a.medium` (Ubuntu) · RDS PostgreSQL 16 · S3 (2 buckets) · Redis (local) · LibreOffice (PDF export) · Nginx + PM2. Deploy path: `/home/ubuntu/wilp-hmp`.

**Companion docs:** `deploy/README.md` (architecture + `deploy.sh` usage + post-launch re-enablement), `apps/web/.env.production.template` (the env contract), the S3 IAM policy (doc comment above `getS3Client` in `packages/integrations/src/storage.ts`).

> 🔐 **Secrets rule (applies throughout):** the only place secrets live is `apps/web/.env.production` on the server — which is **git-ignored and must never be committed**. No secret goes into any committed file, the PM2 manifest, or this checklist. The admin password is stored **pre-hashed**; the plaintext is never written anywhere.

---

## PHASE 1 — Pre-deployment preparation (local machine)

Have all of this ready **before** you SSH in.

### 1a. Credentials in hand

- [ ] **RDS master password** — rotated after IT handover (don't reuse the provisioning default). Goes into `DATABASE_URL`.
- [ ] **IAM instance role** attached to the EC2 instance — verify in AWS Console → EC2 → the instance → _Security_ tab → _IAM Role_. **No static S3 keys needed** (the app uses the role).
- [ ] **SSH key** — `Handout.ppk` (converted from the `.pem` via PuTTYgen), held in PuTTY.
- [ ] **RDS endpoint URL** — e.g. `hmp-prod.xxxxxx.ap-south-1.rds.amazonaws.com`.
- [ ] **S3 bucket — `handout-09-07-2026`** (IT provisioned a **single** bucket for launch). Both env vars — `HANDOUT_ATTACHMENTS_BUCKET` and `LMS_EXPORTS_BUCKET` — point at this same bucket; the code namespaces objects by key prefix, so one bucket serves both the (disabled-at-launch) attachments and the Word/PDF export path.
- [ ] **SMTP credentials** — host, port, user, password, from-address for notification email.

### 1b. Environment values decided

- [ ] **`APP_BASE_URL`** — the production URL that goes into notification **email links** (must be absolute, e.g. `https://hmp.bits-pilani.ac.in`).
- [ ] **`NEXTAUTH_URL`** — usually identical to `APP_BASE_URL`.
- [ ] **Admin email** + **admin initial bcrypt hash** — generate the hash locally (never ship plaintext):
  ```bash
  node -e "console.log(require('bcryptjs').hashSync('YOUR_STRONG_PASSWORD', 12))"
  ```
  Keep the plaintext **only** in your password manager — you need it once, to log in at step 5c.
- [ ] **Domain status** — registered? DNS `A` record pointed at the EC2 **Elastic IP**? Or launching on the bare IP (`13.201.161.6`) for testing? (Bare-IP = skip TLS in Phase 4g; use `http://<ip>:...`.)

### 1c. Corpus data ready

- [ ] The **approved corpus revision** (the ~284 approved handouts) staged locally, ready to upload.
- [ ] Decide the server path for it (used as `HMP_CORPUS_DIR`), e.g. `/home/ubuntu/corpus/`.

### 1d. Tools on your local machine

- [ ] **PuTTY** + **PuTTYgen**
- [ ] **WinSCP** (file transfer)
- [ ] **AWS CLI** (optional — to verify the instance role + bucket policy)

---

## PHASE 2 — Server preparation (first SSH into EC2)

### 2a. Connect via PuTTY

- [ ] Host: `ubuntu@13.201.161.6` · Auth: `Handout.ppk`
- [ ] You should land at: `ubuntu@ip-xxx-xx-xx-xx:~$`

### 2b. System update + dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Node 20.x (LTS) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# System dependencies
sudo apt install -y libreoffice redis-server nginx git shellcheck

# pnpm + PM2 (global)
sudo npm i -g pnpm pm2

# Enable + start Redis and Nginx now and on every boot
sudo systemctl enable --now redis-server nginx
```

### 2c. Verify installations

```bash
node --version        # expect: v20.6.0 or higher (the worker uses --env-file)
soffice --version     # expect: LibreOffice 7.x / 24.x — any recent version
redis-cli ping        # expect: PONG
pm2 --version         # expect: 5.x
pnpm --version        # expect: 9.x (matches packageManager in package.json)
shellcheck --version  # expect: any version
```

- [ ] All six commands return the expected output.

### 2d. Directory setup + repo clone

```bash
mkdir -p /home/ubuntu/logs
cd /home/ubuntu
git clone https://github.com/syamanth123/wilp-hmp.git
cd wilp-hmp

# Lint the deploy script BEFORE the first run (it runs git reset --hard + migrate deploy)
shellcheck deploy/deploy.sh   # expect: no output = clean
```

- [ ] `/home/ubuntu/logs` exists, repo cloned to `/home/ubuntu/wilp-hmp`, `shellcheck` clean.

---

## PHASE 3 — Environment + secrets configuration

### 3a. Upload corpus data (WinSCP)

- [ ] Transfer the corpus folder to the server path chosen in 1c (e.g. `/home/ubuntu/corpus/`).
- [ ] Confirm on the server: `ls /home/ubuntu/corpus | wc -l` shows the expected file count.

### 3b. Create the production env file

```bash
cd /home/ubuntu/wilp-hmp
cp apps/web/.env.production.template apps/web/.env.production
nano apps/web/.env.production
```

> 🔐 **This file holds every secret and must NEVER be committed** — it is git-ignored by design. Fill in each `<PLACEHOLDER>`.

Required (app will not run without these):

- [ ] `DATABASE_URL` — RDS endpoint + rotated password + `?schema=public&sslmode=require`
- [ ] `NEXTAUTH_URL`, `APP_BASE_URL` — the production https URL
- [ ] `NEXTAUTH_SECRET` — fresh: `openssl rand -base64 32` (do **not** reuse the dev value)
- [ ] `REDIS_URL` — **`redis://localhost:6379`** — local Redis running on the EC2 box (no ElastiCache at launch; installed + enabled in Phase 2b).
- [ ] `S3_REGION`; `HANDOUT_ATTACHMENTS_BUCKET` **and** `LMS_EXPORTS_BUCKET` — set **both to `handout-09-07-2026`** (single provisioned bucket)
- [ ] `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — **if SMTP creds aren't available yet, leaving these blank is safe**: notification email will fail server-side (logged, non-fatal) but the app runs normally. Verify email delivery separately post-launch.
- [ ] `SOFFICE_BIN=soffice`, `NODE_ENV=production`
- [ ] `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD_HASH` (the bcrypt hash from 1b)
- [ ] `HMP_CORPUS_DIR` — the path from 3a

Leave **empty** (instance role handles S3):

- [ ] `S3_ACCESS_KEY=""`, `S3_SECRET_KEY=""`
- [ ] `S3_ENDPOINT` — **must stay unset** (MinIO/dev only; setting it breaks real AWS)

Feature-gated (only if used): `AI_PROVIDER` + key + `AI_MONTHLY_BUDGET_USD`, `TAXILA_API_URL` + `TAXILA_API_TOKEN`, `CRON_SECRET`.

### 3c. Verify env sanity

```bash
# Count populated vars (sanity: should be ~20+)
grep -c "^[A-Z_]*=" apps/web/.env.production

# Find any REQUIRED var left blank (output should be empty)
grep -E "^[A-Z_]+=(\"\")?$" apps/web/.env.production

# Confirm the file is readable and a key var is present (prints: true)
node -e "for(const l of require('fs').readFileSync('apps/web/.env.production','utf8').split('\n')){if(l.startsWith('DATABASE_URL=')&&l.length>'DATABASE_URL='.length+2)process.stdout.write('true')}"
```

- [ ] Populated count looks right, no blank required vars, `DATABASE_URL` check prints `true`.

### 3d. Verify the IAM instance role (no keys)

- [ ] In AWS Console, confirm the instance role's policy matches the JSON in the `getS3Client` doc comment (`packages/integrations/src/storage.ts`): on the single `handout-09-07-2026` bucket — `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject`/`s3:PutObjectTagging` on the objects, `s3:ListBucket` on the bucket.
- [ ] Test from the EC2 box (**no keys in env**):
  ```bash
  aws s3 ls s3://handout-09-07-2026/     # expect: succeeds (empty listing is fine)
  ```
  Success here proves the instance role works. A `403`/credentials error means the role isn't attached or the policy is wrong — fix before continuing.

---

## PHASE 4 — Deploy

All commands from `/home/ubuntu/wilp-hmp`.

### 4a. Install + generate

```bash
pnpm install --frozen-lockfile
pnpm --filter @hmp/db exec prisma generate
```

- [ ] Install completes (no lockfile drift error); Prisma client generated.

### 4b. Migrate the fresh RDS

```bash
pnpm --filter @hmp/db exec prisma migrate deploy
pnpm --filter @hmp/db exec prisma migrate status
```

- [ ] `migrate deploy` applies all migrations; `migrate status` prints **`Database schema is up to date!`**

### 4c. Seed (production)

```bash
pnpm --filter @hmp/db db:seed:prod
```

- [ ] Prints **`[seed:prod] created admin <ADMIN_EMAIL> + RBAC/template/config scaffolding.`**
      (The dev seed `db:seed` refuses to run under `NODE_ENV=production` — this is the correct one.)

### 4d. Build + start

```bash
pnpm build
pm2 start deploy/ecosystem.config.cjs
pm2 startup          # copy/run the sudo command it prints (persists across reboots)
pm2 save
pm2 list
```

- [ ] `pm2 list` shows **`hmp-web`** and **`hmp-worker`** both `online`.

### 4e. Corpus import

- [ ] Log in as admin (after Phase 4 completes) and import the corpus via **Admin → Corpus Imports** (reads `HMP_CORPUS_DIR`). _(A CLI path also exists: `packages/db/scripts/run-corpus-import.ts` — use whichever the admin UI documents.)_
- [ ] Import summary shows the expected number of handouts processed with no unexpected failures.

### 4f. Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/hmp
sudo ln -s /etc/nginx/sites-available/hmp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # remove the placeholder site
# Edit server_name in the config to your domain (or the EC2 IP for bare-IP testing):
sudo nano /etc/nginx/sites-available/hmp
sudo nginx -t                                 # expect: syntax is ok / test is successful
sudo systemctl reload nginx
```

- [ ] `nginx -t` passes; Nginx reloaded.

### 4g. TLS certificate (skip if launching on bare IP)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain>
curl -I https://<your-domain>                 # expect: HTTP/2 200 (or 307 redirect to /login)
```

- [ ] Certificate issued; HTTPS responds. Auto-renewal is handled by certbot's systemd timer (`systemctl list-timers | grep certbot`).

### 4h. AWS Security Group

- [ ] Port **443** open to `0.0.0.0/0` (public HTTPS)
- [ ] Port **80** open to `0.0.0.0/0` (certbot HTTP-01 challenge + HTTP→HTTPS redirect)
- [ ] Port **22** restricted to the **ops IP range only**
- [ ] No other inbound ports open (Postgres/Redis are not public — Redis is localhost, RDS is via its own SG)

---

## PHASE 5 — Post-deploy verification

Run every check before declaring success.

### 5a. Health check

```bash
curl https://<your-domain>/api/health
```

- [ ] Expect **`200`** with `{"status":"ok","db":"connected","redis":"connected","uptime":<n>,"version":"<sha>"}`. A `503`/`degraded` means a dependency is down — check the `db`/`redis` fields.

### 5b. Login page loads

- [ ] Open `https://<your-domain>/` — redirects to `/login`, page renders, **no errors** in the browser devtools console.

### 5c. Admin sign-in

- [ ] Sign in with `ADMIN_EMAIL` + the **plaintext** password you hashed in 1b (not the hash).
- [ ] Login succeeds and lands on the admin dashboard.

### 5d. Full-workflow smoke test (walk one handout end-to-end)

Exercise every gate and confirm the audit trail + export:

- [ ] **IC** — create a test course + initiate a handout request
- [ ] **HOG** — allocate faculty + designate SME
- [ ] **PC** — confirm the allocation (gate 1)
- [ ] **Faculty** — author content, then submit for SME review
- [ ] **SME** — approve
- [ ] **PC** — content review (gate 2)
- [ ] **HOG** — approve
- [ ] **IC** — publish
- [ ] **Export** — download the PDF; confirm it renders with **logo, letterhead, the faint per-page watermark, and the canonical numbered-section layout** _(this download is also the first real check of the docx→PDF watermark on a machine with LibreOffice — the piece that couldn't be verified pre-deploy)_
- [ ] **Audit** — confirm the audit log shows all transitions with actor + timestamp

### 5e. Notification email

- [ ] Confirm at least one workflow-triggered email arrived at the SMTP inbox.
- [ ] Confirm the "Open in HMP" link is **absolute** (starts with `APP_BASE_URL`), not a relative `/pc/requests/...` path.

### 5f. PM2 + logs

```bash
pm2 status
tail -50 /home/ubuntu/logs/hmp-web.err.log
tail -50 /home/ubuntu/logs/hmp-worker.err.log
```

- [ ] Both processes `online`, uptime > 10 min; no errors in either log tail.

### 5g. CloudWatch (if configured)

- [ ] At least one metric publishing (EC2 CPU shows data).
- [ ] SNS alarm topic subscribed to the correct ops email.

---

## PHASE 6 — Rollback contract

If **anything** in Phase 5 fails:

### 6a. Preserve evidence

```bash
cp /home/ubuntu/logs/deploy-<ts>.log /home/ubuntu/logs/FAILED_<ts>.log
```

- [ ] Note the **failing step number** from this checklist and the failing deploy log.

### 6b. Rollback by failure point

- **Phase 4b (`migrate deploy` failed):** **DO NOT auto-rollback.** The DB may be partially migrated. Run `pnpm --filter @hmp/db exec prisma migrate status`, assess, and escalate if unsure — a bad schema state needs a human decision, not a blind `git reset`.
- **Phase 4d onward (build/start failed):** the `deploy.sh` script **already prints the exact rollback block** on failure (reset to the previous SHA → reinstall/generate/build → `pm2 reload` → `pm2 list` online-check). Follow _that_ printed block — it is the single source of truth; this checklist deliberately does not duplicate it. See also `deploy/README.md` → "Updating — deploy.sh" → Rollback contract.
- **Phase 5 (verification failed):** investigate at the **app level** (logs, config). Do **not** touch the DB or infra to fix an app-level symptom.

### 6c. Escalation contacts

- [ ] Application issues → **[primary developer contact]**
- [ ] Infrastructure issues → **[IT contact from provisioning email]**

---

## Appendix — Deferred items to revisit

- **Attachments** — disabled at launch (`ATTACHMENTS_DISABLED`). Re-enable steps: `deploy/README.md` → "Post-launch scope re-enablement".
- **PM2 cluster mode** — single-instance fork mode at launch (right for the 2-vCPU box). Revisit at ~80+ concurrent users on a larger instance.
- **RDS Multi-AZ** — single-AZ at launch; upgrade planned within 30 days.
- **Dedicated PDF worker (2nd EC2)** — decide from CloudWatch memory/CPU after week 1.
- **Rate-limit tuning** — raise `loginIp.limit` if campus-NAT lockouts appear in logs (expected, low-risk; `deploy/README.md` has the note).
- **Append-only DB triggers** (issue #40), **drop dead JSON columns** (issue #41) — post-launch hardening.

---

## Sign-off

| Field                                   | Value                          |
| --------------------------------------- | ------------------------------ |
| Deployer name                           |                                |
| Deploy date                             |                                |
| Deployed commit SHA                     | (`git rev-parse --short HEAD`) |
| Deviations from checklist (with reason) |                                |
| IT contact acknowledgment               |                                |
