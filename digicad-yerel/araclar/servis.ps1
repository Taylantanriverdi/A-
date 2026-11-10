# DIGICAD Dental — sunucuyu Windows Görev Zamanlayıcı ile arka planda çalıştırma
# Kullanım: servis.ps1 -Islem kur | durdur | baslat | kaldir | durum
param([Parameter(Mandatory=$true)][ValidateSet('kur','durdur','baslat','kaldir','durum')][string]$Islem)
$ErrorActionPreference = 'Stop'
$GorevAdi = 'DIGICAD Sunucu'
$kok = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Sunucu-Surecleri {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*sunucu.js*' }
}
function Durdur {
  $g = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
  if ($g) { Stop-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Sunucu-Surecleri | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
}
function Durum {
  $g = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
  if (-not $g) { Write-Host ' Arka plan kurulumu YOK (sunucu Baslat.bat penceresiyle calisiyor olabilir).' -ForegroundColor Yellow }
  else { Write-Host (' Arka plan gorevi: kurulu, durumu: ' + $g.State) }
  try {
    $port = 8080
    try { $a = Get-Content (Join-Path $kok 'veri\ayarlar.json') -Raw | ConvertFrom-Json; if ($a.icPort) { $port = [int]$a.icPort } } catch {}
    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/') -UseBasicParsing -TimeoutSec 5
    Write-Host (' Sunucu CALISIYOR -> http://localhost:' + $port) -ForegroundColor Green
  } catch { Write-Host ' Sunucu YANIT VERMIYOR.' -ForegroundColor Red; Write-Host (' Kayit dosyasi: ' + (Join-Path $kok 'veri\sunucu.log')) }
}

switch ($Islem) {
  'kur' {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw 'Node.js bulunamadi. Once https://nodejs.org adresinden kurun.' }
    $ayar = Join-Path $kok 'veri\ayarlar.json'
    if (-not (Test-Path $ayar) -or -not ((Get-Content $ayar -Raw) -match '"pin"\s*:\s*\{')) {
      throw 'Yonetici PIN henuz belirlenmemis. Once Baslat.bat ile bir kez calistirip PIN belirleyin.'
    }
    $g = Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue
    if (-not $g -and (Sunucu-Surecleri)) {
      throw 'Sunucu su anda Baslat.bat penceresinde calisiyor. Once o siyah pencereyi KAPATIN, sonra bunu tekrar calistirin.'
    }
    $eylem = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ""' + $kok + '\araclar\arka-plan.bat" "' + $node + '""') -WorkingDirectory $kok
    $tetik = New-ScheduledTaskTrigger -AtStartup
    $ayarlar = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    $kim = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Durdur
    Register-ScheduledTask -TaskName $GorevAdi -Action $eylem -Trigger $tetik -Settings $ayarlar -Principal $kim -Force | Out-Null
    Start-ScheduledTask -TaskName $GorevAdi
    Write-Host ''
    Write-Host ' Kurulum tamam. Sunucu artik arka planda calisiyor; pencere gerekmez.' -ForegroundColor Green
    Write-Host ' Bilgisayar acildiginda (kimse oturum acmasa bile) kendiliginden baslar.'
    Start-Sleep -Seconds 4
    Durum
  }
  'durdur' { Durdur; Write-Host ' Sunucu durduruldu.' -ForegroundColor Yellow }
  'baslat' {
    if (-not (Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue)) { throw 'Arka plan kurulumu yok. Once Arka-Plan-Kur.bat calistirin.' }
    Durdur; Start-ScheduledTask -TaskName $GorevAdi; Write-Host ' Sunucu yeniden baslatildi.'; Start-Sleep -Seconds 4; Durum
  }
  'kaldir' {
    Durdur
    Unregister-ScheduledTask -TaskName $GorevAdi -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host ' Arka plan kurulumu kaldirildi. Sunucuyu artik Baslat.bat ile acabilirsiniz.' -ForegroundColor Yellow
  }
  'durum' { Durum }
}
