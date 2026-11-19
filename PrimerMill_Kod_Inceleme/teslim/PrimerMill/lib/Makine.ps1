# Makine.ps1 - iş akışı (dosya seç, kontrol, BAŞLAT/DEVAM/DURAKLAT/DURDUR, kaldığı yerden devam, yeni blok), takım değişimi
# (otomatik / manuel, takım bildirimi, belirsiz takım), HOME, açılış hazırlığı, ACİL STOP, RESET, pens, MDI, temizlik/park,
# jog ve hazır konumlar, iş mili/hava, G54/#4000-#4006 okuma/yazma, yedek alma/yükleme, yuva/sensör kayıtları, ilerleme takibi.
# Fonksiyonlar düzeltilmiş eski panelden taşındı; arayüze yalnız kapı fonksiyonlarıyla (Ui-*, Yaz) ulaşılır.
# Değişen fonksiyonlar ve gerekçeleri: tests/TASIMA_DEGISEN.txt. PowerShell 5.1 (32 bit) uyumlu.

# ---------------- Yardımcılar ----------------
$script:SeciliDosya = $null
$script:Analiz      = $null
$script:Engel       = $true
$script:Uyarilar    = @()
$script:IsAktif     = $false      # bu panelden başlatılan iş sürüyor mu
$script:Gecen       = [TimeSpan]::Zero
$script:SonTik      = $null

function Dosyayi-Kontrol-Et([string]$yol) {
    Yaz "Kontrol ediliyor ve süre hesaplanıyor, lütfen bekle..."
    $a = [NcAnaliz]::Oku($yol, 4000.0)
    $script:Analiz = $a

    $hatalar  = New-Object System.Collections.ArrayList
    $uyarilar = New-Object System.Collections.ArrayList
    foreach ($h in $a.Hatalar) { [void]$hatalar.Add($h) }
    if ($a.Satir -lt 10) { [void]$hatalar.Add('Dosya boş ya da çok kısa.') }
    if (-not $a.M30)     { [void]$hatalar.Add('Dosyanın sonunda M30 yok; dosya yarım kaydedilmiş olabilir.') }

    $kullanilan = @($a.Takimlar | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
    Yaz ("Satır: {0:N0}   |   Frezeler: {1}   |   Tahmini süre: {2}" -f $a.Satir, (($kullanilan | ForEach-Object { "T$_" }) -join ', '), (Sure $a.Toplam))
    foreach ($tk in $kullanilan) {
        if ($tk -gt 6) { [void]$hatalar.Add("T$tk kullanılıyor ama makinede sadece T1-T6 var.") }
        elseif ($AyarliTakimlar -notcontains $tk) { [void]$uyarilar.Add("T$tk konumu HENÜZ AYARLANMADI. Alırken kırılabilir.") }
    }
    $makro = Makro-AltProgramlari
    if ($makro.Count -eq 0) { [void]$uyarilar.Add("$($script:MakroDurum). Alt program kontrolü yapılamadı.") }
    else { foreach ($s in $a.AltProgramlar) { if (-not $makro.ContainsKey($s)) { [void]$hatalar.Add("Dosya '$s' alt programını çağırıyor ama macro.cnc'de yok.") } } }

    foreach ($h in ($hatalar | Select-Object -First 20)) { Yaz "  ✖  HATA: $h" }
    foreach ($w in $uyarilar) { Yaz "  !  UYARI: $w" }
    if ($hatalar.Count -eq 0 -and $uyarilar.Count -eq 0) { Yaz 'Dosyada sorun bulunmadı.' }

    $script:Engel    = ($hatalar.Count -gt 0)
    $script:SonHatalar = @($hatalar | Select-Object -First 5)
    $script:Uyarilar = @($uyarilar)
    $bar.Value = 0
    $bar.Caption = ''
    $bar.Dancing = $false
    $bar.Animal = if ($script:Tercih.Dansci -eq '1') { Get-Random -Minimum 0 -Maximum ([Hayvanlar]::Adlar.Length) } else { -1 }
    $sim.SetData($a)
    $simBuyuk.SetData($a)
    if ($bar.Animal -ge 0) { Yaz "Bu işin dansçısı: $([Hayvanlar]::Adlar[$bar.Animal])" }
    Dosya-Ozeti
}

function Hazir-Mi([string]$islem) {
    if ([Eding]::AcilKilit) { (Ui-Kutu "ACİL STOP basılı.`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas." $islem 'OK' 'Warning') | Out-Null; return $false }
    if (-not (Baglan)) {
        (Ui-Kutu "Eding CNC'ye bağlanılamadı. Önce Eding CNC programını aç." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    if (Is-Suruyor-Uyari $islem) { return $false }
    if ([Eding]::CncGetEMStopActive() -ne 0) {
        # EXTERR / acil stop sinyali: makineden gelir (hava basıncı düşük, iş mili sürücüsü hatası, acil stop butonu)
        if (-not (Onay "Makine hata sinyali veriyor (EXTERR / acil stop).`r`n`r`nEn sık sebep: hava basıncı düşük (kompresör kapalı ya da basınç yetersiz).`r`nDiğerleri: iş mili sürücüsü hatası, acil stop butonu basılı.`r`n`r`nKompresörü ve basıncı kontrol ettiysen RESET yapılsın mı?" $islem)) { return $false }
        Yaz "$islem : RESET: $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 1200
        if ([Eding]::CncGetEMStopActive() -ne 0) {
            (Ui-Kutu "RESET sonrası hata sinyali hâlâ var.`r`nKompresör basıncını, makinedeki acil stop butonunu ve iş mili sürücüsünü kontrol et." $islem 'OK' 'Warning') | Out-Null
            return $false
        }
    }
    if ([Eding]::CncGetAllAxesHomed() -eq 0) {
        (Ui-Kutu "Makine home alınmamış. Önce HOME butonuna bas." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    if (-not (Calisiyor-Mu)) { Hata-Temizle $islem }
    return $true
}

# ---------------- Butonlar ----------------
function Btn-DosyaSec {
    if ((Is-Suruyor)) { (Ui-Kutu 'Kazıma sürerken yeni dosya seçilemez.' 'Dosya Seç' 'OK' 'Warning') | Out-Null; return }
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = 'NC dosyaları (*.nc)|*.nc|Tüm dosyalar (*.*)|*.*'
    $dlg.Title  = 'Kazınacak .nc dosyasını seç'
    $script:ModalSayac++; try { $sonuc = $dlg.ShowDialog($form) } finally { $script:ModalSayac-- }
    [Kayit]::Yaz("DOSYA SEÇİMİ: $sonuc  $($dlg.FileName)")
    if ($sonuc -ne 'OK') { return }

    $form.Cursor = 'WaitCursor'
    try {
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $ad    = [System.IO.Path]::GetFileName($dlg.FileName)
        $hedef = [System.IO.Path]::Combine($IsKlasor, $ad)
        if ($dlg.FileName -ne $hedef) { [System.IO.File]::Copy($dlg.FileName, $hedef, $true) }
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        $script:SeciliDosya = $hedef
        $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($ad)
        $lblDosya.ForeColor = $cYazi
        Yaz "Kaydedildi: $hedef"
        Dosyayi-Kontrol-Et $hedef
    } catch {
        Yaz "HATA: $($_.Exception.Message)"
        (Ui-Kutu "Hata: $($_.Exception.Message)" 'Dosya Seç' 'OK' 'Error') | Out-Null
    } finally { $form.Cursor = 'Default' }
}

function Dosya-Ozeti {
    # Dosya seçildikten sonra ana ekrandaki sade özet
    if (-not $script:Analiz) { $lblSure.Text = ''; return }
    if ($script:Engel) { $lblSure.Text = 'Dosya uygun değil  ·  ayrıntı için Detaylar'; $lblSure.ForeColor = $cKirmizi; return }
    $lblSure.ForeColor = $cSoluk
    $ek = if ($script:Uyarilar.Count -gt 0) { '   ·   dikkat gerektiriyor' } else { '' }
    $lblSure.Text = "Tahmini süre  $(Sade-Sure $script:Analiz.Toplam)$ek"
}

# ================= MANUEL FREZ DEĞİŞİMİ =================
# #4030 = 1 iken macro frezi magazinden almaz: iş mili değişim noktasına gelir, M0 ile bekler,
# panel operatöre ne yapacağını söyler, onayla devam ettirir (önce pens açılır, sonra kapanır, sonra ölçülür).
$script:ManuelSonSeq = ''
$script:ManuelStabil = 0
$script:ManuelSonPos = $null
$script:ManuelDiyalogAcik = $false

function Frez-Manuel-Mi { try { return ([Eding]::CncGetVariable(4030) -eq 1) } catch { return $false } }

# MC-06: manuelden otomatiğe geçişte iş milindeki takım 0..6 olmalı (magazinde T1-T6 var; T7+ ile M6 yuvaya çarpar)
function Otomatik-Gecis-Uygun-Mu {
    $tk = 0; try { if ($script:ApiHazir -and $script:Bagli) { $tk = [int][Eding]::CncGetCurrentToolNumber() } } catch { $tk = -1 }
    if ($tk -ge 0 -and $tk -le 6) { return $true }
    [Kayit]::Yaz("FREZ MODU: otomatiğe geçiş reddedildi, iş milinde T$tk")
    (Ui-Kutu "Eding'e göre iş milinde T$tk var; magazinde yalnız T1–T6 yuvası var.`r`nBu haliyle OTOMATİK frez değişimi yuvaya çarpabilir.`r`n`r`nÖnce frezi elle çıkar (PENS AÇ → takım T0), sonra OTOMATİK'e geç." 'Frez modu' 'OK' 'Warning') | Out-Null
    return $false
}
function Frez-Modu-Yaz([bool]$manuel) {
    if (Is-Suruyor-Uyari 'Frez modu') { return $false }
    if (-not $manuel -and -not (Otomatik-Gecis-Uygun-Mu)) { Frez-Modu-Goster; return $false }
    $v = if ($manuel) { 1 } else { 0 }
    $ok = Degisken-Yaz 4030 $v
    if ($ok) { Yaz "Frez değişimi: $(if ($manuel) { 'MANUEL (elle)' } else { 'OTOMATİK (magazin)' })" }
    Frez-Modu-Goster
    return $ok
}

function Frez-Modu-Sor {
    # BAŞLAT'ta: manuel mi otomatik mi? Seçilen döner ('MANUEL' / 'OTOMATIK') ya da $null (vazgeç)
    $simdi = Frez-Manuel-Mi
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Frez değişimi'; $f.StartPosition = 'CenterParent'; $f.FormBorderStyle = 'FixedDialog'
    $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.BackColor = $cZemin; $f.ClientSize = New-Object System.Drawing.Size(560, 250)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = "Bu işte frezeler nasıl değişsin?`r`nŞu anki ayar: $(if ($simdi) { 'MANUEL' } else { 'OTOMATİK' })"
    $l.ForeColor = $cYazi; $l.Font = New-Object System.Drawing.Font('Segoe UI', 13); $l.SetBounds(24, 18, 512, 60)
    $f.Controls.Add($l)
    $mk = {
        param($t, $alt, $x, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button
        $b.Text = "$t`r`n$alt"; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
        $b.FlatAppearance.BorderColor = $renk; $b.FlatAppearance.BorderSize = 2
        $b.SetBounds($x, 92, 246, 100)
        $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; [Kayit]::Yaz("TUŞ: Frez modu -> $($s2.Tag)"); $fm.Close() })
        $f.Controls.Add($b); return $b
    }
    $bo = & $mk 'OTOMATİK' '(magazinden alır / bırakır)' 24 $cAltinAc 'OTOMATIK'
    $bm = & $mk 'MANUEL' '(frezeleri ben takarım)' 290 $cYesil 'MANUEL'
    $iptal = New-Object System.Windows.Forms.Button
    $iptal.Text = 'Vazgeç'; $iptal.FlatStyle = 'Flat'; $iptal.ForeColor = $cSoluk; $iptal.BackColor = $cZemin
    $iptal.SetBounds(440, 204, 96, 30); $iptal.Add_Click({ param($s2, $e2) $s2.FindForm().Close() })
    $f.Controls.Add($iptal)
    $f.AcceptButton = if ($simdi) { $bm } else { $bo }
    $f.Add_Shown({ param($s2, $e2) $s2.Activate(); $s2.AcceptButton.Focus() })
    [void]$f.ShowDialog($form)
    if ($f.Tag) { return [string]$f.Tag } else { return $null }
}

# Manuel mod sadece yeni macro.cnc Eding'e YÜKLÜYSE çalışır. Eski macro yüklüyse makine frezi magazinden almaya kalkar.
function Manuel-Macro-Kontrol {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    $metin = ''
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $metin = $sr.ReadToEnd(); $sr.Close()
    } catch { }
    if ($metin -notmatch '(?im)^\s*sub\s+manual_change\b' -or $metin -notmatch '(?im)^\s*sub\s+pm_surum\b') {
        [Kayit]::Yaz("MANUEL: $yol manuel değişimi desteklemiyor (eski macro)")
        (Ui-Kutu "Manuel frez değişimi için yeni macro.cnc gerekli, ama şu dosya eski:`r`n$yol`r`n`r`n1. Eding'i kapat`r`n2. Paketteki macro.cnc'yi bu klasöre kopyala (eskisini yedekle)`r`n3. Paneli yeniden aç`r`n`r`nİş başlatılmadı." 'Manuel frez' 'OK' 'Warning') | Out-Null
        return $false
    }
    # Dosya yeni; Eding de yeni macro'yu mu kullanıyor? (macro Eding açılırken okunur). K6: sürüm tam olarak beklenen olmalı.
    $surum = Makro-Surum-Oku
    $yuklu = ($surum -eq $BeklenenMakroSurum)
    if (-not $yuklu) {
        [Kayit]::Yaz("MANUEL: Eding'deki makro sürümü $surum, beklenen $BeklenenMakroSurum")
        Hata-Temizle 'Manuel kontrol'
        if (Onay "Eding'de yüklü makro sürümü $surum, panelin beklediği $BeklenenMakroSurum (Eding macro'yu sadece açılırken okur).`r`nBu haliyle makine frezi magazinden almaya çalışabilir.`r`n`r`nEding şimdi yeniden başlatılsın mı? (Sonra home alır; işi yeniden BAŞLAT ile başlatırsın.)" 'Manuel frez') { Eding-Yeniden }
        return $false
    }
    return $true
}

function Takim-Bildir([int]$n, [string]$islem) {
    # Eding'e iş milindeki frezi HAREKETSİZ bildirir: #4039 = 1 (orijinal makroda #4900) -> M6 Tn -> #4039 = 0.
    # Her adım denetlenir; bir şey ters giderse $false (çağıran durmalı).
    $bayrak = if ($script:OzelMakro) { 4039 } else { 4900 }
    if ($script:OzelMakro) {
        $s = Makro-Surum-Oku
        if ($s -ne $BeklenenMakroSurum) {
            (Ui-Kutu "Eding'de yüklü macro.cnc sürümü $(if ($s -lt 0) { 'okunamadı' } else { $s }), beklenen $BeklenenMakroSurum.`r`nBu haliyle M6 T$n gerçek takım değişimi yapabilir; frez Eding'e bildirilmedi.`r`n`r`nEding'i yeniden başlat (Ayarlar › PANEL), sonra tekrar dene. $islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
            return $false
        }
    } else {
        $yamali = $false
        try { $yamali = ([System.IO.File]::ReadAllText([System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')) -match '(?im)^\s*sub\s+pm_pens_t0\b') } catch { }
        if (-not $yamali -or $script:MakroYamaBekliyor) {
            (Ui-Kutu "Orijinal macro.cnc'nin hareketsiz takım bildirimi eki Eding'e yüklü değil (Eding yeniden başlatılmalı).`r`nBu haliyle M6 T$n gerçek takım değişimi yapar. $islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
            return $false
        }
    }
    Yaz "$islem : Eding'e iş milindeki frez T$n bildiriliyor (hareket yok)."
    $hata = ''
    $rc = [Eding]::CncRunSingleLine("#$bayrak=1")
    if (-not (Rc-Tamam $rc)) { $hata = "#$bayrak=1 gönderilemedi ($([Eding]::RCText($rc)))" }
    elseif (-not (Hareket-Bitene-Kadar-Bekle 5)) { $hata = "#$bayrak=1 sonrası Eding hazır olmadı" }
    elseif ([Eding]::CncGetVariable($bayrak) -ne 1) { $hata = "#$bayrak geri okunduğunda 1 değil ($([Eding]::CncGetVariable($bayrak)))" }
    if ($hata) {
        [void](Bayrak-Sifirla $islem)
        [Kayit]::Yaz("TAKIM BİLDİR: $hata")
        (Ui-Kutu "Frez Eding'e bildirilemedi: $hata.`r`nM6 gönderilmedi. $islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    $rc = [Eding]::CncRunSingleLine("M6 T$n")
    $bitti = $false
    if (Rc-Tamam $rc) { $bitti = Hareket-Bitene-Kadar-Bekle 20 } else { $hata = "M6 T$n gönderilemedi ($([Eding]::RCText($rc)))" }
    $sifir = Bayrak-Sifirla $islem
    $tk = -1; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    if (-not $hata -and -not $bitti) { $hata = "M6 T$n bitmedi ya da Eding hata verdi" }
    if (-not $hata -and $tk -ne $n) { $hata = "Eding'deki takım T$tk (beklenen T$n)" }
    if (-not $hata -and -not $sifir) { $hata = "#$bayrak tekrar 0 yapılamadı" }
    if ($hata) {
        [Kayit]::Yaz("TAKIM BİLDİR: $hata")
        (Ui-Kutu "Frez Eding'e bildirilemedi: $hata.`r`nEding eski macro ile açık olabilir: Eding'i yeniden başlat. $islem yapılmadı." $islem 'OK' 'Warning') | Out-Null
        return $false
    }
    [Kayit]::Yaz("TAKIM BİLDİR: Eding'deki takım T$n")
    return $true
}

# ================= TAKIM DURUMU BELİRSİZ (GV-08) =================
# ACİL STOP / DURDUR / RESET takım değişimi sırasında gelirse Eding'in bildiği takım iş milindekinden farklı olabilir.
# Operatör iş milindeki frezi söyleyene (hareketsiz bildirim) kadar BAŞLAT ve M6 engellenir. Panel kapanıp açılsa da sürer.
$script:TakimKomutuAni = [datetime]::MinValue   # panelden M6 / takım makrosu gönderildiği an (bitince sıfırlanır)
function Takim-Komutu-Mu([string]$l) { return ($l -match '(?i)\bM0*6\b|gosub\s+(pm_|user_1|is_empty_tool|change_tool|manual_change|droptool|picktool)') }
function Takim-Degisimi-Suruyor-Mu {
    # Kesmeden ÖNCE çağrılır: takım değişimi sürüyor olabilir mi?
    if (-not $script:ApiHazir -or -not $script:Bagli) { return [bool]$script:IsAktif }
    try {
        $d = Eding-Durum
        if ($d -eq 'RUN-SUB') { return $true }
        if ([Eding]::CncGetVariable(4034) -ne 0) { return $true }
        if ($script:TakimKomutuAni -ne [datetime]::MinValue -and ((Get-Date) - $script:TakimKomutuAni).TotalSeconds -lt 300 -and ((Mesgul $d) -or $d -like 'PAUSE*')) { return $true }
    } catch { return $true }
    return $false
}
function Takim-Belirsiz-Isaretle([string]$neden) {
    if (-not $script:TakimBelirsiz) { [Kayit]::Yaz("TAKIM BELİRSİZ: $neden sırasında takım değişimi sürüyor olabilirdi") }
    $script:TakimBelirsiz = $true
    $script:Tercih.TakimBelirsiz = '1'; try { Tercih-Yaz } catch { }
    try { Yaz "DİKKAT: takım değişimi yarıda kesilmiş olabilir ($neden). BAŞLAT ya da frez değişiminden önce iş milindeki frez sorulacak." } catch { }
}
function Takim-Belirsiz-Coz([string]$islem) {
    # $true: belirsizlik yok / giderildi. $false: çağıran durmalı.
    if (-not $script:TakimBelirsiz) { return $true }
    $tkE = -1; try { $tkE = [Eding]::CncGetCurrentToolNumber() } catch { }
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Takım durumu belirsiz'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.TopMost = $true
    $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ShowInTaskbar = $false
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    $f.ClientSize = New-Object System.Drawing.Size(640, 300)
    $lb = New-Object System.Windows.Forms.Label
    $lb.Text = 'İş milinde hangi frez var?'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 592, 34); $f.Controls.Add($lb)
    $lm = New-Object System.Windows.Forms.Label
    $lm.Text = "Son ACİL STOP / DURDUR / RESET bir takım değişimi sırasında gelmiş olabilir.`r`nEding'e göre iş milinde: T$tkE.`r`n`r`nKapağı açıp iş milini GÖZÜNLE kontrol et ve takılı olanı seç (makine hareket etmez)."
    $lm.SetBounds(24, 54, 592, 100); $f.Controls.Add($lm)
    $f.Tag = $null
    for ($n = 0; $n -le 6; $n++) {
        $b = New-Object System.Windows.Forms.Button
        $b.Text = $(if ($n -eq 0) { "Boş`r`n(T0)" } else { "T$n" }); $b.Tag = $n
        $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $cYazi; $b.FlatAppearance.BorderColor = $cAltin
        $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12); $b.SetBounds(24 + $n * 85, 166, 78, 64)
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b)
    }
    $bv = New-Object System.Windows.Forms.Button
    $bv.Text = 'Vazgeç'; $bv.FlatStyle = 'Flat'; $bv.BackColor = $cZemin; $bv.ForeColor = $cSoluk; $bv.SetBounds(496, 246, 120, 36)
    $bv.Add_Click({ param($s2, $e2) $s2.FindForm().Close() }); $f.Controls.Add($bv)
    $f.AcceptButton = $bv; $f.KeyPreview = $true
    $f.Add_KeyDown({ param($s2, $e2) if ($e2.KeyCode -eq 'Escape') { $e2.Handled = $true; $s2.Tag = $null; $s2.Close(); Acil-Stop 'Esc (takım belirsiz)' } })
    [void]$f.ShowDialog($form)
    $sec = $f.Tag; $f.Dispose()
    [Kayit]::Yaz("TAKIM BELİRSİZ: operatör seçimi '$sec' (Eding T$tkE)")
    if ($null -eq $sec) { Yaz "$islem yapılmadı: iş milindeki frez bildirilmedi."; return $false }
    $n = [int]$sec
    if ($n -ne $tkE) {
        if (-not (Hazir-Mi $islem)) { return $false }
        if (-not (Takim-Bildir $n $islem)) { return $false }
    }
    $script:TakimBelirsiz = $false; $script:Tercih.TakimBelirsiz = '0'; Tercih-Yaz
    Yaz "Takım durumu netleşti: iş milinde T$n."
    return $true
}
function Takim-Kapisi([string]$islem) {
    # BAŞLAT ve panelden M6 / takım ölçme öncesi ortak kontrol
    if (-not (Raf-Hazir-Mi $islem)) { return $false }        # K5
    if (-not (Takim-Belirsiz-Coz $islem)) { return $false }  # GV-08
    return $true
}

function Manuel-Istek {
    # Bekleyen operatör isteği: @{ Faz = 1 (pens açılacak) | 2 (tak, pens kapanacak) | 3 (hava bekleniyor); T; Eski; Seq } ya da $null
    # #4034 iş başlarken ve RESET'te sıfırlanır, bu yüzden 1000+ değer hep o anki işe aittir.
    $faz = [int][Eding]::CncGetVariable(4034)
    if ($faz -lt 1000) { return $null }
    return @{ Faz = [int][math]::Floor($faz / 1000); T = $faz % 1000; Eski = [int][Eding]::CncGetVariable(4036); Seq = [Eding]::CncGetVariable(4037) }
}

# Değişken okunamazsa / panel isteği kaçırırsa: Eding duraklamış + manuel mod + iş mili değişim noktasında ise
# istenen frezi Eding'in kendi takım değişkenlerinden çıkar (#5011 yeni, #5008 eski; pens çıkışı açıksa 2. adım)
function Manuel-Istek-Tahmin {
    if (-not (Frez-Manuel-Mi)) { return $null }
    $p = [Eding]::MachinePos()
    $dx = [Eding]::CncGetVariable(4031); $dy = [Eding]::CncGetVariable(4032)
    if ([math]::Abs($p.X - $dx) -gt 0.05 -or [math]::Abs($p.Y - $dy) -gt 0.05) { return $null }
    $pensAcik = $false; try { $pensAcik = ([Eding]::CncGetOutput(9) -ne 0) } catch { }
    return @{ Faz = $(if ($pensAcik) { 2 } else { 1 }); T = [int][Eding]::CncGetVariable(5011); Eski = [int][Eding]::CncGetVariable(5008); Seq = -2 }
}

function Manuel-Devam {
    $son = (Get-Date).AddSeconds(8)
    do {
        $rc = [Eding]::CncRunOrResumeJob()
        if (Rc-Tamam $rc) { [Kayit]::Yaz("MANUEL: devam -> $([Eding]::RCText($rc))"); return $true }
        Ui-Olaylar; Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $son)
    [void](Komut-Sonucu 'Manuel frez: devam' $rc)
    return $false
}

function Manuel-Diyalog($ist) {
    $script:ManuelDiyalogAcik = $true
    try {
        $eski = $ist.Eski; $yeni = $ist.T
        if ($ist.Faz -eq 4) {
            $baslik = "T$yeni HAZIR  ·  SON ONAY"
            $metin = "T$yeni takıldı ve sensörde ölçüldü.`r`n`r`n1.  Elini makineden çek, kapağı kapat.`r`n2.  KAZIMAYI BAŞLAT'a bas."
            $tamam = 'KAZIMAYI BAŞLAT'
        } elseif ($ist.Faz -eq 1) {
            $baslik = "FREZ DEĞİŞİMİ   T$eski  →  T$yeni"
            $metin = if ($eski -gt 0) { "1.  İş milindeki T$eski frezini parmaklarınla tut.`r`n2.  PENS'İ AÇ'a bas: pens havayla açılır, frezi çıkar.`r`n`r`nSonra takılacak frez:  T$yeni" } else { "1.  T$yeni frezini eline al.`r`n2.  PENS'İ AÇ'a bas: pens havayla açılır.`r`n`r`nKompresör açık olmalı." }
            $tamam = "PENS'İ AÇ"
        } else {
            $baslik = if ($yeni -gt 0) { "T$yeni FREZİNİ TAK" } else { "FREZİ ÇIKAR" }
            $metin = if ($yeni -gt 0) { "1.  Eski frezi çıkar (varsa).`r`n2.  T$yeni frezini sonuna kadar it ve tut.`r`n3.  TAKTIM'a bas: pens kapanır, makine frezi sensörde ölçer ve kazımaya devam eder." } else { "1.  Frezi çıkar.`r`n2.  ÇIKARDIM'a bas: pens kapanır." }
            $tamam = if ($yeni -gt 0) { "TAKTIM  ·  PENS'İ KAPAT" } else { "ÇIKARDIM  ·  PENS'İ KAPAT" }
        }
        [Kayit]::Yaz("MANUEL: istek faz $($ist.Faz)  T$eski -> T$yeni")
        [System.Media.SystemSounds]::Exclamation.Play()
        $f = New-Object System.Windows.Forms.Form
        $f.Text = 'Manuel frez değişimi'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.TopMost = $true
        $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ControlBox = $false
        $f.BackColor = $cZemin; $f.ClientSize = New-Object System.Drawing.Size(640, 340)
        $lb = New-Object System.Windows.Forms.Label
        $lb.Text = $baslik; $lb.ForeColor = $cAltinAc; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 20)
        $lb.SetBounds(24, 16, 592, 44); $f.Controls.Add($lb)
        $lm = New-Object System.Windows.Forms.Label
        $lm.Text = $metin; $lm.ForeColor = $cYazi; $lm.Font = New-Object System.Drawing.Font('Segoe UI', 13)
        $lm.SetBounds(24, 70, 592, 150); $f.Controls.Add($lm)
        $sonuc = @{ V = '' }
        $bt = New-Object System.Windows.Forms.Button
        $bt.Text = $tamam; $bt.FlatStyle = 'Flat'; $bt.BackColor = $cPanel; $bt.ForeColor = $cYesil
        $bt.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 14); $bt.FlatAppearance.BorderColor = $cYesil; $bt.FlatAppearance.BorderSize = 2
        $bt.SetBounds(24, 236, 392, 80); $bt.Add_Click({ $sonuc.V = 'tamam'; $f.Close() }.GetNewClosure()); $f.Controls.Add($bt)
        $bd = New-Object System.Windows.Forms.Button
        $bd.Text = if ($ist.Faz -eq 2) { "İşi durdur`r`n(pens AÇIK kalır)" } else { 'İşi durdur' }
        $bd.FlatStyle = 'Flat'; $bd.BackColor = $cZemin; $bd.ForeColor = $cKirmizi; $bd.FlatAppearance.BorderColor = $cKirmizi
        $bd.SetBounds(432, 236, 184, 80); $bd.Add_Click({ $sonuc.V = 'durdur'; $f.Close() }.GetNewClosure()); $f.Controls.Add($bd)
        $f.KeyPreview = $true
        $f.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Escape') { $e.Handled = $true; $sonuc.V = 'acil'; $f.Close() } }.GetNewClosure())
        $f.Add_Shown({ $f.Activate() })
        [void]$f.ShowDialog($form)
        [Kayit]::Yaz("MANUEL: operatör -> $($sonuc.V)")
        if ($sonuc.V -eq 'acil') { Acil-Stop 'Esc (manuel frez)'; return }
        if ($sonuc.V -eq 'durdur') {
            if (Onay 'İş durdurulsun mu?' 'Manuel frez') { Btn-Durdur; return }
            $script:ManuelSonSeq = ''; return   # tekrar sorulsun
        }
        if ($sonuc.V -eq 'tamam') { [void](Manuel-Devam) }
    } finally { $script:ManuelDiyalogAcik = $false; $script:ManuelSusTo = (Get-Date).AddSeconds(4); $script:ManuelStabil = 0 }
}

$script:ManuelSonIz = ''
$script:ManuelSusTo = Get-Date
function Manuel-Izle {
    if ($script:ManuelDiyalogAcik -or -not $script:ApiHazir -or -not $script:Bagli -or [Eding]::AcilKilit) { return }
    if ((Get-Date) -lt $script:ManuelSusTo) { return }   # onaydan hemen sonra pencere tekrar açılmasın
    try {
        $d = Eding-Durum
        $ist = Manuel-Istek
        # Teşhis kaydı: değiştikçe yaz
        $iz = "faz=$([Eding]::CncGetVariable(4034)) seq=$([Eding]::CncGetVariable(4037)) durum=$d mod=$([Eding]::CncGetVariable(4030)) T$([Eding]::CncGetVariable(5008))->T$([Eding]::CncGetVariable(5011))"
        if ($iz -ne $script:ManuelSonIz -and ((Frez-Manuel-Mi) -or $ist)) { [Kayit]::Yaz("MANUEL-İZ: $iz"); $script:ManuelSonIz = $iz }
        $p = [Eding]::MachinePos()
        $ayni = ($script:ManuelSonPos -and [math]::Abs($p.X - $script:ManuelSonPos.X) -lt 0.001 -and [math]::Abs($p.Y - $script:ManuelSonPos.Y) -lt 0.001 -and [math]::Abs($p.Z - $script:ManuelSonPos.Z) -lt 0.001)
        $script:ManuelSonPos = $p
        if ($ayni) { $script:ManuelStabil++ } else { $script:ManuelStabil = 0 }
        $durakli = ($d -like 'PAUSE*') -or ([Eding]::CncGetPauseStatus() -ne 0)
        if ($null -eq $ist) {
            # Yedek yol: macro değişkeni görünmüyorsa ama Eding değişim noktasında bekliyorsa
            if (($durakli -or $script:ManuelStabil -ge 6) -and ((Mesgul $d) -or $durakli)) {
                $t = Manuel-Istek-Tahmin
                if ($t -and $script:ManuelSonSeq -ne "tahmin$($t.Faz)-$($t.T)") {
                    [Kayit]::Yaz("MANUEL: istek değişkenden okunamadı, Eding takım bilgisinden çıkarıldı: faz $($t.Faz) T$($t.Eski)->T$($t.T)")
                    $script:ManuelSonSeq = "tahmin$($t.Faz)-$($t.T)"; $script:ManuelStabil = 0
                    Manuel-Diyalog $t
                }
            }
            return
        }
        if ($ist.Faz -eq 3) { return }   # hava bekleniyor: durum satırında yazılıyor
        if ("$($ist.Seq)" -eq "$script:ManuelSonSeq") { return }
        if ($durakli -or $script:ManuelStabil -ge 4) {
            $script:ManuelSonSeq = "$($ist.Seq)"
            $script:ManuelStabil = 0
            Manuel-Diyalog $ist
        }
    } catch { [Kayit]::Yaz("MANUEL-İZ hata: $($_.Exception.Message)") }
}

# ================= SADE SÜRÜM: YENİ BLOK =================
# Alt satırdaki "Yeni blok" → isim yaz → saat 9 yönüne T2 ile isim + referans çentiği, sonra iş durmadan devam eder.
$script:BekleyenBlok = $null
$script:BlokHazir = $false     # makinede "blok takıldı" onayı (uzaktan BAŞLAT bunu ister, her işte sıfırlanır)
function Yeni-Blok {
    if (Is-Suruyor-Uyari 'Yeni blok') { return }
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Yeni blok'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.TopMost = $true; $f.ShowInTaskbar = $false
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    $f.ClientSize = New-Object System.Drawing.Size(560, 380)
    $lb = New-Object System.Windows.Forms.Label
    $lb.Text = 'Blok takıldı'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 500, 34); $f.Controls.Add($lb)
    $la = New-Object System.Windows.Forms.Label
    $la.Text = 'İsim ve referans çentiği saat 9 yönüne, T2 frezle kazınır.'; $la.ForeColor = $cSoluk; $la.SetBounds(24, 50, 520, 24); $f.Controls.Add($la)
    $e1 = New-Object System.Windows.Forms.Label; $e1.Text = 'Blok ismi'; $e1.ForeColor = $cSoluk; $e1.SetBounds(24, 98, 150, 26); $f.Controls.Add($e1)
    $tAd = New-Object System.Windows.Forms.TextBox; $tAd.BackColor = $cPanel; $tAd.ForeColor = $cYazi; $tAd.BorderStyle = 'FixedSingle'
    $tAd.Font = New-Object System.Drawing.Font('Consolas', 16); $tAd.MaxLength = 10; $tAd.SetBounds(180, 92, 220, 34); $tAd.Text = "$(Blok-Sonraki-No)"; $f.Controls.Add($tAd)
    $e2 = New-Object System.Windows.Forms.Label; $e2.Text = 'Blok kalınlığı (mm)'; $e2.ForeColor = $cSoluk; $e2.SetBounds(24, 146, 150, 26); $f.Controls.Add($e2)
    $tT = New-Object System.Windows.Forms.TextBox; $tT.BackColor = $cPanel; $tT.ForeColor = $cYazi; $tT.BorderStyle = 'FixedSingle'
    $tT.Font = New-Object System.Drawing.Font('Consolas', 16); $tT.SetBounds(180, 140, 100, 34)
    $tT.Text = $(if ($script:Tercih.SadeKalinlik) { $script:Tercih.SadeKalinlik } else { '18' }); $f.Controls.Add($tT)
    $e3 = New-Object System.Windows.Forms.Label; $e3.Text = 'Derinlik (mm)'; $e3.ForeColor = $cSoluk; $e3.SetBounds(300, 146, 110, 26); $f.Controls.Add($e3)
    $tD = New-Object System.Windows.Forms.TextBox; $tD.BackColor = $cPanel; $tD.ForeColor = $cYazi; $tD.BorderStyle = 'FixedSingle'
    $tD.Font = New-Object System.Drawing.Font('Consolas', 16); $tD.SetBounds(414, 140, 100, 34)
    $tD.Text = $(if ($script:Tercih.SadeDerinlik) { $script:Tercih.SadeDerinlik } else { '0.15' }); $f.Controls.Add($tD)
    $f.Tag = $null
    $mk = { param($t, $x, $w, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button; $b.Text = $t; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.FlatAppearance.BorderColor = $renk; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
        $b.SetBounds($x, 200, $w, 76); $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b); $b }
    $isVar = [bool]$script:SeciliDosya
    $bIs = & $mk $(if ($isVar) { "KAZI VE İŞE BAŞLA`r`n$([System.IO.Path]::GetFileName($script:SeciliDosya))" } else { "Önce iş dosyasını seç`r`n(DOSYA SEÇ)" }) 24 250 $cYesil 'is'
    $bIs.Enabled = $isVar
    [void](& $mk "SADECE`r`nİSMİ KAZI" 284 150 $cAltinAc 'tek')
    [void](& $mk 'Vazgeç' 444 92 $cSoluk 'iptal')
    $bH = & $mk "YENİ BLOK HAZIR`r`n(işi bilgisayardan başlatacağım)" 24 250 $cYesil 'hazir'; $bH.Top = 286; $bH.Height = 70
    $bE = & $mk "KULLANILMIŞ BLOK`r`n(isim yok) hazır" 284 252 $cAltinAc 'eski'; $bE.Top = 286; $bE.Height = 70
    if ($script:BekleyenBlok) {
        $bk = & $mk 'Bekleyen bloğu iptal et' 24 160 $cKirmizi 'sil'; $bk.SetBounds(414, 92, 130, 34); $bk.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    }
    $f.Add_Shown({ param($s2, $e2) $s2.Activate(); $tAd.Focus(); $tAd.SelectAll() })
    [void]$f.ShowDialog($form)
    $sec = [string]$f.Tag
    [Kayit]::Yaz("YENİ BLOK: seçim '$sec'  isim '$($tAd.Text)'")
    if ($sec -eq 'sil') { $script:BekleyenBlok = $null; Blok-Cip-Guncelle; Yaz 'Bekleyen blok iptal edildi.'; return }
    if ($sec -eq 'eski') { $script:BekleyenBlok = $null; $script:BlokHazir = $true; Blok-Cip-Guncelle; Yaz 'Kullanılmış blok takıldı: iş uzaktan başlatılabilir.'; return }
    if (@('is', 'tek', 'hazir') -notcontains $sec) { return }
    $metin = Blok-Metin-Temizle $tAd.Text
    $T = Metin-Sayi $tT.Text
    if (-not $metin) { (Ui-Kutu 'Blok ismi boş (rakam, harf, - . / kullanılabilir).' 'Yeni blok' 'OK' 'Warning') | Out-Null; return }
    if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { (Ui-Kutu 'Blok kalınlığını yaz (10–30 mm).' 'Yeni blok' 'OK' 'Warning') | Out-Null; return }
    $D = Metin-Sayi $tD.Text
    if ($null -eq $D -or $D -lt 0.05 -or $D -gt 0.5) { (Ui-Kutu 'Derinlik 0.05–0.5 mm arası olmalı.' 'Yeni blok' 'OK' 'Warning') | Out-Null; return }
    $script:Tercih.SadeKalinlik = $tT.Text; $script:Tercih.SadeDerinlik = $tD.Text; Tercih-Yaz
    $taraf = if ($script:Tercih.SadeTaraf -eq '3') { '3' } else { '9' }
    $b = @{ Metin = $metin; T = $T; Takim = 2; Cap = 1.0; Yuk = 4.0; Konum = $taraf; Cizgi = $true; Derin = $D }
    $script:BlokHazir = $true
    if ($sec -eq 'hazir') { $script:BekleyenBlok = $b; Blok-Cip-Guncelle; Yaz "Yeni blok '$metin' takıldı: iş başlayınca önce ismi kazınacak (uzaktan başlatılabilir)."; return }
    if ($sec -eq 'is') {
        $script:BekleyenBlok = $b; Blok-Cip-Guncelle
        Btn-Baslat
        return
    }
    # Sadece isim: kendi küçük programı, sonunda frezi magazine bırakır (T0)
    if (-not (Hazir-Hareket 'Yeni blok')) { return }
    if (-not (Takim-Kapisi 'Yeni blok')) { return }
    try {
        $L = New-Object System.Collections.Generic.List[string]
        $L.Add('%'); $L.Add('GOSUB CHECK_EMPTY_TOOL')
        foreach ($x in (Blok-Kazima-NC $b.Metin $b.T $b.Takim $b.Yuk $b.Konum $b.Derin $true)) { $L.Add([string]$x) }
        $L.Add('T0 M6'); $L.Add('M30'); $L.Add('%')
        if (-not [System.IO.Directory]::Exists($IsKlasor)) { [void][System.IO.Directory]::CreateDirectory($IsKlasor) }
        $yol = [System.IO.Path]::Combine($IsKlasor, "PM_blok_$($metin -replace '[^A-Za-z0-9\-]', '').nc")
        [System.IO.File]::WriteAllLines($yol, $L)
    } catch { (Ui-Kutu "Program yazılamadı: $($_.Exception.Message)" 'Yeni blok' 'OK' 'Error') | Out-Null; return }
    Hata-Temizle 'Yeni blok'
    if (-not (Makro-Hazir-Mi 'Yeni blok')) { return }
    if (-not (Bayrak-Sifirla 'Yeni blok')) { (Ui-Kutu "Takım bildirim bayrağı (#4039) sıfırlanamadı. Blok ismi kazınmadı." 'Yeni blok' 'OK' 'Warning') | Out-Null; return }
    if (-not (Komut-Sonucu 'Blok ismi yükle' ([Eding]::CncLoadJobA($yol)))) { return }
    if (Komut-Sonucu 'Blok ismi kazı' ([Eding]::CncRunOrResumeJob())) {
        Blok-Kaydet $b '(sadece isim)'; Blok-Cip-Guncelle
        Yaz "Blok '$metin' kazınıyor (T2, saat 9). Bitince frez magazine bırakılır."
    }
}

function Devam-Kaydet([int]$satir, [string]$durum, [double]$yuzde) {
    if (-not $script:DevamKaynak -or $satir -lt 1) { return }
    if ($script:DevamHarita) { $satir = $script:DevamHarita.Orijinal + ($satir - $script:DevamHarita.Bas); if ($satir -lt $script:DevamHarita.Orijinal) { $satir = $script:DevamHarita.Orijinal } }
    $tk = 0; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    $o = [ordered]@{ Dosya = $script:DevamDosya; Kaynak = $script:DevamKaynak; Satir = $satir; Takim = $tk; Yuzde = [math]::Round($yuzde, 1); Zaman = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); Durum = $durum }
    try {
        $gecici = $DevamDosyasi + '.tmp'
        [System.IO.File]::WriteAllText($gecici, (ConvertTo-Json $o -Compress))
        if ([System.IO.File]::Exists($DevamDosyasi)) { [System.IO.File]::Replace($gecici, $DevamDosyasi, $null) } else { [System.IO.File]::Move($gecici, $DevamDosyasi) }
    } catch { }
    $script:DevamSonYazma = Get-Date
}

function Devam-Diyalog($k) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Yarım kalan iş'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.TopMost = $true; $f.ShowInTaskbar = $false
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    $f.ClientSize = New-Object System.Drawing.Size(620, 400)
    $neden = switch ([string]$k.Durum) { 'calisiyor' { 'iş sürerken panel/elektrik kapandı' } 'hata' { 'Eding hatasıyla durdu (basınç / acil stop vb.)' } 'durduruldu' { 'DURDUR ile durduruldu' } default { 'yarıda kaldı' } }
    $lb = New-Object System.Windows.Forms.Label; $lb.Text = 'Yarım kalan iş'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 570, 34); $f.Controls.Add($lb)
    $li = New-Object System.Windows.Forms.Label; $li.ForeColor = $cYazi; $li.SetBounds(24, 54, 570, 72)
    $li.Text = "$([System.IO.Path]::GetFileNameWithoutExtension([string]$k.Dosya))   ·   %$($k.Yuzde) yapılmıştı`r`n$($k.Zaman)  ·  $neden`r`nSatır $($k.Satir)"
    $f.Controls.Add($li)
    $lt = New-Object System.Windows.Forms.Label; $lt.Text = 'İş milinde şu an takılı frez:'; $lt.ForeColor = $cSoluk; $lt.SetBounds(24, 136, 230, 26); $f.Controls.Add($lt)
    $cT = New-Object System.Windows.Forms.ComboBox; $cT.DropDownStyle = 'DropDownList'; $cT.BackColor = $cPanel; $cT.ForeColor = $cYazi; $cT.FlatStyle = 'Flat'
    foreach ($n in 0..6) { [void]$cT.Items.Add($(if ($n -eq 0) { 'Yok (T0)' } else { "T$n" })) }
    $t0 = [int]$k.Takim; if ($t0 -lt 0 -or $t0 -gt 6) { $t0 = 0 }; $cT.SelectedIndex = $t0; $cT.SetBounds(260, 132, 120, 30); $f.Controls.Add($cT)
    $ln = New-Object System.Windows.Forms.Label; $ln.Text = 'Kapağı açıp iş milindeki frezi kontrol et; listeden doğrusunu seç.'; $ln.ForeColor = $cSoluk; $ln.Font = New-Object System.Drawing.Font('Segoe UI', 9.5); $ln.SetBounds(24, 166, 570, 22); $f.Controls.Add($ln)
    $f.Tag = $null
    $mk = { param($t, $x, $y, $w, $h, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button; $b.Text = $t; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.FlatAppearance.BorderColor = $renk; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
        $b.SetBounds($x, $y, $w, $h); $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b); $b }
    [void](& $mk "KALDIĞI YERDEN DEVAM`r`n(son güvenli noktadan, önerilen)" 24 200 300 80 $cYesil 'guvenli')
    [void](& $mk "YAKIN NOKTADAN`r`n(~1 dk geriden, yukarıdan iner)" 334 200 262 80 $cAltinAc 'yakin')
    [void](& $mk 'BAŞTAN BAŞLAT' 24 296 300 56 $cSoluk 'bastan')
    [void](& $mk 'Vazgeç' 334 296 262 56 $cSoluk 'iptal')
    $lu = New-Object System.Windows.Forms.Label; $lu.Text = 'Blok tutucudan sökülmediyse devam doğru yerden kesilir.'; $lu.ForeColor = $cSoluk; $lu.Font = New-Object System.Drawing.Font('Segoe UI', 9.5); $lu.SetBounds(24, 362, 570, 24); $f.Controls.Add($lu)
    [void]$f.ShowDialog($form)
    return @{ Sec = [string]$f.Tag; Takim = $cT.SelectedIndex }
}

function Devam-Baslat($k, [string]$mod, [int]$takimSimdi) {
    if (-not (Hazir-Mi 'Devam')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine şu an çalışıyor.' 'Devam' 'OK' 'Warning') | Out-Null; return }
    $form.Cursor = 'WaitCursor'
    try {
        # Eding'in bildiği frez, gerçekte takılı olanla aynı olsun (hareketsiz; macro'daki pens/T0 eki ile)
        # K6/GV-04: önce Eding'deki makro sürümü (#4038), sonra bayrak (#4039 / #4900) yazılıp geri okunur; her adım denetlenir
        $script:MakroKontrolTamam = $false   # Devam'da sürüm her seferinde Eding'den yeniden okunur
        if (-not (Makro-Hazir-Mi 'Devam')) { return }
        $tkE = [Eding]::CncGetCurrentToolNumber()
        if ($tkE -ne $takimSimdi) {
            Yaz "Devam: Eding'deki frez T$tkE, iş milinde T$takimSimdi."
            if (-not (Takim-Bildir $takimSimdi 'Devam')) { return }
        }
        $an = $null; try { $an = [NcAnaliz]::Oku([string]$k.Kaynak, 4000.0) } catch { }
        $d = Devam-NC-Uret ([string]$k.Kaynak) ([int]$k.Satir) $mod $an
        Yaz "Devam programı: $($d.Yol)  (asıl dosyada satır $($d.Satir)'den, T$($d.Takim); tekrar edilecek kısım ~$(Sade-Sure $d.Tekrar))"
        Dosyayi-Kontrol-Et $d.Yol
        if ($script:Engel) { (Ui-Kutu "Devam programı kontrolden geçemedi:`r`n$($script:SonHatalar -join "`r`n")" 'Devam' 'OK' 'Error') | Out-Null; return }
        Hata-Temizle 'Devam'
        if (-not (Bayrak-Sifirla 'Devam')) { (Ui-Kutu "Takım bildirim bayrağı (#4039) sıfırlanamadı. Devam başlatılmadı." 'Devam' 'OK' 'Warning') | Out-Null; return }
        if (-not (Komut-Sonucu 'Devam programı yükleme' ([Eding]::CncLoadJobA($d.Yol)))) { return }
        $rc = Is-Calistir
        if (Komut-Sonucu 'Devam başlat' $rc) {
            $script:DevamDosya = [string]$k.Dosya; $script:DevamKaynak = [string]$k.Kaynak; $script:DevamHarita = $d.Harita
            $script:BlokHazir = $false; if ($script:Sade) { Blok-Cip-Guncelle }
            $script:TakipSonu = ''; $script:IsAktif = $true; $script:Gecen = [TimeSpan]::Zero; $script:SonTik = Get-Date
            $script:BaslamaAni = Get-Date; $script:SonGecerliSatir = 0; $script:CalistiGoruldu = $false
            Yaz "Kaldığı yerden devam ediyor: $([System.IO.Path]::GetFileName([string]$k.Dosya))"
        }
    } finally { $form.Cursor = 'Default' }
}

# Açılışta yarım iş varsa dosyasını seçili getir (BAŞLAT'a basınca "kaldığı yerden" sorulur)
function Devam-Acilis {
    $k = Devam-Oku
    if (-not $k) { return }
    $dosya = [string]$k.Dosya
    if (-not [System.IO.File]::Exists($dosya)) { $dosya = [string]$k.Kaynak }
    try {
        $script:SeciliDosya = $dosya
        $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($dosya); $lblDosya.ForeColor = $cYazi
        Dosyayi-Kontrol-Et $dosya
        Yaz "YARIM KALAN İŞ: $([System.IO.Path]::GetFileName($dosya))  %$($k.Yuzde)  ($($k.Zaman)). Kaldığı yerden devam için BAŞLAT'a bas."
        $lblSure.Text = "Yarım kalan iş  ·  %$($k.Yuzde)  ·  devam için BAŞLAT"; $lblSure.ForeColor = $cAltinAc
    } catch { }
}

# Yüklenen işi çalıştır: Eding hazır olana kadar kısa süre dener; Eding hata verirse HEMEN bırakır (eskiden 60 sn deniyordu → panel kilitli görünüyordu)
function Is-Calistir {
    $son = (Get-Date).AddSeconds(15)
    $rc = -1
    do {
        Ui-Olaylar
        $rc = [Eding]::CncRunOrResumeJob()
        if (Rc-Tamam $rc) { break }
        $d = Eding-Durum
        if ((Hatali $d) -or $d -eq 'ABORTED') { [Kayit]::Yaz("BAŞLAT: Eding '$d' durumunda, tekrar denenmiyor (rc $rc)"); break }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $son)
    return $rc
}

# Orijinal program (CHECK_EMPTY_TOOL) iş milinde frez varken başlamaz: başlamadan önce sor, istenirse frezi yuvasına bırak
function Bos-Ismili-Hazirla {
    $tk = 0; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    if ($tk -eq 0) { return $true }
    if ($script:Manuel) {
        (Ui-Kutu "İş milinde T$tk takılı görünüyor; iş boş iş miliyle başlar.`r`n`r`nFrezi tut, PENS AÇ'a bas ve frezi çıkar (takım T0 olur), PENS KAPAT, sonra tekrar BAŞLAT." 'Başlat' 'OK' 'Information') | Out-Null
        return $false
    }
    if (-not (Onay "İş milinde T$tk takılı görünüyor.`r`nMakinenin programı işe boş iş miliyle başlar (yoksa hata verip durur).`r`n`r`nT$tk kendi yuvasına bırakılsın mı?`r`n(Yuvası boş olmalı.)" 'Başlat')) { return $false }
    Yaz "Başlat öncesi: T$tk yuvasına bırakılıyor (M6 T0)..."
    $script:TakimKomutuAni = Get-Date
    if (-not (Komut-Sonucu 'Frez bırak (M6 T0)' ([Eding]::CncRunSingleLine('M6 T0')))) { return $false }
    if (-not (Hareket-Bitene-Kadar-Bekle 120)) { Yaz 'Frez bırakma bitmedi.'; return $false }
    $script:TakimKomutuAni = [datetime]::MinValue
    if ([Eding]::CncGetCurrentToolNumber() -ne 0) { (Ui-Kutu 'Frez bırakılamadı; iş başlatılmadı.' 'Başlat' 'OK' 'Warning') | Out-Null; return $false }
    return $true
}

# BAŞLAT çift basılmasın: işlem sürerken (dosya kontrolü, yükleme) gelen ikinci basış yok sayılır
$script:BaslatMesgul = $false
function Btn-Baslat {
    if ($script:BaslatMesgul) { [Kayit]::Yaz('BAŞLAT: önceki basış hâlâ işleniyor, yok sayıldı'); return }
    $script:BaslatMesgul = $true
    try { Btn-Baslat-Ic } finally { $script:BaslatMesgul = $false }
}
function Btn-Baslat-Ic {
    if ($script:Manuel -and $script:Bagli -and $script:ApiHazir) {
        $ist = $null; try { $ist = Manuel-Istek; if ($ist -and $ist.Faz -eq 3) { $ist = $null } } catch { }
        if (-not $ist -and (Durakli-Mi)) { try { $ist = Manuel-Istek-Tahmin } catch { } }
        if ($ist) { Manuel-Diyalog $ist; return }   # manuel frez beklerken BAŞLAT = o adımı onayla
    }
    if ($script:Bagli -and (Durakli-Mi)) {
        if (-not $script:Sade -and -not (Onay "Duraklatılan kazımaya devam edilsin mi?" 'Devam')) { return }
        [void](Komut-Sonucu 'Devam' ([Eding]::CncRunOrResumeJob()))
        return
    }
    if ($script:Sade -and $script:Tercih.UzakKilit -ne '0' -and -not $script:BlokHazir -and ((Get-Date) - [WebSunucu]::SonUzakGirdi).TotalSeconds -lt 5) {
        # Başka bilgisayardan basıldı: makinede bloğun takıldığı onaylanmadan uzaktan başlatılmaz
        Yaz 'Uzaktan BAŞLAT reddedildi: makinede "Blok takıldı" onayı yok.'
        (Ui-Kutu "Uzaktan başlatmak için önce makinede bloğu takıp`r`nalttaki ""Blok takıldı"" düğmesine basılmalı." 'Başlat' 'OK' 'Warning') | Out-Null; return
    }
    if (-not $script:SeciliDosya) { (Ui-Kutu 'Önce DOSYA SEÇ ile bir .nc dosyası seç.' 'Başlat' 'OK' 'Information') | Out-Null; return }
    if ($script:Engel) { (Ui-Kutu 'Dosyada hata var (aşağıdaki listeye bak). Kazıma başlatılmadı.' 'Başlat' 'OK' 'Error') | Out-Null; return }
    if (-not (Hazir-Mi 'Başlat')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine şu an çalışıyor.' 'Başlat' 'OK' 'Warning') | Out-Null; return }
    if (-not (Makro-Hazir-Mi 'Başlat')) { return }
    if ([System.IO.Path]::GetFileName($script:SeciliDosya) -like 'PM_kalibrasyon_otomatik*' -and -not (OtoKal-Prob-Gecerli-Mi 'Başlat')) { return }   # K8
    if (-not (Takim-Kapisi 'Başlat')) { return }

    # Bu dosyanın yarım kalmış kaydı varsa: kaldığı yerden mi, baştan mı?
    $dk = Devam-Oku
    if ($dk -and ([string]$dk.Dosya -eq $script:SeciliDosya -or [string]$dk.Kaynak -eq $script:SeciliDosya) -and -not $script:BekleyenBlok) {
        $ds = Devam-Diyalog $dk
        if ($ds.Sec -eq 'guvenli' -or $ds.Sec -eq 'yakin') { Devam-Baslat $dk $ds.Sec $ds.Takim; return }
        if ($ds.Sec -ne 'bastan') { return }
        Devam-Sil
    }

    if (-not $script:Sade -and $script:Uyarilar.Count -gt 0) {
        $m = "DİKKAT:`r`n`r`n" + ($script:Uyarilar -join "`r`n") + "`r`n`r`nYine de devam edilsin mi?"
        if ((Ui-Kutu $m 'Uyarı' 'YesNo' 'Warning') -ne 'Yes') { return }
    }
    $tk = [Eding]::CncGetCurrentToolNumber()
    if ($script:Tercih.ModSor -ne '0' -and $script:SeciliDosya -ne $script:ModOnayliDosya) {
        $mod = Frez-Modu-Sor
        if (-not $mod) { return }
        if (-not (Frez-Modu-Yaz ($mod -eq 'MANUEL'))) { return }
        Start-Sleep -Milliseconds 300
        if ((Frez-Manuel-Mi) -ne ($mod -eq 'MANUEL')) {
            (Ui-Kutu "Frez modu Eding'e yazılamadı (#4030 = $([Eding]::CncGetVariable(4030))). İş başlatılmadı." 'Frez modu' 'OK' 'Error') | Out-Null
            return
        }
    }
    # Frez modu Ayarlar'da seçilir; Eding'deki değer (#4030) seçimle aynı yapılır
    $manuel = $false
    if ($script:Manuel -and -not $script:OzelMakro) {
        (Ui-Kutu "Frez değişimi MANUEL seçili ama bu makinenin macro.cnc'si manuel değişimi desteklemiyor.`r`nAyarlar › PANEL'den OTOMATİK seç ya da PrimerMill makrosunu kur." 'Başlat' 'OK' 'Warning') | Out-Null; return
    }
    if ($script:OzelMakro) {
        if ((Frez-Manuel-Mi) -ne $script:Manuel) {
            if (-not (Frez-Modu-Yaz $script:Manuel)) { return }
            Start-Sleep -Milliseconds 300
            if ((Frez-Manuel-Mi) -ne $script:Manuel) { (Ui-Kutu "Frez modu Eding'e yazılamadı (#4030). İş başlatılmadı." 'Başlat' 'OK' 'Error') | Out-Null; return }
        }
        $manuel = $script:Manuel
    }
    if ($manuel -and -not (Manuel-Macro-Kontrol)) { return }
    # Yeni blok mu? (kalibrasyon testlerinde sorulmaz)
    $yuklenecek = $script:SeciliDosya
    $blok = $null
    if ($script:Sade -and $script:BekleyenBlok) {
        $blok = $script:BekleyenBlok
        try { $yuklenecek = Blok-Birlesik-Uret $script:SeciliDosya $blok; Dosyayi-Kontrol-Et $yuklenecek }
        catch { (Ui-Kutu "Blok ismi programa eklenemedi: $($_.Exception.Message)" 'Blok' 'OK' 'Error') | Out-Null; return }
        if ($script:Engel) {
            Dosyayi-Kontrol-Et $script:SeciliDosya
            (Ui-Kutu "Blok ismi eklenince program kontrolden geçemedi:`r`n$($script:SonHatalar -join "`r`n")`r`n`r`nKazıma başlatılmadı." 'Blok' 'OK' 'Error') | Out-Null; return
        }
        Yaz "Yeni blok: önce '$($blok.Metin)' + referans çentiği kazınacak (T$($blok.Takim), saat $($blok.Konum)), sonra iş durmadan devam eder."
    }
    elseif ($script:Tercih.BlokSor -ne '0' -and [System.IO.Path]::GetFileName($script:SeciliDosya) -notlike 'PM_kalibrasyon*') {
        $blok = Blok-Sor
        if ($null -eq $blok) { return }
        if ($blok -ne 'eski') {
            try { $yuklenecek = Blok-Birlesik-Uret $script:SeciliDosya $blok; Dosyayi-Kontrol-Et $yuklenecek }
            catch { (Ui-Kutu "Blok numarası programa eklenemedi: $($_.Exception.Message)" 'Blok' 'OK' 'Error') | Out-Null; return }
            Yaz "Yeni blok: önce '$($blok.Metin)' kazınacak (T$($blok.Takim)), sonra iş. Program: $yuklenecek"
        }
    }
    $k = "Kazıma başlatılacak:`r`n$([System.IO.Path]::GetFileName($script:SeciliDosya))`r`n`r`n" +
         $(if ($blok -and $blok -ne 'eski') { "YENİ BLOK: önce '$($blok.Metin)' kazınacak (T$($blok.Takim), saat $($blok.Konum) yönünde, kenara yakın)`r`n`r`n" } else { '' }) +
         "Frez değişimi: $(if ($manuel) { 'MANUEL - her frezde panel sana hangisini takacağını söyleyecek' } else { 'OTOMATİK (magazin)' })`r`n`r`n" +
         "Kontrol et:`r`n" +
         "1. İş milinde freze YOK (şimdi yazılımdaki takım: T$tk)`r`n" +
         "2. $(if ($manuel) { 'Kullanılacak frezeler elinin altında' } else { 'Kullanılan frezeler yuvalarında' })`r`n" +
         "3. Blok takılı ve sıkıldı`r`n" +
         "4. Kompresör açık, kapak kapalı`r`n" +
         "5. Elin acil stop butonunda`r`n`r`nBAŞLATILSIN MI?"
    if (-not $script:Sade) { if (-not (Onay $k 'Kazımayı başlat')) { return } }
    if ($script:Sade -and -not (Bos-Ismili-Hazirla)) { return }

    $form.Cursor = 'WaitCursor'
    try {
        Hata-Temizle 'Başlat'
        try { if ([Eding]::CncGetVariable(4034) -ne 0) { [void][Eding]::CncRunSingleLine('#4034=0'); [void](Hareket-Bitene-Kadar-Bekle 3) } } catch { }
        if (-not (Bayrak-Sifirla 'Başlat')) { (Ui-Kutu "Takım bildirim bayrağı (#4039) sıfırlanamadı. Kazıma başlatılmadı." 'Başlat' 'OK' 'Warning') | Out-Null; return }
        $script:ManuelSonSeq = ''
        Yaz "Eding'e yükleniyor: $($script:SeciliDosya)"
        if (-not (Komut-Sonucu 'Dosya yükleme' ([Eding]::CncLoadJobA($yuklenecek)))) { return }
        $rc = Is-Calistir
        if (Komut-Sonucu 'Başlat' $rc) {
            if ($blok -and $blok -ne 'eski') { Blok-Kaydet $blok $script:SeciliDosya }
            if ($script:Sade -and $script:BekleyenBlok) { $script:BekleyenBlok = $null }
            $script:BlokHazir = $false; if ($script:Sade) { Blok-Cip-Guncelle }
            $script:DevamDosya = $script:SeciliDosya; $script:DevamKaynak = $yuklenecek; $script:DevamHarita = $null
            Devam-Kaydet 1 'calisiyor' 0
            $script:ModOnayliDosya = $null
            $script:TakipSonu = ''
            $script:TakimKomutuAni = [datetime]::MinValue
            $script:IsAktif = $true
            $script:Gecen   = [TimeSpan]::Zero
            $script:SonTik  = Get-Date
            $script:BaslamaAni = Get-Date
            $script:SonGecerliSatir = 0
            $script:CalistiGoruldu = $false
        }
    } finally { $form.Cursor = 'Default' }
}

function Btn-Duraklat {
    if (-not (Baglan)) { return }
    if (-not (Calisiyor-Mu)) { (Ui-Kutu 'Şu an çalışan bir iş yok.' 'Duraklat' 'OK' 'Information') | Out-Null; return }
    [void](Komut-Sonucu 'Duraklat' ([Eding]::CncPauseJob()))
}

function Btn-Durdur([bool]$sor = $false) {
    if (-not (Baglan)) { return }
    # KU-02: ana ekrandaki DURDUR iş sürerken / duraklıyken onay ister (varsayılan HAYIR). Uzaktan ve manuel diyalogdan gelen çağrı sormaz.
    if ($sor -and (Is-Suruyor)) {
        if (-not (Onay "Kazıma DURDURULACAK (iş iptal edilir).`r`n`r`nKaldığı yerden devam ancak BAŞLAT › KALDIĞI YERDEN DEVAM ile yapılabilir.`r`nAcil bir durumsa ACİL STOP'a bas.`r`n`r`nDurdurulsun mu?" 'Durdur')) { return }
    }
    $belirsiz = Takim-Degisimi-Suruyor-Mu
    if (Komut-Sonucu 'Durdur' ([Eding]::CncAbortJob())) {
        if ($belirsiz) { Takim-Belirsiz-Isaretle 'DURDUR' }
        if ($script:IsAktif) { Devam-Kaydet $script:SonGecerliSatir 'durduruldu' $bar.Value }
        $script:TakipSonu = 'kullanici'
        $script:IsAktif = $false
        $lblSure.Text = 'Durduruldu'
        $lblSure.ForeColor = $cSoluk
    }
}

function Btn-FrezBirak {
    if (-not (Hazir-Mi 'Frez Bırak')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine çalışırken frez bırakılamaz. Önce DURDUR.' 'Frez Bırak' 'OK' 'Warning') | Out-Null; return }
    if (-not (Takim-Kapisi 'Frez Bırak')) { return }
    $tk = [Eding]::CncGetCurrentToolNumber()
    if ($tk -eq 0) { (Ui-Kutu 'Yazılıma göre iş milinde freze yok (T0).' 'Frez Bırak' 'OK' 'Information') | Out-Null; return }
    if (-not (Onay "İş milindeki T$tk kendi yuvasına bırakılacak.`r`n`r`nT$tk yuvası BOŞ mu ve kompresör açık mı?" 'Frez Bırak')) { return }
    $script:TakimKomutuAni = Get-Date
    [void](Komut-Sonucu 'Frez Bırak (M6 T0)' ([Eding]::CncRunSingleLine('M6 T0')))
}

function Btn-Home([bool]$sor = $true) {
    if ([Eding]::AcilKilit) { (Ui-Kutu "ACİL STOP basılı.`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas." 'Home' 'OK' 'Warning') | Out-Null; return }
    if (-not (Baglan)) { (Ui-Kutu "Makineye bağlanılamadı. Eding birkaç saniye içinde açılmazsa programı yeniden başlat." 'Home' 'OK' 'Warning') | Out-Null; return }
    if ([Eding]::CncGetEMStopActive() -ne 0) { (Ui-Kutu 'Önce makinedeki acil stop butonunu bırak.' 'Home' 'OK' 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Home') { return }
    # GV-09: "iş milinde freze olmamalı" sorusu sade sürümde de atlanmaz (açılıştaki geri sayım penceresi aynı soruyu sorar)
    if ($sor -and -not (Onay "Makine home alacak: önce iş mili yukarı, sonra C kol düz, sonra X, Y, A, B.`r`n`r`nİş milinde freze olmamalı (Eding'e göre: T$([Eding]::CncGetCurrentToolNumber())), kapak kapalı olmalı.`r`nDevam edilsin mi?" 'Home')) { return }

    $form.Cursor = 'WaitCursor'
    try {
        # Sürücüleri aç (Eding'deki RESET ile aynı)
        Yaz "Home: sürücüler açılıyor (reset): $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800

        # Home: makinenin orijinal home_all makrosu (orijinal yazılımdaki gibi)
        Yaz 'Home: makinenin home_all makrosu çalışıyor...'
        $rc = [Eding]::CncRunSingleLine('gosub home_all')
        if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu 'Home (gosub home_all)' $rc); return }
        if (-not (Hareket-Bitene-Kadar-Bekle 240)) {
            (Ui-Kutu "Home sırasında Eding hata verdi ya da hareket bitmedi.`r`nDetaylar kaydına bak." 'Home' 'OK' 'Error') | Out-Null
            return
        }
        if ([Eding]::CncGetAllAxesHomed() -ne 0 -and -not (Hatali (Eding-Durum))) { Yaz 'Home tamamlandı.' }
        else { Yaz 'Home tamamlanmadı; Detaylar kaydına bak.'; (Ui-Kutu 'Home tamamlanamadı. Detaylar penceresindeki kayda bak.' 'Home' 'OK' 'Warning') | Out-Null }
    } finally { $form.Cursor = 'Default' }
}

# ---------------- Kazıma hızı (Eding feed override) ----------------
$script:HizOran = $true          # Eding değeri 1.0 = %100 mü (true) yoksa 100 = %100 mü (false)
$script:HizUyarildi = $false
function Hiz-Oku {
    $v = [Eding]::CncGetActualFeedOverride()
    if ($v -gt 5) { $script:HizOran = $false; return [math]::Round($v) }
    $script:HizOran = $true
    return [math]::Round($v * 100)
}
function Hiz-Ayarla([int]$yuzde) {
    if (-not (Baglan)) { return }
    $yuzde = [math]::Max(30, [math]::Min(150, $yuzde))
    if ($yuzde -gt 120 -and -not $script:HizUyarildi) {
        $m = "Kazıma hızı %$yuzde yapılacak.`r`n`r`nHyperDent'in hızları malzeme ve frezeye göre hesaplanır. %120'nin üstü freze kırılması ve yüzey kalitesi için risklidir; özellikle zirkonya dışı sert malzemelerde.`r`n`r`nDevam edilsin mi?"
        if (-not (Onay $m 'Kazıma hızı')) { return }
        $script:HizUyarildi = $true
    }
    [void](Hiz-Oku)
    $deger = if ($script:HizOran) { $yuzde / 100.0 } else { [double]$yuzde }
    $rc = [Eding]::CncSetFeedOverride($deger)
    Start-Sleep -Milliseconds 300
    $okunan = Hiz-Oku
    Yaz "Kazıma hızı: %$yuzde istendi -> $([Eding]::RCText($rc)), Eding'deki değer: %$okunan"
    if ([math]::Abs($okunan - $yuzde) -gt 2) {
        (Ui-Kutu "Eding hız ayarını kabul etmedi (şu an %$okunan).`r`nEding'in ayarlarında hız kaynağı (feed override source) panel yerine başka bir kaynağa (örneğin makinedeki düğmeye) bağlı olabilir." 'Kazıma hızı' 'OK' 'Warning') | Out-Null
    }
    $lblHiz.Text = "%$okunan"
}

# ---------------- Açılışta otomatik hazırlık ----------------
$script:AcilisDurum = 'bekliyor'   # bekliyor -> acilstop -> tamam / iptal
$script:AcilisYeniden = $false     # Eding panel açıkken yeniden başlatıldı (otomatik hazırlık yapılmaz)
$script:EdingBirKezBaglandi = $false

function Geri-Sayim([int]$saniye, [string]$metin) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'PrimerMill'
    $f.ClientSize = New-Object System.Drawing.Size(460, 190)
    $f.StartPosition = 'CenterParent'
    $f.FormBorderStyle = 'FixedDialog'
    $f.ControlBox = $false
    $f.TopMost = $true
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi
    $f.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $l = New-Object System.Windows.Forms.Label
    $l.SetBounds(20, 16, 420, 70); $l.Text = $metin
    $f.Controls.Add($l)
    $sayac = New-Object System.Windows.Forms.Label
    $sayac.SetBounds(20, 86, 420, 40); $sayac.TextAlign = 'MiddleCenter'
    $sayac.Font = New-Object System.Drawing.Font('Segoe UI Light', 22); $sayac.ForeColor = $cAltinAc
    $sayac.Text = "$saniye  ·  sonra iptal"
    $f.Controls.Add($sayac)
    $iptal = New-Object System.Windows.Forms.Button
    $iptal.Text = 'İptal'; $iptal.SetBounds(240, 138, 100, 34); $iptal.FlatStyle = 'Flat'
    $iptal.ForeColor = $cYazi; $iptal.BackColor = $cPanel; $iptal.DialogResult = 'Cancel'
    $f.Controls.Add($iptal)
    $f.AcceptButton = $iptal; $f.ActiveControl = $iptal
    $simdi = New-Object System.Windows.Forms.Button
    $simdi.Text = 'Şimdi başla'; $simdi.SetBounds(120, 138, 110, 34); $simdi.FlatStyle = 'Flat'
    $simdi.ForeColor = $cAltinAc; $simdi.BackColor = $cPanel; $simdi.DialogResult = 'OK'
    $f.Controls.Add($simdi)
    $f.CancelButton = $iptal
    $script:GsKalan = $saniye
    $t = New-Object System.Windows.Forms.Timer
    $t.Interval = 1000
    # GV-09/ED-06: süre dolunca İPTAL (hareket yok); hareket yalnız "Şimdi başla" ile
    $t.Add_Tick({ $script:GsKalan--; $sayac.Text = "$($script:GsKalan)  ·  sonra iptal"; if ($script:GsKalan -le 0) { $f.DialogResult = 'Cancel' } })
    $t.Start()
    $r = $f.ShowDialog($form)
    $t.Stop(); $t.Dispose(); $f.Dispose()
    [Kayit]::Yaz("GERİ SAYIM [$($metin.Split("`n")[0])] -> $r")
    return ($r -eq 'OK')
}

# Zamanlayıcıdan çağrılır: bağlantı kurulduktan sonra bir kez çalışır
function Acilis-Hazirla {
    if ($script:AcilisDurum -eq 'tamam' -or $script:AcilisDurum -eq 'iptal' -or $script:AcilisDurum -eq 'calisiyor') { return }
    if ([Eding]::AcilKilit) { Yaz 'Açılış: ACİL STOP basılı, otomatik hazırlık (reset + home) yapılmadı.'; $script:AcilisDurum = 'iptal'; return }
    $d = Eding-Durum
    if ($d -eq '' -or $d -eq 'POWERUP') { return }   # Eding henüz açılıyor
    if ([Eding]::CncGetEMStopActive() -ne 0) {
        if ($script:AcilisDurum -ne 'acilstop') { Yaz 'Açılış: acil stop basılı. Bırakınca hazırlık otomatik devam edecek.'; $script:AcilisDurum = 'acilstop' }
        return
    }
    if ((Mesgul $d) -or $d -like 'PAUSE*') { Yaz "Açılış: Eding meşgul ya da duraklı ($d), otomatik hazırlık atlandı."; $script:AcilisDurum = 'tamam'; return }
    # GV-09/ED-06: Eding yeniden açıldıysa / bağlantı yeniden kurulduysa otomatik reset + home YOK
    if ($script:AcilisYeniden) {
        Yaz 'Eding yeniden açıldı: otomatik reset ve home yapılmadı. Kabini ve iş milini kontrol edip HOME''a bas.'
        $script:AcilisDurum = 'iptal'; return
    }
    $script:AcilisDurum = 'calisiyor'
    try {
        Yaz 'Açılış: otomatik hazırlık başladı.'
        Yaz "Açılış: reset -> $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800
        if ([Eding]::CncGetAllAxesHomed() -ne 0) {
            Yaz 'Açılış: makine zaten home alınmış.'
        } else {
            $tk0 = -1; try { $tk0 = [Eding]::CncGetCurrentToolNumber() } catch { }
            $m = "Makine home alacak: Z, X, Y, A ve B eksenleri sırayla hareket edecek.`r`nİş milinde freze olmamalı (Eding'e göre T$tk0), kabinde elin olmasın, kapak kapalı olsun."
            $gs = [int]$script:Tercih.GeriSayim
            # GV-09: GeriSayim = 0 "her zaman sor" demektir (onaysız home yok); geri sayım dolarsa iptal
            $basla = if ($gs -le 0) { Onay "$m`r`n`r`nHome şimdi alınsın mı?" 'Açılış' } else { Geri-Sayim $gs ($m + "`r`nBaşlamak için 'Şimdi başla'ya bas.") }
            if ($basla) { Btn-Home $false }
            else { Yaz 'Açılış: home iptal edildi. HOME butonuyla elle başlatabilirsin.'; $script:AcilisDurum = 'iptal'; return }
        }
        if ([Eding]::CncGetAllAxesHomed() -ne 0 -and -not (Hatali (Eding-Durum))) {
            Yaz 'Açılış: makine hazır. Dosya seçip kazımaya başlayabilirsin.'
            if (-not $script:SeciliDosya) { $lblDosya.Text = 'Makine hazır  ·  bir dosya seçin' }
        }
    } finally { if ($script:AcilisDurum -eq 'calisiyor') { $script:AcilisDurum = 'tamam' } }
}

# Paneli yeni açılmış hale getir
function Panel-Sifirla {
    $script:TakipSonu = 'kullanici'
    $script:IsAktif = $false
    try { if ($script:Bagli -and [Eding]::CncGetVariable(4034) -ne 0) { [void][Eding]::CncRunSingleLine('#4034=0') } } catch { }
    $script:ManuelSonSeq = ''
    $script:Gecen = [TimeSpan]::Zero
    $script:SonTik = $null
    $script:SeciliDosya = $null
    $script:Analiz = $null
    $script:Engel = $true
    $script:Uyarilar = @()
    $script:DetayIlerleme = ''
    $script:SonYuzdeLog = -1
    $script:SonGecerliSatir = 0
    $bar.Dancing = $false
    $bar.Animal = -1
    $bar.Caption = ''
    $bar.Value = 0
    $lblSure.Text = ''
    $lblSure.ForeColor = $cSoluk
    $lblDosya.Text = 'Bir dosya seçin'
    $lblDosya.ForeColor = $cSoluk
    $sim.SetData($null)
    $simBuyuk.SetData($null)
    Yaz 'Panel sıfırlandı.'
}

# ================= YAZILIM ACİL STOPU =================
# Fiziksel buton yok: panel işi keser, iş milini ve havayı kapatır, kilitlenir.
# Kilit kalkana kadar panelden hiçbir hareket komutu Eding'e gitmez; Eding'de biri BAŞLAT'a basarsa iş yine kesilir.
function Acil-Stop([string]$kaynak) {
    $belirsiz = $false; try { $belirsiz = Takim-Degisimi-Suruyor-Mu } catch { $belirsiz = $true }   # GV-08: kesmeden önce bak
    $ilk = -not [Eding]::AcilKilit
    [Eding]::AcilKilit = $true
    # ED-08: önce makine durdurulur (abort, çıkışlar), tercih dosyası EN SON yazılır; bağlı değilse bir kez bağlanmayı dener
    $bagli = $false
    if ($script:ApiHazir) { $bagli = $script:Bagli; if (-not $bagli) { try { $bagli = Baglan } catch { $bagli = $false } } }
    if ($bagli) {
        $rcAbort = -1
        try { $rcAbort = [Eding]::CncAbortJob() } catch { }
        try { [void][Eding]::CncSetOutput(4, 0) } catch { }    # iş mili çıkışı
        try { [void][Eding]::CncSetOutput(11, 0) } catch { }   # hava üfleme (AUX4)
        try { [Kayit]::Yaz("!!! ACİL STOP ($kaynak): işi kes -> $([Eding]::RCText($rcAbort))") } catch { }
        Start-Sleep -Milliseconds 250
        try { [void][Eding]::CncAbortJob() } catch { }
        try {
            # MAKİNEDE DOĞRULA (ED-08): CncReset sürücüleri yeniden enerjilendiriyor olabilir (Btn-Home: "sürücüler açılıyor (reset)").
            # Acil stoptan sonra reset gerekli mi / sürücüler enerjili mi kalıyor, makinede doğrulanmadan bu çağrı kaldırılmadı.
            [void][Eding]::CncReset()
            foreach ($l in @('M5', 'M9', 'M55 P4')) { [Kayit]::Yaz("ACİL STOP: $l -> $([Eding]::RCText([Eding]::CncRunSingleLineZorla($l)))") }
        } catch { }
        try { [Kayit]::Yaz("ACİL STOP: sonra Eding durumu $(Eding-Durum), çalışıyor=$([Eding]::CncGetRunningStatus())") } catch { }
    } else {
        [Kayit]::Yaz("!!! ACİL STOP ($kaynak): Eding'e bağlanılamadı, sadece panel kilitlendi")
    }
    try { $estop.Latched = $true } catch { }
    $script:Tercih.AcilStop = '1'; try { Tercih-Yaz } catch { }
    $script:IsAktif = $false
    $script:TakipSonu = 'kullanici'
    if ($belirsiz) { Takim-Belirsiz-Isaretle "ACİL STOP ($kaynak)" }
    $bar.Dancing = $false
    $lblSure.Text = 'ACİL STOP ile durduruldu'; $lblSure.ForeColor = $cKirmizi
    Durum-Yaz 'ACİL STOP  ·  kaldırmak için RESET' $cKirmizi
    $lamba.LampColor = [System.Drawing.Color]::FromArgb(230, 20, 20)
}

function Acil-Stop-Kaldir {
    if (-not [Eding]::AcilKilit) { return }
    if (-not (Onay "ACİL STOP kaldırılacak.`r`n`r`n• Makinenin içinde el, alet ya da sıkışmış parça yok mu?`r`n• Kapak kapalı mı?`r`n`r`nKaldırınca makine kendiliğinden HAREKET ETMEZ; işe yeniden BAŞLAT ile başlarsın." 'Acil stop kaldır')) { return }
    [Eding]::AcilKilit = $false
    $estop.Latched = $false
    $script:Tercih.AcilStop = '0'; try { Tercih-Yaz } catch { }
    [Kayit]::Yaz('ACİL STOP kaldırıldı')
    if (Baglan) {
        try { [Kayit]::Yaz("ACİL STOP kaldır: reset -> $([Eding]::RCText([Eding]::CncReset()))") } catch { }
    }
    $script:PensAcik = $false
    $btnPens.Text = 'PENS AÇ'
    Panel-Sifirla
    Yaz 'Acil stop kaldırıldı. Makine hazır.'
}

function Btn-Reset {
    if ([Eding]::AcilKilit) { Acil-Stop-Kaldir; return }
    if (-not (Baglan)) { (Ui-Kutu "Eding CNC'ye bağlanılamadı." 'Reset' 'OK' 'Warning') | Out-Null; return }
    if ([Eding]::CncGetEMStopActive() -ne 0) { (Ui-Kutu 'Önce makinedeki acil stop butonunu bırak, sonra RESET.' 'Reset' 'OK' 'Warning') | Out-Null; return }
    if ((Is-Suruyor)) {
        if (-not (Onay 'Makine çalışıyor ya da duraklatılmış bir iş var. RESET işi durdurur. Devam edilsin mi?' 'Reset')) { return }
    }
    $belirsiz = Takim-Degisimi-Suruyor-Mu
    if (Komut-Sonucu 'Reset' ([Eding]::CncReset())) {
        if ($belirsiz) { Takim-Belirsiz-Isaretle 'RESET' }
        $script:PensAcik = $false
        $btnPens.Text = 'PENS AÇ'
        Panel-Sifirla
    }
}

$script:PensAcik = $false
function Btn-Pens {
    if (-not (Hazir-Mi 'Pens')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine çalışırken pens açılamaz.' 'Pens' 'OK' 'Warning') | Out-Null; return }
    if (-not $script:PensAcik) {
        # Onay Pens-Ac-T0 içinde (K2: bütün "Pens aç" düğmeleri aynı onayı ve M5 beklemesini kullanır)
        if (Pens-Ac-T0 'Pens aç') { $script:PensAcik = $true; $btnPens.Text = 'PENS KAPAT' }
    } else {
        if (Komut-Sonucu 'Pens kapat (M55 P2)' ([Eding]::CncRunSingleLine('M55 P2'))) { $script:PensAcik = $false; $btnPens.Text = 'PENS AÇ' }
    }
}

function Mdi-Gonder {
    $komut = $txtMdi.Text.Trim()
    if (-not $komut) { return }
    if (-not (Baglan)) { Yaz 'MDI: makine bağlı değil.'; return }
    if ((Is-Suruyor)) { Yaz 'MDI: iş sürerken ya da duraklıyken komut gönderilemez.'; return }
    # KU-03: MDI satırı makineyi doğrudan hareket ettirebilir; tam satır gösterilip onay alınır (varsayılan HAYIR)
    if (-not (Onay "Şu satır Eding'e gönderilecek (MDI):`r`n`r`n    $komut`r`n`r`nMakine bu satırı hemen çalıştırır. Gönderilsin mi?" 'MDI')) { Yaz "MDI: vazgeçildi ($komut)"; return }
    Yaz "MDI> $komut"
    $rc = [Eding]::CncRunSingleLine($komut)
    Yaz ("     " + [Eding]::RCText($rc))
    $txtMdi.Clear()
}

$script:TemizlikDuz = $false
function Btn-Temizlik {
    # 1. basış: iş mili yukarı, C kol yatay (temizlik).  2. basış: iş mili yukarı, park konumu (G30, home sonrası durduğu yer).
    if (-not (Hazir-Mi 'Temizlik')) { return }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine çalışıyor. Önce DURDUR.' 'Temizlik' 'OK' 'Warning') | Out-Null; return }
    $form.Cursor = 'WaitCursor'
    try {
        if (-not (Komut-Sonucu 'Z en üste' ([Eding]::CncRunSingleLine('G53 G0 Z[#5163]')))) { return }
        if (-not (Hareket-Bitene-Kadar-Bekle 30)) { Yaz 'Z hareketi bitmedi, kol döndürülmedi.'; return }
        if (-not $script:TemizlikDuz) {
            if (Komut-Sonucu 'Kol yatay' ([Eding]::CncRunSingleLine('G53 G0 A[#5224] B[#5225]'))) {
                if (-not (Hareket-Bitene-Kadar-Bekle 30)) { Yaz 'Kol hareketi bitmedi ya da durum okunamadı.'; return }
                $script:TemizlikDuz = $true; $btnTemizlik.Text = 'PARK'
                Yaz 'Temizlik: kol yatay. Bitince PARK''a bas.'
            }
        } else {
            if (Komut-Sonucu 'Park konumu (G30)' ([Eding]::CncRunSingleLine('G30'))) {
                if (-not (Hareket-Bitene-Kadar-Bekle 60)) { Yaz 'Park hareketi bitmedi ya da durum okunamadı.'; return }
                $script:TemizlikDuz = $false; $btnTemizlik.Text = 'TEMİZLİK'
                Yaz 'Park konumuna dönüldü.'
            }
        }
    } finally { $form.Cursor = 'Default'; $btnTemizlik.Invalidate() }
}

$script:AdimMm = 1.0
$script:Hiz    = 300
$script:SonYuva = $null

function Hazir-Hareket([string]$islem) {
    if (-not (Hazir-Mi $islem)) { return $false }
    if ((Calisiyor-Mu)) { (Ui-Kutu 'Makine çalışıyor. Önce DURDUR.' $islem 'OK' 'Warning') | Out-Null; return $false }
    return $true
}

function Satirlar-Gonder([string]$ad, [string[]]$satirlar, [int]$bekle = 60) {
    foreach ($l in $satirlar) {
        if (Takim-Komutu-Mu $l) { $script:TakimKomutuAni = Get-Date }   # GV-08
        $rc = [Eding]::CncRunSingleLine($l)
        [Kayit]::Yaz("KOMUT> $l   -> $([Eding]::RCText($rc))")
        if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu "$ad ($l)" $rc); return $false }
        if (-not (Hareket-Bitene-Kadar-Bekle $bekle)) { Yaz "$ad : '$l' zamanında bitmedi."; return $false }
    }
    $script:TakimKomutuAni = [datetime]::MinValue
    Yaz "$ad : tamam"
    return $true
}

# --- HAREKET ---
function Jog([string]$eksen, [int]$yon) {
    if (-not (Hazir-Hareket 'Elle hareket')) { return }
    $adim = $script:AdimMm * $yon
    if ($eksen -eq 'Z' -and $yon -lt 0 -and $script:AdimMm -ge 10) {
        if (-not (Onay "Z ekseni $($script:AdimMm) mm AŞAĞI inecek. Altında bir şey olmadığından emin misin?" 'Elle hareket')) { return }
    }
    $hiz = if ($eksen -in @('A', 'B')) { [math]::Max(50, [math]::Min(1000, $script:Hiz)) } else { $script:Hiz }
    [void](Satirlar-Gonder "Jog $eksen$(Sayi $adim)" @("G91 G1 $eksen$(Sayi $adim) F$hiz", 'G90') 120)
}

function Konuma-Git([string]$ad, [string[]]$satirlar, [string]$soru) {
    if (-not (Hazir-Hareket $ad)) { return }
    if ($soru -and -not (Onay $soru $ad)) { return }
    if (Satirlar-Gonder $ad $satirlar 120) { $lblYuva.Text = "Konum: $ad" }
}

# --- TAKIM ---
function Yuvaya-Git([string]$ad) {
    if (-not (Hazir-Hareket 'Freze yuvası')) { return }
    $mut = $script:YuvaMutlak[$ad]
    $rn = [regex]::Match($ad, '^T(\d)$')
    if ($ad -eq 'Sensör' -and [Eding]::CncGetVariable(4020) -ne 0 -and [Eding]::CncGetVariable(4021) -ne 0) {
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#5224] B[#5225]', 'G53 G0 X[#4020] Y[#4021]') 90
    } elseif ($rn.Success -and [Eding]::CncGetVariable(4010) -ne 0 -and [Eding]::CncGetVariable(4010 + [int]$rn.Groups[1].Value) -ne 0) {
        $k = [int]$rn.Groups[1].Value
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#4017] B[#4018]', "G53 G0 X[#4010] Y[#$(4010 + $k)]") 90
    } elseif ($mut) {
        # macro'daki sabit (G53) konum: frez alırken kullanılan nokta ile birebir aynı
        $ab = if ($null -ne $mut.A) { "G53 G0 A$(Sayi $mut.A) B$(Sayi $mut.B)" } else { 'G53 G0 A[#5224] B[#5225]' }
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', $ab, "G53 G0 X$(Sayi $mut.X) Y$(Sayi $mut.Y)") 90
    } else {
        $ofs = $TakimY[$ad]
        $ofsTxt = if ($ofs -lt 0) { "$ofs" } else { "+$ofs" }
        $ok = Satirlar-Gonder "$ad üstüne git" @(
            'G90 G53 G0 Z[#5163]',
            'G53 G0 A[#5224] B[#5225]',
            "G53 G0 X[#5221-$($script:YuvaX)] Y[#5222$ofsTxt]") 90
    }
    if ($ok) { $script:SonYuva = $ad; $lblYuva.Text = "İş mili $ad üstünde (yukarıda)" }
}

function Yuvaya-Yaklas {
    if (-not $script:SonYuva) { (Ui-Kutu 'Önce bir yuvanın üstüne git.' 'Yaklaş' 'OK' 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Yaklaş')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -ne 0) { (Ui-Kutu 'İş milinde freze varken yuvaya yaklaşılamaz (çarpar). Önce FREZ BIRAK.' 'Yaklaş' 'OK' 'Warning') | Out-Null; return }
    if (-not (Onay "İş mili $($script:SonYuva) yuvasının yaklaşma yüksekliğine (#4001) inecek.`r`nFrezeye değmeden üstünde duracak. Devam?" 'Yaklaş')) { return }
    if (Satirlar-Gonder 'Yaklaş' @('G90 G53 G1 Z[#4001] F300') 60) { $lblYuva.Text = "İş mili $($script:SonYuva) üstünde, yaklaşma yüksekliğinde" }
}

function Yukari-Kaldir {
    if (-not (Hazir-Hareket 'Yukarı')) { return }
    if (Satirlar-Gonder 'Z en üste' @('G90 G53 G0 Z[#5163]') 60) { $lblYuva.Text = 'İş mili en üstte' }
}

function Takim-Degistir([int]$n) {
    if (-not (Hazir-Hareket 'Takım değiştir')) { return }
    if (-not (Takim-Kapisi 'Takım değiştir')) { return }
    $simdiki = [Eding]::CncGetCurrentToolNumber()
    $m = if ($n -eq 0) { "İş milindeki T$simdiki yuvasına bırakılacak.`r`nYuvası boş mu?" } else { "İş milindeki T$simdiki bırakılıp T$n alınacak, sonra boyu ölçülecek.`r`nT$n yuvasında freze var mı, T$simdiki'in yuvası boş mu?" }
    if (-not (Onay $m 'Takım değiştir')) { return }
    [void](Satirlar-Gonder "M6 T$n" @("M6 T$n") 180)
}

function Takim-Olc {
    if (-not (Hazir-Hareket 'Takım boyu ölç')) { return }
    if (-not (Takim-Kapisi 'Takım boyu ölç')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) { (Ui-Kutu 'İş milinde freze yok (T0). Önce bir takım al.' 'Takım boyu ölç' 'OK' 'Information') | Out-Null; return }
    if (-not (Onay 'İş mili sensöre gidip takım boyunu ölçecek (G92 Z güncellenir). Devam?' 'Takım boyu ölç')) { return }
    [void](Satirlar-Gonder 'Takım boyu ölç' @('gosub user_1') 120)
}

function Asinma-Kontrol {
    if (-not (Hazir-Hareket 'Aşınma kontrolü')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) { (Ui-Kutu 'İş milinde freze yok (T0).' 'Aşınma kontrolü' 'OK' 'Information') | Out-Null; return }
    if (Satirlar-Gonder 'Aşınma kontrolü' @('M100') 120) {
        $as = [Eding]::CncGetVariable(4002) - [Eding]::CncGetVariable(5063)
        Yaz "Aşınma: $(Sayi $as) mm (sınır #4005 = $(Sayi ([Eding]::CncGetVariable(4005))))"
        (Ui-Kutu "Ölçülen aşınma: $(Sayi $as) mm`r`nSınır (#4005): $(Sayi ([Eding]::CncGetVariable(4005))) mm`r`n`r`nAyrıntı Eding mesajlarında." 'Aşınma kontrolü' 'OK' 'Information') | Out-Null
    }
}

function Bos-Mu {
    if (-not (Hazir-Hareket 'İş mili boş mu')) { return }
    if (-not (Onay 'İş mili sensöre inip boş olup olmadığını kontrol edecek. Devam?' 'İş mili boş mu')) { return }
    if (Satirlar-Gonder 'İş mili boş mu' @('gosub is_empty_tool') 120) { (Ui-Kutu 'İş mili boş.' 'İş mili boş mu' 'OK' 'Information') | Out-Null }
}

# --- İŞ MİLİ VE HAVA ---
function Ismili-Calistir {
    if (-not (Hazir-Hareket 'İş mili')) { return }
    $d = Metin-Sayi $txtDevir.Text
    if ($null -eq $d -or $d -lt 1000 -or $d -gt 24000) { (Ui-Kutu 'Devir 1000 ile 24000 arasında olmalı.' 'İş mili' 'OK' 'Warning') | Out-Null; return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) {
        if (-not (Onay "İş milinde freze yok. Boş pensle döndürmek pense zarar verebilir.`r`nYine de $([int]$d) devirde çalıştırılsın mı?" 'İş mili')) { return }
    } elseif (-not (Onay "İş mili $([int]$d) devirde dönecek.`r`nKapak kapalı mı, frezenin çevresi boş mu?" 'İş mili')) { return }
    [void](Komut-Sonucu "İş mili S$([int]$d) M3" ([Eding]::CncRunSingleLine("S$([int]$d) M3")))
}

function Hava-Ufle {
    if (-not (Hazir-Hareket 'Hava')) { return }
    [void](Komut-Sonucu 'Hava üfle' ([Eding]::CncRunSingleLine('M54 P4')))
    Start-Sleep -Milliseconds 700
    [void](Komut-Sonucu 'Hava kapat' ([Eding]::CncRunSingleLine('M55 P4')))
}

# K2 (GV-02/KU-01): pens açılmadan önce iş mili durdurulur (M5) ve durduğu Eding'den okunur (en fazla 8 sn).
# MAKİNEDE DOĞRULA: CncGetActualSpeed'in birimi (devir/dk mı, oran mı) ve M5 sonrası gerçekten 0'a indiği.
function Ismili-Durdur-Bekle([string]$ad) {
    $rc = [Eding]::CncRunSingleLine('M5')
    [Kayit]::Yaz("PENS: önce iş mili durduruluyor: M5 -> $([Eding]::RCText($rc))")
    if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu "$ad (M5)" $rc); return $false }
    [void](Hareket-Bitene-Kadar-Bekle 5)
    $son = (Get-Date).AddSeconds(8); $hiz = [double]::NaN
    do {
        Ui-Olaylar
        try { $hiz = [double][Eding]::CncGetActualSpeed() } catch { $hiz = [double]::NaN }
        if (-not [double]::IsNaN($hiz) -and [math]::Abs($hiz) -lt 1) { [Kayit]::Yaz("PENS: iş mili durdu (hız $hiz)"); return $true }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $son)
    [Kayit]::Yaz("PENS: iş mili 8 sn içinde durmadı / hız okunamadı (son okunan $hiz), pens AÇILMADI")
    (Ui-Kutu "İş mili durdurulamadı ya da durduğu okunamadı (Eding'in bildirdiği hız: $hiz).`r`n`r`nPens AÇILMADI. İş milinin tamamen durduğunu gözünle kontrol et, sonra tekrar dene." $ad 'OK' 'Warning') | Out-Null
    return $false
}

function Pens-Ac-T0([string]$ad = 'Pens aç') {
    if (Is-Suruyor-Uyari $ad) { return $false }
    if (-not (Onay "Pens hava ile AÇILACAK ve takım T0 yapılacak.`r`nÖnce iş mili durdurulur (M5) ve durması beklenir.`r`n`r`nİş milinde freze varsa düşebilir, elinle tut.`r`nDevam edilsin mi?" $ad)) { return $false }
    if (-not (Ismili-Durdur-Bekle $ad)) { return $false }
    # Pens açılınca frez elle çıkarılır: Eding'deki takım numarası da T0 yapılır (macro: gosub pm_pens_t0, hareket yok).
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'); $var = $false
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $var = ($sr.ReadToEnd() -match '(?im)^\s*sub\s+pm_pens_t0\b'); $sr.Close()
    } catch { }
    if (-not $var) {
        [Kayit]::Yaz('PENS: macro.cnc içinde pm_pens_t0 yok, sadece pens açılıyor (takım no değişmez)')
        return (Komut-Sonucu "$ad (M54 P2)" ([Eding]::CncRunSingleLine('M54 P2')))
    }
    $once = 0; try { $once = [Eding]::CncGetCurrentToolNumber() } catch { }
    $rc = [Eding]::CncRunSingleLine('gosub pm_pens_t0')
    if (-not (Rc-Tamam $rc)) {
        # Eding macro'yu açılışta okur: yeni macro henüz yüklenmemişse sadece pensi aç
        [Kayit]::Yaz("PENS: gosub pm_pens_t0 çalışmadı (rc $rc), sadece pens açılıyor")
        Hata-Temizle 'Pens'
        Yaz 'Pens açıldı. Takımın kendiliğinden T0 olması için Eding bir kez kapatılıp açılmalı.'
        return (Komut-Sonucu "$ad (M54 P2)" ([Eding]::CncRunSingleLine('M54 P2')))
    }
    $ok = $true
    if ($ok) {
        [void](Hareket-Bitene-Kadar-Bekle 5)
        $sonra = -1; try { $sonra = [Eding]::CncGetCurrentToolNumber() } catch { }
        [Kayit]::Yaz("PENS: açıldı, takım T$once -> T$sonra")
        if ($sonra -ne 0) {
            (Ui-Kutu "Pens açıldı ama Eding takımı T0 yapmadı (şu an T$sonra).`r`nEding eski macro.cnc ile çalışıyor olabilir: Eding'i kapatıp açınca düzelir." 'Pens' 'OK' 'Warning') | Out-Null
        }
    }
    return $ok
}

function Tek-Komut([string]$ad, [string]$komut) {
    if (-not (Hazir-Hareket $ad)) { return }
    [void](Komut-Sonucu "$ad ($komut)" ([Eding]::CncRunSingleLine($komut)))
}

$script:G54Kutu = @{}
$script:ParamKutu = @{}

function Ayar-Oku {
    if (-not (Baglan)) { return }
    foreach ($k in @('X', 'Y', 'Z', 'A', 'B')) {
        $nr = @{ X = 5221; Y = 5222; Z = 5223; A = 5224; B = 5225 }[$k]
        $script:G54Kutu[$k].Text = Sayi ([Eding]::CncGetVariable($nr))
    }
    foreach ($nr in $ParamTanim.Keys) { $script:ParamKutu[$nr].Text = Sayi ([Eding]::CncGetVariable([int]$nr)) }
    $g92 = @(5211, 5212, 5213, 5214, 5215 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblG92.Text = "G92 kaydırması:  X $($g92[0])   Y $($g92[1])   Z $($g92[2])   A $($g92[3])   B $($g92[4])   (Z, takım boyu ölçümünden gelir)"
    $g92xyab = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    if ($g92xyab.Count -gt 0) { $lblG92.Text += "   ·   DİKKAT: X/Y/A/B'de G92 var, kazıma konumu kayar"; $lblG92.ForeColor = $cKirmizi } else { $lblG92.ForeColor = $cSoluk }
    try { $lblRaf.Text = Raf-Metni } catch { }
    try {
        $fk = G54-Uretici-Fark
        $lblUretici.Text = if ($fk.Count) { "G54 üretici değerinden farklı:  " + ($fk -join '   ·   ') } else { 'G54 üretici değerlerinde.' }
        $lblUretici.ForeColor = if ($fk.Count) { $cAltinAc } else { $cSoluk }
    } catch { }
}

function Ayar-Kaydet {
    if (-not (Hazir-Hareket 'Ayar kaydet')) { return }
    $g = @{}
    foreach ($k in @('X', 'Y', 'Z', 'A', 'B')) { $g[$k] = Metin-Sayi $script:G54Kutu[$k].Text }
    $p = @{}
    foreach ($nr in $ParamTanim.Keys) { $p[$nr] = Metin-Sayi $script:ParamKutu[$nr].Text }
    if ($null -in @($g.Values) -or $null -in @($p.Values)) { (Ui-Kutu 'Değerlerden biri sayı değil.' 'Ayar kaydet' 'OK' 'Warning') | Out-Null; return }
    $m = "Şu değerler kaydedilecek:`r`n`r`nG54  X $(Sayi $g.X)   Y $(Sayi $g.Y)   Z $(Sayi $g.Z)   A $(Sayi $g.A)   B $(Sayi $g.B)`r`n" +
         (($ParamTanim.Keys | ForEach-Object { "#$_ $($ParamTanim[$_]): $(Sayi $p[$_])" }) -join "`r`n") +
         "`r`n`r`nBu değerler takım değişimini VE parça kazımayı etkiler. Devam?"
    if (-not (Onay $m 'Ayar kaydet')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04
    $ok = (Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $g.X) Y$(Sayi $g.Y) Z$(Sayi $g.Z) A$(Sayi $g.A) B$(Sayi $g.B)")))
    foreach ($nr in $ParamTanim.Keys) { if ($ok) { $ok = (Komut-Sonucu "#$nr" ([Eding]::CncRunSingleLine("#$nr=$(Sayi $p[$nr])"))) } }
    Start-Sleep -Milliseconds 500
    Ayar-Oku
}

$script:RafKontrolTamam = $false
$script:RafEksik = $false

function Degisken-Yaz([int]$nr, [double]$v) {
    if ((Is-Suruyor)) { [Kayit]::Yaz("DEĞİŞKEN> #$nr yazılmadı: iş sürüyor / duraklı (K1)"); return $false }
    $rc = [Eding]::CncRunSingleLine("#$nr=$(Sayi $v)")
    [Kayit]::Yaz("DEĞİŞKEN> #$nr=$(Sayi $v)   -> $([Eding]::RCText($rc))")
    return (Rc-Tamam $rc)
}

function Raf-Metni {
    $v = @{}; foreach ($nr in $RafTanim.Keys) { $v[$nr] = [Eding]::CncGetVariable([int]$nr) }
    if ($v[4010] -eq 0 -or $v[4011] -eq 0) { return 'Frez yuvaları henüz kaydedilmemiş.' }
    $t = "X $(Sayi $v[4010])   A $(Sayi $v[4017])   B $(Sayi $v[4018])   alma Z $(Sayi ([Eding]::CncGetVariable(4000)))`r`n"
    $t += (@(1..6 | ForEach-Object { "T$_ Y $(Sayi $v[4010 + $_])" }) -join '    ')
    $t += if ($v[4020] -ne 0 -and $v[4021] -ne 0) { "`r`nSensör  X $(Sayi $v[4020])   Y $(Sayi $v[4021])   (A = G54 A)" } else { "`r`nSensör kaydedilmemiş" }
    return $t
}

function Raf-Eksik-Listesi { return @($RafZorunlu | Where-Object { [Eding]::CncGetVariable([int]$_) -eq 0 }) }
function Raf-Kontrol {
    # Ana zamanlayıcıdan (PrimerMill makrosu, Eding hazır): bayrağı günceller, ilk eksiklikte bir kez günlüğe yazar
    try { $eksik = @(Raf-Eksik-Listesi) } catch { return }
    $script:RafEksik = ($eksik.Count -gt 0)
    if ($script:RafEksik) { $script:RafEksikSayac++ } else { $script:RafEksikSayac = 0 }
    if ($script:RafEksikSayac -eq 3 -and -not $script:RafKontrolTamam) {   # 3 tık üst üste: Eding'in değişkenleri yüklemesi beklenir
        [Kayit]::Yaz("YUVALAR: kayıtlı değil (0 okundu): $(($eksik | ForEach-Object { "#$_" }) -join ' ')  -- hiçbir şey yazılmadı")
        Yaz 'Takım yuvaları/sensör kayıtlı değil: Ayarlar › Yuva ayarı'
    }
    if ($script:RafEksikSayac -ge 3 -or -not $script:RafEksik) { $script:RafKontrolTamam = $true }
}
$script:RafEksikSayac = 0
function Raf-Hazir-Mi([string]$islem) {
    if (-not $script:OzelMakro) { return $true }   # orijinal makro bu değişkenleri kullanmaz
    $eksik = @(0); try { $eksik = @(Raf-Eksik-Listesi) } catch { }
    $script:RafEksik = ($eksik.Count -gt 0)
    if (-not $script:RafEksik) { return $true }
    [Kayit]::Yaz("YUVALAR: '$islem' reddedildi, kayıtlı değil: $(($eksik | ForEach-Object { "#$_" }) -join ' ')")
    (Ui-Kutu "Takım yuvaları / sensör / değişim noktası Eding'de kayıtlı değil (0 okundu: $(($eksik | ForEach-Object { "#$_" }) -join ' ')).`r`n`r`n$islem yapılmadı.`r`n`r`nAyarlar › YUVA AYARI: yuvaları ölçüp KAYDET ya da 'Doğrulanmış değerlere dön'." $islem 'OK' 'Warning') | Out-Null
    return $false
}

function Konumu-Sensor-Yap {
    if (-not (Hazir-Hareket 'Sensör kaydet')) { return }
    $p = [Eding]::MachinePos()
    $gA = [Eding]::CncGetVariable(5224); $gB = [Eding]::CncGetVariable(5225)
    if ([math]::Abs($p.A - $gA) -gt 0.05) {
        (Ui-Kutu "Frez boyu sensörde G54 A açısında ölçülür (A $(Sayi $gA)).`r`nŞu an A $(Sayi $p.A).`r`n`r`nÖnce TAKIM sekmesinde 'Sensör' ile sensörün üstüne git (A doğru açıya gelir), sonra X/Y ile ortala." 'Sensör kaydet' 'OK' 'Warning') | Out-Null
        return
    }
    $eX = [Eding]::CncGetVariable(4020); $eY = [Eding]::CncGetVariable(4021)
    $m = "İş mili şu an frez boyu sensörünün tam ortasında mı?`r`n`r`nYeni sensör konumu:  X $(Sayi $p.X)   Y $(Sayi $p.Y)`r`n(eski: X $(Sayi $eX)   Y $(Sayi $eY))`r`n`r`n" +
         "Frez yuvaları ve G54 (disk sıfırı) değişmez.`r`nKaydedilsin mi?"
    if (-not (Onay $m 'Sensör kaydet')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $ok = (Degisken-Yaz 4020 $p.X) -and (Degisken-Yaz 4021 $p.Y)
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz "Sensör kaydedildi: X $(Sayi $p.X) Y $(Sayi $p.Y)"
        (Ui-Kutu "Sensör kaydedildi. Bir sonraki frez ölçümünde kullanılır.`r`n`r`nÖnemli: sensör yeri değiştiği için bir sonraki frez değişiminde boy yeniden ölçülecek. İlk kazımadan önce bir frez değişimi (örneğin T1 M6) yap." 'Sensör kaydet' 'OK' 'Information') | Out-Null
    } else {
        (Ui-Kutu "Kaydetme tamamlanamadı. Eding hazır durumda mı?" 'Sensör kaydet' 'OK' 'Warning') | Out-Null
    }
}

function Konumu-Yuva-Yap([int]$n) {
    if (-not (Hazir-Hareket "T$n kaydet")) { return }
    $p = [Eding]::MachinePos()
    $eskiY = [Eding]::CncGetVariable(4010 + $n)
    $yaklas = [Eding]::CncGetVariable(4001)
    if ($n -eq 1) {
        $dy = if ($eskiY -ne 0) { $p.Y - $eskiY } else { 0 }
        $m = "İş mili şu an T1'in tam ortasında ve kol düz mü?`r`n`r`n" +
             "Kaydedilecek (makine koordinatı):`r`n   Yuva X $(Sayi $p.X)    T1 Y $(Sayi $p.Y)    A $(Sayi $p.A)    B $(Sayi $p.B)`r`n`r`n" +
             "X, A ve B bütün yuvalarda ortaktır.`r`n" +
             "EVET: T2-T6 da aynı miktarda kaysın (Y farkı $(Sayi $dy) mm, yuva aralıkları korunur)`r`n" +
             "HAYIR: sadece T1 kaydedilsin`r`nİPTAL: vazgeç"
        $c = (Ui-Kutu $m 'T1 kaydet' 'YesNoCancel' 'Question')
        if ("$c" -eq 'Cancel') { return }
        $hepsi = ("$c" -eq 'Yes')
    } else {
        $m = "İş mili şu an T$n yuvasının tam ortasında mı?`r`n`r`nT$n Y = $(Sayi $p.Y)   (eski: $(Sayi $eskiY))`r`n`r`n" +
             "Not: X, A, B ortaktır ve T1 kaydedilirken alınır. Şu anki X $(Sayi $p.X), A $(Sayi $p.A), B $(Sayi $p.B).`r`nKaydedilsin mi?"
        if (-not (Onay $m "T$n kaydet")) { return }
    }
    $zDe = $false
    if ($p.Z -lt ($yaklas - 3)) {
        $zDe = Onay "İş mili alma yüksekliğinde görünüyor (Z $(Sayi $p.Z)).`r`nBu Z, alma yüksekliği (#4000) olarak da kaydedilsin mi?`r`nBırakma 1 mm yukarıda yapılır." "T$n kaydet"
    }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    if ($n -eq 1) {
        $ok = (Degisken-Yaz 4010 $p.X) -and (Degisken-Yaz 4011 $p.Y) -and (Degisken-Yaz 4017 $p.A) -and (Degisken-Yaz 4018 $p.B)
        if ($ok -and $hepsi) {
            for ($k = 2; $k -le 6; $k++) {
                $eski = [Eding]::CncGetVariable(4010 + $k)
                $yeni = if ($eski -ne 0 -and $eskiY -ne 0) { $eski + ($p.Y - $eskiY) } else { $p.Y + $RafAralik[$k] }
                if ($ok) { $ok = (Degisken-Yaz (4010 + $k) $yeni) }
            }
        }
    } else {
        $ok = (Degisken-Yaz (4010 + $n) $p.Y)
    }
    if ($ok -and $zDe) { $ok = (Degisken-Yaz 4000 $p.Z) }
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz "T$n kaydedildi. $((Raf-Metni) -replace "`r`n", '  ·  ')"
        (Ui-Kutu "T$n kaydedildi. Bir sonraki frez değişiminde kullanılır (Eding'i yeniden başlatmak gerekmez).`r`n`r`n$(Raf-Metni)" "T$n kaydet" 'OK' 'Information') | Out-Null
    } else {
        (Ui-Kutu "Kaydetme tamamlanamadı. Eding hazır durumda mı (çalışmıyor, hata yok)?" "T$n kaydet" 'OK' 'Warning') | Out-Null
    }
}

function Z-Alma-Yap {
    if (-not (Hazir-Hareket 'Alma yüksekliği')) { return }
    $p = [Eding]::MachinePos()
    if (-not (Onay "Şu anki Z ($(Sayi $p.Z)) frezeyi alma yüksekliği (#4000) olarak kaydedilsin mi?`r`nPens bu yükseklikte frezeyi kavrar." 'Alma yüksekliği')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04
    if (Komut-Sonucu '#4000' ([Eding]::CncRunSingleLine("#4000=$(Sayi $p.Z)"))) { Start-Sleep -Milliseconds 500; Ayar-Oku }
}

function G54-Uretici-Fark {
    $f = @()
    foreach ($k in $UreticiG54.Keys) {
        $nr = @{ X = 5221; Y = 5222; Z = 5223; A = 5224; B = 5225 }[$k]
        $v = [Eding]::CncGetVariable($nr)
        if ([math]::Abs($v - $UreticiG54[$k]) -gt 0.01) { $f += "$k $(Sayi $v) (üretici $(Sayi $UreticiG54[$k]))" }
    }
    return $f
}

function G54-Ureticiye-Don {
    if (-not (Hazir-Hareket 'Üretici disk kalibrasyonu')) { return }
    $fark = G54-Uretici-Fark
    $g92 = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    if ($fark.Count -eq 0 -and $g92.Count -eq 0) { (Ui-Kutu 'G54 zaten üretici değerlerinde, G92 kaydırması da yok.' 'Üretici kalibrasyonu' 'OK' 'Information') | Out-Null; return }
    $m = "Disk sıfırı (G54) makinenin kendi cnc.ini dosyasındaki ÜRETİCİ değerlerine dönecek:`r`n`r`n" +
         "X $(Sayi $UreticiG54.X)   Y $(Sayi $UreticiG54.Y)   Z $(Sayi $UreticiG54.Z)   A $(Sayi $UreticiG54.A)   B $(Sayi $UreticiG54.B)`r`n`r`n" +
         "Şu an farklı olanlar:`r`n" + $(if ($fark.Count) { ($fark -join "`r`n") } else { '(yok)' }) + "`r`n`r`n" +
         "G92 kaydırmaları da sıfırlanır (frez boyu bir sonraki frez değişiminde yeniden ölçülür).`r`n" +
         "Frez yuvaları değişmez. Önce otomatik yedek alınır. Devam?"
    if (-not (Onay $m 'Üretici kalibrasyonu')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: yedek yoksa yazma yok
    $ok = Komut-Sonucu 'G54 üretici' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $UreticiG54.X) Y$(Sayi $UreticiG54.Y) Z$(Sayi $UreticiG54.Z) A$(Sayi $UreticiG54.A) B$(Sayi $UreticiG54.B)"))
    if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) { $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')) }
    if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) {
        $sx = $UreticiG54.X - 72.25; $sy = $UreticiG54.Y
        if (Onay "Frez boyu sensörü de üreticinin konumuna dönsün mü?`r`n(X $(Sayi $sx)  Y $(Sayi $sy), şu an X $(Sayi ([Eding]::CncGetVariable(4020)))  Y $(Sayi ([Eding]::CncGetVariable(4021))))`r`n`r`nSensör ölçümü G54 A açısında yapıldığı için üretici A ile birlikte önerilir." 'Üretici kalibrasyonu') {
            $ok = (Degisken-Yaz 4020 $sx) -and (Degisken-Yaz 4021 $sy)
        }
    }
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz 'Disk sıfırı üretici değerlerine döndü.'
        (Ui-Kutu "Disk sıfırı üretici değerlerine döndü.`r`n`r`nŞimdi:`r`n1. Bir frez değişimi yap (frez boyu yeniden ölçülsün)`r`n2. Bir deneme bloğu kaz ve iki yüzü kontrol et`r`n`r`nBeğenmezsen: KALİBRASYON > Yedekten yükle ile eski hale dönersin." 'Üretici kalibrasyonu' 'OK' 'Information') | Out-Null
    }
}

function G92-Sifirla {
    if (-not (Hazir-Hareket 'G92 sıfırla')) { return }
    if (-not (Onay "Tüm G92 kaydırmaları sıfırlanacak (G92.1).`r`nTakım boyu ölçümü de silinir; bir sonraki takım değişiminde yeniden ölçülür. Devam?" 'G92 sıfırla')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04
    if (Komut-Sonucu 'G92 sıfırla (G92.1)' ([Eding]::CncRunSingleLine('G92.1'))) { Start-Sleep -Milliseconds 400; Ayar-Oku }
}

# KL-04: yalnız dosya yazılıp geri okunabildiyse $true döner; G54 / #4000-#4199 yazan her işlem $false'ta hiçbir şey yazmadan durur.
# Yedekte G92 kaydırmaları (#5211-#5215) da bulunur (yalnız bilgi; Yedekten yükle G92'yi geri yazmaz).
function Ayar-Yedekle([bool]$sessiz = $false) {
    if (-not (Baglan)) {
        Yaz 'Ayar yedeği alınamadı: Eding bağlı değil.'
        (Ui-Kutu "Ayar yedeği alınamadı: Eding'e bağlanılamadı.`r`nHiçbir ayar değiştirilmedi." 'Yedekle' 'OK' 'Warning') | Out-Null
        return $false
    }
    $dosya = [System.IO.Path]::Combine($YedekKlasoru, 'ayar_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.txt')
    try {
        [void][System.IO.Directory]::CreateDirectory($YedekKlasoru)
        $satirlar = @("; PrimerMill ayar yedeği  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  Eding: $EdingKlasor")
        foreach ($nr in @(5221, 5222, 5223, 5224, 5225) + @($ParamTanim.Keys | ForEach-Object { [int]$_ }) + @($RafTanim.Keys | ForEach-Object { [int]$_ }) + @(5161, 5162, 5163, 5164, 5165, 5181, 5182, 5183, 5184, 5185) + @(5211, 5212, 5213, 5214, 5215)) {
            $satirlar += "#$nr=$(Sayi ([Eding]::CncGetVariable($nr)))"
        }
        [System.IO.File]::WriteAllLines($dosya, [string[]]$satirlar, (New-Object System.Text.UTF8Encoding($false)))
        $geri = [System.IO.File]::ReadAllLines($dosya, [System.Text.Encoding]::UTF8)
        if (($geri -join "`n") -ne ($satirlar -join "`n")) { throw 'yazılan dosya geri okunduğunda farklı' }
    } catch {
        Yaz "Ayar yedeği ALINAMADI: $($_.Exception.Message)"
        (Ui-Kutu "Ayar yedeği alınamadı:`r`n$($_.Exception.Message)`r`n`r`n$dosya`r`n`r`nHiçbir ayar değiştirilmedi." 'Yedekle' 'OK' 'Error') | Out-Null
        return $false
    }
    Yaz "Ayarlar yedeklendi: $dosya"
    if (-not $sessiz) { (Ui-Kutu "Ayarlar yedeklendi:`r`n$dosya" 'Yedekle' 'OK' 'Information') | Out-Null }
    return $true
}

function Ayar-Geri-Yukle {
    if (-not (Hazir-Hareket 'Yedekten yükle')) { return }
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.InitialDirectory = $YedekKlasoru; $dlg.Filter = 'Ayar yedeği (*.txt)|*.txt'
    $script:ModalSayac++; try { $sn = $dlg.ShowDialog($form) } finally { $script:ModalSayac-- }
    if ($sn -ne 'OK') { return }
    $d = @{}
    foreach ($l in [System.IO.File]::ReadAllLines($dlg.FileName)) {
        $m = [regex]::Match($l, '^#(\d+)=(-?[0-9.]+)')
        if ($m.Success) { $d[[int]$m.Groups[1].Value] = $m.Groups[2].Value }
    }
    if (-not ($d.ContainsKey(5221) -and $d.ContainsKey(5225))) { (Ui-Kutu 'Dosya geçerli bir ayar yedeği değil.' 'Yedekten yükle' 'OK' 'Warning') | Out-Null; return }
    $m = "Yedekten yüklenecek (G54 ve takım değiştirici parametreleri):`r`n`r`nG54  X $($d[5221])  Y $($d[5222])  Z $($d[5223])  A $($d[5224])  B $($d[5225])`r`n" +
         (($ParamTanim.Keys | Where-Object { $d.ContainsKey([int]$_) } | ForEach-Object { "#$_ = $($d[[int]$_])" }) -join '   ') + "`r`n`r`nDevam?"
    if (-not (Onay $m 'Yedekten yükle')) { return }
    if (-not (Ayar-Yedekle $true)) { return }   # KL-04: şu anki değerler de yedeklenir
    $ok = (Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$($d[5221]) Y$($d[5222]) Z$($d[5223]) A$($d[5224]) B$($d[5225])")))
    foreach ($nr in @($ParamTanim.Keys) + @($RafTanim.Keys)) { if ($ok -and $d.ContainsKey([int]$nr)) { $ok = (Komut-Sonucu "#$nr" ([Eding]::CncRunSingleLine("#$nr=$($d[[int]$nr])"))) } }
    Start-Sleep -Milliseconds 500; Ayar-Oku
}

function Ilerleme-Guncelle([bool]$calisiyor, [bool]$durakli) {
    $a = $script:Analiz
    # Takip erken bırakıldıysa (iş aslında sürüyorsa) kendiliğinden yeniden başla
    if (-not $script:IsAktif -and $a -and $a.Toplam -gt 0 -and $script:TakipSonu -eq 'durdu' -and $calisiyor) {
        $h0 = [Eding]::CncGetCurExecLine()
        if ($h0 -ge 1 -and $h0 -le $a.Kumulatif.Length -and $h0 -gt $script:SonGecerliSatir) {
            [Kayit]::Yaz("İLERLEME: iş sürüyor (satır $h0), bar ve simülasyon takibi yeniden başladı")
            $script:IsAktif = $true; $script:SonTik = Get-Date; $script:TakipSonu = ''; $script:BitisSayac = 0
        }
    }
    if (-not $script:IsAktif -or -not $a -or $a.Toplam -le 0) { return }

    $simdi = Get-Date
    # Manuel frez değişiminde Eding M0'da bekler; durum yazısı ne olursa olsun iş bitmiş sayılmaz
    $manuelBekliyor = $false; try { $manuelBekliyor = ($null -ne (Manuel-Istek)) } catch { }
    if ($manuelBekliyor) { $durakli = $true }
    if ($calisiyor -or $durakli) { $script:CalistiGoruldu = $true; $script:BitisSayac = 0 }
    if ($calisiyor -and -not $durakli -and $script:SonTik) { $script:Gecen += ($simdi - $script:SonTik) }
    $script:SonTik = $simdi

    # Eding'in bildirdiği satır: makro (takım değişimi vb.) sırasında geçersiz olabilir
    $ham = [Eding]::CncGetCurExecLine()
    $toplamSatir = $a.Kumulatif.Length
    $maxAtlama = [math]::Max(5000, [int]($toplamSatir * 0.03))
    if ((Eding-Durum) -ne 'RUN-SUB' -and $ham -ge 1 -and $ham -le $toplamSatir -and
        $ham -ge $script:SonGecerliSatir) {
        if (($ham - $script:SonGecerliSatir) -le $maxAtlama) { $script:SonGecerliSatir = $ham; $script:AdaySayac = 0 }
        else {
            # Büyük sıçrama: 3 saniye boyunca ileri gitmeye devam ederse gerçektir (örn. panel iş sırasında açıldı)
            if ($ham -gt $script:AdayHam) { $script:AdaySayac++ } else { $script:AdaySayac = 0 }   # sabit kalan sahte değeri kabul etme
            $script:AdayHam = $ham
            if ($script:AdaySayac -ge 3) { $script:SonGecerliSatir = $ham; $script:AdaySayac = 0 }
        }
    }
    $satir = $script:SonGecerliSatir
    $sim.SetLine($satir)
    if ($simForm.Visible) { $simBuyuk.SetLine($satir) }
    $i = [math]::Max(0, [math]::Min($a.Kumulatif.Length - 1, $satir - 1))
    $yapilan = $a.Kumulatif[$i]
    $yuzde = 100.0 * $yapilan / $a.Toplam

    $kalan = $a.Toplam - $yapilan
    if (($calisiyor -or $durakli) -and ($simdi - $script:DevamSonYazma).TotalSeconds -ge 2) { Devam-Kaydet $satir 'calisiyor' $yuzde }
    if ($yapilan -gt 60 -and $script:Gecen.TotalSeconds -gt 60) {
        $oran = [math]::Max(0.3, [math]::Min(5.0, $script:Gecen.TotalSeconds / $yapilan))
        $kalan = $kalan * $oran
    }

    # Teşhis: 30 sn'de bir ilerleme kaydı
    if (-not $script:SonIlerlemeIz -or ($simdi - $script:SonIlerlemeIz).TotalSeconds -ge 30) {
        $script:SonIlerlemeIz = $simdi
        [Kayit]::Yaz("İLERLEME-İZ: durum=$(Eding-Durum) ham=$ham geçerli=$satir / $toplamSatir  yüzde=$([math]::Round($yuzde,1))  manuelBekliyor=$manuelBekliyor")
    }

    if (-not $calisiyor -and -not $durakli) {
        if (-not $script:CalistiGoruldu -and ($simdi - $script:BaslamaAni).TotalSeconds -lt 20) { return }
        # Hemen "bitti" deme: Eding 5 sn boyunca çalışmıyorsa iş gerçekten bitmiş/durmuştur
        $script:BitisSayac++
        $sonDurum0 = Eding-Durum
        if ($script:BitisSayac -lt 5 -and -not (Hatali $sonDurum0) -and $sonDurum0 -ne 'ABORTED') {
            $bar.Value = $yuzde
            return
        }
        [Kayit]::Yaz("İLERLEME: iş sonu algılandı (durum=$sonDurum0, satır $satir / $toplamSatir, yüzde $([math]::Round($yuzde,1)))")
        $script:BitisSayac = 0
        $script:IsAktif = $false
        $script:TakipSonu = if ($yuzde -gt 97) { 'tamam' } else { 'durdu' }
        $sonDurum = Eding-Durum
        $disHata = $false; try { $disHata = ([Eding]::CncGetEMStopActive() -ne 0) } catch { }
        if ($yuzde -gt 97 -and -not (Hatali $sonDurum) -and -not $disHata) { Devam-Sil; $script:DevamHarita = $null }
        else { Devam-Kaydet $satir $(if ((Hatali $sonDurum) -or $disHata) { 'hata' } else { 'durduruldu' }) $yuzde; Yaz 'İş yarım kaldı: kaldığı yerden devam için BAŞLAT''a bas (aynı dosya seçiliyken).' }
        if ($disHata -and -not [Eding]::AcilKilit) {
            $bar.Dancing = $false; $lblSure.Text = 'Makine hata sinyali (EXTERR)  ·  basıncı kontrol et, RESET'; $lblSure.ForeColor = $cKirmizi
            Yaz "Kazıma makinenin hata sinyaliyle (EXTERR / acil stop) durdu, satır $satir. En sık sebep: hava basıncı düşük."
            (Ui-Kutu "Kazıma makinenin HATA SİNYALİYLE durdu (EXTERR).`r`n`r`nEn sık sebep: hava basıncı düşük (kompresör kapalı ya da basınç yetersiz).`r`nDiğerleri: iş mili sürücüsü hatası, acil stop butonu.`r`n`r`n1. Kompresörü / basıncı kontrol et.`r`n2. RESET'e bas.`r`n3. BAŞLAT → KALDIĞI YERDEN DEVAM." 'Makine hatası' 'OK' 'Error') | Out-Null
            return
        }
        if (Hatali $sonDurum) {
            $script:IsAktif = $false; $bar.Dancing = $false
            $lblSure.Text = 'Eding hatası ile durdu'
            $lblSure.ForeColor = $cKirmizi
            $fark = [Eding]::CncGetVariable(4099); $sinir = [Eding]::CncGetVariable(4005); $tk = [Eding]::CncGetCurrentToolNumber()
            if ($fark -gt $sinir -and $sinir -gt 0) {
                $lblSure.Text = "Freze hatası  ·  T$tk"
                Yaz "FREZE HATASI: T$tk boyu $(Sayi $fark) mm değişmiş (sınır $(Sayi $sinir) mm), satır $satir. Kazıma durduruldu."
                (Ui-Kutu "FREZE HATASI`r`n`r`nT$tk frezesinin boyu iş sonrası ölçümde $(Sayi $fark) mm değişmiş (izin verilen: $(Sayi $sinir) mm).`r`nFreze kırılmış, aşınmış ya da pensin içinde kaymış olabilir.`r`n`r`nKazıma bir sonraki frezeye geçmeden durduruldu.`r`n`r`n1. Frezeyi kontrol et, gerekirse değiştir.`r`n2. RESET'e bas.`r`n3. Parçayı kontrol et; kaldığı yerden devam için Eding'de satır arama gerekir." 'Freze hatası' 'OK' 'Error') | Out-Null
                return
            }
            Yaz "Kazıma Eding hatasıyla durdu ($sonDurum), satır $satir. Hatanın açıklaması Eding penceresinin mesaj kısmında yazar."
            (Ui-Kutu "Kazıma Eding hatasıyla durdu (satır $satir).`r`n`r`nHatanın açıklaması Eding penceresinin alt kısmındaki mesajlarda yazar (Ayarlar › PANEL › Eding penceresini göster).`r`nSık sebep: Eding, macro.cnc değiştirildikten sonra yeniden başlatılmadı.`r`n`r`nDevam etmek için RESET'e bas." 'Eding hatası' 'OK' 'Error') | Out-Null
            return
        }
        if ($yuzde -gt 97) {
            $bar.Value = 100; $bar.Caption = ''; $bar.Dancing = $true
            $lblSure.Text = "Tamamlandı  ·  $(Sade-Sure $script:Gecen.TotalSeconds)"
            Yaz "Kazıma tamamlandı. Süre: $(Sure $script:Gecen.TotalSeconds)"
        } else {
            $bar.Dancing = $false
            $lblSure.Text = 'Durdu'
            Yaz "Kazıma durdu (satır $satir)."
        }
        return
    }
    $bar.Value = $yuzde
    $bar.Caption = ''
    $dilim = [math]::Floor($yuzde / 5) * 5
    if ($dilim -ne $script:SonYuzdeLog) { $script:SonYuzdeLog = $dilim; [Kayit]::Yaz("İLERLEME: %$dilim  satır $satir  geçen $(Sure $script:Gecen.TotalSeconds)  kalan ~$(Sure $kalan)") }
    $bar.Dancing = ($calisiyor -and -not $durakli)
    $lblSure.ForeColor = $cSoluk
    $bitis = (Get-Date).AddSeconds($kalan).ToString('HH:mm')
    $gecenTxt = Sade-Sure $script:Gecen.TotalSeconds
    $lblSure.Text = if ($durakli) { "Duraklatıldı   ·   Kazıma  $gecenTxt" } else { "Kazıma  $gecenTxt   ·   Kalan  $(Sade-Sure $kalan)   ·   Bitiş  $bitis" }
    $script:DetayIlerleme = "Satır: $satir / $($a.Kumulatif.Length)   ·   Geçen: $(Sure $script:Gecen.TotalSeconds)   ·   Kalan (tahmini): $(Sure $kalan)"
}

$script:DetayIlerleme = ''
$script:SonYuzdeLog = -1
$script:SonGecerliSatir = 0
$script:AdayHam = 0
$script:AdaySayac = 0
$script:SonEdingDurum = ''
