@echo off
title FixMate Server (Laptop)
echo ========================================================
echo        FixMate Home Services - Laptop Server
echo ========================================================
echo.
echo Server start ho raha hai: http://localhost:3000
echo Phone ke liye Wi-Fi IP:  http://192.168.101.24:3000
echo.
echo Browser mein FixMate open kiya ja raha hai...
cd /d "%~dp0server"

start http://localhost:3000

node src/server.js
pause

