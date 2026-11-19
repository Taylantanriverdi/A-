@echo off
rem PrimerMill 2 kurulumu: Eding'i kapatir, eski macro.cnc ve cnc.ini'yi yedekler,
rem yeni macro.cnc'yi Eding klasorune kopyalar, masaustune kisayol koyar ve yeni paneli acar.
rem Geri almak icin: GERI_AL.bat
rem Not: klasor adinda parantez olabilir (ornek "PrimerMill2 (1)"), bu yuzden parantezli blok kullanilmaz.

rem Pencere hata olsa da acik kalsin: kendini cmd /k ile yeniden acar
if "%~1"=="/ic" goto basla
start "PrimerMill 2 - Kurulum" cmd /k call "%~f0" /ic
exit /b

:basla
setlocal EnableExtensions
title PrimerMill 2 - Kurulum
set "BURA=%~dp0"
set "PANEL=%BURA%PrimerMill"
set "YENIMAKRO=%BURA%Eding_klasorune\macro.cnc"
if not exist "%YENIMAKRO%" set "YENIMAKRO=%BURA%P_CNC_icin\macro.cnc"
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo.
echo  ==============================================
echo   PrimerMill 2 - Kurulum
echo  ==============================================
echo.
echo  Bu klasor: %BURA%
echo.

if exist "%PANEL%\KazimaBaslat.ps1" goto panel_var
echo  HATA: Yeni panel bulunamadi: %PANEL%
echo  Zip'i once AYIKLAYIN, sonra bu dosyayi ayiklanan klasorden calistirin.
goto son_hata
:panel_var
if exist "%YENIMAKRO%" goto makro_var
echo  HATA: Yeni macro.cnc bulunamadi.
goto son_hata
:makro_var

rem --- Eding klasorunu bul (cncapi.dll olan ilk klasor) ---
set "EDING="
for %%K in ("P:\CNC" "C:\CNC_X5" "C:\CNC4.03" "C:\CNC4.04" "C:\CNC4.02" "C:\CNC") do if not defined EDING if exist "%%~K\cncapi.dll" set "EDING=%%~K"
if defined EDING goto eding_var
echo  Eding klasoru bulunamadi - cncapi.dll yok.
set /p "EDING= Eding klasorunu yazin, ornek C:\CNC_X5 : "
:eding_var
if exist "%EDING%\cncapi.dll" goto eding_tamam
echo  HATA: "%EDING%" icinde cncapi.dll yok.
goto son_hata
:eding_tamam

echo  Eding klasoru : %EDING%
echo  Yeni panel    : %PANEL%
echo.
echo  Yapilacaklar:
echo    1. Eding ve acik panel kapatilir - is calisiyorsa KAPATMAZ, durur
echo    2. %EDING%\macro.cnc ve cnc.ini yedeklenir
echo    3. Yeni macro.cnc - surum 5 - kopyalanir
echo    4. Masaustune "PrimerMill 2" kisayolu konur
echo    5. Yeni panel acilir
echo.
echo  Makine hareket ediyorsa / kaziyorsa DEVAM ETMEYIN.
echo.
set "CEVAP="
set /p "CEVAP= Devam edilsin mi? E = evet, H = hayir, sonra Enter: "
if /i "%CEVAP%"=="E" goto devam
echo  Iptal edildi, hicbir sey degismedi.
goto son

:devam
echo.
echo  [1/5] Eding ve panel kapatiliyor...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PANEL%\EdingKapat.ps1"
if not errorlevel 1 goto kapandi
echo  Eding KAPATILMADI. Kurulum durduruldu, hicbir dosya degismedi.
goto son_hata
:kapandi

set "TS="
for /f "usebackq delims=" %%T in (`call "%PS%" -NoProfile -Command Get-Date -Format yyyyMMdd_HHmmss`) do set "TS=%%T"
if not defined TS set "TS=yedek"
echo  [2/5] Yedek aliniyor: %TS%
if not exist "%EDING%\macro.cnc" goto ini_yedek
copy /y "%EDING%\macro.cnc" "%EDING%\macro_yedek_%TS%.cnc" >nul
if errorlevel 1 goto yedek_hata
echo        %EDING%\macro_yedek_%TS%.cnc
:ini_yedek
if not exist "%EDING%\cnc.ini" goto makro_kopyala
copy /y "%EDING%\cnc.ini" "%EDING%\cnc_yedek_%TS%.ini" >nul
if errorlevel 1 goto yedek_hata
echo        %EDING%\cnc_yedek_%TS%.ini

:makro_kopyala
echo  [3/5] Yeni macro.cnc kopyalaniyor...
copy /y "%YENIMAKRO%" "%EDING%\macro.cnc" >nul
if errorlevel 1 goto kopya_hata
findstr /c:"#4038 = 5" "%EDING%\macro.cnc" >nul
if errorlevel 1 goto surum_hata
echo        Tamam: makro surum 5

echo  [4/5] Masaustu kisayolu: PrimerMill 2
"%PS%" -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\PrimerMill 2.lnk'); $s.TargetPath='%PANEL%\KazimaBaslat.bat'; $s.WorkingDirectory='%PANEL%'; $s.Save()" >nul 2>&1

echo  [5/5] Yeni panel aciliyor - Eding'i kendisi baslatir...
call "%PANEL%\KazimaBaslat.bat"
echo.
echo  KURULUM TAMAM.
echo  Yeni panel: solda dikey menu - Uretim, Takimlar, Kalibrasyon, Ayarlar.
echo  Sonraki acilislarda masaustundeki "PrimerMill 2" kisayolunu kullanin.
echo  Geri almak icin: GERI_AL.bat
goto son

:yedek_hata
echo  HATA: yedek alinamadi. macro.cnc degistirilmedi.
goto son_hata
:kopya_hata
echo  HATA: macro.cnc kopyalanamadi - dosya acik olabilir.
goto son_hata
:surum_hata
echo  HATA: kopyalanan macro.cnc surum 5 degil.
goto son_hata

:son_hata
echo.
echo  Bu pencerenin ekran goruntusunu gonderin.
:son
echo.
echo  Pencereyi kapatabilirsiniz.
exit /b
