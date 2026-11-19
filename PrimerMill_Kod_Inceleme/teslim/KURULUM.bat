@echo off
setlocal EnableExtensions
title PrimerMill 2 - Kurulum
rem PrimerMill 2 kurulumu: Eding'i kapatir, eski macro.cnc ve cnc.ini'yi yedekler,
rem yeni macro.cnc'yi Eding klasorune kopyalar, masaustune kisayol koyar ve yeni paneli acar.
rem Geri almak icin: GERI_AL.bat

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

if not exist "%PANEL%\KazimaBaslat.ps1" (
  echo  HATA: Yeni panel bulunamadi: %PANEL%
  echo  Bu dosyayi zip'ten cikan klasorun icinden calistirin.
  goto son_hata
)
if not exist "%YENIMAKRO%" (
  echo  HATA: Yeni macro.cnc bulunamadi.
  goto son_hata
)

rem --- 1) Eding klasorunu bul (cncapi.dll olan ilk klasor) ---
set "EDING="
for %%K in ("P:\CNC" "C:\CNC_X5" "C:\CNC4.03" "C:\CNC4.04" "C:\CNC4.02" "C:\CNC") do (
  if not defined EDING if exist "%%~K\cncapi.dll" set "EDING=%%~K"
)
if not defined EDING (
  echo  Eding klasoru bulunamadi ^(cncapi.dll yok^).
  set /p "EDING= Eding klasorunu yazin (ornek C:\CNC_X5): "
)
if not exist "%EDING%\cncapi.dll" (
  echo  HATA: "%EDING%" icinde cncapi.dll yok.
  goto son_hata
)
echo  Eding klasoru : %EDING%
echo  Yeni panel    : %PANEL%
echo.
echo  Yapilacaklar:
echo    1. Eding ve acik panel kapatilir (is calisiyorsa KAPATMAZ, durur)
echo    2. %EDING%\macro.cnc ve cnc.ini yedeklenir
echo    3. Yeni macro.cnc (surum 4) kopyalanir
echo    4. Masaustune "PrimerMill 2" kisayolu konur
echo    5. Yeni panel acilir
echo.
echo  Makine hareket ediyorsa / kaziyorsa DEVAM ETMEYIN.
choice /c EH /m " Devam edilsin mi? (E = evet, H = hayir)"
if errorlevel 2 goto iptal

rem --- 2) Eding ve paneli kapat ---
echo.
echo  [1/5] Eding ve panel kapatiliyor...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PANEL%\EdingKapat.ps1"
if errorlevel 1 (
  echo  Eding KAPATILMADI. Kurulum durduruldu, hicbir dosya degismedi.
  goto son_hata
)

rem --- 3) Yedek ---
for /f "usebackq delims=" %%T in (`call "%PS%" -NoProfile -Command Get-Date -Format yyyyMMdd_HHmmss`) do set "TS=%%T"
if not defined TS set "TS=yedek"
echo  [2/5] Yedek aliniyor (%TS%)...
if exist "%EDING%\macro.cnc" (
  copy /y "%EDING%\macro.cnc" "%EDING%\macro_yedek_%TS%.cnc" >nul
  if errorlevel 1 ( echo  HATA: macro.cnc yedeklenemedi. & goto son_hata )
  echo        %EDING%\macro_yedek_%TS%.cnc
)
if exist "%EDING%\cnc.ini" (
  copy /y "%EDING%\cnc.ini" "%EDING%\cnc_yedek_%TS%.ini" >nul
  if errorlevel 1 ( echo  HATA: cnc.ini yedeklenemedi. & goto son_hata )
  echo        %EDING%\cnc_yedek_%TS%.ini
)

rem --- 4) Yeni makro ---
echo  [3/5] Yeni macro.cnc kopyalaniyor...
copy /y "%YENIMAKRO%" "%EDING%\macro.cnc" >nul
if errorlevel 1 ( echo  HATA: macro.cnc kopyalanamadi ^(dosya acik olabilir^). & goto son_hata )
findstr /c:"#4038 = 4" "%EDING%\macro.cnc" >nul
if errorlevel 1 ( echo  HATA: kopyalanan macro.cnc surum 4 degil. & goto son_hata )
echo        Tamam: makro surum 4

rem --- 5) Masaustu kisayolu ---
echo  [4/5] Masaustu kisayolu: PrimerMill 2
"%PS%" -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\PrimerMill 2.lnk'); $s.TargetPath='%PANEL%\KazimaBaslat.bat'; $s.WorkingDirectory='%PANEL%'; $s.Save()" >nul 2>&1

rem --- 6) Yeni paneli ac ---
echo  [5/5] Yeni panel aciliyor (Eding'i kendisi baslatir)...
call "%PANEL%\KazimaBaslat.bat"
echo.
echo  KURULUM TAMAM.
echo  Yeni panel: solda dikey menu (Uretim, Takimlar, Kalibrasyon, Ayarlar...).
echo  Sonraki acilislarda masaustundeki "PrimerMill 2" kisayolunu kullanin.
echo  Geri almak icin: GERI_AL.bat
echo.
pause
exit /b 0

:iptal
echo  Iptal edildi, hicbir sey degismedi.
pause
exit /b 1

:son_hata
echo.
pause
exit /b 1
