@echo off
rem ==================================================================
rem  ORTAK AYARLAR - tüm .bat dosyaları bu dosyayı okur.
rem  Bir değeri değiştirmek istersen sadece burayı düzenle.
rem ==================================================================

rem Ana proje klasörü
set "UO_ROOT=C:\UO_Projem"

set "UO_SERVER=%UO_ROOT%\Server"
set "UO_CLIENT=%UO_ROOT%\Client"
set "UO_FILES=%UO_CLIENT%\UO_Files"
set "UO_BACKUPS=%UO_ROOT%\Backups"
rem Araçlar klasörü: bu dosyanın bulunduğu klasör (sondaki \ silinir)
set "UO_TOOLS=%~dp0"
set "UO_TOOLS=%UO_TOOLS:~0,-1%"

rem Sunucu bilgileri
set "UO_SHARD_NAME=MyCustomUO"
set "UO_IP=127.0.0.1"
set "UO_PORT=2593"

rem ClassicUO için istemci sürümü (örn. 7.0.95.0).
rem Boş bırakılırsa ClassicUO, UO_Files içindeki client.exe dosyasından okumaya çalışır.
set "UO_CLIENT_VERSION="

rem Kaynaklar
set "SERVUO_REPO=https://github.com/ServUO/ServUO.git"
set "CUO_RELEASE_TAG=ClassicUO-main-release"
set "CUO_ASSET=ClassicUO-win-x64-release.zip"

rem Gerekli en düşük .NET SDK ana sürümü
set "DOTNET_MIN_MAJOR=8"

rem Saklanacak en fazla yedek sayısı (0 = sınırsız)
set "UO_BACKUP_KEEP=30"

rem Sunucunun portu açması için beklenecek en uzun süre (saniye)
set "UO_WAIT_SECONDS=300"

set "PS=powershell -NoProfile -ExecutionPolicy Bypass"
exit /b 0
