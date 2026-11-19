@echo off
setlocal EnableExtensions
title PrimerMill 2 - Geri al
rem KURULUM.bat'in yaptigini geri alir: en son macro_yedek_*.cnc dosyasini macro.cnc yapar.
rem cnc.ini'ye dokunmaz (G54 ve kalibrasyon degerleri yeni olabilir); gerekirse cnc_yedek_*.ini elle geri konur.

set "BURA=%~dp0"
set "PANEL=%BURA%PrimerMill"
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

set "EDING="
for %%K in ("P:\CNC" "C:\CNC_X5" "C:\CNC4.03" "C:\CNC4.04" "C:\CNC4.02" "C:\CNC") do (
  if not defined EDING if exist "%%~K\cncapi.dll" set "EDING=%%~K"
)
if not defined EDING set /p "EDING= Eding klasorunu yazin (ornek C:\CNC_X5): "

set "SON="
for /f "delims=" %%F in ('dir /b /o:d "%EDING%\macro_yedek_*.cnc" 2^>nul') do set "SON=%%F"
if not defined SON (
  echo  %EDING% icinde macro_yedek_*.cnc bulunamadi.
  pause
  exit /b 1
)
echo.
echo  Eding klasoru : %EDING%
echo  Geri konacak  : %SON%  -^>  macro.cnc
echo.
choice /c EH /m " Devam edilsin mi? (E = evet, H = hayir)"
if errorlevel 2 exit /b 1

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PANEL%\EdingKapat.ps1"
if errorlevel 1 ( echo  Eding KAPATILMADI, geri alinmadi. & pause & exit /b 1 )
copy /y "%EDING%\%SON%" "%EDING%\macro.cnc" >nul
if errorlevel 1 ( echo  HATA: kopyalanamadi. & pause & exit /b 1 )
echo.
echo  Tamam: eski macro.cnc geri kondu.
echo  Eski paneli eskisi gibi acabilirsiniz (eski kisayol).
echo  Not: yeni panel surum 4 makro ister; eski makroyla is baslatmaz.
pause
exit /b 0
