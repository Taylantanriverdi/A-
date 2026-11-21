@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - Hepsini Yap

call "%~dp0Araclar\ayarlar.cmd"
if errorlevel 1 (
    echo HATA: Araclar klasörü bulunamadı. Zip dosyasını tamamen çıkardığından emin ol.
    pause
    exit /b 1
)

echo ==================================================================
echo   UO PROJEM - HEPSİNİ YAP
echo   Eksik olan adımları sırayla tamamlar ve oyunu başlatır.
echo ==================================================================
echo.

rem ------------------------------------------------------------------
rem  ADIM A: Betikler C:\UO_Projem içinde değilse oraya kopyala ve oradan devam et
rem ------------------------------------------------------------------
set "BURASI=%~dp0"
set "BURASI=%BURASI:~0,-1%"
if /I "%BURASI%"=="%UO_ROOT%" goto :AdimB

echo [A] Bu dosya %BURASI% klasöründen çalışıyor.
echo     Betikler %UO_ROOT% içine kopyalanıyor...
if not exist "%UO_ROOT%\" mkdir "%UO_ROOT%"
robocopy "%BURASI%" "%UO_ROOT%" *.bat *.txt /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
robocopy "%BURASI%\Araclar" "%UO_ROOT%\Araclar" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if not exist "%UO_ROOT%\0_HEPSINI_YAP.bat" (
    echo     HATA: %UO_ROOT% içine kopyalanamadı. Sağ tıklayıp "Yönetici olarak çalıştır" dene.
    goto :Hata
)
echo     Tamam. %UO_ROOT%\0_HEPSINI_YAP.bat ile devam ediliyor...
echo.
call "%UO_ROOT%\0_HEPSINI_YAP.bat"
exit /b %ERRORLEVEL%

rem ------------------------------------------------------------------
rem  ADIM B: Sunucu ve istemci kurulu mu?
rem ------------------------------------------------------------------
:AdimB
echo [B] Sunucu ve istemci kontrol ediliyor...
set "KURULUM_GEREK="
if not exist "%UO_SERVER%\ServUO.exe" set "KURULUM_GEREK=1"
if not exist "%UO_CLIENT%\ClassicUO.exe" set "KURULUM_GEREK=1"
if not defined KURULUM_GEREK (
    echo     Tamam: ServUO ve ClassicUO kurulu.
    echo.
    goto :AdimC
)
echo     ServUO veya ClassicUO eksik. Kurulum başlatılıyor...
echo.
call "%UO_ROOT%\1_Kurulum_ve_Derleme.bat"
if not exist "%UO_SERVER%\ServUO.exe" goto :KurulumYarim
if not exist "%UO_CLIENT%\ClassicUO.exe" goto :KurulumYarim
echo.
goto :AdimC

:KurulumYarim
echo.
echo     Kurulum tamamlanmadı. Yönetici penceresi açıldıysa orada bitmesini bekle,
echo     sonra bu dosyayı ^(0_HEPSINI_YAP.bat^) tekrar çalıştır.
goto :Hata

rem ------------------------------------------------------------------
rem  ADIM C: Orijinal UO dosyaları UO_Files içinde mi?
rem ------------------------------------------------------------------
:AdimC
echo [C] Orijinal UO dosyaları kontrol ediliyor...
%PS% -File "%UO_TOOLS%\UODosyaKontrol.ps1" -UoFiles "%UO_FILES%" >nul
if not errorlevel 1 (
    echo     Tamam: UO dosyaları yerinde.
    echo.
    goto :AdimD
)
echo     UO_Files klasöründe oyun dosyaları yok.

:UOAra
echo     Bilgisayarda kurulu Ultima Online Classic aranıyor...
set "KAYNAK="
for /f "usebackq delims=" %%K in (`%PS% -File "%UO_TOOLS%\UOKurulumBul.ps1"`) do set "KAYNAK=%%K"
if defined KAYNAK goto :UOKopyala

echo     Kurulu Ultima Online Classic bulunamadı.
echo     İndirilmiş kurulum dosyası ^(UOClassicSetup...exe^) aranıyor...
set "SETUP="
for /f "usebackq delims=" %%S in (`%PS% -File "%UO_TOOLS%\UOSetupBul.ps1"`) do set "SETUP=%%S"
if defined SETUP goto :SetupCalistir

echo     Kurulum dosyası da bulunamadı.
echo     Resmi indirme sayfası açılıyor: https://uo.com/client-download/
echo     "CLASSIC CLIENT" resmine tıklayıp dosyayı İndirilenler klasörüne indir.
start "" "https://uo.com/client-download/"
echo.
echo     İndirme bitince bu pencereye dön ve bir tuşa bas.
pause
goto :UOAra

:SetupCalistir
echo     Bulundu: %SETUP%
echo.
echo     Kurulum başlatılıyor. Şunları yap:
echo       1. Kurulumda klasörü DEĞİŞTİRME, varsayılanla devam et.
echo       2. Kurulumdan sonra açılan güncelleyici ^(patcher^) %%100 olana kadar bekle.
echo       3. Giriş yapma, Play'e basma; güncelleyici bitince pencereyi kapat.
echo       4. Sonra BU pencereye dönüp bir tuşa bas.
echo.
start "" "%SETUP%"
pause
goto :UOAra

:UOKopyala
echo     Bulundu: %KAYNAK%
echo     Dosyalar %UO_FILES% içine kopyalanıyor... Birkaç GB olabilir, lütfen bekle.
if not exist "%UO_FILES%\" mkdir "%UO_FILES%"
robocopy "%KAYNAK%" "%UO_FILES%" /E /R:1 /W:1 /NFL /NDL /NJH /NP
if errorlevel 8 (
    echo     HATA: Kopyalama sırasında hata oluştu.
    goto :Hata
)
%PS% -File "%UO_TOOLS%\UODosyaKontrol.ps1" -UoFiles "%UO_FILES%"
if errorlevel 1 (
    echo.
    echo     Kurulum klasöründe gerekli dosyalar eksik. Güncelleyici ^(patcher^) muhtemelen
    echo     bitmemiş. Ultima Online Classic'i bir kez açıp güncellemenin %%100 olmasını bekle,
    echo     sonra bu dosyayı tekrar çalıştır.
    goto :Hata
)
echo.

rem ------------------------------------------------------------------
rem  ADIM D: Oyunu başlat
rem ------------------------------------------------------------------
:AdimD
echo [D] Oyun başlatılıyor...
echo.
call "%UO_ROOT%\2_Oyunu_Baslat.bat"
exit /b %ERRORLEVEL%

:Hata
echo.
echo   İşlem durdu. Ekrandaki mesaja göre devam et.
pause
exit /b 1
