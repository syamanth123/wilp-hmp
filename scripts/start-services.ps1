# HMP — start local services (Redis, MinIO, Mailhog).
# Postgres 18 runs as a Windows service and is assumed already running.
# Run from any directory; paths are resolved relative to this script.

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

function Test-Port($port) {
  $null -ne (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Wait-Port($port, $name, $timeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) { Write-Host "[$name] up on :$port" -ForegroundColor Green; return }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "[$name] FAILED to start on :$port within $timeoutSec s" -ForegroundColor Red
}

# Redis
if (Test-Port 6379) {
  Write-Host "[redis] already running on :6379" -ForegroundColor Yellow
} else {
  Start-Process -FilePath "$root\tools\redis\redis-server.exe" `
    -ArgumentList "--port","6379","--save","60 1" `
    -WorkingDirectory "$root\tools\redis" -WindowStyle Hidden
  Wait-Port 6379 "redis"
}

# MinIO
if (Test-Port 9000) {
  Write-Host "[minio] already running on :9000" -ForegroundColor Yellow
} else {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "$root\tools\minio\minio.exe"
  $psi.Arguments = "server `"$root\tools\minio\data`" --address :9000 --console-address :9001"
  $psi.WorkingDirectory = "$root\tools\minio"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["MINIO_ROOT_USER"] = "hmpaccess"
  $psi.EnvironmentVariables["MINIO_ROOT_PASSWORD"] = "hmpsecret123"
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  Wait-Port 9000 "minio"
}

# Mailhog
if (Test-Port 1025) {
  Write-Host "[mailhog] already running on :1025" -ForegroundColor Yellow
} else {
  Start-Process -FilePath "$root\tools\mailhog\mailhog.exe" `
    -WorkingDirectory "$root\tools\mailhog" -WindowStyle Hidden
  Wait-Port 1025 "mailhog"
}

Write-Host ""
Write-Host "All services ready. Next: pnpm --filter @hmp/web dev" -ForegroundColor Cyan
Write-Host "  App:           http://localhost:3000"
Write-Host "  Mailhog UI:    http://localhost:8025"
Write-Host "  MinIO console: http://localhost:9001  (hmpaccess / hmpsecret123)"
