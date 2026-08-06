@echo off
chcp 65001 >nul
setlocal

tasklist /FI "IMAGENAME eq chrome.exe" /NH | find /I "chrome.exe" >nul
if not errorlevel 1 (
  echo.
  echo LOI: Google Chrome dang mo.
  echo Hay dong TOAN BO cua so Chrome truoc khi dong bo Profile 1.
  echo.
  exit /b 2
)

set "CHROME_PROFILE=Profile 1"
node "%~dp0sync_profile.mjs"
endlocal
