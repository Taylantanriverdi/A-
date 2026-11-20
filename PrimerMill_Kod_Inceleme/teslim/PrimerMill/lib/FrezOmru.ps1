# FrezOmru.ps1 - frez (takım) ömrü: takım başına kesimde geçen süre (dakika), operatörün girdiği ömür (dakika), yüzde,
# "SIFIRLA · YENİ FREZ". Makineye HİÇBİR komut göndermez, G-kodu değiştirmez: yalnız sayar, gösterir, uyarır.
#  - Sayma (Frez-Omru-Tik, ana zamanlayıcının korumalı bloğunda 200 ms'de bir, Okuma-Yap'tan hemen sonra): yalnız
#    Eding durumu tam olarak RUNNING (RUN-SUB = takım değişimi makrosu, PAUSE*, READY, jog sayılmaz), bu panelden başlatılan
#    iş sürüyor ($script:IsAktif), manuel frez değişimi beklenmiyor ve iş milinde frez var (CncGetCurrentToolNumber 1..99).
#    Süre tık sayısıyla değil, iki tık arasındaki gerçek zamanla (Stopwatch) ölçülür; tek aralık en çok 2 sn sayılır
#    (panel donması / bilgisayar uykusu ömre yazılmaz). Takım iki tık arasında değiştiyse o aralık sayılmaz.
#  - Kalıcılık: $ScriptKlasor\frez_omru.json (demo modunda demo_calisma\ altında, gerçek dosyaya dokunmaz). Sayılırken
#    30 sn'de bir, sayma bitince (iş sonu, DURAKLAT, DURDUR, ACİL STOP, takım değişimi) ve panel kapanırken atomik yazılır
#    (geçici dosya + File.Replace; Devam-Kaydet ile aynı kalıp). Sayılar InvariantCulture. Bozuk dosya: boş başlanır, bir kez
#    günlüğe yazılır, bozuk dosya frez_omru.json.bozuk_<zaman> olarak saklanır.
#  - Uyarı: BAŞLAT'ta (Btn-Baslat-Ic, mevcut denetimlerden sonra) işin kullandığı bir frez ömrünün >= %100'ündeyse onay
#    (varsayılan VAZGEÇ); >= %90 ise yalnız alt şerit uyarısı. Kesim sırasında %100'e ulaşan frez için bir kez bildirim.
# PowerShell 5.1 (32 bit) uyumlu.

$FrezOmruDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'frez_omru.json')
$FrezOmruAralikSiniri = 2.0      # sn: iki tık arası bundan uzunsa yalnız bu kadar sayılır
$FrezOmruKayitAraligi = 30.0     # sn: sayılırken dosyaya yazma aralığı
$FrezOmruEnCok = 100000.0        # dk: girilebilecek en büyük ömür
$script:FrezOmru = @{}           # [int] takım -> @{ Dakika = [double]; Omur = [double]; Sifirlama = [string] 'yyyy-MM-dd HH:mm:ss' }
$script:FrezOmruSaat = [System.Diagnostics.Stopwatch]::StartNew()
$script:FrezOmruSonAn = -1.0     # son sayılan tıkın Stopwatch saniyesi (-1 = sayılmıyordu)
$script:FrezOmruSonTakim = 0
$script:FrezOmruKirli = $false   # dosyaya yazılmamış artış var
$script:FrezOmruSonKayit = 0.0
$script:FrezOmruOkumaHatasi = $false
$script:FrezOmruYazmaHatasi = $false
$script:FrezOmruDolduBildirildi = @{}

$script:FrezOmruIc = [System.Globalization.CultureInfo]::InvariantCulture
function Frez-Omru-Sayi([double]$v) { return ([math]::Round($v, 4)).ToString('0.####', $script:FrezOmruIc) }

# "T3" / "t3" / "3" -> 3 ; geçersiz -> 0
function Frez-Omru-Takim-No([string]$a) {
    $m = [regex]::Match(([string]$a).Trim(), '^[Tt]?(\d{1,2})$')
    if (-not $m.Success) { return 0 }
    $n = [int]$m.Groups[1].Value
    if ($n -lt 1 -or $n -gt 99) { return 0 }
    return $n
}

function Frez-Omru-Kayit([int]$n) {
    if (-not $script:FrezOmru.ContainsKey($n)) { $script:FrezOmru[$n] = @{ Dakika = 0.0; Omur = 0.0; Sifirlama = '' } }
    return $script:FrezOmru[$n]
}

# Yüzde (0..∞); ömür girilmediyse -1
function Frez-Omru-Yuzde([int]$n) {
    if (-not $script:FrezOmru.ContainsKey($n)) { return -1.0 }
    $k = $script:FrezOmru[$n]
    if ([double]$k.Omur -le 0) { return -1.0 }
    return 100.0 * [double]$k.Dakika / [double]$k.Omur
}

# Ekranda ve mesajlarda: 100'ün altında 1 ondalık, üstünde tam sayı (görünümdeki OmurCizim.Dk ile aynı)
function Frez-Omru-Dk([double]$dk) {
    if ($dk -lt 0) { $dk = 0 }
    if ($dk -lt 99.95) { return $dk.ToString('0.0', $script:FrezOmruIc) }
    return ([math]::Round($dk)).ToString('0', $script:FrezOmruIc)
}

function Frez-Omru-Yukle {
    $script:FrezOmru = @{}
    if (-not [System.IO.File]::Exists($FrezOmruDosyasi)) { return }
    try {
        $j = [System.IO.File]::ReadAllText($FrezOmruDosyasi) | ConvertFrom-Json
        if ($null -eq $j -or $null -eq $j.Takimlar) { throw 'Takimlar alanı yok' }
        $yeni = @{}
        foreach ($p in $j.Takimlar.PSObject.Properties) {
            $n = Frez-Omru-Takim-No $p.Name
            if ($n -lt 1) { continue }
            $v = $p.Value
            $dk = [double]$v.Dakika; $om = [double]$v.Omur
            if ([double]::IsNaN($dk) -or $dk -lt 0) { $dk = 0.0 }
            if ([double]::IsNaN($om) -or $om -lt 0 -or $om -gt $FrezOmruEnCok) { $om = 0.0 }
            $yeni[$n] = @{ Dakika = $dk; Omur = $om; Sifirlama = [string]$v.Sifirlama }
        }
        $script:FrezOmru = $yeni
    } catch {
        $script:FrezOmru = @{}
        if (-not $script:FrezOmruOkumaHatasi) {
            $script:FrezOmruOkumaHatasi = $true
            $yedek = $FrezOmruDosyasi + '.bozuk_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
            try { [System.IO.File]::Copy($FrezOmruDosyasi, $yedek, $true) } catch { $yedek = '(kopyalanamadı)' }
            [Kayit]::Yaz("FREZ ÖMRÜ: frez_omru.json okunamadı ($($_.Exception.Message)); boş başlandı. Bozuk dosya: $yedek")
        }
    }
}

# Atomik yazma: geçici dosya + File.Replace (yoksa Move). PowerShell $null'u .NET'e "" geçirir: [NullString]::Value şart.
function Frez-Omru-Kaydet {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"Surum":1,"Takimlar":{')
    $ilk = $true
    foreach ($n in @($script:FrezOmru.Keys | Sort-Object)) {
        $k = $script:FrezOmru[$n]
        if (-not $ilk) { [void]$sb.Append(',') }; $ilk = $false
        $sf = ([string]$k.Sifirlama).Replace('\', '').Replace('"', '')
        [void]$sb.Append("""T$n"":{""Dakika"":$(Frez-Omru-Sayi $k.Dakika),""Omur"":$(Frez-Omru-Sayi $k.Omur),""Sifirlama"":""$sf""}")
    }
    [void]$sb.Append('}}')
    try {
        $gecici = $FrezOmruDosyasi + '.tmp'
        [System.IO.File]::WriteAllText($gecici, $sb.ToString())
        if ([System.IO.File]::Exists($FrezOmruDosyasi)) {
            try { [System.IO.File]::Replace($gecici, $FrezOmruDosyasi, [NullString]::Value) }
            catch { [System.IO.File]::Copy($gecici, $FrezOmruDosyasi, $true); [System.IO.File]::Delete($gecici) }
        } else { [System.IO.File]::Move($gecici, $FrezOmruDosyasi) }
        $script:FrezOmruKirli = $false
        $script:FrezOmruYazmaHatasi = $false
    } catch {
        if (-not $script:FrezOmruYazmaHatasi) { $script:FrezOmruYazmaHatasi = $true; [Kayit]::Yaz("FREZ ÖMRÜ: frez_omru.json yazılamadı: $($_.Exception.Message)") }
    }
    $script:FrezOmruSonKayit = $script:FrezOmruSaat.Elapsed.TotalSeconds
}

# Şu an sayılmalı mı? Dönüş: takım numarası (1..99) ya da 0
function Frez-Omru-Sayilan-Takim {
    $h = $script:Hizli
    if (-not $h.Okundu) { return 0 }
    if ([string]$h.Durum -ne 'RUNNING') { return 0 }   # RUN-SUB (makro / takım değişimi), PAUSE*, READY, jog: sayılmaz
    if (-not $script:IsAktif) { return 0 }
    if ([Eding]::AcilKilit) { return 0 }
    if ($script:ManuelMesajMetni) { return 0 }          # manuel frez değişimi bekleniyor (Ana-Tik doldurur)
    $t = [int]$h.Takim
    if ($t -lt 1 -or $t -gt 99) { return 0 }
    return $t
}

# Ana zamanlayıcıdan (200 ms). $simdiSn: testler için zaman (verilmezse Stopwatch).
function Frez-Omru-Tik([double]$simdiSn = -1) {
    if ($simdiSn -lt 0) { $simdiSn = $script:FrezOmruSaat.Elapsed.TotalSeconds }
    $t = Frez-Omru-Sayilan-Takim
    if ($t -gt 0) {
        if ($script:FrezOmruSonAn -ge 0 -and $script:FrezOmruSonTakim -eq $t) {
            $dt = $simdiSn - $script:FrezOmruSonAn
            if ($dt -gt $FrezOmruAralikSiniri) { $dt = $FrezOmruAralikSiniri }
            if ($dt -gt 0) {
                $k = Frez-Omru-Kayit $t
                $once = Frez-Omru-Yuzde $t
                $k.Dakika = [double]$k.Dakika + $dt / 60.0
                $script:FrezOmruKirli = $true
                $sonra = Frez-Omru-Yuzde $t
                if ($once -lt 100 -and $sonra -ge 100 -and -not $script:FrezOmruDolduBildirildi.ContainsKey($t)) {
                    $script:FrezOmruDolduBildirildi[$t] = $true
                    $m = "FREZ ÖMRÜ: T$t ömrünü doldurdu ($(Frez-Omru-Dk $k.Dakika)/$(Frez-Omru-Dk $k.Omur) dk). İş sürüyor; bitince frezi değiştirip Takımlar › Frez ömrü › SIFIRLA."
                    [Kayit]::Yaz($m); Mesaj-Ekle $m 'Uyari'
                    try { Ui-Bildir "T$t ömrünü doldurdu: $(Frez-Omru-Dk $k.Dakika)/$(Frez-Omru-Dk $k.Omur) dk" 'Uyari' } catch { }
                }
            }
        }
        $script:FrezOmruSonAn = $simdiSn; $script:FrezOmruSonTakim = $t
    } else {
        $script:FrezOmruSonAn = -1.0; $script:FrezOmruSonTakim = 0
    }
    if ($script:FrezOmruKirli -and ($t -eq 0 -or ($simdiSn - $script:FrezOmruSonKayit) -ge $FrezOmruKayitAraligi)) {
        Frez-Omru-Kaydet
        $script:FrezOmruSonKayit = $simdiSn
    }
}

function Frez-Omru-Kaydet-Gerekirse { if ($script:FrezOmruKirli) { Frez-Omru-Kaydet } }

# İşin kullandığı takımlar: dosya analizi (NcAnaliz, "Takımlar T1 · T2 · T5" ile aynı kaynak) + bekleyen blok isminin frezi
function Frez-Omru-Is-Takimlari {
    $l = @()
    if ($script:Analiz) { $l += @($script:Analiz.Takimlar | Where-Object { $_ -gt 0 }) }
    if ($script:BekleyenBlok -and $script:BekleyenBlok.Takim) { $l += [int]$script:BekleyenBlok.Takim }
    return @($l | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le 99 } | Sort-Object -Unique)
}

# BAŞLAT öncesi (Btn-Baslat-Ic, mevcut denetimlerden sonra). $true = devam. Hareketi kendisi hiç engellemez: yalnız soru.
function Frez-Omru-Baslat-Kontrol {
    $dolan = @(); $yakin = @()
    foreach ($n in (Frez-Omru-Is-Takimlari)) {
        $y = Frez-Omru-Yuzde $n
        if ($y -lt 0) { continue }
        $k = $script:FrezOmru[$n]
        if ($y -ge 100) { $dolan += "T$n ömrünü doldurdu: $(Frez-Omru-Dk $k.Dakika)/$(Frez-Omru-Dk $k.Omur) dk." }
        elseif ($y -ge 90) { $yakin += "T$n %$([math]::Floor($y)) ($(Frez-Omru-Dk $k.Dakika)/$(Frez-Omru-Dk $k.Omur) dk)" }
    }
    if ($dolan.Count -gt 0) {
        $m = "Bu işin kullandığı frez ömrünü doldurdu:`r`n`r`n" + ($dolan -join "`r`n") + "`r`n`r`nFrezi değiştirip Takımlar › Frez ömrü › SIFIRLA · YENİ FREZ ile sıfırlayabilirsiniz.`r`n`r`nYine de başlatılsın mı?"
        if (-not (Onay $m 'Frez ömrü')) { Yaz "Başlat: frez ömrü uyarısında vazgeçildi ($($dolan -join ' '))"; return $false }
        [Kayit]::Yaz("FREZ ÖMRÜ: ömrü dolmuş frezle başlatıldı (operatör onayladı): $($dolan -join ' ')")
    }
    if ($yakin.Count -gt 0) {
        $m = "Frez ömrüne yaklaştı: $($yakin -join ', ')"
        [Kayit]::Yaz("FREZ ÖMRÜ: $m"); Mesaj-Ekle $m 'Uyari'
        Ui-Bildir $m 'Uyari'
    }
    return $true
}

# frez.omur.ayarla: "T1" -> sayı girişi (dk, 0–100000; virgül/nokta); "T1=1000,5" -> doğrudan (uzaktan / test)
function Frez-Omru-Ayarla([string]$arg) {
    $a = [string]$arg; $deger = $null; $dogrudan = $false
    $i = $a.IndexOf('=')
    if ($i -ge 0) { $dogrudan = $true; $deger = Metin-Sayi ($a.Substring($i + 1).Trim()); $a = $a.Substring(0, $i) }
    $n = Frez-Omru-Takim-No $a
    if ($n -lt 1) { Ui-Bildir "Geçersiz takım: $arg" 'Uyari'; return }
    $k = Frez-Omru-Kayit $n
    if (-not $dogrudan) {
        $deger = Ui-Sayi "T$n frez ömrü (dakika, 0 = girilmedi)" ([double]$k.Omur) 0 $FrezOmruEnCok 1
        if ($null -eq $deger) { return }
    }
    if ($null -eq $deger -or [double]::IsNaN([double]$deger) -or [double]$deger -lt 0 -or [double]$deger -gt $FrezOmruEnCok) { Ui-Bildir "Ömür 0–$([int]$FrezOmruEnCok) dakika olmalı." 'Uyari'; return }
    $eski = [double]$k.Omur
    $k.Omur = [math]::Round([double]$deger, 1, [System.MidpointRounding]::AwayFromZero)
    $script:FrezOmruDolduBildirildi.Remove($n)
    Frez-Omru-Kaydet
    Yaz "Frez ömrü: T$n ömrü $(Frez-Omru-Dk $eski) -> $(Frez-Omru-Dk $k.Omur) dk (kaydedildi; kullanılan $(Frez-Omru-Dk $k.Dakika) dk)"
}

# Sıfırlama izni: iş sürerken (duraklı dahil) bu iş bu frezi kullanıyorsa ya da frez iş milindeyse yapılmaz (süre bölünmesin)
function Frez-Omru-Sifirla-Neden([string]$arg, $c) {
    if (-not $arg) { return '' }
    $n = Frez-Omru-Takim-No $arg
    if ($n -lt 1) { return '' }
    if (-not $c.Suruyor) { return '' }
    $kullanir = (@(Frez-Omru-Is-Takimlari) -contains $n) -or ([int]$script:Hizli.Takim -eq $n)
    if ($kullanir) { return "İş sürüyor ve bu iş T$n frezini kullanıyor: iş bitince sıfırlayın" }
    return ''
}

function Frez-Omru-Sifirla([string]$arg) {
    $n = Frez-Omru-Takim-No $arg
    if ($n -lt 1) { Ui-Bildir "Geçersiz takım: $arg" 'Uyari'; return }
    $k = Frez-Omru-Kayit $n
    $om = if ([double]$k.Omur -gt 0) { " / $(Frez-Omru-Dk $k.Omur) dk ömür" } else { '' }
    if (-not (Normal-Onay 'Yeni frez' "T$n frezi değişti mi?`r`n`r`nKullanılan süre sıfırlanacak: şimdi $(Frez-Omru-Dk $k.Dakika) dk$om.`r`nÖmür ayarı ($(if ([double]$k.Omur -gt 0) { "$(Frez-Omru-Dk $k.Omur) dk" } else { 'girilmedi' })) korunur.`r`n`r`nSıfırlansın mı?")) { return }
    Frez-Omru-Sifirla-Ic $n
}

# Onaysız sıfırlama (onayı çağıran sorar): Frez-Omru-Sifirla ve kırık frez devamı (Devam-Baslat, "Yeni frez takıldı")
function Frez-Omru-Sifirla-Ic([int]$n) {
    if ($n -lt 1) { return }
    $k = Frez-Omru-Kayit $n
    $om = if ([double]$k.Omur -gt 0) { " / $(Frez-Omru-Dk $k.Omur) dk ömür" } else { '' }
    $eski = [double]$k.Dakika
    $k.Dakika = 0.0
    $k.Sifirlama = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss', $script:FrezOmruIc)
    $script:FrezOmruDolduBildirildi.Remove($n)
    if ($script:FrezOmruSonTakim -eq $n) { $script:FrezOmruSonAn = -1.0 }
    Frez-Omru-Kaydet
    Yaz "Frez ömrü: T$n sıfırlandı (yeni frez). Eski kullanım $(Frez-Omru-Sayi $eski) dk$om."
}

# MakineDurumu.FrezOmurleri: T1–T6 her zaman, diğerleri yalnız dakikası > 0 ise
function Frez-Omru-Liste {
    $l = New-Object 'System.Collections.Generic.List[PrimerUI.FrezOmruBilgisi]'
    $no = @(1, 2, 3, 4, 5, 6) + @($script:FrezOmru.Keys | Where-Object { $_ -gt 6 -and [double]$script:FrezOmru[$_].Dakika -gt 0 } | Sort-Object)
    foreach ($n in $no) {
        $dk = 0.0; $om = 0.0; $sf = ''
        if ($script:FrezOmru.ContainsKey($n)) {
            $k = $script:FrezOmru[$n]; $dk = [double]$k.Dakika; $om = [double]$k.Omur
            $sf = Frez-Omru-Tarih ([string]$k.Sifirlama)
        }
        $l.Add((New-Object PrimerUI.FrezOmruBilgisi([int]$n, $dk, $om, $sf)))
    }
    return , $l
}
# 'yyyy-MM-dd HH:mm:ss' -> 'dd.MM.yyyy HH:mm' (ekran)
function Frez-Omru-Tarih([string]$s) {
    $t = [datetime]::MinValue
    if ([datetime]::TryParseExact($s, 'yyyy-MM-dd HH:mm:ss', $script:FrezOmruIc, [System.Globalization.DateTimeStyles]::None, [ref]$t)) { return $t.ToString('dd.MM.yyyy HH:mm', $script:FrezOmruIc) }
    return $s
}

# Uzaktan durum JSON'u: iş milindeki frezin ömrü (yoksa $null)
function Frez-Omru-Uzak([int]$tk) {
    if ($tk -lt 1 -or -not $script:FrezOmru.ContainsKey($tk)) { return $null }
    $k = $script:FrezOmru[$tk]; $y = Frez-Omru-Yuzde $tk
    return [ordered]@{ takim = $tk; dakika = [math]::Round([double]$k.Dakika, 1); omur = [double]$k.Omur; yuzde = $(if ($y -lt 0) { $null } else { [int][math]::Floor($y) }) }
}

# DEMO: örnek veri (yalnız demo veri klasöründe dosya yoksa; gerçek frez_omru.json'a hiç dokunulmaz)
function Frez-Omru-Demo-Hazirla {
    if ([System.IO.File]::Exists($FrezOmruDosyasi) -or $script:FrezOmru.Count -gt 0) { return }
    $ornek = @(@(1, 412.6, 1200, -18), @(2, 912.0, 1000, -30), @(3, 1043.0, 1000, -46), @(4, 156.2, 1500, -6), @(5, 37.5, 0, 0), @(6, 655.0, 1000, -23))
    foreach ($o in $ornek) {
        $sf = ''; if ($o[3] -ne 0) { $sf = (Get-Date).Date.AddDays($o[3]).AddHours(8).ToString('yyyy-MM-dd HH:mm:ss', $script:FrezOmruIc) }
        $script:FrezOmru[[int]$o[0]] = @{ Dakika = [double]$o[1]; Omur = [double]$o[2]; Sifirlama = $sf }
    }
    Frez-Omru-Kaydet
    [Kayit]::Yaz('DEMO: frez ömrü örnek verileri yazıldı (demo_calisma\frez_omru.json)')
}
