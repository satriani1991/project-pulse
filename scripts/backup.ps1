# Copies the SQLite database (and WAL) plus thumbnails to data/backups/manual-<timestamp>.
# Safe while running (the server also makes daily online backups via VACUUM INTO).
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $root "data/backups/manual-$stamp"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7700/api/system/backup-db' -Headers @{ 'X-Pulse' = '1' } -ContentType 'application/json' -Body '{}' | Out-Null; Write-Host 'Online database backup created in data/backups/database.' }
catch { Copy-Item (Join-Path $root 'data/project-pulse.db*') $dest; Write-Host "Server not running - copied database files to $dest" }
if (Test-Path (Join-Path $root 'data/thumbnails')) { Copy-Item -Recurse (Join-Path $root 'data/thumbnails') $dest }
Write-Host "Backup folder: $dest"
