@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22 or newer first. & pause & exit /b 1)
start "Project Pulse" cmd /k node server.mjs
timeout /t 2 /nobreak >nul
start http://127.0.0.1:7700
