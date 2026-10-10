# Offline Agent - tum betiklerin kullandigi ortak ayarlar ve fonksiyonlar
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest'i cok hizlandirir
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Kok = Split-Path -Parent $PSScriptRoot
$Yollar = @{
    Araclar  = Join-Path $Kok 'araclar'
    Uv       = Join-Path $Kok 'araclar\uv\uv.exe'
    Venv     = Join-Path $Kok '.venv'
    Python   = Join-Path $Kok '.venv\Scripts\python.exe'
    Pythonw  = Join-Path $Kok '.venv\Scripts\pythonw.exe'
    App      = Join-Path $Kok 'app'
    Veri     = Join-Path $Kok 'veri'
    Belgeler = Join-Path $Kok 'belgeler'
    Modeller = Join-Path $Kok 'modeller'
    PidDosya = Join-Path $Kok 'veri\sunucu.pid'
    SonGunc  = Join-Path $Kok 'veri\son_guncelleme.txt'
}

# Python ve modeller dahil her sey bu klasorde kalsin
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Yollar.Araclar 'python'
$env:UV_CACHE_DIR = Join-Path $Yollar.Araclar 'uv-cache'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:OLLAMA_MODELS = $Yollar.Modeller

function Yaz([string]$Mesaj, [string]$Renk = 'Gray') { Write-Host $Mesaj -ForegroundColor $Renk }
function Baslik([string]$Mesaj) { Write-Host ''; Write-Host "==> $Mesaj" -ForegroundColor Cyan }

function Get-Ayarlar {
    $ayar = Get-Content (Join-Path $Kok 'ayarlar.varsayilan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $kullanici = Join-Path $Kok 'ayarlar.json'
    if (Test-Path $kullanici) {
        try {
            $u = Get-Content $kullanici -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $u.PSObject.Properties) {
                $ayar | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
            }
        } catch { Yaz 'ayarlar.json okunamadi, varsayilan ayarlar kullaniliyor.' Yellow }
    }
    return $ayar
}

function Get-Modeller($Ayar) { @($Ayar.genel_model, $Ayar.kod_model, $Ayar.embed_model) }

function Test-Internet {
    try { $null = Invoke-WebRequest 'https://github.com' -Method Head -UseBasicParsing -TimeoutSec 5; return $true }
    catch { return $false }
}

function Get-OllamaExe {
    $komut = Get-Command ollama -ErrorAction SilentlyContinue
    if ($komut) { return $komut.Source }
    $yol = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $yol) { return $yol }
    return $null
}

function Test-Ollama {
    try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 3; return $true }
    catch { return $false }
}

function Start-Ollama {
    if (Test-Ollama) { return $true }
    $exe = Get-OllamaExe
    if (-not $exe) { return $false }
    $uygulama = Join-Path (Split-Path $exe) 'ollama app.exe'
    if (Test-Path $uygulama) { Start-Process -FilePath $uygulama }
    else { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden }
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Ollama) { return $true }
    }
    return $false
}

function Restart-Ollama {
    Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    return (Start-Ollama)
}

function Get-YukluModeller {
    try { return @((Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5).models | ForEach-Object { $_.name }) }
    catch { return @() }
}

function Test-ModelVar([string]$Ad, $Liste) {
    $tam = if ($Ad.Contains(':')) { $Ad } else { "$($Ad):latest" }
    return ($Liste -contains $tam)
}

function Invoke-ModelIndir([string]$Ad) {
    Yaz "Model indiriliyor/guncelleniyor: $Ad" White
    & (Get-OllamaExe) pull $Ad
    if ($LASTEXITCODE -ne 0) { throw "Model indirilemedi: $Ad" }
}

function Get-SunucuAdres($Ayar) { "http://127.0.0.1:$($Ayar.port)" }

function Test-Sunucu($Ayar) {
    try { $null = Invoke-RestMethod "$(Get-SunucuAdres $Ayar)/api/saglik" -TimeoutSec 2; return $true }
    catch { return $false }
}

function Stop-Sunucu {
    if (Test-Path $Yollar.PidDosya) {
        $sunucuPid = Get-Content $Yollar.PidDosya -ErrorAction SilentlyContinue
        if ($sunucuPid) { Stop-Process -Id $sunucuPid -Force -ErrorAction SilentlyContinue }
        Remove-Item $Yollar.PidDosya -Force -ErrorAction SilentlyContinue
        return $true
    }
    return $false
}

function Set-SonGuncelleme { Set-Content -Path $Yollar.SonGunc -Value (Get-Date -Format 'o') }

function Get-SonGuncelleme {
    try { return [datetime]::Parse((Get-Content $Yollar.SonGunc -ErrorAction Stop | Select-Object -First 1)) }
    catch { return [datetime]::MinValue }
}

function Install-PythonPaketleri {
    & $Yollar.Uv pip install --python $Yollar.Python -r (Join-Path $Kok 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python paketleri kurulamadi.' }
}
