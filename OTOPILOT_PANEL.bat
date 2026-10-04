@echo off
REM Otopilot canli izleme panelini tarayicida acar: http://127.0.0.1:8765
REM Panelden baslatma, durdurma, gorev ekleme ve hedef duzenleme yapilabilir.
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set "PYTHONPATH=%~dp0;%PYTHONPATH%"
set "PATH=%LOCALAPPDATA%\Programs\Python\Launcher;%LOCALAPPDATA%\Programs\Python\Python313;%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY goto python_yok
title Otopilot Panel
echo Panel aciliyor: http://127.0.0.1:8765
echo Paneli kapatmak icin bu pencereyi kapat. (Otopilot calismaya devam eder.)
%PY% -m otopilot arayuz
goto son
:python_yok
echo HATA: Python bulunamadi. Once OTOPILOT_BASLAT.bat dosyasini calistir.
:son
echo.
pause
endlocal
