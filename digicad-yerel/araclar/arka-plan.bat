@echo off
rem Gorev Zamanlayici tarafindan calistirilir (pencere yok). %1 = node.exe yolu
cd /d "%~dp0.."
if not exist veri mkdir veri
:dongu
rem Kayit dosyasi 5 MB'i gecince eskisi sunucu-eski.log olarak saklanir (disk dolmasin)
if exist veri\sunucu.log for %%F in (veri\sunucu.log) do if %%~zF GTR 5000000 move /y veri\sunucu.log veri\sunucu-eski.log >nul 2>&1
echo [%date% %time%] Sunucu baslatiliyor >> veri\sunucu.log
%1 sunucu.js >> veri\sunucu.log 2>&1
echo [%date% %time%] Sunucu durdu, 5 sn sonra yeniden baslatilacak >> veri\sunucu.log
ping -n 6 127.0.0.1 >nul
goto dongu
