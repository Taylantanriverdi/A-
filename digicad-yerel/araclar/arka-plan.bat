@echo off
rem Gorev Zamanlayici tarafindan calistirilir (pencere yok). %1 = node.exe yolu
cd /d "%~dp0.."
if not exist veri mkdir veri
:dongu
echo [%date% %time%] Sunucu baslatiliyor >> veri\sunucu.log
%1 sunucu.js >> veri\sunucu.log 2>&1
echo [%date% %time%] Sunucu durdu, 5 sn sonra yeniden baslatilacak >> veri\sunucu.log
ping -n 6 127.0.0.1 >nul
goto dongu
