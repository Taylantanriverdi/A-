@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Primer Lab V33.07.22.7 TEKNISYEN YONETIM ISLEMLERI
set "SOURCE=%~dp0PrimerLabV2"
set "PROJECT=C:\Users\Primer\Desktop\DentalLab\PrimerLabV2\PrimerLabV2"
set "BACKUPROOT=C:\Users\Primer\Desktop\DentalLab\PrimerLabV2\AUTO_BACKUPS"
set "URL=http://localhost:5169"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"
echo ============================================================
echo PRIMER LAB V33.07.22.7 - TEKNISYEN YONETIM ISLEMLERI
echo ============================================================
if not exist "%SOURCE%\Pages\Index.cshtml" goto MISSING_PACKAGE
if not exist "%SOURCE%\Controllers\TeknisyenlerController.cs" goto MISSING_PACKAGE
if not exist "%PROJECT%\PrimerLabV2.csproj" goto MISSING_PROJECT
set "STAMP=%DATE:/=-%_%TIME::=-%_%RANDOM%"
set "STAMP=%STAMP: =0%"
set "STAMP=%STAMP:,=-%"
set "BACKUP=%BACKUPROOT%\V33.07.22.7_%STAMP%"
echo [1/7] Primer Lab kapatiliyor...
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
echo [2/7] Sadece degisen kod dosyalari yedekleniyor...
mkdir "%BACKUP%\Pages" >nul 2>&1
mkdir "%BACKUP%\Controllers" >nul 2>&1
copy /Y "%PROJECT%\Pages\Index.cshtml" "%BACKUP%\Pages\Index.cshtml" >nul
if errorlevel 1 goto FAIL_BACKUP
copy /Y "%PROJECT%\Controllers\TeknisyenlerController.cs" "%BACKUP%\Controllers\TeknisyenlerController.cs" >nul
if errorlevel 1 goto FAIL_BACKUP
echo [3/7] Teknisyen yonetim islemleri uygulaniyor...
copy /Y "%SOURCE%\Pages\Index.cshtml" "%PROJECT%\Pages\Index.cshtml" >nul
if errorlevel 1 goto ROLLBACK
copy /Y "%SOURCE%\Controllers\TeknisyenlerController.cs" "%PROJECT%\Controllers\TeknisyenlerController.cs" >nul
if errorlevel 1 goto ROLLBACK
echo [4/7] Restore ve build...
cd /d "%PROJECT%"
dotnet restore "PrimerLabV2.csproj"
if errorlevel 1 goto ROLLBACK
dotnet build "PrimerLabV2.csproj" -c Debug --no-restore
if errorlevel 1 goto ROLLBACK
echo [5/7] Uygulama baslatiliyor...
start "PrimerLabV2" /min dotnet run --project "PrimerLabV2.csproj" --no-build --urls "%URL%"
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $ok=$false; for($i=0; $i -lt 45; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){ exit 1 }"
if errorlevel 1 goto ROLLBACK
echo [6/7] Admin ve Hekim Portali kontrol ediliyor...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "try { $a=Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 15; $h=Invoke-WebRequest -UseBasicParsing '%URL%/hekim-portal' -TimeoutSec 15; if($a.StatusCode -ne 200 -or $h.StatusCode -ne 200){exit 1} } catch { exit 1 }"
if errorlevel 1 goto ROLLBACK
echo [7/7] Admin panel aciliyor...
start "" "%URL%"
echo.
echo KURULUM BASARILI - V33.07.22.7
echo Teknisyen duzenleme, aktif-pasif ve guvenli silme islemleri eklendi.
echo Veritabani semasi ve mevcut is verileri degistirilmedi.
echo App_Data, uploads, mail, backup ve secret verilerine DOKUNULMADI.
pause
exit /b 0
:ROLLBACK
echo HATA: Guncelleme basarisiz. Degisen kod dosyalari geri aliniyor...
copy /Y "%BACKUP%\Pages\Index.cshtml" "%PROJECT%\Pages\Index.cshtml" >nul
copy /Y "%BACKUP%\Controllers\TeknisyenlerController.cs" "%PROJECT%\Controllers\TeknisyenlerController.cs" >nul
echo Rollback tamamlandi. Veri dosyalarina dokunulmadi.
pause
exit /b 1
:MISSING_PACKAGE
echo HATA: Paket kod dosyalari eksik. Hicbir degisiklik yapilmadi.
pause
exit /b 1
:MISSING_PROJECT
echo HATA: Primer Lab proje klasoru bulunamadi: %PROJECT%
pause
exit /b 1
:FAIL_BACKUP
echo HATA: Kod yedegi alinamadi. Hicbir degisiklik uygulanmadi.
pause
exit /b 1
