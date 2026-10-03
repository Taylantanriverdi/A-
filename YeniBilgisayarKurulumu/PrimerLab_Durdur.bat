@echo off
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
if errorlevel 1 (echo Primer Lab zaten kapali.) else (echo Primer Lab kapatildi.)
timeout /t 3 >nul
