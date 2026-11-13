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
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $ProgressPreference = 'SilentlyContinue'; $u = 'https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/ecstatic-fermat-gzzjnm/kamera-takip/KameraTakip.bat?t=' + [DateTimeOffset]::Now.ToUnixTimeSeconds(); try { Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile ($env:KLASOR + '\KameraTakip.bat'); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto hata
if not exist "%KLASOR%\KameraTakip.bat" goto hata

echo Guncelleme tamam. Program baslatiliyor...
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
