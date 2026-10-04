@echo off
REM Asistan - ilk kurulum (Windows)
setlocal
cd /d "%~dp0"
title Asistan Kurulum

echo ============================================
echo   Kisisel Yapay Zeka Asistani - Kurulum
echo ============================================
echo.

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY goto python_yok

%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 goto python_eski

if exist ".venv\Scripts\python.exe" goto venv_hazir
echo [1/3] Sanal ortam olusturuluyor...
%PY% -m venv .venv
if errorlevel 1 goto hata
:venv_hazir

echo [2/3] Paketler yukleniyor...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto hata

echo [3/3] API anahtari
if defined DEEPSEEK_API_KEY goto anahtar_var
echo DeepSeek API anahtarini gir (https://platform.deepseek.com/api_keys adresinden alabilirsin).
set /p "ANAHTAR=API anahtari: "
if "%ANAHTAR%"=="" goto anahtar_yok
setx DEEPSEEK_API_KEY "%ANAHTAR%" >nul
echo Anahtar kaydedildi. Yeni acilan pencerelerde gecerli olacak.
goto bitti

:anahtar_var
echo API anahtari zaten tanimli.
goto bitti

:anahtar_yok
echo Anahtar girilmedi. Daha sonra su komutla ekleyebilirsin:
echo     setx DEEPSEEK_API_KEY sk-...
goto bitti

:python_yok
echo HATA: Python bulunamadi.
echo https://www.python.org/downloads/ adresinden Python 3.10 veya ustunu kur.
echo Kurulumda "Add python.exe to PATH" kutusunu isaretlemeyi unutma.
goto son

:python_eski
echo HATA: Python 3.10 veya ustu gerekli.
goto son

:hata
echo.
echo HATA: Kurulum tamamlanamadi. Yukaridaki mesajlari kontrol et.
goto son

:bitti
echo.
echo Kurulum tamamlandi.
echo   Baslatmak icin : baslat.bat
echo   Seni tanimasi  : baslat.bat ogren C:\Users\%USERNAME%\projeler
echo   Guncellemek    : guncelle.bat

:son
echo.
pause
endlocal
