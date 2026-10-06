<#
.SYNOPSIS
  Run the repo's CI pipeline (.github/workflows/ci.yml) locally in Docker.

.DESCRIPTION
  GitHub Actions is unavailable for this account, so this reproduces both CI
  jobs on the laptop with the same recipe CI uses: a Linux Node 20 runner
  (node:20-bookworm, pnpm 9.12.0) plus postgres:16-alpine, redis:7-alpine,
  mailhog and minio as service containers that share the runner's network
  namespace (so ci.yml's env block applies verbatim). The runner does a FRESH
  git clone of this repo at -Ref inside the container, so only COMMITTED
  objects are tested - nothing from the Windows working tree can leak in.
  Each job gets freshly created service containers (compose down between
  jobs; the pnpm store and Chromium caches are kept in named volumes).

  Step logs and a report.tsv land in scripts\ci-local\out\<sha7>-<job>\.

.PARAMETER Ref
  Commit, branch or tag of THIS repo to test (resolved with git rev-parse).
.PARAMETER Job
  ci | e2e | all (default). `all` runs ci first and e2e only if ci passed
  (ci.yml: `needs: ci`).
.PARAMETER KeepServices
  Leave the service containers up after the last job (for poking at the DB).

.EXAMPLE
  .\scripts\ci-local\run.ps1 -Ref main
  .\scripts\ci-local\run.ps1 -Ref feature/course-dibba -Job e2e
#>
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [ValidateSet('ci', 'e2e', 'all')][string]$Job = 'all',
  [switch]$KeepServices
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$compose = Join-Path $PSScriptRoot 'docker-compose.yml'

# Runs docker compose and returns ONLY the exit code. Docker's output goes to
# the console via Out-Host (or nowhere with -Quiet) - never into the pipeline,
# where it would be returned together with the code and turn $code into an
# array (an earlier revision had exactly that bug: every job read as failed).
function Invoke-Compose {
  param([string[]]$ComposeArgs, [switch]$Quiet)
  if ($Quiet) { & docker compose -f $compose @ComposeArgs | Out-Null }
  else { & docker compose -f $compose @ComposeArgs | Out-Host }
  return [int]$LASTEXITCODE
}

# --- preconditions -----------------------------------------------------------
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not reachable - start Docker Desktop and retry.' }

$sha = (& git -C $root rev-parse --verify "$Ref^{commit}")
if ($LASTEXITCODE -ne 0 -or -not $sha) { throw "Unknown ref '$Ref' in $root" }
$sha = $sha.Trim()
$short = $sha.Substring(0, 7)
$subject = (& git -C $root log -1 --format=%s $sha)

$jobs = @(if ($Job -eq 'all') { 'ci', 'e2e' } else { $Job })
Write-Host ""
Write-Host "CI-local  ref=$Ref ($short) `"$subject`"  jobs=$($jobs -join ', ')" -ForegroundColor Cyan

# The container clones $root\.git, which holds COMMITTED objects only. Say so
# when the tree has edits this run cannot see, so a PASSED is not misread.
$dirty = @(& git -C $root status --porcelain --untracked-files=normal) | Where-Object { $_ }
if ($LASTEXITCODE -eq 0 -and $dirty.Count -gt 0) {
  Write-Host ""
  Write-Host "WARNING: $($dirty.Count) uncommitted/untracked path(s) in the working tree are NOT part of $short and are not tested:" -ForegroundColor Yellow
  $dirty | Select-Object -First 8 | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
  if ($dirty.Count -gt 8) { Write-Host "   ... and $($dirty.Count - 8) more" -ForegroundColor Yellow }
  Write-Host "Commit first and re-run with that sha before trusting a PASSED result." -ForegroundColor Yellow
}

# Compose reads these (docker-compose.yml). Forward slashes keep Docker Desktop
# happy with Windows paths.
$env:CI_LOCAL_REPO_GIT = (Join-Path $root '.git') -replace '\\', '/'
$env:CI_LOCAL_REF = $sha

# Pull every image up front, with retries: pulls from inside the Docker Desktop
# VM hit intermittent "TLS handshake timeout"s against Docker Hub, and a single
# failed pull inside `compose up` would abort the whole run.
$images = @('alpine:3.20', 'node:20-bookworm', 'postgres:16-alpine', 'redis:7-alpine', 'mailhog/mailhog:latest', 'minio/minio:latest')
foreach ($img in $images) {
  & docker image inspect $img | Out-Null
  if ($LASTEXITCODE -eq 0) { continue }
  $pulled = $false
  for ($attempt = 1; $attempt -le 6 -and -not $pulled; $attempt++) {
    Write-Host "pulling $img (attempt $attempt)" -ForegroundColor Gray
    & docker pull -q $img | Out-Null
    & docker image inspect $img | Out-Null
    if ($LASTEXITCODE -eq 0) { $pulled = $true } else { Start-Sleep -Seconds 10 }
  }
  if (-not $pulled) { throw "could not pull $img after 6 attempts (Docker Hub unreachable?)" }
}

$results = @{}
$overall = 0
for ($i = 0; $i -lt $jobs.Count; $i++) {
  $j = [string]$jobs[$i]
  $outDir = Join-Path $PSScriptRoot "out\$short-$j"
  if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $env:CI_LOCAL_OUT = $outDir -replace '\\', '/'
  $env:CI_LOCAL_JOB = $j

  Write-Host ""
  Write-Host "=== job: $j  (fresh services, fresh clone) ===" -ForegroundColor Cyan
  # Fresh service containers per job, like CI. No -v: that would also delete
  # the pnpm/browser cache volumes; service state is tmpfs anyway.
  $null = Invoke-Compose -Quiet @('down', '--remove-orphans')
  $code = Invoke-Compose @('up', '-d', '--wait', 'netns', 'postgres', 'redis', 'mailhog', 'minio')
  if ($code -ne 0) { throw "services failed to start (compose exit $code)" }

  $started = Get-Date
  $code = Invoke-Compose @('run', '--rm', 'runner')
  $results[$j] = $code
  $elapsed = [int]((Get-Date) - $started).TotalSeconds

  # --- per-step table from the runner's report ---
  $report = Join-Path $outDir 'report.tsv'
  Write-Host ""
  Write-Host ("{0,-4} {1,-60} {2,-8} {3,6}" -f 'step', 'name', 'exit', 'secs') -ForegroundColor Gray
  if (Test-Path $report) {
    foreach ($line in Get-Content $report) {
      if (-not $line) { continue }
      $f = $line -split "`t"
      $color = if ($f[2] -eq '0') { 'Green' } elseif ($f[2] -eq 'skipped') { 'DarkGray' } else { 'Red' }
      Write-Host ("{0,-4} {1,-60} {2,-8} {3,6}" -f $f[0], $f[1], $f[2], $f[3]) -ForegroundColor $color
    }
  } else {
    Write-Host "(no report.tsv - the runner did not start; see the compose output above)" -ForegroundColor Red
  }
  $verdict = if ($code -eq 0) { 'PASSED' } else { "FAILED (exit $code)" }
  $vcolor = if ($code -eq 0) { 'Green' } else { 'Red' }
  Write-Host "job $j $verdict in ${elapsed}s - logs: $outDir" -ForegroundColor $vcolor

  $last = ($i -eq $jobs.Count - 1)
  if (-not ($KeepServices -and $last)) { $null = Invoke-Compose -Quiet @('down', '--remove-orphans') }

  if ($code -ne 0) {
    $overall = $code
    if (-not $last) { Write-Host "skipping remaining job(s): $($jobs[($i + 1)..($jobs.Count - 1)] -join ', ') (needs: ci)" -ForegroundColor Yellow }
    break
  }
}

Write-Host ""
foreach ($j in $jobs) {
  $r = if ($results.ContainsKey($j)) { if ($results[$j] -eq 0) { 'PASSED' } else { "FAILED ($($results[$j]))" } } else { 'skipped' }
  Write-Host ("summary  {0,-4} {1}" -f $j, $r)
}
exit ([int]$overall)
