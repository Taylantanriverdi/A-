@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Firebase'deki tum veriler ve dosyalar bu bilgisayara indirilecek.
echo  ONCE sunucu penceresini (Baslat.bat) kapatmis olun.
echo.
pause
node araclar\firebase-aktar.js %*
echo.
pause
