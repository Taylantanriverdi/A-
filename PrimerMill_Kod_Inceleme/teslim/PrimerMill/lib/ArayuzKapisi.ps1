# ArayuzKapisi.ps1 - arayüz kapısının KABUK gerçeklemesi (PrimerUI.Kabuk + PrimerUI.Diyalog, WinForms).
# Mantık modülleri arayüze yalnız bu fonksiyonlarla ulaşır. Testler bu dosyayı yüklemez; aynı adlı sahte fonksiyonlar tanımlar
# (tests/_Ortak.ps1 Ui-Sahte-Yukle). Her modal pencerenin metni ve cevabı eski Kayit.Show gibi günlüğe yazılır.
# Önyükleme $script:Kabuk (PrimerUI.Kabuk) ve isteğe bağlı $script:SimGorunum (SimView) atar.
# PowerShell 5.1 (32 bit) uyumlu.

function Ui-Log-Pencere([string]$baslik, [string]$metin) { [Kayit]::Yaz("PENCERE [$baslik] $metin") }
function Ui-Log-Cevap([string]$baslik, $cevap) { [Kayit]::Yaz("CEVAP   [$baslik] $cevap") }

function Ui-Onay([string]$baslik, [string]$metin) {
    Ui-Log-Pencere $baslik $metin
    $r = [bool][PrimerUI.Diyalog]::Onay($baslik, $metin)
    Ui-Log-Cevap $baslik $(if ($r) { 'Yes' } else { 'No' })
    return $r
}

# TASARIM §6 tehlikeli onay: kırmızı şerit, eski -> yeni değerler, yedek dosyası; varsayılan VAZGEÇ, Enter onaylamaz
# SK-08: $yedek = $null -> yedek bu işlemde gerekmez (yalnız hareket: satır gösterilmez); '' -> "Yedek: alınmadı"; yol -> "Yedek alındı"
# SK-13: PowerShell .NET string parametresine $null'u "" olarak geçirir; gerçek null için [NullString]::Value (PS 3+).
# Ayrı fonksiyon: tests/Denetleyici_Testi.ps1 bunu AST'den alıp C# tarafına gerçekten null geldiğini denetler.
function Ui-Yedek-Arg($yedek) {
    if ($null -eq $yedek) { return [NullString]::Value }
    if ("$yedek") { return [System.IO.Path]::GetFileName([string]$yedek) }
    return ''
}
function Ui-Tehlikeli-Onay([string]$baslik, [string]$metin, $eski = $null, $yeni = $null, $yedek = $null) {
    Ui-Log-Pencere "TEHLİKELİ: $baslik" ("$metin" + $(if ($yeni) { "  yeni: " + (@($yeni) -join ' ') } else { '' }) + $(if ($yedek) { "  yedek: $yedek" } else { '' }))
    $e = $null; $y = $null
    if ($null -ne $eski) { $e = [string[]]@($eski) }
    if ($null -ne $yeni) { $y = [string[]]@($yeni) }
    $yd = Ui-Yedek-Arg $yedek
    $r = [bool][PrimerUI.Diyalog]::TehlikeliOnay($baslik, $metin, $e, $y, $yd)
    Ui-Log-Cevap "TEHLİKELİ: $baslik" $(if ($r) { 'Yes' } else { 'No' })
    return $r
}

function Ui-Bilgi([string]$baslik, [string]$metin) {
    Ui-Log-Pencere $baslik $metin
    [PrimerUI.Diyalog]::Bilgi($baslik, $metin)
    Ui-Log-Cevap $baslik 'OK'
}

function Ui-Hata([string]$baslik, [string]$neOldu, [string]$neYapmali = '') {
    Ui-Log-Pencere $baslik "$neOldu $neYapmali"
    [PrimerUI.Diyalog]::Hata($baslik, $neOldu, $neYapmali)
    Ui-Log-Cevap $baslik 'OK'
}

# -1 = vazgeç / Esc (Esc ayrıca ACİL STOP)
function Ui-Secim([string]$baslik, [string]$metin, [string[]]$secenekler) {
    Ui-Log-Pencere $baslik ("$metin  [" + ($secenekler -join ' / ') + ']')
    $r = [int][PrimerUI.Diyalog]::Secim($baslik, $metin, $secenekler)
    Ui-Log-Cevap $baslik $r
    return $r
}

# -1 vazgeç, -2 ek düğme ("GÖZAT…")
function Ui-Liste-Sec([string]$baslik, [string[]]$ogeler, [string[]]$aciklamalar, [string]$ek = '') {
    Ui-Log-Pencere $baslik "$($ogeler.Count) öğe"
    $r = [int][PrimerUI.Diyalog]::ListeSec($baslik, $ogeler, $aciklamalar, $(if ($ek) { $ek } else { $null }))
    Ui-Log-Cevap $baslik $(if ($r -ge 0 -and $r -lt $ogeler.Count) { $ogeler[$r] } else { $r })
    return $r
}

function Ui-Sayi([string]$baslik, [double]$mevcut, [double]$min, [double]$max, [int]$ondalik = 3) {
    $r = [PrimerUI.Diyalog]::SayiGir($baslik, $mevcut, $min, $max, $ondalik)
    Ui-Log-Cevap $baslik $r
    if ($null -eq $r) { return $null }
    return [double]$r
}

function Ui-Metin([string]$baslik, [string]$mevcut, [bool]$sadeceRakam = $false, [int]$enCok = 0) {
    $r = [PrimerUI.Diyalog]::MetinGir($baslik, $mevcut, $sadeceRakam, $enCok)
    Ui-Log-Cevap $baslik $r
    return $r
}

# Kiosk PIN'i: rakam tuş takımı, maskeli. Girilen değer günlüğe YAZILMAZ (yalnız girildi / vazgeç). null = vazgeç.
function Ui-Pin([string]$baslik) {
    Ui-Log-Pencere $baslik 'PIN istendi'
    $r = [PrimerUI.Diyalog]::PinGir($baslik, 8)
    Ui-Log-Cevap $baslik $(if ($null -eq $r) { 'vazgeç' } else { '(PIN girildi)' })
    return $r
}

function Ui-Takim-Sec([int]$mevcut, [string[]]$aciklamalar) { return [int][PrimerUI.Diyalog]::TakimSec($mevcut, $aciklamalar) }

# GV-09: süre dolunca İPTAL (sureBitinceOnay = false); hareket yalnız ŞİMDİ BAŞLA ile
function Ui-Geri-Sayim([string]$metin, [int]$saniye) {
    Ui-Log-Pencere 'Geri sayım' $metin
    $r = [bool][PrimerUI.Diyalog]::GeriSayim($metin, $saniye, $false)
    Ui-Log-Cevap 'Geri sayım' $r
    return $r
}

function Ui-Manuel-Adim([int]$adim, [string]$metin, [string[]]$dugmeler, [string]$baslik) {
    Ui-Log-Pencere "Manuel frez $adim" "$baslik · $metin"
    $r = [int][PrimerUI.Diyalog]::ManuelFrezAdimi($adim, $metin, $dugmeler, $baslik)
    Ui-Log-Cevap "Manuel frez $adim" $r
    return $r
}

function Ui-Devam([string]$dosya, [string]$bilgi, [int]$takim) {
    Ui-Log-Pencere 'Yarım kalan iş' "$dosya · $bilgi"
    $r = [PrimerUI.Diyalog]::Devam($dosya, $bilgi, $takim)
    Ui-Log-Cevap 'Yarım kalan iş' "$($r.Secim) T$($r.Takim)"
    return @{ Secim = [string]$r.Secim; Takim = [int]$r.Takim }
}

# Dokunmatik listede olmayan dosyalar için Windows dosya seçici ("GÖZAT…", Eding programı)
function Ui-Dosya-Ac([string]$baslik, [string]$filtre, [string]$klasor) {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = $baslik; $dlg.Filter = $filtre
    if ($klasor -and [System.IO.Directory]::Exists($klasor)) { $dlg.InitialDirectory = $klasor }
    $sn = $dlg.ShowDialog($script:Kabuk)
    [Kayit]::Yaz("DOSYA PENCERESİ [$baslik] $sn $($dlg.FileName)")
    if ("$sn" -eq 'OK') { return $dlg.FileName }
    return $null
}

function Ui-Bildir([string]$metin, [string]$tur = 'Bilgi') {
    [Kayit]::Yaz("BİLDİRİM: $metin")
    try { $script:Kabuk.Bildir($metin, (Tur-Enum $tur)) } catch { }
}

# Uzun işlemlerde mesaj döngüsü (eski Application.DoEvents). Ana zamanlayıcı bu sırada ekranı günceller.
function Ui-Olaylar { [System.Windows.Forms.Application]::DoEvents() }

function Ui-Mesgul($metin) {
    $script:MesgulMetni = $(if ($metin) { [string]$metin } else { $null })
    try { $script:Kabuk.MesgulGoster($script:MesgulMetni) } catch { }
    if ($metin) { [System.Windows.Forms.Application]::DoEvents() }
}

function Ui-Uygula($durum) { try { $script:Kabuk.Uygula($durum) } catch { [Kayit]::Yaz("UYGULA: $($_.Exception.Message)") } }

function Ui-Izin([hashtable]$neden) { try { $script:Kabuk.IzinleriUygula((Sozluk-Str $neden)) } catch { [Kayit]::Yaz("İZİN: $($_.Exception.Message)") } }
function Sozluk-Str([hashtable]$h) {
    $d = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    foreach ($k in $h.Keys) { $d[[string]$k] = [string]$h[$k] }
    return , $d
}

# Açık diyalog / modal pencere sayısı (uzaktan komut reddi, K3)
function Ui-Acik-Diyalog {
    $n = [PrimerUI.Diyalog]::AcikSayisi
    try { $n += @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_ -ne $script:Kabuk -and $_.Visible -and $_.Modal }).Count } catch { }
    return $n
}

# Eding'in kendi uyarı kutusu ya da açık bir diyalog varsa onu, yoksa paneli öne al (eski Eding-Gizle-Tik kodu)
function Ui-One-Al {
    $f = $script:Kabuk
    $acik = @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_ -ne $f -and $_.Visible -and $_.Modal })
    if ($acik.Count -gt 0) { $acik[$acik.Count - 1].Activate() }
    elseif ($f.Visible -and $f.WindowState -ne 'Minimized' -and $f.Enabled) { $f.Activate() }
}

function Ui-Ustte([bool]$ustte) { try { $script:Kabuk.TopMost = $ustte } catch { } }
function Ui-Tema([bool]$koyu) { try { $script:Kabuk.TemaUygula($koyu) } catch { } }
function Ui-Kucult { try { $script:Kabuk.WindowState = 'Minimized' } catch { } }
function Ui-Kapat { try { $script:Kabuk.Close() } catch { } }
# Kiosk: $true -> çerçevesiz tam ekran, en üstte, öne al (simge durumundaysa geri aç); $false -> en üstte değil, simge durumu
function Ui-Kiosk-Pencere([bool]$kiosk) {
    try {
        $f = $script:Kabuk
        if ($kiosk) {
            if ($f.WindowState -eq 'Minimized') { $f.WindowState = 'Normal' }
            $f.FormBorderStyle = 'None'; $f.WindowState = 'Maximized'; $f.TopMost = $true
            $f.Activate()
        } else { $f.TopMost = $false; $f.WindowState = 'Minimized' }
    } catch { [Kayit]::Yaz("KİOSK PENCERE: $($_.Exception.Message)") }
}
# Panel görünür ve simge durumunda değil mi (kullanıcı görev çubuğundan geri açtı)
function Ui-Pencere-Acik { try { return ($script:Kabuk.Visible -and $script:Kabuk.WindowState -ne 'Minimized') } catch { return $false } }

# Simülasyon (eski SimView; görünümün SimHost / SimHostBuyuk yuvalarında)
function Ui-Sim-Veri($analiz) { try { if ($script:SimGorunum) { $script:SimGorunum.SetData($analiz) } } catch { } }
function Ui-Sim-Satir([int]$satir) { try { if ($script:SimGorunum) { $script:SimGorunum.SetLine($satir) } } catch { } }
function Ui-Sim-Buyuk([bool]$buyuk) {
    try {
        $s = $script:SimGorunum; if (-not $s) { return }
        $hedef = if ($buyuk) { $script:Kabuk.Uretim.SimHostBuyuk } else { $script:Kabuk.Uretim.SimHost }
        if ($s.Parent -ne $hedef) { if ($s.Parent) { $s.Parent.Controls.Remove($s) }; $hedef.Controls.Add($s); $s.Dock = 'Fill' }
    } catch { }
}
