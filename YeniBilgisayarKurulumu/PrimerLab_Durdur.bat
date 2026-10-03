@echo off
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
if errorlevel 1 (echo Primer Lab zaten kapali.) else (echo Primer Lab kapatildi.)
timeout /t 3 >nul
