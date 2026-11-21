@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - Kurulum ve Derleme

call "%~dp0Araclar\ayarlar.cmd"
if errorlevel 1 (
    echo HATA: Araclar\ayarlar.cmd bulunamadı. Bu dosyayı UO_Projem klasöründen çalıştır.
    pause
    exit /b 1
)

echo ==================================================================
echo   ULTIMA ONLINE YEREL SUNUCU KURULUMU
echo   Proje klasörü : %UO_ROOT%
echo   Sunucu adı    : %UO_SHARD_NAME%   Adres: %UO_IP%:%UO_PORT%
echo ==================================================================
echo.

rem ------------------------------------------------------------------
echo [1/7] Klasörler hazırlanıyor...
for %%D in ("%UO_ROOT%" "%UO_SERVER%" "%UO_CLIENT%" "%UO_FILES%" "%UO_BACKUPS%") do (
    if not exist "%%~D\" mkdir "%%~D"
    if not exist "%%~D\" (
        echo   HATA: %%~D oluşturulamadı. Yönetici olarak çalıştırmayı dene.
        goto :Hata
    )
)
echo   Tamam.
echo.

rem ------------------------------------------------------------------
echo [2/7] Gerekli araçlar kontrol ediliyor (git, .NET SDK %DOTNET_MIN_MAJOR%+)...
call :AraclariKontrolEt
if defined GIT_OK if defined DOTNET_OK goto :AraclarTamam

if not defined GIT_OK echo   - git bulunamadı.
if not defined DOTNET_OK echo   - .NET SDK %DOTNET_MIN_MAJOR% veya üstü bulunamadı.

where winget >nul 2>&1
if errorlevel 1 (
    echo.
    echo   winget bulunamadı. Eksik araçları elle kur ve bu dosyayı tekrar çalıştır:
    echo     git      : https://git-scm.com/download/win
    echo     .NET SDK : https://dotnet.microsoft.com/download/dotnet/9.0
    goto :Hata
)

rem Kurulum için yönetici izni gerekir.
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Eksik araçları kurmak için YÖNETİCİ izni gerekiyor.
    choice /C EH /M "  Bu dosya yönetici olarak yeniden başlatılsın mı? (E=Evet, H=Hayır)"
    if errorlevel 2 goto :Hata
    %PS% -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

if not defined GIT_OK (
    echo   git kuruluyor...
    winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
)
if not defined DOTNET_OK (
    echo   .NET SDK 9 kuruluyor...
    winget install --id Microsoft.DotNet.SDK.9 -e --source winget --silent --accept-package-agreements --accept-source-agreements
)

rem Yeni kurulan programların PATH'i bu pencerede de geçerli olsun
for /f "usebackq delims=" %%P in (`%PS% -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\dotnet"

call :AraclariKontrolEt
if not defined GIT_OK (
    echo   HATA: git kurulamadı veya bulunamadı. Pencereyi kapatıp tekrar dene.
    goto :Hata
)
if not defined DOTNET_OK (
    echo   HATA: .NET SDK kurulamadı veya bulunamadı. Pencereyi kapatıp tekrar dene.
    goto :Hata
)

:AraclarTamam
for /f "delims=" %%v in ('git --version') do echo   %%v
for /f "delims=" %%v in ('dotnet --version') do echo   .NET SDK %%v
echo.

rem ------------------------------------------------------------------
echo [3/7] ServUO indiriliyor...
if exist "%UO_SERVER%\.git\" goto :ServuoGuncelle

dir /b /a "%UO_SERVER%" 2>nul | findstr "." >nul
if not errorlevel 1 (
    echo   HATA: %UO_SERVER% boş değil ama bir git deposu da değil.
    echo   Klasörü boşalt veya yeniden adlandır, sonra tekrar çalıştır.
    goto :Hata
)
pushd "%UO_SERVER%"
git clone "%SERVUO_REPO%" .
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
    echo   HATA: ServUO klonlanamadı. İnternet bağlantını kontrol et.
    goto :Hata
)
goto :ServuoTamam

:ServuoGuncelle
echo   ServUO zaten var, güncelleniyor (git pull)...
git -C "%UO_SERVER%" pull --ff-only
if errorlevel 1 echo   UYARI: Güncelleme yapılamadı (yerel değişikliklerin olabilir). Mevcut kodla devam ediliyor.

:ServuoTamam
echo.

rem ------------------------------------------------------------------
echo [4/7] ClassicUO indiriliyor...
if not exist "%UO_CLIENT%\ClassicUO.exe" goto :ClassicUOIndir
choice /C EH /T 15 /D H /M "  ClassicUO zaten kurulu. Güncellensin mi? (15 sn içinde seçilmezse Hayır)"
if errorlevel 2 goto :ClassicUOTamam

:ClassicUOIndir
%PS% -File "%UO_TOOLS%\ClassicUO_Indir.ps1" -Hedef "%UO_CLIENT%" -Tag "%CUO_RELEASE_TAG%" -Asset "%CUO_ASSET%"
if errorlevel 1 (
    echo   HATA: ClassicUO indirilemedi.
    goto :Hata
)
if not exist "%UO_CLIENT%\ClassicUO.exe" (
    echo   HATA: %UO_CLIENT%\ClassicUO.exe bulunamadı.
    goto :Hata
)

:ClassicUOTamam
echo.

rem ------------------------------------------------------------------
echo [5/7] ServUO derleniyor (dotnet build -c Release)... Bu birkaç dakika sürebilir.
tasklist /FI "IMAGENAME eq ServUO.exe" 2>nul | find /I "ServUO.exe" >nul
if not errorlevel 1 (
    echo   HATA: ServUO şu an çalışıyor. Önce sunucu penceresini kapat ^(veya konsola "save" ve "shutdown" yaz^).
    goto :Hata
)
pushd "%UO_SERVER%"
dotnet build -c Release
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" (
    echo   HATA: Derleme başarısız oldu. Yukarıdaki hata mesajlarını kontrol et.
    goto :Hata
)
if not exist "%UO_SERVER%\ServUO.exe" (
    echo   HATA: Derleme bitti ama ServUO.exe bulunamadı.
    goto :Hata
)
echo   Derleme başarılı: %UO_SERVER%\ServUO.exe
echo.

rem ------------------------------------------------------------------
echo [6/7] Yapılandırma dosyaları yazılıyor...
set "CV_ARG="
if defined UO_CLIENT_VERSION set "CV_ARG=-ClientVersion %UO_CLIENT_VERSION%"
%PS% -File "%UO_TOOLS%\Yapilandir.ps1" -ServerDir "%UO_SERVER%" -ClientDir "%UO_CLIENT%" -Ip "%UO_IP%" -Port %UO_PORT% -ShardName "%UO_SHARD_NAME%" -UoFiles "%UO_FILES%" %CV_ARG%
if errorlevel 1 (
    echo   HATA: Yapılandırma dosyaları yazılamadı.
    goto :Hata
)
echo.

rem ------------------------------------------------------------------
echo [7/7] Oyun dosyaları kontrol ediliyor...
set "UO_DOSYA_VAR="
if exist "%UO_FILES%\*.uop" set "UO_DOSYA_VAR=1"
if exist "%UO_FILES%\*.mul" set "UO_DOSYA_VAR=1"
if defined UO_DOSYA_VAR (
    echo   Tamam: %UO_FILES% içinde UO dosyaları bulundu.
) else (
    echo   DİKKAT: %UO_FILES% klasörü henüz boş!
    echo   Orijinal UO istemcisinin .mul / .uop dosyalarını bu klasöre kopyalamalısın.
)
echo.
echo ==================================================================
echo   KURULUM TAMAMLANDI
echo   Sonraki adımlar için OKU_BENI.txt dosyasını oku.
echo   Oyunu başlatmak için: 2_Oyunu_Baslat.bat
echo ==================================================================
if exist "%~dp0OKU_BENI.txt" start "" notepad "%~dp0OKU_BENI.txt"
pause
exit /b 0

:Hata
echo.
echo   Kurulum tamamlanamadı.
pause
exit /b 1

rem ==================================================================
rem  Alt yordam: git ve .NET SDK var mı?  GIT_OK / DOTNET_OK değişkenlerini ayarlar.
rem ==================================================================
:AraclariKontrolEt
set "GIT_OK="
set "DOTNET_OK="
where git >nul 2>&1 && set "GIT_OK=1"
where dotnet >nul 2>&1 || exit /b 0
rem Sadece rakamla başlayan satırlar (örn. "9.0.100 [C:\Program Files\dotnet\sdk]")
for /f "tokens=1 delims=." %%v in ('dotnet --list-sdks 2^>nul ^| findstr /R "^[0-9]"') do (
    if %%v GEQ %DOTNET_MIN_MAJOR% set "DOTNET_OK=1"
)
exit /b 0
