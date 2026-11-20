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

if (-not (Get-Command Devam-Frez-Satiri -ErrorAction Ignore)) {
    Bilgi "Senaryo 2 (frez kipi) yalnız yeni panelde (lib/Cekirdek.ps1): -Kaynak teslim/PrimerMill ile çalıştırın; bu kaynakta atlandı."
    Ozet 'Devam'; return
}
Bolum 'Senaryo 2: FREZİN İŞİNİ BAŞTAN (frez) - çok takımlı iş'
# Çok takımlı girdi: T1 (satır 10) ... M100 / T2 M6 ... M100 / M6 T5 (ters yazım) ... T2 tekrar (T ayrı satırda, sonra M6)
$C0 = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt 2000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $C0.Add('M5'); $C0.Add('T2 M6'); $t2 = $C0.Count; $C0.Add('S18000 M3')
for ($i = 2000; $i -lt 4000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $C0.Add('N4001 M6 T5 (kure 0.6)'); $t5 = $C0.Count; $C0.Add('S20000 M3')
for ($i = 4000; $i -lt 6000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $C0.Add('T2'); $C0.Add('M6'); $t2b = $C0.Count; $C0.Add('S18000 M3')
for ($i = 6000; $i -lt 8000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $C0.Add('T0 M6'); $C0.Add('M30')
$cok = [System.IO.Path]::Combine($IsKlasor, 'cok_takim.nc'); [System.IO.File]::WriteAllLines($cok, $C0)
$Lc = [System.IO.File]::ReadAllLines($cok)
$anC = GKod-Analiz $cok
Bilgi "T2 M6 satır $t2, M6 T5 satır $t5, T2 (ayrı) M6 satır $t2b, toplam $($Lc.Length)"

$f = Devam-NC-Uret $cok ($t5 - 3) 'frez' $anC 2          # T2'nin işinin sonunda (M100'de) kırık ölçüldü
Esit $t2 $f.Satir 'frez T2 (T2 işinin sonunda kırık): başlangıç = T2 M6 satırı'
$Fc = [System.IO.File]::ReadAllLines($f.Yol)
Esit 'T2 M6' $Fc[$f.Harita.Bas - 1] 'frez: devam dosyası T2 M6 satırıyla sürer (değişimi kopyalanan satır yapar)'
Esit $t2 $f.Harita.Orijinal 'frez: harita asıl dosyada T2 M6 satırına'
$bas = @($Fc | Select-Object -First ($f.Harita.Bas - 1))
Dogru (@($bas | Where-Object { $_ -match '(?i)M0*6|M0*3|M0*[78]|^G90 F' }).Count -eq 0) 'frez: başlıkta T M6 / M3 / M7 / F yok'
Dogru (@($bas | Where-Object { $_ -eq 'GOSUB Z_SAFE' }).Count -eq 1 -and @($bas | Where-Object { $_ -eq 'GOSUB AZXY_SAFE' }).Count -eq 1) 'frez: başlıkta Z_SAFE ve AZXY_SAFE'
Dogru (@($bas | Where-Object { $_ -match '^M5$' }).Count -eq 1 -and @($bas | Where-Object { $_ -match '^M9$' }).Count -eq 1) 'frez: başlıkta M5 M9'
Esit ($Lc.Length - $t2 + 1) ($Fc.Length - $f.Harita.Bas + 1) 'frez: T2 M6 satırından iş sonuna kadar eksiksiz kopya'
Esit 2 $f.Takim 'frez: takım T2'
Esit 2 $f.Aktif 'frez: dosyaya göre durduğu yerde etkin frez T2'

$f5 = Devam-NC-Uret $cok ($t2b - 2) 'frez' $anC 5
Esit $t5 $f5.Satir 'frez T5: "N.. M6 T5 (yorum)" yazımı da bulunur'
$f2b = Devam-NC-Uret $cok ($t2b + 500) 'frez' $anC 2
Esit $t2b $f2b.Satir 'frez T2 ikinci kez kullanıldığında: SON T2 değişimi ("T2" ayrı satır + "M6")'
$f1 = Devam-NC-Uret $cok 1500 'frez' $anC 1
Esit 10 $f1.Satir 'frez T1: iş başındaki T1 M6 satırı'
$hata = ''; try { [void](Devam-NC-Uret $cok 1500 'frez' $anC 5) } catch { $hata = $_.Exception.Message }
Dogru ($hata -match 'bulunamadı') "frez: durduğu yerden önce T5 değişimi yoksa hata ($hata)"
$fs = Devam-Frez-Satiri $Lc ($t5 - 3) 2
Esit $t2 $fs.Satir 'Devam-Frez-Satiri: T2 M6 satırı'

Bolum 'Senaryo 2 eklenince eski kipler aynı'
$d2 = Devam-NC-Uret $is $dur 'tam' $an
Esit ($C -join "`n") ([System.IO.File]::ReadAllText($d2.Yol).TrimEnd() -replace "`r`n", "`n") 'tam: çıktı aynı (frez kipi eklenmesi değiştirmedi)'

Ozet 'Devam'
