# New production server — install HMP v1.0.0

For the person installing HMP on the EC2 instance "Handout" (Ubuntu LTS, t3a.medium, 4 GB RAM,
20 GB disk, Elastic IP 13.201.161.6, ap-south-1) behind the AWS load balancer that serves
**https://hmp.wilp-connect.net**. Every command is copy-paste, run in the SSH session as `ubuntu`.
Anything in `<ANGLE_BRACKETS>` is a secret or a value you type yourself — **never** put a real
secret in a file inside the repo or in a chat. Based on `docs/deployment-runbook.md`.

How the pieces fit:

```
browser ──https──▶ ALB (TLS ends here) ──http──▶ nginx :80 on EC2 ──▶ Next.js 127.0.0.1:3000
                                                                    ├─▶ RDS PostgreSQL 16 (SSL)
                                                                    ├─▶ S3 handout-09-07-2026
                                                                    └─▶ Redis 127.0.0.1:6379
```

## 0. Before you start

- **The domain currently serves an old HMP build** that redirects to the IP and lists demo
  accounts on its login page.
  - **Same box** (this instance _is_ the old pilot — `pm2 list` shows `hmp-web` and there is a
    `~/wilp-hmp` folder): the old pilot can't keep running alongside the new install. Step 1b
    **stops it** and keeps everything needed to bring it back (§10 "Same box").
  - **Different box:** keep the old pilot running until §9 passes, then stop it.
- Ask IT (or check) which **port the ALB target group sends to**. This guide uses **80** (nginx).
  The ALB **health-check path should be `/login`** (not `/api/health`, which answers 503 while
  Redis is down — with one server, that would take the whole site out).
- Have ready: the RDS endpoint, master user and password; the S3 access key pair for IAM user
  "handout"; an admin email; an SMTP account (optional).
- Connect: `ssh -i C:\work\secrets\Handout.pem ubuntu@13.201.161.6`.

## 1. Server setup

**1a. Updates, swap (so the build doesn't run out of memory), packages**

```bash
sudo apt update && sudo apt -y upgrade
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                                   # Swap: 2.0Gi

# Node 20 (the version CI tests with; package.json requires >=20), pnpm 9.12.0 via corepack
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable && corepack prepare pnpm@9.12.0 --activate
node -v && pnpm -v                        # v20.x and 9.12.0

# Word→PDF export, database client, web server, Redis, tools
sudo apt install -y libreoffice-writer-nogui fonts-dejavu postgresql-client-16 nginx redis-server git curl
soffice --version && psql --version && redis-cli ping     # PONG
sudo systemctl enable --now redis-server
```

**1b. Same box: stop the old pilot, keep it restorable** (skip on a truly empty box)

The old site goes down here and stays down until §6 starts v1.0.0 (nginx shows an error page in
between — better than a login page listing passwords). Nothing is deleted; §10 "Same box" brings
it back.

```bash
pm2 list 2>/dev/null; ls -d ~/wilp-hmp 2>/dev/null; ls /etc/nginx/sites-enabled/
# 1. Remember exactly what pm2 was running, then stop it (stop, not delete):
pm2 save && cp ~/.pm2/dump.pm2 ~/pm2-dump-old.pm2
pm2 stop all
# 2. Don't let pm2 restart the old app on reboot (it would fight hmp-web for port 3000).
#    Run the `sudo …` line this prints:
pm2 unstartup systemd
# 3. Keep the old code + its settings file under a fixed name (§7 reads the old database address from it):
mv ~/wilp-hmp ~/wilp-hmp-old
# 4. Keep the old nginx setup, then switch off its site(s) (§5 adds the new one):
sudo tar czf ~/nginx-old.tgz -C / etc/nginx
sudo find /etc/nginx/sites-enabled -mindepth 1 -delete
```

**1c. Code — exactly v1.0.0**

```bash
cd ~ && git clone https://github.com/syamanth123/wilp-hmp.git && cd wilp-hmp
git checkout v1.0.0 && git log -1 --oneline
```

## 2. Settings file `apps/web/.env.production`

Create it with `nano ~/wilp-hmp/apps/web/.env.production`, paste the block, then replace every
`<…>`. Use **single quotes** as shown (nothing inside them is interpreted). It is git-ignored.

```
# --- Address: fixes the redirect to the IP ---
NEXTAUTH_URL='https://hmp.wilp-connect.net'
APP_BASE_URL='https://hmp.wilp-connect.net'
AUTH_TRUST_HOST='true'
NEXTAUTH_SECRET='<OUTPUT_OF: openssl rand -base64 32>'

# --- Database (RDS forces SSL) ---
DATABASE_URL='postgresql://<RDS_USER>:<RDS_PASSWORD_URL_ENCODED>@<RDS_ENDPOINT>:5432/<DB_NAME>?schema=public&sslmode=require'

# --- Storage: one bucket, separate folders (attachments/…, lms-exports/…) ---
S3_REGION='ap-south-1'
S3_ACCESS_KEY='<ACCESS_KEY_ID_FROM_CSV>'
S3_SECRET_KEY='<SECRET_ACCESS_KEY_FROM_CSV>'
HANDOUT_ATTACHMENTS_BUCKET='handout-09-07-2026'
LMS_EXPORTS_BUCKET='handout-09-07-2026'

# --- Redis on this box (login rate limiting + health check) ---
REDIS_URL='redis://127.0.0.1:6379'

# --- Features ---
AI_FEATURES_ENABLED='false'
PASSWORD_LOGIN_ENABLED='true'
SOFFICE_BIN='soffice'
CRON_SECRET='<OUTPUT_OF: openssl rand -hex 24>'
NODE_ENV='production'
# SHOW_DEMO_LOGINS must NOT appear in this file.
# WORKERS_ENABLED is left unset: emails are sent during the request (no worker process).
```

**Email — only if you have an SMTP account.** Add these lines with every `<…>` filled in. **No
SMTP account → add nothing:** with no `SMTP_HOST` line the app skips emails (it logs them) and
works normally. Never leave a `<…>` placeholder in the file — the app would try to connect to it.

```
SMTP_HOST='<SMTP_HOST>'
SMTP_PORT='587'
SMTP_USER='<SMTP_USER>'
SMTP_PASS='<SMTP_PASSWORD>'
SMTP_FROM='HMP <no-reply@wilp-connect.net>'
```

Before going on, check nothing is left unfilled — this must print nothing:
`grep -n '<' ~/wilp-hmp/apps/web/.env.production | grep -v 'no-reply@'`

Notes:

- **The redirect fix.** The sign-in system builds every link and redirect from `NEXTAUTH_URL`;
  the old setup had `http://13.201.161.6`, so the domain bounced to the IP. With
  `https://hmp.wilp-connect.net` (and `AUTH_TRUST_HOST`, honouring the load balancer's
  `X-Forwarded-*` headers that nginx passes on in §5) links stay on the domain and sign-in
  cookies are marked `Secure`.
- **URL-encode the database password** (special characters break the address):
  `node -e "console.log(encodeURIComponent(process.argv[1]))" '<RDS_PASSWORD>'` — paste the output
  in place of `<RDS_PASSWORD_URL_ENCODED>`. Make the database first if it doesn't exist (§4a).
- **No overwrites in the shared bucket:** attachments are stored under
  `attachments/<request>/<random id>`, Taxila exports under `lms-exports/<year>/<HMP-ref>.zip`
  (the code builds these keys; no setting needed). The check script writes only under
  `healthcheck/`.
- **`PASSWORD_LOGIN_ENABLED`** has no effect in v1.0.0 (password login is the only sign-in);
  it is set now so the later BITS-SSO release keeps password login on until SSO is ready.
- Lock the file: `chmod 600 ~/wilp-hmp/apps/web/.env.production`.

**Redis and workers — what's needed.** Redis **is** installed (step 1a): without it login
rate limiting is off (unlimited password guessing), `/api/health` answers 503 (a load-balancer
health check on it would mark the server unhealthy) and Admin → Background jobs says jobs aren't
running. **Workers are not needed:** with `WORKERS_ENABLED` unset, emails are sent during the
request (slightly slower), and with AI off there are no AI jobs.

## 3. S3 permissions (Get and Put only; Delete denied)

| Feature                                  | Needs                                                                                                                       | With IT's current policy                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Taxila export ZIP (publishing, "Mode B") | `s3:PutObject`, `s3:GetObject` (download link) **and `s3:ListBucket`** (the code checks the bucket exists before uploading) | **Fails until `s3:ListBucket` is granted** — without it the code tries to create the bucket, which is denied |
| Attachments (upload / download)          | `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`                                                                             | **Switched off in v1.0.0** (no upload button; upload route answers 501)                                      |
| Attachments (remove)                     | `s3:DeleteObject`                                                                                                           | off                                                                                                          |
| Attachments (archive tagging)            | `s3:PutObjectTagging`, `s3:GetObjectTagging`                                                                                | off (nothing to tag while attachments are off)                                                               |
| Word / PDF download                      | none (built in memory)                                                                                                      | works                                                                                                        |

Ask IT for **`s3:ListBucket` on `arn:aws:s3:::handout-09-07-2026`** now (needed for publishing).
The rest only when attachments are switched on.

## 4. Database and build

**4a. Database (first time only)**

```bash
cd ~/wilp-hmp
set -a; . apps/web/.env.production; set +a
psql "${DATABASE_URL%%\?*}?sslmode=require" -c 'select 1'     # must print 1
# If it says the database does not exist, create it via the default "postgres" database:
#   psql "postgresql://<RDS_USER>:<RDS_PASSWORD_URL_ENCODED>@<RDS_ENDPOINT>:5432/postgres?sslmode=require" -c 'CREATE DATABASE <DB_NAME>;'
```

Take an **RDS snapshot** now (AWS console → RDS → handout → Actions → Take snapshot,
`hmp-before-v1-0-0`).

**4b. Install, migrate, build**

```bash
cd ~/wilp-hmp
pnpm install --frozen-lockfile
pnpm --filter @hmp/db exec prisma generate
set -a; . apps/web/.env.production; set +a
pnpm --filter @hmp/db exec prisma migrate deploy        # ends with "All migrations have been successfully applied."
pnpm --filter @hmp/web build                            # ~5–8 min
```

**4c. One admin account, nothing else.** The production seed creates the roles, permissions,
message templates and workflow settings, and **one** admin — and only when the user table is
empty. It never creates demo accounts or demo data. (Never run `pnpm db:seed`: that is the
development seed, and it refuses to run in production anyway.)

```bash
cd ~/wilp-hmp
set -a; . apps/web/.env.production; set +a
read -rp 'Admin email: ' ADMIN_EMAIL; export ADMIN_EMAIL
read -rsp 'Admin password (not shown): ' P; echo
export ADMIN_INITIAL_PASSWORD_HASH="$(cd packages/db && node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" "$P")"
unset P
pnpm --filter @hmp/db db:seed:prod                      # "[seed:prod] created admin … + RBAC/template/config scaffolding."
unset ADMIN_INITIAL_PASSWORD_HASH
```

## 5. nginx behind the load balancer

```bash
sudo tee /etc/nginx/sites-available/hmp >/dev/null <<'EOF'
upstream hmp_web { server 127.0.0.1:3000; keepalive 32; }

server {
    listen 80 default_server;
    server_name hmp.wilp-connect.net;

    # The ALB is the client nginx sees; trust its X-Forwarded-For so every user keeps
    # their own IP (the login limiter counts per IP — without this, all users share the
    # ALB's address and a few wrong passwords would lock everyone out).
    set_real_ip_from <VPC_CIDR>;          # e.g. 172.31.0.0/16 — ask IT
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    client_max_body_size 10m;
    gzip on; gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    location /_next/static/ {
        proxy_pass http://hmp_web;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://hmp_web;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;               # the user's IP (after real_ip)
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;    # "https" from the ALB → Secure cookies
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_buffering off;                                           # live notifications stream
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/hmp /etc/nginx/sites-enabled/hmp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Run HMP as a service (restarts on failure and on reboot)

```bash
sudo tee /etc/systemd/system/hmp-web.service >/dev/null <<'EOF'
[Unit]
Description=HMP web (Next.js)
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/wilp-hmp/apps/web
EnvironmentFile=/home/ubuntu/wilp-hmp/apps/web/.env.production
Environment=NODE_ENV=production
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now hmp-web
sleep 8 && systemctl status hmp-web --no-pager | head -5    # active (running)
curl -s http://127.0.0.1:3000/api/health; echo             # {"status":"ok","db":"connected","redis":"connected",…}
```

Logs: `journalctl -u hmp-web -n 100 --no-pager`. Daily overdue reminders (optional):

```bash
sudo tee /etc/systemd/system/hmp-reminders.service >/dev/null <<'EOF'
[Unit]
Description=HMP daily reminders
[Service]
Type=oneshot
EnvironmentFile=/home/ubuntu/wilp-hmp/apps/web/.env.production
ExecStart=/bin/sh -c 'curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/reminders'
EOF
sudo tee /etc/systemd/system/hmp-reminders.timer >/dev/null <<'EOF'
[Unit]
Description=Run HMP reminders daily at 09:00 IST
[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now hmp-reminders.timer
```

## 7. Old pilot data

**Decide first: does the old pilot's database hold real data** (real users, requests, handouts)?

- **No** → start fresh; skip this section.
- **Yes** → copy it into the new database **before** step 4b's `migrate deploy` (the migrations
  then bring it up to v1.0.0), and skip 4c (its users already exist):

The old database address comes from the old pilot's own settings file (kept in `~/wilp-hmp-old`
by step 1b; on a different box, copy that file over first). You don't type the old credentials.

```bash
# 1. Which settings files hold a database address (password shown as ****):
grep -H '^DATABASE_URL' ~/wilp-hmp-old/apps/web/.env* ~/wilp-hmp-old/.env* 2>/dev/null \
  | sed -E 's#(://[^:/@]+:)[^@]*@#\1****@#'
# 2. Pick the file the old site ran with (normally apps/web/.env.production — change if the list shows otherwise):
OLD_ENV=~/wilp-hmp-old/apps/web/.env.production
OLD_URL="$(grep -h '^DATABASE_URL' "$OLD_ENV" | head -1 | cut -d= -f2- | tr -d "'\"")"
# 3. psql/pg_dump reject Prisma's "?schema=public": keep only the part before "?".
#    (No sslmode added: psql uses SSL whenever the server offers it.)
OLD="${OLD_URL%%\?*}"
echo "$OLD" | sed -E 's#(://[^:/@]+:)[^@]*@#\1****@#'      # the address you'll copy from, password hidden
psql "$OLD" -tAc 'select 1'                                # must print 1

# Old database: a read-only dump (nothing is changed there)
pg_dump -Fc --no-owner --no-acl "$OLD" -f ~/old-pilot.dump
ls -lh ~/old-pilot.dump
# New (empty) database
set -a; . ~/wilp-hmp/apps/web/.env.production; set +a
NEW="${DATABASE_URL%%\?*}?sslmode=require"
pg_restore --no-owner --no-acl -d "$NEW" ~/old-pilot.dump
# Check: the same counts on both sides
for DB in "$OLD" "$NEW"; do
  for T in User HandoutRequest HandoutVersion; do
    echo "$T $(psql "$DB" -tAc "select count(*) from \"$T\"")"
  done; echo ---
done
unset OLD_URL OLD NEW
```

Then continue with 4b. Afterwards run the default-password check from
`docs/hotfix-login-sme-access.md` §8 — the old pilot listed demo accounts publicly.

## 8. Check script

```bash
cd ~/wilp-hmp && bash scripts/deploy/check.sh
```

Prints the versions, **whether** each required setting is set (never the value), a database
connection over SSL, an S3 write + read (and whether publishing can check the bucket), and the
health of the app locally and through the public address.

## 9. Checks after install (all must pass before go-live — or, on a different box, before switching off the old pilot)

```bash
curl -sI https://hmp.wilp-connect.net/login | grep -iE '^(HTTP|location)'   # 200, and no Location with an IP
curl -sI https://hmp.wilp-connect.net/ | grep -i '^location'                 # → /login on hmp.wilp-connect.net, never 13.201.161.6
curl -s https://hmp.wilp-connect.net/login | grep -cE 'password is|@hmp\.local'   # 0 — no demo accounts
curl -s https://hmp.wilp-connect.net/api/health; echo                        # "status":"ok"
```

In a browser (private window):

1. Sign in as the admin → Admin overview opens; the address bar stays on hmp.wilp-connect.net.
2. Create an SME, a faculty member and a test request (Admin → Users; IC → New request), allocate
   it with a **different** SME, then sign in as the first SME and open
   `https://hmp.wilp-connect.net/sme/review/<request id>` → **"You don't have access to this page"**.
3. Word / PDF download on an approved handout (faculty or IC) → both files open.
4. `check.sh` shows the S3 write/read as OK.
5. Remove the test accounts (Admin → Users → Deactivate).

## 10. Rollback

- **Different box, before go-live** (the old pilot is still serving): nothing to undo for users;
  fix and re-run.
- **Same box — bring the old pilot back** (uses what step 1b kept; v1.0.0 is set aside, not
  deleted):

  ```bash
  sudo systemctl disable --now hmp-web
  mv ~/wilp-hmp ~/wilp-hmp-v1 && mv ~/wilp-hmp-old ~/wilp-hmp
  sudo mv /etc/nginx /etc/nginx-v1 && sudo tar xzf ~/nginx-old.tgz -C /   # old nginx site, exactly as it was
  sudo nginx -t && sudo systemctl reload nginx
  cp ~/pm2-dump-old.pm2 ~/.pm2/dump.pm2 && pm2 resurrect && pm2 list   # old app running again
  pm2 startup systemd                                                  # run the `sudo …` line it prints
  ```

  The old site comes back **with its demo-account login page**, so only do this to recover, and
  first change the passwords of every account that page lists (or deactivate them).

- **App release** (later versions): `cd ~/wilp-hmp && git checkout <previous tag> && pnpm install
--frozen-lockfile && pnpm --filter @hmp/db exec prisma generate && pnpm --filter @hmp/web build &&
sudo systemctl restart hmp-web`.
- **Database:** RDS → Snapshots → `hmp-before-v1-0-0` → Restore (to a new instance), point
  `DATABASE_URL` at it, restart. Only needed if a migration or a data copy went wrong.
- **Whole server (different box only):** ask IT to point the ALB target back at the old pilot
  instance.

## After go-live — ask IT

- Rotate everything that was shared over chat: a new S3 access key (disable the old one), a new
  RDS master password, a new SSH key; update `.env.production` once and
  `sudo systemctl restart hmp-web`.
- Security group: SSH (22) only from the office IP; port 80 only from the ALB.
- ALB health check on `/login` (see §0).
- Same box: once v1.0.0 has run cleanly for a week, `~/wilp-hmp-old`, `~/pm2-dump-old.pm2`,
  `~/nginx-old.tgz` and `~/old-pilot.dump` can be deleted (the dump holds user data — don't keep it
  around).
