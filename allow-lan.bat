@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if not defined PORT set "PORT=8787"
set "RULE_NAME=TikTok LIVE Event API"

net session >nul 2>&1
if errorlevel 1 (
  echo Dang yeu cau quyen Administrator de mo TCP port %PORT% tren Private network...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
  exit /b 0
)

netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_NAME%" dir=in action=allow protocol=TCP localport=%PORT% profile=private >nul
if errorlevel 1 (
  echo [LOI] Khong tao duoc Windows Firewall rule.
  exit /b 1
)

echo [OK] Da cho phep TCP port %PORT% tren Windows Private network.
echo May khac trong LAN dung: http://IP_LAN_CUA_MAY_NAY:%PORT%/api/health
pause
endlocal
