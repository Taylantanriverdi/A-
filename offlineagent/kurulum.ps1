# Offline Agent - tek satirlik kurulum
# PowerShell'e yapistirin:
#   irm https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/keen-wozniak-zjal69/offlineagent/kurulum.ps1 | iex
# Farkli klasor icin once:  $env:OFFLINEAGENT_DIZIN = 'E:\baska\klasor'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Hedef = if ($env:OFFLINEAGENT_DIZIN) { $env:OFFLINEAGENT_DIZIN } else { 'D:\offlineagent' }
$Dal = if ($env:OFFLINEAGENT_DAL) { $env:OFFLINEAGENT_DAL } else { 'claude/keen-wozniak-zjal69' }

Write-Host "Offline Agent dosyalari indiriliyor -> $Hedef" -ForegroundColor Cyan
$gecici = Join-Path $env:TEMP 'offlineagent-kurulum'
if (Test-Path $gecici) { Remove-Item $gecici -Recurse -Force }
New-Item -ItemType Directory -Force $gecici | Out-Null
$zip = Join-Path $gecici 'paket.zip'
Invoke-WebRequest "https://github.com/Taylantanriverdi/A-/archive/refs/heads/$Dal.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath (Join-Path $gecici 'acik') -Force
$ust = Get-ChildItem (Join-Path $gecici 'acik') -Directory | Select-Object -First 1
$kaynak = Join-Path $ust.FullName 'offlineagent'

New-Item -ItemType Directory -Force $Hedef | Out-Null
Copy-Item (Join-Path $kaynak '*') $Hedef -Recurse -Force
Get-ChildItem $Hedef -Recurse -File | Unblock-File
Remove-Item $gecici -Recurse -Force -ErrorAction SilentlyContinue

Write-Host 'Dosyalar hazir, kurulum basliyor...' -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Hedef 'scripts\kur.ps1')
