@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - Sunucuyu Durdur

echo ==================================================================
echo   SUNUCUYU ZORLA DURDUR
echo   Tüm ServUO.exe pencereleri kapatılır. Son kayıttan sonraki
echo   değişiklikler kaybolur. Normal kapatma için sunucu penceresine
echo   önce "save" sonra "shutdown" yaz.
echo   Sunucu çökme döngüsüne girip pencereler sürekli açılıp
echo   kapanıyorsa bu dosyayı kullan.
echo ==================================================================
echo.

tasklist /FI "IMAGENAME eq ServUO.exe" 2>nul | find /I "ServUO.exe" >nul
if errorlevel 1 (
    echo   Çalışan ServUO bulunamadı.
    goto :Son
)

choice /C EH /M "  Tüm ServUO süreçleri kapatılsın mı? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Son

rem Çökme döngüsünde yeni pencere açılabildiği için birkaç kez dene
for /L %%i in (1,1,5) do (
    taskkill /F /T /IM ServUO.exe >nul 2>&1
    timeout /t 2 >nul
)
tasklist /FI "IMAGENAME eq ServUO.exe" 2>nul | find /I "ServUO.exe" >nul
if errorlevel 1 (
    echo   ServUO durduruldu.
) else (
    echo   UYARI: Hâlâ çalışan ServUO süreci var. Bu dosyayı yönetici olarak tekrar çalıştır.
)

:Son
echo.
pause
