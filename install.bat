@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "INSTALL_MODE=%~1"
if not defined INSTALL_MODE set "INSTALL_MODE=direct"

if /i "%INSTALL_MODE%"=="dom" goto :DOM
if /i not "%INSTALL_MODE%"=="direct" goto :HELP

:DIRECT
echo [1/2] Cai Node dependencies toi thieu cho DIRECT mode...
call npm install --omit=optional
if errorlevel 1 exit /b 1

echo [2/2] Cai Python TikTokLive...
where python >nul 2>&1
if errorlevel 1 (
  echo [THIEU PYTHON] Cai Python 3 va them vao PATH, sau do chay lai install.bat.
  exit /b 2
)
python -m pip install --upgrade -r requirements-direct.txt
if errorlevel 1 exit /b 3

echo.
echo Cai dat xong DIRECT mode.
echo Chay: run.bat ten_tiktok
exit /b 0

:DOM
echo Cai day du dependencies cho DOM mode...
call npm install
if errorlevel 1 exit /b 1

echo.
echo DOM mode van can Google Chrome + collector profile.
echo Dong Chrome roi chay sync_profile.bat neu chua tao profile collector.
exit /b 0

:HELP
echo Cach dung:
echo   install.bat       ^(direct - nhe nhat, khuyen dung^)
echo   install.bat dom   ^(them dependency cho DOM/Chrome^)
exit /b 1
