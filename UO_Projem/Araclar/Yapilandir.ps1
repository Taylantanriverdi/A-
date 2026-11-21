param(
    [Parameter(Mandatory = $true)][string]$ServerDir,
    [Parameter(Mandatory = $true)][string]$ClientDir,
    [Parameter(Mandatory = $true)][string]$Ip,
    [int]$Port = 0,
    [string]$ShardName = '',
    [string]$UoFiles = '',
    [string]$ClientVersion = ''
)
# Server.cfg, DataPath.cfg ve ClassicUO settings.json dosyalarını yazar/günceller.
# Boş bırakılan parametreler dosyada olduğu gibi kalır (Online geçişte sadece -Ip verilir).
$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Backup-File([string]$Path) {
    if (Test-Path $Path) { Copy-Item $Path "$Path.bak" -Force }
}

# "Anahtar=Değer" satırını ayarlar. Yorum satırı (#Anahtar=...) varsa onu açar, hiç yoksa sona ekler.
function Set-CfgValue([string]$Path, [string]$Key, [string]$Value) {
    $lines = @()
    if (Test-Path $Path) { $lines = @([IO.File]::ReadAllLines($Path)) }
    $k = [regex]::Escape($Key)
    $done = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$k\s*=") { $lines[$i] = "$Key=$Value"; $done = $true; break }
    }
    if (-not $done) {
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match "^\s*#\s*$k\s*=") { $lines[$i] = "$Key=$Value"; $done = $true; break }
        }
    }
    if (-not $done) { $lines += "$Key=$Value" }
    Write-Utf8NoBom $Path (($lines -join "`r`n") + "`r`n")
}

if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -and $Ip -notmatch '^[A-Za-z0-9.-]+$') {
    throw "Geçersiz IP/adres: $Ip"
}

# ---------------- ServUO ----------------
$cfgDir = Join-Path $ServerDir 'Config'
if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }

$serverCfg = Join-Path $cfgDir 'Server.cfg'
Backup-File $serverCfg
if ($ShardName) { Set-CfgValue $serverCfg 'Name' $ShardName }
Set-CfgValue $serverCfg 'Address' $Ip
if ($Port -gt 0) { Set-CfgValue $serverCfg 'Port' $Port }
# Listen her zaman tüm arayüzleri dinlesin; böylece hem yerelde hem VDS'de çalışır.
if (-not (Select-String -Path $serverCfg -Pattern '^\s*Listen\s*=' -Quiet)) {
    Set-CfgValue $serverCfg 'Listen' '0.0.0.0'
}
Write-Host "  Server.cfg   -> Address=$Ip" $(if ($Port -gt 0) { "Port=$Port" }) $(if ($ShardName) { "Name=$ShardName" })

if ($UoFiles) {
    $dataCfg = Join-Path $cfgDir 'DataPath.cfg'
    Backup-File $dataCfg
    Set-CfgValue $dataCfg 'CustomPath' $UoFiles
    Write-Host "  DataPath.cfg -> CustomPath=$UoFiles"
}

# ---------------- ClassicUO ----------------
$settings = Join-Path $ClientDir 'settings.json'
$obj = $null
if (Test-Path $settings) {
    Backup-File $settings
    try { $obj = [IO.File]::ReadAllText($settings) | ConvertFrom-Json } catch { $obj = $null }
}
if (-not $obj) { $obj = New-Object PSObject }

function Set-JsonValue($o, [string]$Name, $Value) {
    $o | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

Set-JsonValue $obj 'ip' $Ip
if ($Port -gt 0) { Set-JsonValue $obj 'port' $Port }
if ($UoFiles) { Set-JsonValue $obj 'ultimaonlinedirectory' $UoFiles }
if ($ClientVersion) { Set-JsonValue $obj 'clientversion' $ClientVersion }
if (-not $obj.PSObject.Properties['clientversion']) { Set-JsonValue $obj 'clientversion' '' }

Write-Utf8NoBom $settings ($obj | ConvertTo-Json -Depth 10)
Write-Host "  settings.json-> ip=$Ip" $(if ($Port -gt 0) { "port=$Port" }) $(if ($UoFiles) { "ultimaonlinedirectory=$UoFiles" })
