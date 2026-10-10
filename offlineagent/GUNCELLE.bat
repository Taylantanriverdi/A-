@echo off
title Offline Agent - Guncelleme
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\guncelle.ps1" & pause & exit /b
