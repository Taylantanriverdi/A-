@echo off
REM Asistan - en son surume guncelle
setlocal

REM Guncelleme bu dosyanin kendisini de degistirir; cmd calisirken degisen
REM bat dosyasini bozuk okur. Bu yuzden once gecici bir kopyadan calisiriz.
if /i "%~1"=="--gecici" goto basla
copy /y "%~f0" "%TEMP%\asistan_guncelle_calisan.bat" >nul
"%TEMP%\asistan_guncelle_calisan.bat" --gecici "%~dp0."

:basla
cd /d "%~2"
set "HEDEF=%CD%"
title Asistan Guncelleme

set "DEPO=Taylantanriverdi/A-"
set "DAL=claude/gifted-knuth-b3ij29"

echo ============================================
echo   Asistan guncelleniyor (%DEPO% - %DAL%)
echo ============================================
echo.

if not exist ".git" goto zip_ile
where git >nul 2>&1
if errorlevel 1 goto zip_ile

echo [1/2] Git ile en son surum aliniyor...
git fetch origin "%DAL%"
if errorlevel 1 goto hata
git checkout "%DAL%"
if errorlevel 1 goto hata
git pull --ff-only origin "%DAL%"
if errorlevel 1 goto hata
goto paketler

:zip_ile
echo [1/2] En son surum GitHub'dan indiriliyor...
set "GECICI=%TEMP%\asistan_guncelleme"
if exist "%GECICI%" rmdir /s /q "%GECICI%"
mkdir "%GECICI%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/%DEPO%/archive/refs/heads/%DAL%.zip' -OutFile '%GECICI%\guncel.zip'; Expand-Archive -Force '%GECICI%\guncel.zip' '%GECICI%\acik'"
if errorlevel 1 goto indirme_hatasi
set "KAYNAK="
for /d %%D in ("%GECICI%\acik\*") do set "KAYNAK=%%D"
if not defined KAYNAK goto indirme_hatasi
if not exist "%KAYNAK%\asistan\__main__.py" goto indirme_hatasi
xcopy "%KAYNAK%\*" "%HEDEF%\" /E /Y /Q >nul
if errorlevel 1 goto hata
rmdir /s /q "%GECICI%"

:paketler
echo [2/2] Paketler guncelleniyor...
if not exist ".venv\Scripts\python.exe" goto kurulum_gerek
".venv\Scripts\python.exe" -m pip install --upgrade -r requirements.txt
if errorlevel 1 goto hata
echo.
echo Guncelleme tamamlandi. Profilin ve notlarin (%USERPROFILE%\.asistan) korundu.
goto son

:kurulum_gerek
echo Sanal ortam bulunamadi, kurulum.bat calistiriliyor...
call kurulum.bat
goto son

:indirme_hatasi
echo HATA: Guncelleme indirilemedi.
echo Depo gizliyse indirme icin giris gerekir. Bu durumda Git kur
echo (https://git-scm.com), bu klasorde bir kez su komutu calistir:
echo     git clone -b %DAL% https://github.com/%DEPO%.git asistan
echo ve sonra guncelle.bat'i o klasorden kullan.
goto son

:hata
echo.
echo HATA: Guncelleme tamamlanamadi. Yukaridaki mesajlari kontrol et.

:son
echo.
pause
endlocal
