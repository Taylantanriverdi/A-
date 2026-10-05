@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Kişisel Asistan - Kaldır
rem Kendi klasörünü silebilmek için önce geçici klasöre kopyalanıp oradan çalışır.
if /i not "%~nx0"=="kisisel-asistan-kaldir.bat" (
    copy /y "%~f0" "%TEMP%\kisisel-asistan-kaldir.bat" >nul
    "%TEMP%\kisisel-asistan-kaldir.bat"
    exit /b
)
set "HEDEF=%LOCALAPPDATA%\KisiselAsistan"
echo Kişisel Asistan bilgisayarından kaldırılacak:
echo   %HEDEF%
echo   Masaüstü ve Başlat menüsü kısayolları
echo.
choice /c EH /m "Devam edilsin mi? (E=Evet, H=Hayır)"
if errorlevel 2 exit /b 0

if exist "%HEDEF%" rmdir /s /q "%HEDEF%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($k in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { Remove-Item -ErrorAction SilentlyContinue (Join-Path $k 'Kisisel Asistan.lnk') }"

choice /c EH /m "Kayıtlı API anahtarları da silinsin mi? (E=Evet, H=Hayır)"
if not errorlevel 2 (
    reg delete "HKCU\Environment" /v DEEPSEEK_API_KEY /f >nul 2>&1
    reg delete "HKCU\Environment" /v ANTHROPIC_API_KEY /f >nul 2>&1
)

echo.
echo Kaldırma tamamlandı.
pause
(del "%~f0" & exit /b 0)
