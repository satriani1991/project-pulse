# Stops the background PROJECT PULSE server.
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'data/server.pid'
$stopped = $false
if (Test-Path $pidFile) {
  $id = Get-Content $pidFile
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Stop-Process -Id $id; $stopped = $true }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
if (-not $stopped) {
  $conn = Get-NetTCPConnection -LocalPort 7700 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Stop-Process -Id $conn.OwningProcess; $stopped = $true }
}
if ($stopped) { Write-Host 'PROJECT PULSE stopped.' } else { Write-Host 'PROJECT PULSE was not running.' }
