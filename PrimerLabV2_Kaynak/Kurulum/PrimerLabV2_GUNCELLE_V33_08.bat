@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Primer Lab V33.08 HATA DUZELTMELERI
set "SOURCE=%~dp0PrimerLabV2"
set "PROJECT=C:\Users\Primer\Desktop\DentalLab\PrimerLabV2\PrimerLabV2"
set "BACKUPROOT=C:\Users\Primer\Desktop\DentalLab\PrimerLabV2\AUTO_BACKUPS"
set "URL=http://localhost:5169"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"
echo ============================================================
echo PRIMER LAB V33.08 - HATA DUZELTMELERI
echo ============================================================
if not exist "%SOURCE%\Pages\Index.cshtml" goto MISSING_PACKAGE
if not exist "%SOURCE%\Controllers\CariKurallari.cs" goto MISSING_PACKAGE
if not exist "%SOURCE%\Tools\legacy_import.py" goto MISSING_PACKAGE
if not exist "%SOURCE%\Infrastructure\PrimerLabSecurityMiddleware.cs" goto MISSING_PACKAGE
if not exist "%PROJECT%\PrimerLabV2.csproj" goto MISSING_PROJECT
set "STAMP=%DATE:/=-%_%TIME::=-%_%RANDOM%"
set "STAMP=%STAMP: =0%"
set "STAMP=%STAMP:,=-%"
set "BACKUP=%BACKUPROOT%\V33.08_%STAMP%"
echo [1/7] Primer Lab kapatiliyor...
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
echo [2/7] Degisecek kod klasorleri yedekleniyor...
robocopy "%PROJECT%\Controllers" "%BACKUP%\Controllers" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto FAIL_BACKUP
robocopy "%PROJECT%\Infrastructure" "%BACKUP%\Infrastructure" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto FAIL_BACKUP
robocopy "%PROJECT%\Pages" "%BACKUP%\Pages" Index.cshtml /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto FAIL_BACKUP
if exist "%PROJECT%\Tools" (
    robocopy "%PROJECT%\Tools" "%BACKUP%\Tools" /E /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto FAIL_BACKUP
)
echo [3/7] Duzeltmeler uygulaniyor...
robocopy "%SOURCE%\Controllers" "%PROJECT%\Controllers" *.cs /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto ROLLBACK
robocopy "%SOURCE%\Infrastructure" "%PROJECT%\Infrastructure" *.cs /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto ROLLBACK
copy /Y "%SOURCE%\Pages\Index.cshtml" "%PROJECT%\Pages\Index.cshtml" >nul
if errorlevel 1 goto ROLLBACK
if not exist "%PROJECT%\Tools" mkdir "%PROJECT%\Tools"
copy /Y "%SOURCE%\Tools\legacy_import.py" "%PROJECT%\Tools\legacy_import.py" >nul
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
echo KURULUM BASARILI - V33.08
echo Yedek klasoru: %BACKUP%
echo ONEMLI: OKU_BENI.txt icindeki "Veritabani sayac esitleme" adimini bir kez yapin.
echo App_Data, uploads, mail, backup ve secret verilerine DOKUNULMADI.
pause
exit /b 0
:ROLLBACK
echo HATA: Guncelleme basarisiz. Kod dosyalari geri aliniyor...
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
rem /MIR: Controllers klasorunu yedekle birebir ayni yapar (yeni eklenen dosyalar da silinir).
robocopy "%BACKUP%\Controllers" "%PROJECT%\Controllers" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto ROLLBACK_COPY_FAIL
robocopy "%BACKUP%\Infrastructure" "%PROJECT%\Infrastructure" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto ROLLBACK_COPY_FAIL
copy /Y "%BACKUP%\Pages\Index.cshtml" "%PROJECT%\Pages\Index.cshtml" >nul
if errorlevel 1 goto ROLLBACK_COPY_FAIL
if exist "%BACKUP%\Tools" (
    robocopy "%BACKUP%\Tools" "%PROJECT%\Tools" /MIR /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto ROLLBACK_COPY_FAIL
)
echo Eski surum yeniden derleniyor ve baslatiliyor...
cd /d "%PROJECT%"
dotnet build "PrimerLabV2.csproj" -c Debug
if errorlevel 1 goto ROLLBACK_BUILD_FAIL
start "PrimerLabV2" /min dotnet run --project "PrimerLabV2.csproj" --no-build --urls "%URL%"
echo Rollback tamamlandi. Eski surum tekrar calisiyor. Veri dosyalarina dokunulmadi.
pause
exit /b 1
:ROLLBACK_COPY_FAIL
echo KRITIK: Yedek dosyalar geri kopyalanamadi.
echo Yedek klasoru: %BACKUP%
echo Bu klasordeki Controllers, Infrastructure, Pages ve Tools dosyalarini proje klasorune elle kopyalayin.
pause
exit /b 1
:ROLLBACK_BUILD_FAIL
echo KRITIK: Dosyalar geri alindi ancak eski surum derlenemedi.
echo Yedek klasoru: %BACKUP%
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
