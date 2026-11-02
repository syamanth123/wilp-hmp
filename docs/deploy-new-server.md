# Install HMP v1.0.0 on the "Handout" server — upgrade in place

For the person upgrading HMP on the EC2 instance "Handout" (Ubuntu, t3a.medium, 4 GB RAM, 20 GB
disk, Elastic IP 13.201.161.6, ap-south-1) behind the AWS load balancer that serves
**https://hmp.wilp-connect.net**. Every command is copy-paste, run in the SSH session as `ubuntu`.
Anything in `<ANGLE_BRACKETS>` is a value you type yourself — **never** put a real secret in a file
inside the repo or in a chat.

**What this server is (checked 2 Nov 2026).** "Handout" **is the old pilot box**, and the RDS
database "handout" is the **pilot's own database** — 11 team test accounts, 4 requests, no demo
accounts. So this is an **upgrade in place**: v1.0.0 is built in a new folder while the pilot keeps
serving, and the pilot is stopped only for the switch in §6 (a minute or two of downtime). Existing
users and requests are kept. (For a truly new, empty server see Appendix A.)

```
browser ──https──▶ ALB (TLS ends here) ──http──▶ nginx :80 on EC2 ──▶ Next.js 127.0.0.1:3000
                                                                    ├─▶ RDS PostgreSQL 16 (SSL)
                                                                    ├─▶ S3 handout-09-07-2026
                                                                    └─▶ Redis 127.0.0.1:6379
```

## 0. Before you start

- **On the box today:** pm2 runs `hmp-web` (Next on `*:3000`) and `hmp-worker`; code in
  `~/wilp-hmp` with settings in `~/wilp-hmp/apps/web/.env.production`; nginx site `hmp` on :80;
  Redis on 127.0.0.1:6379; folders `~/corpus`, `~/logs` and `~/hmp-saml`.
- **Never touch `~/hmp-saml`** (the BITS-SSO key pair — a new key breaks SSO until IT re-registers
  it), **`~/corpus`** or **`~/logs`**. Nothing in this guide moves or deletes them.
- **From IT:** the **VPC CIDR** (§5 needs it — the server's private address is 192.168.1.57, so it
  is probably inside `192.168.0.0/16`; use IT's exact value), the ALB **target port** (this guide
  uses **80**) and an ALB **health-check path of `/login`** (not `/api/health`, which answers 503
  while Redis is down — with one server, that would take the whole site out).
- **Know an admin password** for one of the existing accounts — no new admin is created.
- Connect: `ssh -i C:\work\secrets\Handout.pem ubuntu@13.201.161.6`.

Steps 1–5 run **while the pilot keeps serving** (~30 min, mostly the build). Step 6 is the switch.

## 1. Prepare the box (pilot keeps running)

**1a. Room, swap, packages**

```bash
df -h ~ | tail -1                         # need ≥ 5 GB free (a second copy of the app is built)
[ -f /swapfile ] || { sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab; }
free -h                                   # a Swap line of ~2.0Gi (so the build doesn't run out of memory)

node -v                                   # v20.x or newer → skip the next two lines
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm -v                                   # 9.12.0

# Word→PDF export, database client, web server, Redis (most are already there)
sudo apt update
sudo apt install -y libreoffice-writer-nogui fonts-dejavu nginx redis-server git curl
sudo apt install -y postgresql-client-16 || sudo apt install -y postgresql-client
sudo systemctl enable --now redis-server && redis-cli ping     # PONG
```

**1b. Back up the pilot's setup** (used by the rollback in §10; holds secrets, so owner-only)

```bash
mkdir -p ~/pilot-backup && chmod 700 ~/pilot-backup
cp -p ~/wilp-hmp/apps/web/.env.production ~/pilot-backup/env.production
sudo tar czf ~/pilot-backup/nginx.tgz -C / etc/nginx && sudo chown ubuntu: ~/pilot-backup/nginx.tgz
git -C ~/wilp-hmp log -1 --format='pilot code: %h %ad %s' --date=short | tee ~/pilot-backup/pilot-version.txt
```

**1c. Code — exactly v1.0.0, in its own folder**

```bash
cd ~ && git clone https://github.com/syamanth123/wilp-hmp.git hmp-v1.0.0 && cd hmp-v1.0.0
git checkout v1.0.0 && git log -1 --oneline
```

## 2. Settings — carried over from the pilot, nothing retyped

```bash
cd ~/hmp-v1.0.0
node scripts/deploy/carry-over-env.mjs ~/wilp-hmp/apps/web/.env.production apps/web/.env.production
chmod 600 apps/web/.env.production
grep -n '<' apps/web/.env.production | grep -v 'no-reply@'     # must print nothing
```

The script prints only setting **names** and what happened to each — values are never shown:

- **kept:** everything the pilot had — the database address, `NEXTAUTH_SECRET`, the S3 keys, a
  real SMTP account, `CRON_SECRET`, `HMP_CORPUS_DIR` (so `~/corpus` stays in use), …
- **set for v1.0.0:** `NEXTAUTH_URL` and `APP_BASE_URL` = `https://hmp.wilp-connect.net`,
  `AUTH_TRUST_HOST=true`, `AI_FEATURES_ENABLED=false`, `PASSWORD_LOGIN_ENABLED=true`,
  `NODE_ENV=production`, region `ap-south-1`, both buckets `handout-09-07-2026`;
  `sslmode=require` added to the database address if it was missing.
- **removed:** `SHOW_DEMO_LOGINS`, `WORKERS_ENABLED` (the worker is retired — emails are sent
  during the request), `AUTH_URL` (it would override `NEXTAUTH_URL`), and the SMTP lines if the
  host was blank or a `<…>` placeholder (the app would try to connect to it).
- **added if missing:** `REDIS_URL`, `SOFFICE_BIN`, a new `CRON_SECRET`.
- A **MISSING** or **ERROR** line means: stop and fix that one setting by hand
  (`nano apps/web/.env.production`, one `KEY='value'` per line). It refuses to overwrite an
  existing file — delete it first to run it again.

Notes:

- **The redirect fix.** The sign-in system builds every link and redirect from `NEXTAUTH_URL`; the
  pilot had `http://13.201.161.6`, so the domain bounced to the IP. With the https domain (and
  `AUTH_TRUST_HOST`, honouring the load balancer's `X-Forwarded-*` headers that nginx passes on in
  §5) links stay on the domain and sign-in cookies are marked `Secure`.
- **Everyone signs in once more after the switch.** `NEXTAUTH_SECRET` is kept, but the sign-in
  cookie's name changes when the address becomes https, so old pilot sessions don't carry over.
- **No SMTP account → no email lines.** With no `SMTP_HOST` the app skips emails (it logs them)
  and works normally. To add an account later, add `SMTP_HOST`, `SMTP_PORT='587'`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM='HMP <no-reply@wilp-connect.net>'` and restart (`sudo systemctl restart
hmp-web`).
- **No overwrites in the shared bucket:** attachments go under `attachments/<request>/<random id>`,
  Taxila exports under `lms-exports/<year>/<HMP-ref>.zip`; the check script writes only under
  `healthcheck/`.
- **`PASSWORD_LOGIN_ENABLED`** has no effect in v1.0.0 (password login is the only sign-in); it is
  set now so the later BITS-SSO release keeps password login on until SSO is tested.

**Redis stays, the worker goes.** Without Redis, login rate limiting is off, `/api/health` answers
503 and Admin → Background jobs says jobs aren't running. The pilot's `hmp-worker` is not needed:
with `WORKERS_ENABLED` unset, emails are sent during the request, and with AI off there are no AI
jobs.

## 3. S3 permissions (Get and Put only; Delete denied)

| Feature                                  | Needs                                                                                                                       | With IT's current policy                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Taxila export ZIP (publishing, "Mode B") | `s3:PutObject`, `s3:GetObject` (download link) **and `s3:ListBucket`** (the code checks the bucket exists before uploading) | **Fails until `s3:ListBucket` is granted** — without it the code tries to create the bucket, which is denied |
| Attachments (upload / download)          | `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`                                                                             | **Switched off in v1.0.0** (no upload button; upload route answers 501)                                      |
| Attachments (remove)                     | `s3:DeleteObject`                                                                                                           | off                                                                                                          |
| Attachments (archive tagging)            | `s3:PutObjectTagging`, `s3:GetObjectTagging`                                                                                | off (nothing to tag while attachments are off)                                                               |
| Word / PDF download                      | none (built in memory)                                                                                                      | works                                                                                                        |

Ask IT for **`s3:ListBucket` on `arn:aws:s3:::handout-09-07-2026`** (needed for publishing). The
rest only when attachments are switched on.

## 4. Install, build and pre-check (pilot keeps running)

```bash
cd ~/hmp-v1.0.0
pnpm install --frozen-lockfile
pnpm --filter @hmp/db exec prisma generate
pnpm --filter @hmp/web build                            # ~5–8 min

set -a; . apps/web/.env.production; set +a
DB="${DATABASE_URL%%\?*}?sslmode=require"               # psql rejects Prisma's ?schema=public
psql "$DB" -tAc 'select 1'                              # must print 1
pnpm --filter @hmp/db exec prisma migrate status        # see below
for T in User HandoutRequest HandoutVersion; do echo "$T $(psql "$DB" -tAc "select count(*) from \"$T\"")"; done \
  | tee ~/pilot-backup/counts-before.txt               # User 11, HandoutRequest 4, …
```

`migrate status` must list **exactly two** migrations not yet applied —
`20260929120000_add_course_dibba` and `20261001140000_academic_term_year_term_unique`. Both only
**add** new tables and an index on a new table: nothing existing is changed, so they can't fail on
the pilot's data, and the pilot's code still works with them applied (that's what makes the
rollback in §10 simple). **If it lists anything else, stop** and send the output before going on.

## 5. nginx behind the load balancer (pilot keeps running)

This replaces the pilot's site `hmp` (backed up in 1b). It proxies to the same port 3000, so the
pilot keeps serving through it, and the switch in §6 needs no nginx change.

```bash
sudo tee /etc/nginx/sites-available/hmp >/dev/null <<'EOF'
upstream hmp_web { server 127.0.0.1:3000; keepalive 32; }

server {
    listen 80 default_server;
    server_name hmp.wilp-connect.net;

    # The ALB is the client nginx sees; trust its X-Forwarded-For so every user keeps
    # their own IP (the login limiter counts per IP — without this, all users share the
    # ALB's address and a few wrong passwords would lock everyone out).
    set_real_ip_from <VPC_CIDR>;          # from IT, e.g. 192.168.0.0/16
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
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: hmp.wilp-connect.net' http://127.0.0.1/login   # 200 (still the pilot)
```

The service that will run v1.0.0 — written now, **started in §6**:

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
```

## 6. The switch (downtime starts at 6b, ends at 6e — a minute or two)

**6a. RDS snapshot — mandatory, it is the undo button for the database.** AWS console → RDS →
Databases → **handout** → Actions → Take snapshot → name `hmp-before-v1-0-0`. **Wait until its
status is "Available"** (a few minutes) before 6b. The pilot is still serving meanwhile.

```bash
# 6b. Stop the pilot (stop, not delete — §10 can start it again)
pm2 save && cp ~/.pm2/dump.pm2 ~/pilot-backup/pm2-dump.pm2
pm2 stop hmp-web hmp-worker
pm2 unstartup systemd            # run the `sudo …` line it prints (so pm2 doesn't start the pilot on reboot)

# 6c. Bring the database up to v1.0.0 (the two migrations from §4)
cd ~/hmp-v1.0.0 && set -a; . apps/web/.env.production; set +a
pnpm --filter @hmp/db exec prisma migrate deploy        # "All migrations have been successfully applied."

# 6d. ~/wilp-hmp now points at v1.0.0; the pilot's folder is kept as ~/wilp-hmp-pilot
mv ~/wilp-hmp ~/wilp-hmp-pilot && ln -s ~/hmp-v1.0.0 ~/wilp-hmp && ls -l ~/wilp-hmp

# 6e. Start v1.0.0 (restarts on failure and on reboot)
sudo systemctl enable --now hmp-web
sleep 8 && systemctl status hmp-web --no-pager | head -5    # active (running)
curl -s http://127.0.0.1:3000/api/health; echo             # {"status":"ok","db":"connected","redis":"connected",…}

# 6f. Same rows as before the switch
DB="${DATABASE_URL%%\?*}?sslmode=require"
for T in User HandoutRequest HandoutVersion; do echo "$T $(psql "$DB" -tAc "select count(*) from \"$T\"")"; done \
  | diff ~/pilot-backup/counts-before.txt - && echo "counts unchanged"
```

If 6e doesn't come up: `journalctl -u hmp-web -n 100 --no-pager`; to go back, §10.

Daily overdue reminders (optional, any time after 6e):

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

## 7. Check script

```bash
cd ~/wilp-hmp && bash scripts/deploy/check.sh
```

Prints the versions, **whether** each required setting is set (never the value), a database
connection over SSL, an S3 write + read (and whether publishing can check the bucket), and the
health of the app locally and through the public address. `RESULT: OK` is the goal; the
`s3:ListBucket` line stays a WARN until IT grants it.

## 8. Checks after the switch

```bash
curl -sI https://hmp.wilp-connect.net/login | grep -iE '^(HTTP|location)'   # 200, and no Location with an IP
curl -sI https://hmp.wilp-connect.net/ | grep -i '^location'                 # → /login on hmp.wilp-connect.net, never 13.201.161.6
curl -s https://hmp.wilp-connect.net/login | grep -cE 'password is|@hmp\.local'   # 0 — no demo accounts
curl -s https://hmp.wilp-connect.net/api/health; echo                        # "status":"ok"
```

Then the **default-password check** from `docs/hotfix-login-sme-access.md` §8 (read-only): the
pilot's old add-user form pre-filled the password `password`, so some of the 11 accounts may still
have it. The portal has no change-password screen yet, so **deactivate** every account it lists
(Admin → Users → Deactivate — they are all test accounts) before telling anyone the site is live;
if one of them must stay, ask for a one-off reset script.

In a browser (private window):

1. Sign in with an existing admin account → Admin overview; the address bar stays on
   hmp.wilp-connect.net. The 4 pilot requests are there.
2. Create an SME, a faculty member and a test request (Admin → Users; IC → New request), allocate
   it with a **different** SME, then sign in as the first SME and open
   `https://hmp.wilp-connect.net/sme/review/<request id>` → **"You don't have access to this page"**.
3. Word / PDF download on an approved handout (faculty or IC) → both files open.
4. Remove the test accounts (Admin → Users → Deactivate).

## 9. Later releases

Same pattern, same short downtime: clone the new tag into `~/hmp-<version>`, copy the settings
(`cp -p ~/wilp-hmp/apps/web/.env.production ~/hmp-<version>/apps/web/`), install + build there,
snapshot, `migrate deploy`, then `ln -sfn ~/hmp-<version> ~/wilp-hmp && sudo systemctl restart
hmp-web`. Going back = point the link at the previous folder and restart.

## 10. Rollback

**Back to the pilot** (v1.0.0 is set aside, not deleted). The database can stay as it is: v1.0.0's
two migrations only added tables, which the pilot ignores.

```bash
sudo systemctl disable --now hmp-web
[ -L ~/wilp-hmp ] && rm ~/wilp-hmp && mv ~/wilp-hmp-pilot ~/wilp-hmp    # rm removes only the link
sudo mv /etc/nginx /etc/nginx-v1 && sudo tar xzf ~/pilot-backup/nginx.tgz -C /   # pilot's nginx, exactly as it was
sudo nginx -t && sudo systemctl reload nginx
pm2 restart hmp-web hmp-worker || { cp ~/pilot-backup/pm2-dump.pm2 ~/.pm2/dump.pm2 && pm2 resurrect; }
pm2 list                                                              # both online
pm2 startup systemd                                                   # run the `sudo …` line it prints
```

The pilot's login page shows its demo-account list again; those accounts don't exist in the
database, so the list opens nothing — but get v1.0.0 back up soon.

**Database** — only if `migrate deploy` or later use damaged data: RDS → Snapshots →
`hmp-before-v1-0-0` → Restore snapshot. That creates a **new** instance with its own endpoint; put
that endpoint in `DATABASE_URL` (`nano ~/wilp-hmp/apps/web/.env.production`) and restart
(`sudo systemctl restart hmp-web`, or `pm2 restart hmp-web` for the pilot).

## After go-live

- **IT:** rotate what was shared over chat — a new S3 access key (disable the old one), a new RDS
  master password, a new SSH key; then update `.env.production` once and `sudo systemctl restart
hmp-web`. Security group: SSH (22) only from the office IP; port 80 only from the ALB; the old
  `*:3000` exposure is gone (v1.0.0 listens on 127.0.0.1 only). ALB health check on `/login`.
- **Accounts:** deactivate the test accounts real users won't need (Admin → Users), including the
  two student-ID addresses.
- **After a week of clean running:** delete `~/wilp-hmp-pilot` and `~/pilot-backup` (it holds a
  copy of the pilot's secrets and pm2 environment), and `pm2 kill` to retire pm2.
- **Never delete `~/hmp-saml`.** If the server is ever rebuilt, copy that folder across first.

## Appendix A — a truly new, empty server

Use the steps above with these differences:

- Skip 1b, §6b and §10's "back to the pilot". Clone straight into `~/wilp-hmp` (no link needed)
  and adjust the paths.
- **Settings by hand** instead of the carry-over script — create `apps/web/.env.production` with
  single-quoted values and replace every `<…>`:

  ```
  NEXTAUTH_URL='https://hmp.wilp-connect.net'
  APP_BASE_URL='https://hmp.wilp-connect.net'
  AUTH_TRUST_HOST='true'
  NEXTAUTH_SECRET='<OUTPUT_OF: openssl rand -base64 32>'
  DATABASE_URL='postgresql://<RDS_USER>:<RDS_PASSWORD_URL_ENCODED>@<RDS_ENDPOINT>:5432/<DB_NAME>?schema=public&sslmode=require'
  S3_REGION='ap-south-1'
  S3_ACCESS_KEY='<ACCESS_KEY_ID_FROM_CSV>'
  S3_SECRET_KEY='<SECRET_ACCESS_KEY_FROM_CSV>'
  HANDOUT_ATTACHMENTS_BUCKET='handout-09-07-2026'
  LMS_EXPORTS_BUCKET='handout-09-07-2026'
  REDIS_URL='redis://127.0.0.1:6379'
  AI_FEATURES_ENABLED='false'
  PASSWORD_LOGIN_ENABLED='true'
  SOFFICE_BIN='soffice'
  CRON_SECRET='<OUTPUT_OF: openssl rand -hex 24>'
  NODE_ENV='production'
  ```

  URL-encode the database password first:
  `node -e "console.log(encodeURIComponent(process.argv[1]))" '<RDS_PASSWORD>'`. If the database
  doesn't exist yet: `psql "postgresql://<RDS_USER>:<RDS_PASSWORD_URL_ENCODED>@<RDS_ENDPOINT>:5432/postgres?sslmode=require" -c 'CREATE DATABASE <DB_NAME>;'`.

- **One admin account, nothing else** (after `migrate deploy`; only works on an empty user table,
  never creates demo data):

  ```bash
  cd ~/wilp-hmp && set -a; . apps/web/.env.production; set +a
  read -rp 'Admin email: ' ADMIN_EMAIL; export ADMIN_EMAIL
  read -rsp 'Admin password (not shown): ' P; echo
  export ADMIN_INITIAL_PASSWORD_HASH="$(cd packages/db && node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" "$P")"
  unset P
  pnpm --filter @hmp/db db:seed:prod                    # "[seed:prod] created admin … + RBAC/template/config scaffolding."
  unset ADMIN_INITIAL_PASSWORD_HASH
  ```

- **Copying data from another database** (before `migrate deploy`): take the old address from the
  old settings file without showing the password, then dump and restore:

  ```bash
  OLD_URL="$(grep -h '^DATABASE_URL' <OLD_SETTINGS_FILE> | head -1 | cut -d= -f2- | tr -d "'\"")"
  OLD="${OLD_URL%%\?*}"                                       # psql/pg_dump reject ?schema=public
  echo "$OLD" | sed -E 's#(://[^:/@]+:)[^@]*@#\1****@#'      # check the address, password hidden
  pg_dump -Fc --no-owner --no-acl "$OLD" -f ~/old.dump
  set -a; . ~/wilp-hmp/apps/web/.env.production; set +a
  pg_restore --no-owner --no-acl -d "${DATABASE_URL%%\?*}?sslmode=require" ~/old.dump
  ```

  Compare `User`, `HandoutRequest` and `HandoutVersion` counts on both sides, skip the admin
  seed, and delete `~/old.dump` afterwards (it holds user data).
