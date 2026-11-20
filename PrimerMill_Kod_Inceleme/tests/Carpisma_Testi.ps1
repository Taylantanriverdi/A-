# Carpisma_Testi.ps1 - çarpışma incelemesi (takım / B ünitesi, disk tutucu; makro sürüm 6):
#   1) uç boşluğu / tutucu boşluğu hesabı (Egim-Aci, Bosluk-Hesapla, Uc-Boslugu)
#   2) güvenli hareket sırası (B-Duz-Aci, Guvenli-Sira, Park-Satirlari): eğik diskte X/Y yok, büyük B dönüşü disk dışında
#   3) devam programı başlığı: X/Y disk DÜZ iken, A eğimi X/Y'den sonra; B sensörde
#   4) macro.cnc: Z ile A/B ya da X/Y ile A/B aynı g0 satırında yok (izinli istisna listesi), home_all sırası, G30 yok
#   5) CarpismaAnaliz taraması (eğim, B180 dönüşü, A sınırı)
#   6) EdingSim uçtan uca: HOME öncesi geri çekilme sırası, Kol düz (disk ters), çarpışma bekçisi (uzun frez -> iş duraklar,
#      DURDUR / DEVAM), BAŞLAT reddi (iş milindeki frez çok uzun)
# Çalıştırma: pwsh -NoProfile -File tests/Carpisma_Testi.ps1 [-Kaynak teslim/PrimerMill]   PS 5.1 uyumlu.
param([string]$Kaynak = '')
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'Denetleyici.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
$Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path
Write-Host "Kaynak: $Kaynak"
$lib = [System.IO.Path]::Combine($Kaynak, 'lib')
$cs = @('lib/Kayit.cs', 'lib/NcAnaliz.cs', 'lib/WebSunucu.cs', 'lib/EdingSim.cs', 'ui/PrimerVeri.cs') | ForEach-Object { [System.IO.Path]::Combine($Kaynak, $_) }
if (-not ('PrimerUI.MakineDurumu' -as [type])) { Add-Type -Path $cs }

$kok = Gecici-Klasor 'pm_carpisma'
$PanelKlasor = $Kaynak
$ScriptKlasor = [System.IO.Path]::Combine($kok, 'demo_calisma')
$EdingKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'CNC')
$IsKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'isler')
[void][System.IO.Directory]::CreateDirectory($EdingKlasor); [void][System.IO.Directory]::CreateDirectory($IsKlasor)
[System.IO.File]::Copy([System.IO.Path]::Combine($Kaynak, 'demo', 'macro.cnc'), [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'))
$AktifIsAdi = 'AKTIF_IS.nc'
$AyarliTakimlar = @(1, 2, 3, 4, 5, 6)
$script:Sade = $true
$MakineBilgisayari = $false
$script:Demo = $true
$script:Yonetici = $false
[Kayit]::Ac([System.IO.Path]::Combine($ScriptKlasor, 'loglar'))
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'FrezOmru', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'Demo')) { . ([System.IO.Path]::Combine($lib, "$m.ps1")) }
. Ui-Sahte-Yukle
$script:ApiHazir = $true
[Eding]::SimSifirla()
[Eding]::SimHizCarpani = 25.0
Tercih-Baslangic

function Bekle-Kosul([scriptblock]$kosul, [double]$sn = 10) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 20 }
    return [bool](& $kosul)
}
function Tik([int]$n = 1) { for ($i = 0; $i -lt $n; $i++) { Zamanlayici-Tik } }
function Ilk([string[]]$l, [string]$desen) { for ($i = 0; $i -lt $l.Length; $i++) { if ($l[$i] -match $desen) { return $i } }; return -1 }
function Log-Komutlar {
    # panel günlüğündeki "KOMUT> satır" kayıtları (Satirlar-Gonder), sırayla
    $fs = New-Object System.IO.FileStream([Kayit]::Dosya, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $sr = New-Object System.IO.StreamReader($fs); $t = $sr.ReadToEnd(); $sr.Close()
    return @([regex]::Matches($t, 'KOMUT> (.*?)   ->') | ForEach-Object { $_.Groups[1].Value })
}

# ================================================================== 1) hesap
Bolum '1) Uç boşluğu / tutucu boşluğu'
Yakin 13.0 (Bosluk-Hesapla 0 56 13 0) 1e-9 'düz disk: en üst nokta H'
Yakin (56 * [math]::Sin(26 * [math]::PI / 180) + 13 * [math]::Cos(26 * [math]::PI / 180) + 3) (Bosluk-Hesapla 26 56 13 3) 1e-9 'A 26° (makine A 46): R·sin + H·cos + pay'
Yakin 59.0 (Bosluk-Hesapla 90 56 13 3) 1e-9 'dikey disk (B90): R + pay'
Yakin 59.0 (Bosluk-Hesapla 120 56 13 3) 1e-9 '90° üstü 90 sayılır'
Yakin 0.0 (Egim-Aci 0 180) 1e-9 'B180 düz (ters yüz)'
Yakin 25.0 (Egim-Aci -25 0) 1e-9 'A -25 -> 25° eğim'
Yakin 15.0 (Egim-Aci 0 195) 1e-9 'B195 -> 15° eğim'
Yakin ([math]::Acos([math]::Cos(20 * [math]::PI / 180) * [math]::Cos(15 * [math]::PI / 180)) * 180 / [math]::PI) (Egim-Aci 20 15) 1e-9 'A20 B15 birleşik eğim'
# cnc.ini değerleri: #5163 3.8, G54 Z 208.8975, G92 Z -247.5345 -> iş Z = makine Z + 38.637
Yakin 42.437 (Uc-Boslugu 3.8 (3.8 + 38.637) 3.8) 1e-9 'uç boşluğu = #5163 + (iş Z - makine Z)'
Yakin 37.437 (Uc-Boslugu 3.8 (3.8 + 33.637) 3.8) 1e-9 '5 mm daha uzun frez -> 5 mm daha küçük uç boşluğu'
$script:Tercih.TutucuYaricap = '60'; $script:Tercih.TutucuYariYukseklik = 'abc'; $script:Tercih.CarpismaPayi = '-1'
$ay = Carpisma-Ayar
Esit 60.0 $ay.R 'Carpisma-Ayar: R ayardan'; Esit 13.0 $ay.H 'Carpisma-Ayar: geçersiz H -> varsayılan 13'; Esit 3.0 $ay.Pay 'Carpisma-Ayar: negatif pay -> varsayılan 3'
$script:Tercih.Remove('TutucuYaricap'); $script:Tercih.Remove('TutucuYariYukseklik'); $script:Tercih.Remove('CarpismaPayi')
$ay = Carpisma-Ayar
Dogru ($ay.R -eq 56 -and $ay.H -eq 13 -and $ay.Pay -eq 3) 'varsayılanlar R 56 · H 13 · pay 3'

# ================================================================== 2) sıra
Bolum '2) Güvenli hareket sırası'
Yakin -2.3508 (B-Duz-Aci 3.0 -2.3508) 1e-9 'B 3 -> en yakın düz -2.35'
Yakin 177.6492 (B-Duz-Aci 150.0 -2.3508) 1e-9 'B 150 -> en yakın düz 177.65 (ters yüz)'
Yakin 357.6492 (B-Duz-Aci 360.0 -2.3508) 1e-9 'B 360 -> 357.65 (sarılmış B)'
$s = Guvenli-Sira 180.0 -2.3508 @('G53 G0 X[#4020] Y[#4021]') @('G53 G0 A[#5224] B[#5225]') -2.3508 'G53 G0 X[#4020] Y[#4021]'
Esit 'G90 G53 G0 Z[#5163]' $s[0] 'sıra: 1. Z en üst'
Esit 'G53 G0 A[#5224]' $s[1] 'sıra: 2. A düz'
Esit 'G53 G0 B177.649' $s[2] 'sıra: 3. B en yakın düz açıya (yerinde, eğim azalır)'
Dogru ((Ilk $s '^G53 G0 X') -lt (Ilk $s '^G53 G0 B-2\.351')) 'disk ters: B180 dönüşü X/Y disk dışına (sensör) gittikten SONRA'
Dogru ((Ilk $s 'A\[#5224\] B\[#5225\]') -eq $s.Length - 1) 'hedef A/B en son'
foreach ($i in 0..($s.Length - 1)) { if ($s[$i] -match '\b[XY]' -and $s[$i] -match '\b[AB]') { Kaldi "X/Y ile A/B aynı satırda: $($s[$i])" } }
$s2 = Guvenli-Sira 0.0 -2.3508 @('G53 G0 X1 Y1') @() ([double]::NaN) 'G53 G0 X[#5181] Y[#5182]'
Esit 4 $s2.Length 'B zaten yakın düzde: Z, A, B -2.351, X/Y'
$p = Park-Satirlari
Esit 'G53 G90 G0 Z[#5163]|G53 G90 G0 A[#5224]|G53 G90 G0 X[#5181] Y[#5182]|G53 G90 G0 Z[#5183]|G53 G90 G0 A[#5184] B[#5185]' ($p -join '|') 'Park-Satirlari: Z, A düz, G30 X/Y, G30 Z, G30 A/B'
Dogru (-not (@($p) -contains 'G30')) 'park G30 kullanmaz'
foreach ($u in @(@('Kal-NC-Uret', { Kal-NC-Uret 16 2.0 1 }), @('OtoKal-NC-Uret', { OtoKal-NC-Uret 16 1 }))) {
    $l = ([string](& $u[1])).Replace("`r`n", "`n").Split("`n")
    Dogru (@($l | Where-Object { $_.Trim() -eq 'G30' }).Count -eq 0) "$($u[0]): program sonunda G30 yok"
    $iP = Ilk $l '^G53 G90 G0 X\[#5181\]'; $iA = Ilk $l '^G53 G90 G0 A\[#5224\]'; $iM = Ilk $l '^M30'
    Dogru ($iA -ge 0 -and $iA -lt $iP -and $iP -lt $iM) "$($u[0]): sıralı park (A düz -> köşe -> M30)"
}

# ================================================================== 3) devam başlığı
Bolum '3) Kaldığı yerden devam başlığı'
$zy = GKod-Girdi 'ZY2_45_kisa.nc'
$an = GKod-Analiz $zy
foreach ($mod in @('yakin', 'tam')) {
    $r = Devam-NC-Uret $zy 400 $mod $an
    $l = [System.IO.File]::ReadAllLines($r.Yol)
    $h = $l[0..($r.Harita.Bas - 2)]
    $iAz = -1; for ($i = 0; $i -lt $h.Length; $i++) { if ($h[$i] -eq 'GOSUB AZXY_SAFE') { $iAz = $i } }
    $iB = -1; for ($i = $iAz + 1; $i -lt $h.Length; $i++) { if ($h[$i] -match '^G0 B') { $iB = $i; break } }; $iXY = Ilk $h '^G0 X'; $iA = Ilk $h '^G0 A'; $iZ = Ilk $h '^G1 Z'
    Dogru ($iAz -ge 0 -and $iAz -lt $iB -and $iB -lt $iXY -and $iXY -lt $iA -and $iA -lt $iZ) "$mod : AZXY_SAFE -> G0 B (sensörde) -> G0 X Y (disk düz) -> G0 A (noktada) -> G1 Z ($iAz,$iB,$iXY,$iA,$iZ)"
    Dogru (@($h | Where-Object { $_ -match '^G0 A\S* B' }).Count -eq 0) "$mod : X/Y'den önce birleşik 'G0 A.. B..' yok"
}
$r = Devam-NC-Uret $zy 400 'guvenli' $an
$h = [System.IO.File]::ReadAllLines($r.Yol)[0..($r.Harita.Bas - 2)]
$iAz = -1; for ($i = 0; $i -lt $h.Length; $i++) { if ($h[$i] -eq 'GOSUB AZXY_SAFE') { $iAz = $i } }
Dogru ($iAz -ge 0 -and (Ilk $h '^G0 A') -gt $iAz -and (Ilk $h '^G0 X') -lt 0) 'güvenli: A/B sensörde (AZXY_SAFE sonrası), başlıkta X/Y yok'

# ================================================================== 4) macro.cnc
Bolum '4) macro.cnc hareket satırları'
$mk = [System.IO.File]::ReadAllLines([System.IO.Path]::Combine($Kaynak, 'demo', 'macro.cnc'))
# İzinli istisnalar (gerekçe): home_all içindeki üreticinin köşe hareketi; home sonrası, G30 köşesinde (disk/tutucu yarıçapı dışında)
$izinli = @('g0 g53 x-4.0 y-4.0 z-4.0 a4.0')
$sub = ''; $ihlal = 0
foreach ($ham in $mk) {
    $ln = ($ham -replace ';.*$', '').Trim(); $k = $ln.ToLowerInvariant()
    if ($k -match '^sub\s+(\w+)') { $sub = $Matches[1] }
    if ($k -notmatch '\bg0*[01](?!\d)' -or $k -match '^(msg|errmsg|warnmsg|dlgmsg)') { continue }
    $ax = @{}; foreach ($m in [regex]::Matches($k, '(?<![a-z#])([xyzab])\s*(\[|-?\d|#)')) { $ax[$m.Groups[1].Value] = $true }
    $zab = $ax.z -and ($ax.a -or $ax.b); $xyab = ($ax.x -or $ax.y) -and ($ax.a -or $ax.b)
    if ($zab -or $xyab) {
        if ($izinli -contains $k) { Bilgi "izinli: [$sub] $ln" } else { $ihlal++; Kaldi "[$sub] aynı satırda Z ya da X/Y ile A/B: $ln" }
    }
}
Dogru ($ihlal -eq 0) "Z+A/B ya da X/Y+A/B satırı yok (izinli $($izinli.Count))"
$tum = ($mk -join "`n")
$ha = [regex]::Match($tum, '(?is)\nsub home_all\b(.*?)\nendsub').Groups[1].Value
$sira = @([regex]::Matches($ha, '(?im)^\s*(gosub home_[xyzab]|g53 g90 g0 a\[#5224\])') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() -replace '\s+', ' ' })
Esit 'gosub home_z|gosub home_a|g53 g90 g0 a[#5224]|gosub home_x|gosub home_y|gosub home_b|gosub home_b' ($sira -join '|') 'home_all: Z, A + düz, X, Y, B (sonra köşede B tekrar)'
Dogru ($ha -notmatch '(?im)^\s*g30\s*$' -and $ha -match '(?im)^\s*gosub pm_park') 'home_all sonu: G30 yerine pm_park'
$pk = [regex]::Match($tum, '(?is)\nsub pm_park\b(.*?)\nendsub').Groups[1].Value.Trim() -split '\s*\r?\n\s*'
Esit 'g53 g90 g0 z[#5163]|g53 g90 g0 a[#5224]|g53 g90 g0 x[#5181] y[#5182]|g53 g90 g0 z[#5183]|g53 g90 g0 a[#5184] b[#5185]' (($pk | Where-Object { $_ -notmatch '^;' }) -join '|') 'pm_park sırası'
foreach ($sb in @('change_tool', 'manual_change')) {
    $g = [regex]::Match($tum, "(?is)\nsub $sb\b(.*?)\nendsub").Groups[1].Value
    $iA = $g.IndexOf('g53 g90 g0 a[#5224]'); $iS = $g.IndexOf('g53 g90 g0 x[#4020] y[#4021]'); $iB = $g.IndexOf('g53 g90 g0 b[#5225]')
    Dogru ($iA -ge 0 -and $iA -lt $iS -and $iS -lt $iB) "$sb : A düz -> sensör X/Y -> B (disk dışında)"
}
Dogru ($tum -match '(?m)^\s*#4038 = 6\s*$') 'pm_surum 6'
Esit 6 $BeklenenMakroSurum 'panel makro sürüm 6 bekler'

# ================================================================== 5) tarama
Bolum '5) CarpismaAnaliz taraması'
function Tara([string[]]$l) { return [CarpismaAnaliz]::Tara($l, 59, -72.25, 0, 53.54, 54.36, -25.05, 0, -53.1425, -53.456, 20.209, -2.3508, -25.806, 25.794) }
$c = Tara @('GOSUB Z_SAFE', 'GOSUB AZXY_SAFE', 'G0 B0', 'T1 M6', 'GOSUB AZXY_SAFE', 'G0 X0 Y0', 'G0 A20', 'G1 Z5 F100', 'GOSUB Z_SAFE', 'GOSUB AZXY_SAFE', 'T2 M6', 'GOSUB AZXY_SAFE', 'G0 X10 Y0', 'G1 Z5', 'M30')
Yakin 0 $c.KalanEgim[0] 1e-9 'başlangıç takımı (M6 öncesi): eğim yok'
Esit 1 $c.Takim[5] 'T1 parçası'
Yakin 20 $c.KalanEgim[4] 1e-9 'T1: disk üstünde 20° eğim'
Esit 7 $c.KalanSatir[4] 'T1: eğim satırı 7 (G0 A20, eşit eğimde en erken)'
Yakin 20 $c.Egim[9] 1e-9 'AZXY_SAFE disk üstünde: A yerinde düzlenirken 20° sayılır'
Esit 1 $c.Takim[10] 'T2 M6 satırı T1 parçasında'
Yakin 0 $c.KalanEgim[11] 1e-9 'T2: eğimsiz'
$c = Tara @('GOSUB AZXY_SAFE', 'G0 X0 Y0', 'G0 B180')
Yakin 90 $c.EnBuyukEgim 1e-9 'disk ortasında B0 -> B180: dikey geçer (90°)'
$c = Tara @('GOSUB AZXY_SAFE', 'G0 B180', 'G0 X0 Y0', 'G1 Z5')
Yakin 0 $c.EnBuyukEgim 1e-9 'B180 sensörde (disk dışı), sonra X/Y: eğim yok'
$c = Tara @('GOSUB AZXY_SAFE', 'G0 X-55 Y48', 'G0 A180', 'G0 X0 Y0')
Yakin 25.794 $c.EnBuyukEgim 1e-6 'A180 (sınır dışı) A sınırına kırpılır (25.79°)'
$c = Tara @('G0 X0 Y0', 'G30')
Yakin 25.05 $c.EnBuyukEgim 1e-6 'disk üstünden düz G30: A -25° ile köşeye (risk sayılır)'
$c = Tara @('G0 X0 Y0', 'G0 A20', 'G53 G90 G0 Z[#5163]', 'G53 G90 G0 A[#5224]', 'G53 G90 G0 X[#5181] Y[#5182]', 'G53 G90 G0 Z[#5183]', 'G53 G90 G0 A[#5184] B[#5185]')
Yakin 20 $c.EnBuyukEgim 1e-9 'sıralı park: yalnız mevcut 20° (köşede -25° dönüş disk dışında)'
Yakin 0 $c.Egim[6] 1e-9 'park A/B köşede: gereksinim yok'

# ================================================================== 6) EdingSim uçtan uca
Bolum '6a) HOME öncesi geri çekilme (eksenler home''lu, iş RESET''lendi)'
Dogru (Baglan) 'Baglan (EdingSim)'
[void](Komut-Isle 'home' ''); Dogru (Bekle-Kosul { [Eding]::CncGetAllAxesHomed() -ne 0 } 20) 'ilk home'
foreach ($nv in @(@(4010, -125.557), @(4011, -89.166), @(4012, -77.166), @(4013, -65.166), @(4014, -35.166), @(4015, -23.166), @(4016, -11.166), @(4017, 23.0), @(4020, -125.0), @(4021, -53.0), @(4031, -64.25), @(4032, -52.0))) { [Eding]::SimDegiskenYaz($nv[0], $nv[1]) }
Okuma-Yap; Raf-Kontrol
function Git([string]$l) { [void][Eding]::CncRunSingleLine($l); [void](Bekle-Kosul { (Eding-Durum) -eq 'READY' } 10) }
Git 'G53 G0 X-60 Y-50'; Git 'G53 G0 A40 B180'
$once = (Log-Komutlar).Count
$script:SahteOnay = $true
[void](Komut-Isle 'home' '')
Dogru (Bekle-Kosul { (Eding-Durum) -eq 'READY' } 20) 'home bitti'
$k = @(Log-Komutlar); $k = $k[$once..($k.Count - 1)]
Bilgi ($k -join ' | ')
$iZ = Ilk $k 'Z\[#5163\]'; $iA = Ilk $k '^G53 G0 A\[#5224\]$'; $iB = Ilk $k '^G53 G0 B177\.649$'; $iXY = Ilk $k 'X\[#5181\] Y\[#5182\]'
Dogru ($iZ -eq 0 -and $iZ -lt $iA -and $iA -lt $iB -and $iB -lt $iXY) "home öncesi: Z üst -> A düz -> B en yakın düz (177.649) -> G30 köşesi ($iZ,$iA,$iB,$iXY)"

Bolum '6b) Kol düz: disk ters (B180) iken B disk dışında döner'
Git 'G53 G0 X-60 Y-50'; Git 'G53 G0 A40 B180'
$once = (Log-Komutlar).Count
[void](Komut-Isle 'konum.koldz' '')
$k = @(Log-Komutlar); $k = $k[$once..($k.Count - 1)]
Bilgi ($k -join ' | ')
$iSen = Ilk $k 'X\[#4020\] Y\[#4021\]'; $iBb = Ilk $k '^G53 G0 B-2\.351$'
Dogru ($iSen -gt 0 -and $iSen -lt $iBb) 'B180 -> B-2.35 dönüşü sensör X/Y''de (disk dışında)'
Dogru ((Ilk $k '^G53 G0 A\[#5224\]$') -lt $iSen) 'A düz X/Y''den önce'
Yakin -2.3508 ([Eding]::MachinePos()).B 0.01 'B -2.35'

Bolum '6c) Çarpışma bekçisi: uzun frez -> iş duraklar'
# program: T1 alınır, disk ortasında A20 eğim. Sim takım değişiminde ölçüm yapmaz: G92 Z (#5213) elle "uzun frez" yapılır.
$yol = [System.IO.Path]::Combine($IsKlasor, 'EGIK_IS.nc')
$pl = New-Object System.Collections.Generic.List[string]
foreach ($x in @('%', 'G0 G17 G40 G49 G54 G80 G90', 'GOSUB Z_SAFE', 'GOSUB AZXY_SAFE', 'G0 B0.0', 'T1 M6', 'S20000 M3', 'GOSUB Z_SAFE', 'GOSUB AZXY_SAFE', 'G0 X0 Y0', 'G0 A20', 'G1 Z8 F500')) { $pl.Add($x) }
for ($i = 0; $i -lt 400; $i++) { $pl.Add("G1 X$($i % 20) Y$([int]($i / 20)) Z8") }
foreach ($x in @('GOSUB Z_SAFE', 'G0 A0', 'GOSUB AZXY_SAFE', 'M5', 'T0 M6', 'M30')) { $pl.Add($x) }
[System.IO.File]::WriteAllLines($yol, $pl)
function Is-Baslat-Uzun([double]$uc) {
    [Eding]::SimDegiskenYaz(5213, -($uc - 3.8) - 208.8975)   # uç boşluğu = 3.8 - (#5223 + #5213)
    $script:SahteListe = 'EGIK_IS.nc'
    [void](Komut-Isle 'is.sec' '')
    [Eding]::SimHizCarpani = 1.0; [Eding]::SimSatirHizi = 15.0
    $script:UiKayit.Clear()
    return (Komut-Isle 'is.baslat' '')
}
Devam-Sil
$script:SahteSecim = -1
Esit $true (Is-Baslat-Uzun 42.437) 'BAŞLAT (normal frez, uç boşluğu 42.4)'
Dogru ($null -ne $script:CarpAnaliz) 'program tarandı'
Yakin 20 $script:CarpAnaliz.EnBuyukEgim 1e-9 'tarama: en büyük eğim 20°'
$son = (Get-Date).AddSeconds(20); while ((Get-Date) -lt $son -and [Eding]::SimToplamSatir() -gt 0 -and [Eding]::CncGetCurExecLine() -lt 60) { Tik 1; Start-Sleep -Milliseconds 30 }
Tik 2
Dogru ($null -eq $script:CarpAlarm -and (Eding-Durum) -like 'RUN*') "normal frez: iş sürüyor, alarm yok ($(Eding-Durum))"
Dogru ($null -ne $script:CarpKontrol -and $script:CarpKontrol.Takim -eq 1) 'T1 denetlendi'
[void](Komut-Isle 'is.durdur' ''); Tik 5; [void](Komut-Isle 'makine.reset' ''); Tik 3
[void](Bekle-Kosul { (Eding-Durum) -eq 'READY' } 10)

Devam-Sil
Esit $true (Is-Baslat-Uzun 30.0) 'BAŞLAT (uzun frez, uç boşluğu 30: 20° için 34.4 gerekir)'
$son = (Get-Date).AddSeconds(20); while ((Get-Date) -lt $son -and -not ((Eding-Durum) -like 'PAUSE*') -and [Eding]::CncGetCurExecLine() -lt 60) { Tik 1; Start-Sleep -Milliseconds 30 }
Dogru ((Eding-Durum) -like 'PAUSE*') "iş DURAKLATILDI ($(Eding-Durum), satır $([Eding]::CncGetCurExecLine()))"
Dogru ([Eding]::CncGetCurExecLine() -lt 11) "duraklama eğimden (satır 11) önce: satır $([Eding]::CncGetCurExecLine())"
$ui = ($script:UiKayit -join "`n")
Dogru ($ui -match 'SECIM \[Çarpışma riski\] T1 çok uzun') 'DURDUR / DEVAM sorusu soruldu (T1 çok uzun)'
Dogru ($ui -match '20\.0° eğikken' -and $ui -match 'GİRER|yaklaşır') 'metinde eğim ve yaklaşma'
Dogru ((Eding-Durum) -like 'PAUSE*' -and $null -eq $script:CarpAlarm) 'seçim yok (vazgeç): iş duraklı kalır'
# DEVAM (tehlikeli onay) -> sürer, aynı takım için tekrar sorulmaz
$script:SahteOnay = $true
[void][Eding]::CncRunOrResumeJob(); Tik 5
Dogru ((Eding-Durum) -like 'RUN*' -and $null -eq $script:CarpAlarm) 'aynı takımda devam: bekçi tekrar durdurmaz'
[void](Komut-Isle 'is.durdur' ''); Tik 5; [void](Komut-Isle 'makine.reset' ''); Tik 3
[void](Bekle-Kosul { (Eding-Durum) -eq 'READY' } 10)

Devam-Sil
$script:SahteSecim = 0
Esit $true (Is-Baslat-Uzun 30.0) 'BAŞLAT (uzun frez, DURDUR seçilecek)'
$son = (Get-Date).AddSeconds(20); while ((Get-Date) -lt $son -and $script:IsAktif -and [Eding]::CncGetCurExecLine() -lt 60) { Tik 1; Start-Sleep -Milliseconds 30 }
Tik 3
Dogru (-not $script:IsAktif) 'DURDUR seçildi: iş iptal'
Dogru (($script:UiKayit -join "`n") -match 'SECIM \[Çarpışma riski\]') 'soru soruldu'
$k = Devam-Oku
Dogru ($null -ne $k -and [int]$k.Satir -lt 11) "devam kaydı eğimden önce (satır $($k.Satir))"
[void](Komut-Isle 'makine.reset' ''); Tik 3; [void](Bekle-Kosul { (Eding-Durum) -eq 'READY' } 10)

Bolum '6d) BAŞLAT reddi: iş milindeki frez programın ilk kısmı için çok uzun'
Devam-Sil
$yol2 = [System.IO.Path]::Combine($IsKlasor, 'EGIK_T1_MILDE.nc')
[System.IO.File]::WriteAllLines($yol2, @('%', 'G0 G17 G40 G49 G54 G80 G90', 'GOSUB Z_SAFE', 'GOSUB AZXY_SAFE', 'G0 X0 Y0', 'G0 A25', 'G1 Z8 F500', 'GOSUB Z_SAFE', 'G0 A0', 'GOSUB AZXY_SAFE', 'M30'))
[Eding]::SimHizCarpani = 25.0
[void](Bekle-Kosul { [Eding]::CncRunSingleLine('M6 T1') -eq 0 } 10); [void](Bekle-Kosul { [Eding]::CncGetCurrentToolNumber() -eq 1 } 10); Okuma-Yap
Esit 1 ([Eding]::CncGetCurrentToolNumber()) 'iş milinde T1'
[Eding]::SimDegiskenYaz(5213, -(30.0 - 3.8) - 208.8975)
$script:SahteListe = 'EGIK_T1_MILDE.nc'; [void](Komut-Isle 'is.sec' '')
# Sade akış iş milindeki frezi önce bırakır (Bos-Ismili-Hazirla); bu durumu görmek için doğrudan denetim
$script:UiKayit.Clear()
Esit $false (Carpisma-Hazirla $yol2) 'Carpisma-Hazirla: T1 (uç boşluğu 30) A25 için yetmez -> başlatılmaz'
Dogru (($script:UiKayit -join "`n") -match 'T1 çok uzun') 'hata penceresi: T1 çok uzun'
[Eding]::SimDegiskenYaz(5213, -247.5345)
Esit $true (Carpisma-Hazirla $yol2) 'normal boy (42.4): A25 için yeter (39.4 gerekir)'
$script:Tercih.CarpismaBekci = '0'; [Eding]::SimDegiskenYaz(5213, -(30.0 - 3.8) - 208.8975)
Esit $true (Carpisma-Hazirla $yol2) 'koruma kapalı (Ayarlar): denetlenmez'
$script:Tercih.CarpismaBekci = '1'

Bolum '6e) Uç boşluğu TAKIM kartında'
[Eding]::SimDegiskenYaz(5213, -247.5345); Okuma-Yap
$d = Durum-Topla
Dogru ([string]$d.TakimAciklama -match 'uç boşluğu 42\.4 mm') "TAKIM kartı açıklaması: $($d.TakimAciklama)"
Esit '56' ([string]$d.Ayarlar['TutucuYaricap']) 'Ayarlar: TutucuYaricap varsayılan 56'
[void](Tercih-Kaydet 'TutucuYaricap=58,5')
Esit '58.5' ([string]$script:Tercih.TutucuYaricap) 'Tercih-Kaydet TutucuYaricap (virgül kabul)'
[void](Tercih-Kaydet 'CarpismaPayi=500')
Dogru (-not $script:Tercih.ContainsKey('CarpismaPayi') -or [string]$script:Tercih.CarpismaPayi -ne '500') 'Tercih-Kaydet: 0-200 dışı reddedilir'

Bolum '6f) Jog X/Y uyarısı (eğik disk, uç tutucunun altında)'
Git 'G53 G0 Z-20'; Git 'G53 G0 A40'
Okuma-Yap
$uy = Jog-Carpisma-Uyarisi
Dogru ($uy -match 'eğik') "uyarı: $($uy.Split("`r")[0])"
Git 'G53 G0 Z[#5163]'; Git 'G53 G0 A[#5224]'
Esit '' (Jog-Carpisma-Uyarisi) 'disk düz: uyarı yok'

Ozet 'Çarpışma'
