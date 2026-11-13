@echo off
setlocal
title Kamera Takip - Guncelleme
REM ================================================================
REM  Bu dosyaya cift tikla: en son surumu indirir ve programi baslatir.
REM  Her zaman bu dosyayla acarsan program hep guncel olur.
REM ================================================================
set "KLASOR=%LOCALAPPDATA%\KameraTakip"
if not exist "%KLASOR%" mkdir "%KLASOR%"

echo En son surum indiriliyor...
REM 1) GitHub Release (onbellek yok, her zaman en yeni)  2) yedek: raw adresi
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $ProgressPreference = 'SilentlyContinue'; $hedef = $env:KLASOR + '\KameraTakip.yeni'; $adresler = @('https://github.com/Taylantanriverdi/A-/releases/latest/download/KameraTakip.bat', 'https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/ecstatic-fermat-gzzjnm/kamera-takip/KameraTakip.bat'); foreach ($u in $adresler) { try { Invoke-WebRequest -UseBasicParsing -Headers @{'Cache-Control'='no-cache'} -Uri $u -OutFile $hedef; if ((Get-Item $hedef).Length -gt 10000) { Move-Item -Force $hedef ($env:KLASOR + '\KameraTakip.bat'); exit 0 } } catch { Write-Host ('  ' + $u + ' -> ' + $_.Exception.Message) } }; exit 1"
if errorlevel 1 goto hata
if not exist "%KLASOR%\KameraTakip.bat" goto hata

for /f "tokens=3 delims= " %%v in ('findstr /b /c:"SURUM = " "%KLASOR%\KameraTakip.bat"') do set "SURUM=%%~v"
echo Guncelleme tamam. Indirilen surum: %SURUM%
echo Program baslatiliyor...
echo.
call "%KLASOR%\KameraTakip.bat"
exit /b 0

:hata
echo.
echo HATA: Guncelleme indirilemedi. Internet baglantini kontrol et.
if exist "%KLASOR%\KameraTakip.bat" (
  echo Eldeki surumle devam ediliyor...
  call "%KLASOR%\KameraTakip.bat"
)
pause
exit /b 1
