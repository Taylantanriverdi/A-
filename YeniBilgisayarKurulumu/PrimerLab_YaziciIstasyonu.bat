@echo off
setlocal EnableExtensions
title Primer Lab - Yazici Istasyonu

rem Hekimden gelen islerin siparis formunu SORMADAN varsayilan yaziciya basan pencereyi acar.
rem Normalde gerekmez: otomatik yazdirma aciksa Primer Lab bu pencereyi kendisi acar ve
rem kapanirsa yeniden acar. Bu kisayol pencereyi hemen acmak icindir (sifre sorulmaz).

set "HEDEF=C:\PrimerLab"
set "URL=http://localhost:5169"

rem Primer Lab calismiyorsa once baslatilir.
tasklist /FI "IMAGENAME eq PrimerLabV2.exe" 2>nul | find /I "PrimerLabV2.exe" >nul
if errorlevel 1 if exist "%HEDEF%\PrimerLab_Baslat.bat" call "%HEDEF%\PrimerLab_Baslat.bat" sessiz

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Method Post '%URL%/api/yonetici-giris/istasyon-ac' -TimeoutSec 15; exit 0 } catch { $m=$_.ErrorDetails.Message; if(-not $m){$m=$_.Exception.Message}; Write-Host $m; exit 1 }"
if errorlevel 1 (
    echo.
    echo Yazici istasyonu acilamadi. Primer Lab'in acik oldugundan emin olun.
    pause
    exit /b 1
)
exit /b 0
