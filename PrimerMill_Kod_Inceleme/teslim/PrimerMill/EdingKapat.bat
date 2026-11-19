@echo off
rem PrimerMill - Eding CNC'yi ve paneli tamamen kapatir
title Eding'i kapat
echo.
echo  Eding CNC ve PrimerMill paneli tamamen kapatilacak.
echo  Makine hareket ediyorsa / kaziyorsa KAPATMA.
echo.
choice /c EH /m " Devam edilsin mi? (E = evet, H = hayir)"
if errorlevel 2 exit /b
echo.
rem Eding cncapi.dll 32 bit: is durumunu sorabilmek icin 32 bit PowerShell (PS-07)
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0EdingKapat.ps1"
if errorlevel 1 goto kapatilmadi
echo.
echo  Tamam: Eding ve panel kapandi. Simdi macro.cnc kopyalanabilir.
echo  Yeniden acmak icin KazimaBaslat.bat
echo.
pause
exit /b 0
:kapatilmadi
echo.
echo  Eding ve panel KAPATILMADI.
echo.
pause
exit /b 1
