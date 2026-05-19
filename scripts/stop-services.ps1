# HMP — stop local services started by start-services.ps1.
# Postgres 18 (Windows service) is left running.

$names = @("redis-server","minio","mailhog","MailHog_windows_amd64")
foreach ($n in $names) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping $($_.ProcessName) (pid $($_.Id))"
    Stop-Process -Id $_.Id -Force
  }
}
Write-Host "Done."
