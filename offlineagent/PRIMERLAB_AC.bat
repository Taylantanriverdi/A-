@echo off
title Offline Agent - PrimerLab
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\primerlab_ac.ps1" & exit /b
