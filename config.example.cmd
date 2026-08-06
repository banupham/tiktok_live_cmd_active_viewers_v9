@echo off
rem Sao chep file nay thanh start_custom.cmd va sua cac gia tri can thiet.

set "API_HOST=127.0.0.1"
set "API_PORT=8787"
set "SHOW_BROWSER=1"
set "CHROME_PROFILE=Profile 1"
set "INCLUDE_RAW=1"
set "MAX_RECENT_EVENTS=500"
set "EVENT_LOG_PATH=%~dp0data\events.jsonl"

rem Nhieu webhook phan cach bang dau phay.
rem set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event,http://127.0.0.1:9001/event"
set "WEBHOOK_URLS="
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"

call "%~dp0start_visible.bat" %*
