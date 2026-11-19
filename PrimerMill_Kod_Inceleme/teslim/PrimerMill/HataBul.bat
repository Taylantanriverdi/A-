@echo off
rem PrimerMill acilmiyorsa: hatayi ekranda gosterir. Bu dosyayi KazimaBaslat.ps1 ile AYNI klasore koy.
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0HataBul.ps1"
pause
