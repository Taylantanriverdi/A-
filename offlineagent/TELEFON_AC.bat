@echo off
title Offline Agent - Telefondan Erisim
rem Guvenlik duvari ayari icin yonetici izni gerekir
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\telefon.ps1" & pause & exit /b
