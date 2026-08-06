@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Cach dung:
  echo   start_live.bat username
  echo   start_live.bat @username
  echo   start_live.bat https://www.tiktok.com/@username/live
  exit /b 1
)

if not defined CHROME_PROFILE set "CHROME_PROFILE=Profile 1"
set "COLLECTOR_PROFILE=%LOCALAPPDATA%\TikTokLiveCollectorChrome\%CHROME_PROFILE%"

if not exist "%COLLECTOR_PROFILE%" (
  echo.
  echo Chua co ban sao Chrome profile cho collector.
  echo Hay dong Google Chrome va chay:
  echo   sync_profile.bat
  echo.
  exit /b 3
)

node "%~dp0a.mjs" "%~1"
endlocal
