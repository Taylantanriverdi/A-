# Kiosk.ps1 - kiosk modu (Windows görünmez, Windows'a geçiş PIN'li) ve CİHAZI KAPAT.
#  - Kiosk modu: PrimerMill klasöründe kiosk.on varsa (KIOSK_KUR.bat yazar) ve DEMO değilse açıktır. Panel çerçevesiz tam ekran
#    ve en üstte açılır, klavye kilidi (lib/Kiosk.cs, KioskKilit) Win / Alt+Tab / Ctrl+Esc ... tuşlarını keser, panel PIN'siz
#    kapanmaz. Kabuk.ps1 (Windows kabuğu yerine) paneli başlatır ve çıkış koduna bakar ($CikisKapatma / $CikisWindows).
#  - Windows'a geç (Ayarlar › Genel): PIN (panel_ayarlar.ini KioskPin, varsayılan 2457; 5 yanlış -> 60 sn kilit; PIN asla
#    günlüğe yazılmaz) -> klavye kilidi kalkar, explorer.exe başlar, panel simge durumuna küçülür (çalışmaya devam eder).
#    Panel görev çubuğundan ya da masaüstü kısayolundan (ikinci kopya öne çağırır) açılınca kiosk kendiliğinden geri gelir.
#  - CİHAZI KAPAT (sol menü altı): iş / işlem sürerken reddedilir; onay (KAPAT / YENİDEN BAŞLAT / VAZGEÇ); Eding ayarları
#    kaydederek kapanır (en çok 15 sn beklenir), zamanlayıcı durur, shutdown.exe /s|/r /t 0 /f. DEMO'da bilgisayar KAPANMAZ.
#    shutdown.exe'yi çalıştıran $script:KapatmaYurutucu testlerde sahtesiyle değiştirilir.
# Arayüze yalnız kapı fonksiyonlarıyla (Ui-*) ulaşılır. PowerShell 5.1 (32 bit) uyumlu.

$script:KioskBayrak = [System.IO.Path]::Combine($PanelKlasor, 'kiosk.on')
$script:KapatmaIsareti = [System.IO.Path]::Combine($PanelKlasor, 'kapaniyor.txt')   # Kabuk.ps1: "panel kapatma sırasında çıktı, yeniden açma"
$script:Kiosk = $false
$script:KioskWindowsta = $false
$script:KapanisIzinli = $false
$script:SistemKapaniyor = $false
$script:CikisKodu = 0
$script:PinHata = 0
$script:PinKilitBitis = [datetime]::MinValue
# $script:OneAlOlayi: önyükleme atar (masaüstü kısayolu / ikinci kopya öne çağırma olayı)
$KioskPinVarsayilan = '2457'
$KioskPinEnCokHata = 5
$KioskPinKilitSn = 60
# Panel çıkış kodları (Kabuk.ps1 ile aynı): 0/diğer = beklenmedik (Kabuk yeniden açar), 10 = cihaz kapanıyor,
# 11 = Windows'a geçildi ve panel PIN ile kapatıldı, 12 = başka bir panel zaten açık (o öne çağrıldı)
$CikisKapatma = 10
$CikisWindows = 11
$CikisBaskaKopya = 12

function Kiosk-Algila { return ((-not $script:Demo) -and [System.IO.File]::Exists($script:KioskBayrak)) }

function Kiosk-Pin {
    $p = [string]$script:Tercih.KioskPin
    if ($p -notmatch '^\d{4,8}$') { return $KioskPinVarsayilan }
    return $p
}

# Kalan kilit süresi (sn, 0 = kilit yok)
function Kiosk-Pin-Kilit-Kalan($simdi = $null) {
    if ($null -eq $simdi) { $simdi = Get-Date }
    if ($script:PinKilitBitis -eq [datetime]::MinValue) { return 0 }
    $k = [int][math]::Ceiling(($script:PinKilitBitis - $simdi).TotalSeconds)
    if ($k -le 0) { $script:PinKilitBitis = [datetime]::MinValue; $script:PinHata = 0; return 0 }
    return $k
}

# Saf PIN denetimi: 'tamam' / 'yanlis' / 'kilitli'. Karşılaştırma metin olarak (baştaki sıfırlar önemli).
function Kiosk-Pin-Dene([string]$girilen, $simdi = $null) {
    if ($null -eq $simdi) { $simdi = Get-Date }
    if ((Kiosk-Pin-Kilit-Kalan $simdi) -gt 0) { return 'kilitli' }
    if ([string]$girilen -ceq (Kiosk-Pin)) { $script:PinHata = 0; return 'tamam' }
    $script:PinHata++
    if ($script:PinHata -ge $KioskPinEnCokHata) { $script:PinKilitBitis = ([datetime]$simdi).AddSeconds($KioskPinKilitSn); return 'kilitli' }
    return 'yanlis'
}

# PIN sor (rakam tuş takımı, maskeli). Vazgeç sayılmaz. Günlüğe yalnız sonuç yazılır, PIN asla.
function Kiosk-Pin-Sor([string]$baslik) {
    $kalan = Kiosk-Pin-Kilit-Kalan
    if ($kalan -gt 0) {
        [Kayit]::Yaz("KİOSK: PIN kilitli ($baslik), $kalan sn")
        Ui-Bildir "Çok fazla yanlış PIN: $kalan sn sonra yeniden deneyin." 'Uyari'
        return $false
    }
    $g = Ui-Pin $baslik
    if ($null -eq $g) { return $false }
    $s = Kiosk-Pin-Dene $g
    [Kayit]::Yaz("KİOSK: PIN denemesi ($baslik): $s")
    if ($s -eq 'tamam') { return $true }
    if ($s -eq 'kilitli') { Ui-Hata 'PIN' "$KioskPinEnCokHata kez yanlış PIN girildi." "$KioskPinKilitSn saniye bekleyip yeniden deneyin." }
    else { Ui-Bildir 'PIN yanlış.' 'Uyari' }
    return $false
}

function Kiosk-Pin-Degistir {
    if (-not (Kiosk-Pin-Sor 'Mevcut kiosk PIN')) { return }
    $y = Ui-Pin 'Yeni kiosk PIN (4–8 rakam)'
    if ($null -eq $y) { return }
    if ([string]$y -notmatch '^\d{4,8}$') { Ui-Hata 'Kiosk PIN' 'PIN 4–8 rakam olmalı.' 'PIN değiştirilmedi.'; return }
    $t = Ui-Pin 'Yeni kiosk PIN (tekrar)'
    if ([string]$t -cne [string]$y) { Ui-Hata 'Kiosk PIN' 'İki PIN aynı değil.' 'PIN değiştirilmedi.'; return }
    $script:Tercih.KioskPin = [string]$y; Tercih-Yaz
    Yaz "Kiosk PIN'i değiştirildi."
}

# ------------------------------------------------------------------ kiosk aç / bırak
function Kiosk-Uygula {
    if (-not $script:Kiosk) { return }
    try {
        if (-not [KioskKilit]::Baslat()) { [Kayit]::Yaz("KİOSK: klavye kilidi kurulamadı: $([KioskKilit]::SonHata)") }
    } catch { [Kayit]::Yaz("KİOSK: klavye kilidi: $($_.Exception.Message)") }
    Ui-Kiosk-Pencere $true
    $script:KioskWindowsta = $false
}

function Kiosk-Birak { try { [KioskKilit]::Durdur() } catch { } }

# Windows görev çubuğu (explorer kabuğu) açık mı
function Explorer-Calisiyor {
    try { return [bool][KioskKilit]::GorevCubuguVar() } catch { }
    return [bool](Get-Process -Name explorer -ErrorAction Ignore)
}

$script:KabukAnahtari = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
# explorer.exe, oturumun kabuğu kendisi değilse yalnız bir klasör penceresi açar (görev çubuğu / masaüstü yok). Bu yüzden
# kullanıcının Shell değeri (KIOSK_KUR.bat: Kabuk.ps1) başlatma süresince kaldırılır, sonra AYNEN geri yazılır.
# Geri yazılamazsa (elektrik kesildi vb.) kiosk açılışta Kiosk-Kabuk-Onar ile kiosk.on'daki satırdan onarılır. (MAKİNEDE DOĞRULA)
function Explorer-Baslat {
    if (Explorer-Calisiyor) { return $true }
    $eski = $null
    try { $eski = [string](Get-ItemProperty -LiteralPath $script:KabukAnahtari -Name Shell -ErrorAction Stop).Shell } catch { }
    try {
        if ($eski) { Remove-ItemProperty -LiteralPath $script:KabukAnahtari -Name Shell -ErrorAction Stop }
        $win = $env:SystemRoot; if (-not $win) { $win = 'C:\Windows' }
        Start-Process -FilePath ([System.IO.Path]::Combine($win, 'explorer.exe'))
        $son = (Get-Date).AddSeconds(15)
        while (-not (Explorer-Calisiyor) -and (Get-Date) -lt $son) { Ui-Olaylar; Start-Sleep -Milliseconds 250 }
        Start-Sleep -Milliseconds 500
    } catch { [Kayit]::Yaz("KİOSK: explorer başlatılamadı: $($_.Exception.Message)") }
    finally {
        if ($eski) {
            try { Set-ItemProperty -LiteralPath $script:KabukAnahtari -Name Shell -Value $eski -ErrorAction Stop }
            catch { [Kayit]::Yaz("KİOSK: UYARI kabuk değeri geri yazılamadı: $($_.Exception.Message)") }
        }
    }
    $v = Explorer-Calisiyor
    [Kayit]::Yaz("KİOSK: Windows masaüstü (explorer) $(if ($v) { 'açık' } else { 'AÇILAMADI' })")
    return $v
}

# Kiosk açıkken kullanıcının Shell değeri yoksa (Explorer-Baslat yarıda kesildi) kiosk.on'daki "Shell=" satırından geri yazılır
function Kiosk-Kabuk-Onar {
    if (-not $script:Kiosk) { return }
    try {
        $sat = @([System.IO.File]::ReadAllLines($script:KioskBayrak) | Where-Object { $_ -like 'Shell=*' })
        if ($sat.Count -eq 0) { return }
        $komut = $sat[0].Substring(6).Trim()
        if (-not $komut) { return }
        $simdi = $null
        try { $simdi = [string](Get-ItemProperty -LiteralPath $script:KabukAnahtari -Name Shell -ErrorAction Stop).Shell } catch { }
        if (-not $simdi) {
            Set-ItemProperty -LiteralPath $script:KabukAnahtari -Name Shell -Value $komut -ErrorAction Stop
            [Kayit]::Yaz('KİOSK: kabuk değeri eksikti, kiosk.on satırından geri yazıldı')
        }
    } catch { [Kayit]::Yaz("KİOSK: kabuk değeri denetlenemedi: $($_.Exception.Message)") }
}

# Ayarlar › Genel › WINDOWS'A GEÇ
function Windows-Gec {
    if (-not $script:Kiosk) { Ui-Bildir 'Kiosk modu kapalı: Windows zaten erişilebilir.' 'Bilgi'; return }
    if (-not (Kiosk-Pin-Sor "Windows'a geç")) { return }
    Kiosk-Birak
    Ui-Kiosk-Pencere $false
    $script:KioskWindowsta = $true
    if (-not (Explorer-Baslat)) { Yaz 'UYARI: Windows masaüstü (explorer.exe) başlatılamadı.' }
    Yaz "Windows'a geçildi (PIN ile). Panel arkada çalışıyor: görev çubuğundaki PrimerMill ya da masaüstündeki 'PrimerMill 2' kısayolu paneli kiosk olarak geri açar."
}

# Ana zamanlayıcıdan: panel kullanıcı tarafından geri açıldı mı / masaüstü kısayolu öne çağırdı mı
function Kiosk-Tik {
    if (-not $script:Kiosk -or $script:SistemKapaniyor) { return }
    $cagri = $false
    try { if ($script:OneAlOlayi) { $cagri = $script:OneAlOlayi.WaitOne(0) } } catch { }
    if ($script:KioskWindowsta) {
        if ($cagri -or (Ui-Pencere-Acik)) { Kiosk-Uygula; Yaz 'Panele dönüldü: kiosk kilidi yeniden açık.' }
    } elseif ($cagri -or -not (Ui-Pencere-Acik)) { Ui-Kiosk-Pencere $true }   # kiosk'ta simge durumunda kalmasın (arkada Windows yok)
}

# Kiosk'ta paneli kapatmak (KAPAT, pencere kapatma, Alt+F4) PIN ister; kapanınca Windows masaüstü açılır (çıkış kodu 11)
function Kiosk-Panel-Kapat {
    if (-not (Kiosk-Pin-Sor 'Paneli kapat')) { return }
    if ((Calisiyor-Mu) -and -not (Onay "Makine ÇALIŞIYOR. Panel kapanırsa takip durur (Eding işi sürdürür).`r`n`r`nYine de kapatılsın mı?" 'Kapat')) { return }
    Kiosk-Birak
    Ui-Kiosk-Pencere $false
    $script:KioskWindowsta = $true
    [void](Explorer-Baslat)
    $script:CikisKodu = $CikisWindows; $script:KapanisIzinli = $true
    [Kayit]::Yaz('KİOSK: panel PIN ile kapatıldı (Windows masaüstü açık)')
    Ui-Kapat
}

# ------------------------------------------------------------------ CİHAZI KAPAT
# 32 bit PowerShell 64 bit Windows'ta System32 yerine SysWOW64'ü görür; gerçek System32 = Sysnative
function Sistem-Exe([string]$ad) {
    $win = $env:SystemRoot; if (-not $win) { $win = 'C:\Windows' }
    $sn = [System.IO.Path]::Combine([System.IO.Path]::Combine($win, 'Sysnative'), $ad)
    if ([System.IO.File]::Exists($sn)) { return $sn }
    return [System.IO.Path]::Combine([System.IO.Path]::Combine($win, 'System32'), $ad)
}

# $tur: '/s' kapat, '/r' yeniden başlat. Dönüş: shutdown.exe çıkış kodu (0 = Windows kapanmaya başladı). Testler değiştirir.
$script:KapatmaYurutucu = {
    param([string]$tur)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Sistem-Exe 'shutdown.exe')
    $psi.Arguments = "$tur /t 0 /f"
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit(15000)) { return -2 }
    return [int]$p.ExitCode
}

function Zamanlayici-Durdur { try { if ($script:AnaZaman) { $script:AnaZaman.Stop() } } catch { } }
function Zamanlayici-Baslat { try { if ($script:AnaZaman) { $script:AnaZaman.Start() } } catch { } }

# Eding'i ayarları kaydederek kapatır (Pencere.Kapat = WM_CLOSE), en çok $sn bekler. Dönüş: kapandı mı.
function Eding-Kapat-Bekle([int]$sn = 15) {
    $script:EdingKapatildi = $true   # bekçi Eding'i yeniden açmasın
    if ($script:ApiHazir -and $script:Bagli -and -not $script:Demo) { try { [void][Eding]::CncDisConnectServer() } catch { } }
    if (-not $script:Demo) { $script:Bagli = $false }
    if (-not $MakineBilgisayari) { return $true }
    if (-not (Eding-Pencere-Acik)) { return $true }
    Eding-Kapat-Nazik
    $son = (Get-Date).AddSeconds($sn)
    while ((Eding-Pencere-Acik) -and (Get-Date) -lt $son) { Ui-Olaylar; Start-Sleep -Milliseconds 200 }
    $k = -not (Eding-Pencere-Acik)
    if ($k) { [Kayit]::Yaz('KAPATMA: Eding kapandı (ayarlar kaydedildi)') } else { [Kayit]::Yaz("KAPATMA: UYARI Eding $sn sn içinde kapanmadı; Windows kapanırken kapatılacak") }
    return $k
}

function Kapatma-Isareti([bool]$yaz) {
    try {
        if ($yaz) { [System.IO.File]::WriteAllText($script:KapatmaIsareti, (Get-Date).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)) }
        elseif ([System.IO.File]::Exists($script:KapatmaIsareti)) { [System.IO.File]::Delete($script:KapatmaIsareti) }
    } catch { }
}

function Sistem-Kapat {
    $s = Ui-Secim 'Cihazı kapat' "Cihaz kapatılacak: Eding ayarlarını (G54, kalıcı değişkenler) kaydederek kapanır, sonra bilgisayar kapanır.`r`nYENİDEN BAŞLAT: bilgisayar kapanıp yeniden açılır." @('KAPAT', 'YENİDEN BAŞLAT', 'VAZGEÇ')
    if ($s -ne 0 -and $s -ne 1) { return }
    $yeniden = ($s -eq 1)
    if ($script:Demo) {
        [Kayit]::Yaz('KAPATMA: DEMO, bilgisayar kapatılmadı; panel kapanıyor')
        Ui-Bilgi 'DEMO' 'DEMO: cihaz kapatılmaz. Panel kapanıyor.'
        $script:KapanisIzinli = $true
        Ui-Kapat
        return
    }
    # onay penceresi açıkken durum değişmiş olabilir (uzaktan BAŞLAT, açılış hazırlığı): yeniden denetle
    $n = Izin-Neden 'sistem.kapat'
    if ($n) { [Kayit]::Yaz("KAPATMA: vazgeçildi, $n"); Ui-Bildir $n 'Uyari'; return }
    $script:SistemKapaniyor = $true
    [Kayit]::Yaz("KAPATMA: cihaz $(if ($yeniden) { 'yeniden başlatılıyor' } else { 'kapatılıyor' }) (operatör)")
    Ui-Mesgul 'Eding kapatılıyor (ayarlar kaydediliyor)…'
    try { [void](Eding-Kapat-Bekle 15) } catch { [Kayit]::Yaz("KAPATMA: Eding: $($_.Exception.Message)") }
    Zamanlayici-Durdur
    try { [WebSunucu]::Durdur() } catch { }
    $script:UzakAcik = $false
    Kapatma-Isareti $true
    $kod = -1
    try { $kod = [int](& $script:KapatmaYurutucu $(if ($yeniden) { '/r' } else { '/s' })) } catch { [Kayit]::Yaz("KAPATMA: shutdown.exe çalıştırılamadı: $($_.Exception.Message)") }
    [Kayit]::Yaz("KAPATMA: shutdown.exe sonucu $kod")
    if ($kod -ne 0) { Kapatma-Gerceklesmedi "shutdown.exe hata kodu: $kod."; return }
    $script:CikisKodu = $CikisKapatma; $script:KapanisIzinli = $true
    Ui-Mesgul $(if ($yeniden) { 'Cihaz yeniden başlatılıyor…' } else { 'Cihaz kapatılıyor…' })
    # Panel açık kalır (Windows kapatırken kapatır; ekranda Windows görünmez). 2 dk içinde kapanmazsa panel geri döner.
    try {
        $script:KapatmaBekcisi = New-Object System.Windows.Forms.Timer
        $script:KapatmaBekcisi.Interval = 120000
        $script:KapatmaBekcisi.Add_Tick({ try { $script:KapatmaBekcisi.Stop() } catch { }; Kapatma-Gerceklesmedi 'Windows 2 dakika içinde kapanmadı.' })
        $script:KapatmaBekcisi.Start()
    } catch { }
}

function Kapatma-Gerceklesmedi([string]$neden) {
    $script:SistemKapaniyor = $false; $script:KapanisIzinli = $false; $script:CikisKodu = 0
    $script:EdingKapatildi = $false   # bekçi Eding'i yeniden açar
    Kapatma-Isareti $false
    Ui-Mesgul $null
    Zamanlayici-Baslat
    try { if ($script:Tercih.Uzak -eq '1' -and -not $script:UzakAcik) { Uzak-Baslat } } catch { }
    Yaz "HATA: cihaz kapatılamadı. $neden"
    Ui-Hata 'Cihaz kapatılamadı' "$neden" 'Eding yeniden açılıyor. Yeniden deneyin; olmazsa Windows''a geçip bilgisayarı oradan kapatın.'
}
