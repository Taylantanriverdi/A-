@echo off
REM ==========================================================================
REM  OTOPILOT - TEK TIKLA KURULUM VE BASLATMA
REM  Cift tikla. Eksik olanlari kurar (Python, Git, Claude Code), Claude'a
REM  giris yaptirir, proje klasorunu sectirir ve otopilotu baslatir.
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
set "PATH=%USERPROFILE%\.local\bin;%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Python\Launcher;%LOCALAPPDATA%\Programs\Python\Python313;%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"

echo ==========================================================
echo    OTOPILOT - Claude Code ile projeni otomatik gelistirir
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

REM ---------------------------------------------------------------- 3. Claude Code
echo [3/5] Claude Code kontrol ediliyor...
call :claude_bul
if defined CLAUDE goto claude_tamam
echo       Claude Code yok, resmi kurulum betigiyle kuruluyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
call :claude_bul
if defined CLAUDE goto claude_tamam
echo HATA: Claude Code kurulamadi. Bu pencereyi kapatip dosyayi tekrar calistirmayi dene.
echo Olmazsa: https://claude.com/claude-code
goto son
:claude_tamam
echo       Tamam: %CLAUDE%

REM ---------------------------------------------------------------- 4. Giris
echo [4/5] Claude girisi kontrol ediliyor...
"%CLAUDE%" auth status 2>nul | findstr /r /c:"loggedIn.*true" >nul
if not errorlevel 1 goto giris_tamam
echo       Giris yapilmamis. Tarayici acilacak; Claude hesabinla giris yap.
echo.
"%CLAUDE%" auth login
"%CLAUDE%" auth status 2>nul | findstr /r /c:"loggedIn.*true" >nul
if not errorlevel 1 goto giris_tamam
echo HATA: Giris yapilamadi. Dosyayi tekrar calistir.
goto son
:giris_tamam
echo       Tamam.

REM ---------------------------------------------------------------- 5. Proje
echo [5/5] Proje seciliyor...
set "PROJE="
set "YENI=0"
if exist "%VERI%\son_proje.txt" set /p PROJE=<"%VERI%\son_proje.txt"
if not defined PROJE goto proje_sec
if not exist "%PROJE%\" goto proje_sec
echo.
echo       Son proje: %PROJE%
choice /c DY /n /m "      [D] Bu projeyle devam et   [Y] Yeni klasor sec : "
if errorlevel 2 goto proje_sec
goto proje_hazir

:proje_sec
echo       Acilan pencereden gelistirilecek proje klasorunu sec...
set "PROJE="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -STA -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Gelistirilecek proje klasorunu sec'; if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }"`) do set "PROJE=%%i"
if not defined PROJE goto iptal
set "YENI=1"
>"%VERI%\son_proje.txt" echo %PROJE%

:proje_hazir
echo       Proje: %PROJE%

REM Proje git deposu degilse olustur ve mevcut hali ilk surum olarak kaydet
if exist "%PROJE%\.git" goto git_deposu_var
echo       Proje git ile takip edilmiyor; mevcut hali "ilk surum" olarak kaydediliyor...
git -C "%PROJE%" init -q
call :git_kimlik
if not exist "%PROJE%\.gitignore" call :gitignore_yaz
git -C "%PROJE%" add -A
git -C "%PROJE%" commit -q -m "Otopilot oncesi ilk surum"
if errorlevel 1 goto git_hata
goto git_kayitli

:git_deposu_var
call :git_kimlik
set "DAL="
for /f "delims=" %%b in ('git -C "%PROJE%" rev-parse --abbrev-ref HEAD 2^>nul') do set "DAL=%%b"
if /i "%DAL%"=="otopilot/gelistirme" goto git_kayitli
set "KIRLI="
for /f "delims=" %%k in ('git -C "%PROJE%" status --porcelain') do set "KIRLI=1"
if not defined KIRLI goto git_kayitli
echo.
echo       Projede kaydedilmemis degisiklikler var. Otopilot baslamadan once kaydedilmeleri gerekiyor.
choice /c EH /n /m "      Simdi kaydedeyim mi? [E] Evet  [H] Hayir, cik : "
if errorlevel 2 goto son
git -C "%PROJE%" add -A
git -C "%PROJE%" commit -q -m "Otopilot oncesi kaydedilen degisiklikler"
if errorlevel 1 goto git_hata

:git_kayitli
if "%YENI%"=="0" goto calistir
echo.
choice /c EH /n /m "      Bilgisayar her acildiginda otopilot kendiliginden baslasin mi? [E/H] : "
if errorlevel 2 goto calistir
%PY% -m otopilot otomatik-kur "%PROJE%"

:calistir
echo.
echo ==========================================================
echo  Otopilot calisiyor. Bu pencereyi kapatirsan durur; tekrar
echo  actiginda kaldigi yerden devam eder. Ilerleme icin:
echo  %VERI%  klasorundeki gorevler.md ve gunluk.log
echo ==========================================================
echo.
%PY% -m otopilot baslat "%PROJE%"
goto son

:iptal
echo       Klasor secilmedi.
goto son

:git_hata
echo HATA: Proje git'e kaydedilemedi. Yukaridaki mesaja bak.
goto son

REM ======================================================== yardimci bolumler
:python_bul
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=py -3" && exit /b 0
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=python"
exit /b 0

:claude_bul
set "CLAUDE="
for /f "delims=" %%c in ('%PY% -c "from otopilot.claude import claude_bul; print(claude_bul())" 2^>nul') do set "CLAUDE=%%c"
exit /b 0

:winget_kontrol
where winget >nul 2>&1
if not errorlevel 1 exit /b 0
echo HATA: winget bulunamadi. Microsoft Store'dan "App Installer" uygulamasini kur
echo veya eksik programi elle kur, sonra bu dosyayi tekrar calistir.
start "" ms-windows-store://pdp/?productid=9NBLGGH4NNS1
exit /b 1

:gitignore_yaz
> "%PROJE%\.gitignore" echo node_modules/
>>"%PROJE%\.gitignore" echo .venv/
>>"%PROJE%\.gitignore" echo venv/
>>"%PROJE%\.gitignore" echo __pycache__/
>>"%PROJE%\.gitignore" echo dist/
>>"%PROJE%\.gitignore" echo build/
>>"%PROJE%\.gitignore" echo bin/
>>"%PROJE%\.gitignore" echo obj/
>>"%PROJE%\.gitignore" echo *.log
>>"%PROJE%\.gitignore" echo .env
exit /b 0

:git_kimlik
git -C "%PROJE%" config user.name >nul 2>&1 || git -C "%PROJE%" config user.name "%USERNAME%"
git -C "%PROJE%" config user.email >nul 2>&1 || git -C "%PROJE%" config user.email "%USERNAME%@otopilot.local"
exit /b 0

:son
echo.
pause
endlocal
