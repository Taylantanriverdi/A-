@echo off
setlocal EnableExtensions
title PRIMER LAB - YONETICI SIFRESI SIFIRLAMA

rem Yonetici (ana program) sifresini siler. Isler, cari, kasa, hekim/teknisyen
rem hesaplari ve diger tum veriler KORUNUR. Program yeniden acildiginda
rem "Yonetici sifresi belirleyin" ekrani gelir.

net session >nul 2>&1
if errorlevel 1 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "HEDEF=C:\PrimerLab"
set "DOSYA=%HEDEF%\Uygulama\App_Data\yonetici-giris.json"

echo ============================================================
echo  PRIMER LAB - YONETICI SIFRESI SIFIRLAMA
echo ============================================================
echo.
echo  Bu islem yalniz ana programin YONETICI SIFRESINI siler.
echo  Verileriniz (isler, cari, kasa, hekimler, teknisyenler) silinmez.
echo  Program yeniden acildiginda yeni sifre belirleme ekrani gelir.
echo.
if not exist "%DOSYA%" (
    echo  Kayitli yonetici sifresi bulunamadi; sifirlamaya gerek yok.
    echo  Programi acinca sifre belirleme ekrani gelecektir.
    goto SON
)
choice /C EH /M "  Devam edilsin mi? (E=Evet, H=Hayir)"
if errorlevel 2 goto IPTAL

echo.
echo  Primer Lab kapatiliyor...
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
timeout /t 2 >nul
del /F /Q "%DOSYA%" >nul 2>&1
if exist "%DOSYA%" (
    echo  HATA: Dosya silinemedi: %DOSYA%
    goto SON
)
echo  Yonetici sifresi silindi.
echo  Primer Lab baslatiliyor...
if exist "%HEDEF%\PrimerLab_Baslat.bat" start "" /min cmd /c "%HEDEF%\PrimerLab_Baslat.bat"
timeout /t 6 >nul
start "" "http://localhost:5169/giris"
echo  Tarayicida acilan ekranda yeni yonetici sifrenizi belirleyin.
goto SON

:IPTAL
echo  Islem iptal edildi; hicbir sey degismedi.

:SON
echo.
pause
