# Frez_Omru_Testi.ps1 - frez (takım) ömrü (lib/FrezOmru.ps1), Eding yerine EdingSim, arayüz kapısı sahte:
#  - sayma yalnız Eding RUNNING + iş aktif + takım > 0 iken; PAUSE / RUN-SUB / READY / iş yok / T0 sayılmaz
#  - süre iş milindeki takıma yazılır; tık aralığı en çok 2 sn sayılır (donma / uyku)
#  - frez_omru.json gidiş-dönüş (InvariantCulture, tr-TR ve zh-CN kültüründe), bozuk / eksik dosya
#  - yüzde (1000 dk ömür, 100 dk kullanım -> %10), MakineDurumu.FrezOmurleri, sıfırlama, ömür ayarı (virgüllü giriş)
#  - BAŞLAT uyarısı: >= %100 onay (VAZGEÇ -> iş başlamaz), >= %90 alt şerit uyarısı; sıfırlama izni iş sürerken
#  - EdingSim ile gerçek bir iş: T1 sonra T2 (M6), dakikalar doğru takımlara yazılır
# Çalıştırma: pwsh -NoProfile -File tests/Frez_Omru_Testi.ps1 [-Kaynak teslim/PrimerMill]   PS 5.1 uyumlu.
param([string]$Kaynak = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'FrezOmru.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
$Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path
Write-Host "Kaynak: $Kaynak"
$lib = [System.IO.Path]::Combine($Kaynak, 'lib')

$cs = @('lib/Kayit.cs', 'lib/NcAnaliz.cs', 'lib/WebSunucu.cs', 'lib/EdingSim.cs', 'ui/PrimerVeri.cs') | ForEach-Object { [System.IO.Path]::Combine($Kaynak, $_) }
if (-not ('PrimerUI.MakineDurumu' -as [type])) { Add-Type -Path $cs }

$kok = Gecici-Klasor 'pm_frezomru'
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
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'FrezOmru', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'Demo')) { . ([System.IO.Path]::Combine($lib, "$m.ps1")) }
. Ui-Sahte-Yukle
$script:ApiHazir = $true
[Eding]::SimSifirla()
[Eding]::SimHizCarpani = 25.0
Tercih-Baslangic
Bilgi "geçici klasör: $kok"
$dosya = [System.IO.Path]::Combine($ScriptKlasor, 'frez_omru.json')

function Bekle-Kosul([scriptblock]$kosul, [double]$sn = 10) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 20 }
    return [bool](& $kosul)
}
function Tik([int]$n = 1) { for ($i = 0; $i -lt $n; $i++) { Zamanlayici-Tik } }
function Dk([int]$n) { if ($script:FrezOmru.ContainsKey($n)) { return [double]$script:FrezOmru[$n].Dakika }; return 0.0 }
# Sahte okuma: Hizli durumunu elle kur (Okuma-Yap yerine), Frez-Omru-Tik'e zaman ver
function Durum-Kur([string]$d, [int]$takim, [bool]$isAktif = $true) {
    $script:Hizli.Okundu = $true; $script:Hizli.Durum = $d; $script:Hizli.Takim = $takim; $script:IsAktif = $isAktif
}
function Sayac-Sifirla { $script:FrezOmru = @{}; $script:FrezOmruSonAn = -1.0; $script:FrezOmruSonTakim = 0; $script:FrezOmruKirli = $false; $script:FrezOmruDolduBildirildi = @{} }

# ------------------------------------------------------------------ 1) sayma kuralları (zaman elle)
Bolum 'Sayma: yalnız RUNNING + iş + takım'
Sayac-Sifirla
$script:ManuelMesajMetni = ''
Durum-Kur 'RUNNING' 2
Frez-Omru-Tik 100.0
for ($i = 1; $i -le 300; $i++) { Frez-Omru-Tik (100.0 + $i * 0.2) }   # 60 sn
Yakin 1.0 (Dk 2) 1e-6 'RUNNING, T2, 300 tık x 0.2 sn = 1.000 dk T2''ye'
Esit 0.0 (Dk 1) 'başka takıma yazılmadı'
$t = 160.0
foreach ($dur in @('PAUSE', 'PAUSED', 'RUN-SUB', 'READY', 'IDLE', 'AXISJOG', 'SEARCHING', 'ABORTED')) {
    Durum-Kur $dur 2
    for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
    Yakin 1.0 (Dk 2) 1e-6 "$dur sayılmaz"
}
Durum-Kur 'RUNNING' 2 $false
for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
Yakin 1.0 (Dk 2) 1e-6 'iş aktif değilken (MDI / home RUNNING) sayılmaz'
Durum-Kur 'RUNNING' 0
for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
Yakin 1.0 (Dk 2) 1e-6 'iş milinde frez yokken (T0) sayılmaz'
Dogru (-not $script:FrezOmru.ContainsKey(0)) 'T0 için kayıt açılmadı'
Durum-Kur 'RUNNING' 2
$script:ManuelMesajMetni = 'T2 → T3 · frezi tut'
for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
Yakin 1.0 (Dk 2) 1e-6 'manuel frez değişimi beklenirken sayılmaz'
$script:ManuelMesajMetni = ''
[Eding]::AcilKilit = $true
for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
Yakin 1.0 (Dk 2) 1e-6 'ACİL STOP kilidi varken sayılmaz'
[Eding]::AcilKilit = $false
$script:Hizli.Okundu = $false
for ($i = 0; $i -lt 50; $i++) { $t += 0.2; Frez-Omru-Tik $t }
Yakin 1.0 (Dk 2) 1e-6 'Eding okunamadıysa sayılmaz'

Bolum 'Takıma yazma ve aralık sınırı'
Durum-Kur 'RUNNING' 5
Frez-Omru-Tik $t
for ($i = 0; $i -lt 150; $i++) { $t += 0.2; Frez-Omru-Tik $t }   # 30 sn
Yakin 0.5 (Dk 5) 1e-6 'T5 iş milinde: 30 sn = 0.5 dk T5''e'
Yakin 1.0 (Dk 2) 1e-6 'T2 değişmedi'
Durum-Kur 'RUNNING' 6
$t += 0.2; Frez-Omru-Tik $t
Yakin 0.0 (Dk 6) 1e-9 'takım değiştiği aralık hiçbir takıma yazılmaz (ilk tık başlangıç)'
$t += 0.2; Frez-Omru-Tik $t
Yakin (0.2 / 60) (Dk 6) 1e-9 'sonraki tık T6''ya'
$once = Dk 6
$t += 3600.0; Frez-Omru-Tik $t   # panel bir saat donmuş / uyku
Yakin ($once + 2.0 / 60) (Dk 6) 1e-9 '1 saatlik boşluk yalnız 2 sn sayılır (sınır)'
$t += 1.5; Frez-Omru-Tik $t
Yakin ($once + 3.5 / 60) (Dk 6) 1e-9 '1.5 sn aralık olduğu gibi sayılır'
$t -= 10; Frez-Omru-Tik $t
Yakin ($once + 3.5 / 60) (Dk 6) 1e-9 'geri giden zaman sayılmaz'

# ------------------------------------------------------------------ 2) kayıt
Bolum 'Kalıcılık: frez_omru.json'
Durum-Kur 'READY' 6
$t += 0.2; Frez-Omru-Tik $t
Dogru ([System.IO.File]::Exists($dosya)) 'sayma bitince (RUNNING -> READY) dosya yazıldı'
Dogru (-not $script:FrezOmruKirli) 'kirli bayrağı temizlendi'
Dogru (-not [System.IO.File]::Exists($dosya + '.tmp')) 'geçici dosya kalmadı'
# sayılırken 30 sn'de bir
[System.IO.File]::Delete($dosya)
Durum-Kur 'RUNNING' 3
$script:FrezOmruSonKayit = $t
Frez-Omru-Tik $t
for ($i = 0; $i -lt 100; $i++) { $t += 0.2; Frez-Omru-Tik $t }   # 20 sn
Dogru (-not [System.IO.File]::Exists($dosya)) '20 sn sayarken henüz yazılmadı'
for ($i = 0; $i -lt 55; $i++) { $t += 0.2; Frez-Omru-Tik $t }   # 31 sn
Dogru ([System.IO.File]::Exists($dosya)) '30 sn dolunca sayarken de yazıldı'
Durum-Kur 'READY' 3; $t += 0.2; Frez-Omru-Tik $t
$script:FrezOmru[1] = @{ Dakika = 100.0; Omur = 1000.0; Sifirlama = '2026-11-01 08:30:00' }
$script:FrezOmru[42] = @{ Dakika = 12.3456; Omur = 0.0; Sifirlama = '' }
Kulturde 'tr-TR' { Frez-Omru-Kaydet }
$metin = [System.IO.File]::ReadAllText($dosya)
Bilgi $metin
Dogru ($metin -match '"T1":\{"Dakika":100,"Omur":1000,') 'sayılar InvariantCulture (tr-TR''de virgül yok)'
Dogru ($metin -match '"Dakika":12\.3456') 'ondalık nokta ile'
$beklenen = @{}; foreach ($n in $script:FrezOmru.Keys) { $beklenen[$n] = [double]$script:FrezOmru[$n].Dakika }
$script:FrezOmru = @{}
Kulturde 'zh-CN' { Frez-Omru-Yukle }
Esit $beklenen.Count $script:FrezOmru.Count 'gidiş-dönüş: takım sayısı'
$fark = 0; foreach ($n in $beklenen.Keys) { if ([math]::Abs($beklenen[$n] - (Dk $n)) -gt 1e-4) { $fark++ } }
Esit 0 $fark 'gidiş-dönüş: dakikalar (zh-CN)'
Esit 1000.0 ([double]$script:FrezOmru[1].Omur) 'gidiş-dönüş: ömür'
Esit '2026-11-01 08:30:00' ([string]$script:FrezOmru[1].Sifirlama) 'gidiş-dönüş: sıfırlama tarihi'
Dogru ($script:FrezOmru.ContainsKey(42)) 'diğer takım (T42) da kalıcı'
# bozuk / eksik
$saglam = $metin
[System.IO.File]::WriteAllText($dosya, '{"Surum":1,"Takimlar":{"T1":{"Dakika":12')
$script:UiKayit.Clear()
Frez-Omru-Yukle
Esit 0 $script:FrezOmru.Count 'bozuk dosya: boş başlandı'
Dogru ($script:FrezOmruOkumaHatasi) 'bozuk dosya: hata bayrağı (bir kez günlüğe)'
Dogru (@(Get-ChildItem -LiteralPath $ScriptKlasor -Filter 'frez_omru.json.bozuk_*').Count -eq 1) 'bozuk dosya saklandı (frez_omru.json.bozuk_*)'
[System.IO.File]::WriteAllText($dosya, 'çöp')
Frez-Omru-Yukle
Esit 0 $script:FrezOmru.Count 'ikinci bozuk okuma: boş, istisna yok'
[System.IO.File]::Delete($dosya)
Frez-Omru-Yukle
Esit 0 $script:FrezOmru.Count 'dosya yok: boş'
[System.IO.File]::WriteAllText($dosya, '{"Surum":1,"Takimlar":{"T2":{"Dakika":-5,"Omur":"abc"}}}')
$h0 = $false; try { Frez-Omru-Yukle } catch { $h0 = $true }
Dogru (-not $h0) 'geçersiz değerler istisna atmaz'

# ------------------------------------------------------------------ 3) yüzde, durum nesnesi, ayar, sıfırlama
Bolum 'Yüzde ve MakineDurumu'
Sayac-Sifirla
$script:FrezOmru[1] = @{ Dakika = 100.0; Omur = 1000.0; Sifirlama = '' }
$script:FrezOmru[2] = @{ Dakika = 50.0; Omur = 0.0; Sifirlama = '' }
$script:FrezOmru[9] = @{ Dakika = 0.0; Omur = 300.0; Sifirlama = '' }
$script:FrezOmru[12] = @{ Dakika = 7.25; Omur = 0.0; Sifirlama = '2026-11-02 07:05:00' }
Yakin 10.0 (Frez-Omru-Yuzde 1) 1e-9 'T1: 1000 dk ömür, 100 dk kullanım -> %10'
Esit (-1.0) (Frez-Omru-Yuzde 2) 'ömür girilmedi -> -1'
Esit (-1.0) (Frez-Omru-Yuzde 4) 'kayıt yok -> -1'
$l = Frez-Omru-Liste
Esit 7 $l.Count 'liste: T1–T6 + dakikası olan diğer (T12); T9 (0 dk) yok'
Esit 12 $l[6].Takim 'diğer takım sonda'
Esit '02.11.2026 07:05' $l[6].Sifirlama 'sıfırlama tarihi ekran biçiminde'
Yakin 10.0 $l[0].Yuzde 1e-9 'FrezOmruBilgisi.Yuzde %10'
Esit 0 $l[0].Seviye 'seviye 0 (< %80)'
$l2 = New-Object PrimerUI.FrezOmruBilgisi(3, 850, 1000, ''); Esit 1 $l2.Seviye '%85 -> seviye 1 (kehribar)'
$l3 = New-Object PrimerUI.FrezOmruBilgisi(3, 1000, 1000, ''); Esit 2 $l3.Seviye '%100 -> seviye 2 (kırmızı)'
$l4 = New-Object PrimerUI.FrezOmruBilgisi(3, 5000, 0, ''); Esit 0 $l4.Seviye 'ömür yok -> seviye 0'
$script:Hizli.Takim = 1
$d = Durum-Topla
Esit 7 $d.FrezOmurleri.Count 'Durum-Topla FrezOmurleri doldurdu'
Yakin 100.0 $d.FrezOmurleri[0].Dakika 1e-9 'MakineDurumu T1 dakika'

Bolum 'Ömür ayarı (frez.omur.ayarla)'
$script:SahteSayi = 1000.5
function script:Ui-Sayi([string]$baslik, [double]$mevcut, [double]$min, [double]$max, [int]$ondalik = 3) { Ui-Not "SAYI [$baslik] $mevcut $min-$max"; return $script:SahteSayi }
Esit $true (Komut-Isle 'frez.omur.ayarla' 'T4') 'ayarla T4 (sayı girişi)'
Esit 1000.5 ([double]$script:FrezOmru[4].Omur) 'T4 ömrü 1000.5 dk'
Dogru (($script:UiKayit -join "`n") -match 'SAYI \[T4 frez ömrü \(dakika, 0 = girilmedi\)\] 0 0-100000') 'sayı diyaloğu 0–100000 aralığıyla açıldı'
$script:SahteSayi = $null
[void](Komut-Isle 'frez.omur.ayarla' 'T4')
Esit 1000.5 ([double]$script:FrezOmru[4].Omur) 'VAZGEÇ: değişmedi'
Kulturde 'tr-TR' { [void](Komut-Isle 'frez.omur.ayarla' 'T5=1200,5') }
Esit 1200.5 ([double]$script:FrezOmru[5].Omur) 'virgüllü giriş "1200,5" (tr-TR) -> 1200.5'
[void](Komut-Isle 'frez.omur.ayarla' 't6=750.25')
Esit 750.3 ([double]$script:FrezOmru[6].Omur) 'noktalı giriş, 0.1 dk''ya yuvarlanır'
$script:UiKayit.Clear()
[void](Komut-Isle 'frez.omur.ayarla' 'T6=100001')
Esit 750.3 ([double]$script:FrezOmru[6].Omur) 'aralık dışı (100001) reddedildi'
Dogru (($script:UiKayit -join "`n") -match 'Ömür 0–100000') 'aralık dışı: uyarı'
[void](Komut-Isle 'frez.omur.ayarla' 'T6=-1'); Esit 750.3 ([double]$script:FrezOmru[6].Omur) 'negatif reddedildi'
[void](Komut-Isle 'frez.omur.ayarla' 'T6=abc'); Esit 750.3 ([double]$script:FrezOmru[6].Omur) 'sayı olmayan reddedildi'
[void](Komut-Isle 'frez.omur.ayarla' 'T6=0'); Esit 0.0 ([double]$script:FrezOmru[6].Omur) '0 = ömür girilmedi'
[void](Komut-Isle 'frez.omur.ayarla' 'T0=5'); Dogru (-not $script:FrezOmru.ContainsKey(0)) 'T0 geçersiz'
Dogru ([System.IO.File]::ReadAllText($dosya) -match '"T5":\{"Dakika":0,"Omur":1200\.5,') 'ayar hemen dosyaya yazıldı'
Esit '' (Izin-Neden 'frez.omur.ayarla' 'T1') 'ayarla her zaman serbest'

Bolum 'Sıfırlama (frez.omur.sifirla)'
$script:FrezOmru[3] = @{ Dakika = 1050.0; Omur = 1000.0; Sifirlama = '' }
$script:SahteOnay = $false
[void](Komut-Isle 'frez.omur.sifirla' 'T3')
Esit 1050.0 (Dk 3) 'VAZGEÇ: sıfırlanmadı'
Dogru (($script:UiKayit -join "`n") -match 'ONAY \[Yeni frez\] T3 frezi değişti mi\?') 'normal onay soruldu'
$script:SahteOnay = $true
[void](Komut-Isle 'frez.omur.sifirla' 'T3')
Esit 0.0 (Dk 3) 'onay: T3 sıfırlandı'
Esit 1000.0 ([double]$script:FrezOmru[3].Omur) 'ömür ayarı korundu'
Dogru ([string]$script:FrezOmru[3].Sifirlama -match '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$') 'sıfırlama tarihi yazıldı'
$log = [System.IO.File]::ReadAllText([Kayit]::Dosya)
Dogru ($log -match 'T3 sıfırlandı \(yeni frez\)\. Eski kullanım 1050 dk / 1000 dk ömür') 'eski değer günlüğe yazıldı'

# ------------------------------------------------------------------ 4) EdingSim ile gerçek iş
Bolum 'EdingSim işi: T1 sonra T2'
$script:IsAktif = $false; $script:Hizli.Takim = 0; $script:Hizli.Durum = ''
Dogru (Baglan) 'Baglan (EdingSim)'
[void](Komut-Isle 'home' ''); Dogru (Bekle-Kosul { [Eding]::CncGetAllAxesHomed() -ne 0 } 20) 'home'
foreach ($nv in @(@(4010, -125.557), @(4011, -89.166), @(4012, -77.166), @(4013, -65.166), @(4014, -35.166), @(4015, -23.166), @(4016, -11.166), @(4017, 23.0), @(4020, -125.0), @(4021, -53.0), @(4031, -64.25), @(4032, -52.0))) { [Eding]::SimDegiskenYaz($nv[0], $nv[1]) }
Okuma-Yap; Raf-Kontrol
$isSatir = @('%', '(frez omru testi)', 'G0 G17 G40 G49 G54 G80 G90', 'T1 M6', 'S18000 M3') + @(1..600 | ForEach-Object { 'G1 X{0} Y{1} Z-1 F1200' -f (($_ % 20) - 10), (($_ % 7) - 3) }) +
    @('T2 M6') + @(1..600 | ForEach-Object { 'G1 X{0} Y{1} Z-1 F1200' -f (($_ % 20) - 10), (($_ % 7) - 3) }) + @('M5', 'G0 Z10', 'M30', '%')
[System.IO.File]::WriteAllLines([System.IO.Path]::Combine($IsKlasor, 'omur_is.nc'), [string[]]$isSatir)
$script:SahteListe = 'omur_is.nc'
[void](Komut-Isle 'is.sec' '')
Dogru (-not $script:Engel) 'iş seçildi, kontrolden geçti' (($script:SonHatalar) -join ' | ')
Esit 'T1 · T2' $script:SonDurumNesnesi.IsTakimlari 'iş takımları T1 · T2 (NcAnaliz)'
Sayac-Sifirla
$script:FrezOmru[1] = @{ Dakika = 0.0; Omur = 1000.0; Sifirlama = '' }
[Eding]::SimHizCarpani = 1.0; [Eding]::SimSatirHizi = 100.0   # 1200 satır ~12 sn (+ takım değişimi RUN-SUB)
$script:SahteOnay = $true
$basla = Get-Date
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT'
$runSubGoruldu = $false; $sonT = 0
$son = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $son) {
    Tik 1
    if ($script:Hizli.Durum -eq 'RUN-SUB') { $runSubGoruldu = $true }
    if (-not $script:IsAktif -and ((Get-Date) - $basla).TotalSeconds -gt 3) { break }
    Start-Sleep -Milliseconds 50
}
Tik 3
$sure = ((Get-Date) - $basla).TotalSeconds
Bilgi ("iş {0:0.0} sn; T1 {1:0.000} dk, T2 {2:0.000} dk, RUN-SUB görüldü: {3}" -f $sure, (Dk 1), (Dk 2), $runSubGoruldu)
Dogru (-not $script:IsAktif) 'iş bitti'
Dogru ((Dk 1) -gt 0.05 -and (Dk 2) -gt 0.05) 'iki takıma da süre yazıldı'
Dogru (((Dk 1) + (Dk 2)) * 60 -le $sure + 0.5) 'toplam sayılan süre gerçek süreyi geçmez'
Dogru (((Dk 1) + (Dk 2)) * 60 -ge 8.0) "kesim süresinin çoğu sayıldı ($([math]::Round(((Dk 1) + (Dk 2)) * 60, 1)) sn, 1200 satır / 100 satır/sn)"
Dogru ([math]::Abs((Dk 1) - (Dk 2)) * 60 -lt 3.0) 'eşit satır sayısı: T1 ve T2 süreleri yakın'
Dogru ([System.IO.File]::ReadAllText($dosya) -match '"T2":\{"Dakika":0\.\d+') 'iş sonunda dosyaya yazıldı'
Dogru ($null -eq (Uzak-Durum) -or $true) 'uzak durum JSON hatasız'
Dogru ([string][WebSunucu]::DurumJson -match '"frezOmru"') 'uzak durum JSON frezOmru alanı'

# ------------------------------------------------------------------ 5) BAŞLAT uyarısı ve sıfırlama izni
Bolum 'BAŞLAT: ömür uyarısı'
$script:FrezOmru[1] = @{ Dakika = 1050.0; Omur = 1000.0; Sifirlama = '' }
$script:FrezOmru[2] = @{ Dakika = 10.0; Omur = 1000.0; Sifirlama = '' }
$script:UiKayit.Clear()
$script:SahteOnay = $false
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT (komut işlendi)'
$k = ($script:UiKayit -join "`n")
Dogru ($k -match '(?s)ONAY \[Frez ömrü\].*T1 ömrünü doldurdu: 1050/1000 dk\.') 'onay: "T1 ömrünü doldurdu: 1050/1000 dk."' $k
Dogru ($k -match 'Yine de başlatılsın mı\?') 'onay: "Yine de başlatılsın mı?"'
Dogru ($k -notmatch 'T2 ömrünü') 'T2 (%1) listede yok'
Start-Sleep -Milliseconds 300
Dogru ((Eding-Durum) -notlike 'RUN*' -and -not $script:IsAktif) 'VAZGEÇ: iş başlamadı (G-kod / hareket yok)'
$script:FrezOmru[1] = @{ Dakika = 920.0; Omur = 1000.0; Sifirlama = '' }
$script:UiKayit.Clear()
Frez-Omru-Baslat-Kontrol | Out-Null
$k = ($script:UiKayit -join "`n")
Dogru ($k -notmatch 'ONAY \[Frez ömrü\]' -and $k -match 'BILDIR \[Uyari\] Frez ömrüne yaklaştı: T1 %92 \(920/1000 dk\)') '%92: soru yok, alt şerit uyarısı' $k
$script:FrezOmru[1] = @{ Dakika = 1050.0; Omur = 1000.0; Sifirlama = '' }
$script:SahteOnay = $true
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT, uyarı onaylandı'
Dogru (Bekle-Kosul { Okuma-Yap; $script:Hizli.Calisiyor } 10) 'onaylanınca iş başladı'
Okuma-Yap
$c = Izin-Baglam
Dogru ((Izin-Neden 'frez.omur.sifirla' 'T1') -like 'İş sürüyor ve bu iş T1*') 'iş sürerken bu işin frezi (T1) sıfırlanamaz'
Esit '' (Izin-Neden 'frez.omur.sifirla' 'T5') 'işin kullanmadığı T5 sıfırlanabilir'
Esit '' (Izin-Neden 'frez.omur.ayarla' 'T1') 'ömür ayarı iş sürerken de serbest'
$iz = Izin-Hesapla
Dogru ($iz.ContainsKey('frez.omur.sifirla:T1') -and $iz.ContainsKey('frez.omur.sifirla:T2') -and -not $iz.ContainsKey('frez.omur.sifirla:T5') -and -not $iz.ContainsKey('frez.omur.sifirla')) 'izin tablosu: düğme başına (T1, T2 pasif; T5 ve genel anahtar etkin)'
[void](Komut-Isle 'is.durdur' ''); Tik 5
Okuma-Yap
Esit '' (Izin-Neden 'frez.omur.sifirla' 'T1') 'iş bitince T1 sıfırlanabilir'

Bolum 'Demo örnek verisi'
Sayac-Sifirla
[System.IO.File]::Delete($dosya)
Frez-Omru-Demo-Hazirla
Dogru ($script:FrezOmru.Count -eq 6 -and [System.IO.File]::Exists($dosya)) 'demo: örnek veri yazıldı (demo veri klasöründe)'
Dogru ((Frez-Omru-Yuzde 3) -ge 100 -and (Frez-Omru-Yuzde 2) -ge 80 -and (Frez-Omru-Yuzde 2) -lt 100 -and (Frez-Omru-Yuzde 5) -lt 0) 'demo: kırmızı, kehribar ve ömürsüz örnek var'
$script:FrezOmru[1].Dakika = 1.0; Frez-Omru-Kaydet
Frez-Omru-Demo-Hazirla
Esit 1.0 (Dk 1) 'dosya varken demo verisi üstüne yazmaz'
Dogru ($FrezOmruDosyasi.StartsWith($ScriptKlasor)) 'dosya veri klasöründe ($ScriptKlasor; demoda demo_calisma)'

Ozet 'Frez ömrü'
