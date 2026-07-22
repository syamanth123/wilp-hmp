# HMP — One-Hour Deploy (testing fast-path)

Fast-path deploy for the first testing rollout on a bare IP. For the full production checklist (TLS, domain, HA, sign-off) see `DEPLOYMENT_CHECKLIST.md`.
**Estimated time:** 45–90 minutes.
**Before starting:** PuTTY `.ppk` ready · `NEXTAUTH_SECRET` generated (`openssl rand -hex 32`) · admin bcrypt hash generated (`node -e "console.log(require('bcryptjs').hashSync('YOUR_PW',12))"`) · corpus folder path known.

## 1. PuTTY setup (one-time, local)

- PuTTYgen → **Load** (All Files) → select `Handout.pem` → **Save private key** → `Handout.ppk`
- PuTTY → Session: `ubuntu@13.201.161.6`, port `22` → Connection → SSH → Auth → Credentials → Private key: `Handout.ppk`
- Session → Saved Sessions: `HMP Production` → **Save** → **Open**

✓ Success: prompt lands at `ubuntu@ip-xxx-xx-xx-xx:~$`
✗ If fails: re-check the `.ppk` path and that the Security Group allows your IP on port 22.

## 2. Install dependencies (first SSH)

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install -y libreoffice redis-server nginx git shellcheck
sudo npm i -g pnpm pm2
sudo systemctl enable --now redis-server nginx
```

```bash
node --version && soffice --version | head -1 && redis-cli ping && pm2 --version
```

✓ Success: node `v20.6+`, a LibreOffice version, `PONG`, `5.x`
✗ If fails: re-run the specific `apt install`; if `redis-cli` isn't `PONG`, `sudo systemctl status redis-server`.

## 3. Clone + directories

```bash
mkdir -p /home/ubuntu/logs && cd /home/ubuntu && git clone https://github.com/syamanth123/wilp-hmp.git && cd wilp-hmp && shellcheck deploy/deploy.sh
```

✓ Success: clone completes; `shellcheck` prints nothing (clean).
✗ If fails: if `shellcheck` reports an error, stop and report it before continuing.

## 4. Upload corpus (local, WinSCP or scp)

```bash
scp -i Handout.pem -r ./corpus ubuntu@13.201.161.6:/home/ubuntu/corpus
```

✓ Success: on EC2, `ls /home/ubuntu/corpus | wc -l` shows the expected file count.
✗ If fails: use WinSCP (same key, drag the folder to `/home/ubuntu/corpus`).

## 5. Create `.env.production` (critical)

```bash
cd /home/ubuntu/wilp-hmp && cp apps/web/.env.production.template apps/web/.env.production && nano apps/web/.env.production
```

Fill: `DATABASE_URL` (RDS endpoint + password) · `NEXTAUTH_URL=http://13.201.161.6` · `APP_BASE_URL=http://13.201.161.6` · `NEXTAUTH_SECRET=` (your hex) · `ADMIN_EMAIL` · `ADMIN_INITIAL_PASSWORD_HASH` (your bcrypt) · `HMP_CORPUS_DIR=/home/ubuntu/corpus` · `REDIS_URL=redis://localhost:6379` · `S3_REGION=ap-south-1` · `HANDOUT_ATTACHMENTS_BUCKET=handout-09-07-2026` · `LMS_EXPORTS_BUCKET=handout-09-07-2026`. Leave **empty**: `S3_ACCESS_KEY`, `S3_SECRET_KEY` (instance role), `SMTP_*` (fine for testing), `S3_ENDPOINT`.

```bash
grep -c "^[A-Z_]*=" apps/web/.env.production && git status --porcelain apps/web/.env.production
```

✓ Success: count is ~20+, and `git status` prints **nothing** (file is git-ignored — never committed).
✗ If fails: if `git status` lists the file, STOP — do not commit; confirm it matches `.gitignore`.

## 6. Install + migrate + seed

```bash
pnpm install --frozen-lockfile && pnpm --filter @hmp/db exec prisma generate
```

✓ Success: install completes with no lockfile-drift error; client generated.

```bash
pnpm --filter @hmp/db exec prisma migrate deploy
```

✓ Success: `The following migration(s) have been applied` (or `No pending migrations to apply`).
✗ If fails: **do NOT rerun.** Run `pnpm --filter @hmp/db exec prisma migrate status` and stop for investigation — the DB may be partially migrated.

```bash
pnpm --filter @hmp/db db:seed:prod
```

✓ Success: `[seed:prod] created admin <ADMIN_EMAIL> + RBAC/template/config scaffolding.`
✗ If fails on "must both be set": `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD_HASH` aren't in `.env.production`.

## 7. Build + start

```bash
pnpm build
```

✓ Success: `✓ Compiled successfully`; `apps/web/.next` generated.

```bash
pm2 start deploy/ecosystem.config.cjs && sleep 5 && pm2 list
```

✓ Success: both `hmp-web` and `hmp-worker` show `online`.
✗ If fails: `pm2 logs hmp-web --lines 50` — usually a missing `.env.production` var.

```bash
pm2 startup   # then run the sudo command it prints
pm2 save
```

✓ Success: PM2 persists across reboots.

## 8. Nginx (HTTP-only for bare-IP testing)

> The committed `deploy/nginx.conf` is for the **TLS** production setup (it redirects `:80 → :443`). For a bare-IP HTTP pilot, write this minimal HTTP-only proxy instead:

```bash
sudo tee /etc/nginx/sites-available/hmp >/dev/null <<'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/hmp /etc/nginx/sites-enabled/hmp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

✓ Success: `syntax is ok` + `test is successful`, then reload with no output.

## 9. Open port 80 (AWS console)

- EC2 → Instances → **Handout** → Security tab → click the security group → **Edit inbound rules** → **Add rule**: Type `HTTP`, Port `80`, Source `0.0.0.0/0` → **Save rules**

✓ Success: rule shows HTTP / 80 / 0.0.0.0/0.

## 10. Smoke test

```bash
curl -s http://localhost:3000/api/health
```

✓ Success: `{"status":"ok","db":"connected","redis":"connected",...}`
✗ If fails (`degraded`): check the `db`/`redis` fields; `redis-cli ping` and re-check `DATABASE_URL`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost
```

✓ Success: `200` or `307` (login redirect via nginx).

- Browser → `http://13.201.161.6` → login page renders → sign in as admin (email + the **plaintext** password you hashed) → lands on admin dashboard.
- Admin → **Corpus Imports** → import (auto-detects `HMP_CORPUS_DIR=/home/ubuntu/corpus`).

## 11. If Phase 10 fails

```bash
pm2 logs hmp-web --lines 50 --nostream
pm2 logs hmp-worker --lines 50 --nostream
sudo tail -50 /var/log/nginx/error.log
ls -t /home/ubuntu/logs/deploy-*.log 2>/dev/null | head -1
```

---

**Deployment complete when:** admin login works + corpus visible in the admin UI + one test handout renders with logo/letterhead/watermark in the exported PDF.
**After a successful deploy:** rotate the RDS password (see `DEPLOYMENT_CHECKLIST.md` Phase 1a / the rotation note), then update `DATABASE_URL` and `pm2 reload deploy/ecosystem.config.cjs --update-env`.
