@echo off
title Steam Hour Booster - Windows Server Kurulumu
echo ========================================================
echo        STEAM HOUR BOOSTER - VDS KURULUM ARACI
echo ========================================================
echo.

echo [1/3] Node.js paketleri kontrol ediliyor ve kuruluyor...
call npm install
echo.

echo [2/3] Windows Guvenlik Duvarinda 3456 portu aciliyor...
netsh advfirewall firewall add rule name="Steam Hour Booster (Port 3456)" dir=in action=allow protocol=TCP localport=3456
echo Guvenlik duvari kurali eklendi.
echo.

echo [3/3] PM2 arka plan servis yoneticisi kuruluyor (7/24 kesintisiz calisma icin)...
call npm install -g pm2
call npm install -g pm2-windows-startup
call pm2-startup install
call pm2 start server.js --name "steam-hour-booster"
call pm2 save

echo.
echo ========================================================
echo   KURULUM TAMAMLANDI! 7/24 OTOMATIK BASLATMA AKTIF!
echo ========================================================
echo.
echo VDS yeniden baslasa bile booster arkada otomatik acilacaktir.
echo.
echo Paneline erismek icin:
echo   Yerel (VDS icinde): http://localhost:3456
echo   Disaridan (Kendi bilgisayarindan/telefonundan): http://VDS_IP_ADRESIN:3456
echo.
pause
