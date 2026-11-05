@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DIGICAD - Firebase yedegi
node araclar\firebase-yedekle.js
echo.
pause
