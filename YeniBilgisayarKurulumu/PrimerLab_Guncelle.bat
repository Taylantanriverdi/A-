@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PRIMER LAB - GUNCELLEME

rem Kurulu Primer Lab'i bu klasordeki yeni surume gunceller.
rem Veritabanina, verilere, App_Data'ya ve baglanti ayarlarina dokunmaz.

rem Yonetici izni gerekli: calisan Primer Lab'i kapatabilmek icin.
net session >nul 2>&1
if errorlevel 1 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)


set "KIT=%~dp0"
set "HEDEF=C:\PrimerLab"
set "KAYNAK=%HEDEF%\Kaynak"
set "UYGULAMA=%HEDEF%\Uygulama"
set "DOTNET=%ProgramFiles%\dotnet\dotnet.exe"

echo ============================================================
echo  PRIMER LAB - GUNCELLEME
echo ============================================================
if not exist "%UYGULAMA%\appsettings.Production.json" goto KURULU_DEGIL
if not exist "%KIT%kaynak\PrimerLabV2\PrimerLabV2.csproj" goto KIT_EKSIK
if not exist "%DOTNET%" goto KURULU_DEGIL

for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "DAMGA=%%T"
set "YEDEK=%HEDEF%\Yedekler\Kaynak_%DAMGA%"

echo [1/4] Mevcut surum yedekleniyor...
robocopy "%KAYNAK%" "%YEDEK%" /E /XD bin obj /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto YEDEK_HATA

echo [2/4] Primer Lab kapatiliyor...
rem Program kapanana kadar bekle; kapanmazsa hicbir dosyaya dokunmadan dur.
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
set /a KDENEME=0
:KAPANMA_BEKLE
tasklist /FI "IMAGENAME eq PrimerLabV2.exe" 2>nul | find /I "PrimerLabV2.exe" >nul
if errorlevel 1 goto KAPANDI
set /a KDENEME+=1
if %KDENEME% GEQ 10 goto KAPANMADI
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
timeout /t 1 /nobreak >nul
goto KAPANMA_BEKLE
:KAPANDI

echo [3/4] Yeni surum derleniyor...
rem /MIR kullanilmaz: eski bilgisayardan gelen sayfalar (Hekim Portali) korunur.
robocopy "%KIT%kaynak\PrimerLabV2" "%KAYNAK%" /E /IS /IT /XD bin obj /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto GERI_AL
rem Onceki derleme dosyalari silinir; program her guncellemede sifirdan derlenir.
rem (Zip'ten cikan dosyalarin saati saat dilimi farki yuzunden eski gorunebiliyor;
rem  derleyici bu durumda sayfayi yeniden derlemeyip eski surumu birakiyordu.)
if exist "%KAYNAK%\obj" rmdir /s /q "%KAYNAK%\obj"
if exist "%KAYNAK%\bin" rmdir /s /q "%KAYNAK%\bin"
pushd "%KAYNAK%"
"%DOTNET%" publish PrimerLabV2.csproj -c Release -o "%UYGULAMA%" -nologo
set "DERLEME=%errorlevel%"
popd
if not "%DERLEME%"=="0" goto GERI_AL

echo [4/4] Primer Lab baslatiliyor...
rem Program yonetici olarak degil, normal kullanici yetkisiyle baslatilir.
explorer.exe "%HEDEF%\PrimerLab_Baslat.bat"
echo.
echo GUNCELLEME TAMAMLANDI.
echo Tarayicida eski sayfa gorunuyorsa sayfada Ctrl + F5 tuslarina basin.
echo Onceki surumun yedegi: %YEDEK%
pause
exit /b 0

:GERI_AL
echo.
echo HATA: Yeni surum derlenemedi. Onceki surume geri donuluyor...
robocopy "%YEDEK%" "%KAYNAK%" /MIR /IS /IT /XD bin obj /NFL /NDL /NJH /NJS /NP >nul
if exist "%KAYNAK%\obj" rmdir /s /q "%KAYNAK%\obj"
if exist "%KAYNAK%\bin" rmdir /s /q "%KAYNAK%\bin"
pushd "%KAYNAK%"
"%DOTNET%" publish PrimerLabV2.csproj -c Release -o "%UYGULAMA%" -nologo >nul
popd
explorer.exe "%HEDEF%\PrimerLab_Baslat.bat"
echo Onceki surum tekrar calisiyor. Yukaridaki hata mesajinin fotografini Claude'a gonderin.
pause
exit /b 1

:KAPANMADI
echo HATA: Calisan Primer Lab kapatilamadi. Hicbir degisiklik yapilmadi.
echo Bilgisayari yeniden baslatip PrimerLab_Guncelle.bat'i tekrar calistirin.
pause
exit /b 1
:KURULU_DEGIL
echo HATA: Bu bilgisayarda kurulu Primer Lab bulunamadi. Once KURULUM.bat'i calistirin.
pause
exit /b 1
:KIT_EKSIK
echo HATA: Guncelleme dosyalari eksik. Zip dosyasinin tamamini acip buradan calistirin.
pause
exit /b 1
:YEDEK_HATA
echo HATA: Mevcut surum yedeklenemedi. Hicbir degisiklik yapilmadi.
pause
exit /b 1
