@echo off
setlocal
rem Windows dosya secme penceresi acar (1 veya 2 NC dosyasi secilebilir).
if not exist "%~dp0NC_Simulator.html" goto yok
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0arac\baslat.ps1" -Sec
if errorlevel 1 start "" "%~dp0NC_Simulator.html"
exit /b 0
:yok
echo.
echo  [HATA] NC_Simulator.html bulunamadi. ZIP dosyasini once klasore cikarin
echo  (sag tik ^> "Tumunu ayikla").
echo.
pause
exit /b 1
