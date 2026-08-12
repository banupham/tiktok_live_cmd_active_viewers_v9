@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Cach dung:
  echo   start_middleware_to_game.bat ten_tiktok
  exit /b 1
)

if not defined COLLECTOR_MODE set "COLLECTOR_MODE=direct"
set "GAME_EVENT_HOST=127.0.0.1"
set "GAME_EVENT_PORT=9000"
set "GAME_EVENT_PATH=/tiktok-event"
set "WEBHOOK_URLS=http://127.0.0.1:%GAME_EVENT_PORT%%GAME_EVENT_PATH%"
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"

echo ============================================================
echo TIKTOK LIVE EVENT MIDDLEWARE
echo Collector: %COLLECTOR_MODE%
echo Webhook  : %WEBHOOK_URLS%
echo ============================================================
python "%~dp0scripts\send_webhook_handshake.py"
if errorlevel 1 (
  echo [CHUA CO GAME SERVER]
  echo Mo CMD khac va chay: python examples\game_event_server.py
  exit /b 2
)

call "%~dp0start_live.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
