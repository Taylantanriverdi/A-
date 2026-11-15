@echo off
setlocal EnableExtensions
title Is Takip - Guncelle ve Baslat

rem ==================================================================
rem  Klinik - Teknisyen Is Takip : TEK TIKLA GUNCELLE + CALISTIR
rem  Cift tiklayin. Bu dosya sirasiyla:
rem   1) Git ve Node.js yoksa kurar (winget ile)
rem   2) Programi GitHub'dan indirir ya da en son surume gunceller
rem   3) Verilerinizi yedekler (data\yedek)
rem   4) Eski calisan sunucuyu kapatir, yenisini baslatir
rem   5) Tarayiciyi otomatik acar
rem ==================================================================

rem ---------------- AYARLAR (gerekirse degistirin) ------------------
set "REPO_URL=https://github.com/taylantanriverdi/a-.git"
set "BRANCH=claude/jolly-curie-k5ulr9"
set "PORT=3000"
set "INSTALL_DIR=%USERPROFILE%\IsTakip"
rem ------------------------------------------------------------------

rem Guncelleme sirasinda bu dosyanin kendisi de degisebilir.
rem Bu yuzden once gecici klasore kopyalanip oradan calistirilir.
if /i "%~1"=="--asama2" goto asama2
copy /y "%~f0" "%TEMP%\istakip_baslat.bat" >nul
"%TEMP%\istakip_baslat.bat" --asama2 "%~dp0."
exit /b

:asama2
set "KAYNAK=%~f2"
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Git\cmd"

echo.
echo  ==========================================================
echo     KLINIK - TEKNISYEN IS TAKIP  /  Guncelle ve Baslat
echo  ==========================================================
echo.

rem ---------- 1) Gerekli programlar ----------
echo [1/5] Gerekli programlar kontrol ediliyor...
where git >nul 2>&1 || call :kur Git.Git "Git"
where git >nul 2>&1 || (echo  HATA: Git bulunamadi. https://git-scm.com adresinden kurun. & goto hata)

where node >nul 2>&1 || call :kur OpenJS.NodeJS.LTS "Node.js"
where node >nul 2>&1 || (echo  HATA: Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & goto hata)

set "NODE_MAJOR=0"
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% LSS 18 (
  echo  Node.js surumu eski, guncelleniyor...
  call :kur OpenJS.NodeJS.LTS "Node.js"
)
for /f %%v in ('node -v') do echo  Node.js %%v hazir.

rem ---------- Program klasoru ----------
if exist "%KAYNAK%\.git\" if exist "%KAYNAK%\is-takip\server.js" (
  set "REPO=%KAYNAK%"
  goto repo_hazir
)
set "REPO=%INSTALL_DIR%\a-"
:repo_hazir
echo  Program klasoru: %REPO%

rem ---------- 2) Calisan eski sunucuyu kapat ----------
echo.
echo [2/5] Calisan eski surum varsa kapatiliyor...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  tasklist /fi "pid eq %%p" | find /i "node.exe" >nul && taskkill /f /pid %%p >nul 2>&1 && echo  Eski sunucu kapatildi.
)

rem ---------- 3) Indir / guncelle ----------
echo.
echo [3/5] En son surum aliniyor...
if exist "%REPO%\.git\" goto guncelle

echo  Ilk kurulum: program indiriliyor...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
git clone --branch "%BRANCH%" "%REPO_URL%" "%REPO%"
if errorlevel 1 (echo  HATA: Program indirilemedi. Internet baglantisini ve GitHub girisini kontrol edin. & goto hata)
goto guncel

:guncelle
pushd "%REPO%"
git fetch origin --prune
if errorlevel 1 (
  echo  UYARI: Guncelleme alinamadi - internet yok olabilir. Mevcut surum calistirilacak.
  popd
  goto guncel
)
rem Once verileri yedekle
if exist "is-takip\data\db.json" (
  if not exist "is-takip\data\yedek" mkdir "is-takip\data\yedek"
  for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do copy /y "is-takip\data\db.json" "is-takip\data\yedek\db-%%d.json" >nul
  echo  Veriler yedeklendi: is-takip\data\yedek
)
rem Kodu sunucudaki son surumle esitle (data klasoru korunur)
git checkout -f -B "%BRANCH%" "origin/%BRANCH%" >nul 2>&1
if errorlevel 1 (echo  HATA: Guncelleme uygulanamadi. & popd & goto hata)
popd

:guncel
pushd "%REPO%"
for /f "delims=" %%l in ('git log -1 --format^="%%h  %%s  (%%cr)"') do echo  Surum: %%l
popd

rem ---------- 4) Bagimliliklar ----------
echo.
echo [4/5] Bagimliliklar kontrol ediliyor...
cd /d "%REPO%\is-takip"
findstr /c:"dependencies" package.json >nul 2>&1
if errorlevel 1 (
  echo  Ek paket gerekmiyor.
) else (
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (echo  HATA: Paketler kurulamadi. & goto hata)
)

rem ---------- 5) Baslat ----------
echo.
echo [5/5] Program baslatiliyor...
echo.
echo  ----------------------------------------------------------
echo   Adres (bu bilgisayar) : http://localhost:%PORT%
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%j in ("%%i") do echo   Agdaki diger cihazlar : http://%%j:%PORT%
echo   Demo: klinik@demo.com / teknisyen@demo.com  sifre 1234
echo   KAPATMAK icin bu pencereyi kapatin.
echo  ----------------------------------------------------------
echo.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
node server.js
echo.
echo  Sunucu durdu.
goto hata

rem ==================================================================
:kur
rem %1 = winget paket kimligi, %2 = gorunen ad
where winget >nul 2>&1
if errorlevel 1 (
  echo  %~2 kurulu degil ve otomatik kurulum ^(winget^) bu bilgisayarda yok.
  exit /b 1
)
echo  %~2 kuruluyor, lutfen bekleyin - onay penceresi cikarsa Evet deyin...
winget install --id %~1 -e --silent --accept-package-agreements --accept-source-agreements
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Git\cmd"
exit /b 0

:hata
echo.
pause
exit /b 1
