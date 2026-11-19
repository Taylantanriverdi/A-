# Onyukleme_Testi.ps1 - önyükleme (KazimaBaslat.ps1) değişkenlerini modüller ezmesin.
# Hata örneği: lib/Eding.ps1 '$script:ApiHazir = $false' satırı, Eding bulunduğu halde paneli "önizleme" moduna düşürüyordu.
# Kural: önyüklemede modüller yüklenmeden ÖNCE atanan bir değişken, lib/*.ps1 en üst düzeyinde koşulsuz yeniden atanmamalı.
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'KazimaBaslat.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
$Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path
$lib = [System.IO.Path]::Combine($Kaynak, 'lib')
$gecti = 0; $kaldi = 0
if (-not (Test-Path -LiteralPath ([System.IO.Path]::Combine($lib, 'Denetleyici.ps1')))) { Write-Host "Atlandı: $Kaynak yeni panel değil"; Write-Host 'SONUC Önyükleme : gecti 1, kaldi 0'; exit 0 }
function Norm([string]$s) { $s = $s -replace '^\[[^\]]+\]', ''; return ($s -replace '^\$script:', '$') }
$t = $null; $e = $null
$onyol = [System.IO.Path]::Combine($Kaynak, 'KazimaBaslat.ps1')
$ast = [System.Management.Automation.Language.Parser]::ParseFile($onyol, [ref]$t, [ref]$e)
$satirlar = [System.IO.File]::ReadAllLines($onyol)
$sinir = 0
for ($i = 0; $i -lt $satirlar.Count; $i++) { if ($satirlar[$i] -match '^# -+ Mant') { $sinir = $i + 1; break } }
if ($sinir -eq 0) { Write-Host '  [KALDI] önyüklemede modül yükleme bölümü bulunamadı'; $kaldi++ }
$onc = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Extent.StartLineNumber -lt $sinir }, $true) | ForEach-Object { Norm $_.Left.Extent.Text } | Sort-Object -Unique)
# Bilinçli istisnalar: değeri koruyan ya da zararsız sıfırlamalar
$izinli = @('Kapi:$HataSayisi', 'Denetleyici:$Demo', 'Demo:$Demo')
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'ArayuzKapisi', 'Demo')) {
    $f = [System.IO.Path]::Combine($lib, "$m.ps1"); if (-not (Test-Path -LiteralPath $f)) { continue }
    $ma = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e)
    foreach ($s in $ma.EndBlock.Statements) {
        if ($s -isnot [System.Management.Automation.Language.AssignmentStatementAst]) { continue }
        $n = Norm $s.Left.Extent.Text
        if ($onc -notcontains $n) { continue }
        if ($izinli -contains "${m}:$n") { $gecti++; continue }
        Write-Host ("  [KALDI] lib/{0}.ps1:{1} önyükleme değişkenini eziyor: {2}" -f $m, $s.Extent.StartLineNumber, $s.Extent.Text); $kaldi++
    }
}
foreach ($v in @('$ApiHazir', '$Bagli', '$EdingKlasor', '$MakineBilgisayari')) {
    if ($onc -contains $v) { Write-Host "  [GECTI] önyükleme $v atıyor ve modüller ezmiyor (yukarıda KALDI yoksa)"; $gecti++ }
}
Write-Host "SONUC Önyükleme : gecti $gecti, kaldi $kaldi"
exit $kaldi
