@echo off
chcp 65001 >nul
setlocal
set "SHOW_BROWSER=1"
call "%~dp0start_live.bat" %*
endlocal
