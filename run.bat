@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" goto :HELP

set "ACTION=%~1"
shift

if /i "%ACTION%"=="direct" goto :DIRECT
if /i "%ACTION%"=="dom" goto :DOM_VISIBLE
if /i "%ACTION%"=="dom-visible" goto :DOM_VISIBLE
if /i "%ACTION%"=="dom-hidden" goto :DOM_HIDDEN
if /i "%ACTION%"=="game" goto :GAME

rem Cach ngan nhat: run.bat username
set "COLLECTOR_MODE=direct"
call "%~dp0start_live.bat" "%ACTION%" %*
exit /b %ERRORLEVEL%

:DIRECT
if "%~1"=="" goto :HELP
set "COLLECTOR_MODE=direct"
call "%~dp0start_live.bat" %*
exit /b %ERRORLEVEL%

:DOM_VISIBLE
if "%~1"=="" goto :HELP
set "COLLECTOR_MODE=dom"
set "SHOW_BROWSER=1"
call "%~dp0start_live.bat" %*
exit /b %ERRORLEVEL%

:DOM_HIDDEN
if "%~1"=="" goto :HELP
set "COLLECTOR_MODE=dom"
set "SHOW_BROWSER=0"
call "%~dp0start_live.bat" %*
exit /b %ERRORLEVEL%

:GAME
if "%~1"=="" goto :HELP
set "COLLECTOR_MODE=direct"
call "%~dp0start_middleware_to_game.bat" %*
exit /b %ERRORLEVEL%

:HELP
echo.
echo TIKTOK LIVE EVENT MIDDLEWARE - WINDOWS
echo.
echo Cach ngan nhat:
echo   run.bat username
echo.
echo LAN API:
echo   Mac dinh bind 0.0.0.0:8787 de may khac trong LAN truy cap.
echo   Neu Windows Firewall chan, chay: allow-lan.bat [api_port]
echo.
echo Tuy chon:
echo   run.bat direct username       ^(mac dinh, khong Chrome^)
echo   run.bat dom username          ^(DOM, hien Chrome^)
echo   run.bat dom-hidden username   ^(DOM, an cua so Chrome^)
echo   run.bat game username         ^(direct + webhook game 127.0.0.1:9000^)
echo.
echo Cai dat:
echo   install.bat                   ^(direct - nhe nhat^)
echo   install.bat dom               ^(them dependency cho DOM^)
echo.
exit /b 1
