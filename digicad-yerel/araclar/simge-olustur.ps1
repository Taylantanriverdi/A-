# DIGICAD Dental — masaüstü simgesi oluşturur.
# Yönetim panelini Chrome (yoksa Edge) "uygulama penceresi" olarak açan bir
# kısayol: adres çubuğu / sekme yok, ayrı bir program gibi görünür.
param([string]$Hedef = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
$ErrorActionPreference = 'Stop'

$port = 8080
try { $a = Get-Content (Join-Path $Hedef 'veri\ayarlar.json') -Raw | ConvertFrom-Json; if ($a.icPort) { $port = [int]$a.icPort } } catch {}

$adaylar = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$tarayici = $adaylar | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$masaustu = [Environment]::GetFolderPath('Desktop')
$simge = Join-Path $Hedef 'simge\digicad.ico'

function Kisayol([string]$ad, [string]$sayfa, [string]$aciklama) {
  $adres = "http://localhost:$port/$sayfa"
  if ($tarayici) {
    $sh = New-Object -ComObject WScript.Shell
    $k = $sh.CreateShortcut((Join-Path $masaustu ($ad + '.lnk')))
    $k.TargetPath = $tarayici
    $k.Arguments = "--app=$adres"
    $k.WorkingDirectory = $Hedef
    $k.IconLocation = "$simge,0"
    $k.Description = $aciklama
    $k.Save()
  } else {
    # Tarayıcı bulunamazsa normal internet kısayolu
    $metin = "[InternetShortcut]`r`nURL=$adres`r`nIconFile=$simge`r`nIconIndex=0`r`n"
    [IO.File]::WriteAllText((Join-Path $masaustu ($ad + '.url')), $metin)
  }
}

Kisayol 'DIGICAD Dental' 'PrimerLab.html' 'DIGICAD Dental Laboratuvar - Yönetim Sistemi (yerel)'
Write-Host ('  Masaüstü simgesi oluşturuldu: DIGICAD Dental' + $(if ($tarayici) { '  (' + (Split-Path -Leaf $tarayici) + ' uygulama penceresi)' } else { '' })) -ForegroundColor Green
