@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title PRIMER AUTO BAR - Kurulum
echo ==========================================================
echo   PRIMER AUTO BAR V1 - Kurulum
echo ==========================================================
echo.

rem ---- 1. Python bul (3.10 ve uzeri) -------------------------------------
set "PY="
call :try_cmd "py -3"
if not defined PY call :try_cmd "python"
if not defined PY call :try_exe "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY call :try_exe "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if defined PY goto :have_py

echo Python 3.10+ bulunamadi.
where winget >nul 2>nul
if errorlevel 1 goto :manual_python
choice /c EH /m "Python 3.12 simdi otomatik kurulsun mu (E=Evet, H=Hayir)"
if errorlevel 2 goto :manual_python
winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
call :try_exe "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY call :try_cmd "py -3"
if defined PY goto :have_py

:manual_python
echo.
echo Lutfen https://www.python.org/downloads/ adresinden Python 3.12 kurun.
echo Kurulumda "Add python.exe to PATH" kutusunu ISARETLEYIN, sonra bu dosyayi tekrar calistirin.
pause
exit /b 1

:have_py
echo Python bulundu: %PY%
echo.

rem ---- 2. Sanal ortam ve paketler -----------------------------------------
if exist ".venv\Scripts\python.exe" goto :have_venv
echo [1/4] Sanal ortam olusturuluyor...
%PY% -m venv .venv
if errorlevel 1 goto :fail
:have_venv
set "VPY=%CD%\.venv\Scripts\python.exe"

echo [2/4] Paketler kuruluyor (internet gerekli, birkac dakika surebilir)...
"%VPY%" -m pip install --upgrade pip >nul
"%VPY%" -m pip install -r requirements.txt
if errorlevel 1 goto :fail
echo        Hizlandirici (embreex) deneniyor - kurulamazsa sorun degil...
"%VPY%" -m pip install embreex >nul 2>nul

echo [3/4] Kurulum dogrulaniyor...
"%VPY%" -c "import primer_autobar, trimesh, manifold3d, scipy; print('       Paketler OK - surum', primer_autobar.__version__)"
if errorlevel 1 goto :fail

rem ---- 3. Blender eklentisi -----------------------------------------------
echo [4/4] Blender eklentisi
choice /c EH /m "Blender eklentisi de kurulsun mu (E=Evet, H=Hayir)"
if errorlevel 2 goto :done
call "%~dp0BLENDER_EKLENTI_KUR.bat" nopause

:done
echo.
echo ==========================================================
echo   KURULUM TAMAM
echo   - Deneme icin:      DEMO_CALISTIR.bat
echo   - Kendi vakaniz:    STL ve implants.json dosyalarini
echo                       BAR_OLUSTUR.bat uzerine surukleyin
echo ==========================================================
pause
exit /b 0

:fail
echo.
echo HATA: Kurulum tamamlanamadi. Yukaridaki mesaji kontrol edin.
pause
exit /b 1

rem ---- yardimcilar: Python 3.10+ ise PY'ye ata ------------------------------
:try_cmd
%~1 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=%~1"
exit /b 0

:try_exe
if not exist "%~1" exit /b 0
"%~1" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if not errorlevel 1 set PY="%~1"
exit /b 0
