@echo off
title Offline Agent
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\baslat.ps1" & exit /b
