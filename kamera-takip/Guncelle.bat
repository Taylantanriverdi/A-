@echo off
chcp 65001 >nul
setlocal
title Kamera Takip - Güncelleme
REM ================================================================
REM  Bu dosyaya çift tıklayın: en son sürümü indirir ve programı başlatır.
REM  Programı her zaman bu dosyayla açarsanız hep güncel kalır.
REM ================================================================
set "KLASOR=%LOCALAPPDATA%\KameraTakip"
if not exist "%KLASOR%" mkdir "%KLASOR%"

echo En son sürüm indiriliyor...
REM 1) GitHub Release (önbellek yok, her zaman en yeni)  2) yedek: raw adresi
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $ProgressPreference = 'SilentlyContinue'; $hedef = $env:KLASOR + '\KameraTakip.yeni'; $adresler = @('https://github.com/Taylantanriverdi/A-/releases/latest/download/KameraTakip.bat', 'https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/ecstatic-fermat-gzzjnm/kamera-takip/KameraTakip.bat'); foreach ($u in $adresler) { try { Invoke-WebRequest -UseBasicParsing -Headers @{'Cache-Control'='no-cache'} -Uri $u -OutFile $hedef; if ((Get-Item $hedef).Length -gt 10000) { Move-Item -Force $hedef ($env:KLASOR + '\KameraTakip.bat'); exit 0 } } catch { Write-Host ('  ' + $u + ' -> ' + $_.Exception.Message) } }; exit 1"
if errorlevel 1 goto hata
if not exist "%KLASOR%\KameraTakip.bat" goto hata

for /f "tokens=3 delims= " %%v in ('findstr /b /c:"SURUM = " "%KLASOR%\KameraTakip.bat"') do set "SURUM=%%~v"
echo Güncelleme tamamlandı. İndirilen sürüm: %SURUM%
echo Program başlatılıyor...
echo.
call "%KLASOR%\KameraTakip.bat"
exit /b 0

:hata
echo.
echo HATA: Güncelleme indirilemedi. İnternet bağlantınızı kontrol edin.
if exist "%KLASOR%\KameraTakip.bat" (
  echo Bilgisayardaki mevcut sürümle devam ediliyor...
  call "%KLASOR%\KameraTakip.bat"
)
pause
exit /b 1
