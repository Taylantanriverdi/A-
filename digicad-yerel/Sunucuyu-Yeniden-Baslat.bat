@echo off
chcp 65001 >nul
rem Yonetici izni yoksa kendini yonetici olarak yeniden acar
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title DIGICAD - Sunucuyu yeniden baslat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0araclar\servis.ps1" -Islem baslat
echo.
pause
