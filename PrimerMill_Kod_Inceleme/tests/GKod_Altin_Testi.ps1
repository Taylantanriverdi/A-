# GKod_Altin_Testi.ps1 - G-kod üreticilerinin "altın çıktı" (golden) karşılaştırması.
# Altın çıktılar ORİJİNAL koddan (git 35a684f) üretildi ve tests/golden/<Üretici>/<varyant>.nc olarak saklanır.
# Bu test aynı girdilerle GÜNCEL kodu (-Kaynak) çalıştırır ve çıktıyı bayt bayt karşılaştırır.
# Tek normalleştirme (bkz. _Ortak.ps1 GKod-Normal): satır sonları LF yapılır ve yalnız üç tanımlı başlık satırındaki
# tarih/saat damgası <TARIH> ile değiştirilir.
# Beklenen (bilinçli) farklar: tests/golden/BEKLENEN_FARKLAR.txt - her satır 'Üretici/varyant' ya da 'Üretici/*'.
#   Listedeki bir varyant farklıysa fark yazdırılır ama "beklenen fark" sayılır, başarısızlık değil.
#
# Çalıştırma: pwsh -NoProfile -File tests/GKod_Altin_Testi.ps1 [-Kaynak <PrimerMill klasörü | .ps1>]
# Altınları yeniden üretmek (yalnız orijinal kodla!):  -AltinYaz -Kaynak <orijinal KazimaBaslat.ps1>
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [switch]$AltinYaz, [string]$AltinKlasor = '', [int]$FarkSatir = 12)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
if (-not $AltinKlasor) { $AltinKlasor = [System.IO.Path]::Combine($PSScriptRoot, 'golden') }
Write-Host "Kaynak: $Kaynak"
Write-Host "Altın : $AltinKlasor"

. GKod-Yukle $Kaynak
$utf8 = New-Object System.Text.UTF8Encoding($false)
$sonuclar = GKod-Uret

if ($AltinYaz) {
    foreach ($s in $sonuclar) {
        $yol = [System.IO.Path]::Combine($AltinKlasor, ($s.Ad.Replace('/', [System.IO.Path]::DirectorySeparatorChar) + '.nc'))
        [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($yol))
        [System.IO.File]::WriteAllText($yol, $s.Metin, $utf8)
        Write-Host ("yazıldı: {0}  ({1} bayt)" -f $s.Ad, $s.Metin.Length)
        if ($s.Metin.StartsWith('HATA:')) { Kaldi $s.Ad $s.Metin }
    }
    Ozet 'altın yazma'
}

# Beklenen farklar listesi
$beklenen = @()
$bfYol = [System.IO.Path]::Combine($AltinKlasor, 'BEKLENEN_FARKLAR.txt')
if (Test-Path -LiteralPath $bfYol) {
    foreach ($l in [System.IO.File]::ReadAllLines($bfYol)) {
        $t = $l.Trim(); if (-not $t -or $t.StartsWith('#')) { continue }
        $beklenen += ($t -split '\s+')[0]
    }
}
function Beklenen-Mi([string]$ad) {
    foreach ($b in $beklenen) {
        if ($b -eq $ad) { return $true }
        if ($b.EndsWith('/*') -and $ad.StartsWith($b.Substring(0, $b.Length - 1))) { return $true }
    }
    return $false
}

function Fark-Yaz([string]$a, [string]$g) {
    $x = $a.Split("`n"); $y = $g.Split("`n")
    $n = [math]::Max($x.Length, $y.Length); $say = 0; $toplam = 0
    for ($i = 0; $i -lt $n; $i++) {
        $p = $null; $q = $null
        if ($i -lt $x.Length) { $p = $x[$i] }
        if ($i -lt $y.Length) { $q = $y[$i] }
        if ($p -cne $q) {
            $toplam++
            if ($say -lt $FarkSatir) {
                $say++
                Write-Host ("      satır {0}:" -f ($i + 1)) -ForegroundColor DarkYellow
                if ($null -ne $p) { Write-Host "        - $p" -ForegroundColor DarkYellow } else { Write-Host '        - <yok>' -ForegroundColor DarkYellow }
                if ($null -ne $q) { Write-Host "        + $q" -ForegroundColor DarkYellow } else { Write-Host '        + <yok>' -ForegroundColor DarkYellow }
            }
        }
    }
    Write-Host ("      toplam {0} farklı satır (altın {1}, güncel {2} satır)" -f $toplam, $x.Length, $y.Length) -ForegroundColor DarkYellow
}

Bolum 'Altın çıktı karşılaştırması'
$gorulen = @{}
foreach ($s in $sonuclar) {
    $gorulen[$s.Ad] = $true
    $yol = [System.IO.Path]::Combine($AltinKlasor, ($s.Ad.Replace('/', [System.IO.Path]::DirectorySeparatorChar) + '.nc'))
    if (-not (Test-Path -LiteralPath $yol)) { Kaldi $s.Ad "altın dosya yok: $yol"; continue }
    $altin = [System.IO.File]::ReadAllText($yol, $utf8)
    $ok = ($altin -ceq $s.Metin)
    if ($ok) {
        $ab = $utf8.GetBytes($altin); $gb = $utf8.GetBytes($s.Metin)
        $ok = ($ab.Length -eq $gb.Length)
    }
    if ($ok) { Gecti "$($s.Ad)  ($($s.Metin.Length) karakter)"; continue }
    if (Beklenen-Mi $s.Ad) { Beklenen-Fark $s.Ad '(BEKLENEN_FARKLAR.txt)' } else { Kaldi $s.Ad 'çıktı altından farklı' }
    if ($s.Metin.StartsWith('HATA:')) { Write-Host "      $($s.Metin)" -ForegroundColor DarkYellow } else { Fark-Yaz $altin $s.Metin }
}
# Altın klasöründe olup artık üretilmeyen varyant var mı
foreach ($d in (Get-ChildItem -LiteralPath $AltinKlasor -Recurse -Filter '*.nc' | Where-Object { $_.FullName -notmatch '[\\/]girdi[\\/]' })) {
    $ad = $d.Directory.Name + '/' + [System.IO.Path]::GetFileNameWithoutExtension($d.Name)
    if (-not $gorulen.ContainsKey($ad)) { Kaldi $ad 'altın dosya var ama test bu varyantı üretmedi' }
}
try { Remove-Item -LiteralPath $IsKlasor -Recurse -Force } catch { }
Ozet 'G-kod altın'
