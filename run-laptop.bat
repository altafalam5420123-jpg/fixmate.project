@echo off
title FixMate Server (Laptop)
echo ========================================================
echo        FixMate Home Services - Laptop Server
echo ========================================================
echo.
REM Free port 3000 if an old node instance is already running
taskkill /F /IM node.exe >nul 2>&1

echo Server start ho raha hai: http://localhost:3000
echo Phone ke liye Wi-Fi IP:  http://192.168.101.24:3000
echo.
echo Browser mein FixMate open kiya ja raha hai...
if exist "%~dp0fixmate\server" (
    cd /d "%~dp0fixmate\server"
) else (
    cd /d "%~dp0server"
)

start http://localhost:3000

node src/server.js
pause
