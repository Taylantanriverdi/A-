@echo off
setlocal EnableExtensions
title PRIMER AUTO BAR - Blender eklentisi
set "ROOT=%~dp0.."
for %%R in ("%ROOT%") do set "ROOT=%%~fR"
set "VPY=%ROOT%\.venv\Scripts\python.exe"
set "SRC=%ROOT%\blender\primer_autobar_addon.py"
set "BASE=%APPDATA%\Blender Foundation\Blender"

if not exist "%VPY%" (
    echo Once KURULUM.bat dosyasini calistirin.
    goto :end
)
if not exist "%BASE%" (
    echo Blender ayar klasoru bulunamadi: %BASE%
    echo Blender'i bir kez acip kapatin ve bu dosyayi tekrar calistirin.
    echo Ya da Blender'da: Edit ^> Preferences ^> Add-ons ^> Install... ile
    echo   %SRC%
    echo dosyasini secin.
    goto :end
)

set "N=0"
for /d %%V in ("%BASE%\*") do (
    if not exist "%%V\scripts\addons" mkdir "%%V\scripts\addons"
    copy /y "%SRC%" "%%V\scripts\addons\primer_autobar_addon.py" >nul
    "%VPY%" -c "import json,sys; json.dump({'python_exe': sys.argv[1], 'package_dir': sys.argv[2]}, open(sys.argv[3], 'w', encoding='utf-8'), indent=2)" "%VPY%" "%ROOT%" "%%V\scripts\addons\primer_autobar_addon_config.json"
    echo   Kuruldu: Blender %%~nxV
    set /a N+=1
)
echo.
echo Blender'da: Edit ^> Preferences ^> Add-ons ^> "PRIMER AUTO BAR" kutusunu isaretleyin.
echo Sonra 3D gorunumde N tusu ^> AutoBar sekmesi.

:end
if /i not "%~1"=="nopause" pause
