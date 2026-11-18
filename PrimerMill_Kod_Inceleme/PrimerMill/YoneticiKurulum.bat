@echo off
rem PrimerMill - bir kez calistir. Paneli Windows acilisinda YONETICI olarak (UAC sormadan) baslatir,
rem boylece Eding penceresini kesin gizleyebilir. Ag erisimi icin guvenlik duvari iznini de verir.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo PrimerMill yonetici kurulumu...
schtasks /create /tn "PrimerMill" /tr "\"%~dp0KazimaBaslat.bat\"" /sc onlogon /rl highest /f
if errorlevel 1 (
  echo HATA: baslangic gorevi olusturulamadi.
) else (
  echo Tamam: Windows acilinca PrimerMill yonetici olarak baslayacak.
)
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PrimerMill.lnk" >nul 2>&1
netsh advfirewall firewall delete rule name="PrimerMill Uzak" >nul 2>&1
netsh advfirewall firewall add rule name="PrimerMill Uzak" dir=in action=allow protocol=TCP localport=8080-8084,18080,28080 remoteip=localsubnet profile=any >nul
echo Tamam: ag erisimi izni verildi.
echo.
echo Simdi bilgisayari yeniden baslat.
pause
