@echo off
title FixMate App Launcher
echo Starting FixMate App...

REM Stop any previously running node server so port 3000 is free
taskkill /F /IM node.exe >nul 2>&1

cd /d "%~dp0fixmate\server"
start http://localhost:3000
node src/server.js
