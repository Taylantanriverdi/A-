@echo off
rem PrimerMill 2 - KIOSK MODUNU KALDIR (KIOSK_KUR.bat'in tersi). Yonetici olarak, KIOSK'UN KURULDUGU HESAPTA calistirin
rem (panel - Ayarlar - Genel - WINDOWS'A GEC - PIN ile Windows'a gecip). Varsayilanlari geri yukler:
rem kabuk = Windows Gezgini, kiosk.on silinir, ilkeler kaldirilir (onceden var olanlar eski degerine doner),
rem bcdedit degerleri geri, otomatik oturum (KIOSK_KUR kurduysa) kapatilir, PrimerMill baslangic gorevi yeniden acilir.
rem Not: klasor adinda parantez olabilir, bu yuzden parantezli blok kullanilmaz.
setlocal EnableExtensions
title PrimerMill 2 - Kiosk kaldir
set "PANEL=%~dp0"
set "YEDEK=%~dp0kiosk_yedek.txt"
set "SYS=%SystemRoot%\System32"
if exist "%SystemRoot%\Sysnative\reg.exe" set "SYS=%SystemRoot%\Sysnative"
set "PS64=%SYS%\WindowsPowerShell\v1.0\powershell.exe"
set "POL_S=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System"
set "POL_E=HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
set "POL_LS=HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"

echo.
echo  ==============================================
echo   PrimerMill 2 - KIOSK MODUNU KALDIR
echo  ==============================================
echo.

net session >nul 2>&1
if not errorlevel 1 goto yonetici
echo  HATA: Bu dosya YONETICI olarak calistirilmali.
echo  Dosyaya sag tiklayin - "Yonetici olarak calistir". Hicbir sey degismedi.
echo  Hizli kurtarma (yonetici gerekmez): PrimerMill klasorundeki kiosk.on dosyasini silin;
echo  sonraki oturumda Windows masaustu ve panel normal acilir.
goto son
:yonetici

echo  PrimerMill klasoru : %PANEL%
echo  Kiosk kaldirilacak hesap: %USERDOMAIN%\%USERNAME%
echo  (Kiosk hangi hesapta kurulduysa bu dosya o hesapta calistirilmali.)
echo.
set "CEVAP="
set /p "CEVAP= Devam edilsin mi? E = evet, H = hayir, sonra Enter: "
if /i "%CEVAP%"=="E" goto devam
echo  Iptal edildi, hicbir sey degismedi.
goto son

:devam
echo.
echo  [1/6] Kabuk: Windows Gezgini (HKCU Shell degeri siliniyor)
"%SYS%\reg.exe" delete "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f >nul 2>&1
if errorlevel 1 echo        Zaten yoktu.
if not errorlevel 1 echo        Tamam.

echo  [2/6] kiosk.on siliniyor
if exist "%PANEL%kiosk.on" del /f /q "%PANEL%kiosk.on"
if exist "%PANEL%kiosk.on" echo        UYARI: kiosk.on silinemedi.
if not exist "%PANEL%kiosk.on" echo        Tamam.

echo  [3/6] Ilkeler kaldiriliyor
call :ilke "%POL_S%" DisableTaskMgr
call :ilke "%POL_S%" DisableLockWorkstation
call :ilke "%POL_S%" DisableChangePassword
call :ilke "%POL_E%" NoLogoff
call :ilke "%POL_LS%" HideFastUserSwitching
call :ilke "%POL_LS%" DisableStatusMessages
call :ilke "%POL_LS%" EnableFirstLogonAnimation
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" NoLockScreen
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" AllowEdgeSwipe
call :ilke "HKLM\SOFTWARE\Policies\Microsoft\Windows\System" DisableAcrylicBackgroundOnLogon
call :ilke "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" ToastEnabled
call :ilke "HKCU\Software\Policies\Microsoft\Windows\Explorer" DisableNotificationCenter

echo  [4/6] Acilis gorseli (bcdedit) geri yukleniyor
call :bcd globalsettings bootuxdisabled
call :bcd current quietboot

echo  [5/6] Otomatik oturum acma
set "OTO="
if exist "%YEDEK%" for /f "usebackq tokens=1,2 delims=;" %%A in ("%YEDEK%") do if /i "%%A"=="AUTOLOGON" set "OTO=%%B"
if not "%OTO%"=="1" goto oto_yok
"%SYS%\reg.exe" add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon /t REG_SZ /d 0 /f >nul 2>&1
"%SYS%\reg.exe" delete "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword /f >nul 2>&1
echo        Tamam: otomatik oturum acma kapatildi, kayitli parola silindi.
goto oto_son
:oto_yok
echo        KIOSK_KUR otomatik oturum kurmamisti: dokunulmadi.
:oto_son

echo  [6/6] PrimerMill baslangic gorevi yeniden aciliyor
schtasks /query /tn "PrimerMill" >nul 2>&1
if errorlevel 1 goto gorev_yok
schtasks /change /tn "PrimerMill" /enable >nul
if errorlevel 1 echo        UYARI: gorev acilamadi.
if not errorlevel 1 echo        Tamam: "PrimerMill" gorevi acik.
goto gorev_son
:gorev_yok
echo        Gorev yok (gerekirse YoneticiKurulum.bat).
:gorev_son

if exist "%YEDEK%" ren "%YEDEK%" "kiosk_yedek_kaldirildi_%RANDOM%.txt" >nul 2>&1
echo.
echo  KIOSK KALDIRILDI. Yeniden baslatinca normal Windows masaustu acilir.
echo.
set "CEVAP="
set /p "CEVAP= Bilgisayar simdi yeniden baslatilsin mi? E = evet, H = hayir: "
if /i not "%CEVAP%"=="E" goto son
"%SYS%\shutdown.exe" /r /t 5
goto son

rem ---------------- alt program: ilkeyi geri al ----------------
rem Yedekte "ESKI;anahtar;ad;deger" varsa o deger geri yazilir, yoksa deger silinir (Windows varsayilani).
:ilke
set "ESKIDEG="
if exist "%YEDEK%" for /f "usebackq tokens=1-4 delims=;" %%A in ("%YEDEK%") do if /i "%%A;%%B;%%C"=="ESKI;%~1;%2" set "ESKIDEG=%%D"
if defined ESKIDEG goto ilke_eski
"%SYS%\reg.exe" delete "%~1" /v %2 /f >nul 2>&1
echo        Kaldirildi: %2
exit /b 0
:ilke_eski
"%SYS%\reg.exe" add "%~1" /v %2 /t REG_DWORD /d %ESKIDEG% /f >nul 2>&1
echo        Onceki deger geri yazildi: %2 = %ESKIDEG%
exit /b 0

rem ---------------- alt program: bcdedit degerini geri al ----------------
rem Yedekte onceki deger Yes ise acik birakilir; degilse (No / YOK / yedek yok) deger silinir (varsayilan: kapali).
:bcd
set "ESKIDEG="
if exist "%YEDEK%" for /f "usebackq tokens=1-4 delims=;" %%A in ("%YEDEK%") do if /i "%%A;%%B;%%C"=="BCD;%1;%2" set "ESKIDEG=%%D"
if /i "%ESKIDEG%"=="Yes" goto bcd_acik
"%SYS%\bcdedit.exe" /deletevalue {%1} %2 >nul 2>&1
echo        %2: varsayilan (kapali)
exit /b 0
:bcd_acik
echo        %2: kurulumdan once de acikti, acik birakildi
exit /b 0

:son
echo.
pause
endlocal
exit /b
