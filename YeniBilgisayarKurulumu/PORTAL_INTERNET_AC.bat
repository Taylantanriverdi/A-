@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PRIMER LAB - HEKIM PORTALI INTERNET ERISIMI

rem Hekim Portalini dunyanin her yerinden (internetten) erisilebilir yapar.
rem Program, portal icin yalniz bu bilgisayarin icinden ulasilan ayri bir port (5170)
rem acar. Bu porttan yalniz Hekim Portali sunulur; yonetim ekrani, muhasebe, yedek
rem gibi bolumler internetten HICBIR ZAMAN acilmaz. Modem ayari / port yonlendirme
rem gerekmez: sifreli tunel (Cloudflare veya Tailscale) bu porta baglanir.

net session >nul 2>&1
if errorlevel 1 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "UYGULAMA=C:\PrimerLab\Uygulama"
set "AYAR=%UYGULAMA%\appsettings.Production.json"
if not exist "%AYAR%" goto KURULU_DEGIL

echo ============================================================
echo  HEKIM PORTALI - INTERNET ERISIMI
echo ============================================================
echo.
echo  1^) Cloudflare Tunnel  - kendi alan adiniz varsa ^(ONERILEN^)
echo     Adres ornegi: https://portal.primerlab.com
echo.
echo  2^) Tailscale Funnel   - alan adi gerekmez, ucretsiz
echo     Adres ornegi: https://primerlab-pc.tail1234.ts.net
echo.
echo  3^) Internet erisimini KAPAT
echo.
choice /c 123 /n /m "Seciminiz (1, 2 veya 3): "
if errorlevel 3 goto KAPAT
if errorlevel 2 goto TAILSCALE
goto CLOUDFLARE

rem ------------------------------------------------------------
:CLOUDFLARE
echo.
echo  ONCE CLOUDFLARE SITESINDE ^(bir kez^):
echo   a^) dash.cloudflare.com - alan adiniz Cloudflare'e ekli olmali.
echo   b^) Sol menu: Zero Trust ^> Networks ^> Tunnels ^> Create a tunnel
echo   c^) "Cloudflared" secin, ad: PrimerLab, Save.
echo   d^) Windows secin. Gorunen komutun SONUNDAKI uzun anahtari ^(token^) kopyalayin.
echo   e^) Next ^> Public Hostname:
echo        Subdomain: portal     Domain: alan adiniz
echo        Type: HTTP            URL: localhost:5170
echo      Save tunnel.
echo.
call :WINGET Cloudflare.cloudflared
set "CF="
for %%P in ("%ProgramFiles(x86)%\cloudflared\cloudflared.exe" "%ProgramFiles%\cloudflared\cloudflared.exe") do if exist %%P set "CF=%%~P"
if not defined CF for /f "delims=" %%P in ('where cloudflared 2^>nul') do if not defined CF set "CF=%%P"
if not defined CF goto CF_YOK

echo.
set "TOKEN="
set /p "TOKEN=Token'i yapistirin (sag tik) ve Enter'a basin: "
if not defined TOKEN goto IPTAL
rem Komutun tamami yapistirildiysa son kelime (token) alinir. ("=" isareti korunur.)
for /f "delims=" %%A in ('powershell -NoProfile -Command "($env:TOKEN.Trim() -split '\s+')[-1]"') do set "TOKEN=%%A"

"%CF%" service uninstall >nul 2>&1
"%CF%" service install %TOKEN%
if errorlevel 1 goto CF_HATA

echo.
set "ADRES="
set /p "ADRES=Cloudflare'de verdiginiz adres (orn: portal.primerlab.com): "
if not defined ADRES goto IPTAL
call :ADRES_YAZ || goto ADRES_HATA
goto BITTI

rem ------------------------------------------------------------
:TAILSCALE
echo.
call :WINGET Tailscale.Tailscale
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" goto TS_YOK
echo.
echo  Tarayicida Tailscale girisi acilacak. Google / Microsoft hesabinizla
echo  giris yapin, sonra bu pencereye donun.
"%TS%" up
if errorlevel 1 goto TS_HATA
echo.
echo  Funnel ilk kez kullaniliyorsa ekranda bir baglanti cikar; o baglantiyi
echo  acip "Enable" deyin, sonra bu pencereye donun.
"%TS%" funnel --bg 5170
if errorlevel 1 goto TS_HATA
set "ADRES="
for /f "delims=" %%D in ('powershell -NoProfile -Command "(& $env:TS status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')"') do set "ADRES=%%D"
if not defined ADRES goto TS_HATA
call :ADRES_YAZ || goto ADRES_HATA
goto BITTI

rem ------------------------------------------------------------
:KAPAT
set "CF="
for %%P in ("%ProgramFiles(x86)%\cloudflared\cloudflared.exe" "%ProgramFiles%\cloudflared\cloudflared.exe") do if exist %%P set "CF=%%~P"
if defined CF "%CF%" service uninstall >nul 2>&1
if exist "%ProgramFiles%\Tailscale\tailscale.exe" "%ProgramFiles%\Tailscale\tailscale.exe" funnel reset >nul 2>&1
set "ADRES="
call :ADRES_YAZ >nul 2>&1
echo.
echo Internet erisimi KAPATILDI. Portal yalniz ayni Wi-Fi agindan kullanilabilir.
pause
exit /b 0

rem ------------------------------------------------------------
:WINGET
where winget >nul 2>&1 || exit /b 0
echo %~1 yukleniyor / guncelleniyor...
winget install --id %~1 -e --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
exit /b 0

:ADRES_YAZ
rem Adres program ayarina yazilir; Ayarlar > Hekim Portal Hesabi ekraninda gorunur.
powershell -NoProfile -Command "$a=($env:ADRES+'').Trim() -replace '^https?://','' -replace '/.*$',''; if($a -and $a -notmatch '^[A-Za-z0-9.-]+$'){ exit 1 }; $p=$env:AYAR; $j=Get-Content -Raw -Encoding UTF8 $p | ConvertFrom-Json; if(-not $j.PrimerLab){ $j | Add-Member -NotePropertyName PrimerLab -NotePropertyValue ([pscustomobject]@{}) }; $v=''; if($a){ $v='https://'+$a }; $j.PrimerLab | Add-Member -NotePropertyName PortalInternetUrl -NotePropertyValue $v -Force; [IO.File]::WriteAllText($p, ($j | ConvertTo-Json -Depth 10)); if($a){ Write-Output ('https://'+$a+'/hekim-portal') }" > "%TEMP%\primerlab_portal_adres.txt"
if errorlevel 1 exit /b 1
set "TAM_ADRES="
set /p TAM_ADRES=<"%TEMP%\primerlab_portal_adres.txt"
del "%TEMP%\primerlab_portal_adres.txt" >nul 2>&1
exit /b 0

:BITTI
echo.
echo ============================================================
echo  HEKIM PORTALI INTERNETE ACILDI
echo ============================================================
echo  Hekimlere verilecek adres:
echo     %TAM_ADRES%
echo.
echo  - Adres birkac dakika icinde calismaya baslar.
echo  - Telefonun Wi-Fi'sini kapatip mobil veriyle deneyin.
echo  - Hekim hesaplari: Primer Lab ^> Hekimler ^> Portal butonu.
echo  - Bu bilgisayar ve Primer Lab acik oldugu surece portal calisir.
echo ============================================================
pause
exit /b 0

:IPTAL
echo Islem iptal edildi. Hicbir degisiklik yapilmadi.
pause
exit /b 1
:KURULU_DEGIL
echo HATA: Bu bilgisayarda kurulu Primer Lab bulunamadi. Once KURULUM.bat'i calistirin.
pause
exit /b 1
:CF_YOK
echo HATA: cloudflared yuklenemedi. Internet baglantisini kontrol edip tekrar deneyin.
pause
exit /b 1
:CF_HATA
echo HATA: Tunel kurulamadi. Token'in tamamini kopyaladiginizdan emin olup tekrar deneyin.
pause
exit /b 1
:TS_YOK
echo HATA: Tailscale yuklenemedi. Internet baglantisini kontrol edip tekrar deneyin.
pause
exit /b 1
:TS_HATA
echo HATA: Tailscale Funnel acilamadi. Yukaridaki mesajin fotografini Claude'a gonderin.
pause
exit /b 1
:ADRES_HATA
echo HATA: Adres gecersiz. Yalniz alan adini yazin, orn: portal.primerlab.com
pause
exit /b 1
