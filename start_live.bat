@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Cach dung:
  echo   start_live.bat username [api_port]
  echo   start_live.bat @username [api_port]
  echo   start_live.bat https://www.tiktok.com/@username/live [api_port]
  exit /b 1
)

if not "%~2"=="" set "API_PORT=%~2"
if not defined API_PORT set "API_PORT=8787"
if not defined API_HOST set "API_HOST=0.0.0.0"
if not defined COLLECTOR_MODE set "COLLECTOR_MODE=direct"

echo [API] %API_HOST%:%API_PORT%
if "%API_HOST%"=="0.0.0.0" echo [LAN] Dang lang nghe tren tat ca interface. May khac dung IP LAN cua may nay:%API_PORT%

if /i "%COLLECTOR_MODE%"=="direct" goto :DIRECT
if /i "%COLLECTOR_MODE%"=="dom" goto :DOM

echo COLLECTOR_MODE khong hop le: %COLLECTOR_MODE%
exit /b 4

:DIRECT
if not defined PYTHON_BIN set "PYTHON_BIN=python"
where "%PYTHON_BIN%" >nul 2>&1
if errorlevel 1 (
  echo [THIEU PYTHON] Hay chay install.bat hoac dung DOM mode.
  exit /b 5
)
echo [MODE] DIRECT WEBCAST - khong Chrome / khong DOM
node "%~dp0a.mjs" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"
goto :END

:DOM
if not defined LOCALAPPDATA exit /b 6
if not defined CHROME_PROFILE set "CHROME_PROFILE=Profile 1"
if not defined COLLECTOR_USER_DATA_DIR set "COLLECTOR_USER_DATA_DIR=%LOCALAPPDATA%\TikTokLiveCollectorChrome"
set "COLLECTOR_PROFILE=%COLLECTOR_USER_DATA_DIR%\%CHROME_PROFILE%"
if not exist "%COLLECTOR_PROFILE%" (
  echo Chua co Chrome profile collector. Dong Chrome va chay sync_profile.bat.
  exit /b 3
)
echo [MODE] DOM / CHROME
node "%~dp0a.mjs" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"

:END
endlocal & exit /b %EXIT_CODE%
