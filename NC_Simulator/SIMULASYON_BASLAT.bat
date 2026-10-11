@echo off
setlocal
rem ================================================================
rem  Dental NC Simulatoru - baslatici
rem  - Cift tiklayin: program acilir.
rem  - NC dosyasini bu dosyanin UZERINE surukleyin: yuklenmis acilir.
rem    Iki dosya birakirsaniz ikincisi karsilastirma dosyasidir.
rem ================================================================
if not exist "%~dp0NC_Simulator.html" goto yok
if not exist "%~dp0arac\baslat.ps1" goto direkt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0arac\baslat.ps1" %*
if errorlevel 1 goto direkt
exit /b 0

:direkt
echo PowerShell kullanilamadi, program varsayilan tarayicida aciliyor...
start "" "%~dp0NC_Simulator.html"
timeout /t 3 >nul
exit /b 0

:yok
echo.
echo  [HATA] NC_Simulator.html bulunamadi.
echo  ZIP dosyasini once bir klasore CIKARIN:
echo  ZIP'e sag tiklayin ^> "Tumunu ayikla" ^> cikan klasordeki
echo  SIMULASYON_BASLAT.bat dosyasini calistirin.
echo.
pause
exit /b 1
