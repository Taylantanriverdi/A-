@echo off
rem PrimerMill 2 - KIOSK MODU KURULUMU (yonetici olarak calistirin: sag tik - Yonetici olarak calistir)
rem Windows bu hesapta hic gorunmez: Windows Gezgini yerine Kabuk.ps1 acilir, o da PrimerMill panelini baslatir.
rem Windows'a gecis yalniz panelden: Ayarlar - Genel - WINDOWS'A GEC (PIN, varsayilan 2457).
rem Geri almak icin: KIOSK_KALDIR.bat (ayni hesapta, yonetici olarak).
rem Kurtarma: Guvenli Mod ya da baska bir hesap - PrimerMill klasorundeki kiosk.on dosyasini silin (KURULUM_VE_DENEME.md).
rem Not: klasor adinda parantez olabilir, bu yuzden parantezli blok kullanilmaz.
setlocal EnableExtensions
title PrimerMill 2 - Kiosk kurulumu
set "PANEL=%~dp0"
set "YEDEK=%~dp0kiosk_yedek.txt"
set "PS32=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS32%" set "PS32=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "SYS=%SystemRoot%\System32"
if exist "%SystemRoot%\Sysnative\reg.exe" set "SYS=%SystemRoot%\Sysnative"
set "PS64=%SYS%\WindowsPowerShell\v1.0\powershell.exe"
set "POL_S=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System"
set "POL_E=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
set "POL_LS=HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"

echo.
echo  ==============================================
echo   PrimerMill 2 - KIOSK MODU KURULUMU
echo  ==============================================
echo.

net session >nul 2>&1
if not errorlevel 1 goto yonetici
echo  HATA: Bu dosya YONETICI olarak calistirilmali.
echo  Dosyaya sag tiklayin - "Yonetici olarak calistir".
echo  Operator hesabi yonetici degilse: once operator hesabini gecici olarak
echo  yonetici yapin ya da yonetici hesabinin parolasini UAC penceresine yazin
echo  (o durumda asagidaki hesap uyarisini okuyun). Hicbir sey degismedi.
goto son
:yonetici

if exist "%PANEL%Kabuk.ps1" goto kabuk_var
echo  HATA: Kabuk.ps1 bulunamadi: %PANEL%
goto son
:kabuk_var
if exist "%PANEL%KazimaBaslat.ps1" goto panel_var
echo  HATA: KazimaBaslat.ps1 bulunamadi: %PANEL%
goto son
:panel_var

echo  PrimerMill klasoru : %PANEL%
echo  Kiosk kurulacak hesap: %USERDOMAIN%\%USERNAME%
echo.
echo  ONEMLI: Kiosk YALNIZ bu hesap icin kurulur (HKCU). Bu hesap makinede her gun
echo  oturum acan OPERATOR hesabi olmali. UAC penceresine BASKA bir yonetici hesabinin
echo  parolasini yazdiysaniz yukaridaki ad o hesaptir: H deyin, operator hesabinda
echo  oturum acin, operatoru gecici yonetici yapin ve bu dosyayi orada calistirin.
echo  En kolayi: operator hesabi ile yonetici hesabi ayni hesap olsun.
echo.
echo  Yapilacaklar:
echo    1. Bu hesabin kabugu: Windows Gezgini yerine Kabuk.ps1 (PrimerMill)
echo    2. kiosk.on bayragi (panel tam ekran, en ustte, klavye kilidi, PIN'li cikis)
echo    3. Windows arayuzunu kapatan ilkeler (Gorev Yoneticisi, kilit, kullanici degistirme,
echo       oturum kapatma, kilit ekrani, dokunmatik kenar kaydirma, bildirimler, durum yazilari)
echo    4. Acilista Windows logosu ve donen noktalar gizlenir (bcdedit)
echo    5. Istege bagli: otomatik oturum acma
echo    6. Eski PrimerMill baslangic gorevi kapatilir (paneli artik kabuk acar)
echo.
set "CEVAP="
set /p "CEVAP= Devam edilsin mi? E = evet, H = hayir, sonra Enter: "
if /i "%CEVAP%"=="E" goto devam
echo  Iptal edildi, hicbir sey degismedi.
goto son

:devam
echo.
rem Yedek: onceki degerler (KIOSK_KALDIR.bat bunlarla geri yukler). Ikinci kurulumda eski yedek korunur.
set "YEDEKYAZ=1"
if not exist "%YEDEK%" goto yedek_yeni
set "YEDEKYAZ=0"
echo  Onceki kurulumun yedegi korunuyor: %YEDEK%
goto yedek_tamam
:yedek_yeni
> "%YEDEK%" echo # PrimerMill kiosk yedegi - KIOSK_KALDIR.bat okur. Elle degistirmeyin.
:yedek_tamam

rem ---------------- 1. kabuk ----------------
echo  [1/7] Kabuk: HKCU\...\Winlogon\Shell = Kabuk.ps1
set "KIOSK_KOMUT="%PS32%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "%PANEL%Kabuk.ps1""
"%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "Set-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name Shell -Value $env:KIOSK_KOMUT -ErrorAction Stop"
if errorlevel 1 goto kabuk_hata
echo        Tamam: %KIOSK_KOMUT%

rem ---------------- 2. bayrak ----------------
echo  [2/7] kiosk.on yaziliyor
"%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllLines($env:PANEL + 'kiosk.on', [string[]]@('# PrimerMill kiosk modu acik (KIOSK_KUR.bat). Silinirse kiosk kapanir.', ('Shell=' + $env:KIOSK_KOMUT)))"
if errorlevel 1 goto bayrak_hata
echo        Tamam: %PANEL%kiosk.on

rem ---------------- 3. ilkeler ----------------
echo  [3/7] Windows arayuzu ilkeleri
call :ilke "%POL_S%" DisableTaskMgr 1
call :ilke "%POL_S%" DisableLockWorkstation 1
call :ilke "%POL_S%" DisableChangePassword 1
call :ilke "%POL_E%" NoLogoff 1
call :ilke "%POL_LS%" HideFastUserSwitching 1
call :ilke "%POL_LS%" DisableStatusMessages 1
call :ilke "%POL_LS%" EnableFirstLogonAnimation 0
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" NoLockScreen 1
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" AllowEdgeSwipe 0
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" DisableAcrylicBackgroundOnLogon 1
call :ilke "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" ToastEnabled 0
call :ilke "HKCU\Software\Policies\Microsoft\Windows\Explorer" DisableNotificationCenter 1
echo        Not: Kapat / Yeniden baslat Windows menulerinden KALDIRILMADI (NoClose yok):
echo        dogru yol paneldeki KAPAT dugmesidir (Eding ayarlarini kaydeder). Ctrl+Alt+Del
echo        ekranindaki guc dugmesi yalniz acil durum icin kalir.

rem ---------------- 4. acilis gorseli ----------------
echo  [4/7] Acilis: Windows logosu ve donen noktalar gizleniyor (bcdedit)
set "ESKI="
for /f "tokens=2" %%V in ('%SYS%\bcdedit.exe /enum {globalsettings} 2^>nul ^| findstr /i /c:"bootuxdisabled"') do set "ESKI=%%V"
if not defined ESKI set "ESKI=YOK"
if "%YEDEKYAZ%"=="1" >> "%YEDEK%" echo BCD;globalsettings;bootuxdisabled;%ESKI%
"%SYS%\bcdedit.exe" /set {globalsettings} bootuxdisabled on >nul
if errorlevel 1 echo        UYARI: bootuxdisabled ayarlanamadi.
if not errorlevel 1 echo        Tamam: bootuxdisabled = on  (onceki: %ESKI%)
set "ESKI="
for /f "tokens=2" %%V in ('%SYS%\bcdedit.exe /enum {current} 2^>nul ^| findstr /i /c:"quietboot"') do set "ESKI=%%V"
if not defined ESKI set "ESKI=YOK"
if "%YEDEKYAZ%"=="1" >> "%YEDEK%" echo BCD;current;quietboot;%ESKI%
"%SYS%\bcdedit.exe" /set {current} quietboot on >nul
if errorlevel 1 echo        UYARI: quietboot ayarlanamadi.
if not errorlevel 1 echo        Tamam: quietboot = on  (onceki: %ESKI%)
echo        Not: Bilgisayar ureticisinin (BIOS/UEFI) logosu donanim yazilimidir; yalniz
echo        BIOS/UEFI ayarlarindan (ornek: Quiet Boot / Logo) degistirilebilir.

rem ---------------- 5. otomatik oturum ----------------
echo  [5/7] Otomatik oturum acma
echo        Otomatik oturum acilmazsa acilista Windows giris ekrani GORUNUR (parola sorar).
echo        Acilirsa parola kayit defterinde DUZ METIN olarak saklanir (bilgisayara erisen okuyabilir).
set "CEVAP="
set /p "CEVAP=        Otomatik oturum acma kurulsun mu? E = evet, H = hayir [H]: "
if /i not "%CEVAP%"=="E" goto oto_atla
set "KIOSK_KULLANICI=%USERNAME%"
set "KIOSK_ALAN=%USERDOMAIN%"
set /p "KIOSK_KULLANICI=        Kullanici adi [%USERNAME%]: "
set /p "KIOSK_ALAN=        Bilgisayar / etki alani [%USERDOMAIN%]: "
set "KIOSK_PAROLA="
echo        Parola yazilirken ekranda gorunur. Parolasiz hesapta bos birakip Enter.
set /p "KIOSK_PAROLA=        Parola: "
"%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'; Set-ItemProperty -LiteralPath $k -Name AutoAdminLogon -Value '1' -ErrorAction Stop; Set-ItemProperty -LiteralPath $k -Name DefaultUserName -Value $env:KIOSK_KULLANICI -ErrorAction Stop; Set-ItemProperty -LiteralPath $k -Name DefaultDomainName -Value $env:KIOSK_ALAN -ErrorAction Stop; Set-ItemProperty -LiteralPath $k -Name DefaultPassword -Value ([string]$env:KIOSK_PAROLA) -ErrorAction Stop"
if errorlevel 1 goto oto_hata
set "KIOSK_PAROLA="
>> "%YEDEK%" echo AUTOLOGON;1
echo        Tamam: otomatik oturum acma kuruldu (%KIOSK_ALAN%\%KIOSK_KULLANICI%).
echo        Windows 10/11'de "Windows Hello ile oturum acma gerekli" ayari aciksa otomatik oturum
echo        calismayabilir: Ayarlar - Hesaplar - Oturum acma secenekleri.
goto oto_son
:oto_hata
set "KIOSK_PAROLA="
echo        UYARI: otomatik oturum acma kurulamadi.
goto oto_son
:oto_atla
echo        Atlandi: acilista Windows giris ekrani gorunecek.
:oto_son

rem ---------------- 6. eski baslangic gorevi ----------------
echo  [6/7] PrimerMill baslangic gorevi (YoneticiKurulum.bat) kapatiliyor
schtasks /query /tn "PrimerMill" >nul 2>&1
if errorlevel 1 goto gorev_yok
schtasks /change /tn "PrimerMill" /disable >nul
if errorlevel 1 echo        UYARI: gorev kapatilamadi.
if not errorlevel 1 echo        Tamam: "PrimerMill" gorevi kapatildi (KIOSK_KALDIR.bat yeniden acar).
goto gorev_son
:gorev_yok
echo        Gorev yok (sorun degil).
:gorev_son

rem ---------------- 7. yeniden baslat ----------------
echo  [7/7] Kurulum tamam.
echo.
echo  Yeniden baslatinca: siyah ekran - PRIMER - panel. Windows gorunmez.
echo  Windows'a gecis: panel - Ayarlar - Genel - WINDOWS'A GEC - PIN 2457.
echo  PIN'i degistirmek: ayni yerde PIN dugmesi.
echo  Geri almak: KIOSK_KALDIR.bat. Kurtarma: KURULUM_VE_DENEME.md - Kiosk modu.
echo.
set "CEVAP="
set /p "CEVAP= Bilgisayar simdi yeniden baslatilsin mi? E = evet, H = hayir: "
if /i not "%CEVAP%"=="E" goto son
"%SYS%\shutdown.exe" /r /t 5
goto son

:kabuk_hata
echo  HATA: kabuk degeri yazilamadi. Baska bir sey degistirilmedi.
goto son
:bayrak_hata
echo  HATA: kiosk.on yazilamadi. Kabuk geri aliniyor...
"%PS64%" -NoProfile -ExecutionPolicy Bypass -Command "Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name Shell -ErrorAction SilentlyContinue"
goto son

rem ---------------- alt program: ilke yaz (onceki degeri yedekle) ----------------
rem %1 = anahtar, %2 = deger adi, %3 = DWORD
:ilke
set "ESKIDEG="
for /f "tokens=3" %%V in ('%SYS%\reg.exe query "%~1" /v %2 2^>nul ^| findstr /i /c:"%2"') do set "ESKIDEG=%%V"
if "%YEDEKYAZ%"=="1" if defined ESKIDEG >> "%YEDEK%" echo ESKI;%~1;%2;%ESKIDEG%
"%SYS%\reg.exe" add "%~1" /v %2 /t REG_DWORD /d %3 /f >nul 2>&1
if errorlevel 1 echo        UYARI: %~1\%2 yazilamadi.
if not errorlevel 1 echo        Tamam: %2 = %3
exit /b 0

:son
echo.
pause
endlocal
exit /b
