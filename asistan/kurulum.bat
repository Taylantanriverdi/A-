@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Kişisel Asistan - Kurulum
set "PYTHONUTF8=1"
set "DEPO=Taylantanriverdi/A-"
if not defined ASISTAN_DAL set "ASISTAN_DAL=main"
set "HEDEF=%LOCALAPPDATA%\KisiselAsistan"
set "PYKONTROL=import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"

echo ==================================================
echo    Kişisel Asistan - Kurulum
echo ==================================================
echo Kurulum klasörü: %HEDEF%
echo.

rem ---- 1) Python ------------------------------------------------------------
echo [1/5] Python kontrol ediliyor...
call :python_bul
if defined PYEXE goto python_tamam

echo      Python bulunamadı, kuruluyor...
where winget >nul 2>&1
if not errorlevel 1 (
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
    call :python_bul
)
if defined PYEXE goto python_tamam

echo      python.org'dan indiriliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile (Join-Path $env:TEMP 'python-kurulum.exe')"
if exist "%TEMP%\python-kurulum.exe" (
    "%TEMP%\python-kurulum.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
    del "%TEMP%\python-kurulum.exe" >nul 2>&1
)
call :python_bul
if defined PYEXE goto python_tamam

echo.
echo HATA: Python kurulamadı. https://www.python.org/downloads/ adresinden
echo Python'u elle kur ("Add Python to PATH" kutusunu işaretle), sonra bu dosyayı tekrar çalıştır.
pause
exit /b 1

:python_tamam
echo      Python hazır: %PYEXE%

rem ---- 2) Dosyalar ----------------------------------------------------------
echo [2/5] Asistan dosyaları hazırlanıyor...
if not exist "%HEDEF%" mkdir "%HEDEF%"
rem ZIP'ten çıkarılmış klasörden çalışıyorsa dosyaları oradan kopyala.
if exist "%~dp0asistan.py" (
    if /i not "%~dp0"=="%HEDEF%\" (
        for %%F in ("%~dp0*.py" "%~dp0*.bat" "%~dp0*.sh" "%~dp0*.txt" "%~dp0*.md") do copy /y "%%~F" "%HEDEF%\" >nul
    )
) else (
    "%PYEXE%" -c "import urllib.request as u; u.urlretrieve('https://raw.githubusercontent.com/%DEPO%/%ASISTAN_DAL%/asistan/guncelle.py', r'%HEDEF%\guncelle.py')"
)
if not exist "%HEDEF%\guncelle.py" (
    echo HATA: Dosyalar indirilemedi. İnternet bağlantını kontrol et.
    pause
    exit /b 1
)
"%PYEXE%" "%HEDEF%\guncelle.py"
if not exist "%HEDEF%\asistan.py" (
    echo HATA: Dosyalar indirilemedi. İnternet bağlantını kontrol et.
    pause
    exit /b 1
)

rem ---- 3) Kütüphaneler ------------------------------------------------------
echo [3/5] Gerekli kütüphaneler kuruluyor...
if not exist "%HEDEF%\.venv\Scripts\python.exe" "%PYEXE%" -m venv "%HEDEF%\.venv"
"%HEDEF%\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check --upgrade pip
"%HEDEF%\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r "%HEDEF%\requirements.txt"
if errorlevel 1 (
    echo HATA: Kütüphaneler kurulamadı.
    pause
    exit /b 1
)

rem ---- 4) API anahtarı ------------------------------------------------------
echo [4/5] DeepSeek API anahtarı...
if defined DEEPSEEK_API_KEY (
    echo      Kayıtlı bir DeepSeek API anahtarı bulundu.
    goto anahtar_tamam
)
echo      Anahtarını https://platform.deepseek.com/api_keys adresinden oluşturabilirsin.
:anahtar_sor
set "ANAHTAR="
set /p "ANAHTAR=     DeepSeek API anahtarını yapıştır ve Enter'a bas: "
if not defined ANAHTAR goto anahtar_sor
setx DEEPSEEK_API_KEY "%ANAHTAR%" >nul
set "DEEPSEEK_API_KEY=%ANAHTAR%"
set "ANAHTAR="
echo      Anahtar kaydedildi.
:anahtar_tamam

rem ---- 5) Kısayollar --------------------------------------------------------
echo [5/5] Masaüstü ve Başlat menüsü kısayolları oluşturuluyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w = New-Object -ComObject WScript.Shell; $h = Join-Path $env:LOCALAPPDATA 'KisiselAsistan'; foreach ($k in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $w.CreateShortcut((Join-Path $k 'Kisisel Asistan.lnk')); $l.TargetPath = (Join-Path $h 'baslat.bat'); $l.WorkingDirectory = $h; $l.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',15'; $l.Save() }"

echo.
echo ==================================================
echo    Kurulum tamamlandı!
echo    Masaüstündeki "Kisisel Asistan" kısayoluyla başlatabilirsin.
echo    Her açılışta en yeni sürüme otomatik güncellenir.
echo ==================================================
echo.
choice /c EH /m "Şimdi başlatılsın mı? (E=Evet, H=Hayır)"
if errorlevel 2 exit /b 0
start "Kişisel Asistan" "%HEDEF%\baslat.bat"
exit /b 0

rem ---- Yardımcı: uygun Python'u bul (3.10+) ---------------------------------
:python_bul
set "PYEXE="
for %%K in ("py -3" "python") do (
    if not defined PYEXE (
        %%~K -c "%PYKONTROL%" >nul 2>&1 && for /f "delims=" %%P in ('%%~K -c "import sys; print(sys.executable)"') do set "PYEXE=%%P"
    )
)
if defined PYEXE exit /b 0
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if not defined PYEXE if exist "%%~D\python.exe" (
        "%%~D\python.exe" -c "%PYKONTROL%" >nul 2>&1 && set "PYEXE=%%~D\python.exe"
    )
)
exit /b 0
