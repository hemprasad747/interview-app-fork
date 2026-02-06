@echo off
set "NODE_DIR=C:\Program Files\nodejs"
set "NPM=%NODE_DIR%\npm.cmd"

if not exist "%NPM%" (
    echo Node.js not found at %NODE_DIR%. Install from https://nodejs.org
    exit /b 1
)

rem So Electron can find node.exe
set "PATH=%NODE_DIR%;%PATH%"

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    call "%NPM%" install
    if errorlevel 1 exit /b 1
)

echo Starting Interview app...
call "%NPM%" start
