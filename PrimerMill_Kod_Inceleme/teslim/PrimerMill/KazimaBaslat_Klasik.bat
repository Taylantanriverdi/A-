@echo off
rem PrimerMill eski (klasik) panel - yedek. Eding cncapi.dll 32 bit oldugu icin 32 bit PowerShell kullanilir
set "PS=%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
start "" "%PS%" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0KazimaBaslat_Klasik.ps1"
