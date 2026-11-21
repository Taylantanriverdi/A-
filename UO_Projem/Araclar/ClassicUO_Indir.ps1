param(
    [Parameter(Mandatory = $true)][string]$Hedef,
    [string]$Repo = 'ClassicUO/ClassicUO',
    [string]$Tag = 'ClassicUO-main-release',
    [string]$Asset = 'ClassicUO-win-x64-release.zip'
)
# ClassicUO'nun Windows x64 sürümünü GitHub API üzerinden bulup $Hedef klasörüne açar.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'   # PowerShell 5.1'de indirmeyi çok hızlandırır
$headers = @{ 'User-Agent' = 'UO-Projem-Kurulum'; 'Accept' = 'application/vnd.github+json' }

function Find-AssetUrl {
    param($Release)
    if (-not $Release -or -not $Release.assets) { return $null }
    $a = $Release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
    if (-not $a) { $a = $Release.assets | Where-Object { $_.name -match 'win.*x64.*\.zip$' } | Select-Object -First 1 }
    if ($a) { return $a.browser_download_url }
    return $null
}

$url = $null
foreach ($api in @("https://api.github.com/repos/$Repo/releases/tags/$Tag",
                   "https://api.github.com/repos/$Repo/releases/latest")) {
    try {
        Write-Host "  GitHub API sorgulanıyor: $api"
        $url = Find-AssetUrl (Invoke-RestMethod -Uri $api -Headers $headers)
        if ($url) { break }
    } catch {
        Write-Host "  API yanıt vermedi: $($_.Exception.Message)"
    }
}
if (-not $url) {
    $url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
    Write-Host "  API'den adres alınamadı, doğrudan adres deneniyor."
}

$tmpDir = Join-Path $env:TEMP ("cuo_" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$zip = Join-Path $tmpDir 'classicuo.zip'
try {
    Write-Host "  İndiriliyor: $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ 'User-Agent' = 'UO-Projem-Kurulum' } -UseBasicParsing

    $extract = Join-Path $tmpDir 'x'
    Expand-Archive -Path $zip -DestinationPath $extract -Force

    # Zip bir üst klasör içerebilir: ClassicUO.exe'nin bulunduğu klasörü kaynak al.
    $exe = Get-ChildItem -Path $extract -Filter 'ClassicUO.exe' -Recurse | Select-Object -First 1
    if (-not $exe) { throw 'Arşivde ClassicUO.exe bulunamadı.' }
    $src = $exe.DirectoryName

    New-Item -ItemType Directory -Path $Hedef -Force | Out-Null
    # Var olan settings.json ve UO_Files korunur, geri kalan dosyalar güncellenir.
    Get-ChildItem -Path $src -Force | ForEach-Object {
        if ($_.Name -ieq 'settings.json' -and (Test-Path (Join-Path $Hedef 'settings.json'))) { return }
        Copy-Item -Path $_.FullName -Destination $Hedef -Recurse -Force
    }
    Write-Host "  ClassicUO kuruldu: $Hedef"
} finally {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
