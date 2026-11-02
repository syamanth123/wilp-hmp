#!/usr/bin/env bash
#
# HMP server check — run on the EC2 host as `ubuntu` after install or any change:
#
#   bash scripts/deploy/check.sh [path/to/.env.production]
#
# Prints versions, WHETHER each required setting is set (never a value), a database
# connection over SSL, an S3 write + read, and the app's health (local and public).
# Read-only apart from one small S3 object under healthcheck/ (overwritten each run;
# the bucket denies Delete). Exit code 0 = everything OK, 1 = something needs attention.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-$REPO/apps/web/.env.production}"
# Absolute path: the S3 step runs from another folder.
[ -f "$ENV_FILE" ] && ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
PUBLIC_URL="${PUBLIC_URL:-https://hmp.wilp-connect.net}"
FAIL=0

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=1; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
head_() { printf '\n== %s ==\n' "$*"; }

# Runs node with the env file loaded (Node's own parser: values never reach the shell).
node_env() { node --env-file="$ENV_FILE" "$@"; }

head_ "Versions"
echo "  $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
for cmd in "node -v" "pnpm -v" "nginx -v" "psql --version" "redis-cli --version" "soffice --version"; do
  bin="${cmd%% *}"
  if command -v "$bin" >/dev/null 2>&1; then
    printf '  %-10s %s\n' "$bin" "$($cmd 2>&1 | head -1)"
  else
    bad "$bin is not installed"
  fi
done
printf '  %-10s %s\n' "code" "$(git -C "$REPO" describe --tags --always 2>/dev/null) ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"

head_ "Settings in $ENV_FILE (set or not — values are never printed)"
if [ ! -f "$ENV_FILE" ]; then
  bad "settings file not found"
  echo; echo "RESULT: FAIL"; exit 1
fi
perm="$(stat -c '%a' "$ENV_FILE")"
[ "$perm" = "600" ] && ok "file permissions 600" || warn "file permissions $perm (run: chmod 600 $ENV_FILE)"

node_env -e '
const required = ["DATABASE_URL","NEXTAUTH_URL","NEXTAUTH_SECRET","APP_BASE_URL","REDIS_URL",
  "S3_REGION","S3_ACCESS_KEY","S3_SECRET_KEY","HANDOUT_ATTACHMENTS_BUCKET","LMS_EXPORTS_BUCKET",
  "CRON_SECRET","SOFFICE_BIN"];
const optional = ["SMTP_HOST","SMTP_USER","SMTP_PASS","SMTP_FROM"];
let fail = 0;
const line = (s, t) => console.log(`  ${s.padEnd(5)} ${t}`);
for (const k of required) { const set = !!(process.env[k] ?? "").trim(); if (!set) fail = 1; line(set ? "OK" : "FAIL", `${k} ${set ? "set" : "MISSING"}`); }
for (const k of optional) { const set = !!(process.env[k] ?? "").trim(); line(set ? "OK" : "WARN", `${k} ${set ? "set" : "not set (emails are skipped)"}`); }
const url = process.env.NEXTAUTH_URL ?? "";
const goodUrl = /^https:\/\/[a-z]/i.test(url) && !/\d+\.\d+\.\d+\.\d+/.test(url) && url === (process.env.APP_BASE_URL ?? "");
line(goodUrl ? "OK" : "FAIL", "NEXTAUTH_URL and APP_BASE_URL are the same https domain (no IP)"); if (!goodUrl) fail = 1;
const db = process.env.DATABASE_URL ?? "";
const ssl = /sslmode=require/.test(db);
line(ssl ? "OK" : "FAIL", "DATABASE_URL has sslmode=require"); if (!ssl) fail = 1;
const demo = (process.env.SHOW_DEMO_LOGINS ?? "").trim().toLowerCase() === "true";
line(demo ? "FAIL" : "OK", demo ? "SHOW_DEMO_LOGINS is on — remove it" : "SHOW_DEMO_LOGINS off"); if (demo) fail = 1;
const ai = (process.env.AI_FEATURES_ENABLED ?? "").trim().toLowerCase() === "true";
line(ai ? "WARN" : "OK", ai ? "AI_FEATURES_ENABLED is on" : "AI_FEATURES_ENABLED off");
process.exit(fail);
' || FAIL=1

head_ "Database (SSL)"
if command -v psql >/dev/null 2>&1; then
  # psql doesn't understand Prisma's ?schema= parameter: keep only the address + sslmode.
  if out="$(node_env -e 'process.stdout.write((process.env.DATABASE_URL||"").split("?")[0] + "?sslmode=require")' \
      | { read -r u; psql "$u" -tAc "select version(), (select ssl from pg_stat_ssl where pid = pg_backend_pid())" 2>&1; })"; then
    ver="$(echo "$out" | cut -d'|' -f1 | awk '{print $1, $2}')"
    sslon="$(echo "$out" | cut -d'|' -f2)"
    [ "$sslon" = "t" ] && ok "connected to $ver, SSL on" || bad "connected to $ver but SSL is OFF"
  else
    bad "cannot connect: $(echo "$out" | head -1)"
  fi
else
  bad "psql missing (sudo apt install -y postgresql-client-16)"
fi

head_ "Redis"
if redis-cli -u "$(node_env -e 'process.stdout.write(process.env.REDIS_URL||"redis://127.0.0.1:6379")')" ping 2>/dev/null | grep -q PONG; then
  ok "Redis answers"
else
  bad "Redis doesn't answer (sudo systemctl status redis-server)"
fi

head_ "S3 (bucket write + read)"
( cd "$REPO/packages/integrations" && node --env-file="$ENV_FILE" --input-type=module -e '
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { hostname } from "node:os";
const bucket = process.env.LMS_EXPORTS_BUCKET;
const s3 = new S3Client({
  region: process.env.S3_REGION,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } }
    : {}),
});
const key = `healthcheck/${hostname()}.txt`;
const body = `HMP check ${new Date().toISOString()}`;
let fail = 0;
try {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }));
  const got = await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToString();
  console.log(got === body ? `  OK    write + read ${bucket}/${key}` : "  FAIL  read back different content");
  if (got !== body) fail = 1;
} catch (e) {
  const why = `${e.name}: ${String(e.message ?? "").slice(0, 100)}`;
  console.log(`  FAIL  write/read: ${why}`);
  fail = 1;
}
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("  OK    bucket check allowed (s3:ListBucket) — Taxila export publishing can run");
} catch (e) {
  console.log(`  WARN  bucket check refused (${e.name}) — Taxila export publishing needs s3:ListBucket from IT`);
}
process.exit(fail);
' ) || FAIL=1

head_ "App health"
code="$(curl -s -o /tmp/hmp-health.$$ -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/health || true)"; code="${code:-000}"
[ "$code" = "200" ] && ok "local /api/health 200 $(cat /tmp/hmp-health.$$)" \
  || bad "local /api/health HTTP $code $(cat /tmp/hmp-health.$$ 2>/dev/null) (journalctl -u hmp-web -n 50)"
rm -f /tmp/hmp-health.$$
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: hmp.wilp-connect.net' http://127.0.0.1/login || true)"; code="${code:-000}"
[ "$code" = "200" ] && ok "nginx → app /login 200" || bad "nginx → app /login HTTP $code (sudo nginx -t; systemctl status nginx)"

pub="$(curl -sI --max-time 10 "$PUBLIC_URL/" || true)"
if [ -z "$pub" ]; then
  warn "$PUBLIC_URL not reachable from this server (normal if outbound to the ALB is blocked)"
else
  loc="$(echo "$pub" | grep -i '^location:' | tr -d '\r')"
  if echo "$loc" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then bad "public redirect goes to an IP: $loc"
  else ok "public redirect stays on the domain (${loc:-no redirect})"; fi
  if curl -s --max-time 10 "$PUBLIC_URL/login" | grep -qE 'password is|@hmp\.local'; then
    bad "public login page lists demo accounts"
  else
    ok "public login page lists no demo accounts"
  fi
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "RESULT: OK"; else echo "RESULT: FAIL — see the lines marked FAIL"; fi
exit "$FAIL"
