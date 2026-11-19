# Uzak.ps1 - uzaktan erişim: web sunucusunu başlatma, uzaktan komutlar (sec, baslat, duraklat, durdur, blok, blokiptal),
# durum JSON. Komutlar panelin UI iş parçacığında, ana zamanlayıcıdan (Uzak-Tik) çalışır. Fonksiyonlar düzeltilmiş eski
# panelden taşındı; değişenler: tests/TASIMA_DEGISEN.txt. PowerShell 5.1 (32 bit) uyumlu.

# ================= UZAKTAN ERİŞİM =================
$script:ModalSayac = 0   # açık dosya seçme penceresi vb. (OpenForms'ta görünmeyen modal pencereler)
# K3 (GV-06/ED-01/UZ-02): makinede bir pencere / sihirbaz / manuel frez değişimi açıkken uzaktan başlat, seç, blok reddedilir
function Uzak-Engel {
    if ((Ui-Acik-Diyalog) -gt 0 -or $script:ModalSayac -gt 0) { return 'makinede bir mesaj / seçim penceresi açık' }
    if ($script:ManuelDiyalogAcik) { return 'makinede manuel frez değişimi bekleniyor' }
    try { if (@([System.Windows.Forms.Application]::OpenForms | Where-Object { $_ -ne $form -and $_.Visible -and $_.Modal }).Count -gt 0) { return 'makinede bir pencere açık' } } catch { }
    try { if ($ayar.Visible) { return 'makinede Ayarlar penceresi açık' } } catch { }
    if ($script:ApiHazir -and $script:Bagli) { try { if ($null -ne (Manuel-Istek)) { return 'makinede manuel frez değişimi bekleniyor' } } catch { } }
    return ''
}
function Uzak-Is-Sec([string]$ad) {
    $hedef = [System.IO.Path]::Combine($IsKlasor, [System.IO.Path]::GetFileName($ad))
    if (-not [System.IO.File]::Exists($hedef)) { return "HATA: $ad bulunamadı" }
    [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
    $script:SeciliDosya = $hedef
    $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($hedef); $lblDosya.ForeColor = $cYazi
    Dosyayi-Kontrol-Et $hedef
    if ($script:Engel) { return "HATA: $ad seçildi ama dosyada hata var: $($script:SonHatalar -join ' · ')" }
    return "OK: $ad seçildi"
}
function Uzak-Komut([string]$ad, [string]$arg, [string]$ip) {
    [Kayit]::Yaz("UZAK ($ip): $ad $arg")
    if (@('baslat', 'sec', 'blok', 'blokiptal') -contains $ad) {
        $engel = Uzak-Engel
        if ($engel) { [Kayit]::Yaz("UZAK ($ip): $ad reddedildi: $engel"); return "HATA: Uzaktan yapılamaz: $engel" }
    }
    switch ($ad) {
        'sec' {
            if ((Is-Suruyor)) { return 'HATA: Kazıma sürerken / duraklıyken iş değiştirilemez' }
            if ([System.IO.Path]::GetFileName($arg) -like 'PM_kalibrasyon*') { return 'HATA: Kalibrasyon programları uzaktan seçilemez' }   # UZ-05
            Yaz "Uzaktan ($ip) iş seçildi: $arg"
            return (Uzak-Is-Sec $arg)
        }
        'baslat' {
            if ([Eding]::AcilKilit) { return 'HATA: ACİL STOP basılı (makinede RESET gerekli)' }
            if (-not (Baglan)) { return 'HATA: Eding bağlı değil' }
            if ([Eding]::CncGetEMStopActive() -ne 0) { return 'HATA: Acil stop basılı' }
            if ([Eding]::CncGetAllAxesHomed() -eq 0) { return 'HATA: Makine home alınmamış' }
            if ($script:OzelMakro -and $script:RafEksik) { return 'HATA: Takım yuvaları/sensör kayıtlı değil (makinede Ayarlar › Yuva ayarı)' }
            if ($script:TakimBelirsiz) { return 'HATA: Takım durumu belirsiz (değişim yarıda kesildi). Makinede iş milindeki frez bildirilmeli.' }
            # K3: duraklatılmış iş (elle frez değişimi adımı dahil) uzaktan ASLA devam ettirilmez
            $pz = 0; try { $pz = [Eding]::CncGetPauseStatus() } catch { }
            if ((Durakli-Mi) -or $pz -ne 0) { return "HATA: Duraklatılmış iş uzaktan devam ettirilemez; makinede DEVAM'a basın" }
            if ((Calisiyor-Mu)) { return 'HATA: Makine zaten çalışıyor' }
            if (-not $script:SeciliDosya) { return 'HATA: Önce bir iş seç' }
            if ($script:Engel) { return 'HATA: Dosyada hata var, başlatılmadı' }
            if ($script:Tercih.UzakKilit -ne '0' -and -not $script:BlokHazir) { return 'HATA: Makinede "Blok takıldı" onayı yok. Bloğu takınca makinedeki Blok takıldı düğmesine bas.' }
            Yaz "Uzaktan ($ip): BAŞLAT  $([System.IO.Path]::GetFileName($script:SeciliDosya))"
            Btn-Baslat
            if ($script:IsAktif) { return 'OK: Kazıma başladı' } else { return 'HATA: Başlatılamadı (makinedeki mesajlara bak)' }
        }
        'duraklat' {
            if (-not (Baglan) -or -not (Calisiyor-Mu)) { return 'HATA: Çalışan iş yok' }
            Yaz "Uzaktan ($ip): DURAKLAT"
            if (Rc-Tamam ([Eding]::CncPauseJob())) { return 'OK: Duraklatıldı' } else { return 'HATA: Duraklatılamadı' }
        }
        'durdur' {
            if (-not (Baglan) -or (-not (Calisiyor-Mu) -and -not (Durakli-Mi))) { return 'HATA: Çalışan iş yok' }
            Yaz "Uzaktan ($ip): DURDUR"
            Btn-Durdur
            return 'OK: Durduruldu'
        }
        'blok' {
            $p = $arg.Split('|')
            $metin = Blok-Metin-Temizle $p[0]
            $T = Metin-Sayi $(if ($p.Length -gt 1) { $p[1] } else { '' }); $D = Metin-Sayi $(if ($p.Length -gt 2) { $p[2] } else { '' })
            if (-not $metin) { return 'HATA: Blok ismi boş (rakam, harf, - . /)' }
            if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { return 'HATA: Kalınlık 10–30 mm olmalı' }
            if ($null -eq $D -or $D -lt 0.05 -or $D -gt 0.5) { return 'HATA: Derinlik 0.05–0.5 mm olmalı' }
            if ((Is-Suruyor)) { return 'HATA: Kazıma sürerken / duraklıyken blok ismi değiştirilemez' }
            $script:Tercih.SadeKalinlik = "$T"; $script:Tercih.SadeDerinlik = "$D"; Tercih-Yaz
            $taraf = if ($script:Tercih.SadeTaraf -eq '3') { '3' } else { '9' }
            $script:BekleyenBlok = @{ Metin = $metin; T = $T; Takim = 2; Cap = 1.0; Yuk = 4.0; Konum = $taraf; Cizgi = $true; Derin = $D }
            Blok-Cip-Guncelle
            Yaz "Uzaktan ($ip): sıradaki işten önce '$metin' kazınacak"
            return "OK: '$metin' sıradaki işten önce kazınacak"
        }
        'blokiptal' { $script:BekleyenBlok = $null; Blok-Cip-Guncelle; return 'OK: Bekleyen blok ismi iptal edildi' }
    }
    return "HATA: bilinmeyen komut '$ad'"
}
function Uzak-Durum {
    $d = Eding-Durum
    $tk = 0; try { if ($script:Bagli) { $tk = [Eding]::CncGetCurrentToolNumber() } } catch { }
    $acil = [Eding]::AcilKilit; try { if ($script:Bagli -and [Eding]::CncGetEMStopActive() -ne 0) { $acil = $true } } catch { }
    $o = [ordered]@{
        durum = $d; durumMetin = ($lblDurum.Text -replace '^[●\s]+', ''); calisiyor = [bool](Mesgul $d); durakli = ($d -like 'PAUSE*'); acil = [bool]$acil
        dosya = $(if ($script:SeciliDosya) { $lblDosya.Text } else { '' }); dosyaAd = $(if ($script:SeciliDosya) { [System.IO.Path]::GetFileName($script:SeciliDosya) } else { '' })
        takim = [int]$tk; yuzde = [int]$bar.Value; sure = $lblSure.Text
        hazir = [bool]$script:BlokHazir; kilit = ($script:Tercih.UzakKilit -ne '0')
        bekleyenBlok = $(if ($script:BekleyenBlok) { $script:BekleyenBlok.Metin } else { '' })
        engel = [bool]($script:SeciliDosya -and $script:Engel); hatalar = @($script:SonHatalar); uyarilar = @($script:Uyarilar)
        mesajlar = @($script:SonMesajlar | Select-Object -Last 12)
        kalinlik = $(if ($script:Tercih.SadeKalinlik) { $script:Tercih.SadeKalinlik } else { '18' })
        derinlik = $(if ($script:Tercih.SadeDerinlik) { $script:Tercih.SadeDerinlik } else { '0.15' })
        sonrakiNo = "$(Blok-Sonraki-No)"
        ad = [string]$script:Tercih.MakineAdi; mod = [string]$script:Tercih.FrezModu
    }
    [WebSunucu]::DurumJson = (ConvertTo-Json $o -Compress -Depth 3)
    # UZ-05: iş sürerken yükleme yok, seçili iş dosyasının üstüne yazılmaz
    [WebSunucu]::YuklemeKilit = [bool](Is-Suruyor)
    $sa = ''; try { if ($script:SeciliDosya) { $sa = [System.IO.Path]::GetFileName([string]$script:SeciliDosya) } } catch { }
    [WebSunucu]::SeciliAd = $sa
}
$script:UzakMesgul = $false; $script:UzakSayac = 0

function Uzak-Baslat {
    if ($script:Tercih.Uzak -ne '1' -or -not $MakineBilgisayari) { return }
    [WebSunucu]::Pin = [string]$script:Tercih.WebPin
    [WebSunucu]::SayfaYolu = [System.IO.Path]::Combine($ScriptKlasor, 'uzak.html')
    [WebSunucu]::IsKlasor = $IsKlasor
    if ([WebSunucu]::Baslat(8080)) {
        $adr = @([WebSunucu]::Adresler() | ForEach-Object { "http://$($_):$([WebSunucu]::Port)" }) -join '   '
        $script:UzakAdres = $adr
        Yaz "Uzaktan erişim açık: $adr   (PIN: Ayarlar › PANEL)"
        $uzakZaman.Start()
    } else { $script:UzakAdres = ''; $script:UzakHata = [WebSunucu]::SonHata; Yaz "Uzaktan erişim açılamadı: $([WebSunucu]::SonHata)" }
    Uzak-Etiket-Guncelle
}
function Uzak-Etiket-Guncelle {
    try {
        $lblUzak.Text = if ($script:Tercih.Uzak -ne '1') { 'Kapalı' } elseif ($script:UzakAdres) { "Adres:  $($script:UzakAdres)`r`nPIN:  $($script:Tercih.WebPin)" } else { "Açılamadı: $($script:UzakHata)`r`nYoneticiKurulum.bat bir kez çalıştırılıp bilgisayar yeniden başlatılmalı" }
    } catch { }
}
