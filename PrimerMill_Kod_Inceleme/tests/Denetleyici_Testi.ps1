# Denetleyici_Testi.ps1 - PrimerMill 2 denetleyicisi (lib/Denetleyici.ps1) ve mantık modülleri, Eding yerine EdingSim ile.
#  - lib/*.ps1 (ArayuzKapisi.ps1 hariç: arayüz kapısı sahte, _Ortak.ps1 Ui-Sahte-Yukle) + lib/Demo.ps1 yüklenir
#  - C#: lib/Kayit.cs, lib/NcAnaliz.cs, lib/WebSunucu.cs, lib/EdingSim.cs, ui/PrimerVeri.cs (WinForms gerekmez)
#  - izin tablosu: home yokken, iş sürerken, duraklıyken, ACİL STOP, yuvalar kayıtsız (RafEksik)
#  - demo iş: seç -> BAŞLAT -> DURAKLAT -> DEVAM -> bitiş (EdingSim), MakineDurumu alanları
#  - uzaktan BAŞLAT: duraklıyken ve diyalog açıkken reddedilir
#  - ui/ARAYUZ_API.md'deki her komut adının dağıtıcıda karşılığı var
# Çalıştırma: pwsh -NoProfile -File tests/Denetleyici_Testi.ps1 [-Kaynak teslim/PrimerMill]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'Denetleyici.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
$Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path
Write-Host "Kaynak: $Kaynak"
$lib = [System.IO.Path]::Combine($Kaynak, 'lib')

# ------------------------------------------------------------------ C# (WinForms'suz parçalar)
$cs = @('lib/Kayit.cs', 'lib/NcAnaliz.cs', 'lib/WebSunucu.cs', 'lib/EdingSim.cs', 'ui/PrimerVeri.cs') | ForEach-Object { [System.IO.Path]::Combine($Kaynak, $_) }
if (-not ('PrimerUI.MakineDurumu' -as [type])) { Add-Type -Path $cs }

# ------------------------------------------------------------------ önyüklemenin yaptıkları (geçici klasörde, demo gibi)
$kok = Gecici-Klasor 'pm_denetleyici'
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
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'Demo')) { . ([System.IO.Path]::Combine($lib, "$m.ps1")) }
. Ui-Sahte-Yukle
$script:ApiHazir = $true
[Eding]::SimSifirla()
[Eding]::SimHizCarpani = 25.0
Tercih-Baslangic
Bilgi "geçici klasör: $kok"

function Bekle-Kosul([scriptblock]$kosul, [double]$sn = 10) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 20 }
    return [bool](& $kosul)
}
function Tik([int]$n = 1) { for ($i = 0; $i -lt $n; $i++) { Zamanlayici-Tik } }
function Neden([string]$ad, [string]$arg = '') { return (Izin-Neden $ad $arg) }

# ------------------------------------------------------------------ 1) komut listesi (ARAYUZ_API.md §3) = dağıtıcı
Bolum 'ARAYUZ_API.md komutları dağıtıcıda'
$md = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'ui', 'ARAYUZ_API.md'))
$mdMetin = [System.IO.File]::ReadAllText($md)
$bas = $mdMetin.IndexOf('## 3. Komutlar'); $son = $mdMetin.IndexOf('## 4.', $bas)
$adlar = New-Object System.Collections.Generic.List[string]
$yalnizIzin = @('blok.yeni')
foreach ($satir in $mdMetin.Substring($bas, $son - $bas).Split("`n")) {
    if (-not $satir.StartsWith('| `')) { continue }
    $ilk = $satir.Split('|')[1]
    $kod = @([regex]::Matches($ilk, '`([a-z][a-z0-9.]*)`') | ForEach-Object { $_.Groups[1].Value })
    if ($kod.Count -eq 0) { continue }
    $onek = ''
    foreach ($k in $kod) {
        if ($k.Contains('.')) { $onek = $k.Substring(0, $k.LastIndexOf('.') + 1); $ad = $k }
        elseif ($onek -and @('geri', 'adim', 'bitir', 'ileri', 'artir', 'normal', 'azalt', 'kapat', 'bitir', 'durdur') -contains $k) { $ad = $onek + $k }
        else { $ad = $k }
        if (-not $adlar.Contains($ad)) { $adlar.Add($ad) }
    }
}
Bilgi "md'de $($adlar.Count) komut: $($adlar -join ' ')"
Dogru ($adlar.Count -ge 90) "md'den en az 90 komut okundu ($($adlar.Count))"
$eksik = @($adlar | Where-Object { $yalnizIzin -notcontains $_ -and -not $script:Komutlar.Contains($_) })
Dogru ($eksik.Count -eq 0) 'her komutun dağıtıcıda karşılığı var' ("eksik: " + ($eksik -join ', '))
# görünüm kodunun gönderdiği komutlar da (ui/PrimerUI.cs içindeki "ad.alt" dizgeleri arasında komut olanlar)
$uiKod = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($Kaynak, 'ui', 'PrimerUI.cs'))
foreach ($ad in @('is.baslat', 'is.devam', 'takim.degistir', 'yuva.git', 'kal.konum.yuva', 'mdi.gonder', 'degisken.kaydet', 'uzak.pin', 'sim.buyuk')) {
    Dogru ($uiKod.Contains("`"$ad`"") -and $script:Komutlar.Contains($ad)) "görünüm '$ad' gönderir, dağıtıcıda var"
}
Esit 'Bilinmeyen komut: yok.boyle' (Komut-Isle 'yok.boyle' '') 'bilinmeyen komut reddedilir'

# ------------------------------------------------------------------ 2) bağlantı, home, izinler
Bolum 'Bağlantı ve home'
Dogru (Baglan) 'Baglan (demo: EdingSim)'
Okuma-Yap
Esit $script:IzinMetni.Home (Neden 'jog') 'home yokken jog: Home alınmadı'
Esit $script:IzinMetni.Home (Neden 'yuva.git') 'home yokken yuva.git: Home alınmadı'
Esit '' (Neden 'home') 'home yokken HOME serbest'
Esit 'Basılı tutarak sürekli hareket bu sürümde yok: adım seçin (0.01–10)' (Neden 'jog.basla') 'jog.basla desteklenmiyor (pasif, nedenli)'
Dogru ((Neden 'uzak.izin') -like 'İzin düzeyi*') 'uzak.izin pasif, nedenli'
Esit $true (Komut-Isle 'home' '') 'home komutu çalıştı'
Dogru (Bekle-Kosul { [Eding]::CncGetAllAxesHomed() -ne 0 } 10) 'home alındı (EdingSim)'
Dogru (($script:UiKayit -join "`n") -match 'ONAY \[Home\]') 'home onay sordu'
Okuma-Yap
Esit '' (Neden 'jog') 'home sonrası jog serbest'

Bolum 'ACİL STOP'
Esit $true (Komut-Isle 'acilstop' '') 'acilstop komutu'
Dogru ([Eding]::AcilKilit) 'yazılım kilidi kapandı'
Esit $script:IzinMetni.Acil (Neden 'home') 'ACİL STOP basılıyken HOME: neden'
Esit $script:IzinMetni.Acil (Neden 'is.baslat') 'ACİL STOP basılıyken BAŞLAT: neden'
Esit '' (Neden 'acilstop.kaldir') 'KİLİDİ KALDIR serbest'
$i0 = Izin-Hesapla
Dogru ($i0.ContainsKey('jog') -and $i0.ContainsKey('mdi.gonder') -and -not $i0.ContainsKey('acilstop')) 'izin tablosunda hareket kapalı, acilstop açık'
[void](Komut-Isle 'acilstop.kaldir' '')
Dogru (-not [Eding]::AcilKilit) 'kilit kaldırıldı (onaylı)'
Esit 'ACİL STOP basılı değil' (Neden 'acilstop.kaldir') 'kilit yokken KİLİDİ KALDIR pasif'
[void](Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 5)

# ------------------------------------------------------------------ 3) iş seçimi, RafEksik
Bolum 'İş seçimi ve takım yuvaları (RafEksik)'
$isSatir = @('%', '(demo testi)', 'G0 G17 G40 G49 G54 G80 G90') + @(1..400 | ForEach-Object { 'G1 X{0} Y{1} Z-1 F1200' -f (($_ % 20) - 10), (($_ % 7) - 3) }) + @('G0 Z10', 'M30', '%')
$isYol = [System.IO.Path]::Combine($IsKlasor, 'demo_is.nc')
[System.IO.File]::WriteAllLines($isYol, [string[]]$isSatir)
Esit $script:IzinMetni.Dosya (Neden 'is.baslat') 'dosya yokken BAŞLAT: önce iş seçin'
$script:SahteListe = 'demo_is.nc'
Esit $true (Komut-Isle 'is.sec' '') 'is.sec çalıştı'
Esit $isYol $script:SeciliDosya 'seçilen dosya'
Dogru (-not $script:Engel) 'dosya kontrolden geçti' (($script:SonHatalar) -join ' | ')
Okuma-Yap; Raf-Kontrol
Dogru ($script:OzelMakro) 'demo macro.cnc PrimerMill makrosu (manual_change var)'
Dogru ($script:RafEksik) 'cnc.ini değerlerinde yuvalar kayıtsız (#4010.. = 0)'
Esit $script:IzinMetni.Raf (Neden 'is.baslat') 'RafEksik BAŞLAT engeller'
Esit $script:IzinMetni.Raf (Neden 'takim.degistir') 'RafEksik takım değiştir engeller'
Esit '' (Neden 'jog') 'RafEksik jog engellemez'
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*kayıtlı değil*') 'uzaktan BAŞLAT: yuvalar kayıtsız reddi' $r
foreach ($nv in @(@(4010, -125.557), @(4011, -89.166), @(4020, -125.0), @(4021, -53.0), @(4031, -64.25), @(4032, -52.0))) { [Eding]::SimDegiskenYaz($nv[0], $nv[1]) }
Raf-Kontrol
Dogru (-not $script:RafEksik) 'yuvalar yazılınca RafEksik kalkar'
Esit '' (Neden 'is.baslat') 'BAŞLAT serbest'

# ------------------------------------------------------------------ 4) demo iş: başlat -> duraklat -> devam -> bitiş
Bolum 'Demo iş'
[Eding]::SimHizCarpani = 1.0; [Eding]::SimSatirHizi = 15.0   # 400 satır ~27 sn: duraklatmaya zaman kalsın
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT komutu'
Dogru ($script:IsAktif) 'iş aktif' (($script:UiKayit) -join ' | ')
Dogru (Bekle-Kosul { Okuma-Yap; $script:Hizli.Calisiyor } 5) 'Eding çalışıyor'
Tik 6
$d = $script:SonDurumNesnesi
Dogru ($null -ne $d) 'MakineDurumu üretildi'
if ($d) {
    Esit ([PrimerUI.Durum]::Calisiyor) $d.Durum 'MakineDurumu.Durum = Calisiyor'
    Esit 'demo_is' $d.Dosya 'MakineDurumu.Dosya'
    Dogru ($d.Bagli -and $d.Demo -and $d.HomeAlindi) 'Bagli / Demo / HomeAlindi'
    Dogru ($d.ToplamSatir -ge 400) 'ToplamSatir' "$($d.ToplamSatir)"
    Dogru ($d.TahminiSn -gt 0) 'TahminiSn'
    Dogru ($d.Kayitlar.Count -gt 0) 'Kayitlar dolu'
    Dogru ($d.Teknik.Count -ge 5) 'Teknik dolu'
    Dogru ($d.Ayarlar.ContainsKey('FrezModu') -and $d.Ayarlar.ContainsKey('KalT')) 'Ayarlar anahtarları'
    Dogru (-not [string]::IsNullOrEmpty($d.UzakPin) -and $d.UzakPin.Length -ge 6) 'UzakPin (6+ hane, UZ-03)'
}
Esit $script:IzinMetni.Calis (Neden 'takim.degistir') 'iş sürerken takım değiştir: engelli'
Esit $script:IzinMetni.Calis (Neden 'temizlik') 'iş sürerken temizlik: engelli'
Esit $script:IzinMetni.Calis (Neden 'jog') 'iş sürerken jog: engelli'
Esit $script:IzinMetni.Calis (Neden 'kal.uretici') 'iş sürerken G54 üretici: engelli'
Esit '' (Neden 'is.duraklat') 'iş sürerken DURAKLAT serbest'
Esit '' (Neden 'is.durdur') 'iş sürerken DURDUR serbest'
Esit '' (Neden 'hiz.artir') 'iş sürerken hız serbest'
Dogru ((Neden 'is.sec') -ne '') 'iş sürerken İŞ SEÇ engelli'
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*') 'uzaktan BAŞLAT iş sürerken reddedilir' $r

Esit $true (Komut-Isle 'is.duraklat' '') 'DURAKLAT komutu'
Dogru (Bekle-Kosul { Okuma-Yap; $script:Hizli.Durakli } 5) 'Eding duraklı (PAUSE)'
Tik 3
Esit ([PrimerUI.Durum]::Duraklatildi) $script:SonDurumNesnesi.Durum 'MakineDurumu.Durum = Duraklatildi'
foreach ($k in @('jog', 'pens.ac', 'pens.kapat', 'mdi.gonder', 'degisken.kaydet', 'kal.zalma', 'kal.disk.uygula', 'home', 'takim.degistir', 'eding.yeniden')) {
    $n = Neden $k
    Dogru ($n -ne '') "duraklıyken '$k' engelli" $n
}
Esit $script:IzinMetni.Durak (Neden 'mdi.gonder') 'duraklıyken MDI nedeni'
Esit $script:IzinMetni.Durak (Neden 'degisken.kaydet') 'duraklıyken G54 yazma nedeni'
Esit '' (Neden 'is.devam') 'duraklıyken DEVAM serbest'
Esit '' (Neden 'is.durdur') 'duraklıyken DURDUR serbest'
$g54once = [Eding]::CncGetVariable(5221)
$sonuc = Komut-Isle 'degisken.kaydet' '5221=1;5222=2;5223=3;5224=4;5225=5;4000=0;4001=0;4002=0;4003=0;4004=0;4005=0;4006=0'
Esit $script:IzinMetni.Durak $sonuc 'duraklıyken degisken.kaydet komutu reddedildi'
Esit $g54once ([Eding]::CncGetVariable(5221)) 'G54 değişmedi'
$sonuc = Komut-Isle 'jog' 'X+|1|300'
Esit $script:IzinMetni.Durak $sonuc 'duraklıyken jog komutu reddedildi'
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*') 'uzaktan BAŞLAT duraklıyken reddedilir (K3)' $r
Dogru ($script:Hizli.Durakli) 'uzaktan BAŞLAT işi devam ettirmedi'
Esit $true (Komut-Isle 'is.devam' '') 'DEVAM komutu'
Dogru (Bekle-Kosul { Okuma-Yap; $script:Hizli.Calisiyor -and -not $script:Hizli.Durakli } 5) 'iş devam ediyor'
$script:SahteDiyalog = 1
$script:IsAktif = $script:IsAktif
$r = Uzak-Komut 'sec' 'demo_is.nc' '10.0.0.9'
Dogru ($r -like 'HATA:*pencere*') 'diyalog açıkken uzaktan seçim reddedilir' $r
[Eding]::SimSatirHizi = 2000.0   # kalan satırlar hızlı
$script:SahteDiyalog = 0
Dogru (Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 60) 'iş Eding''de bitti'
for ($i = 0; $i -lt 60 -and $script:IsAktif; $i++) { Tik 5; Start-Sleep -Milliseconds 10 }
Dogru (-not $script:IsAktif) 'panel iş sonunu algıladı'
Dogru ($script:IsTamamlandi) 'IsTamamlandi'
Tik 1
$d = $script:SonDurumNesnesi
if ($d) {
    Dogru ($d.IsTamamlandi) 'MakineDurumu.IsTamamlandi'
    Yakin 100 $d.Yuzde 0.001 'MakineDurumu.Yuzde = 100'
    Esit ([PrimerUI.Durum]::Hazir) $d.Durum 'iş sonunda Hazir'
}
Dogru (-not (Test-Path -LiteralPath $DevamDosyasi)) 'tamamlanan iş devam.json bırakmadı'

# ------------------------------------------------------------------ 5) uzaktan BAŞLAT (blok onayı) ve yerel / uzak aynı tablo
Bolum 'Uzaktan BAŞLAT'
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*Blok takıldı*') 'uzaktan BAŞLAT blok onayı ister (UzakKilit)' $r
$script:SahteDiyalog = 1
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*pencere*') 'diyalog açıkken uzaktan BAŞLAT reddedilir (K3)' $r
$script:SahteDiyalog = 0
$script:EtkinEkran = 'kalibrasyon'
$r = Uzak-Komut 'baslat' '' '10.0.0.9'
Dogru ($r -like 'HATA:*kalibrasyon*') 'kalibrasyon ekranı açıkken uzaktan BAŞLAT reddedilir' $r
$script:EtkinEkran = 'uretim'

# ------------------------------------------------------------------ 6) çeşitli
Bolum 'Çeşitli'
[void](Komut-Isle 'ayar.kaydet' 'KalT=18.50')
Esit '18.50' $script:Tercih.KalT 'ayar.kaydet KalT'
[void](Komut-Isle 'ayar.kaydet' 'Koordinat=1')
Esit 'MAKINE' $script:Tercih.Koordinat 'ayar.kaydet Koordinat=1 -> MAKINE (eski dosya biçimi)'
$t = Izin-Hesapla
Dogru ($t.ContainsKey('ayar.kaydet:ModSor')) 'Sade akışta ModSor pasif'
[void](Komut-Isle 'kal.disk.olcum' 'w=4.10')
Esit '4.10' $script:DiskOlcum['w'] 'kal.disk.olcum'
[void](Komut-Isle 'kal.oto.ileri' ''); [void](Komut-Isle 'kal.oto.ileri' '')
Dogru ($script:OtoAdim -le 1) 'prob testi geçilmeden oto sihirbaz ② adımını geçemez' "$($script:OtoAdim)"
$script:UiKayit.Clear(); $script:SahteOnay = $false
[void](Komut-Isle 'mdi.gonder' 'G0 X1')
Dogru (($script:UiKayit -join "`n") -match 'TEHLIKELI \[MDI\]') 'MDI tehlikeli onay ister'
$script:UiKayit.Clear()
[void](Komut-Isle 'mdi.gonder' '#5221=1')
Dogru (($script:UiKayit -join "`n") -match 'yedek: .*ayar_') 'MDI #5xxx satırında yedek alınır ve onayda görünür'
$script:SahteOnay = $true
$script:UiKayit.Clear()
$sonuc = Komut-Isle 'degisken.kaydet' ('5221={0};5222={1};5223={2};5224={3};5225={4};4000=-46.9;4001=-26;4002=32.5;4003=-1;4004=-14;4005=0.2;4006=1' -f (Sayi ([Eding]::CncGetVariable(5221))), (Sayi ([Eding]::CncGetVariable(5222))), (Sayi ([Eding]::CncGetVariable(5223))), (Sayi ([Eding]::CncGetVariable(5224))), (Sayi ([Eding]::CncGetVariable(5225))))
Esit $true $sonuc 'degisken.kaydet çalıştı'
Yakin 32.5 ([Eding]::CncGetVariable(4002)) 1e-9 '#4002 yazıldı'
Dogru (($script:UiKayit -join "`n") -match '(?s)TEHLIKELI \[Ayar kaydet\].*yedek: .*ayar_') 'G54/#4xxx yazma: tehlikeli onay + yedek dosyası'
$script:SahteOnay = $false
$once4000 = [Eding]::CncGetVariable(4000)
[void](Komut-Isle 'kal.zalma' '')
Esit $once4000 ([Eding]::CncGetVariable(4000)) 'Z alma: vazgeçince yazılmaz'
$script:SahteOnay = $true
Dogru ((Neden 'kal.disk.uygula') -like 'Önce*HESAPLA*') 'hesaplanmadan disk UYGULA pasif'

try { Remove-Item -LiteralPath $kok -Recurse -Force -ErrorAction SilentlyContinue } catch { }
Ozet 'Denetleyici'
