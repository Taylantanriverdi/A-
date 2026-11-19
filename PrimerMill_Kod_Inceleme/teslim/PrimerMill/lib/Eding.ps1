# Eding.ps1 - Eding CNC bağlantısı: durum okuma, bağlanma, bekçi, komut sonucu, hareket bekleme, makro sürümü,
# Eding programını başlatma / gizleme / yeniden başlatma, Windows başlangıç kayıtları.
# Fonksiyonlar düzeltilmiş eski panelden BİREBİR taşındı; değişenler tests/TASIMA_DEGISEN.txt içinde gerekçeli.
# [Eding] sınıfı önyüklemede yüklenir: gerçek (lib/EdingApi.cs, cncapi.dll) ya da demo (lib/EdingSim.cs).
# PowerShell 5.1 (32 bit) uyumlu.

# ---------------- Eding API (cncapi.dll, stdcall) ----------------
$script:ApiHazir = $false
$script:Bagli    = $false

# ---------------- Eding'i otomatik başlat ----------------
$AyarDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'ayarlar.txt')

function Eding-Exe-Bul {
    # 1) Daha önce kaydedilen yol
    if ([System.IO.File]::Exists($AyarDosyasi)) {
        $kayitli = ([System.IO.File]::ReadAllText($AyarDosyasi)).Trim()
        if ($kayitli -and [System.IO.File]::Exists($kayitli) -and $kayitli.StartsWith($EdingKlasor, [System.StringComparison]::OrdinalIgnoreCase)) { return $kayitli }
    }
    # 2) Eding klasöründe arayüz programını ara (sunucu ve kurulum dosyaları hariç)
    $aday = [System.IO.Path]::Combine($EdingKlasor, 'cnc.exe')
    if ([System.IO.File]::Exists($aday)) { return $aday }
    $exeler = @(Get-ChildItem -LiteralPath $EdingKlasor -Filter '*.exe' -ErrorAction Ignore |
        Where-Object { $_.Name -notmatch '(?i)server|setup|unins|update|install|driver|vcredist|python|notepad' })
    if ($exeler.Count -eq 1) { return $exeler[0].FullName }
    # 3) Bulunamazsa bir kez kullanıcıya sor
    $script:ModalSayac++; try { $sec = Ui-Dosya-Ac 'Eding CNC programını seç (bir kez sorulur)' 'Programlar (*.exe)|*.exe' $EdingKlasor } finally { $script:ModalSayac-- }
    if ($sec) { return $sec }
    return $null
}

$script:EdingExeAd = 'cnc'
try { if ([System.IO.File]::Exists($AyarDosyasi)) { $kx = ([System.IO.File]::ReadAllText($AyarDosyasi)).Trim(); if ($kx) { $script:EdingExeAd = [System.IO.Path]::GetFileNameWithoutExtension($kx) } } } catch { }
function Eding-Pencere-Acik { return [bool](Get-Process -Name $script:EdingExeAd -ErrorAction Ignore) }
function Eding-Sunucu-Acik { return [bool](Get-Process -Name 'CncServer' -ErrorAction Ignore) }

# Pencere olmadan kalan sunucuyu temizle (önceki oturumdan kalan, POWERUP'ta takılı sunucu)
function Eding-Temizle {
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    $kill = [System.IO.Path]::Combine($EdingKlasor, 'KillCNC.exe')
    if ([System.IO.File]::Exists($kill)) {
        Yaz 'Eding: geride kalan sunucu kapatılıyor (KillCNC).'
        Start-Process -FilePath $kill -WorkingDirectory $EdingKlasor -Wait -WindowStyle Hidden
    } else {
        Get-Process -Name 'CncServer' -ErrorAction Ignore | ForEach-Object { try { $_.Kill() } catch { } }
    }
    Start-Sleep -Seconds 1
}

$script:EdingGosteriliyor = $false
function Eding-Kapat-Nazik {
    foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction Ignore)) {
        $n = 0; try { $n = [Pencere]::Kapat($pr.Id) } catch { }
        if ($n -eq 0) { try { $pr.CloseMainWindow() | Out-Null } catch { } }
    }
}

function Eding-Gizle-Tik {
    if ($script:Tercih.EdingGizli -eq '0' -or $script:EdingGosteriliyor) { return }
    try {
        foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction Ignore)) {
            $n = [Pencere]::Gizle($pr.Id)
            [void][Pencere]::UyarilariOneAl($pr.Id)
            if ($n -gt 0) {
                if (-not $script:EdingGizlendiYazildi) {
                    [Kayit]::Yaz("EDING: pencere arka plana alındı: $([Pencere]::SonGizlenen)  (panel yönetici: $script:Yonetici)")
                    if ([Pencere]::Gizlenemedi) { Yaz "Eding penceresi gizlenemedi $([Pencere]::Gizlenemedi): YoneticiKurulum.bat bir kez çalıştırılmalı. PrimerMill yine de en önde kalır." }
                    $script:EdingGizlendiYazildi = $true
                }
                # Eding öne çıkmışsa panel tekrar öne gelsin
                # Açık bir soru penceresi (blok, frez modu vb.) varsa onu öne al; paneli değil (yoksa pencere tıklanamaz olur)
                try { Ui-One-Al } catch { }
            }
        }
    } catch { }
}

function Eding-Baslat {
    if (-not $MakineBilgisayari) { return }
    if (Eding-Pencere-Acik) { return }   # zaten açık
    if (Eding-Sunucu-Acik) { Eding-Temizle }
    $exe = Eding-Exe-Bul
    if (-not $exe) { Yaz "Eding CNC programı bulunamadı; elle açın."; return }
    try { [System.IO.File]::WriteAllText($AyarDosyasi, $exe) } catch { }
    $script:EdingExeAd = [System.IO.Path]::GetFileNameWithoutExtension($exe)
    $script:SonEdingBaslatma = Get-Date
    Yaz "Eding CNC başlatılıyor: $exe"
    $script:EdingGizlendiYazildi = $false
    $stil = if ($script:Tercih.EdingGizli -ne '0' -and -not $script:EdingGosteriliyor) { 'Hidden' } else { 'Minimized' }
    Start-Process -FilePath $exe -WorkingDirectory ([System.IO.Path]::GetDirectoryName($exe)) -WindowStyle $stil
    $script:MakroYamaBekliyor = $false   # Eding yeni açıldı: macro.cnc baştan okunur
    $script:MakroKontrolTamam = $false
}

# Eding durumu: IDLE, READY, ABORTED, RUNNING, AXISJOG, IPJOG, SEARCHING, PAUSE
# Açılışta: Eding açıksa kapat (iş yapmıyorsa), 15 sn bekle, temiz aç
function Acilis-Eding-Sifirla {
    if (-not $MakineBilgisayari) { return }
    if ((Eding-Pencere-Acik) -or (Eding-Sunucu-Acik)) {
        if ((Eding-Pencere-Acik) -and (Eding-Sunucu-Acik) -and (Baglan)) {
            $d = Eding-Durum
            if ((Mesgul $d) -or $d -eq 'PAUSE') {
                Yaz "Açılış: Eding şu an çalışıyor ($d), sıfırlanmadı."
                return
            }
        }
        Yaz 'Açılış: Eding kapatılıyor (sıfırlama)...'
        Durum-Yaz 'Eding sıfırlanıyor...' $cAltinAc
        try { [void][Eding]::CncDisConnectServer() } catch { }
        $script:Bagli = $false
        Eding-Kapat-Nazik
        $son = (Get-Date).AddSeconds(10)
        while ((Eding-Pencere-Acik) -and (Get-Date) -lt $son) { Ui-Olaylar; Start-Sleep -Milliseconds 200 }
        Get-Process -Name $script:EdingExeAd -ErrorAction Ignore | ForEach-Object { try { $_.Kill() } catch { } }
        Eding-Temizle
    }
    for ($i = 15; $i -ge 1; $i--) {
        Durum-Yaz "Eding $i sn sonra açılacak..." $cAltinAc
        $son = (Get-Date).AddSeconds(1)
        while ((Get-Date) -lt $son) { Ui-Olaylar; Start-Sleep -Milliseconds 100 }
    }
    Yaz 'Açılış: Eding açılıyor.'
    Durum-Yaz 'Eding açılıyor...' $cAltinAc
    $script:EdingBirKezBaglandi = $false   # açılıştaki bilinçli sıfırlama: hâlâ "ilk açılış" sayılır
}

function Eding-Durum { try { return ([Eding]::StateText([Eding]::CncGetState())).Trim().ToUpper() } catch { return '' } }
function Durakli-Mi { return ((Eding-Durum) -like 'PAUSE*') }
# Görülen durumlar: IDLE, READY, ABORTED, RUNNING, RUN-SUB, SEARCHING, AXISJOG, IPJOG, PAUSE, INT-ERR
function Mesgul([string]$d) { return ($d -like 'RUN*' -or @('SEARCHING', 'AXISJOG', 'IPJOG') -contains $d) }
function Hatali([string]$d) { return ($d -like '*ERR*') }
function Calisiyor-Mu { return (Mesgul (Eding-Durum)) }
# K1 (GV-01): duraklatılmış iş de "sürüyor" sayılır. İş sürerken ya da duraklıyken yalnız DEVAM, DURDUR, ACİL STOP ve hız serbest;
# jog, M6, pens, MDI, G54/#4000-#4199 yazma, iş yükleme, Eding'i yeniden başlatma yasak (iş mili duraklamada dönmeye devam eder).
function Is-Suruyor {
    if ($script:IsAktif) { return $true }
    if (-not $script:ApiHazir -or -not $script:Bagli) { return $false }
    $d = Eding-Durum
    if ((Mesgul $d) -or $d -like 'PAUSE*') { return $true }
    try { if ([Eding]::CncGetPauseStatus() -ne 0) { return $true } } catch { }
    return $false
}
function Is-Suruyor-Uyari([string]$islem) {
    if (-not (Is-Suruyor)) { return $false }
    [Kayit]::Yaz("ENGEL: '$islem' iş sürerken / duraklıyken reddedildi")
    (Ui-Kutu "Bir iş çalışıyor ya da DURAKLATILMIŞ bekliyor.`r`n`r`nİş sürerken ve duraklıyken yalnız DEVAM, DURDUR, ACİL STOP ve hız ayarı kullanılabilir (duraklamada iş mili dönmeye devam eder).`r`nBu işlem için önce işin bitmesini bekle ya da DURDUR." $islem 'OK' 'Warning') | Out-Null
    return $true
}

# Eding hata ya da iptal durumundaysa komut kabul etmez: önce sıfırla
function Hata-Temizle([string]$islem) {
    $d = Eding-Durum
    if ((Hatali $d) -or $d -eq 'ABORTED') {
        Yaz "$islem : Eding '$d' durumunda, sıfırlanıyor: $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800
    }
}

# ---------------- Bağlantı bekçisi ----------------
$script:SonSunucuKontrol = [datetime]::MinValue
$script:SonEdingBaslatma = [datetime]::MinValue
$script:PowerupBas = $null
function Baglanti-Bekcisi {
    if (-not $script:ApiHazir) { return }
    if (((Get-Date) - $script:SonSunucuKontrol).TotalSeconds -lt 2) { return }
    $script:SonSunucuKontrol = Get-Date
    $pencere = Eding-Pencere-Acik
    $sunucu = Eding-Sunucu-Acik
    if ($pencere -and $sunucu) {
        # POWERUP'ta takılı kalırsa yeniden başlat
        if ($script:Bagli -and (Eding-Durum) -eq 'POWERUP') {
            if ($null -eq $script:PowerupBas) { $script:PowerupBas = Get-Date }
            elseif (((Get-Date) - $script:PowerupBas).TotalSeconds -gt 30) {
                Yaz 'Eding 30 sn POWERUP durumunda kaldı, yeniden başlatılıyor.'
                $script:PowerupBas = $null
                Eding-Kapat-Nazik
                Start-Sleep -Seconds 2
                Eding-Temizle
                $script:SonEdingBaslatma = [datetime]::MinValue
            }
        } else { $script:PowerupBas = $null }
        if ($script:Bagli) { return }
        return
    }
    if ($script:Bagli) {
        Yaz 'Eding kapandı: bağlantı kesildi.'
        try { [void][Eding]::CncDisConnectServer() } catch { }
        $script:Bagli = $false
        $script:MakroKontrolTamam = $false
        if ($script:IsAktif) { $script:IsAktif = $false; $script:SureMetni = 'Eding kapandı'; $script:SureTur = $cKirmizi }
    }
    if (((Get-Date) - $script:SonEdingBaslatma).TotalSeconds -ge 30) {
        # İlk açılışta Eding'i başlatan da burası; panel açıldıktan sonra kapanıp yeniden açılan Eding için otomatik home yok (GV-09)
        if ($script:EdingBirKezBaglandi) { $script:AcilisYeniden = $true }
        Eding-Baslat
        if ($script:Tercih.OtomatikHazirlik -eq '1') { $script:AcilisDurum = 'bekliyor' }
    }
}

function Rc-Tamam([int]$rc) { return ($rc -eq 0 -or $rc -eq 7) }

function Baglan {
    if (-not $script:ApiHazir) { return $false }
    if ($script:Bagli) { return $true }
    # Sunucu kapalıysa bağlanma; yoksa DLL Eding'i arayüzsüz başlatabilir
    if (-not (Eding-Sunucu-Acik)) { return $false }
    if (-not (Eding-Pencere-Acik)) { return $false }
    try {
        $rc = [Eding]::CncConnectServer('')
        # 0 = OK, 6 = sunucu zaten çalışıyor, 7 = zaten bağlı: hepsi bağlantı demek
        $script:Bagli = ($rc -eq 0 -or $rc -eq 6 -or $rc -eq 7)
        if ($script:Bagli) { $script:EdingBirKezBaglandi = $true }
        if (-not $script:Bagli) { Yaz ("Eding'e bağlanılamadı: " + [Eding]::RCText($rc)) }
    } catch { Yaz "Bağlantı hatası: $($_.Exception.Message)"; $script:Bagli = $false }
    return $script:Bagli
}

function Komut-Sonucu([string]$ad, [int]$rc) {
    if (Rc-Tamam $rc) { Yaz "$ad : tamam"; return $true }
    if ([Eding]::AcilKilit) {
        Yaz "$ad : ACİL STOP basılı, komut gönderilmedi."
        (Ui-Kutu "ACİL STOP basılı. Komut gönderilmedi.`r`n`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas." 'Acil stop' 'OK' 'Warning') | Out-Null
        return $false
    }
    $t = [Eding]::RCText($rc)
    Yaz "$ad : HATA ($t)"
    (Ui-Kutu "$ad başarısız:`r`n$t" 'Kazıma Paneli' 'OK' 'Error') | Out-Null
    return $false
}

# ED-02: durum okunamazsa ('' = bağlantı koptu / API hatası), Eding hata verirse ya da süre dolarsa $false döner;
# "bitti" yalnız Eding açıkça meşgul değil ve hatasız durumdayken sayılır. Güvenlik kararı veren her çağıran $false'ta durmalı.
function Hareket-Bitene-Kadar-Bekle([int]$saniye) {
    $son = (Get-Date).AddSeconds($saniye)
    Start-Sleep -Milliseconds 400
    while ((Get-Date) -lt $son) {
        Ui-Olaylar
        $d = Eding-Durum
        if ($d -eq '') { Yaz 'Eding durumu okunamadı (bağlantı koptu?): hareket bitti sayılmadı.'; return $false }
        if (-not (Mesgul $d)) {
            Start-Sleep -Milliseconds 200
            $d = Eding-Durum
            if ($d -eq '') { Yaz 'Eding durumu okunamadı (bağlantı koptu?): hareket bitti sayılmadı.'; return $false }
            if (Hatali $d) { Yaz "Eding hata verdi ($d). Açıklaması Eding penceresinin mesaj kısmında."; return $false }
            if (-not (Mesgul $d)) { return $true }
        }
        Start-Sleep -Milliseconds 200
    }
    [Kayit]::Yaz("BEKLEME: $saniye sn içinde hareket bitmedi (durum $(Eding-Durum))")
    return $false
}

# ================= MAKRO SÜRÜMÜ VE #4039 BAYRAĞI (K6) =================
# macro.cnc 'sub pm_surum' -> #4038 = 4. Makroda değişiklik yapılırsa ikisi birlikte güncellenir.
$BeklenenMakroSurum = 4
$script:MakroKontrolTamam = $false   # bu Eding bağlantısında sürüm kontrolü ve bayrak sıfırlama yapıldı mı
$script:MakroSurumUyumsuz = $false
$script:MakroKontrolSon = [datetime]::MinValue
$script:MakroYamaBekliyor = $false   # orijinal makroya yama yapıldı ama Eding henüz yeniden açılmadı
function Makro-Surum-Oku {
    # Eding'e YÜKLÜ makronun sürümü (dosyanın değil). Okunamazsa -1.
    try {
        if (-not (Rc-Tamam ([Eding]::CncRunSingleLine('#4038=0')))) { return -1 }
        if (-not (Hareket-Bitene-Kadar-Bekle 5)) { return -1 }
        if ([Eding]::CncGetVariable(4038) -ne 0) { return -1 }
        $rc = [Eding]::CncRunSingleLine('gosub pm_surum')
        if (-not (Rc-Tamam $rc)) { Hata-Temizle 'Makro sürümü'; return 0 }   # pm_surum yok: eski makro
        if (-not (Hareket-Bitene-Kadar-Bekle 5)) { return -1 }
        return [int][Eding]::CncGetVariable(4038)
    } catch { return -1 }
}
function Bayrak-Sifirla([string]$islem) {
    # MC-04/GV-04: hareketsiz takım bildirimi bayrağı kalıcıdır; 1 kalırsa sonraki işin M6'sı frez almadan/ölçmeden geçer.
    $nr = if ($script:OzelMakro) { 4039 } else { 4900 }
    $rc = [Eding]::CncRunSingleLine("#$nr=0")
    if (Rc-Tamam $rc) { [void](Hareket-Bitene-Kadar-Bekle 3) }
    $v = [double]::NaN; try { $v = [Eding]::CncGetVariable($nr) } catch { }
    if (-not (Rc-Tamam $rc) -or $v -ne 0) {
        [Kayit]::Yaz("BAYRAK: #$nr sıfırlanamadı ($islem): rc $rc, okunan $v")
        return $false
    }
    [Kayit]::Yaz("BAYRAK: #$nr = 0 ($islem)")
    return $true
}
function Makro-Baslangic-Kontrol {
    # Bağlantı kurulunca bir kez (ana zamanlayıcıdan): #4039/#4900 sıfırlanır, PrimerMill makrosunun Eding'deki sürümü denetlenir
    if ($script:MakroKontrolTamam -or [Eding]::AcilKilit) { return }
    if (((Get-Date) - $script:MakroKontrolSon).TotalSeconds -lt 30) { return }   # okunamadıysa 30 sn'de bir dene
    $script:MakroKontrolSon = Get-Date
    $script:MakroKontrolTamam = $true
    if (-not (Bayrak-Sifirla 'açılış')) { Yaz 'Açılış: takım bildirim bayrağı (#4039) sıfırlanamadı; iş başlatılırken yeniden denenecek.' }
    if (-not $script:OzelMakro) { return }
    $s = Makro-Surum-Oku
    if ($s -eq -1) { $script:MakroKontrolTamam = $false; return }   # okunamadı: sonra tekrar
    $script:MakroSurumUyumsuz = ($s -ne $BeklenenMakroSurum)
    if ($script:MakroSurumUyumsuz) {
        Yaz "UYARI: Eding'de yüklü makro sürümü $s, panelin beklediği $BeklenenMakroSurum. Eding yeniden başlatılmalı."
        (Ui-Kutu "Eding'de yüklü macro.cnc sürümü $s, panelin beklediği $BeklenenMakroSurum.`r`n`r`nmacro.cnc güncellendiyse Eding'i yeniden başlat (Ayarlar › PANEL › Eding'i yeniden başlat).`r`nO zamana kadar iş başlatılamaz." 'Makro sürümü' 'OK' 'Warning') | Out-Null
    } else { [Kayit]::Yaz("MAKRO: Eding'deki sürüm $s (beklenen)") }
}
function Makro-Hazir-Mi([string]$islem) {
    # BAŞLAT / takım bildirimi öncesi: PrimerMill makrosu Eding'de beklenen sürümde mi (uyumsuzsa yeniden okunur)
    if (-not $script:OzelMakro) { return $true }
    if ($script:MakroKontrolTamam -and -not $script:MakroSurumUyumsuz) { return $true }
    $s = Makro-Surum-Oku
    $script:MakroSurumUyumsuz = ($s -ne $BeklenenMakroSurum); $script:MakroKontrolTamam = $true
    if (-not $script:MakroSurumUyumsuz) { return $true }
    [Kayit]::Yaz("MAKRO: $islem reddedildi, Eding'deki sürüm $s (beklenen $BeklenenMakroSurum)")
    if (Onay "Eding'de yüklü macro.cnc sürümü $(if ($s -lt 0) { 'okunamadı' } else { $s }), panelin beklediği $BeklenenMakroSurum.`r`n$islem yapılmadı.`r`n`r`nEding şimdi yeniden başlatılsın mı? (macro.cnc yeniden okunur; sonra HOME gerekir)" $islem) { Eding-Yeniden }
    return $false
}

# PENS AÇ → T0 için orijinal macro.cnc'ye küçük ek (bir kez, yedek alınarak; Eding açılmadan önce)
function Macro-Pens-Yamasi {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    if (-not [System.IO.File]::Exists($yol)) { return }
    $enc = [System.Text.Encoding]::GetEncoding(1252)
    $m = [System.IO.File]::ReadAllText($yol, $enc)
    $nl = if ($m.Contains("`r`n")) { "`r`n" } else { "`n" }
    $ilk = $m
    if ($m -match '(?im)^\s*sub\s+pm_pens_t0\b') { if ($m -ne $ilk) { Macro-Yaz $yol $m $enc 'macro' }; return }
    $bas = [regex]::Match($m, '(?im)^[ \t]*sub[ \t]+change_tool\b[^\r\n]*\r?\n')
    if (-not $bas.Success) { [Kayit]::Yaz('MACRO: change_tool bulunamadı, yama yapılmadı'); return }
    $son = [regex]::Match($m.Substring($bas.Index + $bas.Length), '(?im)^[ \t]*endsub\b')
    if (-not $son.Success) { [Kayit]::Yaz('MACRO: change_tool sonu bulunamadı, yama yapılmadı'); return }
    $sonIdx = $bas.Index + $bas.Length + $son.Index
    $ust = "`t;PrimerMill: pens panelden acildi (gosub pm_pens_t0) -> hareket yok, sadece takim no = T0$nl" +
           "`tif [#4900 == 1]$nl`t`t#4900 = 0$nl`t`tmsg `"PrimerMill: collet opened, tool set to T0`"$nl`t`tm6t[#5011]$nl`telse$nl"
    $alt = "`t;PrimerMill: pm_pens_t0 sonu$nl`tendif$nl"
    $ek = "$nl;PrimerMill: panelden PENS AC -> pens acilir, takim T0 olur (hareket yok)$nl" +
          "sub pm_pens_t0$nl`tM54 P2$nl`t#4900 = 1$nl`tM6 T0$nl`t#4900 = 0$nl`tmsg `"PrimerMill: collet open, tool T0`"$nl" + "endsub$nl"
    $yeni = $m.Substring(0, $bas.Index + $bas.Length) + $ust + $m.Substring($bas.Index + $bas.Length, $sonIdx - $bas.Index - $bas.Length) + $alt + $m.Substring($sonIdx).TrimEnd() + $nl + $ek
    Macro-Yaz $yol $yeni $enc 'PENS AÇ → T0'
}
function Macro-Yaz([string]$yol, [string]$metin, $enc, [string]$ne) {
    $yedek = [System.IO.Path]::Combine($EdingKlasor, "macro_yedek_$(Get-Date -Format 'yyyyMMdd_HHmmss').cnc")
    [System.IO.File]::Copy($yol, $yedek, $true)
    [System.IO.File]::WriteAllText($yol, $metin, $enc)
    [Kayit]::Yaz("MACRO: $ne eki yapıldı (yedek: $yedek)")
    if (@(Get-Process -Name $script:EdingExeAd -ErrorAction Ignore).Count -gt 0) { $script:MakroYamaBekliyor = $true; Yaz "macro.cnc güncellendi ($ne). Eding kapatılıp açılınca etkin olur (EdingKapat.bat, sonra KazimaBaslat.bat)." }
}

function Eding-Goster {
    $script:EdingGosteriliyor = $true
    Ui-Ustte $false
    $n = 0
    foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction Ignore)) { $n += [Pencere]::Goster($pr.Id) }
    if ($n -eq 0) {
        $sh = New-Object -ComObject WScript.Shell
        if (-not $sh.AppActivate('CNC V4')) { (Ui-Kutu 'Eding penceresi bulunamadı (Eding kapalı olabilir).' 'Eding' 'OK' 'Information') | Out-Null }
    }
    [Kayit]::Yaz('EDING: pencere gösterildi')
}
function Eding-Gizle {
    $script:EdingGosteriliyor = $false
    if ($script:Tercih.TamEkran -ne '0') { Ui-Ustte $true }
    $script:EdingGizlendiYazildi = $false
    Eding-Gizle-Tik
    [Kayit]::Yaz('EDING: pencere tekrar arka planda')
}
function Eding-Yeniden {
    if (Is-Suruyor-Uyari 'Eding yeniden başlat') { return }
    if (-not (Onay "Eding tamamen kapatılıp yeniden açılacak (macro.cnc ve cnc.ini yeniden okunur).`r`nSonra makine yeniden home alır. Devam?" 'Eding yeniden başlat')) { return }
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    $kill = [System.IO.Path]::Combine($EdingKlasor, 'KillCNC.exe')
    Eding-Kapat-Nazik
    Start-Sleep -Seconds 2
    if ([System.IO.File]::Exists($kill)) { Start-Process -FilePath $kill -WorkingDirectory $EdingKlasor -Wait -WindowStyle Hidden }
    $script:Bagli = $false
    Start-Sleep -Seconds 1
    Yaz 'Eding yeniden başlatılıyor...'
    $script:AcilisYeniden = $true   # GV-09: yeniden açılışta otomatik home yok
    Eding-Baslat
    $script:AcilisDurum = 'bekliyor'
}

# ================= WINDOWS BAŞLANGICI =================
# Windows'un Başlangıç klasörüne KazimaBaslat.bat kısayolu: oturum açılınca panel (ve onunla Eding) kendiliğinden başlar
function Windows-Baslangic-Ayarla {
    try {
        $klasor = [Environment]::GetFolderPath('Startup')
        $lnk = [System.IO.Path]::Combine($klasor, 'PrimerMill.lnk')
        # YoneticiKurulum.bat ile kurulan "PrimerMill" zamanlanmış görevi varsa (yönetici olarak açar) kısayol gerekmez
        $gorev = $false
        try { & schtasks.exe /query /tn 'PrimerMill' 2>$null | Out-Null; $gorev = ($LASTEXITCODE -eq 0) } catch { }
        if ($gorev) {
            if ([System.IO.File]::Exists($lnk)) { [System.IO.File]::Delete($lnk); [Kayit]::Yaz('BAŞLANGIÇ: yönetici görevi var, kısayol kaldırıldı') }
            if ($script:Tercih.WinBaslangic -eq '0') { & schtasks.exe /delete /tn 'PrimerMill' /f 2>$null | Out-Null }
            return
        }
        if ($script:Tercih.WinBaslangic -ne '0') {
            $bat = [System.IO.Path]::Combine($ScriptKlasor, 'KazimaBaslat.bat')
            $ws = New-Object -ComObject WScript.Shell
            $k = $ws.CreateShortcut($lnk)
            if ($k.TargetPath -ne $bat -or -not [System.IO.File]::Exists($lnk)) {
                $k.TargetPath = $bat
                $k.WorkingDirectory = $ScriptKlasor
                $k.WindowStyle = 7
                $k.Description = 'PrimerMill paneli (Primer Teknoloji)'
                $k.Save()
                [Kayit]::Yaz("BAŞLANGIÇ: Windows açılışına eklendi: $lnk -> $bat")
            }
        } elseif ([System.IO.File]::Exists($lnk)) {
            [System.IO.File]::Delete($lnk)
            [Kayit]::Yaz("BAŞLANGIÇ: Windows açılışından çıkarıldı: $lnk")
        }
    } catch { [Kayit]::Yaz("BAŞLANGIÇ: ayarlanamadı: $($_.Exception.Message)") }
}

# Eding Windows açılışında kendisi başlıyorsa önce o görünür; Eding'i panel gizli açar, bu yüzden Eding'in başlangıç kaydı kaldırılır (yedeklenir)
function Eding-Baslangic-Kaldir {
    if (-not $MakineBilgisayari -or $script:Tercih.EdingGizli -eq '0') { return }
    $yedekK = [System.IO.Path]::Combine($ScriptKlasor, 'baslangic_yedek')
    $ek = [System.IO.Path]::GetFullPath($EdingKlasor).TrimEnd('\')
    $ws = $null; try { $ws = New-Object -ComObject WScript.Shell } catch { }
    foreach ($kl in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
        if (-not $kl -or -not [System.IO.Directory]::Exists($kl)) { continue }
        foreach ($d in [System.IO.Directory]::GetFiles($kl)) {
            $ad = [System.IO.Path]::GetFileName($d)
            if ($ad -like 'PrimerMill*') { continue }
            $hedef = ''
            if ($d -like '*.lnk' -and $ws) { try { $hedef = [string]$ws.CreateShortcut($d).TargetPath } catch { } }
            $eding = ($hedef -and ($hedef.StartsWith($ek, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($hedef) -ieq "$($script:EdingExeAd).exe")) -or ($ad -match '(?i)eding|^cnc[\s\.]')
            if (-not $eding) { continue }
            try {
                [void][System.IO.Directory]::CreateDirectory($yedekK)
                [System.IO.File]::Move($d, [System.IO.Path]::Combine($yedekK, $ad))
                [Kayit]::Yaz("BAŞLANGIÇ: Eding'in kendi açılış kısayolu kaldırıldı (panel gizli açar): $d  → yedek: $yedekK")
            } catch { [Kayit]::Yaz("BAŞLANGIÇ: $d kaldırılamadı (yönetici izni gerekebilir): $($_.Exception.Message)") }
        }
    }
    # PS-02: panel 32 bit çalıştığı için HKLM:\Software\... WOW6432Node'a yönlenir; gerçek 64 bit HKLM Run görünümü
    # RegistryKey.OpenBaseKey(LocalMachine, Registry64) ile ayrıca taranır. PS-09: yedek kaydı açık UTF-8 ile eklenir.
    $kayitDosya = [System.IO.Path]::Combine($ScriptKlasor, 'baslangic_yedek_kayit.txt')
    $edingMi = { param($v) ($v -and ($v.IndexOf($ek, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $v -match "(?i)\\$($script:EdingExeAd)\.exe")) }
    $gorunumler = @(
        @{ Ad = 'HKCU\...\Run'; Kok = [Microsoft.Win32.RegistryHive]::CurrentUser; Gorunum = [Microsoft.Win32.RegistryView]::Default },
        @{ Ad = 'HKLM\...\Run (32 bit)'; Kok = [Microsoft.Win32.RegistryHive]::LocalMachine; Gorunum = [Microsoft.Win32.RegistryView]::Registry32 },
        @{ Ad = 'HKLM\...\Run (64 bit)'; Kok = [Microsoft.Win32.RegistryHive]::LocalMachine; Gorunum = [Microsoft.Win32.RegistryView]::Registry64 })
    foreach ($g in $gorunumler) {
        $taban = $null; $rk = $null
        try {
            $taban = [Microsoft.Win32.RegistryKey]::OpenBaseKey($g.Kok, $g.Gorunum)
            try { $rk = $taban.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true) } catch { $rk = $taban.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $false) }   # yönetici değilse salt okunur
            if ($null -eq $rk) { continue }
            foreach ($ad in @($rk.GetValueNames())) {
                $v = [string]$rk.GetValue($ad)
                if (-not (& $edingMi $v)) { continue }
                try {
                    [System.IO.File]::AppendAllText($kayitDosya, "$($g.Ad) | $ad | $v`r`n", [System.Text.Encoding]::UTF8)
                    $rk.DeleteValue($ad)
                    [Kayit]::Yaz("BAŞLANGIÇ: Eding'in Run kaydı kaldırıldı: $($g.Ad)\$ad = $v")
                } catch { [Kayit]::Yaz("BAŞLANGIÇ: Run kaydı kaldırılamadı ($($g.Ad)\$ad): $($_.Exception.Message)") }
            }
        } catch { [Kayit]::Yaz("BAŞLANGIÇ: $($g.Ad) okunamadı: $($_.Exception.Message)") }
        finally { if ($rk) { $rk.Close() }; if ($taban) { $taban.Close() } }
    }
}
