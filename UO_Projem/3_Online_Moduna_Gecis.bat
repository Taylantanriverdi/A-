@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - Online Moduna Geçiş

call "%~dp0Araclar\ayarlar.cmd"
if errorlevel 1 (
    echo HATA: Araclar\ayarlar.cmd bulunamadı.
    pause
    exit /b 1
)

echo ==================================================================
echo   ONLINE MODUNA GEÇİŞ
echo   Server.cfg içindeki Address ve ClassicUO settings.json içindeki
echo   ip değeri girdiğin dış IP adresiyle değiştirilecek.
echo   Yerel moda dönmek için IP olarak 127.0.0.1 yazman yeterli.
echo ==================================================================
echo.

if not exist "%UO_SERVER%\Config\Server.cfg" (
    echo HATA: %UO_SERVER%\Config\Server.cfg bulunamadı. Önce kurulumu çalıştır.
    goto :Hata
)

:IpSor
set "YENI_IP="
set /p "YENI_IP=Yeni dış IP adresi (Public IP): "
if not defined YENI_IP goto :IpSor

rem IPv4 biçim kontrolü (her bölüm 0-255)
%PS% -Command "$ip=$env:YENI_IP; $ok = $ip -match '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$' -and ((1..4) | Where-Object { [int]$Matches[$_] -gt 255 }).Count -eq 0; if ($ok) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo   Geçersiz IP adresi: "%YENI_IP%"  ^(örnek: 85.105.12.34^)
    goto :IpSor
)

choice /C EH /M "  IP adresi %YENI_IP% olarak ayarlansın mı? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Iptal

rem Config dosyaları Program Files gibi korumalı bir yerdeyse yönetici izni gerekir.
copy /y nul "%UO_SERVER%\Config\.yazma_testi" >nul 2>&1
if errorlevel 1 (
    echo   HATA: %UO_SERVER%\Config klasörüne yazılamıyor. Bu dosyayı sağ tıklayıp "Yönetici olarak çalıştır" ile aç.
    goto :Hata
)
del "%UO_SERVER%\Config\.yazma_testi" >nul 2>&1

%PS% -File "%UO_TOOLS%\Yapilandir.ps1" -ServerDir "%UO_SERVER%" -ClientDir "%UO_CLIENT%" -Ip "%YENI_IP%"
if errorlevel 1 goto :Hata

echo.
echo   Tamamlandı. Eski dosyalar .bak uzantısıyla yedeklendi.
echo.
rem Güvenlik duvarı kuralı (yönetici izni gerekir)
net session >nul 2>&1
if errorlevel 1 (
    echo   Not: Yönetici olarak çalıştırmadığın için güvenlik duvarı kuralı eklenmedi.
    goto :Hatirlatma
)
choice /C EH /M "  Windows Güvenlik Duvarı'nda TCP %UO_PORT% portu açılsın mı? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Hatirlatma
netsh advfirewall firewall delete rule name="ServUO %UO_PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="ServUO %UO_PORT%" dir=in action=allow protocol=TCP localport=%UO_PORT% >nul
if errorlevel 1 (echo   UYARI: Güvenlik duvarı kuralı eklenemedi.) else (echo   Güvenlik duvarı kuralı eklendi: ServUO %UO_PORT%)

:Hatirlatma
echo.
echo   VDS/VPS için hatırlatmalar:
echo   - Sunucu Listen=0.0.0.0 ile tüm ağ arayüzlerini dinler; bu ayarı değiştirme.
echo   - Windows Güvenlik Duvarı'nda ve VDS sağlayıcının panelinde TCP %UO_PORT% portunu aç:
echo       netsh advfirewall firewall add rule name="ServUO %UO_PORT%" dir=in action=allow protocol=TCP localport=%UO_PORT%
echo     ^(Bu komut yönetici izni ister.^)
echo   - Oyunculara ClassicUO klasörünü dağıtırken settings.json içindeki ip zaten %YENI_IP% olacak.
echo   - Sunucu çalışıyorsa değişikliğin geçerli olması için yeniden başlat.
echo.
pause
exit /b 0

:Iptal
echo   İptal edildi, hiçbir dosya değiştirilmedi.
pause
exit /b 0

:Hata
echo.
echo   İşlem tamamlanamadı.
pause
exit /b 1
