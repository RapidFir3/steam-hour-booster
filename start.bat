@echo off
title Steam Hour Booster
echo ========================================================
echo        STEAM SIMULTANEOUS HOUR BOOSTER ⚡
echo ========================================================
echo.

:: Port 3456 mesgulse eski arka plan islemini temizle
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3456') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo Sunucu baslatiliyor...
start http://localhost:3456
node server.js
pause
