@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Cach dung:
  echo   start_middleware_to_game.bat ten_tiktok
  echo   start_middleware_to_game.bat @ten_tiktok
  echo   start_middleware_to_game.bat https://www.tiktok.com/@ten_tiktok/live
  exit /b 1
)

rem Server game noi bo mac dinh tren cung may.
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"

echo Middleware se tu dong POST event toi:
echo   %WEBHOOK_URLS%
echo.
echo Hay dam bao da chay truoc:
echo   python examples\game_event_server.py
echo.

call "%~dp0start_visible.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
