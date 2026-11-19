@echo off
rem KURULUM.bat'in yaptigini geri alir: en son macro_yedek_*.cnc dosyasini macro.cnc yapar.
rem cnc.ini'ye dokunmaz; gerekirse cnc_yedek_*.ini elle geri konur.
if "%~1"=="/ic" goto basla
start "PrimerMill 2 - Geri al" cmd /k call "%~f0" /ic
exit /b

:basla
setlocal EnableExtensions
set "BURA=%~dp0"
set "PANEL=%BURA%PrimerMill"
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

set "EDING="
for %%K in ("P:\CNC" "C:\CNC_X5" "C:\CNC4.03" "C:\CNC4.04" "C:\CNC4.02" "C:\CNC") do if not defined EDING if exist "%%~K\cncapi.dll" set "EDING=%%~K"
if defined EDING goto bul
set /p "EDING= Eding klasorunu yazin, ornek C:\CNC_X5 : "
:bul
set "SON="
for /f "delims=" %%F in ('dir /b /o:d "%EDING%\macro_yedek_*.cnc" 2^>nul') do set "SON=%%F"
if defined SON goto var
echo  %EDING% icinde macro_yedek_*.cnc bulunamadi.
goto son
:var
echo.
echo  Eding klasoru : %EDING%
echo  Geri konacak  : %SON%  =  macro.cnc
echo.
set "CEVAP="
set /p "CEVAP= Devam edilsin mi? E = evet, H = hayir, sonra Enter: "
if /i not "%CEVAP%"=="E" goto son
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PANEL%\EdingKapat.ps1"
if errorlevel 1 goto kapanmadi
copy /y "%EDING%\%SON%" "%EDING%\macro.cnc" >nul
if errorlevel 1 goto kopya_hata
echo.
echo  Tamam: eski macro.cnc geri kondu. Eski paneli eskisi gibi acabilirsiniz.
echo  Not: yeni panel surum 4 makro ister; eski makroyla is baslatmaz.
goto son
:kapanmadi
echo  Eding KAPATILMADI, geri alinmadi.
goto son
:kopya_hata
echo  HATA: kopyalanamadi.
:son
echo.
echo  Pencereyi kapatabilirsiniz.
exit /b
