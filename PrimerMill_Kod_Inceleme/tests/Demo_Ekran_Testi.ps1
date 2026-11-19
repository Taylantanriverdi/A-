# Demo_Ekran_Testi.ps1 - PrimerMill 2'yi DEMO modunda gerçekten açar, her ekranı gezer ve PNG kaydeder (yalnız Windows).
#   teslim/PrimerMill/KazimaBaslat.ps1 -Demo, ortam değişkeni PRIMERMILL_EKRAN = çıktı klasörü
#   -> lib/Demo.ps1 Ekran-Turu-Baslat: Kabuk.EkranGoster + Control.DrawToBitmap, sonunda panel kapanır.
# Çıktı: teslim/ekran_goruntuleri_demo/*.png (17 ekran). Windows dışında (pwsh/Linux: WinForms yok) ATLANIR, 0 döner.
# Çalıştırma (Windows): powershell -ExecutionPolicy Bypass -File tests\Demo_Ekran_Testi.ps1
# Not: açık bir PrimerMill paneli varsa önce kapatın (tek kopya sorusu çıkar). Eding / makine gerekmez.
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [string]$Cikti = '', [int]$ZamanAsimi = 180)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'Denetleyici.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
if (-not $Cikti) { $Cikti = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Kaynak, '..', 'ekran_goruntuleri_demo')) }
$panel = [System.IO.Path]::Combine($Kaynak, 'KazimaBaslat.ps1')
Write-Host "Panel : $panel"
Write-Host "Çıktı : $Cikti"

$windows = ($env:OS -eq 'Windows_NT')
if (-not $windows) {
    Bolum 'Windows dışında: yalnız ayrıştırma'
    $perr = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($panel, [ref]$null, [ref]$perr)
    Dogru ($perr.Count -eq 0) 'KazimaBaslat.ps1 ayrıştırılır'
    Bilgi 'WinForms yok (pwsh/Linux): panel açılmadı, ekran görüntüsü ATLANDI. Windows''ta çalıştırın.'
    Ozet 'Demo ekran'
}

Bolum 'Panel DEMO modunda açılıyor'
if (Test-Path -LiteralPath $Cikti) { Get-ChildItem -LiteralPath $Cikti -Filter '*.png' | Remove-Item -Force }
[void][System.IO.Directory]::CreateDirectory($Cikti)
$ps = [System.IO.Path]::Combine($env:SystemRoot, 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
if (-not (Test-Path -LiteralPath $ps)) { $ps = [System.IO.Path]::Combine($env:SystemRoot, 'System32\WindowsPowerShell\v1.0\powershell.exe') }
$env:PRIMERMILL_EKRAN = $Cikti
try {
    $p = Start-Process -FilePath $ps -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', "`"$panel`"", '-Demo') -PassThru
    $bitti = $p.WaitForExit($ZamanAsimi * 1000)
    if (-not $bitti) { try { $p.Kill() } catch { }; Kaldi 'panel zamanında kapanmadı' "$ZamanAsimi sn" }
    else { Esit 0 $p.ExitCode 'panel hatasız kapandı' }
} finally { Remove-Item Env:\PRIMERMILL_EKRAN -ErrorAction SilentlyContinue }

$png = @(Get-ChildItem -LiteralPath $Cikti -Filter '*.png')
Bilgi ("kaydedilen: " + (($png | ForEach-Object { $_.Name }) -join ', '))
Dogru ($png.Count -ge 17) "17 ekranın görüntüsü kaydedildi ($($png.Count))"
foreach ($f in $png) { Dogru ($f.Length -gt 5000) "$($f.Name) boş değil" "$($f.Length) bayt" }
$log = @(Get-ChildItem -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'demo_calisma', 'loglar')) -Filter 'Panel_*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1)
if ($log.Count) {
    $l = [System.IO.File]::ReadAllText($log[0].FullName)
    Dogru ($l -match 'EKRAN TURU: bitti') 'günlükte ekran turu bitti'
    $ph = @([regex]::Matches($l, 'PROGRAM HATASI[^\r\n]*') | ForEach-Object { $_.Value })
    Dogru ($ph.Count -eq 0) 'günlükte PROGRAM HATASI yok' ($ph -join ' | ')
}
Ozet 'Demo ekran'
