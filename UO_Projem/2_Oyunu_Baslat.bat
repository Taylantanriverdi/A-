@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - Oyunu Başlat

call "%~dp0Araclar\ayarlar.cmd"
if errorlevel 1 (
    echo HATA: Araclar\ayarlar.cmd bulunamadı.
    pause
    exit /b 1
)

if not exist "%UO_SERVER%\ServUO.exe" (
    echo HATA: %UO_SERVER%\ServUO.exe bulunamadı. Önce 1_Kurulum_ve_Derleme.bat dosyasını çalıştır.
    goto :Hata
)
if not exist "%UO_CLIENT%\ClassicUO.exe" (
    echo HATA: %UO_CLIENT%\ClassicUO.exe bulunamadı. Önce 1_Kurulum_ve_Derleme.bat dosyasını çalıştır.
    goto :Hata
)

rem Sunucu zaten çalışıyor mu?
set "ZATEN_CALISIYOR="
%PS% -File "%UO_TOOLS%\PortBekle.ps1" -Port %UO_PORT% -Kontrol
if not errorlevel 1 set "ZATEN_CALISIYOR=1"
if defined ZATEN_CALISIYOR goto :DosyaKontrolAtla

rem Port kapalı ama ServUO süreci varsa: büyük olasılıkla çökme/yeniden başlatma döngüsünde takılı kalmıştır.
tasklist /FI "IMAGENAME eq ServUO.exe" 2>nul | find /I "ServUO.exe" >nul
if errorlevel 1 goto :DosyaKontrol
echo UYARI: Port %UO_PORT% kapalı ama çalışan ServUO süreç^(ler^)i var ^(takılı kalmış veya hâlâ açılıyor olabilir^).
choice /C EH /M "  Bu ServUO süreçleri kapatılsın mı? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Hata
taskkill /F /T /IM ServUO.exe >nul 2>&1
timeout /t 2 >nul

:DosyaKontrol
echo [0/3] Orijinal UO dosyaları kontrol ediliyor...
%PS% -File "%UO_TOOLS%\UODosyaKontrol.ps1" -UoFiles "%UO_FILES%"
if errorlevel 1 (
    echo.
    echo   Bu dosyalar olmadan ServUO açılırken çöker ve kendini sürekli yeniden başlatır.
    goto :Hata
)
echo.

:DosyaKontrolAtla

rem ------------------------------------------------------------------
echo [1/3] Dünya kayıtları yedekleniyor...
if not exist "%UO_SERVER%\Saves\" (
    echo   Henüz Saves klasörü yok ^(ilk çalıştırma^), yedek atlandı.
    goto :YedekTamam
)
if defined ZATEN_CALISIYOR echo   UYARI: Sunucu çalışırken yedek alınıyor; o an kayıt yapılıyorsa yedek eksik olabilir.

for /f "usebackq delims=" %%T in (`%PS% -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"`) do set "TS=%%T"
set "YEDEK=%UO_BACKUPS%\Saves_%TS%"
if not exist "%UO_BACKUPS%\" mkdir "%UO_BACKUPS%"

robocopy "%UO_SERVER%\Saves" "%YEDEK%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
    echo   HATA: Yedek alınamadı. Devam etmek istemiyorsan pencereyi kapat.
    pause
) else (
    echo   Yedek alındı: %YEDEK%
)

rem Eski yedekleri temizle (ayarlar.cmd -> UO_BACKUP_KEEP)
if not "%UO_BACKUP_KEEP%"=="0" (
    %PS% -Command "Get-ChildItem -LiteralPath '%UO_BACKUPS%' -Directory -Filter 'Saves_*' | Sort-Object Name -Descending | Select-Object -Skip %UO_BACKUP_KEEP% | Remove-Item -Recurse -Force"
)

:YedekTamam
echo.

rem ------------------------------------------------------------------
echo [2/3] ServUO sunucusu başlatılıyor...
if defined ZATEN_CALISIYOR (
    echo   Sunucu zaten çalışıyor ^(port %UO_PORT% açık^), yeniden başlatılmadı.
    goto :SunucuHazir
)
start "ServUO - %UO_SHARD_NAME%" /D "%UO_SERVER%" "%UO_SERVER%\ServUO.exe"

echo   Sunucunun port %UO_PORT%'ü dinlemesi bekleniyor (en fazla %UO_WAIT_SECONDS% sn)...
echo   NOT: İlk çalıştırmada sunucu penceresi "create the owner account now? (y/n)" diye sorar.
echo        O pencereye geçip y yaz, kullanıcı adı ve şifre belirle; port ancak bundan sonra açılır.

:Bekle
%PS% -File "%UO_TOOLS%\PortBekle.ps1" -Port %UO_PORT% -TimeoutSn %UO_WAIT_SECONDS% -ProcessName ServUO -ServerDir "%UO_SERVER%"
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" goto :SunucuHazir
if "%RC%"=="2" goto :Hata
if "%RC%"=="3" goto :Hata
choice /C EH /M "  Sunucu henüz hazır değil. Beklemeye devam edilsin mi? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Hata
goto :Bekle

:SunucuHazir
echo.

rem ------------------------------------------------------------------
echo [3/3] ClassicUO başlatılıyor...
start "" /D "%UO_CLIENT%" "%UO_CLIENT%\ClassicUO.exe"
echo   İstemci açıldı. Giriş ekranında sunucu hesabının kullanıcı adı ve şifresini yaz.
echo   Bu pencere 5 saniye sonra kapanacak; sunucu kendi penceresinde çalışmaya devam eder.
timeout /t 5 >nul
exit /b 0

:Hata
echo.
echo   Oyun başlatılamadı.
pause
exit /b 1
