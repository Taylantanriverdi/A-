@echo off
chcp 65001 >nul
setlocal EnableExtensions
title UO Projem - UO Dosyalarını Kopyala

call "%~dp0Araclar\ayarlar.cmd"
if errorlevel 1 (
    echo HATA: Araclar\ayarlar.cmd bulunamadı.
    pause
    exit /b 1
)

echo ==================================================================
echo   ORİJİNAL UO DOSYALARINI KOPYALA
echo   Hedef: %UO_FILES%
echo ==================================================================
echo.
if not exist "%UO_FILES%\" mkdir "%UO_FILES%"

echo Bilgisayarda kurulu Ultima Online Classic aranıyor...
set "KAYNAK="
for /f "usebackq delims=" %%K in (`%PS% -File "%UO_TOOLS%\UOKurulumBul.ps1"`) do set "KAYNAK=%%K"
if defined KAYNAK goto :Bulundu

echo   Kurulu Ultima Online Classic bulunamadı.
echo.

:Menu
echo   Ne yapmak istersin?
echo     1 - UO klasörünün yolunu elle gir
echo     2 - Resmi indirme sayfasını aç ^(uo.com - ücretsiz^)
echo     3 - Çık
choice /C 123 /M "  Seçimin"
if errorlevel 3 goto :Son
if errorlevel 2 goto :Indir

set "ELLE="
set /p "ELLE=  UO klasörünün tam yolu: "
if not defined ELLE goto :Menu
set "KAYNAK="
for /f "usebackq delims=" %%K in (`%PS% -File "%UO_TOOLS%\UOKurulumBul.ps1" -Kaynak "%ELLE%"`) do set "KAYNAK=%%K"
if defined KAYNAK goto :Bulundu
echo   Bu klasörde tiledata.mul bulunamadı; geçerli bir UO klasörü değil.
echo.
goto :Menu

:Indir
echo.
echo   Resmi sayfa açılıyor: https://uo.com/client-download/
echo   1. "Ultima Online Classic Client" kurulum dosyasını indir ve kur.
echo   2. Kurulumdan sonra açılan PATCHER/launcher güncellemeyi BİTİRENE kadar bekle
echo      ^(birkaç GB indirir^). Hesap açman veya oyuna girmen gerekmez.
echo   3. Sonra bu dosyayı tekrar çalıştır; klasör otomatik bulunur.
start "" "https://uo.com/client-download/"
goto :Son

:Bulundu
echo   Bulundu: %KAYNAK%
echo.
if /I "%KAYNAK%"=="%UO_FILES%" (
    echo   Kaynak ve hedef aynı klasör, kopyalamaya gerek yok.
    goto :Kontrol
)
choice /C EH /M "  Bu klasördeki tüm dosyalar %UO_FILES% içine kopyalansın mı? (E=Evet, H=Hayır)"
if errorlevel 2 goto :Son

echo   Kopyalanıyor... Birkaç GB olabilir, lütfen bekle.
robocopy "%KAYNAK%" "%UO_FILES%" /E /R:1 /W:1 /NFL /NDL /NJH /NP
if errorlevel 8 (
    echo   HATA: Kopyalama sırasında hata oluştu.
    goto :Son
)
echo   Kopyalama tamamlandı.

:Kontrol
echo.
%PS% -File "%UO_TOOLS%\UODosyaKontrol.ps1" -UoFiles "%UO_FILES%"
if not errorlevel 1 (
    echo.
    echo   Hazır. Şimdi 2_Oyunu_Baslat.bat ile oyunu başlatabilirsin.
)

:Son
echo.
pause
exit /b 0
