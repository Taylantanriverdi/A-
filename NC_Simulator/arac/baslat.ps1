# Dental NC Simulatoru - baslatici
# 1) Verilen / secilen NC dosyalarini autoload.js icine paketler
# 2) Edge veya Chrome'u AYRI bir profil ile, 3D (WebGL) zorlanmis olarak acar.
#    Ayri profil sayesinde tarayici zaten acik olsa bile ayarlar uygulanir.
param(
  [switch]$Sec,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Files
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$html = Join-Path $root 'NC_Simulator.html'
$auto = Join-Path $root 'autoload.js'
if (-not (Test-Path -LiteralPath $html)) { Write-Host "NC_Simulator.html bulunamadi: $html"; exit 1 }
if (Test-Path -LiteralPath $auto) { Remove-Item -LiteralPath $auto -Force -ErrorAction SilentlyContinue }

if ($Sec) {
  Add-Type -AssemblyName System.Windows.Forms
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = 'NC dosyasi secin (karsilastirma icin 2 dosya secebilirsiniz)'
  $d.Filter = 'NC dosyalari (*.nc;*.ngc;*.tap;*.cnc;*.txt)|*.nc;*.ngc;*.tap;*.cnc;*.txt|Tum dosyalar (*.*)|*.*'
  $d.Multiselect = $true
  if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
  $Files = $d.FileNames
}

# --- NC dosyalarini paketle ---
if ($Files -and $Files.Count -gt 0) {
  try {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('window.__NC_AUTOLOAD=[')
    $n = 0
    foreach ($f in $Files) {
      if ($n -ge 2) { break }
      if (-not (Test-Path -LiteralPath $f)) { Write-Host "Bulunamadi: $f"; continue }
      $p = (Resolve-Path -LiteralPath $f).ProviderPath
      $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($p))
      $name = [System.IO.Path]::GetFileName($p) -replace '[\\"''<>]', '_'
      if ($n -gt 0) { [void]$sb.Append(',') }
      [void]$sb.Append('{name:"').Append($name).Append('",b64:"').Append($b64).Append('"}')
      Write-Host "Hazirlandi: $name"
      $n++
    }
    [void]$sb.Append('];')
    [System.IO.File]::WriteAllText($auto, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Write-Host "Dosyalar otomatik yuklenemedi: $($_.Exception.Message)"
    Write-Host "Programda 'NC Dosyasi Ac' dugmesiyle secebilirsiniz."
  }
}

# --- Tarayiciyi bul ---
function Get-AppPath([string]$exe) {
  foreach ($hive in 'HKCU:', 'HKLM:', 'HKLM:\SOFTWARE\WOW6432Node') {
    $k = if ($hive -like '*WOW6432Node') { "$hive\Microsoft\Windows\CurrentVersion\App Paths\$exe" } else { "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" }
    try { $v = (Get-ItemProperty -LiteralPath $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path -LiteralPath $v.Trim('"'))) { return $v.Trim('"') } } catch { }
  }
  return $null
}
$pf86 = ${env:ProgramFiles(x86)}
$cands = @(
  (Get-AppPath 'chrome.exe'),
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$pf86\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  (Get-AppPath 'msedge.exe'),
  "$pf86\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$browser = $cands | Select-Object -First 1

# Turkce karakter / bosluk iceren yollar icin dogru kodlanmis file:/// adresi
$uri = ([System.Uri]$html).AbsoluteUri

if ($browser) {
  $prof = Join-Path $env:LOCALAPPDATA 'DentalNCSimulator\tarayici-profili'
  New-Item -ItemType Directory -Force -Path $prof | Out-Null
  $argList = @(
    "--user-data-dir=`"$prof`"",
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files',
    '--start-maximized',
    "--app=`"$uri`""
  )
  Write-Host "Aciliyor: $browser"
  Start-Process -FilePath $browser -ArgumentList $argList
} else {
  Write-Host 'Edge/Chrome bulunamadi, varsayilan tarayici kullaniliyor.'
  Start-Process -FilePath $html
}
exit 0
