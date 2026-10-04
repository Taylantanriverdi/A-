@echo off
REM Otopilot - Claude Code ile projeni otomatik gelistirir.
REM Cift tiklarsan proje klasorunu ve hedefi sorar. Ornekler:
REM   otopilot.bat baslat C:\projeler\uygulama --hedef "Kullanici girisi ekle"
REM   otopilot.bat gorev  C:\projeler\uygulama "Arama kutusu ekle"
REM   otopilot.bat durum  C:\projeler\uygulama
REM   otopilot.bat otomatik-kur C:\projeler\uygulama
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
set "PYTHONPATH=%~dp0;%PYTHONPATH%"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY goto python_yok

if not "%~1"=="" goto calistir

echo ============================================
echo   Otopilot - Claude Code proje gelistirici
echo ============================================
echo.
set /p "PROJE=Proje klasoru (ornek C:\projeler\uygulama): "
if "%PROJE%"=="" goto son
echo Hedef: projenin ne yone gelistirilecegini yaz. Daha once verdiysen bos birak.
set /p "HEDEF=Hedef: "
if "%HEDEF%"=="" goto hedefsiz
%PY% -m otopilot baslat "%PROJE%" --hedef "%HEDEF%"
goto son

:hedefsiz
%PY% -m otopilot baslat "%PROJE%"
goto son

:calistir
%PY% -m otopilot %*
if errorlevel 1 pause
goto bitis

:python_yok
echo HATA: Python bulunamadi. https://www.python.org/downloads/ adresinden kur.
goto son

:son
echo.
pause
:bitis
endlocal
