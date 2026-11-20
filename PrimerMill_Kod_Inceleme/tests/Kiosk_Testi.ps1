# Kiosk_Testi.ps1 - kiosk modu ve CİHAZI KAPAT (lib/Kiosk.ps1, lib/Kiosk.cs, Kabuk.ps1, KIOSK_KUR/KALDIR.bat).
#  - PIN: doğru / yanlış / baştaki sıfır / 5 yanlış -> 60 sn kilit / kilit bitince; PIN günlüğe yazılmaz
#  - sistem.kapat: iş sürerken / duraklıyken / panel işlemi sürerken reddedilir; DEMO'da shutdown ASLA çağrılmaz;
#    gerçek modda shutdown.exe yerine sahte yürütücü: /s, /r, vazgeç, hata kodu -> panel geri döner
#  - Windows'a geç, panele dönüş, kiosk'ta PIN'li kapatma (çıkış kodu 11), kiosk'ta KÜÇÜLT pasif
#  - KioskKilit.Engelle karar tablosu (Esc tek başına serbest), Kiosk.cs mcs -langversion:5 (mcs varsa)
#  - statik: Kabuk.ps1 çıkış kodları = Kiosk.ps1; KIOSK_KALDIR.bat KIOSK_KUR.bat'in her ilkesini geri alır
# Çalıştırma: pwsh -NoProfile -File tests/Kiosk_Testi.ps1 [-Kaynak teslim/PrimerMill]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'Kiosk.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
$Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path
Write-Host "Kaynak: $Kaynak"
$lib = [System.IO.Path]::Combine($Kaynak, 'lib')

# ------------------------------------------------------------------ C#
$cs = @('lib/Kayit.cs', 'lib/NcAnaliz.cs', 'lib/WebSunucu.cs', 'lib/EdingSim.cs', 'ui/PrimerVeri.cs') | ForEach-Object { [System.IO.Path]::Combine($Kaynak, $_) }
if (-not ('PrimerUI.MakineDurumu' -as [type])) { Add-Type -Path $cs }
Bolum 'Kiosk.cs'
$kioskCs = [System.IO.Path]::Combine($lib, 'Kiosk.cs')
$derlendi = $false
try { if (-not ('KioskKilit' -as [type])) { Add-Type -Path $kioskCs }; $derlendi = $true } catch { Kaldi 'Kiosk.cs Add-Type' $_.Exception.Message }
if ($derlendi) { Gecti 'Kiosk.cs derlendi (Add-Type)' }
$mcs = Get-Command mcs -ErrorAction Ignore
if ($mcs) {
    $out = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "kiosk_$PID.dll")
    $cikti = & $mcs.Source -langversion:5 -target:library "-out:$out" $kioskCs 2>&1
    Esit 0 $LASTEXITCODE 'Kiosk.cs mcs -langversion:5 (C# 5, PowerShell 5.1 Add-Type sınırı)'
    if ($LASTEXITCODE -ne 0) { Bilgi ($cikti -join ' | ') }
    try { Remove-Item -LiteralPath $out -ErrorAction Ignore } catch { }
} else { Bilgi 'mcs yok: C# 5 denetimi atlandı (tests/ui/demo_ekran_testi.sh da denetler)' }
if ($derlendi) {
    $K = [KioskKilit]
    $tablo = @(
        @(0x5B, $false, $false, $false, $true, 'Sol Win'), @(0x5C, $false, $false, $false, $true, 'Sağ Win'), @(0x5D, $false, $false, $false, $true, 'Menü (Apps)'),
        @(0x44, $false, $false, $true, $true, 'Win+D'), @(0x4C, $false, $false, $true, $true, 'Win+L (Windows kendisi de keser)'),
        @(0x09, $true, $false, $false, $true, 'Alt+Tab'), @(0x1B, $true, $false, $false, $true, 'Alt+Esc'), @(0x1B, $false, $true, $false, $true, 'Ctrl+Esc / Ctrl+Shift+Esc'),
        @(0x73, $true, $false, $false, $true, 'Alt+F4'), @(0x20, $true, $false, $false, $true, 'Alt+Boşluk'),
        @(0x1B, $false, $false, $false, $false, 'Esc tek başına (ACİL STOP) SERBEST'), @(0x41, $false, $false, $false, $false, 'A harfi serbest'),
        @(0x09, $false, $false, $false, $false, 'Tab serbest'), @(0x20, $false, $false, $false, $false, 'Boşluk serbest'), @(0x73, $false, $false, $false, $false, 'F4 serbest'),
        @(0x43, $false, $true, $false, $false, 'Ctrl+C serbest'), @(0x0D, $false, $false, $false, $false, 'Enter serbest'))
    foreach ($t in $tablo) { Esit $t[4] ($K::Engelle([int]$t[0], [bool]$t[1], [bool]$t[2], [bool]$t[3])) "Engelle: $($t[5])" }
    $kod = [System.IO.File]::ReadAllText($kioskCs)
    Dogru ($kod -match 'static LowLevelKeyboardProc kancaTemsilci') 'kanca temsilcisi statik alanda (GC toplamasın)'
    Dogru ($kod -match 'UnhookWindowsHookEx') 'kanca kaldırılıyor (UnhookWindowsHookEx)'
}

# ------------------------------------------------------------------ önyükleme benzeri ortam (demo, geçici klasör)
$kok = Gecici-Klasor 'pm_kiosk'
$PanelKlasor = $Kaynak
$ScriptKlasor = [System.IO.Path]::Combine($kok, 'demo_calisma')
$EdingKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'CNC')
$IsKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'isler')
[void][System.IO.Directory]::CreateDirectory($EdingKlasor); [void][System.IO.Directory]::CreateDirectory($IsKlasor)
[System.IO.File]::Copy([System.IO.Path]::Combine($Kaynak, 'demo', 'macro.cnc'), [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'))
$AktifIsAdi = 'AKTIF_IS.nc'
$AyarliTakimlar = @(1, 2, 3, 4, 5, 6)
$script:Sade = $true
$MakineBilgisayari = $false
$script:Demo = $true
$script:Yonetici = $false
[Kayit]::Ac([System.IO.Path]::Combine($ScriptKlasor, 'loglar'))
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'FrezOmru', 'Kalibrasyon', 'Uzak', 'Kiosk', 'Denetleyici', 'Demo')) { . ([System.IO.Path]::Combine($lib, "$m.ps1")) }
. Ui-Sahte-Yukle
$script:ApiHazir = $true
[Eding]::SimSifirla()
Tercih-Baslangic
$script:Tercih.Uzak = '0'
# test dosyaları geçici klasörde (panel klasörüne kiosk.on / kapaniyor.txt yazılmasın)
$script:KioskBayrak = [System.IO.Path]::Combine($kok, 'kiosk.on')
$script:KapatmaIsareti = [System.IO.Path]::Combine($kok, 'kapaniyor.txt')
# Windows'a özgü yan etkiler sahte: explorer, shutdown.exe
$script:ExplorerCagri = 0
function script:Explorer-Baslat { $script:ExplorerCagri++; return $true }
$script:KapatmaCagri = New-Object System.Collections.Generic.List[string]
$script:KapatmaSonuc = 0
$script:KapatmaYurutucu = { param([string]$tur) $script:KapatmaCagri.Add($tur); return $script:KapatmaSonuc }
function Pinler([string[]]$p) { $script:SahtePinler.Clear(); foreach ($x in $p) { $script:SahtePinler.Add($x) } }
function Kayit-Metni { $script:UiKayit -join "`n" }
function Pin-Sifirla { $script:PinHata = 0; $script:PinKilitBitis = [datetime]::MinValue }
Bilgi "geçici klasör: $kok"

# ------------------------------------------------------------------ 1) kiosk algılama
Bolum 'Kiosk algılama'
Dogru (-not (Kiosk-Algila)) 'kiosk.on yok: kiosk kapalı'
[System.IO.File]::WriteAllText($script:KioskBayrak, 'Shell=x')
Dogru (-not (Kiosk-Algila)) 'DEMO: kiosk.on olsa da kiosk kapalı'
$script:Demo = $false
Dogru (Kiosk-Algila) 'gerçek mod + kiosk.on: kiosk açık'
$script:Demo = $true
[System.IO.File]::Delete($script:KioskBayrak)

# ------------------------------------------------------------------ 2) PIN
Bolum 'PIN denetimi'
Esit '2457' (Kiosk-Pin) 'varsayılan PIN 2457 (panel_ayarlar.ini KioskPin yok)'
$script:Tercih.KioskPin = 'abc'; Esit '2457' (Kiosk-Pin) 'geçersiz KioskPin -> 2457'
$script:Tercih.KioskPin = '0123'; Esit '0123' (Kiosk-Pin) 'KioskPin 0123 okunur'
Pin-Sifirla
Esit 'yanlis' (Kiosk-Pin-Dene '123') '0123 yerine 123: yanlış (metin karşılaştırma)'
Esit 'tamam' (Kiosk-Pin-Dene '0123') '0123 doğru'
$script:Tercih.Remove('KioskPin')
Pin-Sifirla
$t0 = [datetime]'2026-11-19T10:00:00'
Esit 'tamam' (Kiosk-Pin-Dene '2457' $t0) 'doğru PIN'
Esit 'yanlis' (Kiosk-Pin-Dene '2458' $t0) 'yanlış PIN'
Esit 'yanlis' (Kiosk-Pin-Dene '' $t0) 'boş PIN yanlış'
Esit 'yanlis' (Kiosk-Pin-Dene ' 2457' $t0) 'boşluklu PIN yanlış'
Pin-Sifirla
for ($i = 1; $i -le 4; $i++) { [void](Kiosk-Pin-Dene '1111' $t0) }
Esit 4 $script:PinHata '4 yanlış sayıldı'
Esit 'kilitli' (Kiosk-Pin-Dene '1111' $t0) '5. yanlış: kilit'
Esit 'kilitli' (Kiosk-Pin-Dene '2457' $t0.AddSeconds(30)) 'kilitliyken doğru PIN de reddedilir (30 sn)'
Esit 30 (Kiosk-Pin-Kilit-Kalan $t0.AddSeconds(30)) 'kalan kilit 30 sn'
Esit 'tamam' (Kiosk-Pin-Dene '2457' $t0.AddSeconds(61)) '60 sn sonra doğru PIN kabul'
Esit 0 $script:PinHata 'başarıdan sonra sayaç sıfır'
Pin-Sifirla
[void](Kiosk-Pin-Dene '1111' $t0); [void](Kiosk-Pin-Dene '2457' $t0); [void](Kiosk-Pin-Dene '1111' $t0)
Esit 1 $script:PinHata 'doğru PIN ara sayacı sıfırlar'

Bolum 'PIN sorma (diyalog) ve günlük'
Pin-Sifirla
$script:Tercih.KioskPin = '918273'
Pinler @(); Dogru (-not (Kiosk-Pin-Sor 'deneme')) 'vazgeç: false'; Esit 0 $script:PinHata 'vazgeç yanlış sayılmaz'
Pinler @('111111'); Dogru (-not (Kiosk-Pin-Sor 'deneme')) 'yanlış: false'
Dogru ((Kayit-Metni) -match 'BILDIR \[Uyari\] PIN yanlış') 'yanlış PIN bildirimi'
Pinler @('918273'); Dogru (Kiosk-Pin-Sor 'deneme') 'doğru: true'
Pinler @('1', '2', '3', '4', '5'); for ($i = 0; $i -lt 5; $i++) { [void](Kiosk-Pin-Sor 'deneme') }
Dogru ((Kayit-Metni) -match 'HATA \[PIN\] 5 kez yanlış') '5 yanlış: hata penceresi (60 sn)'
$script:UiKayit.Clear(); Pinler @('918273')
Dogru (-not (Kiosk-Pin-Sor 'deneme')) 'kilitliyken PIN sorulmaz, false'
Dogru (-not ((Kayit-Metni) -match 'PIN \[deneme\]')) 'kilitliyken PIN diyaloğu açılmadı'
Dogru ((Kayit-Metni) -match 'Çok fazla yanlış PIN') 'kilit bildirimi (kalan sn)'
Pin-Sifirla
[Kayit]::Kapat(); $logMetin = ''
foreach ($f in @(Get-ChildItem -LiteralPath ([System.IO.Path]::Combine($ScriptKlasor, 'loglar')) -File)) { $logMetin += [System.IO.File]::ReadAllText($f.FullName) }
[Kayit]::Ac([System.IO.Path]::Combine($ScriptKlasor, 'loglar'))
Dogru ($logMetin -match 'KİOSK: PIN denemesi') 'günlükte PIN denemesi sonucu var'
Dogru (-not $logMetin.Contains('918273')) 'günlükte PIN YOK'
$ak = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($lib, 'ArayuzKapisi.ps1'))
$m = [regex]::Match($ak, '(?s)function Ui-Pin\b.*?\n}')
Dogru ($m.Success -and $m.Value.Contains('(PIN girildi)') -and -not ($m.Value -match 'Ui-Log-Cevap \$baslik \$r\b')) 'Ui-Pin (kabuk kapısı) girilen değeri günlüğe yazmaz'
$script:Tercih.Remove('KioskPin')

Bolum 'PIN değiştirme'
Pin-Sifirla; $script:UiKayit.Clear()
Pinler @('2457', '12'); Kiosk-Pin-Degistir
Esit '2457' (Kiosk-Pin) 'kısa yeni PIN reddedildi'
Pinler @('2457', '5555', '5556'); Kiosk-Pin-Degistir
Esit '2457' (Kiosk-Pin) 'tekrar uyuşmayınca değişmedi'
Pinler @('2457', '5555', '5555'); Kiosk-Pin-Degistir
Esit '5555' (Kiosk-Pin) 'PIN 5555 oldu'
Dogru ([System.IO.File]::ReadAllText($TercihDosyasi) -match 'KioskPin=5555') 'panel_ayarlar.ini KioskPin=5555'
$script:Tercih.Remove('KioskPin'); Tercih-Yaz

# ------------------------------------------------------------------ 3) sistem.kapat izinleri
Bolum 'sistem.kapat izinleri'
Dogru ($script:Komutlar.Contains('sistem.kapat') -and $script:Komutlar.Contains('kiosk.windows') -and $script:Komutlar.Contains('kiosk.pin')) 'komutlar dağıtıcıda'
Esit '' (Izin-Neden 'sistem.kapat') 'boşta: serbest'
$c = Izin-Baglam; $c.Calis = $true; $c.IsAktif = $true; $c.Suruyor = $true
Esit $script:IzinMetni.Calis (Izin-Neden 'sistem.kapat' '' $c) 'iş sürerken: reddedilir'
$c = Izin-Baglam; $c.Calis = $true; $c.IsAktif = $false; $c.Suruyor = $true
Esit $script:IzinMetni.Hareket (Izin-Neden 'sistem.kapat' '' $c) 'makine hareket ederken: reddedilir'
$c = Izin-Baglam; $c.Durak = $true; $c.Suruyor = $true
Esit $script:IzinMetni.Durak (Izin-Neden 'sistem.kapat' '' $c) 'iş duraklıyken: reddedilir'
$script:IslemSuruyor = $true; $script:IslemAdi = 'Home'
Esit ($script:IzinMetni.Islem -f 'Home') (Izin-Neden 'sistem.kapat') 'panel işlemi sürerken: reddedilir'
$r = Komut-Isle 'sistem.kapat' ''
Dogru ("$r" -like 'Önceki işlem sürüyor*') 'işlem sürerken dağıtıcı reddeder' "$r"
$script:IslemSuruyor = $false; $script:IslemAdi = ''
$script:IsAktif = $true; $script:SahteSecim = 0; $script:KapatmaCagri.Clear()
$r = Komut-Isle 'sistem.kapat' ''
Esit $script:IzinMetni.Calis $r 'iş sürerken komut reddi (izin tablosu nedeni)'
Esit 0 $script:KapatmaCagri.Count 'iş sürerken shutdown çağrılmadı'
$script:IsAktif = $false
$iz = Izin-Hesapla
Dogru (-not $iz.ContainsKey('sistem.kapat')) 'boşta izin tablosunda sistem.kapat etkin'
Dogru ($iz.ContainsKey('kiosk.windows') -and $iz['kiosk.windows'] -eq $script:IzinMetni.KioskYok) 'kiosk kapalıyken WINDOWS''A GEÇ pasif, nedenli'

# ------------------------------------------------------------------ 4) DEMO: asla kapatmaz
Bolum 'DEMO: cihaz kapatılmaz'
foreach ($sec in @(0, 1)) {
    $script:UiKayit.Clear(); $script:KapatmaCagri.Clear(); $script:KapanisIzinli = $false
    $script:SahteSecim = $sec
    Esit $true (Komut-Isle 'sistem.kapat' '') "DEMO sistem.kapat (seçim $sec) çalıştı"
    Esit 0 $script:KapatmaCagri.Count "DEMO: shutdown çağrılmadı (seçim $sec)"
    Dogru ((Kayit-Metni) -match 'BILGI \[DEMO\] DEMO: cihaz kapatılmaz') 'DEMO: cihaz kapatılmaz bilgisi'
    Dogru ((Kayit-Metni) -match '(?m)^KAPAT$') 'DEMO: panel kapandı'
    Esit 0 $script:CikisKodu 'DEMO: çıkış kodu 0 (kapatma değil)'
    Dogru (-not [System.IO.File]::Exists($script:KapatmaIsareti)) 'DEMO: kapatma işareti yazılmadı'
}
$script:KapanisIzinli = $false

# ------------------------------------------------------------------ 5) gerçek mod (sahte shutdown)
Bolum 'Gerçek mod: shutdown (sahte yürütücü)'
$script:Demo = $false
$script:SahteSecim = 2; $script:KapatmaCagri.Clear(); $script:UiKayit.Clear()
[void](Komut-Isle 'sistem.kapat' '')
Esit 0 $script:KapatmaCagri.Count 'VAZGEÇ: shutdown yok'
$script:SahteSecim = -1; [void](Komut-Isle 'sistem.kapat' '')
Esit 0 $script:KapatmaCagri.Count 'Esc / vazgeç (-1): shutdown yok'
$script:SahteSecim = 0; $script:KapatmaSonuc = 0
[void](Komut-Isle 'sistem.kapat' '')
Esit '/s' ($script:KapatmaCagri -join ',') 'KAPAT: shutdown /s'
Esit $CikisKapatma $script:CikisKodu 'çıkış kodu 10 (Kabuk.ps1: kapanıyor)'
Dogru $script:SistemKapaniyor 'SistemKapaniyor'
Dogru $script:EdingKapatildi 'Eding kapatıldı sayılır (bekçi yeniden açmaz)'
Dogru ([System.IO.File]::Exists($script:KapatmaIsareti)) 'kapaniyor.txt yazıldı'
Dogru ($script:MesgulMetni -like 'Cihaz kapatılıyor*') 'meşgul: Cihaz kapatılıyor…'
Esit 'Cihaz kapatılıyor' (Izin-Neden 'sistem.kapat') 'kapanırken ikinci basış reddedilir'
Kapatma-Gerceklesmedi 'test'
Dogru (-not $script:SistemKapaniyor -and $script:CikisKodu -eq 0 -and -not $script:EdingKapatildi) 'kapanmazsa panel geri döner (Eding yeniden açılır)'
Dogru (-not [System.IO.File]::Exists($script:KapatmaIsareti)) 'kapatma işareti silindi'
$script:SahteSecim = 1; $script:KapatmaCagri.Clear()
[void](Komut-Isle 'sistem.kapat' '')
Esit '/r' ($script:KapatmaCagri -join ',') 'YENİDEN BAŞLAT: shutdown /r'
Kapatma-Gerceklesmedi 'test'
$script:SahteSecim = 0; $script:KapatmaCagri.Clear(); $script:KapatmaSonuc = 1190; $script:UiKayit.Clear()
[void](Komut-Isle 'sistem.kapat' '')
Dogru ((Kayit-Metni) -match 'HATA \[Cihaz kapatılamadı\].*1190') 'shutdown hata kodu: hata penceresi'
Dogru (-not $script:SistemKapaniyor -and $script:CikisKodu -eq 0 -and -not $script:KapanisIzinli) 'shutdown hatasında panel çalışmaya devam eder'
Dogru ($null -eq $script:MesgulMetni) 'meşgul katmanı kalktı'
$script:KapatmaSonuc = 0
$sx = Sistem-Exe 'shutdown.exe'
Dogru ($sx -match '(?i)[\\/](Sysnative|System32)[\\/]shutdown\.exe$') "shutdown.exe tam yol ($sx)"

# ------------------------------------------------------------------ 6) kiosk: Windows'a geç, dönüş, kapatma
Bolum 'Kiosk: Windows''a geç ve panele dönüş'
$script:Kiosk = $true
Esit $script:IzinMetni.Kiosk (Izin-Neden 'panel.kucult') 'kiosk: KÜÇÜLT pasif'
Esit '' (Izin-Neden 'kiosk.windows') 'kiosk: WINDOWS''A GEÇ serbest'
$c = Izin-Baglam; $c.Calis = $true; $c.IsAktif = $true; $c.Suruyor = $true
Esit $script:IzinMetni.Calis (Izin-Neden 'kiosk.windows' '' $c) 'iş sürerken Windows''a geçilmez'
Pin-Sifirla; $script:UiKayit.Clear(); $script:ExplorerCagri = 0; $script:SahtePencereAcik = $true
Pinler @('1111'); [void](Komut-Isle 'kiosk.windows' '')
Dogru (-not $script:KioskWindowsta -and $script:ExplorerCagri -eq 0) 'yanlış PIN: Windows açılmadı'
Pinler @('2457'); [void](Komut-Isle 'kiosk.windows' '')
Dogru ($script:KioskWindowsta) 'doğru PIN: Windows''a geçildi'
Esit 1 $script:ExplorerCagri 'explorer başlatıldı'
Dogru ((Kayit-Metni) -match 'KIOSK PENCERE False') 'panel en üstten indi, simge durumu'
Kiosk-Tik
Dogru ($script:KioskWindowsta) 'panel simge durumundayken kiosk kapalı kalır'
$script:SahtePencereAcik = $true; $script:UiKayit.Clear()
Kiosk-Tik
Dogru (-not $script:KioskWindowsta) 'panel geri açılınca kiosk geri gelir'
Dogru ((Kayit-Metni) -match 'KIOSK PENCERE True') 'tam ekran + en üstte'
$script:SahtePencereAcik = $false; $script:UiKayit.Clear()
Kiosk-Tik
Dogru ((Kayit-Metni) -match 'KIOSK PENCERE True') 'kiosk''ta simge durumunda kalmaz (arkada Windows yok)'

Bolum 'Kiosk: panel kapatma PIN ister'
Pin-Sifirla; $script:UiKayit.Clear(); $script:CikisKodu = 0; $script:KapanisIzinli = $false
Pinler @(); [void](Komut-Isle 'panel.kapat' '')
Dogru (-not ((Kayit-Metni) -match '(?m)^KAPAT$')) 'PIN vazgeç: panel kapanmadı'
Pinler @('9999'); [void](Komut-Isle 'panel.kapat' '')
Dogru (-not ((Kayit-Metni) -match '(?m)^KAPAT$')) 'yanlış PIN: panel kapanmadı'
Pinler @('2457'); [void](Komut-Isle 'panel.kapat' '')
Dogru ((Kayit-Metni) -match '(?m)^KAPAT$') 'doğru PIN: panel kapandı'
Esit $CikisWindows $script:CikisKodu 'çıkış kodu 11 (Kabuk.ps1: Windows''a geçildi)'
Dogru $script:KapanisIzinli 'kapanış izinli (FormClosing PIN sormaz)'
$script:Kiosk = $false; $script:KapanisIzinli = $false; $script:CikisKodu = 0; $script:KioskWindowsta = $false
$script:Demo = $true

# ------------------------------------------------------------------ 7) statik: Kabuk.ps1, .bat
Bolum 'Kabuk.ps1 ve KIOSK_*.bat'
$kabuk = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'Kabuk.ps1'))
Dogru ($kabuk -match '\$kod -eq 10' -and $CikisKapatma -eq 10) 'Kabuk: 10 = kapanıyor (Kiosk.ps1 ile aynı)'
Dogru ($kabuk -match '\$kod -eq 11' -and $CikisWindows -eq 11) 'Kabuk: 11 = Windows''a geçildi'
Dogru ($kabuk -match '\$kod -eq 12' -and $CikisBaskaKopya -eq 12) 'Kabuk: 12 = başka kopya'
Dogru ($kabuk -match 'EnCokYenidenAcma = 3' -and $kabuk -match 'YenidenAcmaPenceresiSn = 120') 'Kabuk: 2 dakikada 3 yeniden açma, sonra kurtarma'
Dogru ($kabuk -match 'kiosk\.on' -and $kabuk -match 'BootMode') 'Kabuk: kiosk.on yoksa / Güvenli Modda Windows masaüstü'
Dogru ($kabuk -match 'kapaniyor\.txt' -and ([System.IO.Path]::GetFileName($script:KapatmaIsareti) -eq 'kapaniyor.txt')) 'Kabuk ve panel aynı kapatma işareti'
Dogru ($kabuk -notmatch '(?m)^\s*\.\s') 'Kabuk lib yüklemez (kendi başına)'
$bs = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'KazimaBaslat.ps1'))
Dogru ($bs -match "exit \`$script:CikisKodu" -and $bs -match 'exit 12' -and $bs -match "lib\\Kiosk\.cs" -and $bs -match "'Kiosk'") 'önyükleme: Kiosk.cs + Kiosk.ps1, çıkış kodu'
$kur = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'KIOSK_KUR.bat'))
$kal = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'KIOSK_KALDIR.bat'))
$yk = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'YoneticiKurulum.bat'))
$gorev = [regex]::Match($yk, 'schtasks /create /tn "([^"]+)"').Groups[1].Value
Esit 'PrimerMill' $gorev 'YoneticiKurulum.bat görev adı'
Dogru ($kur.Contains("schtasks /change /tn `"$gorev`" /disable")) 'KIOSK_KUR görevi kapatır'
Dogru ($kal.Contains("schtasks /change /tn `"$gorev`" /enable")) 'KIOSK_KALDIR görevi yeniden açar'
foreach ($b in @(@('KIOSK_KUR', $kur), @('KIOSK_KALDIR', $kal))) { Dogru ($b[1] -match 'net session' -and $b[1] -match 'YONETICI olarak') "$($b[0]): yönetici denetimi ve açıklama" }
Dogru ($kur -match 'Winlogon.*-Name Shell' -and $kur -match 'Kabuk\.ps1' -and $kur -match 'SysWOW64') 'KIOSK_KUR: HKCU Shell = 32 bit powershell Kabuk.ps1'
Dogru ($kur -match '-WindowStyle Hidden -STA -File') 'KIOSK_KUR: -WindowStyle Hidden -STA -File'
Dogru ($kal -match 'reg.exe" delete "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell') 'KIOSK_KALDIR: Shell değeri silinir'
Dogru ($kur -match 'kiosk\.on' -and $kal -match 'del /f /q "%PANEL%kiosk\.on"') 'kiosk.on: KUR yazar, KALDIR siler'
$kurIlke = @([regex]::Matches($kur, '(?m)^call :ilke "([^"]+)" (\w+) \d+') | ForEach-Object { "$($_.Groups[1].Value)|$($_.Groups[2].Value)" })
$kalIlke = @([regex]::Matches($kal, '(?m)^call :ilke "([^"]+)" (\w+)\s*$') | ForEach-Object { "$($_.Groups[1].Value)|$($_.Groups[2].Value)" })
Dogru ($kurIlke.Count -ge 10) "KIOSK_KUR $($kurIlke.Count) ilke yazar"
$eksik = @($kurIlke | Where-Object { $kalIlke -notcontains $_ })
Dogru ($eksik.Count -eq 0 -and $kalIlke.Count -eq $kurIlke.Count) 'KIOSK_KALDIR her ilkeyi geri alır (tam ters)' ($eksik -join ', ')
foreach ($ad in @('DisableTaskMgr', 'DisableLockWorkstation', 'DisableChangePassword', 'NoLogoff', 'HideFastUserSwitching', 'DisableStatusMessages', 'EnableFirstLogonAnimation', 'NoLockScreen', 'AllowEdgeSwipe')) {
    Dogru (@($kurIlke | Where-Object { $_ -like "*|$ad" }).Count -eq 1) "ilke: $ad"
}
Dogru (@($kurIlke | Where-Object { $_ -like '*|NoClose' }).Count -eq 0) 'NoClose bilerek yok (kapatma panelden; KURULUM_VE_DENEME.md)'
Dogru ($kur -match 'bootuxdisabled on' -and $kur -match '\{current\} quietboot on') 'KIOSK_KUR: bcdedit bootuxdisabled + quietboot'
Dogru ($kur -match 'BCD;globalsettings;bootuxdisabled' -and $kal -match 'call :bcd globalsettings bootuxdisabled' -and $kal -match 'call :bcd current quietboot') 'bcdedit önceki değer yedeklenir, KALDIR geri yükler'
Dogru ($kur -match 'AutoAdminLogon' -and $kur -match 'DUZ METIN' -and $kur -match 'Otomatik oturum acma kurulsun mu\? E = evet, H = hayir \[H\]') 'otomatik oturum: sorulur, varsayılan hayır, düz metin uyarısı'
Dogru ($kal -match 'AutoAdminLogon /t REG_SZ /d 0' -and $kal -match 'DefaultPassword /f') 'KALDIR: otomatik oturum kapatılır, parola silinir'
Dogru ($kur -match 'BIOS/UEFI') 'firmware logosu notu'
foreach ($b in @(@('KIOSK_KUR', $kur), @('KIOSK_KALDIR', $kal))) {
    $parantezBlok = @([regex]::Matches($b[1], '(?m)^\s*if [^\r\n]*\(\s*$')).Count
    Esit 0 $parantezBlok "$($b[0]): parantezli if bloğu yok (klasör adında parantez olabilir)"
}

Ozet 'Kiosk'
