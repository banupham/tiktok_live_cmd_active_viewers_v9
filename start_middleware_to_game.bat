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

set "GAME_EVENT_HOST=127.0.0.1"
set "GAME_EVENT_PORT=9000"
set "GAME_EVENT_PATH=/tiktok-event"
set "WEBHOOK_URLS=http://127.0.0.1:%GAME_EVENT_PORT%%GAME_EVENT_PATH%"
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"

echo ============================================================
echo TIKTOK LIVE EVENT MIDDLEWARE
echo Webhook: %WEBHOOK_URLS%
echo ============================================================
echo.
echo Dang kiem tra game server tai port %GAME_EVENT_PORT%...
python "%~dp0scripts\send_webhook_handshake.py"

if errorlevel 1 (
  echo.
  echo [CHUA CO GAME SERVER]
  echo Hay mo CMD thu nhat tai thu muc repo va chay:
  echo   python examples\game_event_server.py
  echo.
  echo Giu nguyen cua so server, sau do mo CMD thu hai va chay lai:
  echo   start_middleware_to_game.bat %~1
  echo.
  echo Middleware chua khoi dong de tranh mat event.
  exit /b 2
)

echo.
echo [KET NOI OK] Game server va middleware da thong nhau.
echo Dang mo TikTok LIVE...
echo.

call "%~dp0start_visible.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
