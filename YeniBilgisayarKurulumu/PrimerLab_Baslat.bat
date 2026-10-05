@echo off
setlocal EnableExtensions
title Primer Lab
set "UYGULAMA=C:\PrimerLab\Uygulama"
set "URL=http://localhost:5169"
if not exist "%UYGULAMA%\PrimerLabV2.exe" (
    echo Primer Lab kurulu degil. KURULUM.bat'i calistirin.
    pause
    exit /b 1
)
tasklist /FI "IMAGENAME eq PrimerLabV2.exe" 2>nul | find /I "PrimerLabV2.exe" >nul
if errorlevel 1 (
    pushd "%UYGULAMA%"
    start "PrimerLab" /min "%UYGULAMA%\PrimerLabV2.exe"
    popd
)
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { if((Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 2).StatusCode -eq 200){$ok=$true;break} } catch {}; Start-Sleep 1 }; if(-not $ok){exit 1}"
if errorlevel 1 (
    echo Primer Lab acilamadi. PostgreSQL servisinin calistigindan emin olun.
    pause
    exit /b 1
)
if /i not "%~1"=="sessiz" start "" "%URL%"
rem Otomatik yazdirma aciksa yazici istasyonu da acilir.
findstr /c:"\"Aktif\": true" "%UYGULAMA%\App_Data\otomatik-yazdir.json" >nul 2>&1
if not errorlevel 1 if exist "C:\PrimerLab\PrimerLab_YaziciIstasyonu.bat" start "" /min cmd /c "C:\PrimerLab\PrimerLab_YaziciIstasyonu.bat"
exit /b 0
