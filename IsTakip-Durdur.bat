@echo off
setlocal EnableExtensions
title Is Takip - Durdur
rem Arka planda (gizli) calisan Is Takip programini kapatir.
set "PORT=3000"
set "BULUNDU=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  tasklist /fi "pid eq %%p" | find /i "node.exe" >nul && taskkill /f /pid %%p >nul 2>&1 && set "BULUNDU=1"
)
echo.
if "%BULUNDU%"=="1" (
  echo  Is Takip programi kapatildi.
) else (
  echo  Calisan Is Takip programi bulunamadi.
)
echo  Yeniden acmak icin IsTakip-Baslat.bat dosyasina cift tiklayin.
echo.
ping -n 4 127.0.0.1 >nul
