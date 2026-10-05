@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
title Kişisel Asistan
rem Tüm dosya parantez bloğu içinde: cmd bloğu baştan okur, böylece
rem güncelleyici bu dosyayı çalışırken değiştirse bile sorun çıkmaz.
(
    if not exist ".venv\Scripts\python.exe" (
        echo İlk kurulum yapılıyor, biraz sürebilir...
        py -3 -m venv .venv >nul 2>&1 || python -m venv .venv
        if not exist ".venv\Scripts\python.exe" (
            echo.
            echo Python bulunamadı. Lütfen önce kurulum.bat dosyasını çalıştır.
            pause
            exit /b 1
        )
        ".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
    )
    ".venv\Scripts\python.exe" guncelle.py
    ".venv\Scripts\python.exe" asistan.py %*
    echo.
    pause
    exit /b
)
