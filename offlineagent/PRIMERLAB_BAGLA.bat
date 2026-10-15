@echo off
title Offline Agent - PrimerLab baglantisi
@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\primerlab_bagla.ps1" & pause & exit /b
