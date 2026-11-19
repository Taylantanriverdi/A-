# Kalibrasyon.ps1 - yuva ayarı sihirbazı (frez alma kalibrasyonu), disk kalibrasyonu, otomatik kalibrasyon (prob testi dahil).
# Fonksiyonlar düzeltilmiş eski panelden taşındı; metin kutusu / etiket yerine durum değişkenleri ($script:...) kullanılır,
# görünüm bunları MakineDurumu ile çizer (lib/Denetleyici.ps1 Durum-Topla). Değişenler: tests/TASIMA_DEGISEN.txt.
# PowerShell 5.1 (32 bit) uyumlu.

# ---- Sekme: YUVA AYARI (frez alma kalibrasyonu sihirbazı) ----
# Değerler önce burada toplanır (yeni), KAYDET'e basınca hepsi birden Eding'e yazılır.
$script:YuvaAdlari = @('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Sensör', 'Değişim')
$script:YuvaYeni = @{}
$script:YuvaSecili = 'T1'

function Yuva-Kayitli([string]$ad) {
    # Eding'deki kayıtlı değer (makine koordinatı); kayıt yoksa doğrulanmış varsayılan
    $x = [Eding]::CncGetVariable(4010); $a = [Eding]::CncGetVariable(4017); $b = [Eding]::CncGetVariable(4018)
    if ($ad -eq 'Değişim') {
        $dx = [Eding]::CncGetVariable(4031); $dy = [Eding]::CncGetVariable(4032)
        return @{ X = $dx; Y = $dy; Z = [Eding]::CncGetVariable(4033); A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225); Var = ($dx -ne 0 -and $dy -ne 0) }
    }
    if ($ad -eq 'Sensör') {
        $sx = [Eding]::CncGetVariable(4020); $sy = [Eding]::CncGetVariable(4021)
        return @{ X = $sx; Y = $sy; A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225); Var = ($sx -ne 0 -and $sy -ne 0) }
    }
    $n = [int]$ad.Substring(1)
    $y = [Eding]::CncGetVariable(4010 + $n)
    if ($x -eq 0 -or $y -eq 0) { return @{ X = $RafVarsayilan.X; Y = $RafVarsayilan.Y1 + $RafAralik[$n]; A = $RafVarsayilan.A; B = $RafVarsayilan.B; Var = $false } }
    return @{ X = $x; Y = $y; A = $a; B = $b; Var = $true }
}

function Yuva-Hedef([string]$ad) {
    # Gidilecek nokta: yeni alınmışsa o; T1 yeni alınmışsa diğerleri onunla birlikte kaydırılmış tahmin
    if ($script:YuvaYeni.ContainsKey($ad)) {
        $k = Yuva-Kayitli $ad; $y = $script:YuvaYeni[$ad]
        $t1 = if ($script:YuvaYeni.ContainsKey('T1')) { $script:YuvaYeni['T1'] } else { $null }
        if ($ad -eq 'Sensör') { return @{ X = $y.X; Y = $y.Y; A = $k.A; B = $k.B } }
        if ($ad -eq 'Değişim') { return @{ X = $y.X; Y = $y.Y; Z = $y.Z; A = $k.A; B = $k.B } }
        if ($ad -eq 'T1') { return @{ X = $y.X; Y = $y.Y; A = $y.A; B = $y.B } }
        $ref = if ($t1) { $t1 } else { $k }
        return @{ X = $ref.X; Y = $y.Y; A = $ref.A; B = $ref.B }
    }
    $k = Yuva-Kayitli $ad
    if ($ad -ne 'Sensör' -and $ad -ne 'Değişim' -and $ad -ne 'T1' -and $script:YuvaYeni.ContainsKey('T1')) {
        $t1 = $script:YuvaYeni['T1']; $k1 = Yuva-Kayitli 'T1'
        return @{ X = $t1.X; Y = $k.Y + ($t1.Y - $k1.Y); A = $t1.A; B = $t1.B }
    }
    return $k
}

function Yuva-Liste-Yenile {
    if (-not $script:ApiHazir -or -not $script:Bagli) { return }
    try {
        $lvYuva.BeginUpdate()
        $lvYuva.Items.Clear()
        foreach ($ad in $script:YuvaAdlari) {
            $k = Yuva-Kayitli $ad
            $kTxt = if ($k.Var) { "X $(Sayi $k.X)  Y $(Sayi $k.Y)" } else { 'kayıt yok' }
            $yTxt = '—'; $dTxt = 'ölçülmedi'
            if ($script:YuvaYeni.ContainsKey($ad)) {
                $y = $script:YuvaYeni[$ad]
                $yTxt = if ($ad -eq 'T1' -or $ad -eq 'Sensör' -or $ad -eq 'Değişim') { "X $(Sayi $y.X)  Y $(Sayi $y.Y)" } else { "Y $(Sayi $y.Y)" }
                if ($k.Var) { $dTxt = "ΔY $(Sayi ($y.Y - $k.Y))" } else { $dTxt = 'yeni' }
            }
            $it = New-Object System.Windows.Forms.ListViewItem($ad)
            [void]$it.SubItems.Add($kTxt); [void]$it.SubItems.Add($yTxt); [void]$it.SubItems.Add($dTxt)
            if ($script:YuvaYeni.ContainsKey($ad)) { $it.ForeColor = $cYesil }
            [void]$lvYuva.Items.Add($it)
            if ($ad -eq $script:YuvaSecili) { $it.Selected = $true }
        }
        $lvYuva.EndUpdate()
        $t1 = Yuva-Kayitli 'T1'
        $lblYuvaOrtak.Text = "Kayıtlı ortak değerler:  A $(Sayi $t1.A)   B $(Sayi $t1.B)   alma Z $(Sayi ([Eding]::CncGetVariable(4000)))   yaklaşma Z $(Sayi ([Eding]::CncGetVariable(4001)))" +
                             $(if ($script:YuvaYeni.Count -gt 0) { "      ·      $($script:YuvaYeni.Count) yeni değer KAYDEDİLMEDİ" } else { '' })
        $lblYuvaOrtak.ForeColor = if ($script:YuvaYeni.Count -gt 0) { $cAltinAc } else { $cSoluk }
        $lblYuvaSecili.Text = "Seçili: $script:YuvaSecili"
        $btnYuvaAl.Text = "BU KONUMU AL  ($script:YuvaSecili)"
    } catch { try { $lvYuva.EndUpdate() } catch { } }
}

function Yuva-Git {
    if (-not (Hazir-Hareket 'Yuvaya git')) { return }
    $ad = $script:YuvaSecili
    if ($ad -ne 'Sensör' -and $ad -ne 'Değişim' -and [Eding]::CncGetCurrentToolNumber() -ne 0) {
        if (-not (Onay "İş milinde freze var (T$([Eding]::CncGetCurrentToolNumber())). $ad yuvasında freze varsa çarpabilir; iş mili en üstte gidecek ve üstünde duracak. Devam?" 'Yuvaya git')) { return }
    }
    $h = Yuva-Hedef $ad
    $sat = @('G90 G53 G0 Z[#5163]', "G53 G0 A$(Sayi $h.A) B$(Sayi $h.B)", "G53 G0 X$(Sayi $h.X) Y$(Sayi $h.Y)")
    if ($ad -eq 'Değişim' -and $h.Z -and $h.Z -ne 0) { $sat += "G53 G0 Z$(Sayi $h.Z)" }
    $ok = Satirlar-Gonder "$ad noktasına git" $sat 90
    if ($ok) { $lblYuvaDurum.Text = "İş mili $ad üstünde (en üstte). Şimdi X/Y ile ortala, gerekirse aşağı in." }
}

function Yuva-Yaklas {
    if (-not (Hazir-Hareket 'Yaklaş')) { return }
    # K7 (GV-03): Sensör dahil her noktada iş milinde frez varken inilmez (#4001 sensör ölçüm aralığının çok altında: frez sensöre basar)
    if ([Eding]::CncGetCurrentToolNumber() -ne 0) { (Ui-Kutu "İş milinde freze varken $($script:YuvaSecili) noktasına inilemez (çarpar / sensöre basar). Önce bırak (T0) ya da pensi açıp frezi elle çıkar." 'Yaklaş' 'OK' 'Warning') | Out-Null; return }
    $z = [Eding]::CncGetVariable(4001)
    if (-not (Onay "İş mili yaklaşma yüksekliğine (Z $(Sayi $z)) yavaşça inecek ve frezeye değmeden duracak. Devam?" 'Yaklaş')) { return }
    if (Satirlar-Gonder 'Yaklaş' @("G90 G53 G1 Z$(Sayi $z) F300") 60) { $lblYuvaDurum.Text = "Yaklaşma yüksekliğinde. İnce ayar için 0.1 / 0.01 adımla Z− kullan." }
}

function Yuva-Al {
    if (-not (Baglan)) { return }
    if ([Eding]::AcilKilit) { (Ui-Kutu 'ACİL STOP basılı.' 'Konumu al' 'OK' 'Warning') | Out-Null; return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine hareket ediyor, durmasını bekle.' 'Konumu al' 'OK' 'Information') | Out-Null; return }
    $ad = $script:YuvaSecili
    $p = [Eding]::MachinePos()
    if ($ad -eq 'Değişim') {
        $zTop = [Eding]::CncGetVariable(5163)
        $z = if ([math]::Abs($p.Z - $zTop) -lt 0.5) { 0 } else { $p.Z }
        $script:YuvaYeni[$ad] = @{ X = $p.X; Y = $p.Y; Z = $z }
    } elseif ($ad -eq 'Sensör') {
        $gA = [Eding]::CncGetVariable(5224)
        if ([math]::Abs($p.A - $gA) -gt 0.05) { (Ui-Kutu "Sensör G54 A açısında ölçülür (A $(Sayi $gA)), şu an A $(Sayi $p.A).`r`nÖnce 'Yuvaya git' ile sensörün üstüne git, sonra sadece X/Y ile ortala." 'Konumu al' 'OK' 'Warning') | Out-Null; return }
        $script:YuvaYeni[$ad] = @{ X = $p.X; Y = $p.Y }
    } elseif ($ad -eq 'T1') {
        $e = @{ X = $p.X; Y = $p.Y; A = $p.A; B = $p.B }
        if ($chkYuvaZ.Checked) {
            if ($p.Z -gt ([Eding]::CncGetVariable(4001) - 3)) {
                if (-not (Onay "Z $(Sayi $p.Z) alma yüksekliği için fazla yukarıda görünüyor.`r`nYine de alma yüksekliği olarak alınsın mı?" 'Konumu al')) { return }
            }
            $e.Z = $p.Z
        }
        $script:YuvaYeni[$ad] = $e
    } else {
        $ref = if ($script:YuvaYeni.ContainsKey('T1')) { $script:YuvaYeni['T1'] } else { Yuva-Kayitli 'T1' }
        $uyar = @()
        if ([math]::Abs($p.X - $ref.X) -gt 0.3) { $uyar += "X $(Sayi $p.X) (T1: $(Sayi $ref.X))" }
        if ([math]::Abs($p.A - $ref.A) -gt 0.05) { $uyar += "A $(Sayi $p.A) (T1: $(Sayi $ref.A))" }
        if ($uyar.Count -gt 0) {
            if (-not (Onay ("Bütün yuvalar T1'in X, A ve B değerini kullanır. Bu konum farklı:`r`n" + ($uyar -join "`r`n") + "`r`n`r`nSadece Y alınacak. Devam?") 'Konumu al')) { return }
        }
        $script:YuvaYeni[$ad] = @{ Y = $p.Y }
    }
    [Kayit]::Yaz("YUVA AYARI: $ad alındı (kaydedilmedi): X $(Sayi $p.X) Y $(Sayi $p.Y) Z $(Sayi $p.Z) A $(Sayi $p.A) B $(Sayi $p.B)")
    $lblYuvaDurum.Text = "$ad alındı. Diğer yuvalara geç ya da KAYDET."
    # Sıradakini seç
    $i = [array]::IndexOf($script:YuvaAdlari, $ad)
    if ($i -ge 0 -and $i -lt $script:YuvaAdlari.Count - 1) { $script:YuvaSecili = $script:YuvaAdlari[$i + 1] }
    Yuva-Liste-Yenile
}

function Yuva-Kaydet {
    if ($script:YuvaYeni.Count -eq 0) { (Ui-Kutu 'Kaydedilecek yeni değer yok. Önce yuvaları "BU KONUMU AL" ile ölç.' 'Kaydet' 'OK' 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Yuva kaydet')) { return }
    $kT1 = Yuva-Kayitli 'T1'
    $yaz = [ordered]@{}
    $kaydir = $false
    if ($script:YuvaYeni.ContainsKey('T1')) {
        $t1 = $script:YuvaYeni['T1']
        $yaz[4010] = $t1.X; $yaz[4011] = $t1.Y; $yaz[4017] = $t1.A; $yaz[4018] = $t1.B
        if ($t1.ContainsKey('Z')) { $yaz[4000] = $t1.Z }
        $eksik = @(2..6 | Where-Object { -not $script:YuvaYeni.ContainsKey("T$_") })
        if ($eksik.Count -gt 0) {
            $c = (Ui-Kutu "T1 değişti (ΔY $(Sayi ($t1.Y - $kT1.Y)) mm). Ölçülmeyen yuvalar: $((($eksik | ForEach-Object { "T$_" }) -join ', ')).`r`n`r`nEVET: bunlar da T1 ile aynı miktarda kaysın (önerilen)`r`nHAYIR: eski değerlerinde kalsınlar`r`nİPTAL: vazgeç" 'Kaydet' 'YesNoCancel' 'Question')
            if ("$c" -eq 'Cancel') { return }
            $kaydir = ("$c" -eq 'Yes')
        }
    }
    for ($n = 2; $n -le 6; $n++) {
        if ($script:YuvaYeni.ContainsKey("T$n")) { $yaz[4010 + $n] = $script:YuvaYeni["T$n"].Y }
        elseif ($kaydir) { $yaz[4010 + $n] = (Yuva-Kayitli "T$n").Y + ($script:YuvaYeni['T1'].Y - $kT1.Y) }
    }
    if ($script:YuvaYeni.ContainsKey('Sensör')) { $yaz[4020] = $script:YuvaYeni['Sensör'].X; $yaz[4021] = $script:YuvaYeni['Sensör'].Y }
    if ($script:YuvaYeni.ContainsKey('Değişim')) { $yaz[4031] = $script:YuvaYeni['Değişim'].X; $yaz[4032] = $script:YuvaYeni['Değişim'].Y; $yaz[4033] = $script:YuvaYeni['Değişim'].Z }
    $ad = @{ 4000 = 'alma Z'; 4010 = 'yuva X'; 4011 = 'T1 Y'; 4012 = 'T2 Y'; 4013 = 'T3 Y'; 4014 = 'T4 Y'; 4015 = 'T5 Y'; 4016 = 'T6 Y'; 4017 = 'yuva A'; 4018 = 'yuva B'; 4020 = 'sensör X'; 4021 = 'sensör Y'; 4031 = 'değişim X'; 4032 = 'değişim Y'; 4033 = 'değişim Z' }
    $ozet = (@($yaz.Keys | ForEach-Object { "{0,-10} {1,10}   (eski {2})" -f $ad[[int]$_], (Sayi $yaz[$_]), (Sayi ([Eding]::CncGetVariable([int]$_))) }) -join "`r`n")
    if (-not (Onay "Şu değerler kaydedilecek:`r`n`r`n$ozet`r`n`r`nÖnce otomatik yedek alınır. Kaydedilsin mi?" 'Yuva kaydet')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $ok = $true
    foreach ($nr in $yaz.Keys) { if ($ok) { $ok = (Degisken-Yaz ([int]$nr) ([double]$yaz[$nr])) } }
    if ($ok) {
        $script:YuvaYeni = @{}
        $script:RafKontrolTamam = $true
        Yaz 'Yuva kalibrasyonu kaydedildi.'
        (Ui-Kutu "Kaydedildi. Bir sonraki frez değişiminde kullanılır (Eding'i yeniden başlatmak gerekmez).`r`n`r`nŞimdi 'Test: seçili yuvadan al' ile dene." 'Yuva kaydet' 'OK' 'Information') | Out-Null
    } else {
        (Ui-Kutu 'Kaydetme yarıda kaldı. Eding hazır durumda mı? Yedekten geri dönebilirsin (KALİBRASYON > Yedekten yükle).' 'Yuva kaydet' 'OK' 'Warning') | Out-Null
    }
    Yuva-Liste-Yenile
}

function Yuva-Sifirla {
    if ($script:YuvaYeni.Count -gt 0 -and -not (Onay "Alınan $($script:YuvaYeni.Count) değer silinecek, kalibrasyona baştan başlanacak.`r`nEding'deki kayıtlı değerler DEĞİŞMEZ. Devam?" 'Baştan başla')) { return }
    $script:YuvaYeni = @{}
    $script:YuvaSecili = 'T1'
    $lblYuvaDurum.Text = 'Baştan başlandı. T1 seçili: "Yuvaya git" ile başla.'
    [Kayit]::Yaz('YUVA AYARI: baştan başlandı')
    Yuva-Liste-Yenile
}

function Yuva-Varsayilan {
    # K5: varsayılanların yazıldığı TEK yer. Önce yedek (başarılı olmalı), sonra yazılacak değerlerin tamamı gösterilip onay alınır.
    if (-not (Hazir-Hareket 'Doğrulanmış değerler')) { return }
    $yaz = [ordered]@{ 4010 = $RafVarsayilan.X }
    for ($n = 1; $n -le 6; $n++) { $yaz[4010 + $n] = $RafVarsayilan.Y1 + $RafAralik[$n] }
    $yaz[4017] = $RafVarsayilan.A; $yaz[4018] = $RafVarsayilan.B; $yaz[4000] = $RafVarsayilan.AlmaZ
    $ek = @()
    if ([Eding]::CncGetVariable(4020) -eq 0 -or [Eding]::CncGetVariable(4021) -eq 0) {
        $gx = [Eding]::CncGetVariable(5221); $gy = [Eding]::CncGetVariable(5222)
        if ($gx -eq 0 -or $gy -eq 0) { (Ui-Kutu "Sensör kayıtlı değil ve G54 X/Y okunamadı (0). Sensör varsayılanı hesaplanamaz.`r`nÖnce Eding'in tam açıldığından emin ol." 'Doğrulanmış değerler' 'OK' 'Warning') | Out-Null; return }
        $yaz[4020] = $gx - $RafSensorXFark; $yaz[4021] = $gy; $ek += 'sensör (kayıtlı değildi: G54 X - 72.25, G54 Y)'
    }
    if ([Eding]::CncGetVariable(4031) -eq 0 -or [Eding]::CncGetVariable(4032) -eq 0) {
        $yaz[4031] = $RafDegisimVarsayilan.X; $yaz[4032] = $RafDegisimVarsayilan.Y; $yaz[4033] = $RafDegisimVarsayilan.Z; $ek += 'manuel değişim noktası (kayıtlı değildi)'
    }
    $ad = @{ 4000 = 'alma Z'; 4010 = 'yuva X'; 4011 = 'T1 Y'; 4012 = 'T2 Y'; 4013 = 'T3 Y'; 4014 = 'T4 Y'; 4015 = 'T5 Y'; 4016 = 'T6 Y'; 4017 = 'yuva A'; 4018 = 'yuva B'; 4020 = 'sensör X'; 4021 = 'sensör Y'; 4031 = 'değişim X'; 4032 = 'değişim Y'; 4033 = 'değişim Z' }
    $ozet = (@($yaz.Keys | ForEach-Object { "#{0} {1,-10} {2,10}   (şu an {3})" -f $_, $ad[[int]$_], (Sayi $yaz[$_]), (Sayi ([Eding]::CncGetVariable([int]$_))) }) -join "`r`n")
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $m = "Frez yuvaları 22.10.2026'da doğrulanan değerlere dönecek. Yazılacak değerler (makine koordinatı):`r`n`r`n$ozet`r`n`r`n" +
         $(if ($ek.Count) { "Ayrıca: $($ek -join ', ').`r`n" } else { "Kayıtlı sensör ve değişim noktası değişmez.`r`n" }) +
         "Yedek alındı. Bu değerler takım alma / bırakma konumlarını belirler. Yazılsın mı?"
    if (-not (Onay $m 'Doğrulanmış değerler')) { return }
    $ok = $true
    foreach ($nr in $yaz.Keys) { if ($ok) { $ok = (Degisken-Yaz ([int]$nr) ([double]$yaz[$nr])) } }
    $script:YuvaYeni = @{}
    Yaz $(if ($ok) { 'Yuvalar doğrulanmış değerlere döndü.' } else { 'Doğrulanmış değerler yazılamadı (yedekten geri dönülebilir).' })
    try { Raf-Kontrol } catch { }
    Yuva-Liste-Yenile
}

function Yuva-Test([int]$n) {
    if ($script:YuvaYeni.Count -gt 0) { (Ui-Kutu 'Kaydedilmemiş değerler var. Test kayıtlı değerlerle yapılır; önce KAYDET.' 'Test' 'OK' 'Information') | Out-Null; return }
    Takim-Degistir $n
}

function Kal-Degerleri-Goster {
    if (-not $script:ApiHazir -or -not $script:Bagli) { $lblKalSimdi.Text = 'Eding bağlı değil'; return }
    $g = @(5221, 5222, 5223, 5224, 5225 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblKalSimdi.Text = "Şu an  G54  X $($g[0])  Y $($g[1])  Z $($g[2])  A $($g[3])  B $($g[4])   ·   #4002 $(Sayi ([Eding]::CncGetVariable(4002)))"
}

function Kal-Test-Hazirla {
    $T = Metin-Sayi $txtKalT.Text; $D = Metin-Sayi $txtKalD.Text
    if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { (Ui-Kutu 'Disk kalınlığını kumpasla ölçüp yaz (10–30 mm).' 'Test bloğu' 'OK' 'Warning') | Out-Null; return }
    if ($null -eq $D -or $D -lt 0.5 -or $D -gt 3) { (Ui-Kutu 'T1 frez çapını yaz (genelde 2.0 mm).' 'Test bloğu' 'OK' 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Test bloğu') { return }
    $k = $cmbKalTest.SelectedIndex + 1
    $dzK = Kal-Duzen $k
    $m = "Kalibrasyon testi $k / 4 hazırlanacak ve seçilecek:`r`n`r`n" +
         "• T1 (Ø$(Sayi $D)) ile, disk $(Sayi $T) mm`r`n• Bir diske 4 test sığar. Test ${k}: dış cepler saat $($dzK.Sag.Saat)'ten başlar, iç grup $($KalGrupYer[$k])`r`n" +
         "• Bu disk $(if ($k -eq 1) { 'YENİ (boş) olmalı' } else { "daha önce test 1..$($k - 1) için kullanılmış olabilir; aynı yüz üstte olmalı" })`r`n" +
         "• En derin kesim yüzeyden $(Sayi ($T / 2 + 1)) mm: frezin boyu yetmeli`r`n• Süre: yaklaşık 15 dakika`r`n`r`nSonra ana ekranda BAŞLAT'a bas. Devam?"
    if (-not (Onay $m 'Test bloğu')) { return }
    # Frez nasıl takılacak? (manuel modda T1'i makine ortaya gelince elle takarsın, sonunda elle çıkarırsın)
    if (-not (Baglan)) { (Ui-Kutu "Eding'e bağlanılamadı." 'Test bloğu' 'OK' 'Warning') | Out-Null; return }
    $mod = Frez-Modu-Sor
    if (-not $mod) { return }
    if (-not (Frez-Modu-Yaz ($mod -eq 'MANUEL'))) { return }
    if ($mod -eq 'MANUEL' -and -not (Manuel-Macro-Kontrol)) { return }
    try {
        $metin = Kal-NC-Uret $T $D $k
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $hedef = [System.IO.Path]::Combine($IsKlasor, "PM_kalibrasyon_testi_$k.nc")
        [System.IO.File]::WriteAllText($hedef, $metin)
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        $script:SeciliDosya = $hedef
        $lblDosya.Text = "PM_kalibrasyon_testi_$k"; $lblDosya.ForeColor = $cYazi
        Yaz "Kalibrasyon testi hazırlandı: $hedef  (disk $(Sayi $T), T1 Ø$(Sayi $D))"
        Dosyayi-Kontrol-Et $hedef
        $script:Tercih.KalT = $txtKalT.Text; $script:Tercih.KalD = $txtKalD.Text; $script:Tercih.KalTest = "$k"; Tercih-Yaz
        $script:ModOnayliDosya = $hedef
        $lblKalDurum.Text = if ($mod -eq 'MANUEL') { "Test $k seçildi, frez MANUEL. Ana ekranda BAŞLAT: iş mili ortaya gelince T1'i tak, sonunda çıkar. Bitince diski çıkar, ölç." } else { "Test $k seçildi, frez OTOMATİK. Ana ekranda BAŞLAT. Bitince diski çıkar, ölç, değerleri sağa yaz." }
    } catch { (Ui-Kutu "Test programı yazılamadı: $($_.Exception.Message)" 'Test bloğu' 'OK' 'Error') | Out-Null }
}

function Kal-Hesapla {
    $T = Metin-Sayi $txtKalT.Text
    $o = @{}
    foreach ($k in $KalOlcumTanim.Keys) {
        $v = Metin-Sayi $script:KalKutu[$k].Text
        if ($null -eq $v) { (Ui-Kutu "Ölçüm eksik: $($KalOlcumTanim[$k][0])" 'Hesapla' 'OK' 'Warning') | Out-Null; return }
        $o[$k] = $v
    }
    if ($null -eq $T) { (Ui-Kutu 'Disk kalınlığı eksik.' 'Hesapla' 'OK' 'Warning') | Out-Null; return }
    $sA = if ($chkKalA.Checked) { -1 } else { 1 }; $sB = if ($chkKalB.Checked) { -1 } else { 1 }; $sY = if ($chkKalY.Checked) { -1 } else { 1 }
    $k = $cmbKalTest.SelectedIndex + 1
    $dz = Kal-Duzen $k
    $th = $dz.Th * [math]::PI / 180
    # (PowerShell değişken adları büyük/küçük harf ayırmaz: eğimler $egX/$egY, yön işaretleri $sA/$sB/$sY)
    # Yüzey eğimi doğrudan ölçülen derinliklerden (yön bilgisi gerekmez); test döndürülmüşse X/Y'ye çevrilir
    $su = ($o.dR - $o.dL) / (2 * $KalHalkaR); $sv = ($o.dF - $o.dK) / (2 * $KalHalkaR)
    $egX = $su * [math]::Cos($th) - $sv * [math]::Sin($th)
    $egY = $su * [math]::Sin($th) + $sv * [math]::Cos($th)
    $dx = (4.0 - $o.w) / 2
    $web = $T - $o.d1 - $o.d2
    $h = 1.0 - $web / 2 - $egY * $dz.Cy
    $dB = [math]::Atan($egX) * 180 / [math]::PI
    $dA = [math]::Atan($egY) * 180 / [math]::PI
    $dy = ($o.dAp - $o.dAm - $egX * 18.0) / (2 * [math]::Sin(20 * [math]::PI / 180))
    $mOrta = $o.d1 - $T / 2 + 1 - ($egX * $dz.Cx + $egY * $dz.Cy) - $h
    $g = @{ X = [Eding]::CncGetVariable(5221); Y = [Eding]::CncGetVariable(5222); A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225) }
    $p4002 = [Eding]::CncGetVariable(4002)
    $script:KalSonuc = @{
        X = $g.X + $dx; Y = $g.Y + $sY * $dy; A = $g.A + $sA * $dA; B = $g.B + $sB * $dB; P4002 = $p4002 - $h
        dx = $dx; dy = $sY * $dy; h = $h; dA = $sA * $dA; dB = $sB * $dB; m = $mOrta; web = $web; O = $o; T = $T; Test = $k
        Eski = "X $(Sayi $g.X) Y $(Sayi $g.Y) A $(Sayi $g.A) B $(Sayi $g.B) #4002 $(Sayi $p4002)"
    }
    $iyi = { param($v, $s) if ([math]::Abs($v) -le $s) { '✓' } else { '' } }
    $sonucMetni = "X  düzeltme $(Sayi $dx) mm   →  G54 X $(Sayi $script:KalSonuc.X)  $(& $iyi $dx 0.02)`r`n" +
         "Y  düzeltme $(Sayi ($sY * $dy)) mm   →  G54 Y $(Sayi $script:KalSonuc.Y)  $(& $iyi $dy 0.02)`r`n" +
         "Z  düzeltme $(Sayi (-$h)) mm   →  #4002 $(Sayi $script:KalSonuc.P4002)   (web $(Sayi $web), olması gereken 2.000)  $(& $iyi $h 0.02)`r`n" +
         "A  düzeltme $(Sayi ($sA * $dA))°   →  G54 A $(Sayi $script:KalSonuc.A)  $(& $iyi $dA 0.05)`r`n" +
         "B  düzeltme $(Sayi ($sB * $dB))°   →  G54 B $(Sayi $script:KalSonuc.B)  $(& $iyi $dB 0.05)"
    if ([math]::Abs($mOrta) -gt 0.1) { $sonucMetni += "`r`n`r`nNOT: disk ortası B ekseninden $(Sayi $mOrta) mm kaçık. Bu yazılımla düzeltilemez: disk tutucuya tam oturmuş mu, kalınlığı CAM'deki ile aynı mı?" }
    $buyuk = ([math]::Abs($dx) -gt 2 -or [math]::Abs($dy) -gt 3 -or [math]::Abs($h) -gt 2 -or [math]::Abs($dA) -gt 4 -or [math]::Abs($dB) -gt 4)
    if ($buyuk) { $sonucMetni += "`r`n`r`nDİKKAT: düzeltmelerden biri çok büyük. Ölçümleri ve cepleri (çaplarına göre) tekrar kontrol et." }
    $lblKalSonuc.Text = $sonucMetni
    $lblKalSonuc.ForeColor = if ($buyuk) { $cKirmizi } else { $cYazi }
    $btnKalUygula.Enabled = $true
    [Kayit]::Yaz("DİSK KALİBRASYONU hesap (test $k): dx $(Sayi $dx) dy $(Sayi ($sY*$dy)) h $(Sayi $h) dA $(Sayi ($sA*$dA)) dB $(Sayi ($sB*$dB)) m $(Sayi $mOrta)  ölçümler: " + (($KalOlcumTanim.Keys | ForEach-Object { "$_=$($o[$_])" }) -join ' '))
}

function Kal-Uygula {
    $r = $script:KalSonuc
    if (-not $r) { (Ui-Kutu 'Önce ölçümleri yaz ve HESAPLA''ya bas.' 'Disk kalibrasyonu' 'OK' 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Disk kalibrasyonu')) { return }
    $g92 = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    $m = "Yeni disk kalibrasyonu kaydedilecek:`r`n`r`nG54  X $(Sayi $r.X)   Y $(Sayi $r.Y)   A $(Sayi $r.A)   B $(Sayi $r.B)`r`n#4002 (Z sıfırı) $(Sayi $r.P4002)`r`n`r`nEski: $($r.Eski)`r`n`r`n" +
         $(if ($g92.Count) { "X/Y/A/B'deki G92 kaydırmaları da sıfırlanacak.`r`n" } else { '' }) +
         "Önce otomatik yedek alınır. Sonra bir frez değişimi yap (Z yeniden ölçülsün). Devam?"
    if (-not (Onay $m 'Disk kalibrasyonu')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $ok = $true
    if ($g92.Count) { $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $r.X) Y$(Sayi $r.Y) A$(Sayi $r.A) B$(Sayi $r.B)")); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Degisken-Yaz 4002 $r.P4002 }
    try {
        if (-not [System.IO.File]::Exists($KalGecmis)) {
            [System.IO.File]::WriteAllText($KalGecmis, "tarih;test;disk;pencere;d1;d2;sag;sol;on;arka;A+20;A-20;dX;dY;dZ;dA;dB;disk_kacik;eski;yeni_X;yeni_Y;yeni_A;yeni_B;yeni_4002;uygulandi`r`n", [System.Text.Encoding]::UTF8)
        }
        $o = $r.O
        $satir = (@((Get-Date -Format 'yyyy-MM-dd HH:mm'), $r.Test, (Sayi $r.T), $o.w, $o.d1, $o.d2, $o.dR, $o.dL, $o.dF, $o.dK, $o.dAp, $o.dAm,
                   (Sayi $r.dx), (Sayi $r.dy), (Sayi (-$r.h)), (Sayi $r.dA), (Sayi $r.dB), (Sayi $r.m), $r.Eski,
                   (Sayi $r.X), (Sayi $r.Y), (Sayi $r.A), (Sayi $r.B), (Sayi $r.P4002), $(if ($ok) { 'evet' } else { 'HATA' })) -join ';')
        [System.IO.File]::AppendAllText($KalGecmis, $satir + "`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    Kal-Degerleri-Goster
    try { Ayar-Oku } catch { }
    if ($ok) {
        Yaz "Disk kalibrasyonu kaydedildi: G54 X $(Sayi $r.X) Y $(Sayi $r.Y) A $(Sayi $r.A) B $(Sayi $r.B), #4002 $(Sayi $r.P4002)"
        $script:KalSonuc = $null
        (Ui-Kutu "Kaydedildi (geçmiş: kalibrasyon_gecmisi.csv).`r`n`r`n1. Bir frez değişimi yap ya da 'Frez boyunu ölç'`r`n2. YENİ bir diskte testi tekrar kaz`r`n3. Bütün satırlarda ✓ görünene kadar tekrarla`r`n`r`nBir eksenin hatası küçülmek yerine büyüdüyse o eksenin 'yönü ters' kutusunu işaretle." 'Disk kalibrasyonu' 'OK' 'Information') | Out-Null
    } else {
        (Ui-Kutu 'Kaydetme yarıda kaldı. KALİBRASYON > Yedekten yükle ile geri dönebilirsin.' 'Disk kalibrasyonu' 'OK' 'Warning') | Out-Null
    }
}

function Kal-Yerlesim-Yaz {
    $k = $cmbKalTest.SelectedIndex + 1; if ($k -lt 1) { return }
    $dz = Kal-Duzen $k
    $lblKalYerlesim.Text = "Test $k (üstten bakış, ön = saat 6)`r`n" +
        "Dış cepler, kenara yakın:`r`n" +
        "   Ø5 saat $($dz.Sag.Saat)   Ø8 saat $($dz.On.Saat)   Ø7 saat $($dz.Sol.Saat)   Ø4 saat $($dz.Arka.Saat)`r`n" +
        "İç grup, $($KalGrupYer[$k]):`r`n" +
        "   Ø7 (A−20)  ·  Ø6 Z cebi + $k nokta  ·  Ø8 (A+20)`r`n" +
        "   pencere, Z cebinin arkasında`r`n" +
        "Derinliği kumpasın derinlik ucuyla cebin ortasından ölç."
}

function OtoKal-Goster {
    if (-not $script:ApiHazir -or -not $script:Bagli) { $lblOkSimdi.Text = 'Eding bağlı değil'; return }
    $g = @(5221, 5222, 5223, 5224, 5225 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblOkSimdi.Text = "Şu an  G54  X $($g[0])  Y $($g[1])  Z $($g[2])  A $($g[3])  B $($g[4])   ·   #4002 $(Sayi ([Eding]::CncGetVariable(4002)))"
    $id = [int]([Eding]::CncGetVariable(4199))
    if (-not $script:OkSonuc -and $script:Tercih.OkKimlik -and "$id" -eq "$($script:Tercih.OkKimlik)" -and [Eding]::CncGetVariable(4100) -eq 1) {
        $lblOkDurum.Text = 'Bitmiş bir ölçüm var: SONUÇLARI OKU''ya bas.'
    }
}

# ---- Prob testi: hangi giriş değişiyor? (Eding ekranı gizli olduğu için buradan izlenir)
$script:OkProbTaban = $null

function OtoKal-Prob-Testi {
    if (-not (Baglan)) { (Ui-Kutu "Eding'e bağlanılamadı." 'Prob testi' 'OK' 'Warning') | Out-Null; return }
    if ($tmrProb.Enabled) { $tmrProb.Stop(); $btnOkProb.Text = 'Prob testini başlat'; return }
    $script:OkProbTaban = $null
    $btnOkProb.Text = 'Testi durdur'
    $tmrProb.Start()
}

# K8 (KL-01): otomatik kalibrasyon yalnız bu oturumda, son 10 dakika içinde prob testinde TEMAS görüldüyse ve şu an temas YOKSA hazırlanır / başlar
$script:ProbTemasAni = [datetime]::MinValue
function OtoKal-Prob-Gecerli-Mi([string]$islem) {
    $yas = ((Get-Date) - $script:ProbTemasAni).TotalMinutes
    if ($script:ProbTemasAni -eq [datetime]::MinValue -or $yas -gt 10) {
        (Ui-Kutu "Otomatik kalibrasyondan önce PROB TESTİ zorunlu (son 10 dakika içinde).`r`n`r`nAyarlar › OTO KALİBRASYON › 'Prob testini başlat', kablonun ucunu pime / diske değdir: 'TEMAS VAR' görülmeli.`r`nTemas algılanmazsa pim titanyuma sürülür.`r`n`r`n$islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    if ((OtoKal-Prob-Aktif-Mi) -ne $false) {
        (Ui-Kutu "Prob şu an TEMAS gösteriyor ya da prob girişi okunamıyor.`r`nPim diske değmiyorken 'TEMAS YOK' görülmeli (izolasyon / kablo).`r`n`r`n$islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    return $true
}
function OtoKal-Prob-Aktif-Mi {
    # Öğrenilmiş giriş varsa: şu an temas var mı? (bilinmiyorsa $null)
    $id = 0; if (-not [int]::TryParse("$($script:Tercih.ProbIo)", [ref]$id) -or $id -le 0) { return $null }
    try { return ("$([Eding]::CncGetInput($id))" -eq "$($script:Tercih.ProbAktif)") } catch { return $null }
}

function OtoKal-Hazirla {
    $T = Metin-Sayi $txtOkT.Text
    $ucD = Metin-Sayi $txtOkUcD.Text
    if ($null -eq $ucD -or $ucD -lt 0.5 -or $ucD -gt 6) { (Ui-Kutu 'Temas ucunun çapını yaz (pim genelde 3.00, frez 2.00).' 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null; return }
    if ($null -eq $T -or $T -lt 8 -or $T -gt 30) { (Ui-Kutu 'Titanyum diskin kalınlığını mikrometreyle ölçüp yaz (ör. 10.02).' 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Otomatik kalibrasyon') { return }
    if (-not (Baglan)) { (Ui-Kutu "Eding'e bağlanılamadı." 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null; return }
    if (-not (OtoKal-Prob-Gecerli-Mi 'Otomatik kalibrasyon')) { return }
    $aktif = OtoKal-Prob-Aktif-Mi
    if ($aktif -eq $true) {
        (Ui-Kutu "Prob ŞU AN temas gösteriyor ama pim diske değmiyor.`r`n`r`nDisk tutucuya / şaseye değiyor (izolasyon bozuk) ya da kablo kısa devre. Düzeltmeden ölçüm başlatılamaz." 'Otomatik kalibrasyon' 'OK' 'Error') | Out-Null; return
    }
    $manuel = Frez-Manuel-Mi
    $m = "Otomatik kalibrasyon ölçümü hazırlanacak ve seçilecek:`r`n`r`n" +
         "• Titanyum disk $(Sayi $T) mm, tutucudan İZOLE, kablosu prob girişinde`r`n" +
         "• İş mili DÖNMEZ; makine diske 18 noktada dokunur (A ±$OkTeta°, B ±$OkTeta°, B180)`r`n" +
         $(if ($manuel) { "• Frez MANUEL: 'T1 tak' denince KALİBRASYON PİMİNİ tak (en az 20 mm dışarıda), sonunda çıkar`r`n" } else { "• Frez OTOMATİK: magazindeki T1 ile ölçülür (ucu sağlam olmalı)`r`n" }) +
         $(if ($null -eq $aktif) { "• Prob testi yapılmadı: önce 'Prob testini başlat' ile kabloyu dene (önerilir)`r`n" } else { '' }) +
         "• Süre: yaklaşık 10 dakika. Hiçbir ayar değişmez; değerleri sonra sen onaylarsın.`r`n`r`nSonra ana ekranda BAŞLAT'a bas. Devam?"
    if (-not (Onay $m 'Otomatik kalibrasyon')) { return }
    if ($manuel -and -not (Manuel-Macro-Kontrol)) { return }
    try {
        $kimlik = Get-Random -Minimum 10000 -Maximum 99999
        $metin = OtoKal-NC-Uret $T $kimlik
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $hedef = [System.IO.Path]::Combine($IsKlasor, 'PM_kalibrasyon_otomatik.nc')
        [System.IO.File]::WriteAllText($hedef, $metin)
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        # Aynı programın simülasyon kopyası (X5 Canlı Simülasyon'da izlemek için, satır satır senkron)
        try { [System.IO.File]::WriteAllText([System.IO.Path]::Combine($IsKlasor, 'PM_kalibrasyon_otomatik_SIM.nc'), (OtoKal-Sim-Uret $metin $T)) } catch { }
        $script:SeciliDosya = $hedef
        $lblDosya.Text = 'PM_kalibrasyon_otomatik'; $lblDosya.ForeColor = $cYazi
        Dosyayi-Kontrol-Et $hedef
        $script:Tercih.OkT = $txtOkT.Text; $script:Tercih.OkKimlik = "$kimlik"
        $script:Tercih.OkUc = if ($cmbOkUc.SelectedIndex -eq 1) { 'kure' } else { 'duz' }; $script:Tercih.OkUcD = $txtOkUcD.Text; Tercih-Yaz
        $script:ModOnayliDosya = $hedef
        $script:OkSonuc = $null; $lblOkSonuc.Text = ''; $btnOkUygula.Enabled = $false
        Yaz "Otomatik kalibrasyon ölçümü hazırlandı: $hedef (disk $(Sayi $T), kimlik $kimlik)"
        $lblOkDurum.Text = "Hazır. Ana ekranda BAŞLAT. Bitince buraya dön: SONUÇLARI OKU."
    } catch { (Ui-Kutu "Ölçüm programı yazılamadı: $($_.Exception.Message)" 'Otomatik kalibrasyon' 'OK' 'Error') | Out-Null }
}

function OtoKal-Oku {
    if (-not (Baglan)) { (Ui-Kutu "Eding'e bağlanılamadı." 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null; return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Ölçüm hâlâ çalışıyor. Bitmesini bekle.' 'Otomatik kalibrasyon' 'OK' 'Information') | Out-Null; return }
    $id = [int]([Eding]::CncGetVariable(4199))
    if (-not $script:Tercih.OkKimlik -or "$id" -ne "$($script:Tercih.OkKimlik)") { (Ui-Kutu 'Bu ölçüme ait sonuç yok. Önce ölçümü hazırla ve BAŞLAT ile çalıştır.' 'Otomatik kalibrasyon' 'OK' 'Information') | Out-Null; return }
    if ([Eding]::CncGetVariable(4100) -ne 1) { (Ui-Kutu 'Ölçüm yarıda kalmış (hata ya da durdurma). Eding mesajına bak, sorunu gider, BAŞLAT ile tekrar çalıştır.' 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null; return }
    $T = Metin-Sayi $script:Tercih.OkT
    $z = @{}; $farkMax = 0.0
    for ($i = 0; $i -lt $OkNoktalar.Count; $i++) {
        $a = [Eding]::CncGetVariable(4101 + 2 * $i); $b = [Eding]::CncGetVariable(4102 + 2 * $i)
        $z[$i] = ($a + $b) / 2; $farkMax = [math]::Max($farkMax, [math]::Abs($a - $b))
    }
    $tekrar = @(1..5 | ForEach-Object { [Eding]::CncGetVariable(4140 + $_) })
    $ofs = @{
        X = [Eding]::CncGetVariable(5221) + [Eding]::CncGetVariable(5211); Y = [Eding]::CncGetVariable(5222) + [Eding]::CncGetVariable(5212)
        A = [Eding]::CncGetVariable(5224) + [Eding]::CncGetVariable(5214); B = [Eding]::CncGetVariable(5225) + [Eding]::CncGetVariable(5215)
    }
    $p4002 = [Eding]::CncGetVariable(4002)
    $ucTip = if ($script:Tercih.OkUc -eq 'kure') { 'kure' } else { 'duz' }
    $ucD = Metin-Sayi $script:Tercih.OkUcD; if ($null -eq $ucD) { $ucD = 3.0 }
    try { $r = OtoKal-Hesapla-Ic $z $T $ofs $p4002 $tekrar $farkMax $ucTip ($ucD / 2) }
    catch { (Ui-Kutu "Hesaplanamadı: $($_.Exception.Message)" 'Otomatik kalibrasyon' 'OK' 'Error') | Out-Null; return }
    $r.Eski = "X $(Sayi ([Eding]::CncGetVariable(5221))) Y $(Sayi ([Eding]::CncGetVariable(5222))) A $(Sayi ([Eding]::CncGetVariable(5224))) B $(Sayi ([Eding]::CncGetVariable(5225))) #4002 $(Sayi $p4002)"
    $r.Z = $z; $r.Kimlik = $id
    $script:OkSonuc = $r
    $iyi = { param($v, $s) if ([math]::Abs($v) -le $s) { '✓' } else { '' } }
    $metin = "X  düzeltme $(Sayi $r.dX) mm  →  G54 X $(Sayi $r.X)  $(& $iyi $r.dX 0.01)`r`n" +
         "Y  düzeltme $(Sayi $r.dY) mm  →  G54 Y $(Sayi $r.Y)  $(& $iyi $r.dY 0.01)`r`n" +
         "Z  düzeltme $(Sayi (-$r.dZ)) mm  →  #4002 $(Sayi $r.P4002)  $(& $iyi $r.dZ 0.01)`r`n" +
         "A  düzeltme $(Sayi (-$r.dA))°  →  G54 A $(Sayi $r.A)  $(& $iyi $r.dA 0.02)`r`n" +
         "B  düzeltme $(Sayi (-$r.dB))°  →  G54 B $(Sayi $r.B)  $(& $iyi $r.dB 0.02)`r`n`r`n" +
         "Ölçüm kalitesi: tekrar $(Sayi $r.Tekrar) mm · çift ölçüm farkı ≤ $(Sayi $r.Fark) mm`r`n" +
         "Model uyumu: ortalama $(Sayi $r.Rms) · en büyük $(Sayi $r.ArtikMax) mm`r`n" +
         "Açı ölçeği: A %$('{0:0.0}' -f (100 * $r.OlcA)) · B %$('{0:0.0}' -f (100 * $r.OlcB))  (100 olmalı)`r`n" +
         "Disk: ortası B ekseninden $(Sayi $r.M) mm · iki yüz arası açı $(Sayi $r.Kama)° · takma eğikliği $(Sayi $r.DiskEgikA)°"
    $uyari = @()
    if ($r.Tekrar -gt 0.01 -or $r.Fark -gt 0.01) { $uyari += 'Temas tekrarlanabilirliği zayıf (>0.01 mm): temas noktalarını alkolle sil, kablo / şase bağlantısını sıkılaştır.' }
    if ([math]::Abs($r.OlcA - 1) -gt 0.01 -or [math]::Abs($r.OlcB - 1) -gt 0.01) { $uyari += 'A/B açı ölçeği %1''den fazla sapıyor: cnc.ini adım/derece ayarı ya da kayış/dişli boşluğu. G54 ile düzelmez.' }
    if ([math]::Abs($r.M) -gt 0.1) { $uyari += 'Disk ortası B ekseninden kaçık: kalınlık doğru mu, disk tutucuya tam oturmuş mu?' }
    if ([math]::Abs($r.Kama) -gt 0.1 -or [math]::Abs($r.DiskEgikA) -gt 0.05) { $uyari += 'Disk yüzleri paralel değil ya da disk eğik oturmuş (bant buruşuk?). B çevirmesi 180° değilse de burada görünür.' }
    if ($r.ArtikMax -gt 0.01) { $uyari += 'Ölçümler makine modeline tam uymuyor (>0.01 mm): bir noktada kir / çapak ya da eksen boşluğu olabilir.' }
    $buyuk = ([math]::Abs($r.dX) -gt 2 -or [math]::Abs($r.dY) -gt 2 -or [math]::Abs($r.dZ) -gt 2 -or [math]::Abs($r.dA) -gt 3 -or [math]::Abs($r.dB) -gt 3 -or
              [math]::Abs($r.OlcA - 1) -gt 0.1 -or [math]::Abs($r.OlcB - 1) -gt 0.1 -or $r.Tekrar -gt 0.05 -or $r.ArtikMax -gt 0.05)
    if ($buyuk) { $uyari += 'DİKKAT: sonuç beklenenden çok büyük ya da ölçüm güvenilmez. Kurulumu kontrol et, ölçümü tekrarla.' }
    $r.Buyuk = $buyuk
    if ($uyari.Count) { $metin += "`r`n`r`n" + ($uyari -join "`r`n") }
    $lblOkSonuc.Text = $metin
    $lblOkSonuc.ForeColor = if ($buyuk) { $cKirmizi } elseif ($uyari.Count) { $cAltinAc } else { $cYazi }
    $btnOkUygula.Enabled = $true
    $lblOkDurum.Text = 'Sonuç hazır. Uygunsa UYGULA VE KAYDET.'
    [Kayit]::Yaz("OTO KALİBRASYON sonuç (kimlik $id): dX $(Sayi $r.dX) dY $(Sayi $r.dY) dZ $(Sayi $r.dZ) dA $(Sayi $r.dA) dB $(Sayi $r.dB) ölçek A $(Sayi $r.OlcA) B $(Sayi $r.OlcB) tekrar $(Sayi $r.Tekrar) z: " + ((0..($OkNoktalar.Count - 1) | ForEach-Object { Sayi $z[$_] }) -join ' '))
}

function OtoKal-Uygula {
    $r = $script:OkSonuc
    if (-not $r) { (Ui-Kutu 'Önce SONUÇLARI OKU.' 'Otomatik kalibrasyon' 'OK' 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Otomatik kalibrasyon')) { return }
    $m = "Yeni kalibrasyon kaydedilecek:`r`n`r`nG54  X $(Sayi $r.X)   Y $(Sayi $r.Y)   A $(Sayi $r.A)   B $(Sayi $r.B)`r`n#4002 (Z sıfırı) $(Sayi $r.P4002)`r`n`r`nEski: $($r.Eski)`r`n`r`n" +
         "G92 kaydırmaları sıfırlanır (frez boyu yeniden ölçülmeli). Önce otomatik yedek alınır. Devam?"
    if (-not (Onay $m 'Otomatik kalibrasyon')) { return }
    if ($r.Buyuk -and -not (Onay "Sonuç beklenenden büyük ya da ölçüm güvenilmez görünüyor.`r`nYine de kaydedilsin mi? (Yanlışsa: KALİBRASYON > Yedekten yükle)" 'Otomatik kalibrasyon')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) { $ok = Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $r.X) Y$(Sayi $r.Y) A$(Sayi $r.A) B$(Sayi $r.B)")); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Degisken-Yaz 4002 $r.P4002 }
    if ($ok) { [void](Degisken-Yaz 4100 0) }
    try {
        if (-not [System.IO.File]::Exists($OkGecmis)) {
            [System.IO.File]::WriteAllText($OkGecmis, "tarih;kimlik;disk;dX;dY;dZ;dA;dB;olcekA;olcekB;tekrar;fark;m;kama;eski;yeni_X;yeni_Y;yeni_A;yeni_B;yeni_4002;uygulandi;z0..z17`r`n", [System.Text.Encoding]::UTF8)
        }
        $satir = (@((Get-Date -Format 'yyyy-MM-dd HH:mm'), $r.Kimlik, (Sayi $r.T), (Sayi $r.dX), (Sayi $r.dY), (Sayi (-$r.dZ)), (Sayi (-$r.dA)), (Sayi (-$r.dB)),
                   (Sayi $r.OlcA), (Sayi $r.OlcB), (Sayi $r.Tekrar), (Sayi $r.Fark), (Sayi $r.M), (Sayi $r.Kama), $r.Eski,
                   (Sayi $r.X), (Sayi $r.Y), (Sayi $r.A), (Sayi $r.B), (Sayi $r.P4002), $(if ($ok) { 'evet' } else { 'HATA' })) +
                  @(0..($OkNoktalar.Count - 1) | ForEach-Object { Sayi $r.Z[$_] })) -join ';'
        [System.IO.File]::AppendAllText($OkGecmis, $satir + "`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    OtoKal-Goster
    try { Ayar-Oku } catch { }
    if ($ok) {
        Yaz "Otomatik kalibrasyon kaydedildi: G54 X $(Sayi $r.X) Y $(Sayi $r.Y) A $(Sayi $r.A) B $(Sayi $r.B), #4002 $(Sayi $r.P4002)"
        $script:OkSonuc = $null; $btnOkUygula.Enabled = $false
        $lblOkDurum.Text = 'Kaydedildi. Doğrulamak için ölçümü bir kez daha çalıştır: düzeltmeler ~0 çıkmalı.'
        (Ui-Kutu "Kaydedildi (geçmiş: oto_kalibrasyon_gecmisi.csv).`r`n`r`n1. Doğrulama: ölçümü bir kez daha çalıştır; bütün satırlarda ✓ görmelisin`r`n2. Disk kablosunu sök, izolasyon bandını çıkar`r`n3. İlk işten önce frez boyu ölçülür (frez değişiminde otomatik)" 'Otomatik kalibrasyon' 'OK' 'Information') | Out-Null
    } else {
        (Ui-Kutu 'Kaydetme yarıda kaldı. KALİBRASYON > Yedekten yükle ile geri dönebilirsin.' 'Otomatik kalibrasyon' 'OK' 'Warning') | Out-Null
    }
}
