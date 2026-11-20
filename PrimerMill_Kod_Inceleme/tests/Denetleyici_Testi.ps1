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
    Dogru ($d.IsAktif -and -not $d.IsTamamlandi) 'MakineDurumu.IsAktif (Geçişli tema ilerlemesi)'
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
    Dogru (-not $d.IsAktif) 'iş sonunda MakineDurumu.IsAktif = false (Geçişli: IsTamamlandi ile tam yeşil)'
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
# tema: koyu | acik | gecisli (bilinmeyen -> koyu), panel_ayarlar.ini'ye yazılır, görünüme ve Ayarlar tablosuna gider
foreach ($c in @(@('koyu', 'koyu'), @('acik', 'acik'), @('gecisli', 'gecisli'), @(' GECISLI ', 'gecisli'), @('', 'koyu'), @('mor', 'koyu'), @('acık', 'koyu'))) {
    Esit $c[1] (Tema-Normalle $c[0]) "Tema-Normalle '$($c[0])' -> $($c[1])"
}
$script:SonTema = $null
Esit $true (Komut-Isle 'ayar.kaydet' 'Tema=gecisli') 'ayar.kaydet Tema=gecisli'
Esit 'gecisli' $script:Tercih.Tema 'Tercih.Tema = gecisli'
Esit 'gecisli' $script:SonTema 'görünüme Ui-Tema gecisli gitti'
Dogru (@([System.IO.File]::ReadAllLines($TercihDosyasi)) -contains 'Tema=gecisli') 'panel_ayarlar.ini: Tema=gecisli'
$yedekTercih = $script:Tercih; $script:Tercih = @{}; Tercih-Oku; $okunanTema = $script:Tercih.Tema; $script:Tercih = $yedekTercih
Esit 'gecisli' (Tema-Normalle $okunanTema) 'Tercih-Oku sonrası tema gecisli (açılışta uygulanır)'
Esit 'gecisli' (Durum-Topla).Ayar('Tema', '') 'MakineDurumu.Ayarlar Tema = gecisli (Ayarlar › Genel seçimi)'
[void](Komut-Isle 'ayar.kaydet' 'Tema=bilinmeyen')
Esit 'koyu' $script:Tercih.Tema 'bilinmeyen tema -> koyu'
Esit 'koyu' $script:SonTema 'bilinmeyen tema: görünüme koyu'
[void](Komut-Isle 'ayar.kaydet' 'Tema=acik')
Esit 'acik' $script:SonTema 'ayar.kaydet Tema=acik'
[void](Komut-Isle 'ayar.kaydet' 'Tema=koyu')
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
# SK-05: boşluksuz / küçük harfli / boşluklu yazımlar da ayar yazan satır sayılır (önce yedek)
foreach ($s in @('G10L2P1X0', 'g10 l2 p1 x0', 'G10 L2 P1 X0', 'G92X0', 'g92.1', '#5221=1', '# 4002 = 1', '#[4002]=1', 'N10G10L2')) { Dogru (Mdi-Ayar-Yazar-Mi $s) "MDI ayar yazar: '$s'" }
foreach ($s in @('G1 X10', 'G01 X10', 'G100', 'G0 X10 Y10', 'M10', '#5221', 'T10 M6')) { Dogru (-not (Mdi-Ayar-Yazar-Mi $s)) "MDI ayar yazmaz: '$s'" }
$script:UiKayit.Clear()
[void](Komut-Isle 'mdi.gonder' 'G10L2P1X0')
Dogru (($script:UiKayit -join "`n") -match '(?s)TEHLIKELI \[MDI\].*yedek: .*ayar_') 'MDI G10L2P1X0 (boşluksuz): yedek alınır ve onayda görünür'
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

# ------------------------------------------------------------------ 7) SK-02: YAKLAŞ yalnız son GİT yapılan yuvada, araya hareket girmeden
Bolum 'YAKLAŞ hedefi (SK-02)'
[Eding]::SimHizCarpani = 25.0
[void](Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 10)
function Yaklas-Dene([string]$arg) {
    $script:UiKayit.Clear(); $script:SahteOnay = $false
    [void](Komut-Isle 'yuva.yaklas' $arg)
    $script:SahteOnay = $true
    $k = ($script:UiKayit -join "`n")
    return @{ Red = ($k -match 'Önce bu yuvaya (yeniden )?GİT'); Gecti = ($k -match 'TEHLIKELI \[Yaklaş\]|freze varken'); Metin = $k }
}
Yuva-Hedefi-Unut $true
$r = Yaklas-Dene 'T5'
Dogru ($r.Red -and -not $r.Gecti) 'GİT yapılmadan YAKLAŞ T5 reddedilir' $r.Metin
Esit $true (Komut-Isle 'yuva.git' 'T2') 'YUVAYA GİT T2'
Esit 'T2' $script:SonYuva 'SonYuva = T2'
Dogru ($null -ne $script:SonYuvaKonum) 'GİT sonrası konum kaydedildi'
$zOnce = (Makine-Konum)[2]
$r = Yaklas-Dene 'T5'
Dogru ($r.Red -and -not $r.Gecti -and $r.Metin -match 'T5') 'T2''ye GİT, T5 seçili: YAKLAŞ reddedilir (Önce bu yuvaya GİT: T5)' $r.Metin
Yakin $zOnce (Makine-Konum)[2] 0.5 'reddedilen YAKLAŞ Z''yi indirmedi' 
$r = Yaklas-Dene 'T2'
Dogru ($r.Gecti -and -not $r.Red) 'aynı yuva, araya hareket yok: YAKLAŞ onaya gelir' $r.Metin
[void](Komut-Isle 'jog' 'X+|1|300')
Dogru ($null -eq $script:SonYuva) 'jog SonYuva''yı unutturur'
$r = Yaklas-Dene 'T2'
Dogru ($r.Red) 'jog sonrası YAKLAŞ T2 reddedilir' $r.Metin
[void](Komut-Isle 'yuva.git' 'T2')
[void][Eding]::CncRunSingleLine('G91 G0 X1'); [void][Eding]::CncRunSingleLine('G90')
[void](Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 10)
$r = Yaklas-Dene 'T2'
Dogru ($r.Red -and $r.Metin -match 'hareket etti') 'GİT''ten sonra dışarıdan hareket (konum değişti): YAKLAŞ reddedilir' $r.Metin
[void](Komut-Isle 'yuva.git' 'T2')
foreach ($k in @('park', 'temizlik', 'home', 'mdi.gonder', 'konum.koldz', 'takim.degistir', 'eksen.yukari', 'is.baslat')) {
    $script:SonYuva = 'T2'; $script:SonAyarYuva = 'T3'
    $script:SahteOnay = $false; [void](Komut-Isle $k ''); $script:SahteOnay = $true
    Dogru ($null -eq $script:SonYuva -and $null -eq $script:SonAyarYuva) "'$k' YAKLAŞ hedefini unutturur"
}
[void](Komut-Isle 'is.durdur' '')
Dogru (Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor -and -not $script:IsAktif } 15) 'başlatılan iş durduruldu'
[void](Komut-Isle 'makine.reset' '')
$script:SonYuva = 'T2'; [void](Komut-Isle 'pens.kapat' '')
Esit 'T2' $script:SonYuva 'pens kapat (eksen hareketi yok) hedefi korur'
# Yuva ayarı sihirbazı: jog serbest (ortalama), başka hareket ve farklı nokta reddedilir
Yuva-Hedefi-Unut $true
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red) 'sihirbazda GİT yapılmadan YAKLAŞ reddedilir' $r.Metin
Esit $true (Komut-Isle 'yuva.git' 'ayar:T3') 'sihirbaz YUVAYA GİT T3'
Esit 'T3' $script:SonAyarYuva 'SonAyarYuva = T3'
[void](Komut-Isle 'jog' 'X+|0.1|300')
Esit 'T3' $script:SonAyarYuva 'sihirbazda jog hedefi korur (ortalama)'
$r = Yaklas-Dene 'ayar:T4'
Dogru ($r.Red -and $r.Metin -match 'T4') 'sihirbaz: T3''e GİT, T4 seçili: YAKLAŞ reddedilir' $r.Metin
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Gecti -and -not $r.Red) 'sihirbaz: aynı nokta, yalnız jog: YAKLAŞ onaya gelir' $r.Metin
# SK-16: sihirbaz yolunda konum sınırı (XY <= 2 mm, Z/A/B değişmemiş), jog hangi sekmeden gelirse gelsin
Dogru ($null -ne $script:SonAyarKonum) 'sihirbaz GİT sonrası konum kaydedildi'
[void](Komut-Isle 'jog' 'Y+|1|300')
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Gecti -and -not $r.Red) 'sihirbaz: XY ~1.0 mm ortalama: YAKLAŞ onaya gelir' $r.Metin
[void](Komut-Isle 'jog' 'X+|1|300'); [void](Komut-Isle 'jog' 'X+|1|300')
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red -and $r.Metin -match 'yeniden GİT' -and $r.Metin -match 'X/Y') 'sihirbaz: XY > 2 mm kaydı: YAKLAŞ reddedilir (yeniden GİT)' $r.Metin
Esit $true (Komut-Isle 'yuva.git' 'ayar:T3') 'sihirbaz yeniden GİT T3'
[void](Komut-Isle 'jog' 'Z-|0.1|300')
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red -and $r.Metin -match 'Z ekseni') 'sihirbaz: GİT''ten sonra Z inmiş: YAKLAŞ reddedilir' $r.Metin
[void](Komut-Isle 'yuva.git' 'ayar:T3')
[void](Komut-Isle 'jog' 'A+|0.1|300')
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red -and $r.Metin -match 'A ekseni') 'sihirbaz: GİT''ten sonra kol (A) dönmüş: YAKLAŞ reddedilir' $r.Metin
[void](Komut-Isle 'yuva.git' 'ayar:T3')
[void][Eding]::CncRunSingleLine('G91 G0 X5'); [void][Eding]::CncRunSingleLine('G90')
[void](Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 10)
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red) 'sihirbaz: dışarıdan (Eding) 5 mm hareket: YAKLAŞ reddedilir' $r.Metin
[void](Komut-Isle 'yuva.git' 'ayar:T3')
$script:SahteOnay = $false; [void](Komut-Isle 'park' ''); $script:SahteOnay = $true
$r = Yaklas-Dene 'ayar:T3'
Dogru ($r.Red) 'sihirbaz: park sonrası YAKLAŞ reddedilir' $r.Metin

# ------------------------------------------------------------------ SK-13: gerçek kapının yedek argümanı C#'a gerçekten null gider
# Testler sahte Ui-Tehlikeli-Onay kullanır; gerçek kapıdaki argüman hazırlığı (Ui-Yedek-Arg) ArayuzKapisi.ps1'den AST ile alınır,
# aynı imzalı (string[], string) bir C# yöntemine verilir: $null düz verilseydi C# "" görürdü.
Bolum 'Tehlikeli onay: yedek argümanı (SK-13)'
$akAst = [System.Management.Automation.Language.Parser]::ParseFile([System.IO.Path]::Combine($lib, 'ArayuzKapisi.ps1'), [ref]$null, [ref]$null)
$akF = $akAst.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Ui-Yedek-Arg' }, $true)
Dogru ($null -ne $akF) 'ArayuzKapisi.ps1: Ui-Yedek-Arg var'
. ([scriptblock]::Create($akF.Extent.Text))
if (-not ('PmNullSonda' -as [type])) { Add-Type -TypeDefinition 'public static class PmNullSonda { public static string Al(string baslik, string metin, string[] e, string[] y, string yedek) { return yedek == null ? "<null>" : "[" + yedek + "]"; } }' }
$v = Ui-Yedek-Arg $null; Esit '<null>' ([PmNullSonda]::Al('b', 'm', $null, $null, $v)) 'yedek gerekmez ($null): C# gerçek null alır (satır gösterilmez)'
$v = $null; Esit '[]' ([PmNullSonda]::Al('b', 'm', $null, $null, $v)) 'karşılaştırma: düz $null C#''a "" gider (SK-13 nedeni)'
$v = Ui-Yedek-Arg ''; Esit '[]' ([PmNullSonda]::Al('b', 'm', $null, $null, $v)) 'yedek alınmadı (""): "Yedek: alınmadı"'
$v = Ui-Yedek-Arg ([System.IO.Path]::Combine('yedekler', 'ayar_1.txt')); Esit '[ayar_1.txt]' ([PmNullSonda]::Al('b', 'm', $null, $null, $v)) 'yedek yolu: dosya adı'
$gercek = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($lib, 'ArayuzKapisi.ps1'))
Dogru ($gercek -match '\$yd = Ui-Yedek-Arg \$yedek') 'Ui-Tehlikeli-Onay Diyalog.TehlikeliOnay''a Ui-Yedek-Arg sonucunu geçirir'

# ------------------------------------------------------------------ 8) SK-01: zamanlayıcı koruması içinde pencere / komut yok
Bolum 'Zamanlayıcı koruması: erteleme (SK-01) ve DURDUR (SK-09)'
$script:EtkinEkran = 'uretim'; $script:KomutKuyrugu.Clear(); $script:TikSonrasiKutular.Clear()
# korumalı blok sürerken (DoEvents ile) gelen dokunuş: sıraya alınır, koruma bırakılınca çalışır
$script:TikMesgul = $true
Esit $true (Komut-Isle 'ekran' 'kalibrasyon') 'tık içinde gelen komut kabul edildi (sırada)'
Esit 'uretim' $script:EtkinEkran 'tık içinde komut çalışmadı'
Esit 1 $script:KomutKuyrugu.Count 'komut sırada'
# korumalı bloğun içinden iç içe gelen tık hiçbir şey çalıştırmaz (açılış / uzak / manuel / sıra)
$script:TikSonraki = 'makro'
Zamanlayici-Tik
Esit 'makro' $script:TikSonraki 'iç içe tık açılış/makro işini başlatmadı'
Esit 1 $script:KomutKuyrugu.Count 'iç içe tık sırayı boşaltmadı'
# iş sonu hata penceresi (Ilerleme-Guncelle -> Ui-Kutu Error) tık içinde ertelenir
$script:UiKayit.Clear()
[void](Ui-Kutu "Deneme hata.`r`n`r`nRESET'e bas." 'Deneme hatası' 'OK' 'Error')
Dogru (-not (($script:UiKayit -join "`n") -match 'HATA \[Deneme hatası\]')) 'tık içinde hata penceresi açılmadı (ertelendi)'
Esit 1 $script:TikSonrasiKutular.Count 'pencere sırada'
# ACİL STOP ve DURDUR sırayı beklemez
Esit $true (Komut-Isle 'acilstop' '') 'tık içinde ACİL STOP'
Dogru ([Eding]::AcilKilit) 'ACİL STOP sırayı beklemeden kilitledi'
Esit 1 $script:KomutKuyrugu.Count 'ACİL STOP sıraya girmedi'
# SK-15: tık içinde DURDUR onay sorusunu korumanın içinde açmaz: sıranın başına (öncelikli, zaman aşımı yok)
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.durdur' '') 'tık içinde DURDUR kabul edildi (öncelikli sırada)'
Esit 2 $script:KomutKuyrugu.Count 'DURDUR sırada'
Esit 'is.durdur' $script:KomutKuyrugu[0].Ad 'DURDUR sıranın başında'
Dogru ($script:KomutKuyrugu[0].Oncelikli) 'DURDUR öncelikli'
Esit 0 $script:UiKayit.Count 'tık içinde DURDUR hiçbir pencere / bildirim açmadı'
$script:KomutKuyrugu[0].Zaman = (Get-Date).AddSeconds(-10)   # öncelikli komut zaman aşımına uğramaz
function Log-Metin { $fs = New-Object System.IO.FileStream([Kayit]::Dosya, 'Open', 'Read', 'ReadWrite'); try { return (New-Object System.IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() } }
$logOnce = (Log-Metin).Length
$script:TikMesgul = $false; $script:TikSonraki = ''
Tik 1
$logYeni = (Log-Metin).Substring($logOnce)
$iD = $logYeni.IndexOf('KOMUT (yerel): is.durdur'); $iE = $logYeni.IndexOf('KOMUT (yerel): ekran kalibrasyon')
Dogru ($iD -ge 0 -and $iE -gt $iD) 'koruma bırakılınca önce DURDUR, sonra sıradaki komut işlendi' "durdur@$iD ekran@$iE"
Dogru (($script:UiKayit -join "`n") -match 'Çalışan iş yok') 'DURDUR (10 sn beklemiş, öncelikli) yine işlendi: iş yok nedeni bildirildi'
Esit 'kalibrasyon' $script:EtkinEkran 'koruma bırakılınca sıradaki komut çalıştı'
Esit 0 $script:KomutKuyrugu.Count 'sıra boş'
Dogru (($script:UiKayit -join "`n") -match 'HATA \[Deneme hatası\] Deneme hata\.') 'ertelenen hata penceresi koruma bırakılınca gösterildi'
Esit 0 $script:TikSonrasiKutular.Count 'pencere sırası boş'
$script:SahteOnay = $true; [void](Komut-Isle 'acilstop.kaldir' ''); Dogru (-not [Eding]::AcilKilit) 'ACİL STOP kaldırıldı'
# eski komut (3 sn'den fazla beklemiş) çalıştırılmaz
$script:TikMesgul = $true; [void](Komut-Isle 'ekran' 'ayarlar'); $script:TikMesgul = $false
$script:KomutKuyrugu[0].Zaman = (Get-Date).AddSeconds(-10)
$script:UiKayit.Clear(); Tik 1
Esit 'kalibrasyon' $script:EtkinEkran 'zaman aşımına uğrayan komut çalışmadı'
Dogru (($script:UiKayit -join "`n") -match 'zamanında işlenemedi') 'zaman aşımı bildirildi'
$script:EtkinEkran = 'uretim'
# SK-09: panelden bir işlem sürerken DURDUR çalışır, başka komut reddedilir
[void](Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 10)
[Eding]::SimHizCarpani = 1.0
[void][Eding]::CncRunSingleLine('G91 G1 X20 F60')
Dogru (Bekle-Kosul { Okuma-Yap; $script:Hizli.Calisiyor } 5) 'uzun hareket başladı'
$script:IslemSuruyor = $true; $script:IslemAdi = 'Deneme işlemi'
$r = Komut-Isle 'park' ''
Dogru ("$r" -like 'Önceki işlem sürüyor*') 'işlem sürerken PARK reddedilir' "$r"
$script:SahteOnay = $true
$r = Komut-Isle 'is.durdur' ''
Esit $true $r 'işlem sürerken DURDUR çalıştı (SK-09)'
Dogru (Bekle-Kosul { Okuma-Yap; -not $script:Hizli.Calisiyor } 5) 'DURDUR hareketi kesti (CncAbortJob)'
Dogru ($script:IslemSuruyor -and $script:IslemAdi -eq 'Deneme işlemi') 'DURDUR dıştaki işlemin bayrağını bozmadı'
$script:IslemSuruyor = $false; $script:IslemAdi = ''
[void][Eding]::CncRunSingleLine('G90'); [void](Komut-Isle 'makine.reset' '')
[Eding]::SimHizCarpani = 25.0

try { Remove-Item -LiteralPath $kok -Recurse -Force -ErrorAction SilentlyContinue } catch { }
Ozet 'Denetleyici'
