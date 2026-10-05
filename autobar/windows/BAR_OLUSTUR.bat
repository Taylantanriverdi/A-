@echo off
setlocal EnableExtensions EnableDelayedExpansion
title PRIMER AUTO BAR - Bar Olustur
set "ROOT=%~dp0.."
if not exist "%ROOT%\.venv\Scripts\python.exe" (
    echo Once KURULUM.bat dosyasini calistirin.
    pause
    exit /b 1
)

rem Kullanim: restorasyon .stl + implants .json (+ istege bagli params .json)
rem dosyalarini bu .bat uzerine surukleyip birakin. Sira onemli degil.
set "RESTO="
set "IMPL="
set "PARAMS="
for %%A in (%*) do (
    if /i "%%~xA"==".stl" set "RESTO=%%~fA"
    if /i "%%~xA"==".json" (
        echo %%~nA | findstr /i "param" >nul
        if errorlevel 1 (set "IMPL=%%~fA") else (set "PARAMS=%%~fA")
    )
)
if not defined RESTO (
    echo Restorasyon STL dosyasini bu pencereye surukleyip Enter'a basin:
    set /p "RESTO="
    set "RESTO=!RESTO:"=!"
)
if not defined IMPL (
    echo implants.json dosyasini bu pencereye surukleyip Enter'a basin:
    set /p "IMPL="
    set "IMPL=!IMPL:"=!"
)
if not exist "%RESTO%" ( echo STL bulunamadi: %RESTO% & pause & exit /b 1 )
if not exist "%IMPL%" ( echo implants.json bulunamadi: %IMPL% & pause & exit /b 1 )

for %%F in ("%RESTO%") do set "OUT=%%~dpnF_bar"
set "PARGS="
if defined PARAMS set PARGS=--params "%PARAMS%"

echo.
echo Restorasyon : %RESTO%
echo Implantlar  : %IMPL%
if defined PARAMS echo Parametreler: %PARAMS%
echo Cikti       : %OUT%
echo.
pushd "%ROOT%"
".venv\Scripts\python.exe" -m primer_autobar run --restoration "%RESTO%" --implants "%IMPL%" !PARGS! --out "%OUT%"
set "RC=%ERRORLEVEL%"
popd
echo.
if "%RC%"=="0" echo SONUC: PASS - bar.stl hazir.
if "%RC%"=="2" echo SONUC: FAIL - qa_report.txt dosyasindaki sorunlu bolgeleri inceleyin.
if not "%RC%"=="0" if not "%RC%"=="2" echo HATA: islem tamamlanamadi (kod %RC%).
if exist "%OUT%" start "" "%OUT%"
pause
