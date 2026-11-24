@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22.13 or newer from https://nodejs.org first. & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install || (pause & exit /b 1)
)
if not exist apps\web\dist\index.html call npm run build
if not exist apps\server\dist\server.mjs call npm run build
start "PROJECT PULSE" /min cmd /k npm start
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:7700
