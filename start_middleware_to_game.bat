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
echo TIKTOK LIVE EVENT MIDDLEWARE + GAME SERVER
echo Webhook: %WEBHOOK_URLS%
echo ============================================================
echo.
echo Dang kiem tra xem game server da chay chua...
python "%~dp0scripts\send_webhook_handshake.py"

if not errorlevel 1 goto SERVER_OK

echo.
echo Chua co game server hop le. Dang tu mo cua so server...
start "TikTok Game Event Server" cmd /k "cd /d ""%~dp0"" ^&^& python examples\game_event_server.py"

echo Dang cho server khoi dong...
timeout /t 2 /nobreak >nul

python "%~dp0scripts\send_webhook_handshake.py"

if errorlevel 1 (
  echo.
  echo [LOI] Khong ket noi duoc dung game server.
  echo Co the process cu dang giu port %GAME_EVENT_PORT%.
  echo.
  echo Process dang LISTEN tren port %GAME_EVENT_PORT%:
  netstat -ano | findstr LISTENING | findstr :%GAME_EVENT_PORT%
  echo.
  echo Dong process cu bang:
  echo   taskkill /PID ^<PID^> /F
  echo Sau do chay lai file BAT nay.
  echo.
  echo Middleware KHONG duoc khoi dong de tranh gui nham process.
  exit /b 2
)

:SERVER_OK
echo.
echo [KET NOI OK] Game server va middleware da thong nhau.
echo Dang mo TikTok LIVE...
echo.

call "%~dp0start_visible.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
