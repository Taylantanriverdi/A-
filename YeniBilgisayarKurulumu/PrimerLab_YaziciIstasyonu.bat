@echo off
setlocal EnableExtensions
title Primer Lab - Yazici Istasyonu

rem Hekimden gelen islerin siparis formunu SORMADAN varsayilan yaziciya basan pencere.
rem Edge (yoksa Chrome) ayri bir profille "--kiosk-printing" (sessiz yazdirma) kipinde acilir.
rem Bu pencere acik kaldikca yeni isler otomatik yazdirilir. Yazici: Windows varsayilan yazicisi.

set "HEDEF=C:\PrimerLab"
set "URL=http://localhost:5169/?istasyon=1"
set "PROFIL=%HEDEF%\YaziciIstasyonu"

rem Istasyon zaten aciksa ikinci pencere acilmaz (ayni is iki kez basilmasin).
powershell -NoProfile -Command "if(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*YaziciIstasyonu*' }){exit 0}else{exit 1}"
if not errorlevel 1 (
    echo Yazici istasyonu zaten acik.
    timeout /t 3 >nul
    exit /b 0
)

rem Primer Lab calismiyorsa once baslatilir.
tasklist /FI "IMAGENAME eq PrimerLabV2.exe" 2>nul | find /I "PrimerLabV2.exe" >nul
if errorlevel 1 if exist "%HEDEF%\PrimerLab_Baslat.bat" call "%HEDEF%\PrimerLab_Baslat.bat" sessiz

set "TARAYICI="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "TARAYICI=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined TARAYICI if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "TARAYICI=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined TARAYICI if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "TARAYICI=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined TARAYICI if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "TARAYICI=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined TARAYICI (
    echo Microsoft Edge veya Google Chrome bulunamadi.
    pause
    exit /b 1
)

start "" "%TARAYICI%" --kiosk-printing --user-data-dir="%PROFIL%" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --app="%URL%"
exit /b 0
