@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title PRIMER AUTO BAR - Demo
if not exist ".venv\Scripts\python.exe" (
    echo Once KURULUM.bat dosyasini calistirin.
    pause
    exit /b 1
)
echo Sentetik All-on-4 vakasi uretiliyor ve bar aciliyor...
".venv\Scripts\python.exe" -m primer_autobar demo --out "%CD%\demo_cikti"
echo.
echo Cikti klasoru: %CD%\demo_cikti
start "" "%CD%\demo_cikti"
pause
