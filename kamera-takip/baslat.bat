@echo off
REM Windows: once go2rtc'yi baslatir, sonra takip programini acar.
cd /d %~dp0
start "go2rtc" go2rtc.exe -config go2rtc.yaml
timeout /t 5 /nobreak >nul
python takip.py --kaynak rtsp://127.0.0.1:8554/xiaomi --maske-saat --kaydet kayitlar
pause
