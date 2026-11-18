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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0EdingKapat.ps1"
echo.
echo  Tamam: Eding ve panel kapandi. Simdi macro.cnc kopyalanabilir.
echo  Yeniden acmak icin KazimaBaslat.bat
echo.
pause
