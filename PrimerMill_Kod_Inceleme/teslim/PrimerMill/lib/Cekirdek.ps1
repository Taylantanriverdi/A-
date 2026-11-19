# Cekirdek.ps1 - PrimerMill mantık çekirdeği: sayı biçimleme, G-kod üreticileri, kalibrasyon hesapları, ayar dosyaları.
# Eding ve arayüz gerektirmez. Fonksiyonlar düzeltilmiş eski panelden (PrimerMill/KazimaBaslat.ps1) BİREBİR taşındı.
# Bağımlılık: $ScriptKlasor (veri klasörü), $EdingKlasor, $IsKlasor önyüklemede (KazimaBaslat.ps1) tanımlanır.
# PowerShell 5.1 (32 bit) uyumlu.

function Sayi([double]$v) { return $v.ToString('0.000', [System.Globalization.CultureInfo]::InvariantCulture) }
function Metin-Sayi([string]$t) {
    $v = 0.0
    if ([double]::TryParse($t.Replace(',', '.'), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) { return $v }
    return $null
}

function Sure([double]$sn) {
    if ($sn -lt 0) { $sn = 0 }
    $ts = [TimeSpan]::FromSeconds([math]::Round($sn))
    return ('{0:00}:{1:00}:{2:00}' -f [math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
}

# ---------------- Durum ve ilerleme ----------------
function Sade-Sure([double]$sn) {
    if ($sn -lt 0) { $sn = 0 }
    $dk = [math]::Ceiling($sn / 60)
    if ($dk -lt 60) { return "$dk dk" }
    return ('{0} sa {1} dk' -f [math]::Floor($dk / 60), ($dk % 60))
}

# ================= YENİ BLOK NUMARASI =================
# Yeni takılan bloğun üst yüzüne, kenara yakın bir yay üzerine numara / isim kazınır (işten önce, aynı programın başında).
# Tek çizgili yazı tipi: 4 x 6 birimlik ızgara, her harf bir ya da birkaç çizgi.
$BlokFont = @{
    '0' = @(,@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)))
    '1' = @(@(@(1,5),@(2,6),@(2,0)), @(@(1,0),@(3,0)))
    '2' = @(,@(@(0,5),@(1,6),@(3,6),@(4,5),@(4,4),@(0,0),@(4,0)))
    '3' = @(,@(@(0,6),@(4,6),@(2,3.5),@(3,3.5),@(4,2.5),@(4,1),@(3,0),@(1,0),@(0,1)))
    '4' = @(,@(@(3,0),@(3,6),@(0,2),@(4,2)))
    '5' = @(,@(@(4,6),@(0,6),@(0,3.5),@(3,3.5),@(4,2.5),@(4,1),@(3,0),@(0,0)))
    '6' = @(,@(@(4,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,2.5),@(3,3.5),@(0,3.5)))
    '7' = @(,@(@(0,6),@(4,6),@(1.5,0)))
    '8' = @(,@(@(1,3.5),@(0,4.5),@(0,5),@(1,6),@(3,6),@(4,5),@(4,4.5),@(3,3.5),@(1,3.5),@(0,2.5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,2.5),@(3,3.5)))
    '9' = @(,@(@(4,3),@(1,3),@(0,4),@(0,5),@(1,6),@(3,6),@(4,5),@(4,1),@(3,0),@(0,0)))
    'A' = @(@(@(0,0),@(0,4),@(2,6),@(4,4),@(4,0)), @(@(0,2.5),@(4,2.5)))
    'B' = @(@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)), @(@(3,3),@(4,2),@(4,1),@(3,0),@(0,0)))
    'C' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1)))
    'D' = @(,@(@(0,0),@(0,6),@(2.5,6),@(4,4.5),@(4,1.5),@(2.5,0),@(0,0)))
    'E' = @(@(@(4,6),@(0,6),@(0,0),@(4,0)), @(@(0,3),@(3,3)))
    'F' = @(@(@(4,6),@(0,6),@(0,0)), @(@(0,3),@(3,3)))
    'G' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,3),@(2,3)))
    'H' = @(@(@(0,0),@(0,6)), @(@(4,0),@(4,6)), @(@(0,3),@(4,3)))
    'I' = @(@(@(1,6),@(3,6)), @(@(2,6),@(2,0)), @(@(1,0),@(3,0)))
    'J' = @(,@(@(4,6),@(4,1),@(3,0),@(1,0),@(0,1)))
    'K' = @(@(@(0,0),@(0,6)), @(@(4,6),@(0,2.5)), @(@(1.5,3.5),@(4,0)))
    'L' = @(,@(@(0,6),@(0,0),@(4,0)))
    'M' = @(,@(@(0,0),@(0,6),@(2,3),@(4,6),@(4,0)))
    'N' = @(,@(@(0,0),@(0,6),@(4,0),@(4,6)))
    'O' = @(,@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)))
    'P' = @(,@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)))
    'Q' = @(@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)), @(@(2.5,1.5),@(4,0)))
    'R' = @(@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)), @(@(2,3),@(4,0)))
    'S' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,4),@(1,3),@(3,3),@(4,2),@(4,1),@(3,0),@(1,0),@(0,1)))
    'T' = @(@(@(0,6),@(4,6)), @(@(2,6),@(2,0)))
    'U' = @(,@(@(0,6),@(0,1),@(1,0),@(3,0),@(4,1),@(4,6)))
    'V' = @(,@(@(0,6),@(2,0),@(4,6)))
    'W' = @(,@(@(0,6),@(1,0),@(2,3),@(3,0),@(4,6)))
    'X' = @(@(@(0,0),@(4,6)), @(@(0,6),@(4,0)))
    'Y' = @(@(@(0,6),@(2,3),@(4,6)), @(@(2,3),@(2,0)))
    'Z' = @(,@(@(0,6),@(4,6),@(0,0),@(4,0)))
    '-' = @(,@(@(1,3),@(3,3)))
    '.' = @(,@(@(2,0),@(2,0.4)))
    '/' = @(,@(@(0,0),@(4,6)))
}
$BlokKonumAci = @{ '12' = -90.0; '3' = 0.0; '6' = 90.0; '9' = 180.0 }

function Blok-Metin-Temizle([string]$t) {
    $t = $t.ToUpper([System.Globalization.CultureInfo]::GetCultureInfo('tr-TR'))
    $t = $t.Replace('Ç', 'C').Replace('Ğ', 'G').Replace('İ', 'I').Replace('I', 'I').Replace('Ö', 'O').Replace('Ş', 'S').Replace('Ü', 'U')
    $c = ($t.ToCharArray() | Where-Object { $BlokFont.ContainsKey([string]$_) -or $_ -eq ' ' }) -join ''
    return $c.Trim()
}

$BlokDalma = 40; $BlokIlerleme = 200   # mm/dk: yavaş dalma, sakin ilerleme (temiz, hassas yazı)
function Blok-Kazima-NC([string]$metin, [double]$T, [int]$takim, [double]$yuk, [string]$konum, [double]$derin = 0.2, [bool]$refCizgi = $true) {
    # Kenara yakın yay: yazı tabanı r = 41.5 mm, yükseklik $yuk (dışa doğru). Saat 12'de önden okunur.
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $s = $yuk / 6.0; $adimHarf = 6 * $s; $r0 = 41.5
    $uzun = $metin.Length * $adimHarf - 2 * $s
    $phi0 = $BlokKonumAci[$konum] * [math]::PI / 180
    $yuz = $T / 2; $zKes = $yuz - $derin; $zGuv = $yuz + 3
    $L = New-Object System.Collections.Generic.List[string]
    $L.Add("(PrimerMill blok numarasi: $metin)")
    $L.Add('G0 G17 G40 G49 G54 G80 G90')
    $L.Add('M5')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('GOSUB AZXY_SAFE')
    $L.Add('G0 B0.0')
    $L.Add("T$takim M6")
    $L.Add('S24000 M3')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('G0 A0.0')
    $L.Add('GOSUB AZXY_SAFE')
    $L.Add('G00 G90 B0.0 A0.0')
    $script:BlokIlkHareket = $true
    for ($i = 0; $i -lt $metin.Length; $i++) {
        $ch = [string]$metin[$i]
        if (-not $BlokFont.ContainsKey($ch)) { continue }
        foreach ($cizgi in $BlokFont[$ch]) {
            $ilk = $true
            # Hassas kazıma: her çizgi 0.25 mm'lik parçalara bölünür, yay eğrisini tam takip eder
            $noktalar = New-Object System.Collections.Generic.List[double[]]
            $onceki = $null
            foreach ($nk in $cizgi) {
                $u1 = -$uzun / 2 + $i * $adimHarf + $nk[0] * $s; $v1 = $nk[1] * $s
                if ($onceki) {
                    $n = [math]::Max(1, [int][math]::Ceiling([math]::Sqrt(($u1 - $onceki[0]) * ($u1 - $onceki[0]) + ($v1 - $onceki[1]) * ($v1 - $onceki[1])) / 0.25))
                    for ($q = 1; $q -le $n; $q++) { $noktalar.Add([double[]]@(($onceki[0] + ($u1 - $onceki[0]) * $q / $n), ($onceki[1] + ($v1 - $onceki[1]) * $q / $n))) }
                } else { $noktalar.Add([double[]]@($u1, $v1)) }
                $onceki = [double[]]@($u1, $v1)
            }
            foreach ($nk in $noktalar) {
                $u = $nk[0]      # yay boyunca
                $v = $nk[1]      # dışa doğru
                # Makinede ilk deneme ayna görüntüsü çıktı: yazı yay boyunca ters yönde ilerletilir
                if ($konum -eq '6') {
                    # Saat 6 (ön): yazının üstü merkeze bakar
                    $phi = $phi0 + $u / ($r0 + $yuk); $rr = $r0 + $yuk - $v
                } else {
                    # Diğer yerlerde yazının üstü diskin dışına bakar
                    $phi = $phi0 - $u / $r0; $rr = $r0 + $v
                }
                $x = $rr * [math]::Cos($phi); $y = $rr * [math]::Sin($phi)
                if ($ilk) {
                    if ($script:BlokIlkHareket) { $L.Add("G0 X$(& $f $x) Y$(& $f $y)"); $script:BlokIlkHareket = $false }
                    $L.Add("G0 X$(& $f $x) Y$(& $f $y) Z$(& $f $zGuv)")
                    $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
                    $ilk = $false
                } else { $L.Add("G1 X$(& $f $x) Y$(& $f $y) F$BlokIlerleme") }
            }
            $L.Add("G0 Z$(& $f ($yuz + 1))")
        }
    }
    if ($refCizgi) {
        # Referans çizgisi: yazının ortasından diskin KENARINA doğru radyal çizgi (r 45.5 → 48.7).
        # Tutucudaki çizgiyle (holder) hizalamak için blok sınırına kadar uzanır. İç ucunda 3 mm'lik kısa dik çizgi.
        $L.Add('(referans cizgisi - kenara kadar)')
        $c = [math]::Cos($phi0); $sn = [math]::Sin($phi0)
        $ri = [math]::Max(45.5, $r0 + $yuk + 1.0); $ro = 48.7
        $L.Add("G0 X$(& $f ($ri * $c)) Y$(& $f ($ri * $sn)) Z$(& $f $zGuv)")
        $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
        $L.Add("G1 X$(& $f ($ro * $c)) Y$(& $f ($ro * $sn)) F$BlokIlerleme")
        $L.Add("G0 Z$(& $f ($yuz + 1))")
        $tx = -$sn; $ty = $c
        $L.Add("G0 X$(& $f ($ri * $c - 1.5 * $tx)) Y$(& $f ($ri * $sn - 1.5 * $ty))")
        $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
        $L.Add("G1 X$(& $f ($ri * $c + 1.5 * $tx)) Y$(& $f ($ri * $sn + 1.5 * $ty)) F$BlokIlerleme")
        $L.Add("G0 Z$(& $f ($yuz + 1))")
    }
    $L.Add("G0 Z$(& $f $zGuv)")
    $L.Add('M5')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('(blok numarasi bitti)')
    return $L
}

$BlokKayit = [System.IO.Path]::Combine($ScriptKlasor, 'bloklar.csv')
function Blok-Sonraki-No {
    $son = 0
    try {
        if ([System.IO.File]::Exists($BlokKayit)) {
            foreach ($l in [System.IO.File]::ReadAllLines($BlokKayit)) { $p = $l.Split(';'); if ($p.Count -gt 1) { $n = 0; if ([int]::TryParse($p[1], [ref]$n) -and $n -gt $son) { $son = $n } } }
        }
    } catch { }
    return ($son + 1)
}

function Blok-Birlesik-Uret([string]$isDosyasi, $b) {
    # Numara kazıma + asıl iş tek programda. İşin başındaki CHECK_EMPTY_TOOL kaldırılır (milde kazıyan frez var).
    $satirlar = [System.IO.File]::ReadAllLines($isDosyasi)
    $derin = 0.2; if ($b.Derin) { $derin = [double]$b.Derin }
    $kaz = Blok-Kazima-NC $b.Metin $b.T $b.Takim $b.Yuk $b.Konum $derin ($b.Cizgi -ne $false)
    $cikti = New-Object System.Collections.Generic.List[string]
    $eklendi = $false; $kontrolSilindi = $false
    foreach ($l in $satirlar) {
        $t = $l.Trim()
        if (-not $eklendi -and $t -ne '%' -and -not $t.StartsWith('(')) {
            if ($t -match '^(?i)GOSUB\s+CHECK_EMPTY_TOOL') { $cikti.Add($l); foreach ($x in $kaz) { $cikti.Add([string]$x) }; $eklendi = $true; $kontrolSilindi = $true; continue }
            $cikti.Add('GOSUB CHECK_EMPTY_TOOL'); foreach ($x in $kaz) { $cikti.Add([string]$x) }; $eklendi = $true
        }
        if ($eklendi -and -not $kontrolSilindi -and $t -match '^(?i)GOSUB\s+CHECK_EMPTY_TOOL') { $kontrolSilindi = $true; continue }
        $cikti.Add($l)
    }
    $hedef = [System.IO.Path]::Combine($IsKlasor, ([System.IO.Path]::GetFileNameWithoutExtension($isDosyasi) + "_blok$($b.Metin -replace '[^A-Za-z0-9\-]', '').nc"))
    [System.IO.File]::WriteAllLines($hedef, $cikti)
    return $hedef
}

function Blok-Kaydet($b, [string]$isDosyasi) {
    try {
        if (-not [System.IO.File]::Exists($BlokKayit)) { [System.IO.File]::WriteAllText($BlokKayit, "tarih;no;ilk_is;disk_mm`r`n", [System.Text.Encoding]::UTF8) }
        [System.IO.File]::AppendAllText($BlokKayit, "$(Get-Date -Format 'yyyy-MM-dd HH:mm');$($b.Metin);$([System.IO.Path]::GetFileName($isDosyasi));$(Sayi $b.T)`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
}

# ================= DİSK KALİBRASYONU (X Y Z A B) =================
# Bir diske 4 test sığar. Test k: dıştaki 4 cep (r=38) saat 3-6-9-12'den k*45 dk döndürülür,
# içteki grup (Z cebi, pencere, A±20 cepleri, k adet nokta) diskin farklı bir yerine kazılır.
# Formüller (eğim ve konum işaretleri ölçülen yüzey eğimiyle düzeltilir; sadece A, B, Y'nin dönüş yönü bilinmez):
#   eğim : s_u = (d[Ø5] - d[Ø7]) / 76,  s_v = (d[Ø8] - d[Ø4]) / 76
#          s_x = s_u cos(th) - s_v sin(th),  s_y = s_u sin(th) + s_v cos(th)        th = (k-1)*22.5°
#   B    : dB = atan(s_x)                 G54B += sB*dB
#   A    : dA = atan(s_y)                 G54A += sA*dA
#   X    : pencere (üstten -4..+4, alttan 0..+8)   w = 4 - 2*dx  -> dx = (4 - w)/2        G54X += dx
#   Z    : web = T - d1 - d2 ;  h = 1 - web/2 - s_y*cy          #4002 -= h
#   Y    : dy = (d[A+20] - d[A-20] - s_x*18) / (2 sin20)          G54Y += sY*dy
$KalGruplar = @{ 1 = @(15.5, 3.0); 2 = @(-15.5, -2.0); 3 = @(-2.5, 21.0); 4 = @(10.5, -21.0) }
$KalGrupYer = @{ 1 = 'merkezin sağı'; 2 = 'merkezin solu'; 3 = 'merkezin önü (saat 6 tarafı)'; 4 = 'merkezin arkası, sağa yakın' }
$KalHalkaR = 38.0

function Kal-Saat([double]$derece) {
    # Saat 3'ten saat yönünde (öne doğru) derece -> "3:45" gibi
    $dk = [int][math]::Round((3 * 60 + $derece * 2) % 720)
    $s = [math]::Floor($dk / 60); if ($s -eq 0) { $s = 12 }
    return ('{0}:{1:00}' -f $s, ($dk % 60))
}

function Kal-Duzen([int]$k) {
    # Test k'nın bütün ceplerinin disk üzerindeki yeri (disk koordinatı, ön = Y+)
    $th = ($k - 1) * 22.5
    $r = $KalHalkaR
    $kol = { param($a) @([math]::Round($r * [math]::Cos($a * [math]::PI / 180), 3), [math]::Round($r * [math]::Sin($a * [math]::PI / 180), 3)) }
    $g = $KalGruplar[$k]; $cx = $g[0]; $cy = $g[1]
    $p5 = & $kol $th; $p8 = & $kol ($th + 90); $p7 = & $kol ($th + 180); $p4 = & $kol ($th + 270)
    return [ordered]@{
        Th = $th; Cx = $cx; Cy = $cy
        Orta  = @{ X = $cx;      Y = $cy; R = 3.0; A = 0 }
        Sag   = @{ X = $p5[0];   Y = $p5[1]; R = 2.5; A = 0; Saat = (Kal-Saat $th) }
        On    = @{ X = $p8[0];   Y = $p8[1]; R = 4.0; A = 0; Saat = (Kal-Saat ($th + 90)) }
        Sol   = @{ X = $p7[0];   Y = $p7[1]; R = 3.5; A = 0; Saat = (Kal-Saat ($th + 180)) }
        Arka  = @{ X = $p4[0];   Y = $p4[1]; R = 2.0; A = 0; Saat = (Kal-Saat ($th + 270)) }
        Aarti = @{ X = $cx + 9;  Y = $cy; R = 4.0; A = 20 }
        Aeksi = @{ X = $cx - 9;  Y = $cy; R = 3.5; A = -20 }
    }
}

function Kal-Nokta([double]$x, [double]$y, [double]$z, [double]$a, [bool]$ters) {
    # Disk noktası -> program koordinatı. B180 tarafında z o yüzden bakışla verilir; sadece x ters döner.
    if ($ters) { $x = -$x }
    $r = $a * [math]::PI / 180
    $y2 = $y * [math]::Cos($r) + $z * [math]::Sin($r)
    $z2 = -$y * [math]::Sin($r) + $z * [math]::Cos($r)
    return @($x, $y2, $z2)
}

function Kal-NC-Uret([double]$T, [double]$D, [int]$k = 1) {
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $dz = Kal-Duzen $k
    $rt = $D / 2
    $ust = $T / 2 + 0.3
    $guv = $T / 2 + 5
    $adim = 0.4
    $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    & $L '%'
    & $L "(PrimerMill disk kalibrasyon testi $k/4  disk $(& $f $T) mm  T1 O$(& $f $D) mm  $(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    & $L 'GOSUB CHECK_EMPTY_TOOL'
    & $L 'G0 G17 G40 G49 G54 G80 G90'
    & $L 'G0 B0.0'
    & $L 'T1 M6'
    & $L 'M3 S18000'
    $cep = {
        param($c, [bool]$ters, [double]$hedefZ)
        $rmax = [math]::Max(0.0, $c.R - $rt)   # 0.0 (KL-03): tamsayı Max cep çapını yuvarlıyordu
        $halkalar = @(); $rr = $rmax; while ($rr -gt 0.05) { $halkalar += $rr; $rr -= [math]::Max(0.3, $D * 0.4) }; $halkalar += 0
        $p0 = Kal-Nokta $c.X $c.Y $guv $c.A $ters
        & $L "G0 X$(& $f $p0[0]) Y$(& $f $p0[1]) Z$(& $f $p0[2])"
        $z = $ust
        while ($true) {
            $z = [math]::Max($hedefZ, $z - $adim)
            foreach ($h in $halkalar) {
                $n = if ($h -lt 0.05) { 1 } else { [math]::Max(12, [int](2 * [math]::PI * $h / 0.4)) }
                for ($i = 0; $i -le $n; $i++) {
                    $t = 2 * [math]::PI * $i / $n
                    $q = Kal-Nokta ($c.X + $h * [math]::Cos($t)) ($c.Y + $h * [math]::Sin($t)) $z $c.A $ters
                    $fd = if ($i -eq 0) { ' F150' } else { ' F500' }
                    & $L "G1 X$(& $f $q[0]) Y$(& $f $q[1]) Z$(& $f $q[2])$fd"
                    if ($h -lt 0.05) { break }
                }
            }
            if ($z -le $hedefZ + 1e-6) { break }
        }
        $p1 = Kal-Nokta $c.X $c.Y $guv $c.A $ters
        & $L "G0 X$(& $f $p1[0]) Y$(& $f $p1[1]) Z$(& $f $p1[2])"
    }
    $kanal = {
        param([double]$x1, [double]$x2, [double]$y1, [double]$y2, [bool]$ters, [double]$hedefZ)
        $xa = $x1 + $rt; $xb = $x2 - $rt; $ya = $y1 + $rt; $yb = $y2 - $rt
        $p0 = Kal-Nokta $xa $ya $guv 0 $ters
        & $L "G0 X$(& $f $p0[0]) Y$(& $f $p0[1]) Z$(& $f $p0[2])"
        $z = $ust
        while ($true) {
            $z = [math]::Max($hedefZ, $z - $adim)
            $yy = $ya; $yon = 1; $ilk = $true
            while ($true) {
                $q1 = Kal-Nokta $(if ($yon -gt 0) { $xa } else { $xb }) $yy $z 0 $ters
                $q2 = Kal-Nokta $(if ($yon -gt 0) { $xb } else { $xa }) $yy $z 0 $ters
                $fd = if ($ilk) { ' F150' } else { ' F500' }; $ilk = $false
                & $L "G1 X$(& $f $q1[0]) Y$(& $f $q1[1]) Z$(& $f $q1[2])$fd"
                & $L "G1 X$(& $f $q2[0]) Y$(& $f $q2[1]) Z$(& $f $q2[2]) F500"
                if ($yy -ge $yb - 1e-6) { break }
                $yy = [math]::Min($yb, $yy + [math]::Max(0.3, $D * 0.4)); $yon = -$yon
            }
            foreach ($kk in @(@($xa, $ya), @($xb, $ya), @($xb, $yb), @($xa, $yb), @($xa, $ya))) {
                $q = Kal-Nokta $kk[0] $kk[1] $z 0 $ters; & $L "G1 X$(& $f $q[0]) Y$(& $f $q[1]) Z$(& $f $q[2]) F500"
            }
            if ($z -le $hedefZ + 1e-6) { break }
        }
        $p1 = Kal-Nokta $xa $ya $guv 0 $ters
        & $L "G0 X$(& $f $p1[0]) Y$(& $f $p1[1]) Z$(& $f $p1[2])"
    }
    $cx = $dz.Cx; $cy = $dz.Cy
    # --- ÜST YÜZ (B0, A0)
    & $L "(UST YUZ B0 - test $k)"
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0 B0.0'
    & $L '(Z cebi)'; & $cep $dz.Orta $false 1.0
    foreach ($ad in @('Sag', 'On', 'Sol', 'Arka')) { & $L "($ad)"; & $cep $dz[$ad] $false ($T / 2 - 4) }
    & $L "(test no: $k nokta)"
    for ($i = 0; $i -lt $k; $i++) {
        $px = $cx - 3 + 2 * $i; $py = $cy + 5
        & $L "G0 X$(& $f $px) Y$(& $f $py) Z$(& $f $guv)"
        & $L "G1 Z$(& $f ($T / 2 - 0.6)) F150"
        & $L "G0 Z$(& $f $guv)"
    }
    & $L '(PENCERE UST)'
    & $kanal ($cx - 4) ($cx + 4) ($cy - 11) ($cy - 7) $false -1.0
    foreach ($ad in @('Aarti', 'Aeksi')) {
        $c = $dz[$ad]
        & $L "($ad A$($c.A))"
        & $L 'GOSUB Z_SAFE'
        & $L "G0 A$(& $f $c.A) B0.0"
        & $cep $c $false ($T / 2 - 3.5)
    }
    # --- ALT YÜZ (B180, A0)
    & $L '(ALT YUZ B180)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B180.0'
    & $L '(Z cebi alt)'; & $cep $dz.Orta $true 1.0
    & $L '(PENCERE ALT)'
    & $kanal $cx ($cx + 8) ($cy - 11) ($cy - 7) $true -1.0
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B0.0'
    & $L 'M5'
    & $L 'T0 M6'
    & $L 'G30'
    & $L 'M30'
    & $L '%'
    return $sb.ToString()
}

# ---- Sekme: DİSK KALİBRASYONU ----
$KalGecmis = [System.IO.Path]::Combine($ScriptKlasor, 'kalibrasyon_gecmisi.csv')
$script:KalSonuc = $null
$KalOlcumTanim = [ordered]@{
    'w'   = @('1  Pencere genişliği (X yönü, boydan boya açık kısım)', '4.00')
    'd1'  = @('2  Z cebi Ø6 derinliği  ÜSTTEN', '')
    'd2'  = @('3  Z cebi Ø6 derinliği  ALTTAN', '')
    'dR'  = @('4  Dış Ø5 cebi derinliği', '')
    'dL'  = @('5  Dış Ø7 cebi derinliği', '')
    'dF'  = @('6  Dış Ø8 cebi derinliği', '')
    'dK'  = @('7  Dış Ø4 cebi derinliği', '')
    'dAp' = @('8  İç Ø8 cebi (A+20) derinliği, ortası', '')
    'dAm' = @('9  İç Ø7 cebi (A−20) derinliği, ortası', '')
}
$script:KalKutu = @{}

# ================= OTOMATİK KALİBRASYON (iletken temas, titanyum disk) =================
# Titanyum disk tutucudan izole edilir ve prob girişine bağlanır; iş milindeki pim (veya T1) diske değince devre kapanır.
# Kumpas yok, kesim yok: makine diske dokunarak ölçer, değerleri hesaplar, onayla G54 ve #4002'ye yazar.
# Ölçüm (hepsi iş koordinatında, Z ucu ile, G38.2):
#   B0 A0  üst yüz  5 nokta (0,0) (±R,0) (0,±R)    -> yüz düzlemi: eğim X/Y
#   A±θ    üst yüz  (0,±d)                          -> iki eğik çizginin kesişimi = A ekseninin Y'si   (uç şekli birbirini götürür)
#   B±θ    üst yüz  (±d,0)                          -> kesişim = B ekseninin X'i; çizgi açıları = A/B açı ölçeği ve yönü
#   B180   alt yüz  5 nokta                         -> B sıfırı = (üst eğim + alt eğim)/2 (disk takma eğikliği ayrılır)
#                                                      Z ekseni = (z_üst + z_alt' - T)/2 ;  #4002 -= Z ekseni
#   Tekrarlanabilirlik: merkez 5 kez yavaş ölçülür.
# Sonuçlar #4100..#4145 (kalıcı), #4199 = ölçüm kimliği, #4100 = 1 bittiğinde.
$OkTeta = 15.0; $OkD = 8.0; $OkR = 25.0
$OkNoktalar = @(
    @{ Ad = 'ust merkez';  X = 0;     Y = 0;     Grup = 'U' }   # 0
    @{ Ad = 'ust X+';      X = $OkR;  Y = 0;     Grup = 'U' }   # 1
    @{ Ad = 'ust X-';      X = -$OkR; Y = 0;     Grup = 'U' }   # 2
    @{ Ad = 'ust Y+';      X = 0;     Y = $OkR;  Grup = 'U' }   # 3
    @{ Ad = 'ust Y-';      X = 0;     Y = -$OkR; Grup = 'U' }   # 4
    @{ Ad = 'A+ Y-';       X = 0;     Y = -$OkD; Grup = 'Ap' }  # 5
    @{ Ad = 'A+ Y+';       X = 0;     Y = $OkD;  Grup = 'Ap' }  # 6
    @{ Ad = 'A- Y-';       X = 0;     Y = -$OkD; Grup = 'Am' }  # 7
    @{ Ad = 'A- Y+';       X = 0;     Y = $OkD;  Grup = 'Am' }  # 8
    @{ Ad = 'B+ X-';       X = -$OkD; Y = 0;     Grup = 'Bp' }  # 9
    @{ Ad = 'B+ X+';       X = $OkD;  Y = 0;     Grup = 'Bp' }  # 10
    @{ Ad = 'B- X-';       X = -$OkD; Y = 0;     Grup = 'Bm' }  # 11
    @{ Ad = 'B- X+';       X = $OkD;  Y = 0;     Grup = 'Bm' }  # 12
    @{ Ad = 'alt merkez';  X = 0;     Y = 0;     Grup = 'L' }   # 13
    @{ Ad = 'alt X+';      X = $OkR;  Y = 0;     Grup = 'L' }   # 14
    @{ Ad = 'alt X-';      X = -$OkR; Y = 0;     Grup = 'L' }   # 15
    @{ Ad = 'alt Y+';      X = 0;     Y = $OkR;  Grup = 'L' }   # 16
    @{ Ad = 'alt Y-';      X = 0;     Y = -$OkR; Grup = 'L' }   # 17
)
$OkGecmis = [System.IO.Path]::Combine($ScriptKlasor, 'oto_kalibrasyon_gecmisi.csv')
$script:OkSonuc = $null

function OtoKal-NC-Uret([double]$T, [int]$kimlik) {
    # K8 / KL-01: prob temas etmezse ilk G38.2 hedefi yüzeyin 6 mm (eğik noktalarda 8.7 mm) altında; hata denetimi hareketten sonra.
    # Arama mesafesi ve hızları BİLEREK değiştirilmedi (makinede doğrulanmadan); öneri INCELEME_RAPORU.md KL-01: ilk noktada hedef T/2-2 ve F60,
    # diğerlerinde beklenen temas - 1.5 mm. Şimdilik koruma: son 10 dakikada başarılı prob testi olmadan program hazırlanmaz / başlatılmaz.
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    $kontrol = {
        param($ad)
        & $L 'if [#5067 == 0]'
        & $L "  errmsg ""PM KALIBRASYON: temas yok - $ad - kablo, izolasyon, disk kalinligi"""
        & $L 'endif'
    }
    # Bir nokta: hızlı yaklaş (F120 / uzun: F200), 2 kez yavaş (F10) ölç, ikisini sakla
    $nokta = {
        param([int]$i, [string]$zBas, [string]$zSon, [bool]$uzun)
        $n = $OkNoktalar[$i]; $v1 = 4101 + 2 * $i; $v2 = $v1 + 1
        & $L "(P$i $($n.Ad))"
        & $L "G0 X$(& $f $n.X) Y$(& $f $n.Y)"
        if (-not $uzun) { & $L "G0 Z$zBas" }
        & $L "G38.2 Z$zSon F$(if ($uzun) { 200 } else { 120 })"
        & $kontrol $n.Ad
        # temas başlangıç noktasında olduysa prob baştan aktifti (disk şaseye değiyor)
        if ($uzun) { & $L "if [#5063 > [$zSon + 12]]" } else { & $L "if [#5063 > [$zBas - 0.02]]" }
        & $L "  errmsg ""PM KALIBRASYON: prob baslangicta aktif - $($n.Ad) - disk sasede degiyor olabilir"""
        & $L 'endif'
        & $L 'G0 Z[#5063 + 0.4]'
        & $L 'G38.2 Z[#5063 - 0.8] F10'
        & $kontrol $n.Ad
        & $L "#$v1 = #5063"
        & $L 'G0 Z[#5063 + 0.4]'
        & $L 'G38.2 Z[#5063 - 0.8] F10'
        & $kontrol $n.Ad
        & $L "#$v2 = #5063"
        if ($uzun) { & $L 'G0 Z[#5063 + 6]' } else { & $L "G0 Z$zBas" }
    }
    & $L '%'
    & $L "(PrimerMill OTOMATIK KALIBRASYON  disk $(& $f $T) mm  kimlik $kimlik  $(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    & $L '(Iletken temas: titanyum disk prob girisine bagli ve tutucudan izole, is mili sasede)'
    & $L '(IS MILI DONMEZ. T1 istenince kalibrasyon pimini veya T1 frezini tak.)'
    & $L '#4100 = 0'
    & $L "#4199 = $kimlik"
    & $L 'GOSUB CHECK_EMPTY_TOOL'
    & $L 'G0 G17 G40 G49 G54 G80 G90'
    & $L 'M5'
    & $L 'M9'
    & $L 'G0 B0.0'
    & $L 'T1 M6'
    & $L 'M5'
    & $L '(takim boyu: sensor)'
    & $L 'GOSUB user_1'
    & $L 'M5'
    # --- B0 A0 üst yüz
    & $L '(UST YUZ B0 A0)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0 B0.0'
    & $nokta 0 '' "$(& $f ($T / 2 - 6))" $true
    & $L '(tekrarlanabilirlik: merkez 5 kez)'
    for ($k = 1; $k -le 5; $k++) {
        & $L 'G0 Z[#4101 + 0.4]'
        & $L 'G38.2 Z[#4101 - 0.8] F10'
        & $kontrol 'tekrar'
        & $L "#$(4140 + $k) = #5063"
    }
    & $L 'G0 Z[#4101 + 6]'
    foreach ($i in 1..4) { & $nokta $i '[#4101 + 6]' '[#4101 - 6]' $false }
    # --- A ± θ
    foreach ($a in @(@($OkTeta, 5, 6), @(-$OkTeta, 7, 8))) {
        & $L "(A$(& $f $a[0]) B0)"
        & $L 'GOSUB Z_SAFE'
        & $L "G0 A$(& $f $a[0]) B0.0"
        & $nokta $a[1] '[#4101 + 6]' '[#4101 - 6]' $false
        & $nokta $a[2] '[#4101 + 6]' '[#4101 - 6]' $false
    }
    # --- B ± θ
    foreach ($b in @(@($OkTeta, 9, 10), @(-$OkTeta, 11, 12))) {
        & $L "(B$(& $f $b[0]) A0)"
        & $L 'GOSUB Z_SAFE'
        & $L 'G0 A0.0'
        & $L 'GOSUB AZXY_SAFE'
        & $L "G0 B$(& $f $b[0])"
        & $nokta $b[1] '[#4101 + 6]' '[#4101 - 6]' $false
        & $nokta $b[2] '[#4101 + 6]' '[#4101 - 6]' $false
    }
    # --- B180 alt yüz (ilk nokta yukarıdan uzun yaklaşma ile: alt yüzün yüksekliği bilinmiyor)
    & $L '(ALT YUZ B180)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B180.0'
    & $nokta 13 '' "$(& $f ($T / 2 - 6))" $true
    foreach ($i in 14..17) { & $nokta $i '[#4127 + 6]' '[#4127 - 6]' $false }
    & $L '(bitti)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B0.0'
    & $L '#4100 = 1'
    & $L 'msg "PM KALIBRASYON: olcum bitti - PrimerMill > Ayarlar > OTO KALIBRASYON > SONUCLARI OKU"'
    & $L 'M5'
    & $L 'T0 M6'
    & $L 'G30'
    & $L 'M30'
    & $L '%'
    return $sb.ToString()
}

function OkRot([double[]]$p, [string]$eksen, [double]$derece, [double[]]$m) {
    # p noktasını, m'den geçen X ya da Y eksenine paralel doğru etrafında döndürür
    $t = $derece * [math]::PI / 180; $cs = [math]::Cos($t); $sn = [math]::Sin($t)
    $x = $p[0] - $m[0]; $y = $p[1] - $m[1]; $z = $p[2] - $m[2]
    if ($eksen -eq 'Y') { return @(($x * $cs + $z * $sn + $m[0]), ($y + $m[1]), ((-$x) * $sn + $z * $cs + $m[2])) }
    return @(($x + $m[0]), ($y * $cs - $z * $sn + $m[1]), ($y * $sn + $z * $cs + $m[2]))
}

function OkModel([double[]]$q, [int]$i, [double]$T, [string]$ucTip, [double]$ucR) {
    # Makine modeli -> nokta i'de beklenen temas Z'si.
    # q: 0 xb  1 ya  2 zb  3 eA  4 eB  5 gA  6 gB  7 m (disk ortası)  8 wx (yüzler arası açı, X yönü)  9 c (disk takma eğikliği, X ekseni)
    #    Diskin Y etrafında rijit eğikliği B sıfırından ayırt edilemez; o yüzden B düzeltmesine dahildir (istenen de budur).
    # Zincir: B (çevirme, Y ekseni) içte, A (eğme, X ekseni) dışta; iki eksen aynı Z'de kesişir.
    $n = $OkNoktalar[$i]
    $Ak = 0.0; $Bk = 0.0; $ust = $true
    switch ($n.Grup) { 'Ap' { $Ak = $OkTeta } 'Am' { $Ak = -$OkTeta } 'Bp' { $Bk = $OkTeta } 'Bm' { $Bk = -$OkTeta } 'L' { $Bk = 180.0; $ust = $false } }
    $h = if ($ust) { $T / 2 + $q[7] } else { -$T / 2 + $q[7] }
    $nv = if ($ust) { @(0.0, 0.0, 1.0) } else { @(0.0, 0.0, -1.0) }
    $o = @(0.0, 0.0, 0.0)
    $w = if ($ust) { $q[8] / 2 } else { -$q[8] / 2 }
    $pt = OkRot (OkRot @(0.0, 0.0, $h) 'Y' $w $o) 'X' $q[9] $o
    $nv = OkRot (OkRot $nv 'Y' $w $o) 'X' $q[9] $o
    $pt = @(($pt[0] + $q[0]), ($pt[1] + $q[1]), ($pt[2] + $q[2]))
    # B180 çevirmesinde ölçek uygulanmaz (±15°'den 180°'ye taşımak gürültüyü 12 kat büyütür): çevirme açısı hatası 'kama' içinde görünür
    $bA = $(if ($Bk -eq 180.0) { 180.0 * [math]::Sign($q[6]) } else { $q[6] * $Bk }) + $q[4]; $aA = $q[5] * $Ak + $q[3]
    $pt = OkRot $pt 'Y' $bA @($q[0], 0.0, $q[2]); $nv = OkRot $nv 'Y' $bA $o
    $pt = OkRot $pt 'X' $aA @(0.0, $q[1], $q[2]); $nv = OkRot $nv 'X' $aA $o
    if ($nv[2] -le 0.2) { throw "model: yüz yukarı bakmıyor (nokta $i)" }
    $zc = $pt[2] - ($nv[0] * ($n.X - $pt[0]) + $nv[1] * ($n.Y - $pt[1])) / $nv[2]
    if ($ucTip -eq 'kure') { return $zc + $ucR * (1 / $nv[2] - 1) }
    return $zc + $ucR * [math]::Sqrt($nv[0] * $nv[0] + $nv[1] * $nv[1]) / $nv[2]
}

function OkCoz([double[][]]$M, [double[]]$v) {
    # Küçük doğrusal sistem: Gauss eleme (kısmi pivot). PowerShell 5.1 için iki boyutlu dizi yerine satır dizileri.
    $k = $v.Count
    $a = New-Object 'double[][]' $k
    for ($i = 0; $i -lt $k; $i++) { $a[$i] = New-Object 'double[]' ($k + 1); for ($j = 0; $j -lt $k; $j++) { $a[$i][$j] = $M[$i][$j] }; $a[$i][$k] = $v[$i] }
    for ($c = 0; $c -lt $k; $c++) {
        $p = $c
        for ($i = $c + 1; $i -lt $k; $i++) { $ai = $a[$i]; $ap = $a[$p]; if ([math]::Abs($ai[$c]) -gt [math]::Abs($ap[$c])) { $p = $i } }
        $ap = $a[$p]
        if ([math]::Abs($ap[$c]) -lt 1e-12) { throw 'model çözülemedi (ölçümler yetersiz)' }
        if ($p -ne $c) { $tmp = $a[$c]; $a[$c] = $a[$p]; $a[$p] = $tmp }
        $rc = $a[$c]
        for ($i = 0; $i -lt $k; $i++) {
            if ($i -eq $c) { continue }
            $ri = $a[$i]
            $fk = $ri[$c] / $rc[$c]
            for ($j = $c; $j -le $k; $j++) { $ri[$j] = $ri[$j] - $fk * $rc[$j] }
        }
    }
    $s = New-Object 'double[]' $k
    for ($i = 0; $i -lt $k; $i++) { $ri = $a[$i]; $s[$i] = $ri[$k] / $ri[$i] }
    return , $s
}

function OtoKal-Hesapla-Ic([hashtable]$z, [double]$T, [hashtable]$ofs, [double]$p4002, [double[]]$tekrar, [double]$farkMax, [string]$ucTip = 'duz', [double]$ucR = 1.5) {
    # Saf hesap (Eding'siz test edilebilir). $z[i] = nokta i'nin ortalama Z'si (iş koordinatı)
    $rad = [math]::PI / 180
    $R = $OkR; $d = $OkD; $teta = $OkTeta
    # --- 1) Kapalı form başlangıç tahmini
    $ust = @{ C = (($z[0] + $z[1] + $z[2] + $z[3] + $z[4]) / 5); SX = (($z[1] - $z[2]) / (2 * $R)); SY = (($z[3] - $z[4]) / (2 * $R)) }
    $alt = @{ C = (($z[13] + $z[14] + $z[15] + $z[16] + $z[17]) / 5); SX = (($z[14] - $z[15]) / (2 * $R)); SY = (($z[16] - $z[17]) / (2 * $R)) }
    $sAp = ($z[6] - $z[5]) / (2 * $d); $sAm = ($z[8] - $z[7]) / (2 * $d)
    $sBp = ($z[10] - $z[9]) / (2 * $d); $sBm = ($z[12] - $z[11]) / (2 * $d)
    if ([math]::Abs($sAp - $sAm) -lt 0.2 -or [math]::Abs($sBp - $sBm) -lt 0.2) { throw 'A/B eğik ölçümleri birbirine çok yakın: eksen dönmedi mi, temas noktası mı kaydı?' }
    $ya0 = -$d + ($z[7] - $z[5]) / ($sAp - $sAm)
    $xb0 = -$d + ($z[11] - $z[9]) / ($sBp - $sBm)
    $gA0 = (([math]::Atan($sAp) - [math]::Atan($sAm)) / $rad / 2) / $teta
    $gB0 = (([math]::Atan($sBp) - [math]::Atan($sBm)) / $rad / 2) / $teta
    $t0 = [math]::Atan($ust.SX) / $rad; $t180 = [math]::Atan($alt.SX) / $rad
    $u0 = [math]::Atan($ust.SY) / $rad; $u180 = [math]::Atan($alt.SY) / $rad
    $zu = $ust.C + $ust.SX * $xb0 + $ust.SY * $ya0; $zl = $alt.C + $alt.SX * $xb0 + $alt.SY * $ya0
    # Yönler modelin dönme işaretine göre: Y etrafında +açı x-eğimini (-) yapar, X etrafında +açı y-eğimini (+) yapar
    $q = [double[]]@($xb0, $ya0, (($zu + $zl - $T) / 2), (($u0 + $u180) / 2), (-($t0 + $t180) / 2), $gA0, (-$gB0), (($zu - $zl) / 2), (-($t0 - $t180)), (($u0 - $u180) / 2))
    # --- 2) Model uydurma (Gauss-Newton, 18 ölçüm / 10 bilinmeyen)
    $N = $OkNoktalar.Count; $P = $q.Count
    $adim = @(1e-4, 1e-4, 1e-4, 1e-3, 1e-3, 1e-5, 1e-5, 1e-4, 1e-3, 1e-3)
    $model = { param($qq) $out = New-Object 'double[]' $N; for ($i = 0; $i -lt $N; $i++) { $out[$i] = OkModel $qq $i $T $ucTip $ucR }; , $out }
    $rms = 0
    for ($it = 0; $it -lt 12; $it++) {
        $f0 = & $model $q
        $res = New-Object 'double[]' $N; $ss = 0
        for ($i = 0; $i -lt $N; $i++) { $res[$i] = $z[$i] - $f0[$i]; $ss += $res[$i] * $res[$i] }
        $rms = [math]::Sqrt($ss / $N)
        $jak = New-Object 'double[][]' $P
        for ($j = 0; $j -lt $P; $j++) {
            $q2 = [double[]]$q.Clone(); $q2[$j] += $adim[$j]
            $f1 = & $model $q2
            $jak[$j] = New-Object 'double[]' $N
            for ($i = 0; $i -lt $N; $i++) { $jak[$j][$i] = ($f1[$i] - $f0[$i]) / $adim[$j] }
        }
        $M = New-Object 'double[][]' $P; $v = New-Object 'double[]' $P
        for ($a1 = 0; $a1 -lt $P; $a1++) {
            $M[$a1] = New-Object 'double[]' $P
            for ($b1 = 0; $b1 -lt $P; $b1++) { $s = 0; for ($i = 0; $i -lt $N; $i++) { $s += $jak[$a1][$i] * $jak[$b1][$i] }; $M[$a1][$b1] = $s }
            $s = 0; for ($i = 0; $i -lt $N; $i++) { $s += $jak[$a1][$i] * $res[$i] }; $v[$a1] = $s
        }
        $dq = OkCoz $M $v
        $buyukAdim = 0.0   # 0.0: [math]::Max(0, double) tamsayı aşırı yüklemesini seçer (KL-02)
        for ($j = 0; $j -lt $P; $j++) { $q[$j] += $dq[$j]; $buyukAdim = [math]::Max($buyukAdim, [math]::Abs($dq[$j])) }
        if ($buyukAdim -lt 1e-7) { break }
    }
    $f0 = & $model $q; $ss = 0; $artikMax = 0.0
    for ($i = 0; $i -lt $N; $i++) { $e = $z[$i] - $f0[$i]; $ss += $e * $e; $artikMax = [math]::Max($artikMax, [math]::Abs($e)) }
    $rms = [math]::Sqrt($ss / $N)
    # --- 3) Düzeltmeler (iş koordinatından G54'e)
    #  A sıfırı: B0'da üst yüz düz olacak şekilde (eA + c); her iki kinematik zincirde de doğru tanım
    $xb = $q[0]; $ya = $q[1]; $zEksen = $q[2]
    $dA = ($q[3] + $q[9]) / $q[5]          # komut biriminde: yeni sıfır = eski - dA
    $dB = $q[4] / $q[6]
    $tekrarAralik = if ($tekrar.Count) { ($tekrar | Measure-Object -Maximum).Maximum - ($tekrar | Measure-Object -Minimum).Minimum } else { 0 }
    return @{
        dX = $xb; dY = $ya; dZ = $zEksen; dA = $dA; dB = $dB
        X = ($ofs.X + $xb); Y = ($ofs.Y + $ya); A = ($ofs.A - $dA); B = ($ofs.B - $dB); P4002 = ($p4002 - $zEksen)
        OlcA = [math]::Abs($q[5]); OlcB = [math]::Abs($q[6]); M = $q[7]; Kama = $q[8]; DiskEgikA = $q[9]
        Rms = $rms; ArtikMax = $artikMax; Tekrar = $tekrarAralik; Fark = $farkMax; T = $T; Q = $q
    }
}

function OtoKal-Sim-Uret([string]$nc, [double]$T) {
    # Gerçek ölçüm programını satır satır "çalıştırır" ve X5 Canlı Simülasyon'un okuyabileceği düz G-koda çevirir:
    #  #değişken ve [ifade] -> sayı, G38.2 -> ideal makinede temas Z'sine G1, if/errmsg -> yorum, GOSUB user_1 -> M100.
    # Satır sırası ve hareketler gerçek programla birebir aynıdır (senkron).
    # Simülasyonun eksen yönleri: A ve B bu modelin tersine döner -> gA = gB = -1. Simülasyondaki uç sivri -> yarıçap 0.
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $ideal = [double[]]@(0, 0, 0, 0, 0, -1, -1, 0, 0, 0)
    $deg = @{ 5063 = 0.0; 5067 = 0.0 }
    $dt = New-Object System.Data.DataTable
    $hesap = {
        param([string]$s)
        $s2 = [regex]::Replace($s, '#(\d+)', { param($m) $k = [int]$m.Groups[1].Value; if ($deg.ContainsKey($k)) { '(' + ([double]$deg[$k]).ToString('R', $ci) + ')' } else { '0' } })
        $s2 = $s2.Replace('[', '(').Replace(']', ')')
        return [double]$dt.Compute($s2, '')
    }
    $nokta = 0; $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    $satirlar = $nc -split "`r?`n"
    for ($k = 0; $k -lt $satirlar.Count; $k++) {
        $ln = $satirlar[$k].TrimEnd(); $u = $ln.Trim()
        if ($k -eq 1 -and $u -like '(PrimerMill OTOMATIK*') { & $L ($u -replace '^\(', '(SIMULASYON - ') ; & $L '(X5 Canli Simulasyon icin: G38.2 yerine ideal makinede temas noktasina G1, degiskenler sayiya cevrildi)'; continue }
        $pm = [regex]::Match($u, '^\(P(\d+) '); if ($pm.Success) { $nokta = [int]$pm.Groups[1].Value }
        if ($u -match '^#(\d+)\s*=\s*(.+)$') { $deg[[int]$Matches[1]] = & $hesap $Matches[2]; & $L "($u  ->  $(& $f $deg[[int]$Matches[1]]))"; continue }
        if ($u -match '^(if\s|endif|errmsg|msg\s)') { continue }
        if ($u -match '^GOSUB\s+user_1') { & $L 'M100 (GOSUB user_1: takim boyu sensorde)'; continue }
        # [ifade] -> sayı
        $u2 = [regex]::Replace($u, '\[[^\[\]]*(\[[^\[\]]*\][^\[\]]*)*\]', { param($m) & $f (& $hesap $m.Value) })
        $g = [regex]::Match($u2, '^G38\.2\s+Z(-?[\d.]+)\s+F([\d.]+)')
        if ($g.Success) {
            $hedef = [double]::Parse($g.Groups[1].Value, $ci); $fd = $g.Groups[2].Value
            $temas = OkModel $ideal $nokta $T 'duz' 0
            if ($temas -ge $hedef) { & $L "G1 Z$(& $f $temas) F$fd (G38.2 Z$(& $f $hedef) -> TEMAS P$nokta)"; $deg[5063] = $temas; $deg[5067] = 1 }
            else { & $L "G1 Z$(& $f $hedef) F$fd (G38.2 -> TEMAS YOK)"; $deg[5063] = $hedef; $deg[5067] = 0 }
            continue
        }
        & $L $u2
    }
    return $sb.ToString()
}

# ================= KALDIĞI YERDEN DEVAM =================
# Elektrik kesilirse / basınç düşüp iş yarıda kalırsa: panel işin hangi satırda olduğunu sürekli devam.json'a yazar.
# Sonra BAŞLAT'ta "kaldığı yerden" seçilince işin o noktasından devam eden yeni bir program üretilir.
$DevamDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'devam.json')
$script:DevamHarita = $null      # devam programı çalışırken: @{ Bas = devam dosyasında asıl işin başladığı satır; Orijinal = asıl dosyadaki karşılığı }
$script:DevamSonYazma = [DateTime]::MinValue
function Devam-Oku {
    try {
        if (-not [System.IO.File]::Exists($DevamDosyasi)) { return $null }
        $k = [System.IO.File]::ReadAllText($DevamDosyasi) | ConvertFrom-Json
        if (-not $k.Kaynak -or -not [System.IO.File]::Exists([string]$k.Kaynak) -or [int]$k.Satir -lt 1) { return $null }
        return $k
    } catch { return $null }
}
function Devam-Sil { try { if ([System.IO.File]::Exists($DevamDosyasi)) { [System.IO.File]::Delete($DevamDosyasi) } } catch { } }

# Asıl programdan devam programı üretir. $mod:
#   'tam'     (önerilen) durduğu yerin ~10 sn gerisinden: güvenli yükseklikte X/Y'ye gider, yavaşça o noktanın Z'sine iner
#   'yakin'   ~1 dk geriden, aynı yaklaşma
#   'guvenli' son GOSUB Z_SAFE satırından (işlem başı). Bu CAM çıktısında bir işlem 20 000+ satır sürebildiği için
#             eskiden 'kaldığı yerden' seçilince işin büyük kısmı (ilk işlemde neredeyse baştan) yeniden kazınıyordu.
function Devam-NC-Uret([string]$kaynak, [int]$satir, [string]$mod, $analiz) {
    $L = [System.IO.File]::ReadAllLines($kaynak)
    $idx = [math]::Min($L.Length - 1, [math]::Max(0, $satir - 1))
    # 1) güvenli başlangıç: durduğu satırdan önceki son GOSUB Z_SAFE
    $r = 0
    for ($i = $idx; $i -ge 0; $i--) { if ($L[$i] -match '(?i)^\s*(N\d+\s*)?GOSUB\s+Z_SAFE\b') { $r = $i; break } }
    $q = -1
    if (($mod -eq 'yakin' -or $mod -eq 'tam') -and $analiz -and $analiz.Kumulatif.Length -eq $L.Length) {
        $geriSn = 60; if ($mod -eq 'tam') { $geriSn = 10 }
        $hedef = $analiz.Kumulatif[$idx] - $geriSn
        for ($i = $r + 1; $i -le $idx; $i++) { if ($analiz.Kumulatif[$i] -ge $hedef) { $q = $i; break } }
    } elseif ($mod -eq 'tam' -and $idx - 40 -gt $r) {
        $q = $idx - 40   # süre analizi yoksa ~40 satır geriden
    }
    $son = if ($q -gt $r) { $q } else { $r }      # bu satıra kadar (hariç) modal durum toplanır
    # 2) modal durum: frez, devir, iş mili, soğutma, ilerleme, A/B, X/Y/Z, hareket kipi
    $frez = 0; $S = 0; $milAcik = $false; $m7 = $false; $m8 = $false; $ilerle = 1000.0; $A = 0.0; $B = 0.0; $X = $null; $Y = $null; $Z = $null; $G = 0
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    for ($i = 0; $i -lt $son; $i++) {
        $ln = ($L[$i] -replace '\(.*?\)', '' -replace ';.*$', '').Trim().ToUpperInvariant()
        if (-not $ln -or $ln -match '^(N\d+\s*)?(GOSUB|SUB|MSG|IF|ENDIF|ELSE|%)') { continue }
        $kelimeler = [regex]::Matches($ln, '([A-Z])\s*(-?\d*\.?\d+)')
        $m6 = $false; $tYeni = $null
        foreach ($k in $kelimeler) {
            $h = $k.Groups[1].Value; $v = [double]::Parse($k.Groups[2].Value, $ci)
            switch ($h) {
                'G' { $gi = [int]$v; if ($gi -le 3 -and $v -eq [math]::Floor($v)) { $G = $gi } }
                'M' { switch ([int]$v) { 3 { $milAcik = $true } 4 { $milAcik = $true } 5 { $milAcik = $false } 6 { $m6 = $true } 7 { $m7 = $true } 8 { $m8 = $true } 9 { $m7 = $false; $m8 = $false } } }
                'T' { $tYeni = [int]$v }
                'S' { $S = $v }
                'F' { $ilerle = $v }
                'A' { $A = $v } 'B' { $B = $v } 'X' { $X = $v } 'Y' { $Y = $v } 'Z' { $Z = $v }
            }
        }
        if ($m6 -and $null -ne $tYeni) { $frez = $tYeni }
    }
    $fmt = { param($v) ([double]$v).ToString('0.####', $ci) }
    $C = New-Object System.Collections.Generic.List[string]
    $C.Add('%')
    # KD-04: dosya adındaki ( ) ; ve ASCII dışı karakterler yorumu erken kapatıp kalıntıyı Eding'e kod olarak gönderebilir
    $adGuvenli = [regex]::Replace([System.IO.Path]::GetFileName($kaynak), '[^A-Za-z0-9_.\- ]', '_')
    $C.Add("(PrimerMill DEVAM: $adGuvenli satir $($son + 1) / $($L.Length), mod $mod)")
    $C.Add('G0 G17 G40 G49 G54 G80 G90')
    $C.Add('M9'); $C.Add('M5')
    $C.Add('GOSUB Z_SAFE'); $C.Add('GOSUB AZXY_SAFE')
    $C.Add('G0 B0.0')
    if ($frez -gt 0) { $C.Add("T$frez M6") }
    if ($milAcik -and $S -gt 0) { $C.Add("S$(& $fmt $S) M3") }
    if ($m7) { $C.Add('M7') }; if ($m8) { $C.Add('M8') }
    $C.Add('GOSUB Z_SAFE'); $C.Add('GOSUB AZXY_SAFE')
    $C.Add("G0 A$(& $fmt $A) B$(& $fmt $B)")
    $C.Add("G90 F$(& $fmt $ilerle)")
    if ($q -gt $r -and $null -ne $X -and $null -ne $Y -and $null -ne $Z) {
        # Yakın nokta: iş mili yukarıdayken X/Y'ye gider, sonra yavaşça kaldığı Z'ye iner
        $C.Add("G0 X$(& $fmt $X) Y$(& $fmt $Y)")
        $C.Add("G1 Z$(& $fmt $Z) F$(& $fmt ([math]::Min($ilerle, 600)))")
        $C.Add("G$G Z$(& $fmt $Z) F$(& $fmt $ilerle)")
        $bas = $q
    } else { $bas = $r }
    $harita = @{ Bas = $C.Count + 1; Orijinal = $bas + 1 }
    for ($i = $bas; $i -lt $L.Length; $i++) { $C.Add($L[$i]) }
    $hedef = [System.IO.Path]::Combine($IsKlasor, ([System.IO.Path]::GetFileNameWithoutExtension($kaynak) -replace '_devam\d*$', '') + '_devam.nc')
    [System.IO.File]::WriteAllLines($hedef, $C)
    $tekrar = 0; if ($analiz -and $analiz.Kumulatif.Length -eq $L.Length) { $tekrar = $analiz.Kumulatif[$idx] - $analiz.Kumulatif[[math]::Max(0, $bas - 1)] }
    return @{ Yol = $hedef; Harita = $harita; Takim = $frez; Satir = $bas + 1; Tekrar = $tekrar }
}

# --- Panel tercihleri: panel_ayarlar.ini ---
$TercihDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'panel_ayarlar.ini')
$script:Tercih = @{ OtomatikHazirlik = '1'; GeriSayim = '5'; Dansci = '1'; Koordinat = 'IS'; ModSor = '1'; EdingSifirla = '1'; EdingGizli = '1'; BlokSor = '1'; SanalKlavye = '1'; TamEkran = '1'; WinBaslangic = '1' }
function Tercih-Oku {
    if (-not [System.IO.File]::Exists($TercihDosyasi)) { return }
    foreach ($l in [System.IO.File]::ReadAllLines($TercihDosyasi)) {
        $m = [regex]::Match($l, '^\s*(\w+)\s*=\s*(.*?)\s*$')
        if ($m.Success) { $script:Tercih[$m.Groups[1].Value] = $m.Groups[2].Value }
    }
}
function Tercih-Yaz {
    try { [System.IO.File]::WriteAllLines($TercihDosyasi, @($script:Tercih.Keys | Sort-Object | ForEach-Object { "$_=$($script:Tercih[$_])" })) } catch { }
}

# UZ-03: uzaktan erişim PIN'i en az 6 hane; boş PIN asla "PIN'siz" demek değildir. Kısa/boşsa rastgele yenisi üretilir.
function Yeni-Pin {
    $r = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $b = New-Object byte[] 4; $r.GetBytes($b)
    return ([BitConverter]::ToUInt32($b, 0) % 900000 + 100000).ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

# --- KALİBRASYON ---
$ParamTanim = [ordered]@{
    4000 = 'Alma Z (pens kapanır)'; 4001 = 'Yaklaşma Z'; 4002 = 'Sensör yüksekliği'; 4003 = 'Sensöre yavaş yaklaşma Z'
    4004 = 'Sensör ölçüm alt sınırı'; 4005 = 'Aşınma sınırı (mm)'; 4006 = 'Takım algılama (1 açık / 0 kapalı)' }

# --- FREZ YUVALARI: macro.cnc bunları kalıcı değişkenlerden okur (G53 makine koordinatı) ---
#   #4010 X (hepsi)  #4011..#4016 T1..T6 Y  #4017 A  #4018 B  ·  alma Z = #4000, bırakma = #4000+1
$RafTanim = [ordered]@{ 4010 = 'Yuva X'; 4011 = 'T1 Y'; 4012 = 'T2 Y'; 4013 = 'T3 Y'; 4014 = 'T4 Y'; 4015 = 'T5 Y'; 4016 = 'T6 Y'; 4017 = 'Yuva A'; 4018 = 'Yuva B'; 4020 = 'Sensör X'; 4021 = 'Sensör Y'; 4030 = 'Frez modu (1 manuel)'; 4031 = 'Değişim X'; 4032 = 'Değişim Y'; 4033 = 'Değişim Z (0 en üst)' }
# Yuva aralığı (T1'e göre, mm): Bloomden X5 magazini
$RafAralik = @{ 1 = 0; 2 = 12; 3 = 24; 4 = 54; 5 = 66; 6 = 78 }
# "Doğrulanmış değerlere dön" ile (yalnız operatör onayıyla) yazılacak değerler: 22.10.2026'da makinede doğrulanan T1 noktası.
# MAKİNEDE DOĞRULA (K5/MC-02): bu değerler üreticinin macro_X5_orijinal.cnc PickTool1 değerlerinden farklı
#   (orijinal T1: Y -88.966, A 23.2, B -1) ve alma Z -45, cnc.ini'deki #4000 = -46.9'dan farklı. Sayılar bilerek değiştirilmedi.
$RafVarsayilan = @{ X = -125.557; Y1 = -89.166; A = 23.0; B = 0.0; AlmaZ = -45.0 }
$RafSensorXFark = 72.25                                     # sensör varsayılanı: G54 X - 72.25, G54 Y
$RafDegisimVarsayilan = @{ X = -64.25; Y = -52.0; Z = 0.0 }  # manuel değişim noktası varsayılanı (makinenin ortası, en üst)

# K5 (GV-07/ED-05/MC-01): Raf-Kontrol hiçbir şey YAZMAZ. 0 okunan yuva/sensör/değişim değişkeni "kayıtlı değil" sayılır
# (Eding henüz yüklememiş ya da okuma hatası da 0 döndürür); günlüğe yazılır, durum satırında uyarı çıkar ve
# BAŞLAT / M6 / Takım değiştir / Takım ölç engellenir. Varsayılanlar yalnız "Doğrulanmış değerlere dön" düğmesiyle yazılır.
$RafZorunlu = @(4010, 4011, 4020, 4021, 4031, 4032)

# Üretici disk kalibrasyonu: makinenin kendi P:\CNC\cnc.ini dosyasında kayıtlıydı (G54 = disk merkezi ve A/B sıfırı)
$UreticiG54 = [ordered]@{ X = -53.4925; Y = -53.456; Z = 208.8975; A = 20.209; B = -2.3508 }

$YedekKlasoru = [System.IO.Path]::Combine($ScriptKlasor, 'yedekler')

# --- Yuva geometrisi: macro.cnc'den okunur (bulunamazsa Bloomden X5 değerleri) ---
$script:YuvaX = 72.25
$TakimY = [ordered]@{ 'T1' = -39; 'T2' = -27; 'T3' = -15; 'Sensör' = 0; 'T4' = 15; 'T5' = 27; 'T6' = 39 }
$script:YuvaMutlak = @{}   # macro'da G53 ile sabit yazılmış yuvalar: T1 -> @{X;Y;A;B}
function Yuva-Geometrisi-Oku {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    if (-not [System.IO.File]::Exists($yol)) { return 'macro.cnc bulunamadı, varsayılan değerler kullanılıyor.' }
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $metin = $sr.ReadToEnd(); $sr.Close()
    } catch { return "macro.cnc okunamadı: $($_.Exception.Message)" }
    $mx = [regex]::Match($metin, '#5221\s*-\s*([0-9.]+)')
    if ($mx.Success) { $script:YuvaX = [double]::Parse($mx.Groups[1].Value, [System.Globalization.CultureInfo]::InvariantCulture) }
    for ($n = 1; $n -le 6; $n++) {
        $blok = [regex]::Match($metin, "(?ism)^[ \t]*sub\s+PickTool$n\b(.*?)^[ \t]*endsub")
        if ($blok.Success) {
            $ci = [System.Globalization.CultureInfo]::InvariantCulture
            $mxy = [regex]::Match($blok.Groups[1].Value, '(?i)g53[^\r\n]*?\bx(-?[0-9.]+)\s*y(-?[0-9.]+)')
            $mab = [regex]::Match($blok.Groups[1].Value, '(?i)g53[^\r\n]*?\ba(-?[0-9.]+)\s*b(-?[0-9.]+)')
            if ($mxy.Success) {
                $script:YuvaMutlak["T$n"] = @{ X = [double]::Parse($mxy.Groups[1].Value, $ci); Y = [double]::Parse($mxy.Groups[2].Value, $ci)
                    A = $(if ($mab.Success) { [double]::Parse($mab.Groups[1].Value, $ci) } else { $null }); B = $(if ($mab.Success) { [double]::Parse($mab.Groups[2].Value, $ci) } else { $null }) }
                continue
            }
            $my = [regex]::Match($blok.Groups[1].Value, '#5222\s*([+-])\s*([0-9.]+)')
            if ($my.Success) {
                $v = [double]::Parse($my.Groups[2].Value, [System.Globalization.CultureInfo]::InvariantCulture)
                $TakimY["T$n"] = if ($my.Groups[1].Value -eq '-') { -$v } else { $v }
            }
        }
    }
    $yaz = foreach ($k in $TakimY.Keys) { if ($script:YuvaMutlak[$k]) { "$k G53 Y$($script:YuvaMutlak[$k].Y)" } else { "$k $($TakimY[$k])" } }
    return ("macro.cnc'den okundu:  X mesafesi {0}   ·   " -f $script:YuvaX) + ($yaz -join '  ')
}

function Makro-AltProgramlari {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    $isimler = @{}
    $script:MakroDurum = ''
    if (-not [System.IO.File]::Exists($yol)) { $script:MakroDurum = "macro.cnc bulunamadı: $yol"; return $isimler }
    try {
        # Eding dosyayı açık tutuyor olabilir: paylaşımlı okuma
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs)
        while ($null -ne ($s = $sr.ReadLine())) {
            $m = [regex]::Match($s, '^\s*sub\s+(\w+)', 'IgnoreCase')
            if ($m.Success) { $isimler[$m.Groups[1].Value.ToLower()] = $true }
        }
        $sr.Close()
        if ($isimler.Count -eq 0) { $script:MakroDurum = "macro.cnc okundu ama içinde alt program (sub) yok: $yol" }
    } catch { $script:MakroDurum = "macro.cnc okunamadı ($($_.Exception.Message)): $yol" }
    return $isimler
}
