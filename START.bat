@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org , then double-click this file again.
  pause
  exit /b 1
)
echo Starting Ravi Cash. Open http://localhost:8080 in your browser. Close this window to stop.
call npm start
pause
