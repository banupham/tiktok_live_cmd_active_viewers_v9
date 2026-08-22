@echo off
rem Sao chep file nay thanh start_custom.cmd va sua cac gia tri can thiet.

rem direct = HTTP/WebSocket, khong browser/DOM. dom = Chrome + DOM collector cu.
set "COLLECTOR_MODE=direct"
set "PYTHON_BIN=python"
set "DIRECT_CONNECT_ATTEMPTS=3"
set "DIRECT_RETRY_WAIT=4"

rem Khi da tung CONNECTED ma WebSocket bi ngat giua LIVE:
rem sidecar duoc khoi dong lai toi da 5 lan, cho 4s / 8s / 12s... toi da 20s.
rem 403/429 va user offline khong bi reconnect lap lien tuc.
set "DIRECT_RUNTIME_RESTARTS=5"
set "DIRECT_RUNTIME_RESTART_WAIT=4"
set "DIRECT_RUNTIME_RESTART_MAX_WAIT=20"
set "DIRECT_DEBUG=0"

rem 0.0.0.0 = cho phep may khac trong LAN truy cap API.
rem Doi thanh 127.0.0.1 neu chi muon dung tren may nay.
set "API_HOST=0.0.0.0"
set "API_PORT=8787"
set "INCLUDE_RAW=1"
set "MAX_RECENT_EVENTS=500"
set "EVENT_LOG_PATH=%~dp0data\events.jsonl"

rem Chi dung khi COLLECTOR_MODE=dom.
set "SHOW_BROWSER=1"
set "CHROME_PROFILE=Profile 1"

rem Nhieu webhook phan cach bang dau phay.
rem set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event,http://127.0.0.1:9001/event"
set "WEBHOOK_URLS="
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"

call "%~dp0start_live.bat" %*
