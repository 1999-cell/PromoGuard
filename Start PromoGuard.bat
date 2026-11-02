@echo off
setlocal
cd /d "%~dp0"
echo Starting PromoGuard desktop app...
call npm start
if errorlevel 1 (
  echo.
  echo PromoGuard could not start. Check that Node.js and npm are installed,
  echo then run "npm ci" in this folder and try again.
  pause
)
endlocal
