@echo off
REM Asistan - baslat. Ornekler:
REM   baslat.bat                         sohbet modu
REM   baslat.bat "Not Defteri'ni ac"     tek seferlik gorev
REM   baslat.bat ogren C:\projeler       profil cikar
REM   baslat.bat otonom C:\projeler\app  otonom yazilim modu
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONUTF8=1

if exist ".venv\Scripts\python.exe" goto calistir
echo Once kurulum.bat dosyasini calistir.
pause
exit /b 1

:calistir
".venv\Scripts\python.exe" -m asistan %*
if "%~1"=="" pause
endlocal
