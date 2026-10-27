@echo off
REM Device Guard baslangic gorevini kaldirir. Yonetici olarak calistirin.
schtasks /Delete /TN "DeviceGuard" /F
echo DeviceGuard baslangic gorevi kaldirildi (varsa).
pause
