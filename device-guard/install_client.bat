@echo off
REM ============================================================
REM  Device Guard - Client PC Kurulum Araci
REM  Bu .bat dosyasini client bilgisayarda YONETICI olarak calistirin.
REM  device_guard.py ve set_password.py ile ayni klasorde olmalidir.
REM ============================================================
setlocal EnableDelayedExpansion
chcp 65001 >nul

set "SRC_DIR=%~dp0"
set "INSTALL_DIR=%ProgramData%\DeviceGuard"

echo.
echo ===== Device Guard - Client Kurulumu =====
echo Kaynak klasor : %SRC_DIR%
echo Kurulum klasoru: %INSTALL_DIR%
echo.

REM --- 1) Python / pythonw kontrolu ---
set "PYW="
for /f "delims=" %%i in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%i"
if not defined PYW (
  echo [HATA] pythonw.exe bulunamadi.
  echo        Python 3'u kurun ^(kurulumda "Add Python to PATH" isaretli olsun^).
  echo        https://www.python.org/downloads/
  pause & exit /b 1
)
echo [OK] Python bulundu: %PYW%

REM --- 2) Gerekli dosyalar var mi? ---
if not exist "%SRC_DIR%device_guard.py" (
  echo [HATA] device_guard.py bu klasorde yok. .bat dosyasini dogru klasorde calistirin.
  pause & exit /b 1
)

REM --- 3) Durum (RAW) linkini al ---
echo.
echo Kontrol panelindeki "Client PC'lerin kullanacagi RAW link" degerini yapistirin:
set /p "STATUS_URL=RAW link: "
if "%STATUS_URL%"=="" (
  echo [HATA] Link bos olamaz.
  pause & exit /b 1
)

REM --- 4) Kurulum klasorunu olustur ve dosyalari kopyala ---
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%SRC_DIR%device_guard.py" "%INSTALL_DIR%\" >nul
copy /Y "%SRC_DIR%set_password.py" "%INSTALL_DIR%\" >nul
echo [OK] Dosyalar kopyalandi.

REM --- 5) config.json'u Python ile guvenli sekilde yaz ---
set "DG_URL=%STATUS_URL%"
set "DG_DIR=%INSTALL_DIR%"
pythonw -c "import json,os;p=os.path.join(os.environ['DG_DIR'],'config.json');json.dump({'status_url':os.environ['DG_URL'],'poll_interval_seconds':10,'on_network_error':'keep','emergency_password_sha256':'','lock_message':'Bu cihaz gecici olarak kullanima kapatilmistir.'},open(p,'w',encoding='utf-8'),indent=2,ensure_ascii=False)"
if not exist "%INSTALL_DIR%\config.json" (
  echo [HATA] config.json yazilamadi.
  pause & exit /b 1
)
echo [OK] config.json yazildi.

REM --- 6) Acil-acma sifresi (istege bagli) ---
echo.
set /p "WANTPW=Acil-acma sifresi belirlemek ister misiniz? (E/H): "
if /i "%WANTPW%"=="E" (
  pushd "%INSTALL_DIR%"
  python set_password.py
  popd
)

REM --- 7) Acilista calistiracak gorevi kur ---
echo.
schtasks /Create /TN "DeviceGuard" ^
  /TR "\"%PYW%\" \"%INSTALL_DIR%\device_guard.py\"" ^
  /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (
  echo [HATA] Baslangic gorevi olusturulamadi. .bat'i Yonetici olarak calistirin.
  pause & exit /b 1
)
echo [OK] Baslangic gorevi "DeviceGuard" olusturuldu.

REM --- 8) Hemen baslat ---
echo.
echo Simdi test icin ajani baslatiyoruz...
schtasks /Run /TN "DeviceGuard" >nul 2>&1

echo.
echo ===== KURULUM TAMAM =====
echo - Panelden KILITLE deyince bu cihaz birkac saniye icinde kilitlenir.
echo - Kaldirmak icin: uninstall_startup.bat ^(Yonetici^)
echo.
pause
endlocal
