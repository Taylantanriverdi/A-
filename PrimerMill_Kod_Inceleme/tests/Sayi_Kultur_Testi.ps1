# Sayi_Kultur_Testi.ps1 - sayı biçimleme/ayrıştırma ve G-kod üretiminin Windows bölge ayarından bağımsızlığı.
# Makine bilgisayarı Çince (zh-CN) olabilir; Türkçe (tr-TR) ve Almanca (de-DE) ondalık ayırıcı olarak virgül kullanır.
# Denenen kültürler: InvariantCulture, tr-TR, zh-CN, de-DE (CurrentCulture ve CurrentUICulture birlikte değiştirilir).
#  - Sayi, Metin-Sayi: gidiş-dönüş, virgül/nokta girişi, negatif sıfır, yuvarlama, binlik ayırıcı yok
#  - Sure, Sade-Sure, Kal-Saat, Blok-Metin-Temizle
#  - Tüm G-kod üreticileri (GKod_Altin_Testi ile aynı varyantlar) her kültürde InvariantCulture ile bayt bayt aynı
# Çalıştırma: pwsh -NoProfile -File tests/Sayi_Kultur_Testi.ps1 [-Kaynak <PrimerMill klasörü | .ps1>] [-GKodsuz]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [switch]$GKodsuz)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
Write-Host "Kaynak: $Kaynak"
$cz = "CLR $([Environment]::Version)"; try { $cz = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription } catch { }
Write-Host "PowerShell $($PSVersionTable.PSVersion)  ($cz)"

[void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Sayi', 'Metin-Sayi', 'Sure', 'Sade-Sure', 'Kal-Saat', 'Blok-Metin-Temizle' -Degiskenler 'BlokFont' -Bagimliliklar)
$Kulturler = @('', 'tr-TR', 'zh-CN', 'de-DE')
function KAd([string]$k) { if ($k) { return $k } return 'Invariant' }

foreach ($k in $Kulturler) {
    Bolum "Kültür: $(KAd $k)"
    Kulturde $k {
        $ad = KAd $k
        Dogru ([System.Threading.Thread]::CurrentThread.CurrentCulture.Name -eq $k) "[$ad] kültür etkin"
        if ($k -eq 'tr-TR' -or $k -eq 'de-DE') { Esit ',' ([System.Threading.Thread]::CurrentThread.CurrentCulture.NumberFormat.NumberDecimalSeparator) "[$ad] bu kültürde ondalık ayırıcı virgül (deneme anlamlı)" }

        # --- Sayi: her zaman nokta, 3 basamak, binlik ayırıcı yok
        Esit '1.500' (Sayi 1.5) "[$ad] Sayi 1.5"
        Esit '-12.346' (Sayi -12.3456) "[$ad] Sayi -12.3456 (yuvarlama)"
        Esit '2.000' (Sayi 2.0004) "[$ad] Sayi 2.0004 aşağı"
        Esit '2.001' (Sayi 2.0006) "[$ad] Sayi 2.0006 yukarı"
        Esit '1234567.891' (Sayi 1234567.891) "[$ad] Sayi binlik ayırıcı yok"
        Esit '0.000' (Sayi 0) "[$ad] Sayi 0"
        Esit '0.000' (Sayi 1e-7) "[$ad] Sayi 1e-7"
        Esit '-247.535' (Sayi -247.5345001) "[$ad] Sayi -247.5345001"
        $nz = Sayi -0.0001
        Dogru (@('0.000', '-0.000') -contains $nz) "[$ad] Sayi -0.0001 -> '0.000' ya da '-0.000'" "gelen '$nz'"
        Esit 0.0 (Metin-Sayi $nz) "[$ad] Sayi(-0.0001) geri okununca 0"
        $nz2 = Sayi ([double]'-0')
        Dogru (@('0.000', '-0.000') -contains $nz2) "[$ad] Sayi(-0.0) = '$nz2'"
        Dogru ((Sayi 3.25) -notmatch ',') "[$ad] Sayi çıktısında virgül yok"

        # --- Metin-Sayi: nokta ve virgül kabul, InvariantCulture
        Esit 1.5 (Metin-Sayi '1.5') "[$ad] Metin-Sayi '1.5'"
        Esit 1.5 (Metin-Sayi '1,5') "[$ad] Metin-Sayi '1,5'"
        Esit -2.25 (Metin-Sayi '-2,25') "[$ad] Metin-Sayi '-2,25'"
        Esit 3.75 (Metin-Sayi ' 3.75 ') "[$ad] Metin-Sayi boşluklu"
        Esit 4.0 (Metin-Sayi '+4') "[$ad] Metin-Sayi '+4'"
        Esit 1000.0 (Metin-Sayi '1e3') "[$ad] Metin-Sayi '1e3'"
        Esit 0.0 (Metin-Sayi '-0') "[$ad] Metin-Sayi '-0'"
        Esit -0.5 (Metin-Sayi '-.5') "[$ad] Metin-Sayi '-.5'"
        Esit $null (Metin-Sayi 'abc') "[$ad] Metin-Sayi 'abc' -> null"
        Esit $null (Metin-Sayi '') "[$ad] Metin-Sayi '' -> null"
        Esit $null (Metin-Sayi '1.234,5') "[$ad] Metin-Sayi '1.234,5' (binlik + ondalık) -> null"
        Esit $null (Metin-Sayi '12 mm') "[$ad] Metin-Sayi '12 mm' -> null"
        $v = Metin-Sayi '7,125'; Dogru ($v -is [double]) "[$ad] Metin-Sayi double döner"

        # --- gidiş-dönüş
        $hata = @()
        foreach ($x in @(0.0, 1.0, -1.0, 0.001, -0.001, 32.265, -53.1425, 208.8975, -247.5345, 12345.6789, -0.0005, 99.9995, 1e-9, 72.25)) {
            $geri = Metin-Sayi (Sayi $x)
            if ($null -eq $geri -or [math]::Abs($geri - $x) -gt 0.0005000001) { $hata += "$x -> $(Sayi $x) -> $geri" }
            $geri2 = Metin-Sayi ((Sayi $x).Replace('.', ','))
            if ($null -eq $geri2 -or [math]::Abs($geri2 - $geri) -gt 1e-12) { $hata += "$x virgüllü -> $geri2" }
        }
        Dogru ($hata.Count -eq 0) "[$ad] Sayi -> Metin-Sayi gidiş-dönüş (nokta ve virgül)" ($hata -join '; ')

        # --- PowerShell'in kendi dönüşümleri (G-kodda "$v" ve [double]'..' kullanılan yerler için güvence)
        Esit '1.5' "$(1.5)" "[$ad] PowerShell `"`$v`" çevrimi kültürden bağımsız"
        Esit 2.5 ([double]'2.5') "[$ad] [double]'2.5' kültürden bağımsız"

        # --- süre ve saat metinleri
        Esit '01:02:05' (Sure 3725) "[$ad] Sure 3725"
        Esit '00:00:00' (Sure -5) "[$ad] Sure negatif"
        Esit '25:00:00' (Sure 90000) "[$ad] Sure 25 saat"
        Esit '1 dk' (Sade-Sure 1) "[$ad] Sade-Sure 1 sn"
        Esit '59 dk' (Sade-Sure 3540) "[$ad] Sade-Sure 3540"
        Esit '1 sa 0 dk' (Sade-Sure 3600) "[$ad] Sade-Sure 3600"
        Esit '2 sa 5 dk' (Sade-Sure 7500) "[$ad] Sade-Sure 7500"
        Esit '3:00' (Kal-Saat 0) "[$ad] Kal-Saat 0"
        Esit '3:45' (Kal-Saat 22.5) "[$ad] Kal-Saat 22.5"
        Esit '6:00' (Kal-Saat 90) "[$ad] Kal-Saat 90"
        Esit '12:00' (Kal-Saat 270) "[$ad] Kal-Saat 270"
        Esit '2:15' (Kal-Saat 337.5) "[$ad] Kal-Saat 337.5"

        # --- blok yazısı (Türkçe büyük harf kuralı açıkça tr-TR ile)
        Esit 'IGNE-12' (Blok-Metin-Temizle 'iğne-12') "[$ad] Blok-Metin-Temizle 'iğne-12'"
        Esit 'SIS/U.C' (Blok-Metin-Temizle 'şiş/ü.ç') "[$ad] Blok-Metin-Temizle Türkçe harfler"
        Esit 'AB C' (Blok-Metin-Temizle ' ab c ') "[$ad] Blok-Metin-Temizle boşluk"
        Esit 'XY' (Blok-Metin-Temizle 'x#y€') "[$ad] Blok-Metin-Temizle desteklenmeyen karakter atılır"
        Esit 'IIOG' (Blok-Metin-Temizle 'ıİöğ') "[$ad] Blok-Metin-Temizle ı/İ/ö/ğ"
    }
}

if (-not $GKodsuz) {
    Bolum 'G-kod üreticileri her kültürde aynı'
    . GKod-Yukle $Kaynak
    $temel = Kulturde '' { GKod-Uret }
    Bilgi "InvariantCulture'da $($temel.Count) varyant üretildi"
    foreach ($k in @('tr-TR', 'zh-CN', 'de-DE')) {
        $c = Kulturde $k { GKod-Uret }
        for ($i = 0; $i -lt $temel.Count; $i++) {
            $a = $temel[$i]; $b = $c[$i]
            $ok = ($a.Metin -ceq $b.Metin) -and -not $a.Metin.StartsWith('HATA:')
            $neden = ''
            if (-not $ok) {
                $x = $a.Metin.Split("`n"); $y = $b.Metin.Split("`n")
                for ($j = 0; $j -lt [math]::Min($x.Length, $y.Length); $j++) { if ($x[$j] -cne $y[$j]) { $neden = "satır $($j + 1): '$($x[$j])' <> '$($y[$j])'"; break } }
                if (-not $neden) { $neden = $a.Metin.Substring(0, [math]::Min(200, $a.Metin.Length)) }
            }
            Dogru $ok "[$k] $($a.Ad)" $neden
        }
    }
    try { Remove-Item -LiteralPath $IsKlasor -Recurse -Force } catch { }
}
Ozet 'Sayı ve kültür'
