@echo off
rem ================================================================
rem  DIGICAD Dental - HEKIM PORTALI KURULUMU
rem  Cift tiklayin: masaustune ve Baslat menusune "DIGICAD Hekim Portali"
rem  simgesi eklenir ve portal ayri bir pencerede acilir.
rem  Yonetici izni gerekmez, bilgisayara program kurulmaz.
rem ================================================================
chcp 65001 >nul
title DIGICAD Hekim Portali - Kurulum
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $s=[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8); iex $s.Substring($s.LastIndexOf('#PS-BASLA#')+10)"
echo.
pause
exit /b
#PS-BASLA#
$Adres = '__ADRES__'
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Ad = 'DIGICAD Hekim Portalı'
$Sayfa = "$Adres/HekimPortali.html"
try {
  Write-Host ''
  Write-Host '══════════════════════════════════════════════' -ForegroundColor Cyan
  Write-Host '  DIGICAD Dental — Hekim Portalı Kurulumu' -ForegroundColor Cyan
  Write-Host '══════════════════════════════════════════════' -ForegroundColor Cyan

  # 1) Simge dosyası
  $klasor = Join-Path $env:LOCALAPPDATA 'DIGICAD-Hekim'
  New-Item -ItemType Directory -Force -Path $klasor | Out-Null
  $ikon = Join-Path $klasor 'digicad.ico'
  try { Invoke-WebRequest -Uri "$Adres/favicon.ico" -OutFile $ikon -UseBasicParsing -TimeoutSec 20 } catch { $ikon = $null }

  # 2) Bağlantı kontrolü
  $erisim = $false
  try { $r = Invoke-WebRequest -Uri $Sayfa -UseBasicParsing -TimeoutSec 20; $erisim = ($r.StatusCode -eq 200) } catch {}
  if ($erisim) { Write-Host '  ✓ Laboratuvar sunucusuna bağlanıldı' -ForegroundColor Green }
  else { Write-Host '  ! Laboratuvar sunucusuna şu an ulaşılamadı — kurulum yine de yapılıyor.' -ForegroundColor Yellow }

  # 3) Tarayıcı (Chrome, yoksa Edge) — portal ayrı bir uygulama penceresinde açılır
  $adaylar = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  if (${env:ProgramFiles(x86)}) {
    $adaylar += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    $adaylar += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  }
  $tarayici = $adaylar | Where-Object { Test-Path $_ } | Select-Object -First 1

  # 4) Kısayollar: masaüstü + Başlat menüsü
  $yerler = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
  foreach ($yer in $yerler) {
    if (-not $yer) { continue }
    if ($tarayici) {
      $sh = New-Object -ComObject WScript.Shell
      $k = $sh.CreateShortcut((Join-Path $yer ($Ad + '.lnk')))
      $k.TargetPath = $tarayici
      $k.Arguments = "--app=$Sayfa"
      if ($ikon) { $k.IconLocation = "$ikon,0" }
      $k.Description = 'DIGICAD Dental Laboratuvarı — Hekim Portalı'
      $k.Save()
    } else {
      $metin = "[InternetShortcut]`r`nURL=$Sayfa`r`n" + $(if ($ikon) { "IconFile=$ikon`r`nIconIndex=0`r`n" } else { '' })
      [IO.File]::WriteAllText((Join-Path $yer ($Ad + '.url')), $metin)
    }
  }
  Write-Host ('  ✓ Masaüstüne ve Başlat menüsüne "' + $Ad + '" simgesi eklendi') -ForegroundColor Green

  # 5) Portalı aç
  if ($tarayici) { Start-Process -FilePath $tarayici -ArgumentList "--app=$Sayfa" } else { Start-Process $Sayfa }
  Write-Host ''
  Write-Host '  Kurulum tamamlandı. Portal açılıyor…' -ForegroundColor Green
  Write-Host '  Laboratuvarın verdiği kullanıcı adı ve şifre ile giriş yapın.'
  Write-Host '  Bundan sonra masaüstündeki simgeye çift tıklamanız yeterli.'
} catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host ('Portalı tarayıcıda şu adresten de açabilirsiniz: ' + $Sayfa) -ForegroundColor Yellow
}
