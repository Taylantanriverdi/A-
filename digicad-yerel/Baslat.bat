@echo off
chcp 65001 >nul
title DIGICAD Dental - Yerel Sunucu
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js bulunamadi!
  echo  https://nodejs.org adresinden "LTS" surumunu indirip kurun,
  echo  sonra bu dosyayi tekrar calistirin.
  echo.
  pause
  exit /b 1
)
:dongu
node sunucu.js
echo.
echo  Sunucu durdu. 5 saniye sonra yeniden baslatilacak (kapatmak icin bu pencereyi kapatin)...
timeout /t 5 /nobreak >nul
goto dongu
