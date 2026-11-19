# Kapi.ps1 - mantık tarafındaki arayüz kapısı yardımcıları: Yaz (günlük + mesaj geçmişi), Onay, Ui-Kutu (eski mesaj kutusu
# anlamını Ui-Onay / Ui-Bilgi / Ui-Hata / Ui-Secim kapılarına çevirir), Durum-Yaz, Hatalari-Kaydet, Klasor-Ac.
# Kapının kendisi (Ui-*) kabukta lib/ArayuzKapisi.ps1 ile, testlerde sahte fonksiyonlarla gerçeklenir.
# PowerShell 5.1 (32 bit) uyumlu.

$script:HataSayisi = 0
# ED-10: $Error en fazla 256 kayıt tutar; sayı orada takılınca yeni hatalar hiç loglanmıyordu. Artık her okumadan sonra
# liste boşaltılır (panelde $Error'ı başka okuyan yok). Sık yoklamalar (Get-Process) -ErrorAction Ignore ile $Error'a yazmaz.
function Hatalari-Kaydet {
    $yeni = $global:Error.Count
    if ($yeni -le 0) { return }
    for ($i = $yeni - 1; $i -ge 0; $i--) {
        $h = $global:Error[$i]
        # "işlem bulunamadı" (Get-Process) zararsız; Windows dili ne olursa olsun atla
        if ("$($h.FullyQualifiedErrorId)" -like 'NoProcessFoundForGivenName*' -or "$($h.Exception.Message)" -like '*Cannot find a process*') { continue }
        [Kayit]::Yaz("PROGRAM HATASI: $($h.Exception.Message)  @ $($h.InvocationInfo.PositionMessage)")
    }
    try { $global:Error.Clear() } catch { }
    $script:HataSayisi = 0
}

$script:SonMesajlar = New-Object System.Collections.Generic.List[string]
function Yaz([string]$metin) {
    [Kayit]::Yaz($metin)
    $script:SonMesajlar.Add((Get-Date -Format 'HH:mm:ss') + '  ' + $metin); while ($script:SonMesajlar.Count -gt 40) { $script:SonMesajlar.RemoveAt(0) }
    Mesaj-Ekle $metin
    Ui-Olaylar
}

# Kayıtlar ekranı (MakineDurumu.Kayitlar): eski Detaylar penceresindeki mesaj kutusunun yerine. En çok 500 satır.
$script:KayitListesi = New-Object System.Collections.Generic.List[object]
$script:SonMesaj = $null
function Mesaj-Turu([string]$m) {
    if ($m -match '(?i)HATA|başarısız|ALINAMADI|bağlanılamadı|ACİL STOP|yazılamadı') { return 'Hata' }
    if ($m -match '(?i)UYARI|DİKKAT|reddedildi|yapılmadı|bitmedi|okunamadı|kayıtlı değil|iptal|yarım|gönderilemez') { return 'Uyari' }
    if ($m -match '(?i)tamam|kaydedildi|tamamlandı|yedeklendi|hazır') { return 'Basari' }
    return 'Bilgi'
}
function Mesaj-Ekle([string]$metin, [string]$tur = '') {
    if (-not $tur) { $tur = Mesaj-Turu $metin }
    $script:KayitListesi.Add(@{ Zaman = (Get-Date); Tur = $tur; Metin = $metin })
    while ($script:KayitListesi.Count -gt 500) { $script:KayitListesi.RemoveAt(0) }
    $script:SonMesaj = @{ Zaman = (Get-Date); Tur = $tur; Metin = $metin }
    $script:KayitSurum++
}

# Eski [Kayit]::Show(metin, başlık, düğmeler, simge) karşılığı (taşınan fonksiyonlarda mekanik olarak bu çağrılır).
# Dönüş eskisi gibi: 'Yes' / 'No' / 'Cancel' / 'OK'. Esc / ACİL STOP / pencere kapandı -> güvenli taraf
# (YesNo -> 'No', YesNoCancel -> 'Cancel'). Pencere metni ve cevabı kabuk kapısında (Ui-*) günlüğe yazılır.
# SK-01: ana zamanlayıcının korumalı bloğundan (TikMesgul) açılan bilgi/hata pencereleri ertelenir (cevabı yok: 'OK');
# Denetleyici Tik-Sonrasi-Calistir koruma bırakılınca gösterir. Soru pencereleri ertelenemez (cevap gerekir): günlüğe uyarı.
$script:TikSonrasiKutular = New-Object System.Collections.Generic.List[object]
function Ui-Kutu([string]$metin, [string]$baslik, [string]$dugme = 'OK', [string]$simge = 'Information') {
    if ($script:TikMesgul) {
        if ($dugme -ne 'YesNo' -and $dugme -ne 'YesNoCancel') {
            $script:TikSonrasiKutular.Add(@{ Metin = $metin; Baslik = $baslik; Dugme = $dugme; Simge = $simge })
            [Kayit]::Yaz("PENCERE ERTELENDİ [$baslik] (zamanlayıcıdan sonra gösterilecek)")
            return 'OK'
        }
        [Kayit]::Yaz("UYARI: zamanlayıcı içinden soru penceresi [$baslik]")
    }
    if ($dugme -eq 'YesNo') {
        if (Ui-Onay $baslik $metin) { return 'Yes' }
        return 'No'
    }
    if ($dugme -eq 'YesNoCancel') {
        $s = Ui-Secim $baslik $metin @('EVET', 'HAYIR', 'Vazgeç')
        if ($s -eq 0) { return 'Yes' }
        if ($s -eq 1) { return 'No' }
        return 'Cancel'
    }
    if ($simge -eq 'Error') {
        # Diyalog.Hata: "NE OLDU" (ilk paragraf) / "NE YAPMALI" (geri kalanı)
        $p = ([regex]'\r?\n\r?\n').Split($metin, 2)
        $yap = ''; if ($p.Length -gt 1) { $yap = $p[1] }
        Ui-Hata $baslik $p[0] $yap
        return 'OK'
    }
    Ui-Bilgi $baslik $metin
    return 'OK'
}

# Eski renkler: taşınan kod durum / süre satırına renk verirken bunları kullanır; yeni arayüzde mesaj türüdür
$cKirmizi = 'Hata'; $cAltin = 'Uyari'; $cAltinAc = 'Uyari'; $cYesil = 'Basari'; $cSoluk = 'Bilgi'; $cYazi = 'Bilgi'

function Onay([string]$metin, [string]$baslik) {
    return ((Ui-Kutu $metin $baslik 'YesNo' 'Question') -eq 'Yes')
}

$script:SonDurum = ''
$script:DurumTur = 'Bilgi'
function Durum-Yaz([string]$metin, [string]$renk) {
    if ($metin -ne $script:SonDurum) { [Kayit]::Yaz("DURUM: $metin"); $script:SonDurum = $metin }
    $script:DurumTur = $renk
}

# --- PANEL ---
function Klasor-Ac([string]$yol) {
    try { [void][System.IO.Directory]::CreateDirectory($yol); Start-Process explorer.exe $yol } catch { Yaz "Klasör açılamadı: $yol" }
}
