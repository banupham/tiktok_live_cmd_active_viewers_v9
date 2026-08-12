@echo off
chcp 65001 >nul
setlocal
set "COLLECTOR_MODE=dom"
set "SHOW_BROWSER=1"
call "%~dp0start_live.bat" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
