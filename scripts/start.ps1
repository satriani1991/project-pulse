# Starts PROJECT PULSE in the background (hidden window) and opens the dashboard.
param([switch]$NoBrowser)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js 22.13+ is required.'; exit 1 }
if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE) { exit 1 } }
if (-not (Test-Path 'apps/server/dist/server.mjs') -or -not (Test-Path 'apps/web/dist/index.html')) { npm run build; if ($LASTEXITCODE) { exit 1 } }
$existing = Get-NetTCPConnection -LocalPort 7700 -State Listen -ErrorAction SilentlyContinue
if ($existing) { Write-Host 'PROJECT PULSE is already running on port 7700.' }
else {
  New-Item -ItemType Directory -Force -Path 'data' | Out-Null
  $p = Start-Process -FilePath 'node' -ArgumentList '--no-warnings=ExperimentalWarning', 'apps/server/dist/server.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput 'data/server.log' -RedirectStandardError 'data/server-error.log' -PassThru
  $p.Id | Out-File -Encoding ascii 'data/server.pid'
  Start-Sleep -Seconds 3
  Write-Host "PROJECT PULSE started (PID $($p.Id)) -> http://127.0.0.1:7700"
}
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:7700' }
