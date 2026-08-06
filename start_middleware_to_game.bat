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
echo Dang kiem tra dung process server game...
python "%~dp0scripts\send_webhook_handshake.py"

if errorlevel 1 (
  echo.
  echo [LOI] Chua ket noi dung voi server game.
  echo Co the mot process cu dang giu port 9000.
  echo.
  echo Process dang LISTEN tren port 9000:
  netstat -ano | findstr LISTENING | findstr :9000
  echo.
  echo Hay dong tat ca cua so game_event_server.py cu, sau do chay lai:
  echo   python examples\game_event_server.py
  echo.
  echo Middleware KHONG duoc khoi dong de tranh gui nham process.
  exit /b 2
)

echo.
echo [KET NOI OK] Middleware va server game da thong nhau.
echo Dang mo TikTok LIVE...
echo.

call "%~dp0start_visible.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
