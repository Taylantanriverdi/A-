# OtoKal_Hesap_Testi.ps1
# PrimerMill otomatik kalibrasyon hesabının Eding'siz testi.
#
# KazimaBaslat.ps1 ÇALIŞTIRILMAZ: dosya AST ile ayrıştırılır, yalnız saf fonksiyonların
# (Sayi, Metin-Sayi, OkRot, OkModel, OkCoz, OtoKal-Hesapla-Ic, OtoKal-NC-Uret, OtoKal-Sim-Uret)
# ve sabitlerin ($OkTeta, $OkD, $OkR, $OkNoktalar) tanım metni alınıp Invoke-Expression ile yüklenir.
#
# Çalıştırma:
#   pwsh -NoProfile -File tests/OtoKal_Hesap_Testi.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\OtoKal_Hesap_Testi.ps1
#   Seçenekler: -Kaynak <KazimaBaslat.ps1 yolu>  -MonteKarlo <n>  -Hizli (tarama/aykırı değer testlerini atla)  -Csv <sonuç.csv>
# Çıkış kodu = başarısız test sayısı (0 = hepsi geçti).
#
# Kod PowerShell 5.1 uyumludur (??, ?:, &&, ||, -Parallel kullanılmaz).
param(
    [string]$Kaynak = '',
    [int]$MonteKarlo = 25,
    [switch]$Hizli,
    [string]$Csv = ''
)
$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ 0) Kaynağı bul
if (-not $Kaynak) {
    $adaylar = @(
        [System.IO.Path]::Combine($PSScriptRoot, '..', 'PrimerMill', 'KazimaBaslat.ps1'),
        '/home/user/A-/PrimerMill_Kod_Inceleme/PrimerMill/KazimaBaslat.ps1'
    )
    foreach ($a in $adaylar) { if (Test-Path -LiteralPath $a) { $Kaynak = (Resolve-Path -LiteralPath $a).Path; break } }
}
if (-not $Kaynak -or -not (Test-Path -LiteralPath $Kaynak)) { throw "KazimaBaslat.ps1 bulunamadı. -Kaynak ile ver." }
$OrnekKlasor = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName($Kaynak)), 'ornekler')
Write-Host "Kaynak: $Kaynak"

# ------------------------------------------------------------------ 1) AST ile çıkar
$tok = $null; $perr = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Kaynak, [ref]$tok, [ref]$perr)
if ($perr -and $perr.Count) { throw "Ayrıştırma hatası: $($perr[0].Message) satır $($perr[0].Extent.StartLineNumber)" }

$FonkAdlari = @('Sayi', 'Metin-Sayi', 'OkRot', 'OkModel', 'OkCoz', 'OtoKal-Hesapla-Ic', 'OtoKal-NC-Uret', 'OtoKal-Sim-Uret')
$DegAdlari = @('OkTeta', 'OkD', 'OkR', 'OkNoktalar')
$FonkMetin = @{}; $FonkSatir = @{}
$tumFonk = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
foreach ($fd in $tumFonk) {
    if (($FonkAdlari -contains $fd.Name) -and -not $FonkMetin.ContainsKey($fd.Name)) { $FonkMetin[$fd.Name] = $fd.Extent.Text; $FonkSatir[$fd.Name] = $fd.Extent.StartLineNumber }
}
$DegMetin = @{}
$atamalar = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)
foreach ($as in $atamalar) {
    # yalnız üst düzey (bir fonksiyonun içinde olmayan) atamalar
    $p = $as.Parent; $icte = $false
    while ($p) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $icte = $true; break }; $p = $p.Parent }
    if ($icte) { continue }
    if ($as.Left -is [System.Management.Automation.Language.VariableExpressionAst]) {
        $ad = $as.Left.VariablePath.UserPath
        if (($DegAdlari -contains $ad) -and -not $DegMetin.ContainsKey($ad)) { $DegMetin[$ad] = $as.Extent.Text }
    }
}
foreach ($ad in $FonkAdlari) { if (-not $FonkMetin.ContainsKey($ad)) { throw "Fonksiyon bulunamadı: $ad" } }
foreach ($ad in $DegAdlari) { if (-not $DegMetin.ContainsKey($ad)) { throw "Sabit bulunamadı: `$$ad" } }

# Saflık denetimi: çıkarılan fonksiyonların çağırdığı komutlar
$izinli = @($FonkAdlari) + @('Measure-Object', 'New-Object', 'Get-Date')
$disCagri = @()
foreach ($ad in $FonkAdlari) {
    $fa = [System.Management.Automation.Language.Parser]::ParseInput($FonkMetin[$ad], [ref]$null, [ref]$null)
    foreach ($c in $fa.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $cn = $c.GetCommandName()
        if ($cn -and -not ($izinli -contains $cn)) { $disCagri += "$ad -> $cn" }
    }
}
if ($disCagri.Count) { throw "Saf olmayan çağrı: $($disCagri -join ', ')" }

foreach ($ad in $DegAdlari) { Invoke-Expression $DegMetin[$ad] }
foreach ($ad in $FonkAdlari) { Invoke-Expression $FonkMetin[$ad] }
Write-Host ("Yüklendi: " + (($FonkAdlari | ForEach-Object { "$_ (satır $($FonkSatir[$_]))" }) -join ', '))
Write-Host "Sabitler: OkTeta=$OkTeta OkD=$OkD OkR=$OkR nokta=$($OkNoktalar.Count)"

# Ölçüm (yalnız test): yineleme sayısını okumak için kopyası. Matematik birebir aynı.
$olcMetin = $FonkMetin['OtoKal-Hesapla-Ic'].Replace('function OtoKal-Hesapla-Ic(', 'function T-Hesapla-Olcum(')
$isaret = '    $f0 = & $model $q; $ss = 0; $artikMax = 0'
if ($olcMetin.IndexOf($isaret) -lt 0) { throw 'Ölçüm kopyası için işaret satırı bulunamadı (kaynak değişmiş).' }
$olcMetin = $olcMetin.Replace($isaret, '    $script:TestIt = $it; $script:TestAdim = $buyukAdim' + "`n" + $isaret)
Invoke-Expression $olcMetin

# Benzetim kopyası (yalnız test): ideal makine yerine verilen gerçek makine (q, uç) ile temas üretir.
$simMetin = $FonkMetin['OtoKal-Sim-Uret'].Replace('function OtoKal-Sim-Uret(', 'function T-Sim-Uret(')
$s1 = '$ideal = [double[]]@(0, 0, 0, 0, 0, -1, -1, 0, 0, 0)'; $s2 = "OkModel `$ideal `$nokta `$T 'duz' 0"
if ($simMetin.IndexOf($s1) -lt 0 -or $simMetin.IndexOf($s2) -lt 0) { throw 'Benzetim kopyası için satırlar bulunamadı (kaynak değişmiş).' }
$simMetin = $simMetin.Replace($s1, '$ideal = [double[]]$script:SimQ').Replace($s2, 'OkModel $ideal $nokta $T $script:SimUc $script:SimR')
Invoke-Expression $simMetin

# ------------------------------------------------------------------ 2) Yardımcılar
$ci = [System.Globalization.CultureInfo]::InvariantCulture
function F([double]$v, [string]$b = '0.0000') { return $v.ToString($b, [System.Globalization.CultureInfo]::InvariantCulture) }
$ParAd = @('xb', 'ya', 'zb', 'eA', 'eB', 'gA', 'gB', 'm', 'wx', 'c')
$Ideal = [double[]]@(0, 0, 0, 0, 0, 1, 1, 0, 0, 0)
function Q([hashtable]$h, [double[]]$taban = $null) {
    if (-not $taban) { $taban = $Ideal }
    $q = [double[]]$taban.Clone()
    for ($j = 0; $j -lt $ParAd.Count; $j++) { if ($h.ContainsKey($ParAd[$j])) { $q[$j] = [double]$h[$ParAd[$j]] } }
    return , $q
}

# Bağımsız ikinci model (3x3 matrislerle, aynı fizik). Seçenekler modelde OLMAYAN gerçek etkileri ekler:
#   AZ        : A ekseninin B ekseninden Z kaçıklığı (model 0 varsayar)
#   FlipOlcek : B180 dönüşü gerçek ölçekle (gB*180) yapılır (model 180*sign(gB) varsayar)
#   FlipYok   : B180'e dönmez (alt yüz yerine üst yüz ölçülür)
function T-Rx([double]$d) { $t = $d * [math]::PI / 180; $c = [math]::Cos($t); $s = [math]::Sin($t); return , @(@(1.0, 0.0, 0.0), @(0.0, $c, (-$s)), @(0.0, $s, $c)) }
function T-Ry([double]$d) { $t = $d * [math]::PI / 180; $c = [math]::Cos($t); $s = [math]::Sin($t); return , @(@($c, 0.0, $s), @(0.0, 1.0, 0.0), @((-$s), 0.0, $c)) }
function T-MV($M, [double[]]$v) { return , [double[]]@(($M[0][0] * $v[0] + $M[0][1] * $v[1] + $M[0][2] * $v[2]), ($M[1][0] * $v[0] + $M[1][1] * $v[1] + $M[1][2] * $v[2]), ($M[2][0] * $v[0] + $M[2][1] * $v[1] + $M[2][2] * $v[2])) }
function T-Model2([double[]]$q, [int]$i, [double]$T, [string]$uc, [double]$r, [hashtable]$sec = @{}) {
    $n = $OkNoktalar[$i]; $Ak = 0.0; $Bk = 0.0; $ust = $true
    if ($n.Grup -eq 'Ap') { $Ak = $OkTeta } elseif ($n.Grup -eq 'Am') { $Ak = -$OkTeta } elseif ($n.Grup -eq 'Bp') { $Bk = $OkTeta } elseif ($n.Grup -eq 'Bm') { $Bk = -$OkTeta } elseif ($n.Grup -eq 'L') { $Bk = 180.0; $ust = $false }
    if ($sec.FlipYok -and -not $ust) { $ust = $true; $Bk = 0.0 }
    $sz = 1.0; if (-not $ust) { $sz = -1.0 }
    $p = [double[]]@(0.0, 0.0, ($sz * $T / 2 + $q[7])); $nv = [double[]]@(0.0, 0.0, $sz)
    $Rd1 = T-Ry ($sz * $q[8] / 2); $Rd2 = T-Rx $q[9]
    $p = T-MV $Rd2 (T-MV $Rd1 $p); $nv = T-MV $Rd2 (T-MV $Rd1 $nv)
    $p = [double[]]@(($p[0] + $q[0]), ($p[1] + $q[1]), ($p[2] + $q[2]))
    if ($Bk -eq 180.0 -and -not $sec.FlipOlcek) { $phiB = 180.0 * [math]::Sign($q[6]) + $q[4] } else { $phiB = $q[6] * $Bk + $q[4] }
    $phiA = $q[5] * $Ak + $q[3]
    $RB = T-Ry $phiB; $RA = T-Rx $phiA
    $az = 0.0; if ($sec.AZ) { $az = [double]$sec.AZ }
    $v = T-MV $RB ([double[]]@(($p[0] - $q[0]), $p[1], ($p[2] - $q[2]))); $p = [double[]]@(($v[0] + $q[0]), $v[1], ($v[2] + $q[2]))
    $nv = T-MV $RB $nv
    $v = T-MV $RA ([double[]]@($p[0], ($p[1] - $q[1]), ($p[2] - $q[2] - $az))); $p = [double[]]@($v[0], ($v[1] + $q[1]), ($v[2] + $q[2] + $az))
    $nv = T-MV $RA $nv
    # düzlemin (X,Y)'deki yüksekliği ve uç teması
    $zc = $p[2] - ($nv[0] * ($n.X - $p[0]) + $nv[1] * ($n.Y - $p[1])) / $nv[2]
    if ($uc -eq 'kure') { return $zc + $r * (1 / $nv[2] - 1) }
    # düz uç: halkanın düzleme en yakın noktası (sayısal arama, analitik formülden bağımsız)
    $best = -1e9
    for ($k = 0; $k -lt 720; $k++) { $f = 2 * [math]::PI * $k / 720; $h = - ($nv[0] * $r * [math]::Cos($f) + $nv[1] * $r * [math]::Sin($f)) / $nv[2]; if ($h -gt $best) { $best = $h } }
    return $zc + $best
}

$script:Rnd = New-Object System.Random 12345
function T-Gauss([double]$s) { if ($s -le 0) { return 0.0 }; $u1 = 1.0 - $script:Rnd.NextDouble(); $u2 = $script:Rnd.NextDouble(); return $s * [math]::Sqrt(-2 * [math]::Log($u1)) * [math]::Cos(2 * [math]::PI * $u2) }

# Ölçüm üret: gen = 'ok' (OkModel) ya da 'm2' (bağımsız model)
function T-Olc([double[]]$q, [double]$T, [string]$uc, [double]$r, [double]$sigma = 0, [string]$gen = 'ok', [hashtable]$sec = @{}) {
    $z = @{}
    for ($i = 0; $i -lt $OkNoktalar.Count; $i++) {
        if ($gen -eq 'm2') { $v = T-Model2 $q $i $T $uc $r $sec } else { $v = OkModel $q $i $T $uc $r }
        $z[$i] = $v + (T-Gauss $sigma)
    }
    return $z
}
function T-Beklenen([double[]]$q) { return @{ dX = $q[0]; dY = $q[1]; dZ = $q[2]; dA = (($q[3] + $q[9]) / $q[5]); dB = ($q[4] / $q[6]) } }

$Ofs = @{ X = -53.1425; Y = -53.456; A = 20.209; B = -2.3508 }   # cnc.ini'deki G54 değerleri
$P4002 = 32.265
# OtoKal-Oku içindeki güvenlik değerlendirmesinin kopyası (Eding çağrıları içerdiği için oradan çıkarılamaz)
function T-Buyuk($r) {
    return ([math]::Abs($r.dX) -gt 2 -or [math]::Abs($r.dY) -gt 2 -or [math]::Abs($r.dZ) -gt 2 -or [math]::Abs($r.dA) -gt 3 -or [math]::Abs($r.dB) -gt 3 -or
            [math]::Abs($r.OlcA - 1) -gt 0.1 -or [math]::Abs($r.OlcB - 1) -gt 0.1 -or $r.Tekrar -gt 0.05 -or $r.ArtikMax -gt 0.05)
}
function T-Uyari($r) {
    $u = @()
    if ([math]::Abs($r.OlcA - 1) -gt 0.01 -or [math]::Abs($r.OlcB - 1) -gt 0.01) { $u += 'olcek' }
    if ([math]::Abs($r.M) -gt 0.1) { $u += 'm' }
    if ([math]::Abs($r.Kama) -gt 0.1 -or [math]::Abs($r.DiskEgikA) -gt 0.05) { $u += 'kama/egik' }
    if ($r.ArtikMax -gt 0.01) { $u += 'artik' }
    if (T-Buyuk $r) { $u += 'BUYUK' }
    return ($u -join ',')
}

$Sonuc = New-Object System.Collections.ArrayList
$script:Basarisiz = 0
function T-Kaydet([string]$durum, [string]$ad, [string]$verilen, [string]$bulunan, [string]$hata, [string]$not = '') {
    if ($durum -eq 'KALDI') { $script:Basarisiz++ }
    [void]$Sonuc.Add([pscustomobject]@{ Durum = $durum; Test = $ad; Verilen = $verilen; Bulunan = $bulunan; Hata = $hata; Not = $not })
    $renk = 'Green'; if ($durum -eq 'KALDI') { $renk = 'Red' } elseif ($durum -eq 'BILGI') { $renk = 'Yellow' }
    Write-Host ("[{0,-5}] {1}`n        verilen: {2}`n        bulunan: {3}`n        hata: {4}   {5}" -f $durum, $ad, $verilen, $bulunan, $hata, $not) -ForegroundColor $renk
}

# Bir vakayı çöz, beklenenle karşılaştır
function T-Vaka([string]$ad, [hashtable]$hata, [double]$T = 10.02, [string]$uc = 'duz', [double]$r = 1.5, [double]$sigma = 0,
                [double]$tolL = 1e-4, [double]$tolA = 1e-4, [string]$gen = 'ok', [hashtable]$sec = @{}, [double]$Tcoz = 0, [string]$ucCoz = '', [double]$rCoz = -1,
                [double[]]$taban = $null, [switch]$BilgiAmacli) {
    $q = Q $hata $taban
    $z = T-Olc $q $T $uc $r $sigma $gen $sec
    if ($Tcoz -eq 0) { $Tcoz = $T }; if (-not $ucCoz) { $ucCoz = $uc }; if ($rCoz -lt 0) { $rCoz = $r }
    $verilen = (($hata.Keys | Sort-Object | ForEach-Object { "$_=$(F $hata[$_] '0.####')" }) -join ' ')
    if (-not $verilen) { $verilen = '-' }
    try { $res = T-Hesapla-Olcum $z $Tcoz $Ofs $P4002 @(0, 0, 0, 0, 0) 0 $ucCoz $rCoz }
    catch { T-Kaydet 'KALDI' $ad $verilen 'İSTİSNA' $_.Exception.Message; return $null }
    $b = T-Beklenen $q
    $eL = [math]::Max([math]::Max([math]::Abs($res.dX - $b.dX), [math]::Abs($res.dY - $b.dY)), [math]::Abs($res.dZ - $b.dZ))
    $eA = [math]::Max([math]::Abs($res.dA - $b.dA), [math]::Abs($res.dB - $b.dB))
    $bul = "dX $(F $res.dX) dY $(F $res.dY) dZ $(F $res.dZ) dA $(F $res.dA) dB $(F $res.dB) gA $(F $res.Q[5] '0.00000') gB $(F $res.Q[6] '0.00000')"
    $dur = 'GECTI'; if ($eL -gt $tolL -or $eA -gt $tolA) { $dur = 'KALDI' }
    if ($BilgiAmacli) { $dur = 'BILGI' }
    $not = "it=$($script:TestIt) rms=$(F $res.Rms '0.000000') artikMax=$(F $res.ArtikMax '0.000000') uyari=[$(T-Uyari $res)]"
    T-Kaydet $dur $ad $verilen $bul "XYZ $(F $eL '0.000000') mm / AB $(F $eA '0.000000') deg" $not
    return @{ R = $res; B = $b; EL = $eL; EA = $eA; Q = $q; Z = $z }
}

$sure = [System.Diagnostics.Stopwatch]::StartNew()
# ------------------------------------------------------------------ 3) Model doğrulama
Write-Host "`n=== 3) OkModel ile bağımsız model karşılaştırması ==="
$maxFark = 0.0   # [double]: [math]::Max(int, double) int sürümünü seçer (bkz. KL bulgusu)
foreach ($uc in @('duz', 'kure')) {
    for ($k = 0; $k -lt 6; $k++) {
        $q = [double[]]@((T-Gauss 1), (T-Gauss 1), (T-Gauss 1), (T-Gauss 1), (T-Gauss 1), (1 + (T-Gauss 0.02)), (-1 + (T-Gauss 0.02)), (T-Gauss 0.1), (T-Gauss 0.2), (T-Gauss 0.2))
        if ($k % 2) { $q[5] = -$q[5]; $q[6] = -$q[6] }
        for ($i = 0; $i -lt 18; $i++) { $maxFark = [math]::Max($maxFark, [math]::Abs((OkModel $q $i 12 $uc 1.5) - (T-Model2 $q $i 12 $uc 1.5))) }
    }
}
$d = 'GECTI'; if ($maxFark -gt 1e-4) { $d = 'KALDI' }
T-Kaydet $d 'OkModel = bağımsız matris modeli (12 rastgele q, düz+küre uç)' '-' '-' "$(F $maxFark '0.0E+0') mm" 'düz uç bağımsız modelde 0.5° adımlı sayısal arama (≤1e-4 tolerans)'

# ------------------------------------------------------------------ 4) Gürültüsüz geri bulma
Write-Host "`n=== 4) Gürültüsüz: sıfır, tek tek, birlikte ==="
[void](T-Vaka 'Sıfır hata' @{})
$tekler = [ordered]@{ xb = 0.3; ya = -0.25; zb = 0.4; eA = 0.3; eB = -0.4; gA = 1.003; gB = 0.997; m = 0.05; wx = 0.05; c = 0.03 }
foreach ($k in $tekler.Keys) { [void](T-Vaka "Yalnız $k" @{ $k = $tekler[$k] }) }
$hep = @{ xb = 0.3; ya = -0.25; zb = 0.4; eA = 0.3; eB = -0.4; gA = 1.003; gB = 0.997; m = 0.05; wx = 0.05; c = 0.03 }
$vBirlikte = T-Vaka 'Hepsi birlikte (düz pim r1.5, T10.02)' $hep
[void](T-Vaka 'Hepsi birlikte, küre uç r1.0, T16' $hep 16 'kure' 1.0)
[void](T-Vaka 'Hepsi birlikte, uç yarıçapı 0' $hep 20 'duz' 0)
$hepTers = @{ xb = 0.3; ya = -0.25; zb = 0.4; eA = 0.3; eB = -0.4; gA = -1.003; gB = -0.997; m = 0.05; wx = 0.05; c = 0.03 }
[void](T-Vaka 'Hepsi birlikte, A ve B yönü ters (gA=gB=-1)' $hepTers)
[void](T-Vaka 'Bağımsız modelden üretilmiş ölçüm (hepsi birlikte)' $hep 10.02 'duz' 1.5 0 1e-4 1e-4 'm2')

# Ölçüm kopyası ile özgün fonksiyon aynı sonucu veriyor mu?
$r1 = OtoKal-Hesapla-Ic $vBirlikte.Z 10.02 $Ofs $P4002 @(0.001, 0.003, 0.002, 0.0, 0.001) 0.002 'duz' 1.5
$r2 = T-Hesapla-Olcum $vBirlikte.Z 10.02 $Ofs $P4002 @(0.001, 0.003, 0.002, 0.0, 0.001) 0.002 'duz' 1.5
$ayni = $true; for ($j = 0; $j -lt 10; $j++) { if ($r1.Q[$j] -ne $r2.Q[$j]) { $ayni = $false } }
$d = 'GECTI'; if (-not $ayni) { $d = 'KALDI' }
T-Kaydet $d 'Özgün OtoKal-Hesapla-Ic = ölçüm kopyası (bit bit)' '-' '-' '-' ''
# Mutlak değerler ve işaretler
$okMutlak = ([math]::Abs($r1.X - ($Ofs.X + $r1.dX)) -lt 1e-12 -and [math]::Abs($r1.A - ($Ofs.A - $r1.dA)) -lt 1e-12 -and [math]::Abs($r1.P4002 - ($P4002 - $r1.dZ)) -lt 1e-12 -and [math]::Abs($r1.Tekrar - 0.003) -lt 1e-12)
$d = 'GECTI'; if (-not $okMutlak) { $d = 'KALDI' }
T-Kaydet $d 'Mutlak değerler: X=ofs.X+dX, A=ofs.A-dA, #4002=p4002-dZ, Tekrar=max-min' '-' "X $(F $r1.X) A $(F $r1.A) 4002 $(F $r1.P4002)" '-' ''

# Yakınsama ölçütü ve artık: [math]::Max(0, double) PowerShell'de Int32 sürümünü seçer
$tip = ([math]::Max(0, 0.3)).GetType().Name
T-Kaydet 'BILGI' "[math]::Max(0, 0.3) = $([math]::Max(0, 0.3)) ($tip)" '-' '-' '-' 'satır 5150/5172 $buyukAdim = 0, $artikMax = 0; satır 5329 $farkMax = 0'
$qA = Q @{ xb = 1; ya = -1; zb = 1; eA = 1; eB = -1; gA = 1.02; gB = 0.98; m = 0.2; wx = 0.2; c = 0.2 }
$zA = T-Olc $qA 10.02 'duz' 1.5
$rA = T-Hesapla-Olcum $zA 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
$d = 'GECTI'; if ($script:TestAdim -isnot [double] -or $script:TestIt -lt 1) { $d = 'KALDI' }
T-Kaydet $d 'Gauss-Newton en az 2 yineleme yapıyor / adım ölçütü double' '1 mm / 1° hepsi' "yineleme=$($script:TestIt + 1) son adım=$($script:TestAdim) ($($script:TestAdim.GetType().Name))" '-' 'Int32 ise |dq|<0.5 adımı 0 sayılır, döngü ilk adımda biter'
# ArtikMax gerçek en büyük artığı veriyor mu? (P1'e +0.02 mm)
$zB = @{}; foreach ($k in $zA.Keys) { $zB[$k] = $zA[$k] }; $zB[1] = $zB[1] + 0.02
$rB = OtoKal-Hesapla-Ic $zB 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
$gercek = 0.0; for ($i = 0; $i -lt 18; $i++) { $gercek = [math]::Max($gercek, [math]::Abs($zB[$i] - (OkModel $rB.Q $i 10.02 'duz' 1.5))) }
$d = 'GECTI'; if ([math]::Abs($rB.ArtikMax - $gercek) -gt 1e-9) { $d = 'KALDI' }
T-Kaydet $d 'ArtikMax = gerçek en büyük artık (P1 +0.02 mm)' 'P1 +0.02' "ArtikMax=$($rB.ArtikMax) ($($rB.ArtikMax.GetType().Name)) gerçek=$(F $gercek '0.000000')" '-' 'uyarı eşiği 0.01 / BÜYÜK eşiği 0.05'
# OtoKal-Oku farkMax ifadesi, K9 düzeltmesi sonrası (Eding'e bağlı fonksiyonun içinde; ifade birebir kopya)
$farkMax = 0.0; foreach ($ab in @(@(5.000, 5.004), @(7.210, 7.199))) { $a = $ab[0]; $b = $ab[1]; $farkMax = [math]::Max($farkMax, [math]::Abs($a - $b)) }
$d = 'GECTI'; if ([math]::Abs($farkMax - 0.011) -gt 1e-9) { $d = 'KALDI' }
T-Kaydet $d 'OtoKal-Oku çift ölçüm farkı (satır 5329 ifadesi)' 'fark 0.004 ve 0.011' "farkMax=$farkMax" '-' 'beklenen 0.011 (uyarı eşiği 0.01)'

# ------------------------------------------------------------------ 5) Büyük hatalar / yakınsama
Write-Host "`n=== 5) Büyük hatalar (yakınsama) ==="
[void](T-Vaka 'Büyük: 1 mm / 1° her eksen, ölçek %2' @{ xb = 1; ya = -1; zb = 1; eA = 1; eB = -1; gA = 1.02; gB = 0.98; m = 0.2; wx = 0.2; c = 0.2 })
[void](T-Vaka 'Büyük: 3 mm / 3°, ölçek %5' @{ xb = 3; ya = -3; zb = 3; eA = 3; eB = -3; gA = 1.05; gB = 0.95; m = 0.3; wx = 0.3; c = 0.3 })
[void](T-Vaka 'Çok büyük: 6 mm / 6°, ölçek %10' @{ xb = 6; ya = -6; zb = 6; eA = 6; eB = -6; gA = 1.1; gB = 0.9; m = 0.5; wx = 0.5; c = 0.5 })
[void](T-Vaka 'Aşırı: eA = 20° (A sıfırı çok kayık)' @{ eA = 20 } -BilgiAmacli)

# ------------------------------------------------------------------ 6) Gürültü (Monte Carlo)
Write-Host "`n=== 6) Gürültü, σ = 0.003 mm, n = $MonteKarlo ==="
$mcHata = @{ dX = @(); dY = @(); dZ = @(); dA = @(); dB = @() }
$mcMaxL = 0.0; $mcMaxA = 0.0; $mcArtik = 0.0
for ($k = 0; $k -lt $MonteKarlo; $k++) {
    $q = Q $hep; $z = T-Olc $q 10.02 'duz' 1.5 0.003
    $res = OtoKal-Hesapla-Ic $z 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
    $b = T-Beklenen $q
    foreach ($ad in @('dX', 'dY', 'dZ', 'dA', 'dB')) { $mcHata[$ad] += ($res[$ad] - $b[$ad]) }
    $mcMaxL = [math]::Max($mcMaxL, [math]::Max([math]::Max([math]::Abs($res.dX - $b.dX), [math]::Abs($res.dY - $b.dY)), [math]::Abs($res.dZ - $b.dZ)))
    $mcMaxA = [math]::Max($mcMaxA, [math]::Max([math]::Abs($res.dA - $b.dA), [math]::Abs($res.dB - $b.dB)))
    $mcArtik = [math]::Max($mcArtik, $res.ArtikMax)
}
$std = @{}
foreach ($ad in @('dX', 'dY', 'dZ', 'dA', 'dB')) { $s = 0; foreach ($v in $mcHata[$ad]) { $s += $v * $v }; $std[$ad] = [math]::Sqrt($s / [math]::Max(1, $mcHata[$ad].Count)) }
# ölçüt: kuramsal σ'nın ~4 katı (σ(xb)≈0.0057 mm, σ(dA)≈0.0044°); belgedeki '~0.003' iddiası için ayrıca bakınız BILGI satırı
$d = 'GECTI'; if ($mcMaxL -gt 0.025 -or $mcMaxA -gt 0.02) { $d = 'KALDI' }
$belge = 'tutuyor'; if ($mcMaxL -gt 0.01 -or $mcMaxA -gt 0.02) { $belge = 'TUTMUYOR (✓ eşiği 0.01 mm / 0.02° aşıldı)' }
T-Kaydet 'BILGI' 'Belge: gürültüde X Y Z ~0.003 mm, A B ~0.003°' '-' "en büyük XYZ $(F $mcMaxL) mm / AB $(F $mcMaxA) deg" '-' $belge
T-Kaydet $d "Gürültü σ0.003 (n=$MonteKarlo), hepsi birlikte" 'σ=0.003 mm her z' ("RMS hata dX $(F $std.dX) dY $(F $std.dY) dZ $(F $std.dZ) mm, dA $(F $std.dA) dB $(F $std.dB) deg") "en büyük XYZ $(F $mcMaxL) mm / AB $(F $mcMaxA) deg" "en büyük artık $(F $mcArtik) mm (uyarı eşiği 0.01)"

# Kuramsal duyarlılık ve kaldıraç (leverage) — doğrusal yaklaşım, çözüm noktasında
$qS = Q $hep; $N = 18; $P = 10
$adim = @(1e-4, 1e-4, 1e-4, 1e-3, 1e-3, 1e-5, 1e-5, 1e-4, 1e-3, 1e-3)
$f0 = @(0..17 | ForEach-Object { OkModel $qS $_ 10.02 'duz' 1.5 })
$Jak = New-Object 'double[][]' $P
for ($j = 0; $j -lt $P; $j++) { $q2 = [double[]]$qS.Clone(); $q2[$j] += $adim[$j]; $Jak[$j] = New-Object 'double[]' $N; for ($i = 0; $i -lt $N; $i++) { $Jak[$j][$i] = ((OkModel $q2 $i 10.02 'duz' 1.5) - $f0[$i]) / $adim[$j] } }
$M = New-Object 'double[][]' $P
for ($a = 0; $a -lt $P; $a++) { $M[$a] = New-Object 'double[]' $P; for ($b2 = 0; $b2 -lt $P; $b2++) { $s = 0; for ($i = 0; $i -lt $N; $i++) { $s += $Jak[$a][$i] * $Jak[$b2][$i] }; $M[$a][$b2] = $s } }
$Cinv = New-Object 'double[][]' $P
for ($j = 0; $j -lt $P; $j++) { $e = New-Object 'double[]' $P; $e[$j] = 1; $Cinv[$j] = OkCoz $M $e }   # sütun j (simetrik)
# koşul sayısı tahmini (köşegen ölçekli)
$sig = 0.003
$kq = @{}; for ($j = 0; $j -lt $P; $j++) { $kq[$ParAd[$j]] = $sig * [math]::Sqrt($Cinv[$j][$j]) }
$varA = ($Cinv[3][3] + $Cinv[9][9] + 2 * $Cinv[3][9]) / ($qS[5] * $qS[5])
$kur = "σ(xb) $(F $kq.xb) σ(ya) $(F $kq.ya) σ(zb) $(F $kq.zb) mm; σ(dA) $(F ($sig * [math]::Sqrt($varA))) σ(dB) $(F $kq.eB) deg; σ(gA) $(F $kq.gA '0.00000') σ(gB) $(F $kq.gB '0.00000')"
$hat = @()
for ($i = 0; $i -lt $N; $i++) { $h = 0; for ($a = 0; $a -lt $P; $a++) { for ($b2 = 0; $b2 -lt $P; $b2++) { $h += $Jak[$a][$i] * $Cinv[$a][$b2] * $Jak[$b2][$i] } }; $hat += $h }
T-Kaydet 'BILGI' 'Kuramsal belirsizlik (σ=0.003, doğrusal)' '-' $kur '-' ''
T-Kaydet 'BILGI' 'Kaldıraç h_ii (1 = o noktadaki hata hiç görünmez)' '-' (((0..17) | ForEach-Object { "P$($_)=$(F $hat[$_] '0.00')" }) -join ' ') '-' "toplam $(F (($hat | Measure-Object -Sum).Sum) '0.00') (= parametre sayısı)"

# ------------------------------------------------------------------ 7) Kötü koşullu / eksik / hatalı veri
Write-Host "`n=== 7) Dejenere ve hatalı ölçümler ==="
function T-Beklenen-Istisna([string]$ad, $z, [string]$desen, [double]$T = 10.02) {
    try { $res = OtoKal-Hesapla-Ic $z $T $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5 }
    catch {
        $d = 'GECTI'; if ($desen -and ($_.Exception.Message -notmatch $desen)) { $d = 'KALDI' }
        T-Kaydet $d $ad '-' "istisna: $($_.Exception.Message)" '-' ''; return
    }
    T-Kaydet 'KALDI' $ad '-' "istisna YOK: dX $(F $res.dX) dA $(F $res.dA) gA $(F $res.Q[5])" '-' "uyari=[$(T-Uyari $res)]"
}
T-Beklenen-Istisna 'A dönmüyor (gA=0)' (T-Olc (Q @{ gA = 0.0 }) 10.02 'duz' 1.5) 'A/B eğik'
T-Beklenen-Istisna 'B ±15 dönmüyor (gB≈0)' (T-Olc (Q @{ gB = 1e-9 }) 10.02 'duz' 1.5) 'A/B eğik'
T-Beklenen-Istisna 'A yalnız 4.5° dönüyor (gA=0.3)' (T-Olc (Q @{ gA = 0.3 }) 10.02 'duz' 1.5) 'A/B eğik'
[void](T-Vaka 'A yarım dönüyor (gA=0.5) - eşik üstü' @{ gA = 0.5 } -BilgiAmacli)

# Eksik nokta (hashtable anahtarı yok -> $null -> 0)
$z = T-Olc (Q $hep) 10.02 'duz' 1.5; $z.Remove(7)
try { $res = OtoKal-Hesapla-Ic $z 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5; T-Kaydet 'BILGI' 'Eksik nokta P7 ($null)' 'P7 yok' "istisna YOK: dX $(F $res.dX) dY $(F $res.dY) dZ $(F $res.dZ) dA $(F $res.dA) dB $(F $res.dB)" '-' "Buyuk=$(T-Buyuk $res) uyari=[$(T-Uyari $res)]" }
catch { T-Kaydet 'BILGI' 'Eksik nokta P7 ($null)' 'P7 yok' "istisna: $($_.Exception.Message)" '-' '' }
# NaN
$z = T-Olc (Q $hep) 10.02 'duz' 1.5; $z[3] = [double]::NaN
try { $res = OtoKal-Hesapla-Ic $z 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5; T-Kaydet 'BILGI' 'NaN ölçüm P3' 'P3 = NaN' "istisna YOK: dX $(F $res.dX) X $(F $res.X)" '-' "Buyuk=$(T-Buyuk $res) (NaN karşılaştırmaları hep false) G10 metni: X$(Sayi $res.X)" }
catch { T-Kaydet 'BILGI' 'NaN ölçüm P3' 'P3 = NaN' "istisna: $($_.Exception.Message)" '-' '' }
# Bir nokta 0.5 mm / 6 mm kaymış (kir, eski değer)
foreach ($kay in @(0.5, 6.0)) {
    $z = T-Olc (Q $hep) 10.02 'duz' 1.5; $z[1] = $z[1] + $kay
    $res = OtoKal-Hesapla-Ic $z 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
    $b = T-Beklenen (Q $hep)
    T-Kaydet 'BILGI' "P1 +$kay mm kaymış (kir/eski değer)" "P1 +$kay" "hata dX $(F ($res.dX-$b.dX)) dZ $(F ($res.dZ-$b.dZ)) dB $(F ($res.dB-$b.dB))" '-' "artikMax $(F $res.ArtikMax) Buyuk=$(T-Buyuk $res) uyari=[$(T-Uyari $res)]"
}
# Yanlış disk kalınlığı (+0.1 mm)
[void](T-Vaka 'Kalınlık 0.1 mm fazla girildi (T 10.12, gerçek 10.02)' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'ok' @{} 10.12 -BilgiAmacli)
# Yanlış uç tipi / çapı
[void](T-Vaka 'Uç tipi yanlış: gerçek düz r1.5, hesap küre r1.5' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'ok' @{} 0 'kure' 1.5 -BilgiAmacli)
[void](T-Vaka 'Uç çapı yanlış: gerçek düz Ø3, hesap düz Ø2' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'ok' @{} 0 'duz' 1.0 -BilgiAmacli)
[void](T-Vaka 'Düz pim ucu pahlı: etkin r 1.3, hesap r 1.5 (Ø3 girildi)' $hep 10.02 'duz' 1.3 0 1e-5 1e-5 'ok' @{} 0 'duz' 1.5 -BilgiAmacli)
[void](T-Vaka 'Küre uç çapı 0.1 mm farklı: gerçek r1.05, hesap r1.0' $hep 10.02 'kure' 1.05 0 1e-5 1e-5 'ok' @{} 0 'kure' 1.0 -BilgiAmacli)
# Modelde olmayan gerçek etkiler (bağımsız modelle)
[void](T-Vaka 'Model dışı: A ekseni B''den 0.05 mm yukarıda' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'm2' @{ AZ = 0.05 } -BilgiAmacli)
[void](T-Vaka 'Model dışı: A ekseni B''den 0.5 mm yukarıda' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'm2' @{ AZ = 0.5 } -BilgiAmacli)
[void](T-Vaka 'Model dışı: B ölçeği 1.001, B180 gerçekte 180.18°' @{ gB = 1.001 } 10.02 'duz' 1.5 0 1e-5 1e-5 'm2' @{ FlipOlcek = $true } -BilgiAmacli)
[void](T-Vaka 'Model dışı: B180''e dönmedi (alt yerine üst yüz), m=0.05' $hep 10.02 'duz' 1.5 0 1e-5 1e-5 'm2' @{ FlipYok = $true } -BilgiAmacli)

# Tek nokta aykırı değer duyarlılığı
if (-not $Hizli) {
    $qA = Q $hep; $z0 = T-Olc $qA 10.02 'duz' 1.5; $b = T-Beklenen $qA
    $satir = @()
    for ($i = 0; $i -lt 18; $i++) {
        $z = @{}; foreach ($k in $z0.Keys) { $z[$k] = $z0[$k] }; $z[$i] = $z[$i] + 0.02
        $res = OtoKal-Hesapla-Ic $z 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
        $satir += "P$i(XYZ $(F ([math]::Max([math]::Max([math]::Abs($res.dX-$b.dX),[math]::Abs($res.dY-$b.dY)),[math]::Abs($res.dZ-$b.dZ))) '0.000') AB $(F ([math]::Max([math]::Abs($res.dA-$b.dA),[math]::Abs($res.dB-$b.dB))) '0.000') art $(F $res.ArtikMax '0.000'))"
    }
    T-Kaydet 'BILGI' 'Tek nokta +0.02 mm aykırı: sonuç kayması ve görünen artık' '+0.02 mm' ($satir -join ' ') '-' 'art < 0.01 ise uyarı çıkmaz'
}

# ------------------------------------------------------------------ 8) G-kod ile model tutarlılığı (benzetim)
Write-Host "`n=== 8) Ölçüm programı + benzetim ==="
function T-Sim-Coz([string]$sim) {
    $deg = @{}
    foreach ($ln in ($sim -split "`r?`n")) { $m = [regex]::Match($ln, '^\(#(41\d\d) = .*->\s+(-?[\d.]+)\)$'); if ($m.Success) { $deg[[int]$m.Groups[1].Value] = [double]::Parse($m.Groups[2].Value, [System.Globalization.CultureInfo]::InvariantCulture) } }
    $z = @{}; for ($i = 0; $i -lt 18; $i++) { $z[$i] = ($deg[4101 + 2 * $i] + $deg[4102 + 2 * $i]) / 2 }
    return $z
}
function T-Pencere([string]$sim) {
    # Her G38.2 için: başlangıç Z (son G0 Z), temas Z, hedef Z
    $sonZ = [double]::PositiveInfinity; $minUst = [double]::PositiveInfinity; $minAlt = [double]::PositiveInfinity; $yok = 0; $nUst = ''; $nAlt = ''
    foreach ($ln in ($sim -split "`r?`n")) {
        if ($ln -match '^GOSUB (Z_SAFE|AZXY_SAFE)') { $sonZ = [double]::PositiveInfinity; continue }
        $g0 = [regex]::Match($ln, '^G0 Z(-?[\d.]+)\s*$'); if ($g0.Success) { $sonZ = [double]::Parse($g0.Groups[1].Value, [System.Globalization.CultureInfo]::InvariantCulture); continue }
        $t = [regex]::Match($ln, '^G1 Z(-?[\d.]+) F[\d.]+ \(G38\.2 Z(-?[\d.]+) -> TEMAS P(\d+)\)')
        if ($t.Success) {
            $zt = [double]::Parse($t.Groups[1].Value, $ci); $zh = [double]::Parse($t.Groups[2].Value, $ci)
            if ($ln -match ' F10 ') { $sonZ = $zt; continue }   # yavaş dokunuşlar: hep 0.4 / 0.4
            if (($sonZ - $zt) -lt $minUst) { $minUst = $sonZ - $zt; $nUst = "P$($t.Groups[3].Value)" }
            if (($zt - $zh) -lt $minAlt) { $minAlt = $zt - $zh; $nAlt = "P$($t.Groups[3].Value)" }
            $sonZ = $zt; continue
        }
        if ($ln -match 'TEMAS YOK') { $yok++ }
    }
    return @{ Ust = $minUst; Alt = $minAlt; Yok = $yok; NUst = $nUst; NAlt = $nAlt }
}
$script:SimQ = [double[]]@(0, 0, 0, 0, 0, -1, -1, 0, 0, 0); $script:SimUc = 'duz'; $script:SimR = 0
$nc16 = OtoKal-NC-Uret 16 24680
$sim16 = OtoKal-Sim-Uret $nc16 16
$simT = T-Sim-Uret $nc16 16
$d = 'GECTI'; if ($sim16 -ne $simT) { $d = 'KALDI' }
T-Kaydet $d 'Test benzetim kopyası = özgün OtoKal-Sim-Uret (ideal makine)' '-' '-' '-' ''
# örnek dosyalarla karşılaştırma (tarih satırları hariç)
function T-Tarihsiz([string]$s) { return ((($s -split "`r?`n") | ForEach-Object { $_ -replace '\d{4}-\d\d-\d\d \d\d:\d\d', 'TARIH' }) -join "`n").Trim() }
$ornekSim = [System.IO.Path]::Combine($OrnekKlasor, 'PM_kalibrasyon_otomatik_SIM_16mm.nc')
if (Test-Path -LiteralPath $ornekSim) {
    $d = 'GECTI'; if ((T-Tarihsiz ([System.IO.File]::ReadAllText($ornekSim))) -ne (T-Tarihsiz $sim16)) { $d = 'KALDI' }
    T-Kaydet $d 'Benzetim çıktısı = ornekler/PM_kalibrasyon_otomatik_SIM_16mm.nc' '-' '-' '-' ''
}
$ornekNc = [System.IO.Path]::Combine($OrnekKlasor, 'ornek_olcum_programi_10mm.nc')
if (Test-Path -LiteralPath $ornekNc) {
    $d = 'GECTI'; if ((T-Tarihsiz ([System.IO.File]::ReadAllText($ornekNc))) -ne (T-Tarihsiz (OtoKal-NC-Uret 10.02 12345))) { $d = 'KALDI' }
    T-Kaydet $d 'Ölçüm programı = ornekler/ornek_olcum_programi_10mm.nc' '-' '-' '-' ''
}
$zs = T-Sim-Coz $sim16
$res = OtoKal-Hesapla-Ic $zs 16 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 0
$eL = [math]::Max([math]::Max([math]::Abs($res.dX), [math]::Abs($res.dY)), [math]::Abs($res.dZ)); $eA = [math]::Max([math]::Abs($res.dA), [math]::Abs($res.dB))
$d = 'GECTI'; if ($eL -gt 0.002 -or $eA -gt 0.005 -or [math]::Abs($res.Q[5] + 1) -gt 1e-3 -or [math]::Abs($res.Q[6] + 1) -gt 1e-3) { $d = 'KALDI' }
T-Kaydet $d 'Uçtan uca: NC → benzetim (ideal) → sonuç oku → hesap' 'ideal, gA=gB=-1' "dX $(F $res.dX) dY $(F $res.dY) dZ $(F $res.dZ) dA $(F $res.dA) dB $(F $res.dB)" "XYZ $(F $eL) / AB $(F $eA)" 'benzetim 0.001 yuvarlar (0.###)'

# Uçtan uca, hatalı makine (benzetim kopyası) — G38.2 penceresi ve sonuç
$nc10 = OtoKal-NC-Uret 10.02 11111
$script:SimQ = Q $hep; $script:SimUc = 'duz'; $script:SimR = 1.5
$simH = T-Sim-Uret $nc10 10.02
$pen = T-Pencere $simH
$zs = T-Sim-Coz $simH
$res = OtoKal-Hesapla-Ic $zs 10.02 $Ofs $P4002 @(0, 0, 0, 0, 0) 0 'duz' 1.5
$b = T-Beklenen $script:SimQ
$eL = [math]::Max([math]::Max([math]::Abs($res.dX - $b.dX), [math]::Abs($res.dY - $b.dY)), [math]::Abs($res.dZ - $b.dZ)); $eA = [math]::Max([math]::Abs($res.dA - $b.dA), [math]::Abs($res.dB - $b.dB))
$d = 'GECTI'; if ($pen.Yok -gt 0 -or $eL -gt 0.002 -or $eA -gt 0.01) { $d = 'KALDI' }
T-Kaydet $d 'Uçtan uca: hatalı makine (hepsi birlikte), düz pim Ø3' 'hepsi birlikte' "dX $(F $res.dX) dY $(F $res.dY) dZ $(F $res.dZ) dA $(F $res.dA) dB $(F $res.dB)" "XYZ $(F $eL) / AB $(F $eA)" "temas yok=$($pen.Yok); G0 sonrası en az boşluk $(F $pen.Ust '0.000') mm ($($pen.NUst)); hedefin temas altı en az $(F $pen.Alt '0.000') mm ($($pen.NAlt))"

# Nominal makinede her noktanın aşırı gidiş payı (temas olmazsa pim yüzeyin ne kadar altına sürülür)
$script:SimQ = [double[]]@(0, 0, 0, 0, 0, 1, 1, 0, 0, 0); $script:SimR = 1.5
$simN = T-Sim-Uret $nc10 10.02
$asiri = @(); $sonZ = [double]::PositiveInfinity
foreach ($ln in ($simN -split "`r?`n")) {
    $t = [regex]::Match($ln, '^G1 Z(-?[\d.]+) F(\d+) \(G38\.2 Z(-?[\d.]+) -> TEMAS P(\d+)\)')
    if ($t.Success -and $t.Groups[2].Value -ne '10') { $asiri += "P$($t.Groups[4].Value) $(F (([double]::Parse($t.Groups[1].Value, $ci)) - ([double]::Parse($t.Groups[3].Value, $ci))) '0.00')@F$($t.Groups[2].Value)" }
}
T-Kaydet 'BILGI' 'Temas olmazsa yüzey altına sürülme (ilk hızlı G38.2), nominal makine, T10.02, Ø3 düz' '-' ($asiri -join ' ') '-' 'yavaş F10 dokunuşlarda 0.4 mm'

# Parametre taraması: G38.2 penceresi hangi hatada bozuluyor?
if (-not $Hizli) {
    $tarama = [ordered]@{ xb = @(1, 2, 4, 6, 10); ya = @(1, 2, 4, 6, 10); zb = @(1, 3, 5, 6.5, 8); eA = @(1, 2, 4, 6, 10); eB = @(1, 2, 4, 6, 10); gA = @(1.05, 1.1, 1.3); m = @(1, 3, 6.5) }
    foreach ($p in $tarama.Keys) {
        $parca = @()
        foreach ($v in $tarama[$p]) {
            foreach ($sgn in @(1, -1)) {
                $val = $v * $sgn; if ($p -eq 'gA') { if ($sgn -lt 0) { continue }; $val = $v }
                $script:SimQ = Q @{ $p = $val }; $script:SimR = 1.5
                try { $pn = T-Pencere (T-Sim-Uret $nc10 10.02); $bozuk = ''; if ($pn.Yok -gt 0) { $bozuk += ' TEMAS-YOK' }; if ($pn.Ust -le 0) { $bozuk += ' G0-DALAR' } elseif ($pn.Ust -lt 0.02) { $bozuk += ' BASTA-AKTIF' }
                      $parca += "$(F $val '0.##'):ust $(F $pn.Ust '0.0')/alt $(F $pn.Alt '0.0')$bozuk" }
                catch { $parca += "$(F $val '0.##'):HATA $($_.Exception.Message)" }
            }
        }
        T-Kaydet 'BILGI' "G38.2 pencere taraması: $p" '-' ($parca -join '; ') '-' 'ust = G0 sonrası yüzeye boşluk, alt = hedefin yüzey altı'
    }
}

# ------------------------------------------------------------------ 9) Kültür (tr-TR, zh-CN)
Write-Host "`n=== 9) Kültür ==="
$zK = T-Olc (Q $hep) 10.02 'duz' 1.5 0.003
$refR = OtoKal-Hesapla-Ic $zK 10.02 $Ofs $P4002 @(0.001, 0.002, 0, 0, 0) 0.001 'duz' 1.5
$refNc = T-Tarihsiz (OtoKal-NC-Uret 12.5 54321)
$script:SimQ = Q $hep; $script:SimR = 1.5
$refSim = T-Tarihsiz (T-Sim-Uret (OtoKal-NC-Uret 12.5 54321) 12.5)
$refSayi = Sayi 1234.56789
$eskiK = [System.Threading.Thread]::CurrentThread.CurrentCulture; $eskiU = [System.Threading.Thread]::CurrentThread.CurrentUICulture
foreach ($kn in @('tr-TR', 'zh-CN', 'de-DE')) {
    try {
        $kc = New-Object System.Globalization.CultureInfo $kn
        [System.Threading.Thread]::CurrentThread.CurrentCulture = $kc; [System.Threading.Thread]::CurrentThread.CurrentUICulture = $kc
        $kanit = (2.5).ToString()
        $r = OtoKal-Hesapla-Ic $zK 10.02 $Ofs $P4002 @(0.001, 0.002, 0, 0, 0) 0.001 'duz' 1.5
        $ayni = $true; for ($j = 0; $j -lt 10; $j++) { if ($r.Q[$j] -ne $refR.Q[$j]) { $ayni = $false } }
        $ncK = T-Tarihsiz (OtoKal-NC-Uret 12.5 54321)
        $simK = T-Tarihsiz (T-Sim-Uret (OtoKal-NC-Uret 12.5 54321) 12.5)
        $virgul = ([regex]::Matches($ncK + $simK, '\d,\d')).Count
        $sayiOk = ((Sayi 1234.56789) -eq $refSayi) -and ((Metin-Sayi '10,02') -eq 10.02) -and ((Metin-Sayi '10.02') -eq 10.02) -and ($null -eq (Metin-Sayi 'abc'))
        $g10 = "G10 L2 P1 X$(Sayi $r.X) Y$(Sayi $r.Y) A$(Sayi $r.A) B$(Sayi $r.B)"
        $d = 'GECTI'; if (-not $ayni -or $ncK -ne $refNc -or $simK -ne $refSim -or $virgul -gt 0 -or -not $sayiOk -or $g10 -match ',') { $d = 'KALDI' }
        T-Kaydet $d "Kültür $kn (2.5 -> '$kanit')" '-' "hesap aynı=$ayni NC aynı=$($ncK -eq $refNc) SIM aynı=$($simK -eq $refSim) virgüllü sayı=$virgul Sayi/Metin-Sayi=$sayiOk" '-' $g10
    } finally {
        [System.Threading.Thread]::CurrentThread.CurrentCulture = $eskiK; [System.Threading.Thread]::CurrentThread.CurrentUICulture = $eskiU
    }
}
# Ekran biçimi: OtoKal-Oku içindeki '{0:0.0}' -f kültüre bağlı (yalnız gösterim)
$kc = New-Object System.Globalization.CultureInfo 'tr-TR'; [System.Threading.Thread]::CurrentThread.CurrentCulture = $kc
$ekran = '{0:0.0}' -f 99.95
[System.Threading.Thread]::CurrentThread.CurrentCulture = $eskiK
T-Kaydet 'BILGI' "Gösterim: '{0:0.0}' -f tr-TR altında" '-' $ekran '-' 'yalnız ekrandaki açı ölçeği yüzdesi; makineye gitmez'

# ------------------------------------------------------------------ 10) Özet
$sure.Stop()
Write-Host "`n=== ÖZET ==="
$g = @($Sonuc | Where-Object { $_.Durum -eq 'GECTI' }).Count; $k = @($Sonuc | Where-Object { $_.Durum -eq 'KALDI' }).Count; $bi = @($Sonuc | Where-Object { $_.Durum -eq 'BILGI' }).Count
Write-Host "Geçti $g  Kaldı $k  Bilgi $bi   süre $([int]$sure.Elapsed.TotalSeconds) s"
if ($Csv) { try { $Sonuc | Select-Object Durum, Test, Verilen, Bulunan, Hata, Not | Export-Csv -LiteralPath $Csv -NoTypeInformation -Encoding UTF8; Write-Host "Sonuç tablosu: $Csv" } catch { Write-Host "CSV yazılamadı: $($_.Exception.Message)" } }
exit $script:Basarisiz
