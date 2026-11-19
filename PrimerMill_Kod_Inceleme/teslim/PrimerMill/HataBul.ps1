# PrimerMill açılmıyor: 1) yazım hatası  2) arkada açık kalmış kopya  3) çalıştırınca çıkan hata
$ErrorActionPreference = 'Continue'
$klasor = $PSScriptRoot
$dosya = Join-Path $klasor 'KazimaBaslat.ps1'
$rapor = Join-Path ([Environment]::GetFolderPath('Desktop')) ('PrimerMill_hata_' + (Get-Date -Format 'yyyyMMdd_HHmm') + '.txt')
Start-Transcript -Path $rapor -Force | Out-Null
Write-Host "PowerShell $($PSVersionTable.PSVersion)  $([IntPtr]::Size * 8) bit  ·  $dosya" -ForegroundColor Cyan
if (-not (Test-Path $dosya)) { Write-Host 'KazimaBaslat.ps1 bu klasorde yok!' -ForegroundColor Red; Stop-Transcript | Out-Null; return }

Write-Host "`n1) Yazim kontrolu" -ForegroundColor Cyan
# PrimerMill 2: önyükleme + lib\*.ps1 mantık modülleri
$toplam = 0
foreach ($ps in @(@($dosya) + @(Get-ChildItem -LiteralPath (Join-Path $klasor 'lib') -Filter '*.ps1' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }))) {
    $hatalar = $null; $tok = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($ps, [ref]$tok, [ref]$hatalar)
    foreach ($h in $hatalar) { Write-Host ("   {0} satir {1}: {2}" -f (Split-Path $ps -Leaf), $h.Extent.StartLineNumber, $h.Message) -ForegroundColor Red; $toplam++ }
}
if ($toplam -eq 0) { Write-Host '   yazim hatasi yok' -ForegroundColor Green }

Write-Host "`n2) Arkada acik PrimerMill" -ForegroundColor Cyan
$acik = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'KazimaBaslat\.ps1' -and $_.ProcessId -ne $PID })
if ($acik.Count) {
  foreach ($p in $acik) { Write-Host "   acik: PID $($p.ProcessId)  $($p.CreationDate)" -ForegroundColor Yellow }
  if ((Read-Host '   Arkada acik kopya var (yenisi bu yuzden acilmiyor olabilir). Kapatilsin mi? (E/H)') -match '^[EeYy]') {
    $acik | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep 2; Write-Host '   kapatildi' -ForegroundColor Green }
} else { Write-Host '   yok' -ForegroundColor Green }

Write-Host "`n3) PrimerMill bu pencerede calistiriliyor (hata olursa asagida gorunur)..." -ForegroundColor Cyan
try { & $dosya } catch { Write-Host "`nHATA: $($_.Exception.Message)" -ForegroundColor Red; Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor Red; Write-Host $_.ScriptStackTrace }
# ED-10 sonrası panel $Error'ı her saniye okuyup boşaltır: çalışma sırasındaki hatalar loglar\Panel_*.log dosyasındadır
Write-Host ("   (Panel calisirken yakalanan program hatalari: " + (Join-Path $klasor 'loglar') + "\Panel_*.log)") -ForegroundColor Gray
foreach ($e in $Error) { if ($e.InvocationInfo -and $e.InvocationInfo.ScriptName -like '*KazimaBaslat*') { Write-Host ("   satir {0}: {1}" -f $e.InvocationInfo.ScriptLineNumber, $e.Exception.Message) -ForegroundColor Yellow } }
Stop-Transcript | Out-Null
Write-Host "`nRapor masaustunde: $rapor" -ForegroundColor White
