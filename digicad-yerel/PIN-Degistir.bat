@echo off
chcp 65001 >nul
cd /d "%~dp0"
node sunucu.js --pin-degistir
echo.
echo  Yeni PIN'in gecerli olmasi icin sunucu penceresini kapatip Baslat.bat ile yeniden acin.
pause
