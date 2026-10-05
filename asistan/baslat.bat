@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
    echo Ilk kurulum yapiliyor...
    py -3 -m venv .venv || python -m venv .venv
    .venv\Scripts\python -m pip install -q -r requirements.txt
)
.venv\Scripts\python asistan.py %*
pause
