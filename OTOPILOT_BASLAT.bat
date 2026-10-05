@echo off
REM ==========================================================================
REM  OTOPILOT - TEK TIKLA KURULUM VE BASLATMA
REM  Cift tikla. Eksik olanlari kurar (Python, Git), kodlayiciyi hazirlar
REM  (DeepSeek API anahtari ya da yerel Ollama modeli), paneli acar ve
REM  otopilotu baslatir. Projeler panelden eklenir.
REM  Sonraki acilislarda kaldigi yerden devam eder.
REM ==========================================================================
setlocal EnableExtensions
chcp 65001 >nul
set PYTHONUTF8=1
set "BURASI=%~dp0"
set "PYTHONPATH=%BURASI%;%PYTHONPATH%"
set "VERI=%USERPROFILE%\.otopilot"
if not exist "%VERI%" mkdir "%VERI%"
title Otopilot

REM Yeni kurulan programlar bu pencerede de gorunsun diye bilinen klasorleri PATH'e ekle
set "PATH=%USERPROFILE%\.local\bin;%LOCALAPPDATA%\Programs\Ollama;%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Python\Launcher;%LOCALAPPDATA%\Programs\Python\Python313;%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"

echo ==========================================================
echo    OTOPILOT - projelerini otomatik gelistirir
echo ==========================================================
echo.

REM ---------------------------------------------------------------- 1. Python
echo [1/5] Python kontrol ediliyor...
call :python_bul
if defined PY goto python_tamam
echo       Python yok, kuruluyor...
call :winget_kontrol || goto son
winget install --id Python.Python.3.12 -e --scope user --silent --accept-package-agreements --accept-source-agreements
call :python_bul
if defined PY goto python_tamam
echo HATA: Python kurulamadi. https://www.python.org/downloads/ adresinden elle kur,
echo kurulumda "Add python.exe to PATH" kutusunu isaretle ve bu dosyayi tekrar calistir.
start "" https://www.python.org/downloads/
goto son
:python_tamam
echo       Tamam.

REM ---------------------------------------------------------------- 2. Git
echo [2/5] Git kontrol ediliyor...
where git >nul 2>&1
if not errorlevel 1 goto git_tamam
echo       Git yok, kuruluyor (izin penceresi cikarsa Evet de)...
call :winget_kontrol || goto son
winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
where git >nul 2>&1
if not errorlevel 1 goto git_tamam
echo HATA: Git kurulamadi. https://git-scm.com/download/win adresinden elle kur ve tekrar calistir.
start "" https://git-scm.com/download/win
goto son
:git_tamam
echo       Tamam.

REM ---------------------------------------------------------------- 3. Paketler
echo [3/5] Gerekli Python paketi kontrol ediliyor...
%PY% -c "import openai" >nul 2>&1
if not errorlevel 1 goto paket_tamam
echo       openai paketi kuruluyor...
%PY% -m pip install --user --quiet --disable-pip-version-check openai
%PY% -c "import openai" >nul 2>&1
if not errorlevel 1 goto paket_tamam
echo HATA: openai paketi kurulamadi. Internet baglantini kontrol edip tekrar calistir.
goto son
:paket_tamam
echo       Tamam.

REM ---------------------------------------------------------------- 4. Kodlayici (DeepSeek ya da Ollama)
set "MOTOR="
for /f "delims=" %%m in ('%PY% -m otopilot varsayilan 2^>nul') do set "MOTOR=%%m"
if /i "%MOTOR%"=="ollama" goto ollama_hazirla
if /i "%MOTOR%"=="deepseek" goto deepseek_anahtar
if defined DEEPSEEK_API_KEY goto deepseek_sec_kaydet
echo.
echo [4/5] Kodu hangi yapay zeka yazsin?
echo       [D] DeepSeek  - bulutta calisir, kalitelidir, ucretlidir (API anahtari + bakiye gerekir)
echo       [O] Ollama    - kendi bilgisayarinda calisir, ucretsizdir; guclu ekran karti onerilir
choice /c DO /n /m "      Secimin [D/O] : "
if errorlevel 2 goto ollama_kur

:deepseek_sec_kaydet
%PY% -m otopilot varsayilan --ayarla deepseek >nul 2>&1
:deepseek_anahtar
echo [4/5] DeepSeek API anahtari kontrol ediliyor...
if defined DEEPSEEK_API_KEY goto anahtar_tamam
echo.
echo       DeepSeek API anahtari gerekli. Tarayicida anahtar sayfasi aciliyor:
echo       giris yap, "Create new API key" ile anahtar olustur ve buraya yapistir.
echo       (Hesabinda bakiye olmasi gerekir.)
start "" https://platform.deepseek.com/api_keys
echo.
set "DEEPSEEK_API_KEY="
set /p "DEEPSEEK_API_KEY=      API anahtari: "
if not defined DEEPSEEK_API_KEY goto anahtar_yok
setx DEEPSEEK_API_KEY "%DEEPSEEK_API_KEY%" >nul
echo       Anahtar kaydedildi.
:anahtar_tamam
echo       Tamam.
goto kodlayici_tamam

:ollama_kur
echo.
echo [4/5] Ollama hazirlaniyor...
call :ollama_bul
if defined OLLAMA goto ollama_var
echo       Ollama yok, kuruluyor...
call :winget_kontrol || goto son
winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements
call :ollama_bul
if defined OLLAMA goto ollama_var
echo HATA: Ollama kurulamadi. https://ollama.com/download adresinden elle kur ve tekrar calistir.
start "" https://ollama.com/download
goto son
:ollama_var
call :ollama_baslat || goto son
echo.
echo       Simdi otopilotun kullanacagi modeli sec. Ilk seferde model indirilir (birkac GB).
%PY% -m otopilot ollama-kur --tum-projeler
if errorlevel 1 goto son
goto kodlayici_tamam

:ollama_hazirla
echo [4/5] Ollama kontrol ediliyor...
call :ollama_bul
if not defined OLLAMA goto ollama_kur
call :ollama_baslat || goto son
echo       Tamam.

:kodlayici_tamam

REM ---------------------------------------------------------------- 5. Otomatik baslatma (bir kez sorulur)
if exist "%VERI%\otomatik_soruldu" goto calistir
echo.
choice /c EH /n /m "[5/5] Bilgisayar her acildiginda otopilot kendiliginden baslasin mi? [E/H] : "
set "CEVAP=%errorlevel%"
>"%VERI%\otomatik_soruldu" echo 1
if "%CEVAP%"=="2" goto calistir
%PY% -m otopilot otomatik-kur

:calistir
REM Paneli arka planda ac; projeler panelden eklenir
start "Otopilot Panel" /min %PY% -m otopilot arayuz
echo.
echo ==========================================================
echo  Otopilot paneli tarayicida aciliyor: http://127.0.0.1:8765
echo.
echo  - "Proje ekle" ile eski yazilimlarini ekle (tek tek ya da
echo    bir klasordeki hepsini birden).
echo  - Otomatik gelistirmesi acik projeler sirayla gelistirilir.
echo  - Bu pencereyi kapatirsan durur; panelden Baslat ile ya da
echo    bu dosyayla tekrar baslatinca kaldigi yerden devam eder.
echo ==========================================================
echo.
%PY% -m otopilot hepsi
goto son

:anahtar_yok
echo HATA: Anahtar girilmedi. Dosyayi tekrar calistir.
goto son

REM ======================================================== yardimci bolumler
:python_bul
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=py -3" && exit /b 0
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=python"
exit /b 0

:ollama_bul
set "OLLAMA="
for /f "delims=" %%o in ('where ollama 2^>nul') do if not defined OLLAMA set "OLLAMA=%%o"
if not defined OLLAMA if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
exit /b 0

:ollama_baslat
REM Ollama sunucusu kapaliysa arka planda baslat ve hazir olmasini bekle (en fazla ~60 sn)
%PY% -c "import sys; from otopilot import ollama; sys.exit(0 if ollama.calisiyor_mu() else 1)" >nul 2>&1
if not errorlevel 1 exit /b 0
echo       Ollama baslatiliyor...
start "Ollama" /min "%OLLAMA%" serve
for /l %%i in (1,1,30) do (
  timeout /t 2 /nobreak >nul
  %PY% -c "import sys; from otopilot import ollama; sys.exit(0 if ollama.calisiyor_mu() else 1)" >nul 2>&1 && exit /b 0
)
echo HATA: Ollama baslatilamadi. Baslat menusunden "Ollama" uygulamasini acip tekrar dene.
exit /b 1

:winget_kontrol
where winget >nul 2>&1
if not errorlevel 1 exit /b 0
echo HATA: winget bulunamadi. Microsoft Store'dan "App Installer" uygulamasini kur
echo veya eksik programi elle kur, sonra bu dosyayi tekrar calistir.
start "" ms-windows-store://pdp/?productid=9NBLGGH4NNS1
exit /b 1

:son
echo.
pause
endlocal
