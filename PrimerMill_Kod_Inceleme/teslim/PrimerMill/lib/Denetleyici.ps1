# Denetleyici.ps1 - PrimerMill 2 denetleyicisi: görünüm (ui/PrimerUI.cs) ile mantık (lib/*.ps1) arasındaki tek köprü.
#  - Zamanlayici-Tik: TEK ana zamanlayıcı (200 ms, yeniden girişe karşı korumalı). Eski panelin 6 zamanlayıcısını
#    (ana 1 sn, koordinat 50 ms, Eding gizleme 250 ms, uzak 200 ms, manuel 400 ms, prob 120 ms) aynı sıklıklarla çağırır.
#  - Durum-Topla: her tıkta PrimerUI.MakineDurumu doldurur -> Ui-Uygula (kabuk: Kabuk.Uygula).
#  - Izin-Hesapla: durum x komut izin tablosu (TASARIM §7). Yerel düğme, klavye ve uzaktan komut aynı tablodan geçer.
#  - Komut-Isle: Kabuk.Komut olayındaki her komutu mantık fonksiyonuna bağlar ($script:Komutlar).
# Arayüze yalnız kapı fonksiyonlarıyla (Ui-*) ulaşılır; kabukta lib/ArayuzKapisi.ps1, testlerde sahte fonksiyonlar.
# PowerShell 5.1 (32 bit) uyumlu.

# ------------------------------------------------------------------ denetleyici durumu
$script:EtkinEkran = 'uretim'
$script:IslemSuruyor = $false      # panelden başlatılan bir işlem (home, takım değişimi, kalibrasyon ...) sürüyor
$script:IslemAdi = ''
$script:TikNo = 0
$script:TikMesgul = $false
$script:TikSonraki = ''
$script:ManuelTikMesgul = $false
$script:EdingKapatildi = $false    # Ayarlar › Eding › KAPAT: bekçi Eding'i kendiliğinden yeniden açmaz
$script:Hizli = @{ Durum = ''; Calisiyor = $false; Durakli = $false; Hatali = $false; Acil = $false; Home = $false; Takim = 0; Okundu = $false }
$script:Konum = @{ X = 0.0; Y = 0.0; Z = 0.0; A = 0.0; B = 0.0; MX = 0.0; MY = 0.0; MZ = 0.0; MA = 0.0; MB = 0.0 }
$script:TeknikMetni = ''
$script:EdingSim = $false
$script:HizYuzde = 100
$script:IsMiliHiz = 0.0
$script:MesgulMetni = $null
$script:IzinImza = ''
$script:Demo = [bool]$script:Demo
# Kalibrasyon sihirbazları (adım denetleyicinindir; görünüm ileri/geri/adim komutu gönderir)
$script:DiskAdim = 0
$script:OtoAdim = 0
$script:DiskTestNo = 1
$script:DiskOlcum = @{}
$script:DiskSonucHazir = $false
$script:DiskSonucSatirlari = @()
$script:DiskUyarilar = @()
$script:OtoSonucHazir = $false
$script:OtoOlcumBitti = $false
$script:OtoSonucSatirlari = @()
$script:OtoKaliteSatirlari = @()
$script:OtoUyarilar = @()
$script:YuvaZ = $false
$script:YuvaListesi = $null
$script:G54Deger = $null; $script:ParamDeger = $null; $script:G92Deger = $null; $script:DegiskenlerOkundu = $false
$script:SonYedekDosya = ''
$script:Yuzde = 0.0; $script:IsTamamlandi = $false; $script:KalanSn = 0; $script:BitisSaati = ''; $script:IsSatir = 0; $script:IsToplamSatir = 0
$script:SureMetni = ''; $script:SureTur = 'Bilgi'; $script:DosyaMetni = ''
$script:BlokDurumMetni = ''
$script:BlokSonrakiOnbellek = @{ Zaman = [datetime]::MinValue; Deger = '' }
$script:KayitSurum = 0

# Eski panelin dosya yüklemesinden hemen sonra çalışan açılış satırları (Tercih-Oku ve sonrası) BİREBİR; yalnız fonksiyona sarıldı
# (önyükleme Kayit / [Eding] hazır olduktan sonra çağırır). Yeni-Pin tanımı Cekirdek.ps1'de.
function Tercih-Baslangic {
    Tercih-Oku
    if ($script:Sade) { $script:Tercih.ModSor = '0'; $script:Tercih.BlokSor = '0'; $script:Tercih.EdingSifirla = '0' }
    if (-not $script:Tercih.ContainsKey('Uzak')) { $script:Tercih.Uzak = $(if ($script:Sade) { '1' } else { '0' }) }
    if (-not $script:Tercih.ContainsKey('UzakKilit')) { $script:Tercih.UzakKilit = '1' }
    # UZ-03: uzaktan erişim PIN'i en az 6 hane; boş PIN asla "PIN'siz" demek değildir. Kısa/boşsa rastgele yenisi üretilir.
    if ([string]$script:Tercih.WebPin -notmatch '^\d{6,8}$') {
        $script:Tercih.WebPin = Yeni-Pin; Tercih-Yaz
        [Kayit]::Yaz("UZAK: PIN boş ya da 6 haneden kısaydı, yeni 6 haneli PIN üretildi (Uzaktan ekranında görünür)")
    }
    # Frez değişimi: OTOMATİK (magazin) / MANUEL (frezleri elle takarım) — Ayarlar › İş akışı'ndan bir kez seçilir, kayıtlı kalır
    if (@('OTOMATIK', 'MANUEL') -notcontains [string]$script:Tercih.FrezModu) { $script:Tercih.FrezModu = 'OTOMATIK' }
    $script:Manuel = ($script:Tercih.FrezModu -eq 'MANUEL')
    if (-not $script:Tercih.MakineAdi) { $script:Tercih.MakineAdi = "$env:COMPUTERNAME" }
    # Bu makinenin macro.cnc'si PrimerMill'in özel makrosu mu (manuel değişim, yuva/sensör ayarları)? Orijinal makroda bu bölümler gizlenir.
    $script:OzelMakro = $false
    try {
        $mt = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'))
        $script:OzelMakro = ($mt -match '(?im)^\s*sub\s+manual_change\b')
    } catch { }
    if ($script:Tercih.AcilStop -eq '1') { [Eding]::AcilKilit = $true; $script:AcilisDurum = 'iptal' }
    $script:TakimBelirsiz = ($script:Tercih.TakimBelirsiz -eq '1')   # GV-08
    if ($script:Tercih.OtomatikHazirlik -ne '1') { $script:AcilisDurum = 'iptal' }
    # Yeni arayüz: sihirbaz başlangıç değerleri (eski pencere kutularının açılış değerleri)
    $script:KoordMakine = ($script:Tercih.Koordinat -eq 'MAKINE')
    $kt = 1; try { $kt = [int]$script:Tercih.KalTest + 1 } catch { }; if ($kt -lt 1 -or $kt -gt 4) { $kt = 1 }
    $script:DiskTestNo = $kt
    foreach ($ad in $KalOlcumTanim.Keys) { $script:DiskOlcum[$ad] = [string]$KalOlcumTanim[$ad][1] }
    Frez-Omru-Yukle   # frez ömrü (lib/FrezOmru.ps1): $ScriptKlasor\frez_omru.json
}

# ------------------------------------------------------------------ işlem koruması
# Panelden başlayan uzun işlemler (Hareket-Bitene-Kadar-Bekle, diyaloglar) sırasında Ui-Olaylar mesaj döngüsünü işletir:
# ana zamanlayıcı ekranı güncellemeye devam eder ama ikinci bir komut başlamaz (yalnız ACİL STOP, ekran değiştirme, hız).
function Islem-Calistir([string]$ad, [scriptblock]$is) {
    $onceki = $script:IslemSuruyor; $oncekiAd = $script:IslemAdi
    $script:IslemSuruyor = $true; $script:IslemAdi = $ad
    try { & $is } finally { $script:IslemSuruyor = $onceki; $script:IslemAdi = $oncekiAd }
}

# ------------------------------------------------------------------ Eding okuma
# Her tıkta (200 ms): durum, konumlar, takım. Eski koordinat zamanlayıcısı (50 ms) ve izin tablosu bunu kullanır.
function Okuma-Yap {
    $h = $script:Hizli
    $h.Okundu = $false
    if (-not $script:ApiHazir -or -not $script:Bagli) { $h.Durum = ''; $h.Calisiyor = $false; $h.Durakli = $false; $h.Hatali = $false; $h.Acil = $false; $h.Home = $false; return }
    try {
        $d = Eding-Durum
        $h.Durum = $d
        $pz = 0; try { $pz = [Eding]::CncGetPauseStatus() } catch { }
        $h.Durakli = ($d -like 'PAUSE*')   # CncGetPauseStatus() bu Eding'de READY'de de, kazırken de 0 dışı dönüyor (dizüstü denemesi): yalnız durum metni
        $h.Calisiyor = (Mesgul $d)
        $h.Hatali = (Hatali $d)
        $h.Acil = ([Eding]::CncGetEMStopActive() -ne 0)
        $h.Home = ([Eding]::CncGetAllAxesHomed() -ne 0)
        $h.Takim = [int][Eding]::CncGetCurrentToolNumber()
        $h.Okundu = ($d -ne '')
        try {
            $w = [Eding]::WorkPos(); $m = [Eding]::MachinePos()
            $k = $script:Konum
            $k.X = $w.X; $k.Y = $w.Y; $k.Z = $w.Z; $k.A = $w.A; $k.B = $w.B
            $k.MX = $m.X; $k.MY = $m.Y; $k.MZ = $m.Z; $k.MA = $m.A; $k.MB = $m.B
        } catch { }
    } catch { $h.Okundu = $false }
}

# Eski ana zamanlayıcının gövdesi (1 sn). Etiket / lamba / düğme yazıları yerine durum değişkenleri; mantık aynı:
# ACİL STOP bekçisi (kilitliyken Eding hareket ederse tekrar keser), durum satırı, hız, simülasyon, ilerleme, manuel istek,
# yuva denetimi, açılış hazırlığı / makro denetimi sırası (TikSonraki).
# SK-01: Baglanti-Bekcisi (Eding'i başlatma, program seçme penceresi, KillCNC beklemesi) artık burada değil: Zamanlayici-Tik onu
# ana korumanın DIŞINDA, Ana-Tik'ten hemen önce çalıştırır. Buradan açılan bilgi/hata pencereleri (iş sonu EXTERR / freze / Eding
# hatası) Ui-Kutu'da ertelenir ve korumadan sonra gösterilir (Tik-Sonrasi-Calistir).
function Ana-Tik {
    Hatalari-Kaydet
    $script:ManuelMesajMetni = ''; $script:HavaYok = $false
    if (-not $script:ApiHazir) { Durum-Yaz 'Önizleme modu' $cSoluk; $script:TeknikMetni = "Bu bilgisayarda $EdingKlasor\cncapi.dll yok. Sadece dosya kontrolü yapılabilir."; return }
    if (-not (Baglan)) { Durum-Yaz 'Makine bağlı değil' $cKirmizi; $script:TeknikMetni = "Eding CNC kapalı ya da bağlanılamadı."; return }
    try {
        $durum     = Eding-Durum
        if ($durum -ne $script:SonEdingDurum) { [Kayit]::Yaz("EDING DURUMU: $script:SonEdingDurum -> $durum"); $script:SonEdingDurum = $durum }
        $durakli   = ($durum -like 'PAUSE*')
        $calisiyor = (Mesgul $durum)
        $hatali    = (Hatali $durum)
        $acil      = ([Eding]::CncGetEMStopActive() -ne 0)
        $homeTamam      = ([Eding]::CncGetAllAxesHomed() -ne 0)
        $takim     = [Eding]::CncGetCurrentToolNumber()

        $tStr = if ($takim -gt 0) { "   ·   T$takim" } else { '' }
        if ([Eding]::AcilKilit) {
            if ($calisiyor) { [Kayit]::Yaz("ACİL STOP basılıyken Eding hareket etti ($durum): tekrar kesiliyor"); Acil-Stop 'bekçi' }
            Durum-Yaz 'ACİL STOP  ·  kaldırmak için KİLİDİ KALDIR' $cKirmizi
        }
        elseif ($hatali -and -not $acil) { Durum-Yaz 'Eding hatası  ·  RESET' $cKirmizi }
        elseif ($acil)      { Durum-Yaz 'Makine hata sinyali (EXTERR)  ·  RESET' $cKirmizi }
        elseif ($durakli)   { Durum-Yaz "Duraklatıldı$tStr" $cAltinAc }
        elseif ($calisiyor) { Durum-Yaz $(if ($script:IsAktif) { "Kazınıyor$tStr" } else { "Hareket ediyor$tStr" }) $cYesil }
        elseif (-not $homeTamam) { Durum-Yaz 'Home alınmadı' $cAltinAc }
        elseif ($script:OzelMakro -and $script:RafEksik) { Durum-Yaz 'Takım yuvaları/sensör kayıtlı değil: Takımlar › Yuva ayarı' $cAltinAc }
        else                { Durum-Yaz "Hazır$tStr" $cSoluk }

        try { $script:HizYuzde = [int](Hiz-Oku) } catch { }
        $sim2 = $false; try { $sim2 = ([Eding]::CncGetSimulationMode() -ne 0) } catch { }
        $script:EdingSim = $sim2
        try { $script:IsMiliHiz = [double][Eding]::CncGetActualSpeed() } catch { }

        $script:TeknikMetni = "Eding: $([Eding]::StateText([Eding]::CncGetState()))   ·   Home: $(if ($homeTamam) {'tamam'} else {'alınmadı'})   ·   Takım: T$takim   ·   Acil stop: $(if ($acil) {'BASILI'} else {'yok'})`r`n" +
                          "Ayarlı frezeler: $((($AyarliTakimlar | ForEach-Object { "T$_" }) -join ', '))   ·   Kayıt klasörü: $IsKlasor`r`n" + $script:DetayIlerleme
        if (-not $script:IsAktif) { $script:DetayIlerleme = "Güncel satır: $([Eding]::CncGetCurExecLine())" }
        Ilerleme-Guncelle $calisiyor $durakli
        Frez-Modu-Goster
        $ist = $null; try { $ist = Manuel-Istek } catch { }
        if ($ist -and -not [Eding]::AcilKilit) {
            $mt = switch ($ist.Faz) { 1 { "MANUEL FREZ: T$($ist.Eski) → T$($ist.T)  ·  frezi tut, PENS'İ AÇ" } 2 { "MANUEL FREZ: T$($ist.T) TAK  ·  sonra TAKTIM" } 4 { "MANUEL FREZ: T$($ist.T) takıldı  ·  KAZIMAYA BAŞLA onayı bekleniyor" } default { "MANUEL FREZ: hava basıncı yok  ·  KOMPRESÖRÜ AÇ (pens havayla açılır)" } }
            Durum-Yaz $mt $(if ($ist.Faz -eq 3) { $cKirmizi } else { $cAltinAc })
            $script:ManuelMesajMetni = ($mt -replace '^MANUEL FREZ:\s*', ''); $script:HavaYok = ($ist.Faz -eq 3)
        }
        if ($script:OzelMakro -and -not $hatali -and $durum -ne 'POWERUP' -and $durum -ne '') { Raf-Kontrol }
        if ($script:AcilisDurum -ne 'tamam' -and $script:AcilisDurum -ne 'iptal' -and $script:AcilisDurum -ne 'calisiyor') { $script:TikSonraki = 'acilis' }
        elseif (($script:AcilisDurum -eq 'tamam' -or $script:AcilisDurum -eq 'iptal') -and -not $script:MakroKontrolTamam -and -not $calisiyor -and -not $durakli -and -not $hatali -and $durum -ne 'POWERUP' -and $durum -ne '' -and -not $script:IsAktif) { $script:TikSonraki = 'makro' }
        # Ekrana göre ara sıra okunanlar (Kalibrasyon / Ayarlar / Takımlar)
        if (($script:TikNo % 10) -eq 1) {
            if (@('kalibrasyon', 'ayarlar') -contains $script:EtkinEkran -and -not $calisiyor) { try { Ayar-Oku; Kal-Degerleri-Goster; OtoKal-Goster } catch { } }
            if ($script:EtkinEkran -eq 'takimlar') { try { Yuva-Liste-Yenile } catch { } }
        }
    } catch { Durum-Yaz 'Durum okunamadı' $cKirmizi; $script:TeknikMetni = $_.Exception.Message }
}

# ------------------------------------------------------------------ ana zamanlayıcı (200 ms)
# SK-01 kuralları:
#  - Korumalı blok (Ana-Tik, Eding-Gizle-Tik, Okuma-Yap, Durum-Yenile) modal pencere açmaz, uzun iş yapmaz. İçinden gelen
#    Ui-Kutu bilgi/hata pencereleri ($script:TikSonrasiKutular) ve kullanıcı komutları ($script:KomutKuyrugu) ertelenir.
#  - Korumalı bloğun içinden (Yaz -> Ui-Olaylar -> DoEvents) iç içe gelen tık HİÇBİR ŞEY çalıştırmaz: uzaktan komut, manuel
#    izleme, açılış hazırlığı korumanın içinde başlayamaz.
#  - Diyalog açabilen / uzun işler (bekçi, prob, uzak, manuel, açılış, ertelenenler) korumanın DIŞINDA: o diyalog açıkken
#    gelen tıklar korumalı bloğu çalıştırır, ekran (durum, konum, izinler) ve ACİL STOP bekçisi işlemeye devam eder.
$script:BekciMesgul = $false
$script:KuyrukMesgul = $false
$script:KomutKuyrugu = New-Object System.Collections.Generic.List[object]
function Zamanlayici-Tik {
    $script:TikNo++
    if ($script:TikMesgul) { return }   # korumalı bloğun içinden iç içe gelen tık
    $anaTik = (($script:TikNo % 5) -eq 1)
    if ($anaTik -and -not $script:EdingKapatildi -and -not $script:BekciMesgul) {
        # eski Ana-Tik'in ilk satırı (Baglanti-Bekcisi): kendi koruması ve işlem bayrağıyla (iç içe açılış / manuel başlamasın)
        $script:BekciMesgul = $true
        try { Islem-Calistir 'Eding bağlantısı' { Baglanti-Bekcisi } } catch { try { [Kayit]::Yaz("BEKÇİ: $($_.Exception.Message)") } catch { } }
        finally { $script:BekciMesgul = $false }
    }
    if (-not $script:TikMesgul) {
        $script:TikMesgul = $true
        try {
            if ($anaTik) { $script:TikSonraki = ''; Ana-Tik }   # eski ana zamanlayıcı: 1 sn
            try { Eding-Gizle-Tik } catch { }                                     # eski: 250 ms
            Okuma-Yap                                                              # eski koordinat: 50 ms
            try { Carpisma-Bekci } catch { try { [Kayit]::Yaz("ÇARPIŞMA BEKÇİSİ: $($_.Exception.Message)") } catch { } }   # takım boyu (lib/Makine.ps1)
            try { Frez-Omru-Tik } catch { }                                        # frez ömrü: yalnız RUNNING + iş + takım (lib/FrezOmru.ps1)
            Durum-Yenile
        } catch { try { [Kayit]::Yaz("ZAMANLAYICI: $($_.Exception.Message)") } catch { } }
        finally { $script:TikMesgul = $false }
    }
    # Diyalog açabilen işler ana korumanın DIŞINDA ve kendi korumalarıyla (ED-07): diyalog açıkken ekran güncellenmeye devam eder
    try { Prob-Tik } catch { }                                                     # eski: 120 ms
    try { Uzak-Tik } catch { }                                                     # eski: 200 ms
    if ($script:Kiosk) { try { Kiosk-Tik } catch { } }                             # kiosk: panele dönüş (lib/Kiosk.ps1)
    if ($script:OzelMakro -and (($script:TikNo % 2) -eq 0) -and -not $script:ManuelTikMesgul -and -not $script:IslemSuruyor) {   # eski: 400 ms
        $script:ManuelTikMesgul = $true
        try { Islem-Calistir 'Manuel frez değişimi' { Manuel-Izle } } finally { $script:ManuelTikMesgul = $false }
    }
    $sonraki = $script:TikSonraki
    if ($sonraki -and -not $script:IslemSuruyor) {
        $script:TikSonraki = ''
        try {
            if ($sonraki -eq 'acilis') { Yuva-Hedefi-Unut $true; Islem-Calistir 'Açılış hazırlığı' { Acilis-Hazirla } }
            elseif ($sonraki -eq 'makro') { Islem-Calistir 'Makro denetimi' { Makro-Baslangic-Kontrol } }
        } catch { [Kayit]::Yaz("ZAMANLAYICI ($sonraki): $($_.Exception.Message)") }
    }
    Tik-Sonrasi-Calistir
    # çarpışma bekçisi işi duraklattıysa: DURDUR / DEVAM sorusu korumanın dışında
    if ($script:CarpAlarm -and -not $script:IslemSuruyor -and -not $script:TikMesgul) {
        try { Islem-Calistir 'Çarpışma uyarısı' { Carpisma-Alarm-Isle } } catch { try { [Kayit]::Yaz("ÇARPIŞMA UYARISI: $($_.Exception.Message)") } catch { } }
    }
}

# SK-01: korumalı blok sırasında gelen komutlar ve ertelenen pencereler, koruma bırakıldıktan hemen sonra.
# Komutlar her zamanki Komut-Isle denetiminden geçer (o an bir işlem sürüyorsa doğrudan basılmış gibi reddedilir);
# 3 sn'den eski komut çalıştırılmaz (bekletilmiş bir hareket geç başlamasın). Pencereler tek tek (iç içe değil) gösterilir.
function Tik-Sonrasi-Calistir {
    if ($script:TikMesgul) { return }
    # SK-15: öncelikli (DURDUR) bekçi sürerken de beklemez
    while ($script:KomutKuyrugu.Count -gt 0 -and $script:KomutKuyrugu[0].Oncelikli) {
        $k = $script:KomutKuyrugu[0]; $script:KomutKuyrugu.RemoveAt(0)
        try { [void](Komut-Isle $k.Ad $k.Arg $k.Kaynak) } catch { try { [Kayit]::Yaz("ERTELENEN KOMUT: $($_.Exception.Message)") } catch { } }
    }
    if ($script:BekciMesgul) { return }
    while ($script:KomutKuyrugu.Count -gt 0) {
        $k = $script:KomutKuyrugu[0]; $script:KomutKuyrugu.RemoveAt(0)
        if (-not $k.Oncelikli -and ((Get-Date) - $k.Zaman).TotalSeconds -gt 3) {
            [Kayit]::Yaz("KOMUT ZAMAN AŞIMI (ertelenmişti): $($k.Ad) $($k.Arg)")
            Ui-Bildir "Komut zamanında işlenemedi, yeniden basın: $($k.Ad)" 'Uyari'
            continue
        }
        try { [void](Komut-Isle $k.Ad $k.Arg $k.Kaynak) } catch { try { [Kayit]::Yaz("ERTELENEN KOMUT: $($_.Exception.Message)") } catch { } }
    }
    if ($script:KuyrukMesgul -or $script:TikSonrasiKutular.Count -eq 0) { return }
    $script:KuyrukMesgul = $true
    try {
        while ($script:TikSonrasiKutular.Count -gt 0) {
            $p = $script:TikSonrasiKutular[0]; $script:TikSonrasiKutular.RemoveAt(0)
            try { [void](Ui-Kutu $p.Metin $p.Baslik $p.Dugme $p.Simge) } catch { try { [Kayit]::Yaz("ERTELENEN PENCERE: $($_.Exception.Message)") } catch { } }
        }
    } finally { $script:KuyrukMesgul = $false }
}

# Komut sonrası ve her tıkta: durum nesnesi ve izin tablosu görünüme
function Durum-Yenile {
    $d = Durum-Topla
    Ui-Uygula $d
    $iz = Izin-Hesapla
    $imza = (@($iz.Keys | Sort-Object | ForEach-Object { "$_=$($iz[$_])" }) -join '|')
    if ($imza -ne $script:IzinImza) { $script:IzinImza = $imza; Ui-Izin $iz }
}

# ------------------------------------------------------------------ izin tablosu
$script:IzinMetni = @{
    Oniz = 'Önizleme modu: bu bilgisayarda Eding yok'
    Acil = 'ACİL STOP basılı: önce KİLİDİ KALDIR'
    Bagli = 'Eding bağlı değil'
    Calis = 'İş sürüyor: yalnız DURAKLAT, DURDUR, ACİL STOP ve hız'
    Durak = 'İş duraklatıldı: yalnız DEVAM, DURDUR, ACİL STOP ve hız'
    Hareket = 'Makine hareket ediyor: bitmesini bekleyin'
    Home = 'Home alınmadı: önce HOME'
    Raf = 'Takım yuvaları / sensör kayıtlı değil: Takımlar › Yuva ayarı'
    Dosya = 'Önce bir iş seçin (İŞ SEÇ)'
    Engel = 'Dosyada hata var: iş kartındaki uyarı düğmesine bakın'
    Yok = 'Çalışan iş yok'
    Sade = 'Sade akışta kapalı (yerine YENİ BLOK ve Ayarlar › İş akışı)'
    Islem = 'Panel işlemi sürüyor ({0}): bitmesini bekleyin'
    Kiosk = "Kiosk modunda küçültülemez: Windows için Ayarlar › Genel › WINDOWS'A GEÇ"
    KioskYok = 'Kiosk modu kapalı: Windows zaten erişilebilir (kurulum: KIOSK_KUR.bat)'
}
function Makro-Neden { return "Eding'deki macro.cnc sürümü uyumsuz (beklenen $BeklenenMakroSurum): Ayarlar › Eding › YENİDEN BAŞLAT" }

# Komut tablosu. Tur:
#   serbest : makineye dokunmaz (ekran, sihirbaz gezinmesi, tercih, okuma) — her zaman
#   is      : iş kontrolü (duraklat / durdur / devam / hız) — kendi kuralı
#   makine  : Eding'e komut / yazma — bağlı, ACİL STOP yok, iş sürmüyor / duraklı değil
#   hareket : makine + home alınmış (eski Hazir-Mi / Hazir-Hareket kullananlar)
#   yok     : görünümde var, denetleyici henüz desteklemiyor (pasif, nedeniyle)
# Raf: takım yuvaları kayıtlı olmalı (K5), Makro: Eding'deki makro sürümü beklenen (K6), IcIce: başka işlem sürerken de çalışır.
$script:Komutlar = [ordered]@{}
function Komut-Tanimla([string]$ad, [string]$tur, [scriptblock]$is, [switch]$Raf, [switch]$Makro, [switch]$IcIce, [scriptblock]$Ek = $null) {
    $script:Komutlar[$ad] = @{ Tur = $tur; Is = $is; Raf = [bool]$Raf; Makro = [bool]$Makro; IcIce = [bool]$IcIce; Ek = $Ek }
}

function Izin-Baglam {
    $h = $script:Hizli
    $suruyor = $script:IsAktif -or $h.Calisiyor -or $h.Durakli
    return @{
        Oniz = (-not $script:ApiHazir); Bagli = ($script:ApiHazir -and $script:Bagli); Acil = [bool][Eding]::AcilKilit
        Calis = (($h.Calisiyor -or $script:IsAktif) -and -not $h.Durakli); Durak = [bool]$h.Durakli; Suruyor = [bool]$suruyor
        IsAktif = [bool]$script:IsAktif; Home = [bool]$h.Home; Raf = ($script:OzelMakro -and $script:RafEksik)
        Makro = ($script:OzelMakro -and $script:MakroSurumUyumsuz)
    }
}

# Bir komutun şu an neden yapılamayacağı ('' = yapılabilir). $c: Izin-Baglam (verilmezse şimdi okunur).
function Izin-Neden([string]$ad, [string]$arg = '', $c = $null) {
    $t = $script:Komutlar[$ad]
    if (-not $t) { return "Bilinmeyen komut: $ad" }
    if ($null -eq $c) { Okuma-Yap; $c = Izin-Baglam }
    $R = $script:IzinMetni
    switch ($t.Tur) {
        'serbest' { }
        'yok' { if ($t.Ek) { return [string](& $t.Ek $arg $c) }; return 'Bu sürümde yok' }
        'is' { }
        default {
            if ($c.Oniz) { return $R.Oniz }
            if ($c.Acil -and $ad -ne 'makine.reset') { return $R.Acil }
            if (-not $c.Bagli) { return $R.Bagli }
            if ($c.Calis) { if ($c.IsAktif) { return $R.Calis }; return $R.Hareket }
            if ($c.Durak) { return $R.Durak }
            if ($t.Tur -eq 'hareket' -and -not $c.Home) { return $R.Home }
            if ($t.Raf -and $c.Raf) { return $R.Raf }
            if ($t.Makro -and $c.Makro) { return (Makro-Neden) }
        }
    }
    if ($t.Ek) { $n = [string](& $t.Ek $arg $c); if ($n) { return $n } }
    return ''
}

# Görünüme giden tablo: yalnız pasif komutlar (anahtar -> neden). Tabloda olmayan komut etkindir (ARAYUZ_API §6).
function Izin-Hesapla {
    $c = Izin-Baglam
    $sonuc = @{}
    foreach ($ad in $script:Komutlar.Keys) {
        $n = Izin-Neden $ad '' $c
        if ($n) { $sonuc[$ad] = $n }
    }
    # argümana göre ayrı anahtarlar
    if ($c.Suruyor) { $sonuc['ayar.kaydet:FrezModu'] = $(if ($c.Durak) { $script:IzinMetni.Durak } else { $script:IzinMetni.Calis }) }
    foreach ($k in @('ModSor', 'BlokSor', 'EdingSifirla')) { if ($script:Sade) { $sonuc["ayar.kaydet:$k"] = $script:IzinMetni.Sade } }
    if ($script:OtoAdim -ge 1 -and -not (Prob-Gecti)) { $sonuc['kal.oto.ileri'] = 'Prob testi zorunlu: önce PROB TESTİNİ BAŞLAT, TEMAS VAR görün'; foreach ($i in 2..4) { $sonuc["kal.oto.adim:$i"] = $sonuc['kal.oto.ileri'] } }
    # Görünüm yalnız izin anahtarı olarak kullanır (komutu diyaloğun sonucu gönderir)
    $by = Izin-Neden 'blok.yenihazir' '' $c; if ($by) { $sonuc['blok.yeni'] = $by }
    # Frez ömrü sıfırlama: iş sürerken, işin kullandığı / iş milindeki frez için düğme başına pasif (frez.omur.sifirla:T3)
    if ($c.Suruyor) { foreach ($i in 1..6) { $n = Frez-Omru-Sifirla-Neden "T$i" $c; if ($n) { $sonuc["frez.omur.sifirla:T$i"] = $n } } }
    return $sonuc
}

# K8: son 10 dk içinde TEMAS görüldü ve şu an TEMAS YOK (OtoKal-Prob-Gecerli-Mi ile aynı kural, diyalogsuz)
function Prob-Gecti {
    if ($script:ProbTemasAni -eq [datetime]::MinValue) { return $false }
    if (((Get-Date) - $script:ProbTemasAni).TotalMinutes -gt 10) { return $false }
    if ($script:ProbAktif) { return (-not $script:ProbTemasVar) }
    return ((OtoKal-Prob-Aktif-Mi) -eq $false)
}

# ------------------------------------------------------------------ komut dağıtıcı
# Dönüş: $true (çalıştı), ya da reddedildiyse nedeni (string). Hata yakalanır, günlüğe ve alt şeride yazılır.
function Komut-Isle([string]$ad, [string]$arg = '', [string]$kaynak = 'yerel') {
    if ($null -eq $arg) { $arg = '' }
    [Kayit]::Yaz("KOMUT ($kaynak): $ad $arg")
    if ($ad -eq 'acilstop') {   # anında, hiçbir denetim yok
        try { Acil-Stop $(if ($kaynak -eq 'yerel') { 'buton' } else { $kaynak }) } finally { try { Durum-Yenile } catch { } }
        return $true
    }
    # SK-01: ana zamanlayıcının korumalı bloğu ya da bağlantı bekçisi sürerken (DoEvents ile) gelen komut iç içe çalışmaz:
    # sıraya alınır, koruma bırakılınca Tik-Sonrasi-Calistir çalıştırır. ACİL STOP (yukarıda) hiç beklemez.
    # SK-15: DURDUR korumalı blok içinde onay sorusunu (ertelenemez) açmasın: sıranın BAŞINA, öncelikli (zaman aşımı yok),
    # koruma bırakılınca (ms) ilk o çalışır. Yalnız bekçi sürerken (korumanın dışında) DURDUR hemen işlenir.
    if ($script:TikMesgul -or $script:BekciMesgul) {
        if ($ad -ne 'is.durdur') {
            $script:KomutKuyrugu.Add(@{ Ad = $ad; Arg = $arg; Kaynak = $kaynak; Zaman = (Get-Date); Oncelikli = $false })
            [Kayit]::Yaz("KOMUT ERTELENDİ (zamanlayıcı işi sürüyor): $ad $arg")
            return $true
        }
        if ($script:TikMesgul) {
            $script:KomutKuyrugu.Insert(0, @{ Ad = $ad; Arg = $arg; Kaynak = $kaynak; Zaman = (Get-Date); Oncelikli = $true })
            [Kayit]::Yaz("KOMUT ÖNCELİKLİ SIRADA (zamanlayıcı koruması bitince ilk): $ad $arg")
            return $true
        }
    }
    $t = $script:Komutlar[$ad]
    if (-not $t) { $n = "Bilinmeyen komut: $ad"; [Kayit]::Yaz("KOMUT: $n"); Ui-Bildir $n 'Uyari'; return $n }
    $mesgul = $script:IslemSuruyor -or $script:UzakMesgul -or $script:ManuelTikMesgul
    if ($mesgul -and -not $t.IcIce) {
        $n = "Önceki işlem sürüyor ($(if ($script:IslemAdi) { $script:IslemAdi } else { 'uzaktan komut' })): bitmesini bekleyin"
        [Kayit]::Yaz("KOMUT REDDİ: $ad -> $n"); Ui-Bildir $n 'Uyari'; return $n
    }
    $n = Izin-Neden $ad $arg
    if ($n) { [Kayit]::Yaz("İZİN YOK: $ad $arg -> $n"); Ui-Bildir $n 'Uyari'; return $n }
    # SK-02: makineye dokunan her komut (hareket etmeyenler listede) son YUVAYA GİT hedefini unutturur; jog yalnız
    # Takım değişimi sayfasınınkini (Yuva ayarı sihirbazında GİT'ten sonra X/Y/Z ile ortalamak işin parçası)
    if ($t.Tur -ne 'serbest' -and $script:YuvaKoruyanKomutlar -notcontains $ad) { Yuva-Hedefi-Unut ($ad -ne 'jog') }
    $sonuc = $true
    try {
        if ($t.Tur -eq 'serbest' -or $t.IcIce) { [void](& $t.Is $arg) }
        else { Islem-Calistir $ad { [void](& $t.Is $arg) } }
    } catch {
        $sonuc = "HATA: $($_.Exception.Message)"
        Yaz "HATA ($ad): $($_.Exception.Message)"
        try { Ui-Hata 'Komut işlenemedi' "$ad : $($_.Exception.Message)" 'Ayrıntı Kayıtlar ekranında ve log dosyasında.' } catch { }
    } finally { try { if (-not $script:IslemSuruyor -and -not $script:SistemKapaniyor) { Ui-Mesgul $null }; if (-not $script:TikMesgul) { Durum-Yenile } } catch { } }   # iç içe (DURDUR, ekran) dıştaki işlemin meşgul yazısını silmesin
    return $sonuc
}

# Yardımcılar
function Arg-Parca([string]$arg, [int]$i) { $p = ([string]$arg).Split('|'); if ($i -lt $p.Length) { return $p[$i] }; return '' }
function Yuva-Adi([string]$ad) {
    # görünüm adı -> eski panel adı
    $a = ([string]$ad).Trim()
    if ($a -like 'ayar:*') { $a = $a.Substring(5) }
    switch ($a.ToUpper([System.Globalization.CultureInfo]::GetCultureInfo('tr-TR'))) { 'SENSÖR' { return 'Sensör' } 'SENSOR' { return 'Sensör' } 'MANUEL' { return 'Değişim' } 'DEĞİŞİM' { return 'Değişim' } }
    if ($a -match '^[Tt]([1-6])$') { return "T$($Matches[1])" }
    return $a
}
function Normal-Onay([string]$baslik, [string]$metin) { return [bool](Ui-Onay $baslik $metin) }

# ------------------------------------------------------------------ SK-02: YAKLAŞ hedefi (MAKİNEDE DOĞRULA)
# YAKLAŞ iş milini O ANKİ X/Y'de yaklaşma yüksekliğine indirir. Yalnız seçili yuva = son YUVAYA GİT yapılan yuva ise
# ve o GİT'ten sonra başka hareket olmadıysa izin verilir. Takım değişimi sayfası: komut listesine ek olarak makine konumu
# GİT bittiği andakiyle aynı olmalı (Eding'den / dışarıdan yapılan hareket de yakalanır). Yuva ayarı sihirbazı: jog serbest.
$script:SonYuvaKonum = $null   # Yuvaya-Git bitince makine konumu (X, Y, Z, A, B)
$script:SonAyarYuva = $null    # Yuva ayarı sihirbazında (ve MANUEL noktasında) son GİT yapılan nokta (Yuva-Git atar)
$script:SonAyarKonum = $null   # SK-16: o GİT bitince makine konumu (X, Y, Z, A, B)
$script:AyarXYSinir = 2.0      # SK-16: sihirbazda GİT'ten sonra ortalama jog'u: GİT noktasından XY uzaklığı en çok (mm)
$script:AyarZABSinir = 0.05    # SK-16: Z / A / B değişmemiş olmalı (mm / °; Z aşağı inmiş olamaz)
$script:YuvaKoruyanKomutlar = @('yuva.git', 'yuva.yaklas', 'pens.ac', 'pens.kapat', 'hava.ufle', 'ismili.calistir', 'ismili.durdur',
    'sogutma.m7', 'sogutma.m8', 'sogutma.kapat', 'yuva.al', 'yuva.kaydet', 'degisken.oku', 'yedek.al', 'hiz.azalt', 'hiz.artir', 'hiz.normal')
function Yuva-Hedefi-Unut([bool]$ayarDa = $true) {
    $script:SonYuva = $null; $script:SonYuvaKonum = $null
    if ($ayarDa) { $script:SonAyarYuva = $null; $script:SonAyarKonum = $null }
}
function Makine-Konum {
    try { $m = [Eding]::MachinePos(); return @([double]$m.X, [double]$m.Y, [double]$m.Z, [double]$m.A, [double]$m.B) } catch { return $null }
}
function Yuva-Gorunen-Adi([string]$ad) { switch ($ad) { 'Sensör' { return 'SENSÖR' } 'Değişim' { return 'MANUEL' } default { return $ad } } }
# '' = YAKLAŞ yapılabilir; değilse Türkçe neden
function Yaklas-Neden([string]$ad, [bool]$ayar) {
    $g = Yuva-Gorunen-Adi $ad
    $son = $(if ($ayar) { $script:SonAyarYuva } else { $script:SonYuva })
    if (-not $ad -or -not $son -or $son -ne $ad) {
        return "Önce bu yuvaya GİT: $g.`r`nYAKLAŞ iş milini olduğu yerde indirir; yalnız son YUVAYA GİT yapılan yuvada ve araya başka hareket (jog, park, temizlik, home, takım değişimi, MDI, iş) girmeden çalışır." +
            $(if ($son) { "`r`nSon GİT yapılan: $(Yuva-Gorunen-Adi $son)" } else { '' })
    }
    if ($ayar) {
        # SK-16 (MAKİNEDE DOĞRULA): jog hangi sekmeden ya da Eding'den gelirse gelsin konum sınırı. Yalnız ortalama payı:
        # XY'de GİT noktasına uzaklık <= AyarXYSinir, Z / A / B GİT'tekiyle aynı (aşağı inilmiş ya da kol dönmüş olamaz).
        $k = Makine-Konum; $s = $script:SonAyarKonum
        if ($null -eq $k -or $null -eq $s) { return "Önce bu yuvaya yeniden GİT: $g.`r`nMakine konumu okunamadı." }
        $xy = [math]::Sqrt(($k[0] - $s[0]) * ($k[0] - $s[0]) + ($k[1] - $s[1]) * ($k[1] - $s[1]))
        if ($xy -gt $script:AyarXYSinir) { return "Önce bu yuvaya yeniden GİT: $g.`r`nGİT'ten sonra X/Y $(Sayi ([math]::Round($xy, 2))) mm kaydı (ortalama için en çok $(Sayi $script:AyarXYSinir) mm)." }
        for ($i = 2; $i -lt 5; $i++) {
            if ([math]::Abs($k[$i] - $s[$i]) -gt $script:AyarZABSinir) { return "Önce bu yuvaya yeniden GİT: $g.`r`nGİT'ten sonra $(@('X', 'Y', 'Z', 'A', 'B')[$i]) ekseni hareket etti (YAKLAŞ yalnız GİT yüksekliğinden ve açısından iner)." }
        }
        return ''
    }
    $k = Makine-Konum; $s = $script:SonYuvaKonum
    if ($null -eq $k -or $null -eq $s) { return "Önce bu yuvaya GİT: $g.`r`nMakine konumu okunamadı." }
    for ($i = 0; $i -lt 5; $i++) {
        if ([math]::Abs($k[$i] - $s[$i]) -gt 0.05) { return "Önce bu yuvaya GİT: $g.`r`nSon YUVAYA GİT'ten sonra makine hareket etti (iş mili artık $g üstünde olmayabilir)." }
    }
    return ''
}

# Tema ayarı: 'koyu' | 'acik' | 'gecisli' | 'safak' (ilerleme temaları, koyu taban: yüzeyler iş ilerledikçe
# Geçişli maviden yeşile, Şafak gece çivitinden şafak bakırına kayar). Bilinmeyen/boş -> 'koyu'.
function Tema-Normalle([string]$v) {
    $k = "$v".Trim().ToLowerInvariant()
    if ($k -eq 'acik') { return 'acik' }
    if ($k -eq 'gecisli') { return 'gecisli' }
    if ($k -eq 'safak') { return 'safak' }
    return 'koyu'
}

# Tercih anahtarları (Ayarlar ve sihirbaz kutuları). Eski pencere kutularının olaylarındaki kod aynen.
function Tercih-Kaydet([string]$arg) {
    $i = $arg.IndexOf('=')
    if ($i -lt 1) { Ui-Bildir "Geçersiz ayar: $arg" 'Uyari'; return }
    $k = $arg.Substring(0, $i).Trim(); $v = $arg.Substring($i + 1).Trim()
    $ac = ($v -eq '1')
    switch ($k) {
        'Tema' { $script:Tercih.Tema = (Tema-Normalle $v); Tercih-Yaz; Ui-Tema $script:Tercih.Tema }
        'MakineAdi' { if ($v) { $script:Tercih.MakineAdi = $v; Tercih-Yaz } }
        'SanalKlavye' { $script:Tercih.SanalKlavye = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'OtomatikHazirlik' { $script:Tercih.OtomatikHazirlik = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'GeriSayim' { $g = Metin-Sayi $v; if ($null -ne $g -and $g -ge 0 -and $g -le 60) { $script:Tercih.GeriSayim = "$([int]$g)"; Tercih-Yaz } else { Ui-Bildir 'Geri sayım 0–60 sn olmalı.' 'Uyari' } }
        'SadeTaraf' { $script:Tercih.SadeTaraf = $(if ($v -eq '3') { '3' } else { '9' }); Tercih-Yaz }
        'Dansci' { $script:Tercih.Dansci = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'Koordinat' { $script:Tercih.Koordinat = $(if ($ac) { 'MAKINE' } else { 'IS' }); Tercih-Yaz; $script:KoordMakine = $ac; [Kayit]::Yaz("TUŞ: Koordinat görünümü -> $($script:Tercih.Koordinat)") }
        'TamEkran' { $script:Tercih.TamEkran = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'WinBaslangic' { $script:Tercih.WinBaslangic = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz; Windows-Baslangic-Ayarla }
        'EdingGizli' { $script:Tercih.EdingGizli = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz; if ($ac) { Eding-Gizle } else { Eding-Goster } }
        'Uzak' { $script:Tercih.Uzak = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'UzakKilit' { $script:Tercih.UzakKilit = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'JogAdim' { if ($null -ne (Metin-Sayi $v)) { $script:Tercih.JogAdim = $v; Tercih-Yaz } }
        'JogHiz' { if ($null -ne (Metin-Sayi $v)) { $script:Tercih.JogHiz = $v; Tercih-Yaz } }
        'FrezModu' { Frez-Modu-Ayarla ($v -eq 'MANUEL') }
        { @('TutucuYaricap', 'TutucuYariYukseklik', 'CarpismaPayi') -contains $_ } {
            $g = Metin-Sayi $v
            if ($null -ne $g -and $g -ge 0 -and $g -le 200) { $script:Tercih[$k] = (([double]$g).ToString('0.0##', [System.Globalization.CultureInfo]::InvariantCulture)); Tercih-Yaz; [Kayit]::Yaz("AYAR: $k = $($script:Tercih[$k]) mm (çarpışma koruması)") }
            else { Ui-Bildir "$k 0–200 mm olmalı: $v" 'Uyari' }
        }
        'CarpismaBekci' { $script:Tercih.CarpismaBekci = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz; [Kayit]::Yaz("AYAR: çarpışma koruması $(if ($ac) { 'AÇIK' } else { 'KAPALI' })") }
        { @('KalT', 'KalD', 'OkT', 'OkUcD') -contains $_ } { if ($null -ne (Metin-Sayi $v)) { $script:Tercih[$k] = $v; Tercih-Yaz } else { Ui-Bildir "Sayı değil: $v" 'Uyari' } }
        { @('KalSA', 'KalSB', 'KalSY') -contains $_ } { $script:Tercih[$k] = $(if ($ac) { '1' } else { '0' }); Tercih-Yaz }
        'OkUc' { $script:Tercih.OkUc = $(if ($v -eq 'kure') { 'kure' } else { 'duz' }); Tercih-Yaz }
        default { Ui-Bildir "Bu ayar değiştirilemez: $k" 'Uyari'; return }
    }
}

# Eski Ayarlar › PANEL "Frez değişimi MANUEL" kutusunun olay kodu (Sade akış; Takımlar başlığındaki düğme de bunu kullanır)
function Frez-Modu-Ayarla([bool]$manuel) {
    if ($manuel -and -not $script:OzelMakro) {
        (Ui-Kutu "Bu makinenin macro.cnc'si manuel frez değişimini desteklemiyor (orijinal makro).`r`nManuel için PrimerMill makrosu (P_CNC_icin\macro.cnc) kurulu olmalı." 'Frez değişimi' 'OK' 'Warning') | Out-Null
        return
    }
    if (-not $manuel -and $script:Manuel -and -not (Otomatik-Gecis-Uygun-Mu)) { return }   # MC-06
    if ((Is-Suruyor)) { (Ui-Kutu 'İş sürerken frez değişim modu değiştirilemez.' 'Frez modu' 'OK' 'Information') | Out-Null; return }
    $script:Manuel = $manuel
    $script:Tercih.FrezModu = if ($manuel) { 'MANUEL' } else { 'OTOMATIK' }; Tercih-Yaz
    Yaz "Frez değişimi: $($script:Tercih.FrezModu) (kaydedildi)"
    if ($script:OzelMakro -and $script:Bagli -and -not (Is-Suruyor)) { try { [void](Frez-Modu-Yaz $script:Manuel) } catch { } }
}

# Ayarlar › Makine değişkenleri KAYDET: "5221=…;…;4006=…" -> eski kutular -> Ayar-Kaydet (eski fonksiyon aynen)
function Degisken-Kaydet([string]$arg) {
    $v = @{}
    foreach ($p in ([string]$arg).Split(';')) { $i = $p.IndexOf('='); if ($i -gt 0) { $v[$p.Substring(0, $i).Trim()] = $p.Substring($i + 1).Trim() } }
    $no = @{ X = '5221'; Y = '5222'; Z = '5223'; A = '5224'; B = '5225' }
    $script:G54Kutu = @{}; $script:ParamKutu = @{}
    foreach ($k in $no.Keys) { $script:G54Kutu[$k] = [pscustomobject]@{ Text = [string]$v[$no[$k]] } }
    foreach ($nr in $ParamTanim.Keys) { $script:ParamKutu[$nr] = [pscustomobject]@{ Text = [string]$v["$nr"] } }
    Ayar-Kaydet
}

function Panel-Kapat {
    if ($script:Kiosk) { Kiosk-Panel-Kapat; return }   # kiosk: PIN ister (lib/Kiosk.ps1)
    $msg = if ((Calisiyor-Mu)) { "Makine ÇALIŞIYOR. Panel kapanırsa takip durur (Eding işi sürdürür).`r`n`r`nYine de kapatılsın mı?" } else { "PrimerMill kapatılsın mı?" }
    if (Onay $msg 'Kapat') { Ui-Kapat }
}

function Eding-Kapat-Komut {
    if (Is-Suruyor-Uyari "Eding'i kapat") { return }
    if (-not (Onay "Eding ayarlarını kaydederek kapanacak (G54 ve kalıcı değişkenler Eding kapanırken kaydedilir).`r`nPanel Eding'i kendiliğinden yeniden AÇMAZ; açmak için Ayarlar › Eding › YENİDEN BAŞLAT ya da paneli yeniden aç." "Eding'i kapat")) { return }
    $script:EdingKapatildi = $true
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    Eding-Kapat-Nazik
    Yaz "Eding kapatılıyor (ayarlar kaydedilir)."
}

function Uzak-Ac-Kapat([bool]$ac) {
    if ($ac) {
        if (-not (Normal-Onay 'Uzaktan erişim' "Uzaktan erişim açılacak: aynı ağdaki cihazlar PIN ile izleyebilir, iş seçip başlatabilir.`r`nDevam?")) { return }
        $script:Tercih.Uzak = '1'; Tercih-Yaz
        if (-not $script:UzakAcik) { Uzak-Baslat }
    } else {
        $script:Tercih.Uzak = '0'; Tercih-Yaz
        try { [WebSunucu]::Durdur() } catch { }
        $script:UzakAcik = $false; $script:UzakAdres = ''
        Yaz 'Uzaktan erişim kapatıldı.'
        Uzak-Etiket-Guncelle
    }
}

function Pin-Kaydet([string]$v) {
    $v = ([string]$v).Trim()
    if ($v -notmatch '^\d{6,8}$') { (Ui-Kutu 'PIN 6–8 rakam olmalı (PIN''siz uzaktan erişim yok).' 'PIN' 'OK' 'Warning') | Out-Null; return }
    $script:Tercih.WebPin = $v; Tercih-Yaz; try { [WebSunucu]::Pin = $v } catch { }; Uzak-Etiket-Guncelle
    Yaz "Uzaktan erişim PIN'i değiştirildi."
}

function Gecmis-Ac([string]$yol) { if ([System.IO.File]::Exists($yol)) { Start-Process notepad.exe $yol } else { (Ui-Kutu 'Henüz kayıt yok.' 'Geçmiş' 'OK' 'Information') | Out-Null } }

function Hiz-Komut([string]$ne) {
    $simdi = $script:HizYuzde; try { $simdi = [int](Hiz-Oku) } catch { }
    if ($ne -eq 'azalt') { Hiz-Ayarla ($simdi - 10) } elseif ($ne -eq 'artir') { Hiz-Ayarla ($simdi + 10) } else { Hiz-Ayarla 100 }
}

function Jog-Komut([string]$arg) {
    # "<eksen><yön>|<adım>|<hız>", ör. "Z-|0.1|300"
    $e = Arg-Parca $arg 0
    if ($e -notmatch '^([XYZAB])([+-])$') { Ui-Bildir "Geçersiz jog: $arg" 'Uyari'; return }
    $eksen = $Matches[1]; $yon = $(if ($Matches[2] -eq '-') { -1 } else { 1 })
    $adim = Metin-Sayi (Arg-Parca $arg 1); $hiz = Metin-Sayi (Arg-Parca $arg 2)
    if ($null -ne $adim) {
        if (@(0.01, 0.05, 0.1, 0.5, 1, 10) -notcontains [double]$adim) { Ui-Bildir "Geçersiz adım: $adim" 'Uyari'; return }
        $script:AdimMm = [double]$adim
    }
    if ($null -ne $hiz) {
        if (@(100, 300, 1000) -notcontains [int]$hiz) { Ui-Bildir "Geçersiz hız: $hiz" 'Uyari'; return }
        $script:Hiz = [int]$hiz
    }
    Jog $eksen $yon
}

function Kal-Adim([string]$hangi, [string]$ne, [string]$arg) {
    $deg = if ($hangi -eq 'disk') { $script:DiskAdim } else { $script:OtoAdim }
    switch ($ne) {
        'ileri' { $deg++ } 'geri' { $deg-- } 'bitir' { $deg = 0 }
        'adim' { $n = 0; if ([int]::TryParse($arg, [ref]$n)) { $deg = $n } }
    }
    if ($deg -lt 0) { $deg = 0 }; if ($deg -gt 4) { $deg = 4 }
    if ($hangi -eq 'oto' -and $deg -ge 2 -and -not (Prob-Gecti)) { Ui-Bildir 'Prob testi zorunlu: önce PROB TESTİNİ BAŞLAT, TEMAS VAR görün (son 10 dk).' 'Uyari'; $deg = [math]::Min($deg, 1) }
    if ($hangi -eq 'disk') { $script:DiskAdim = $deg; if ($deg -eq 1) { Kal-Yerlesim-Yaz } } else { $script:OtoAdim = $deg }
    if ($ne -eq 'bitir') { Ui-Bildir 'Sihirbaz kapatıldı.' 'Bilgi' }
}

function Ekran-Degisti([string]$ad) {
    $onceki = $script:EtkinEkran
    $script:EtkinEkran = $ad
    if ($onceki -eq 'kalibrasyon' -and $ad -ne 'kalibrasyon' -and $script:ProbAktif) { $script:ProbAktif = $false }   # eski: Ayarlar kapanınca prob testi durur
    if (-not ($script:ApiHazir -and $script:Bagli)) { return }
    if (@('kalibrasyon', 'ayarlar') -contains $ad -and -not (Calisiyor-Mu)) { try { Ayar-Oku; Kal-Degerleri-Goster; OtoKal-Goster } catch { } }   # eski: Sekme-Goster / Ayarlar açılınca Ayar-Oku
    if ($ad -eq 'takimlar') { try { Yuva-Liste-Yenile; $script:GeometriMetni = Yuva-Geometrisi-Oku } catch { } }
}

# ------------------------------------------------------------------ komutlar (ui/ARAYUZ_API.md §3)
# Genel / kabuk
Komut-Tanimla 'acilstop' 'serbest' { Acil-Stop 'buton' } -IcIce
Komut-Tanimla 'acilstop.kaldir' 'serbest' { Acil-Stop-Kaldir } -Ek { param($a, $c) if (-not $c.Acil) { return 'ACİL STOP basılı değil' }; return '' }
Komut-Tanimla 'makine.reset' 'makine' { Btn-Reset }
Komut-Tanimla 'ekran' 'serbest' { param($a) Ekran-Degisti $a } -IcIce
Komut-Tanimla 'panel.kucult' 'serbest' { Ui-Kucult } -IcIce -Ek { param($a, $c) if ($script:Kiosk) { return $script:IzinMetni.Kiosk }; return '' }
Komut-Tanimla 'panel.kapat' 'serbest' { Panel-Kapat }
# Kiosk modu ve CİHAZI KAPAT (lib/Kiosk.ps1). Kapatma makineye dokunmaz ama iş / panel işlemi sürerken yapılmaz.
Komut-Tanimla 'sistem.kapat' 'serbest' { Sistem-Kapat } -Ek {
    param($a, $c)
    if ($script:SistemKapaniyor) { return 'Cihaz kapatılıyor' }
    if ($c.Calis) { if ($c.IsAktif) { return $script:IzinMetni.Calis }; return $script:IzinMetni.Hareket }
    if ($c.Durak) { return $script:IzinMetni.Durak }
    if ($script:IslemSuruyor) { return ($script:IzinMetni.Islem -f $script:IslemAdi) }
    return ''
}
Komut-Tanimla 'kiosk.windows' 'serbest' { Windows-Gec } -Ek {
    param($a, $c)
    if (-not $script:Kiosk) { return $script:IzinMetni.KioskYok }
    if ($c.Suruyor) { if ($c.Durak) { return $script:IzinMetni.Durak }; return $script:IzinMetni.Calis }
    return ''
}
Komut-Tanimla 'kiosk.pin' 'serbest' { Kiosk-Pin-Degistir }
# Üretim
Komut-Tanimla 'is.sec' 'serbest' { Btn-DosyaSec } -Ek { param($a, $c) if ($c.Suruyor) { return 'Kazıma sürerken / duraklıyken yeni dosya seçilemez' }; if ($c.Acil) { return $script:IzinMetni.Acil }; return '' }
Komut-Tanimla 'is.baslat' 'hareket' { Btn-Baslat } -Raf -Makro -Ek { param($a, $c) if (-not $script:SeciliDosya) { return $script:IzinMetni.Dosya }; if ($script:Engel) { return $script:IzinMetni.Engel }; return '' }
Komut-Tanimla 'is.devam' 'is' { Btn-Baslat } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if ($c.Acil) { return $script:IzinMetni.Acil }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; if (-not $c.Durak) { return 'Duraklatılmış iş yok' }; return '' }
Komut-Tanimla 'is.duraklat' 'is' { Btn-Duraklat } -IcIce -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; if ($c.Durak) { return 'İş zaten duraklatıldı: devam için DEVAM' }; if (-not $c.Calis) { return $script:IzinMetni.Yok }; return '' }
# SK-09 (MAKİNEDE DOĞRULA): DURDUR (CncAbortJob) panelden başlayan bir işlem (home, takım değişimi, yuvaya git ...) sürerken de
# çalışır (-IcIce); Btn-Durdur yalnız onay + CncAbortJob yapar, yeni uzun işlem başlatmaz. Dıştaki işlemin bekleyişi Eding'in
# durumunu görüp kendi hata yoluyla biter.
Komut-Tanimla 'is.durdur' 'is' { Btn-Durdur $true } -IcIce -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; if (-not $c.Suruyor) { return $script:IzinMetni.Yok }; return '' }
Komut-Tanimla 'takim.degistir' 'hareket' { param($a) $n = 0; if (-not [int]::TryParse($a, [ref]$n) -or $n -lt 0 -or $n -gt 6) { Ui-Bildir "Geçersiz takım: $a" 'Uyari'; return }; Takim-Degistir $n } -Raf
Komut-Tanimla 'temizlik' 'hareket' { if (Normal-Onay 'Temizlik' "İş mili en üste çıkacak, kol yatay konuma dönecek (temizlik).`r`nDevam?") { Btn-Temizlik 'temizlik' } }
Komut-Tanimla 'park' 'hareket' { if (Normal-Onay 'Park' "İş mili en üste çıkacak, kol düzlenecek, köşeye (G30 X/Y) gidip park açısına dönecek.`r`nDevam?") { Btn-Temizlik 'park' } }
Komut-Tanimla 'home' 'makine' { Btn-Home }
Komut-Tanimla 'hiz.azalt' 'is' { Hiz-Komut 'azalt' } -IcIce -Ek { param($a, $c) if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'hiz.artir' 'is' { Hiz-Komut 'artir' } -IcIce -Ek { param($a, $c) if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'hiz.normal' 'is' { Hiz-Komut 'normal' } -IcIce -Ek { param($a, $c) if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'ayar.kaydet' 'serbest' { param($a) Tercih-Kaydet $a }
$script:BlokEk = { param($a, $c) if ($c.Suruyor) { if ($c.Durak) { return $script:IzinMetni.Durak }; return $script:IzinMetni.Calis }; return '' }
Komut-Tanimla 'blok.kazibasla' 'hareket' { param($a) Yeni-Blok 'is' (Arg-Parca $a 0) (Arg-Parca $a 1) (Arg-Parca $a 2) } -Raf -Makro -Ek { param($a, $c) if (-not $script:SeciliDosya) { return $script:IzinMetni.Dosya }; if ($script:Engel) { return $script:IzinMetni.Engel }; return '' }
Komut-Tanimla 'blok.sadeceisim' 'hareket' { param($a) Yeni-Blok 'tek' (Arg-Parca $a 0) (Arg-Parca $a 1) (Arg-Parca $a 2) } -Raf -Makro
Komut-Tanimla 'blok.yenihazir' 'serbest' { param($a) Yeni-Blok 'hazir' (Arg-Parca $a 0) (Arg-Parca $a 1) (Arg-Parca $a 2) } -Ek $script:BlokEk
Komut-Tanimla 'blok.kullanilmis' 'serbest' { Yeni-Blok 'eski' } -Ek $script:BlokEk
Komut-Tanimla 'blok.iptal' 'serbest' { Yeni-Blok 'sil' } -Ek $script:BlokEk
Komut-Tanimla 'sim.buyuk' 'serbest' { param($a) Ui-Sim-Buyuk ($a -eq '1') } -IcIce
# Takımlar
Komut-Tanimla 'frez.modu' 'serbest' { param($a) Frez-Modu-Ayarla ($a -eq 'MANUEL') } -Ek $script:BlokEk
Komut-Tanimla 'frez.birak' 'hareket' { Btn-FrezBirak } -Raf
Komut-Tanimla 'takim.olc' 'hareket' { Takim-Olc } -Raf
Komut-Tanimla 'takim.asinma' 'hareket' { if (Normal-Onay 'Aşınma kontrolü' "İş mili sensöre gidip frezin aşınmasını ölçecek (M100).`r`nDevam?") { Asinma-Kontrol } }
Komut-Tanimla 'takim.bosmu' 'hareket' { Bos-Mu }
Komut-Tanimla 'yuva.git' 'hareket' {
    param($a)
    $ad = Yuva-Adi $a
    if (@('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Sensör', 'Değişim') -notcontains $ad) { Ui-Bildir "Geçersiz yuva: $a" 'Uyari'; return }
    # TASARIM §6: eksen hareketi tehlikeli onay (eski panelde soru yoktu)
    if (-not (Ui-Tehlikeli-Onay 'Yuvaya git' "İş mili önce en üste çıkacak, sonra $ad noktasının üstüne gidecek (frezeye dokunmaz).`r`nDevam?" $null $null $null)) { return }
    Yuva-Hedefi-Unut $true
    if (([string]$a) -like 'ayar:*' -or $ad -eq 'Değişim') {                                         # Yuva ayarı sihirbazı: kaydedilmemiş yeni değerlerle
        $script:YuvaSecili = $ad; Yuva-Git
        if ($script:SonAyarYuva -eq $ad) { $script:SonAyarKonum = Makine-Konum }   # SK-16: YAKLAŞ yalnız bu konumun yakınında
    }
    else {                                                                                          # Takım değişimi sayfası (eski TAKIM sekmesi)
        Yuvaya-Git $ad
        if ($script:SonYuva -eq $ad) { $script:SonYuvaKonum = Makine-Konum }   # SK-02: YAKLAŞ yalnız bu konumda
    }
    try { Yuva-Liste-Yenile } catch { }
}
Komut-Tanimla 'yuva.yaklas' 'hareket' {
    param($a)
    $ad = Yuva-Adi $a
    $ayar = (([string]$a) -like 'ayar:*' -or $ad -eq 'Değişim')
    $n = Yaklas-Neden $ad $ayar   # SK-02
    if ($n) { [Kayit]::Yaz("YAKLAŞ REDDİ: '$a' (son GİT: $(if ($ayar) { $script:SonAyarYuva } else { $script:SonYuva }))"); (Ui-Kutu $n 'Yaklaş' 'OK' 'Warning') | Out-Null; return }
    if ($ayar) { $script:YuvaSecili = $ad; Yuva-Yaklas } else { Yuvaya-Yaklas }
}
Komut-Tanimla 'eksen.yukari' 'hareket' { if (Normal-Onay 'Yukarı' "İş mili en üste (Z makine sınırı) çıkacak.`r`nDevam?") { Yukari-Kaldir } }
Komut-Tanimla 'pens.ac' 'hareket' { Btn-Pens-Ac }
Komut-Tanimla 'pens.kapat' 'hareket' { Tek-Komut 'Pens kapat' 'M55 P2'; $script:PensAcik = $false }
Komut-Tanimla 'hava.ufle' 'hareket' { Hava-Ufle }
Komut-Tanimla 'yuva.al' 'makine' { param($a) $script:YuvaSecili = Yuva-Adi $a; Yuva-Al }
Komut-Tanimla 'yuva.kaydet' 'hareket' { Yuva-Kaydet }
Komut-Tanimla 'yuva.sifirla' 'serbest' { Yuva-Sifirla }
Komut-Tanimla 'yuva.varsayilan' 'hareket' { Yuva-Varsayilan }
Komut-Tanimla 'yuva.test' 'hareket' { param($a) $n = 0; if (-not [int]::TryParse($a, [ref]$n) -or $n -lt 0 -or $n -gt 6) { Ui-Bildir "Geçersiz takım: $a" 'Uyari'; return }; Yuva-Test $n } -Raf
Komut-Tanimla 'yuva.zal' 'serbest' { param($a) $script:YuvaZ = ($a -eq '1') }
Komut-Tanimla 'yuva.geometri.oku' 'serbest' { $script:GeometriMetni = Yuva-Geometrisi-Oku; Yaz $script:GeometriMetni }
Komut-Tanimla 'jog' 'hareket' { param($a) Jog-Komut $a }
$script:JogYok = { param($a, $c) return 'Basılı tutarak sürekli hareket bu sürümde yok: adım seçin (0.01–10)' }
Komut-Tanimla 'jog.basla' 'yok' { } -Ek $script:JogYok
Komut-Tanimla 'jog.bitir' 'yok' { } -Ek $script:JogYok
# Çarpışma incelemesi: hepsi Z üst -> A düz -> B en yakın düz açı (büyük B dönüşü disk dışında) -> X/Y -> hedef açı (Guvenli-Sira-Simdi)
Komut-Tanimla 'konum.koldz' 'hareket' { if (Normal-Onay 'Kol düz' "İş mili en üste çıkacak, kol takım alma açısına (G54 A/B) dönecek.`r`n(Disk ters duruyorsa B yalnız disk dışında döner.)`r`nDevam?") { Konuma-Git 'Kol düz' (Guvenli-Sira-Simdi @() @('G53 G0 A[#5224] B[#5225]') -BDuz) '' } }
Komut-Tanimla 'konum.takimalani' 'hareket' { if (Normal-Onay 'Takım alanı' "İş mili takım alanına gidecek (en üste, kol düz, gosub azxy_safe).`r`nDevam?") { Konuma-Git 'Takım alanı' @((Guvenli-Sira-Simdi @() @()) + 'gosub azxy_safe') '' } }
Komut-Tanimla 'konum.blok' 'hareket' { if (Normal-Onay 'Blok değiştirme' "İş mili en üste çıkacak, kol bloğu takıp çıkarmak için öne gelecek.`r`nDevam?") { Konuma-Git 'Blok değiştirme' @((Guvenli-Sira-Simdi @() @('G53 G0 A[#5224] B[#5225]') -BDuz) + 'gosub ClearPos') '' } }
Komut-Tanimla 'konum.park' 'hareket' { if (Normal-Onay 'Park (G30)' "İş mili en üste çıkacak, kol düzlenecek, köşeye (G30 X/Y) gidip park açısına dönecek.`r`nDevam?") { Konuma-Git 'Park (G30)' (Park-Satirlari-Simdi) '' } }
Komut-Tanimla 'ismili.calistir' 'hareket' { param($a) Ismili-Calistir $a }
Komut-Tanimla 'ismili.durdur' 'hareket' { Tek-Komut 'İş mili durdur' 'M5' }
Komut-Tanimla 'sogutma.m7' 'hareket' { Tek-Komut 'M7' 'M7' }
Komut-Tanimla 'sogutma.m8' 'hareket' { Tek-Komut 'M8' 'M8' }
Komut-Tanimla 'sogutma.kapat' 'hareket' { Tek-Komut 'M9' 'M9' }
# Frez ömrü (lib/FrezOmru.ps1): yalnız veri, makineye komut yok. AYARLA her zaman; SIFIRLA iş sürerken o işin frezi için yok.
Komut-Tanimla 'frez.omur.ayarla' 'serbest' { param($a) Frez-Omru-Ayarla $a }
Komut-Tanimla 'frez.omur.sifirla' 'serbest' { param($a) Frez-Omru-Sifirla $a } -Ek { param($a, $c) return (Frez-Omru-Sifirla-Neden $a $c) }
# Kalibrasyon
Komut-Tanimla 'kal.ac' 'serbest' { param($a) if ($a -eq 'disk') { Kal-Yerlesim-Yaz }; if ($script:ApiHazir -and $script:Bagli) { try { Kal-Degerleri-Goster; OtoKal-Goster } catch { } } }
foreach ($ne in @('ileri', 'geri', 'adim', 'bitir')) {
    Komut-Tanimla "kal.disk.$ne" 'serbest' ([scriptblock]::Create("param(`$a) Kal-Adim 'disk' '$ne' `$a"))
    Komut-Tanimla "kal.oto.$ne" 'serbest' ([scriptblock]::Create("param(`$a) Kal-Adim 'oto' '$ne' `$a"))
}
Komut-Tanimla 'kal.uretici' 'hareket' { G54-Ureticiye-Don; Kal-Degerleri-Goster }
Komut-Tanimla 'kal.disk.test' 'serbest' { param($a) $n = 0; if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le 4) { $script:DiskTestNo = $n; Kal-Yerlesim-Yaz } }
Komut-Tanimla 'kal.disk.hazirla' 'makine' { Kal-Test-Hazirla }
Komut-Tanimla 'kal.disk.olcum' 'serbest' { param($a) $i = $a.IndexOf('='); if ($i -gt 0) { $k = $a.Substring(0, $i); if ($KalOlcumTanim.Contains($k)) { $script:DiskOlcum[$k] = $a.Substring($i + 1).Trim(); $script:DiskSonucHazir = $false } } }
Komut-Tanimla 'kal.disk.hesapla' 'serbest' { Kal-Hesapla } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'kal.disk.uygula' 'hareket' { Kal-Uygula } -Ek { param($a, $c) if (-not $script:KalSonuc) { return 'Önce ölçümleri yazıp HESAPLA' }; return '' }
Komut-Tanimla 'kal.disk.gecmis' 'serbest' { Gecmis-Ac $KalGecmis }
Komut-Tanimla 'kal.prob.basla' 'serbest' { if (-not $script:ProbAktif) { OtoKal-Prob-Testi } } -Ek { param($a, $c) if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'kal.prob.durdur' 'serbest' { $script:ProbAktif = $false }
Komut-Tanimla 'kal.prob.ogren' 'serbest' { $script:Tercih.ProbIo = ''; $script:Tercih.ProbAktif = ''; Tercih-Yaz; $script:OkProbTaban = $null; Yaz 'Prob girişi sıfırlandı: testi başlatıp kabloyu değdirince yeniden öğrenilir.' }
Komut-Tanimla 'kal.oto.hazirla' 'makine' { OtoKal-Hazirla }
Komut-Tanimla 'kal.oto.oku' 'serbest' { OtoKal-Oku } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'kal.oto.uygula' 'hareket' { OtoKal-Uygula } -Ek { param($a, $c) if (-not $script:OkSonuc) { return 'Önce SONUÇLARI OKU' }; return '' }
Komut-Tanimla 'kal.oto.gecmis' 'serbest' { Gecmis-Ac $OkGecmis }
Komut-Tanimla 'kal.zalma' 'hareket' { Z-Alma-Yap }
Komut-Tanimla 'kal.g92sifirla' 'hareket' { G92-Sifirla }
Komut-Tanimla 'kal.konum.yuva' 'hareket' { param($a) $ad = Yuva-Adi $a; if ($ad -eq 'Sensör') { Konumu-Sensor-Yap } elseif ($ad -match '^T([1-6])$') { Konumu-Yuva-Yap ([int]$Matches[1]) } else { Ui-Bildir "Geçersiz yuva: $a" 'Uyari' } }
Komut-Tanimla 'yedek.al' 'serbest' { [void](Ayar-Yedekle) } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'yedek.yukle' 'hareket' { Ayar-Geri-Yukle }
Komut-Tanimla 'klasor.ac' 'serbest' {
    param($a)
    switch ($a) { 'isler' { Klasor-Ac $IsKlasor } 'loglar' { Klasor-Ac ([System.IO.Path]::Combine($ScriptKlasor, 'loglar')) } 'yedekler' { Klasor-Ac $YedekKlasoru } 'eding' { Klasor-Ac $EdingKlasor } default { Ui-Bildir "Bilinmeyen klasör: $a" 'Uyari' } }
} -IcIce
# Ayarlar
Komut-Tanimla 'eding.goster' 'serbest' { Eding-Goster } -IcIce
Komut-Tanimla 'eding.gizle' 'serbest' { Eding-Gizle } -IcIce
Komut-Tanimla 'eding.yeniden' 'serbest' { $script:EdingKapatildi = $false; Eding-Yeniden } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if ($c.Suruyor) { return $script:IzinMetni.Calis }; return '' }
Komut-Tanimla 'eding.kapat' 'serbest' { Eding-Kapat-Komut } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if ($c.Suruyor) { return $script:IzinMetni.Calis }; return '' }
Komut-Tanimla 'degisken.oku' 'serbest' { Ayar-Oku } -Ek { param($a, $c) if ($c.Oniz) { return $script:IzinMetni.Oniz }; if (-not $c.Bagli) { return $script:IzinMetni.Bagli }; return '' }
Komut-Tanimla 'degisken.kaydet' 'hareket' { param($a) Degisken-Kaydet $a }
# Kayıtlar ve Uzaktan
Komut-Tanimla 'mdi.gonder' 'makine' { param($a) Mdi-Gonder $a }
Komut-Tanimla 'uzak.ac' 'serbest' { param($a) Uzak-Ac-Kapat ($a -eq '1') } -Ek { param($a, $c) if ($c.Oniz -and -not $script:Demo) { return $script:IzinMetni.Oniz }; return '' }
Komut-Tanimla 'uzak.pin' 'serbest' { param($a) Pin-Kaydet $a }
Komut-Tanimla 'uzak.izin' 'yok' { } -Ek { param($a, $c) return 'İzin düzeyi bu sürümde yok: uzaktan izleme, iş seçme, başlatma, duraklatma ve durdurma PIN ile yapılır (tıklama/klavye kapalı)' }

# Pens aç (eski ana ekran PENS AÇ düğmesinin aç kısmı; kapatma ayrı komut)
function Btn-Pens-Ac {
    if (-not (Hazir-Mi 'Pens')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine çalışırken pens açılamaz.' 'Pens' 'OK' 'Warning') | Out-Null; return }
    if (Pens-Ac-T0 'Pens aç') { $script:PensAcik = $true }
}

# ------------------------------------------------------------------ MakineDurumu
function Tur-Enum([string]$t) {
    switch ($t) { 'Hata' { return [PrimerUI.MesajTuru]::Hata } 'Uyari' { return [PrimerUI.MesajTuru]::Uyari } 'Basari' { return [PrimerUI.MesajTuru]::Basari } default { return [PrimerUI.MesajTuru]::Bilgi } }
}
function Kal-Satirlari($liste) {
    $l = New-Object 'System.Collections.Generic.List[PrimerUI.KalSonucSatiri]'
    foreach ($s in @($liste)) { if ($s) { $l.Add((New-Object PrimerUI.KalSonucSatiri([string]$s.Eksen, [string]$s.Eski, [string]$s.Duzeltme, [string]$s.Yeni, [bool]$s.Iyi))) } }
    return , $l
}
function Liste-Str($liste) {
    $l = New-Object 'System.Collections.Generic.List[string]'
    foreach ($s in @($liste)) { if ($null -ne $s -and "$s" -ne '') { $l.Add([string]$s) } }
    return , $l
}

$script:KayitOnbellek = $null; $script:KayitOnbellekSurum = -1
function Durum-Topla {
    $d = New-Object PrimerUI.MakineDurumu
    $h = $script:Hizli
    $bagli = [bool]($script:ApiHazir -and $script:Bagli)
    $acil = [bool][Eding]::AcilKilit
    $d.Bagli = $bagli; $d.Demo = [bool]$script:Demo; $d.Onizleme = (-not $script:ApiHazir); $d.EdingSimulasyon = [bool]$script:EdingSim
    $d.AcilStop = $acil; $d.ExtErr = [bool]$h.Acil; $d.HomeAlindi = [bool]$h.Home
    $d.MakineAdi = [string]$script:Tercih.MakineAdi; $d.Surum = [string]$script:PanelSurum
    $d.Kiosk = [bool]$script:Kiosk
    # durum (eski Ana-Tik sırası, 200 ms'de bir)
    if (-not $script:ApiHazir) { $d.Durum = [PrimerUI.Durum]::Pasif }
    elseif (-not $bagli) { if (((Get-Date) - $script:SonEdingBaslatma).TotalSeconds -lt 90 -and -not $script:EdingKapatildi) { $d.Durum = [PrimerUI.Durum]::Hazirlik } else { $d.Durum = [PrimerUI.Durum]::Alarm } }
    elseif ($acil -or $h.Hatali -or $h.Acil) { $d.Durum = [PrimerUI.Durum]::Alarm }
    elseif ($h.Durakli) { $d.Durum = [PrimerUI.Durum]::Duraklatildi }
    elseif ($h.Calisiyor -or $script:IsAktif) { $d.Durum = [PrimerUI.Durum]::Calisiyor }
    elseif (-not $h.Home -or $h.Durum -eq 'POWERUP' -or ($script:OzelMakro -and $script:RafEksik)) { $d.Durum = [PrimerUI.Durum]::Hazirlik }
    else { $d.Durum = [PrimerUI.Durum]::Hazir }
    $dm = [string]$script:SonDurum
    $aktif = ($d.Durum -eq [PrimerUI.Durum]::Calisiyor -or $d.Durum -eq [PrimerUI.Durum]::Duraklatildi)
    if ($script:SureMetni -and -not $aktif) { $dm = if ($dm) { "$dm   ·   $($script:SureMetni)" } else { $script:SureMetni } }
    $d.DurumMetni = $dm
    $d.Mesgul = $script:MesgulMetni
    # konum
    $k = $script:Konum
    $d.X = $k.X; $d.Y = $k.Y; $d.Z = $k.Z; $d.A = $k.A; $d.B = $k.B
    $d.MX = $k.MX; $d.MY = $k.MY; $d.MZ = $k.MZ; $d.MA = $k.MA; $d.MB = $k.MB
    $d.KoordMakine = [bool]$script:KoordMakine
    # takım
    $d.Takim = [int]$h.Takim
    $d.FrezModu = $(if ($script:Manuel) { 'MANUEL' } else { 'OTOMATIK' })
    $d.PensAcik = [bool]$script:PensAcik
    $d.HavaYok = [bool]$script:HavaYok
    $d.ManuelMesaj = [string]$script:ManuelMesajMetni
    $d.FrezOmurleri = (Frez-Omru-Liste)
    if ($d.Takim -gt 0 -and $script:YuvaListesi) { foreach ($y in $script:YuvaListesi) { if ($y.Ad -eq "T$($d.Takim)") { $d.TakimAciklama = $(if ($y.Kayitli) { 'yuvası kayıtlı' } else { 'yuvası kayıtlı değil' }) } } }
    if ($d.Takim -gt 0 -and $bagli -and $h.Home) {
        # Uç boşluğu: güvenli Z'de takım ucunun disk orta düzleminden yüksekliği (#5163 + iş Z - makine Z); uzun frez = küçük
        try {
            $ub = Uc-Boslugu ([double][Eding]::CncGetVariable(5163)) ([double]$k.Z) ([double]$k.MZ)
            $ubT = "uç boşluğu $(([double]$ub).ToString('0.0', [System.Globalization.CultureInfo]::InvariantCulture)) mm"
            $d.TakimAciklama = $(if ($d.TakimAciklama) { "$($d.TakimAciklama)  ·  $ubT" } else { $ubT })
        } catch { }
    }
    # iş
    if ($script:SeciliDosya) { $d.Dosya = $(if ($script:DosyaMetni) { [string]$script:DosyaMetni } else { [System.IO.Path]::GetFileNameWithoutExtension([string]$script:SeciliDosya) }) }
    if ($script:BekleyenBlok) { $d.Blok = [string]$script:BekleyenBlok.Metin }
    $a = $script:Analiz
    if ($a) {
        $d.ToplamSatir = [int]$a.Satir; $d.TahminiSn = [int]$a.Toplam
        $d.IsTakimlari = (@($a.Takimlar | Where-Object { $_ -gt 0 } | Sort-Object -Unique | ForEach-Object { "T$_" }) -join ' · ')
    }
    # Senaryo 1: devam kaydının tutulduğu görünsün ("Son kayıt: satır N (hh:mm:ss)")
    $sk = $script:DevamSonKayit
    if ($sk -and ($script:IsAktif -or $sk.Durum -ne 'calisiyor')) { $d.DevamKaydi = "Son kayıt: satır $(([int]$sk.Satir).ToString('N0', [System.Globalization.CultureInfo]::GetCultureInfo('tr-TR'))) ($(([datetime]$sk.Zaman).ToString('HH:mm:ss')))" }
    if ($script:IsAktif -or $script:IsTamamlandi) {
        $d.Satir = [int]$script:SonGecerliSatir; $d.GecenSn = [int]$script:Gecen.TotalSeconds; $d.KalanSn = [int]$script:KalanSn; $d.BitisSaati = [string]$script:BitisSaati
    }
    $d.Yuzde = [double]$script:Yuzde
    $d.IsTamamlandi = [bool]$script:IsTamamlandi
    $d.IsAktif = [bool]$script:IsAktif
    if ($script:SeciliDosya) {
        $d.IsUyarilari = (Liste-Str $script:Uyarilar)
        if ($script:Engel) { $d.IsHatalari = (Liste-Str $script:SonHatalar) }
    }
    $d.Hiz = [int]$script:HizYuzde
    # blok
    $d.BlokDurum = [string]$script:BlokDurumMetni
    $d.BekleyenBlok = [bool]$script:BekleyenBlok
    if (((Get-Date) - $script:BlokSonrakiOnbellek.Zaman).TotalSeconds -gt 5) { $script:BlokSonrakiOnbellek = @{ Zaman = (Get-Date); Deger = "$(Blok-Sonraki-No)" } }
    $d.BlokSonrakiIsim = [string]$script:BlokSonrakiOnbellek.Deger
    $bk = Metin-Sayi ([string]$script:Tercih.SadeKalinlik); if ($null -eq $bk) { $bk = 18.0 }; $d.BlokKalinlik = $bk
    $bd = Metin-Sayi ([string]$script:Tercih.SadeDerinlik); if ($null -eq $bd) { $bd = 0.15 }; $d.BlokDerinlik = $bd
    # mesaj
    if ($script:SonMesaj) { $d.SonMesaj = [string]$script:SonMesaj.Metin; $d.SonMesajTuru = (Tur-Enum $script:SonMesaj.Tur); $d.SonMesajZamani = [datetime]$script:SonMesaj.Zaman }
    # yuvalar
    if ($script:YuvaListesi) {
        foreach ($y in $script:YuvaListesi) {
            $b = New-Object PrimerUI.YuvaBilgisi
            $b.Ad = $(switch ($y.Ad) { 'Sensör' { 'SENSÖR' } 'Değişim' { 'MANUEL' } default { $y.Ad } })
            $b.Aciklama = [string]$y.KayitMetni; $b.Kayitli = [bool]$y.Kayitli
            $b.IsMilinde = ($y.Ad -eq "T$($d.Takim)" -and $d.Takim -gt 0)
            if (-not $y.Kayitli) { $b.Uyari = 'kayıtlı değil' }
            $b.X = [double]$y.X; $b.Y = [double]$y.Y; $b.A = [double]$y.A; $b.B = [double]$y.B
            if ($null -ne $y.Z) { $b.Z = [double]$y.Z; $b.ZVar = $true }
            $b.Yeni = [string]$y.Yeni; $b.Fark = [string]$y.Fark
            $d.Yuvalar.Add($b)
        }
    }
    $d.YuvaOrtak = [string]$script:YuvaOrtakMetni
    $d.YuvaDurum = $(if ($script:YuvaDurumMetni) { [string]$script:YuvaDurumMetni } else { [string]$script:GeometriMetni })
    $d.YuvaKaydedilmemis = ($script:YuvaYeni.Count -gt 0)
    $d.IsMiliDevir = [int][math]::Abs($script:IsMiliHiz); $d.IsMiliCalisiyor = ([math]::Abs($script:IsMiliHiz) -ge 1)
    # makine değişkenleri
    if ($script:G54Deger) { $d.G54 = [double[]]$script:G54Deger }
    if ($script:G92Deger) { $d.G92 = [double[]]$script:G92Deger }
    if ($script:ParamDeger) { $d.Param = [double[]]$script:ParamDeger }
    $d.DegiskenlerOkundu = [bool]$script:DegiskenlerOkundu
    $d.UreticiFark = [string]$script:UreticiFarkMetni
    $d.RafOzeti = [string]$script:RafMetni
    $d.SonYedek = $(if ($script:SonYedekDosya) { [System.IO.Path]::GetFileName([string]$script:SonYedekDosya) } else { '' })
    # disk kalibrasyonu
    $d.DiskAdim = [int]$script:DiskAdim; $d.DiskTestNo = [int]$script:DiskTestNo
    foreach ($kk in $script:DiskOlcum.Keys) { $d.DiskOlcum[[string]$kk] = [string]$script:DiskOlcum[$kk] }
    $d.DiskYerlesim = [string]$script:DiskYerlesimMetni
    $d.DiskDurum = $(if ($script:DiskDurumMetni) { [string]$script:DiskDurumMetni } else { [string]$script:KalSimdiMetni })
    $d.DiskSonuc = (Kal-Satirlari $script:DiskSonucSatirlari)
    $d.DiskUyarilar = (Liste-Str $script:DiskUyarilar)
    $d.DiskSonucHazir = [bool]($script:DiskSonucHazir -and $script:KalSonuc)
    # otomatik kalibrasyon
    $d.OtoAdim = [int]$script:OtoAdim
    $d.ProbTestAktif = [bool]$script:ProbAktif; $d.ProbTemas = [bool]$script:ProbTemasVar
    $d.ProbTestGecti = [bool](Prob-Gecti-Onbellek)
    $d.ProbGiris = $(if ($script:ProbAktif) { [string]$script:ProbMetni } elseif ($script:Tercih.ProbIo) { "giriş $($script:Tercih.ProbIo) (öğrenildi)" } else { 'giriş öğrenilmedi' })
    $d.OtoDurum = $(if ($script:OtoDurumMetni) { [string]$script:OtoDurumMetni } else { [string]$script:OtoSimdiMetni })
    $d.OtoOlcumBitti = [bool]$script:OtoOlcumBitti; $d.OtoSonucHazir = [bool]($script:OtoSonucHazir -and $script:OkSonuc); $d.OtoBuyuk = [bool]$script:OtoBuyuk
    $d.OtoSonuc = (Kal-Satirlari $script:OtoSonucSatirlari)
    foreach ($s in @($script:OtoKaliteSatirlari)) { if ($s) { $d.OtoKalite.Add((New-Object PrimerUI.KalKaliteSatiri([string]$s.Ad, [string]$s.Deger, (Tur-Enum $s.Tur)))) } }
    $d.OtoUyarilar = (Liste-Str $script:OtoUyarilar)
    # tercihler (görünüm anahtarları)
    $t = $script:Tercih
    $ayar = @{
        Tema = (Tema-Normalle $t.Tema); MakineAdi = [string]$t.MakineAdi; SanalKlavye = [string]$t.SanalKlavye; TamEkran = [string]$t.TamEkran
        WinBaslangic = [string]$t.WinBaslangic; Koordinat = $(if ($t.Koordinat -eq 'MAKINE') { '1' } else { '0' }); Dansci = [string]$t.Dansci; FrezModu = [string]$t.FrezModu
        OtomatikHazirlik = [string]$t.OtomatikHazirlik; GeriSayim = [string]$t.GeriSayim; SadeTaraf = $(if ($t.SadeTaraf -eq '3') { '3' } else { '9' })
        ModSor = [string]$t.ModSor; BlokSor = [string]$t.BlokSor; EdingGizli = $(if ($t.EdingGizli -eq '0') { '0' } else { '1' }); EdingSifirla = [string]$t.EdingSifirla
        Uzak = [string]$t.Uzak; UzakKilit = $(if ($t.UzakKilit -eq '0') { '0' } else { '1' })
        JogAdim = $(if ($t.JogAdim) { [string]$t.JogAdim } else { '1' }); JogHiz = $(if ($t.JogHiz) { [string]$t.JogHiz } else { '300' })
        KalT = $(if ($t.KalT) { [string]$t.KalT } else { '16.00' }); KalD = $(if ($t.KalD) { [string]$t.KalD } else { '2.00' })
        KalSA = $(if ($t.KalSA -eq '1') { '1' } else { '0' }); KalSB = $(if ($t.KalSB -eq '1') { '1' } else { '0' }); KalSY = $(if ($t.KalSY -eq '1') { '1' } else { '0' })
        OkT = $(if ($t.OkT) { [string]$t.OkT } else { '10.00' }); OkUc = $(if ($t.OkUc -eq 'kure') { 'kure' } else { 'duz' }); OkUcD = $(if ($t.OkUcD) { [string]$t.OkUcD } else { '3.00' })
        YuvaZ = $(if ($script:YuvaZ) { '1' } else { '0' })
        TutucuYaricap = $(if ($t.TutucuYaricap) { [string]$t.TutucuYaricap } else { '56' }); TutucuYariYukseklik = $(if ($t.TutucuYariYukseklik) { [string]$t.TutucuYariYukseklik } else { '13' })
        CarpismaPayi = $(if ($t.CarpismaPayi) { [string]$t.CarpismaPayi } else { '3' }); CarpismaBekci = $(if ($t.CarpismaBekci -eq '0') { '0' } else { '1' })
    }
    foreach ($kk in $ayar.Keys) { if ($null -ne $ayar[$kk]) { $d.Ayarlar[$kk] = [string]$ayar[$kk] } }
    # kayıtlar (yalnız değişince yeniden kurulur)
    if ($script:KayitSurum -ne $script:KayitOnbellekSurum -or $null -eq $script:KayitOnbellek) {
        $kl = New-Object 'System.Collections.Generic.List[PrimerUI.KayitSatiri]'
        foreach ($m in $script:KayitListesi) { $kl.Add((New-Object PrimerUI.KayitSatiri([datetime]$m.Zaman, (Tur-Enum $m.Tur), [string]$m.Metin))) }
        $script:KayitOnbellek = $kl; $script:KayitOnbellekSurum = $script:KayitSurum
    }
    $d.Kayitlar = $script:KayitOnbellek
    # teknik bilgi
    $tek = @(
        @('Eding', $(if ($bagli) { "bağlı · $($h.Durum)" } elseif ($script:ApiHazir) { 'bağlı değil' } else { 'yok (önizleme)' }), $(if ($bagli) { 'Basari' } else { 'Hata' })),
        @('Mod', $(if ($script:Demo) { 'DEMO (EdingSim, sahte makine)' } else { 'gerçek makine' }), $(if ($script:Demo) { 'Uyari' } else { 'Bilgi' })),
        @('Home', $(if ($h.Home) { 'tamam' } else { 'alınmadı' }), $(if ($h.Home) { 'Basari' } else { 'Uyari' })),
        @('Takım', "T$($h.Takim)", 'Bilgi'),
        @('Makro', $(if ($script:OzelMakro) { "PrimerMill makrosu · beklenen sürüm $BeklenenMakroSurum$(if ($script:MakroSurumUyumsuz) { ' · UYUMSUZ' })" } else { 'orijinal makro' }), $(if ($script:MakroSurumUyumsuz) { 'Hata' } else { 'Bilgi' })),
        @('Devam kaydı', $(if ($script:DevamSonKayit) { "satır $($script:DevamSonKayit.Satir) · $(([datetime]$script:DevamSonKayit.Zaman).ToString('HH:mm:ss')) · $($script:DevamSonKayit.Durum)" } else { 'yok' }), 'Bilgi'),
        @('Takım durumu', $(if ($script:TakimBelirsiz) { 'BELİRSİZ (değişim yarıda kesildi)' } else { 'net' }), $(if ($script:TakimBelirsiz) { 'Uyari' } else { 'Bilgi' })),
        @('Ayrıntı', [string]$script:TeknikMetni, 'Bilgi'),
        @('Yönetici', $(if ($script:Yonetici) { 'evet' } else { 'hayır' }), 'Bilgi'),
        @('Kiosk', $(if ($script:Kiosk) { 'AÇIK (kiosk.on)' } else { 'kapalı' }), 'Bilgi'),
        @('PowerShell', "$($PSVersionTable.PSVersion)  ·  $(if ([IntPtr]::Size -eq 4) { '32' } else { '64' }) bit", 'Bilgi'),
        @('Log', [string][Kayit]::Dosya, 'Bilgi'))
    foreach ($s in $tek) { $d.Teknik.Add((New-Object PrimerUI.BilgiSatiri([string]$s[0], [string]$s[1], (Tur-Enum $s[2])))) }
    foreach ($s in @(@('Eding', $EdingKlasor), @('İşler', $IsKlasor), @('Panel', $PanelKlasor), @('Veri', $ScriptKlasor), @('Yedekler', $YedekKlasoru))) { $d.Klasorler.Add((New-Object PrimerUI.BilgiSatiri([string]$s[0], [string]$s[1]))) }
    # uzaktan
    $d.UzakAcik = [bool]$script:UzakAcik
    $adr = @(([string]$script:UzakAdres).Split(@(' '), [System.StringSplitOptions]::RemoveEmptyEntries))
    if ($adr.Count) { $d.UzakAdres = $adr[0]; foreach ($x in $adr) { $d.UzakAdresler.Add($x) } }
    $d.UzakPin = [string]$script:Tercih.WebPin
    $d.UzakIzin = 'tam'
    $d.UzakDurumMetni = [string]$script:UzakDurumMetni
    foreach ($u in $script:UzakCihazlar) { $d.UzakCihazlar.Add((New-Object PrimerUI.UzakCihaz([string]$u.Adres, [string]$u.Zaman, [string]$u.Son))) }
    return $d
}

# ProbTestGecti her tıkta okunur; giriş okuması (CncGetInput) saniyede bir yeterli
$script:ProbGectiOnbellek = @{ Zaman = [datetime]::MinValue; Deger = $false }
function Prob-Gecti-Onbellek {
    if ($script:ProbAktif) { return (Prob-Gecti) }
    if (((Get-Date) - $script:ProbGectiOnbellek.Zaman).TotalMilliseconds -gt 1000) { $script:ProbGectiOnbellek = @{ Zaman = (Get-Date); Deger = [bool](Prob-Gecti) } }
    return $script:ProbGectiOnbellek.Deger
}

# ------------------------------------------------------------------ açılış ve kapanış (eski $form.Add_Shown / Add_FormClosing)
function Panel-Acilis {
    if ([Eding]::AcilKilit) {
        Yaz 'Panel ACİL STOP basılıyken kapanmıştı: kilit devam ediyor, otomatik home yapılmadı. Kaldırmak için KİLİDİ KALDIR.'
        Durum-Yaz 'ACİL STOP  ·  kaldırmak için KİLİDİ KALDIR' $cKirmizi
    }
    Yaz "Eding klasörü: $EdingKlasor   ·   Kayıt: $IsKlasor"
    Yaz "Log dosyası: $([Kayit]::Dosya)"
    if ($script:Demo) { Yaz 'DEMO MODU: gerçek makine yok (EdingSim). Dosyalar demo klasöründe, uzaktan erişim yalnız bu bilgisayardan.' }
    if ($script:Tercih.EdingSifirla -ne '0') { Acilis-Eding-Sifirla }
    if ($script:Sade) { try { Macro-Pens-Yamasi } catch { [Kayit]::Yaz("MACRO yaması: $($_.Exception.Message)") } }
    Eding-Baslat
    try { Uzak-Baslat } catch { Yaz "Uzaktan erişim hatası: $($_.Exception.Message)" }
    try { Devam-Acilis } catch { [Kayit]::Yaz("DEVAM açılış: $($_.Exception.Message)") }
    try { Kal-Yerlesim-Yaz } catch { }
}

function Panel-Kapanis {
    # Senaryo 1: iş sürerken panel kapanırsa son satır kaydedilir (Eding işi sürdürebilir; açılınca yarım iş sorulur)
    if ($script:IsAktif) { try { Devam-Kaydet $script:SonGecerliSatir 'panel_kapandi' $script:Yuzde } catch { } }
    try { [WebSunucu]::Durdur() } catch { }
    $script:UzakAcik = $false; $script:ProbAktif = $false
    # Panel kapanınca Eding görünmez kalmasın (cihaz kapanırken gösterilmez: ekranda Windows / Eding görünmesin)
    if (-not $script:SistemKapaniyor) { try { foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction Ignore)) { [void][Pencere]::Goster($pr.Id) } } catch { } }
    if ($script:ApiHazir -and $script:Bagli) { try { [void][Eding]::CncDisConnectServer() } catch { }; $script:Bagli = $false }
    try { Frez-Omru-Kaydet-Gerekirse } catch { }
    Hatalari-Kaydet
    [Kayit]::Yaz('=== PANEL KAPATILDI ===')
    [Kayit]::Kapat()
}
