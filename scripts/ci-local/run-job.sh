#!/usr/bin/env bash
# Runs ONE job of .github/workflows/ci.yml - `ci` or `e2e` - inside the
# node:20-bookworm runner container, against a FRESH clone of the host repo at
# $CI_LOCAL_REF. The step list, order and commands mirror ci.yml one to one;
# like GitHub Actions, the first failing step stops the job and the remaining
# steps are reported as skipped. Every step's output goes to /out/steps/NN-*.log
# and its exit code to /out/report.tsv (run.ps1 prints the table).
#
# Keep this file in step with ci.yml: when a step is added there, add it here.
set -u

REF="${CI_LOCAL_REF:?CI_LOCAL_REF is required}"
JOB="${CI_LOCAL_JOB:?CI_LOCAL_JOB is required (ci | e2e)}"
case "$JOB" in ci|e2e) ;; *) echo "unknown job '$JOB' (expected ci | e2e)" >&2; exit 2 ;; esac
OUT=/out
mkdir -p "$OUT/steps"
REPORT="$OUT/report.tsv"
: > "$REPORT"
printf 'job\t%s\nref\t%s\nnode\t%s\nstarted\t%s\n' "$JOB" "$REF" "$(node --version)" "$(date -u +%FT%TZ)" > "$OUT/meta.txt"

STEP_NO=0
FAILED=0

# run_step <name> <bash command string>
run_step() {
  local name="$1" cmd="$2"
  STEP_NO=$((STEP_NO + 1))
  local slug
  slug=$(printf '%s' "$name" | tr -c 'A-Za-z0-9' '-' | sed -E 's/-+/-/g; s/^-|-$//g')
  local log
  log=$(printf '%s/steps/%02d-%s.log' "$OUT" "$STEP_NO" "$slug")
  if [ "$FAILED" -ne 0 ]; then
    printf '%s\t%s\tskipped\t0\n' "$STEP_NO" "$name" >> "$REPORT"
    echo "### [$JOB] step $STEP_NO: $name - skipped (earlier step failed)"
    return 0
  fi
  echo "### [$JOB] step $STEP_NO: $name"
  local start=$SECONDS
  bash -o pipefail -c "$cmd" > "$log" 2>&1
  local code=$?
  local secs=$((SECONDS - start))
  printf '%s\t%s\t%s\t%s\n' "$STEP_NO" "$name" "$code" "$secs" >> "$REPORT"
  if [ "$code" -ne 0 ]; then
    FAILED=1
    echo "### FAILED: $name (exit $code after ${secs}s) - first error lines:"
    grep -n -i -E 'error|fail|exit code|ELIFECYCLE|Command failed|Timeout' "$log" | head -40
    echo "### last 30 lines of $log:"
    tail -30 "$log"
  else
    echo "### ok (${secs}s)"
  fi
}

# --- common prefix of both jobs (checkout, pnpm 9.12.0, node 20, install, generate, push)
# The clone transfers refs/heads + refs/tags only; the extra fetch brings the
# host's remote-tracking refs (origin/*) under refs/host/* so a ref that is only
# reachable from one of those still checks out.
run_step "Checkout (fresh clone of the host repo at $REF)" "
  git config --global --add safe.directory '*' &&
  git clone --quiet file:///host.git /work &&
  cd /work &&
  git fetch --quiet --no-tags file:///host.git '+refs/remotes/*:refs/host/*' &&
  git checkout --quiet --detach '$REF' &&
  echo \"HEAD: \$(git log --oneline -1)\" && git status --short | head -5"
run_step "Set up pnpm 9.12.0 on Node 20" "
  npm install -g pnpm@9.12.0 --no-fund --no-audit >/dev/null &&
  echo \"node \$(node --version), pnpm \$(pnpm --version)\" &&
  node -e 'if(!process.version.startsWith(\"v20.\"))process.exit(1)'"
run_step "pnpm install --frozen-lockfile" "cd /work && pnpm install --frozen-lockfile"
run_step "Generate Prisma client" "cd /work && pnpm --filter @hmp/db generate"
run_step "Push schema to DB" "cd /work && pnpm --filter @hmp/db push"

case "$JOB" in
  ci)
    run_step "pnpm lint" "cd /work && pnpm lint"
    run_step "pnpm typecheck" "cd /work && pnpm typecheck"
    run_step "pnpm test" "cd /work && pnpm test"
    run_step "pnpm build" "cd /work && pnpm build"
    ;;
  e2e)
    # The e2e job's extra env (ci.yml `jobs.e2e.env`, verbatim). Services share
    # the runner's loopback, so localhost is right here as on a GitHub runner.
    export LMS_EXPORTS_BUCKET=hmp-lms-exports
    export TAXILA_API_URL=''
    export MAILHOG_URL=http://localhost:8025
    run_step "Seed dev users" "cd /work && pnpm --filter @hmp/db seed"
    run_step "Build production app" "cd /work && pnpm --filter @hmp/web build"
    run_step "Install Playwright browsers" "cd /work/apps/web && pnpm exec playwright install --with-deps chromium"
    run_step "Start MinIO (compose service - already running)" "true"
    run_step "Wait for MinIO" "
      for i in \$(seq 1 30); do
        if curl -sf http://localhost:9000/minio/health/live >/dev/null; then echo \"MinIO ready after \${i}s\"; exit 0; fi
        sleep 1
      done
      echo 'MinIO did not become ready in 30s'; exit 1"
    run_step "Wait for Mailhog" "
      for i in \$(seq 1 30); do
        if curl -sf 'http://localhost:8025/api/v2/messages?limit=1' >/dev/null; then echo \"Mailhog ready after \${i}s\"; exit 0; fi
        sleep 1
      done
      echo 'Mailhog did not become ready in 30s'; exit 1"
    run_step "pnpm e2e" "cd /work && pnpm e2e"
    run_step "e2e (workers on) - m9" "
      cd /work
      export WORKERS_ENABLED=true
      set +e
      trap 'kill \"\$(cat worker.pid 2>/dev/null)\" 2>/dev/null || true' EXIT
      pnpm workers > worker.log 2>&1 &
      echo \$! > worker.pid
      pnpm --filter @hmp/web exec playwright test m9-workers.spec.ts --repeat-each=5
      status=\$?
      echo '=== worker.log (last 50 lines) ==='
      tail -50 worker.log
      cp worker.log $OUT/worker.log 2>/dev/null || true
      exit \$status"
    # ci.yml uploads the Playwright report as an artifact on failure; here it
    # is copied next to the step logs.
    if [ "$FAILED" -ne 0 ] && [ -d /work/apps/web ]; then
      cp -r /work/apps/web/playwright-report "$OUT/playwright-report" 2>/dev/null || true
      cp -r /work/apps/web/test-results "$OUT/test-results" 2>/dev/null || true
    fi
    ;;
  *)
    echo "unknown job '$JOB' (expected ci | e2e)" >&2
    exit 2
    ;;
esac

printf 'finished\t%s\nresult\t%s\n' "$(date -u +%FT%TZ)" "$([ "$FAILED" -eq 0 ] && echo success || echo failure)" >> "$OUT/meta.txt"
echo "### [$JOB] $([ "$FAILED" -eq 0 ] && echo 'ALL STEPS PASSED' || echo 'JOB FAILED')"
exit "$FAILED"
