# Devam_Testi.ps1 - "Kaldığı yerden devam" programının nereden başladığını denetler (Eding'siz).
# Hata (dizüstü denemesi): "KALDIĞI YERDEN DEVAM (önerilen)" son GOSUB Z_SAFE satırından başlıyordu; bu CAM çıktısında bir
# işlem 20 000+ satır sürdüğünden iş neredeyse baştan kazınıyordu. Yeni önerilen kip 'tam': ~10 sn geriden, yukarıdan iner.
# Çalıştırma: pwsh -NoProfile -File tests/Devam_Testi.ps1 [-Kaynak teslim/PrimerMill]   PS 5.1 uyumlu.
param([string]$Kaynak = '')
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
[void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Devam-NC-Uret' -Bagimliliklar)
$IsKlasor = Gecici-Klasor 'pm_devam'
$is = GKod-Girdi 'ZY2_45_eding.nc'
$L = [System.IO.File]::ReadAllLines($is)
$an = GKod-Analiz $is            # her satır 0.25 sn: 10 sn = 40 satır, 60 sn = 240 satır
$dur = 30000                     # iş 30 000. satırda durdu (işlem başı 13 570 civarı)
$zs = 0; for ($i = $dur - 1; $i -ge 0; $i--) { if ($L[$i] -match '(?i)^\s*(N\d+\s*)?GOSUB\s+Z_SAFE\b') { $zs = $i + 1; break } }
Bilgi "durduğu satır $dur, son GOSUB Z_SAFE satırı $zs"

Bolum 'Önerilen: KALDIĞI YERDEN (tam)'
$d = Devam-NC-Uret $is $dur 'tam' $an
Dogru ($d.Satir -ge $dur - 60 -and $d.Satir -le $dur) "tam: durduğu yerin hemen gerisinden başlar (satır $($d.Satir))"
$C = [System.IO.File]::ReadAllLines($d.Yol)
$ilk = $C[$d.Harita.Bas - 1]
Esit $L[$d.Satir - 1] $ilk 'tam: devam dosyası asıl işin o satırıyla sürer'
$yaklas = @($C | Select-Object -First ($d.Harita.Bas - 1))
Dogru (@($yaklas | Where-Object { $_ -match '^GOSUB Z_SAFE$' }).Count -ge 1) 'tam: önce güvenli yüksekliğe çıkar'
Dogru (@($yaklas | Where-Object { $_ -match '^G0 X-?\d' }).Count -eq 1) 'tam: güvenli yükseklikte X/Y''ye gider'
$g1 = @($yaklas | Where-Object { $_ -match '^G1 Z-?[\d.]+ F([\d.]+)$' })
Dogru ($g1.Count -ge 1 -and [double]::Parse(([regex]::Match($g1[0], 'F([\d.]+)')).Groups[1].Value, $script:CI) -le 600) 'tam: kaldığı Z''ye yavaş (F<=600) iner'

Bolum 'YAKIN NOKTADAN (~1 dk)'
$y = Devam-NC-Uret $is $dur 'yakin' $an
Dogru ($y.Satir -lt $d.Satir -and $y.Satir -ge $dur - 300) "yakin: ~1 dk geriden (satır $($y.Satir))"

Bolum 'İŞLEMİN BAŞINDAN (guvenli) - eski davranış korunur'
$g = Devam-NC-Uret $is $dur 'guvenli' $an
Esit $zs $g.Satir 'guvenli: son GOSUB Z_SAFE satırından'

Bolum 'Analiz yoksa'
$n = Devam-NC-Uret $is $dur 'tam' $null
Dogru ($n.Satir -gt $zs -and $n.Satir -le $dur) "tam (analizsiz): yine durduğu yerin yakınından (satır $($n.Satir))"
$e = Devam-NC-Uret $is 20 'tam' $an
Dogru ($e.Satir -ge 1 -and $e.Satir -le 20) "iş başında durduysa: baştaki güvenli noktadan (satır $($e.Satir))"

Ozet 'Devam'
