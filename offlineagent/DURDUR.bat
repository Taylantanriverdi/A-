@echo off
title Offline Agent - Durdur
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\durdur.ps1" & timeout /t 3 >nul & exit /b
