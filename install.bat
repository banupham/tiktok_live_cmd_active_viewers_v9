@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

npm install
if errorlevel 1 exit /b 1

where python >nul 2>&1
if errorlevel 1 (
  echo [THIEU PYTHON] Direct mode can Python 3. DOM mode van dung duoc.
  exit /b 2
)
python -m pip install --upgrade -r requirements-direct.txt
if errorlevel 1 exit /b 3

echo Cai dat xong: direct Webcast + DOM fallback.
pause
endlocal
