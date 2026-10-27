@echo off
REM Device Guard'i client PC'den kaldirir. Yonetici olarak calistirin.
chcp 65001 >nul
set "INSTALL_DIR=%ProgramData%\DeviceGuard"

echo Device Guard kaldiriliyor...

REM Calisan ajani durdur
schtasks /End /TN "DeviceGuard" >nul 2>&1
REM Baslangic gorevini sil
schtasks /Delete /TN "DeviceGuard" /F >nul 2>&1

REM Kurulum klasorunu sil (istege bagli)
if exist "%INSTALL_DIR%" (
  set /p "DELDIR=Kurulum klasoru de silinsin mi? %INSTALL_DIR% (E/H): "
  if /i "%DELDIR%"=="E" rmdir /S /Q "%INSTALL_DIR%"
)

echo DeviceGuard kaldirildi.
pause
