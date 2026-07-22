#!/usr/bin/env bash
#
# HMP production deploy — run on the EC2 host as the `ubuntu` user.
#
#   ./deploy/deploy.sh              # full deploy (install + generate + migrate + build + reload)
#   ./deploy/deploy.sh --help       # usage
#
# Idempotent and safe to re-run. Fails fast on any error. Writes a full,
# timestamped log to /home/ubuntu/logs/deploy-<ts>.log so a non-developer can
# read whether the deploy worked. Ends with a clear DEPLOY SUCCESSFUL / DEPLOY
# FAILED line.
#
# It does NOT auto-rollback: a failed `prisma migrate deploy` leaves the DB in a
# state only the operator should resolve — on failure the script PRINTS the
# rollback commands for the operator to run deliberately.

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────
REPO="/home/ubuntu/wilp-hmp"
LOGS="/home/ubuntu/logs"
ENV_FILE="${REPO}/apps/web/.env.production"
ECOSYSTEM="${REPO}/deploy/ecosystem.config.cjs"
REQUIRED_ENV_KEYS=(REDIS_URL DATABASE_URL NEXTAUTH_SECRET NEXTAUTH_URL APP_BASE_URL)
PM2_PROCS=(hmp-web hmp-worker)

# ── Flags ────────────────────────────────────────────────────────────────────
SKIP_DEPS=0
SKIP_BUILD=0
SKIP_MIGRATE=0

usage() {
  cat <<'EOF'
HMP deploy script

Usage: ./deploy/deploy.sh [flags]

Flags:
  --skip-deps     skip `pnpm install`      (only code changed, deps unchanged)
  --skip-build    skip `pnpm build`        (env-only change)
  --skip-migrate  skip `prisma migrate deploy` (code hotfix, NO schema change)
  --help          show this help

  All --skip-* flags require the env var YES_I_KNOW=1 to take effect — deliberate
  friction so migrations are never skipped by accident:
      YES_I_KNOW=1 ./deploy/deploy.sh --skip-migrate
EOF
}

for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --help | -h) usage; exit 0 ;;
    *) echo "Unknown flag: $arg"; usage; exit 2 ;;
  esac
done

# ── Logging ──────────────────────────────────────────────────────────────────
mkdir -p "${LOGS}"
TS="$(date +%Y%m%d-%H%M%S)"
LOGFILE="${LOGS}/deploy-${TS}.log"
# Mirror all stdout+stderr to the log file.
exec > >(tee -a "${LOGFILE}") 2>&1

START_EPOCH="$(date +%s)"
CURRENT_STEP="startup"
OLD_SHA=""
NEW_SHA=""

ts()   { date +%H:%M:%S; }
step() { CURRENT_STEP="$1"; echo ""; echo "==> [$(ts)] $1"; }
info() { echo "    $*"; }

print_rollback() {
  echo ""
  echo "------------------------------------------------------------------------"
  echo "ROLLBACK (run manually — deploy does NOT auto-rollback):"
  echo "  cd ${REPO}"
  if [ -n "${OLD_SHA}" ]; then
    echo "  git reset --hard ${OLD_SHA}"
  else
    echo "  git reset --hard <PREVIOUS_SHA>   # (SHA was not captured before failure)"
  fi
  echo "  pnpm install --frozen-lockfile"
  echo "  pnpm --filter @hmp/db exec prisma generate"
  echo "  pnpm --filter @hmp/web build"
  echo "  pm2 reload ${ECOSYSTEM} --update-env"
  echo "  pm2 list                              # confirm hmp-web AND hmp-worker are 'online'"
  echo ""
  echo "  NOTE: if the failure was during 'prisma migrate deploy', the database"
  echo "  may be partially migrated. Do NOT blindly reset code — inspect the DB"
  echo "  and 'prisma migrate status' before deciding."
  echo "------------------------------------------------------------------------"
}

on_error() {
  local ec=$?
  echo ""
  echo "########################################################################"
  echo "==> [$(ts)] DEPLOY FAILED at step: ${CURRENT_STEP} (exit ${ec})"
  echo "########################################################################"
  # Only offer rollback once the working tree was actually moved.
  if [ -n "${OLD_SHA}" ]; then print_rollback; fi
  echo "Full log: ${LOGFILE}"
  exit "${ec}"
}
trap on_error ERR

echo "########################################################################"
echo "  HMP DEPLOY  —  ${TS}"
echo "  flags: skip-deps=${SKIP_DEPS} skip-build=${SKIP_BUILD} skip-migrate=${SKIP_MIGRATE}"
echo "  log:   ${LOGFILE}"
echo "########################################################################"

# ── Skip-flag friction guard ─────────────────────────────────────────────────
if [ "${SKIP_DEPS}${SKIP_BUILD}${SKIP_MIGRATE}" != "000" ] && [ "${YES_I_KNOW:-0}" != "1" ]; then
  echo "Refusing to honour --skip-* without YES_I_KNOW=1 (deliberate friction)."
  echo "Re-run as:  YES_I_KNOW=1 ./deploy/deploy.sh <flags>"
  exit 2
fi

# ── Preconditions ────────────────────────────────────────────────────────────
step "Preconditions"

[ "$(whoami)" = "ubuntu" ] || { echo "Must run as user 'ubuntu' (current: $(whoami))."; exit 1; }
[ -d "${REPO}/.git" ] || { echo "${REPO} is not a git repo."; exit 1; }
[ -f "${ENV_FILE}" ] || { echo "Missing ${ENV_FILE} (the real file, not the template)."; exit 1; }

for bin in node pnpm pm2 soffice; do
  command -v "${bin}" >/dev/null 2>&1 || { echo "Required binary not on PATH: ${bin}"; exit 1; }
done

# Node >= 20.6 (the --env-file flag the worker relies on).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "${NODE_MAJOR}" -lt 20 ] || { [ "${NODE_MAJOR}" -eq 20 ] && [ "${NODE_MINOR}" -lt 6 ]; }; then
  echo "Node >= 20.6 required (found $(node -v)) — worker uses node --env-file."; exit 1
fi
info "node $(node -v), pnpm $(pnpm -v), pm2 $(pm2 -v), soffice present"

# Required env keys present and non-empty (checks the KEYS, never prints values).
MISSING=0
for key in "${REQUIRED_ENV_KEYS[@]}"; do
  val="$(grep -E "^${key}=" "${ENV_FILE}" | head -1 | sed -E "s/^${key}=//; s/^\"//; s/\"$//")"
  if [ -z "${val}" ]; then echo "    MISSING/empty in .env.production: ${key}"; MISSING=1
  else info "${key}: set"; fi
done
[ "${MISSING}" -eq 0 ] || { echo "Fill the missing keys in ${ENV_FILE} and re-run."; exit 1; }
info "Preconditions OK"

# ── Deploy sequence ──────────────────────────────────────────────────────────
cd "${REPO}"

step "Fetch latest main"
OLD_SHA="$(git rev-parse HEAD)"
info "current: ${OLD_SHA}"
git fetch origin main
NEW_SHA="$(git rev-parse origin/main)"
if [ "${OLD_SHA}" = "${NEW_SHA}" ]; then
  info "already at origin/main (${NEW_SHA}) — redeploying same commit"
else
  info "updating: ${OLD_SHA} -> ${NEW_SHA}"
fi

step "Reset working tree to origin/main"
git reset --hard origin/main
info "now at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

if [ "${SKIP_DEPS}" -eq 1 ]; then
  step "Install dependencies — SKIPPED (--skip-deps)"
else
  step "Install dependencies (frozen lockfile)"
  pnpm install --frozen-lockfile
fi

step "Prisma client generate"
pnpm --filter @hmp/db exec prisma generate

if [ "${SKIP_MIGRATE}" -eq 1 ]; then
  step "Database migrations — SKIPPED (--skip-migrate)"
else
  step "Database migrations (prisma migrate deploy)"
  pnpm --filter @hmp/db exec prisma migrate deploy
fi

if [ "${SKIP_BUILD}" -eq 1 ]; then
  step "Build — SKIPPED (--skip-build)"
else
  step "Build (Next.js production)"
  pnpm --filter @hmp/web build
fi

step "Reload PM2 (graceful, --update-env)"
# Surface the deployed commit to GET /api/health (ecosystem.config.cjs reads it).
export GIT_SHA="$(git rev-parse --short HEAD)"
info "GIT_SHA=${GIT_SHA}"
pm2 reload "${ECOSYSTEM}" --update-env

# ── Process status ───────────────────────────────────────────────────────────
step "Verify processes online"
sleep 5
if ! pm2 jlist | node -e '
  const a = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const want = ["hmp-web", "hmp-worker"];
  let ok = true;
  for (const n of want) {
    const p = a.find((x) => x.name === n);
    const s = p ? p.pm2_env.status : "MISSING";
    process.stderr.write("    " + n + ": " + s + "\n");
    if (s !== "online") ok = false;
  }
  process.exit(ok ? 0 : 1);
'; then
  echo "    One or more processes are not online. Recent errors:"
  for p in "${PM2_PROCS[@]}"; do
    echo "    --- ${p}.err.log (last 30) ---"
    tail -n 30 "${LOGS}/${p}.err.log" 2>/dev/null | sed 's/^/      | /' || true
  done
  false  # trip the ERR trap → DEPLOY FAILED + rollback instructions
fi

# ── Post-deploy verification ─────────────────────────────────────────────────
step "Health check (web, up to 30s)"
HEALTHY=0
for i in $(seq 1 6); do
  code="$(curl -s -o /tmp/hmp_health.$$ -w '%{http_code}' --max-time 5 http://localhost:3000/api/health || echo 000)"
  if [ "${code}" = "200" ]; then
    info "/api/health -> 200: $(cat /tmp/hmp_health.$$ 2>/dev/null)"
    HEALTHY=1; break
  fi
  if [ "${code}" = "404" ]; then
    # /api/health not implemented yet — fall back to the root (login redirect).
    root="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/ || echo 000)"
    if [[ "${root}" =~ ^[23] ]]; then
      info "no /api/health yet; / -> ${root} (reachable) — OK"; HEALTHY=1; break
    fi
    code="${root}"
  fi
  if [[ "${code}" =~ ^5 ]]; then
    info "HTTP ${code} — app is up but erroring. Recent hmp-web errors:"
    tail -n 30 "${LOGS}/hmp-web.err.log" 2>/dev/null | sed 's/^/      | /' || true
  fi
  info "attempt ${i}/6: HTTP ${code}; retry in 5s"
  sleep 5
done
rm -f /tmp/hmp_health.$$
if [ "${HEALTHY}" -ne 1 ]; then
  echo "    Web health check FAILED. Last 40 hmp-web error lines:"
  tail -n 40 "${LOGS}/hmp-web.err.log" 2>/dev/null | sed 's/^/      | /' || true
  false
fi

step "Health check (worker)"
# Worker must be online AND have run >=30s without Redis/Postgres connection
# errors. It has no HTTP surface, so we read pm2 uptime + scan its error log.
UP_SECS="$(pm2 jlist | node -e '
  const a = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const w = a.find((x) => x.name === "hmp-worker");
  if (!w || w.pm2_env.status !== "online") { console.log(-1); process.exit(0); }
  console.log(Math.floor((Date.now() - w.pm2_env.pm_uptime) / 1000));
')"
if [ "${UP_SECS}" -lt 0 ]; then echo "    hmp-worker is not online."; false; fi
if [ "${UP_SECS}" -lt 30 ]; then
  info "worker up ${UP_SECS}s; waiting to reach 30s…"; sleep "$((30 - UP_SECS))"
fi
info "worker uptime OK (>=30s)"
if tail -n 50 "${LOGS}/hmp-worker.err.log" 2>/dev/null | grep -Eiq 'ECONNREFUSED|ETIMEDOUT|redis.*(refused|error)|can.?t reach database|connection refused|getaddrinfo'; then
  echo "    hmp-worker log shows Redis/Postgres connection errors:"
  tail -n 30 "${LOGS}/hmp-worker.err.log" | sed 's/^/      | /'
  false
fi
info "worker log clean of connection errors"

step "Scan process logs for ERROR/FATAL"
if [ "${SKIP_LOG_CHECK:-0}" = "1" ]; then
  info "SKIP_LOG_CHECK=1 — skipping (use on first deploy if noisy)"
else
  FOUND=0
  for p in "${PM2_PROCS[@]}"; do
    if tail -n 50 "${LOGS}/${p}.err.log" 2>/dev/null | grep -Eq 'ERROR|FATAL'; then
      echo "    ${p}: ERROR/FATAL in last 50 lines:"
      tail -n 50 "${LOGS}/${p}.err.log" | grep -E 'ERROR|FATAL' | sed 's/^/      | /'
      FOUND=1
    fi
  done
  if [ "${FOUND}" -eq 1 ]; then
    echo "    (may be a false positive on first deploy — re-run with SKIP_LOG_CHECK=1 to override)"
    false
  fi
  info "no ERROR/FATAL in recent logs"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START_EPOCH ))
echo ""
echo "########################################################################"
echo "  DEPLOY SUCCESSFUL"
echo "  ${OLD_SHA:0:12} -> $(git rev-parse --short HEAD)   (${ELAPSED}s)"
echo "  log: ${LOGFILE}"
echo "########################################################################"
