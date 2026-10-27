@echo off
REM Device Guard'i Windows acilisinda (oturum acildiginda) otomatik baslatir.
REM Bu .bat dosyasini YONETICI olarak calistirin.
REM Pencere gostermemek icin pythonw.exe kullaniriz.

setlocal
set SCRIPT_DIR=%~dp0
set PYW=pythonw.exe

echo Device Guard baslangic gorevi olusturuluyor...

schtasks /Create ^
  /TN "DeviceGuard" ^
  /TR "\"%PYW%\" \"%SCRIPT_DIR%device_guard.py\"" ^
  /SC ONLOGON ^
  /RL HIGHEST ^
  /F

if %ERRORLEVEL%==0 (
  echo.
  echo Basarili. "DeviceGuard" gorevi her oturum acilisinda calisacak.
  echo Simdi test etmek icin: schtasks /Run /TN "DeviceGuard"
) else (
  echo.
  echo Gorev olusturulamadi. Bu .bat dosyasini Yonetici olarak calistirdiginizdan emin olun.
)
endlocal
pause
