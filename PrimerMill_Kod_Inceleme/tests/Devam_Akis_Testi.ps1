# Devam_Akis_Testi.ps1 - "Kaldığı yerden devam" UÇTAN UCA (panel mantığı + EdingSim, Eding'siz):
#   iş başlar -> ortasında DURDUR / Eding hatası / panel yeniden açılır -> BAŞLAT -> KALDIĞI YERDEN
#   Eding'e yüklenen devam programının asıl işin DURDUĞU YERİN hemen gerisinden başladığı denetlenir.
# Çalıştırma: pwsh -NoProfile -File tests/Devam_Akis_Testi.ps1 [-Kaynak teslim/PrimerMill]   PS 5.1 uyumlu.
param([string]$Kaynak = '')
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
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'FrezOmru', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'Demo')) { . ([System.IO.Path]::Combine($lib, "$m.ps1")) }
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

function Bekle-Kosul([scriptblock]$kosul, [double]$sn = 10) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 20 }
    return [bool](& $kosul)
}
function Tik([int]$n = 1) { for ($i = 0; $i -lt $n; $i++) { Zamanlayici-Tik } }

$script:DevamSecimi = 'tam'
function script:Ui-Devam([string]$dosya, [string]$bilgi, [int]$takim, [int]$kirik = 0) { Ui-Not "DEVAM $dosya$(if ($kirik -gt 0) { " kirik=$kirik" }) | $bilgi"; return @{ Secim = $script:DevamSecimi; Takim = $takim } }
function SimSatir { $m = [regex]::Match([Eding]::SimDurum(), 'satir=(\d+)/(\d+)'); return [int]$m.Groups[1].Value }
function SimDosya { return ([regex]::Match([Eding]::SimDurum(), 'dosya=(\S+)')).Groups[1].Value }

# İş: ZY2_45 (69 751 satır, işlem içinde 20 000+ satır güvenli nokta yok)
$kaynakIs = GKod-Girdi 'ZY2_45_eding.nc'
$L = [System.IO.File]::ReadAllLines($kaynakIs)
function Son-ZSafe([int]$satir) { for ($i = $satir - 1; $i -ge 0; $i--) { if ($L[$i] -match '(?i)^\s*(N\d+\s*)?GOSUB\s+Z_SAFE\b') { return $i + 1 } }; return 1 }

Bolum 'Hazırlık'
Dogru (Baglan) 'Baglan (EdingSim)'
[void](Komut-Isle 'home' ''); Dogru (Bekle-Kosul { [Eding]::CncGetAllAxesHomed() -ne 0 } 20) 'home'
$script:SahteListe = 'ZY2_45_eding.nc'
[System.IO.File]::Copy($kaynakIs, [System.IO.Path]::Combine($IsKlasor, 'ZY2_45_eding.nc'), $true)
[void](Komut-Isle 'is.sec' '')
Dogru ($script:SeciliDosya -like '*ZY2_45_eding.nc') "iş seçildi: $($script:SeciliDosya)"
foreach ($nv in @(@(4010, -125.557), @(4011, -89.166), @(4012, -77.166), @(4013, -65.166), @(4014, -35.166), @(4015, -23.166), @(4016, -11.166), @(4017, 23.0), @(4020, -125.0), @(4021, -53.0), @(4031, -64.25), @(4032, -52.0))) { [Eding]::SimDegiskenYaz($nv[0], $nv[1]) }
Okuma-Yap; Raf-Kontrol
Dogru (-not $script:RafEksik) 'yuvalar kayıtlı'

function Is-Calistir-Satira([int]$hedef, [double]$hiz = 6000.0) {
    [Eding]::SimHizCarpani = 1.0; [Eding]::SimSatirHizi = $hiz
    $son = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $son -and (SimSatir) -lt $hedef) { Tik 1; Start-Sleep -Milliseconds 30 }
    Tik 3
}

Bolum '1) DURDUR ile yarıda kalan iş'
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT'
Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) 'iş çalışıyor'
Is-Calistir-Satira 30000
$durdu = SimSatir
Bilgi "Eding satırı: $durdu, panel satırı: $($script:SonGecerliSatir)"
Esit $true (Komut-Isle 'is.durdur' '') 'DURDUR'
Tik 10
$k = Devam-Oku
Dogru ($null -ne $k) 'devam.json yazıldı'
Dogru ([int]$k.Satir -ge $durdu - 3000 -and [int]$k.Satir -le $durdu + 10) "devam.json satırı durduğu yer ($($k.Satir) ~ $durdu)"
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT (yarım kalan iş)'
Dogru (($script:UiKayit -join "`n") -match 'DEVAM ') 'devam penceresi soruldu'
Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) 'devam programı çalışıyor'
Dogru ((SimDosya) -like '*_devam.nc') "Eding'e devam programı yüklendi ($(SimDosya))"
$dv = [System.IO.File]::ReadAllLines([System.IO.Path]::Combine($IsKlasor, 'ZY2_45_eding_devam.nc'))
$bas = $script:DevamHarita.Orijinal
$anz = [NcAnaliz]::Oku($kaynakIs, 4000.0)
function Geri-Sn([int]$bas, [int]$dur) { return $anz.Kumulatif[$dur - 1] - $anz.Kumulatif[$bas - 1] }
Dogru ($bas -gt (Son-ZSafe ([int]$k.Satir)) -and $bas -le [int]$k.Satir -and (Geri-Sn $bas ([int]$k.Satir)) -le 15) "asıl işte satır $bas'den sürüyor: durduğu $($k.Satir), ~$([math]::Round((Geri-Sn $bas ([int]$k.Satir)),1)) sn geriden (eski davranış: satır $(Son-ZSafe ([int]$k.Satir)))"
Esit $L[$bas - 1] $dv[$script:DevamHarita.Bas - 1] 'devam dosyası asıl işin o satırıyla sürüyor'

Bolum '2) Devam ederken ikinci kez yarıda kalırsa: satır asıl dosyaya göre kaydedilir'
Is-Calistir-Satira ($script:DevamHarita.Bas + 2000)
Esit $true (Komut-Isle 'is.durdur' '') 'DURDUR (devam programında)'
Tik 10
$k2 = Devam-Oku
$orj1 = $script:DevamHarita.Orijinal
Dogru ([int]$k2.Satir -gt $orj1 -and [int]$k2.Satir -le $orj1 + 2600) "devam.json asıl dosyaya göre: devam başı $orj1 + ~2000 satır = $($k2.Satir)"
Dogru ([string]$k2.Kaynak -notlike '*_devam.nc') "kaynak hâlâ asıl iş ($([System.IO.Path]::GetFileName([string]$k2.Kaynak)))"

Bolum '3) Panel / elektrik kesildi: panel yeniden açılınca'
Panel-Sifirla
$script:DevamHarita = $null; $script:DevamKaynak = $null
Devam-Acilis
Dogru ($script:SeciliDosya -like '*ZY2_45_eding.nc') 'açılışta yarım kalan iş seçili'
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT'
Dogru (($script:UiKayit -join "`n") -match 'DEVAM ') 'devam penceresi soruldu'
Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) 'devam programı çalışıyor'
$b3 = $script:DevamHarita.Orijinal
Dogru ($b3 -le [int]$k2.Satir -and (Geri-Sn $b3 ([int]$k2.Satir)) -le 15) "asıl işte satır $b3'den (durduğu $($k2.Satir), ~$([math]::Round((Geri-Sn $b3 ([int]$k2.Satir)),1)) sn geriden)"
[void](Komut-Isle 'is.durdur' ''); Tik 5

Bolum '4) RESET sonrası iş yeniden seçilince'
$script:SahteSecim = 1   # takım durumu belirsiz sorusu (DURDUR takım değişimi sırasında geldi): iş milinde T1
[void](Komut-Isle 'makine.reset' ''); Tik 3
$script:SahteListe = 'ZY2_45_eding.nc'
[void](Komut-Isle 'is.sec' '')
$k3 = Devam-Oku
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT'
Bilgi (($script:UiKayit | Select-Object -Last 6) -join ' || ')
Dogru (($script:UiKayit -join "`n") -match 'DEVAM ') 'RESET + yeniden seçimden sonra da devam penceresi soruldu'
[void](Komut-Isle 'is.durdur' ''); Tik 5

# ------------------------------------------------------------------ Senaryo 1: her durma yolu satırı kaydeder
function Yeni-Is([string]$ad, [int]$hedef) {
    $script:TakimBelirsiz = $false; $script:Tercih.TakimBelirsiz = '0'
    Devam-Sil; $script:DevamHarita = $null
    $script:SahteListe = $ad
    [void](Komut-Isle 'is.sec' '')
    Esit $true (Komut-Isle 'is.baslat' '') "BAŞLAT (yeni iş $ad)"
    Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) 'iş çalışıyor'
    Is-Calistir-Satira $hedef
    return [int]$script:SonGecerliSatir
}
function Devam-Dogrula([string]$ne, [int]$kayitSatir) {
    $script:UiKayit.Clear()
    Esit $true (Komut-Isle 'is.baslat' '') "BAŞLAT ($ne sonrası)"
    Dogru (($script:UiKayit -join "`n") -match 'DEVAM ') "$ne sonrası devam penceresi soruldu"
    Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) "$ne sonrası devam programı çalışıyor"
    $b = $script:DevamHarita.Orijinal
    Dogru ($b -le $kayitSatir -and (Geri-Sn $b $kayitSatir) -le 15) "$ne : asıl işte satır $b'den (kayıt $kayitSatir, ~$([math]::Round((Geri-Sn $b $kayitSatir),1)) sn geriden)"
    [void](Komut-Isle 'is.durdur' ''); Tik 5
}

Bolum '5) EXTERR (hava basıncı düştü / makine hata sinyali)'
$script:SahteSecim = 1
$dur = Yeni-Is 'ZY2_45_eding.nc' 20000
[Eding]::SimAcilStop($true); $dur = SimSatir; Tik 8
$k = Devam-Oku
Esit 'exterr' ([string]$k.Durum) 'devam.json durumu exterr'
Dogru ([math]::Abs([int]$k.Satir - $dur) -le 300) "EXTERR: kayıt satırı durduğu yer ($($k.Satir) ~ $dur)"
Dogru (($script:UiKayit -join "`n") -match 'HATA SİNYALİYLE') 'EXTERR penceresi gösterildi'
[Eding]::SimAcilStop($false)
[void](Komut-Isle 'makine.reset' ''); Tik 3
Dogru ($script:SeciliDosya -like '*ZY2_45_eding.nc') 'ALARMI TEMİZLE sonrası yarım iş kendiliğinden seçili'
Devam-Dogrula 'EXTERR' ([int]$k.Satir)

Bolum '6) ACİL STOP (panel)'
$dur = Yeni-Is 'ZY2_45_eding.nc' 15000
[void](Komut-Isle 'acilstop' ''); $dur = SimSatir; Tik 3
$k = Devam-Oku
Esit 'acil' ([string]$k.Durum) 'ACİL STOP: devam.json durumu acil (eskiden yalnız 2 sn önceki "calisiyor" kaydı kalıyordu)'
# ACİL STOP önce makineyi durdurur (ED-08), Eding'e satır sormaz: kayıt son tıktaki satırdır (en çok ~1 sn geride; 'tam' devam
# zaten ~10 sn geriden başlar). Test Eding'i saniyede 6000 satır koşturduğu için pay geniş.
Dogru ([int]$k.Satir -le $dur -and [int]$k.Satir -ge $dur - 6500) "ACİL STOP: kayıt satırı durduğu yerde ya da hemen gerisinde ($($k.Satir) <= $dur)"
[void](Komut-Isle 'acilstop.kaldir' ''); Tik 3
Dogru (-not [Eding]::AcilKilit) 'ACİL STOP kaldırıldı'
Dogru ($script:SeciliDosya -like '*ZY2_45_eding.nc') 'kilit kaldırılınca yarım iş seçili'
Devam-Dogrula 'ACİL STOP' ([int]$k.Satir)

Bolum '7) Eding çöktü / bağlantı koptu'
$dur = Yeni-Is 'ZY2_45_eding.nc' 12000
$script:DemoEdingAcik = $false; $script:SonSunucuKontrol = [datetime]::MinValue; $script:SonEdingBaslatma = Get-Date
Tik 5   # bağlantı bekçisi 5 tıkta bir
$k = Devam-Oku
Esit 'eding_kapandi' ([string]$k.Durum) 'Eding kapandı: devam.json durumu eding_kapandi'
Dogru ([math]::Abs([int]$k.Satir - $dur) -le 300) "Eding kapandı: kayıt satırı durduğu yer ($($k.Satir) ~ $dur)"
Esit 1 ([int]$k.Takim) 'Eding kapandı: takım son bilinen (T1), kopuk sunucuya sorulmadı'
Dogru (-not $script:IsAktif) 'iş takibi bırakıldı'
# Eding yeniden açıldı (iş Eding'de kaybolmuş)
$script:DemoEdingAcik = $true; Dogru (Baglan) 'yeniden bağlandı'
[void][Eding]::CncAbortJob(); Tik 3; [void](Komut-Isle 'makine.reset' ''); Tik 3
Devam-Dogrula 'Eding kopması' ([int]$k.Satir)

Bolum '8) Duraklatılmışken ve takım değişince de kaydedilir'
$dur = Yeni-Is 'ZY2_45_eding.nc' 9000
[void](Komut-Isle 'is.duraklat' ''); Tik 2
$z1 = $script:DevamSonYazma
Start-Sleep -Milliseconds 2200; Tik 5
Dogru ($script:DevamSonYazma -gt $z1) 'duraklıyken 2 sn sonra yeniden kaydedildi'
Esit 'calisiyor' ([string](Devam-Oku).Durum) 'duraklıyken kayıt sürüyor'
[void](Komut-Isle 'is.durdur' ''); Tik 5
Esit 'durduruldu' ([string](Devam-Oku).Durum) 'DURDUR: durum durduruldu'

# ------------------------------------------------------------------ Senaryo 2: takım boyu ölçümünde kırık frez
Bolum '9) Kırık frez: T1 -> T2 -> T5 işinde T2 kırık bulundu'
$C0 = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt 20000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $C0.Add('M5'); $C0.Add('T2 M6'); $t2 = $C0.Count; $C0.Add('S18000 M3')
for ($i = 20000; $i -lt 40000; $i++) { $C0.Add($L[$i]) }
$C0.Add('M100'); $m100 = $C0.Count; $C0.Add('T5 M6'); $t5 = $C0.Count; $C0.Add('S20000 M3')
for ($i = 40000; $i -lt $L.Length; $i++) { $C0.Add($L[$i]) }
[System.IO.File]::WriteAllLines([System.IO.Path]::Combine($IsKlasor, 'COK_TAKIM.nc'), $C0)
Bilgi "COK_TAKIM.nc: T2 M6 satır $t2, T2'nin M100'ü $m100, T5 M6 satır $t5"
$dur = Yeni-Is 'COK_TAKIM.nc' ($m100 - 3000)
Is-Calistir-Satira ($m100 - 40) 400.0   # M100'e yavaş yaklaş (T5 değişimine geçmeden)
Esit 2 ([Eding]::CncGetCurrentToolNumber()) "Eding'de T2"
# makro m100: |#4002 - ölçülen| = 1.84 > #4005 (0.2) -> errmsg (Eding hata durumunda), iş durur; kırık T2 iş milinde kalır
[Eding]::SimDegiskenYaz(4099, 1.84); [Eding]::SimHata(); Tik 8
$k = Devam-Oku
Esit 2 (Devam-Kirik $k) 'devam.json: Kirik = 2'
Esit 'kirik' ([string]$k.Durum) 'devam.json durumu kirik'
Dogru ([int]$k.KirikSatir -gt $t2 -and [int]$k.KirikSatir -le $m100) "KirikSatir T2'nin işi içinde ($($k.KirikSatir))"
$ui = ($script:UiKayit -join "`n")
Dogru ($ui -match 'FREZE HATASI' -and $ui -match 'PENS AÇ ile kırık frezi çıkar' -and $ui -match "T2'NİN İŞİNİ BAŞTAN") 'FREZE HATASI penceresi sonraki adımları anlatıyor'
[void](Komut-Isle 'makine.reset' ''); Tik 3
Dogru ($script:SeciliDosya -like '*COK_TAKIM.nc') 'ALARMI TEMİZLE sonrası kırık işin dosyası seçili'

Bolum '9a) Kırık frez: yalnız T2''nin işi / tüm iş / vazgeç sunulur'
$script:DevamSecimi = 'tam'   # kırık kaydında geçersiz seçim: yok sayılır
$script:UiKayit.Clear()
[void](Komut-Isle 'is.baslat' ''); Tik 2
Dogru (($script:UiKayit -join "`n") -match 'DEVAM COK_TAKIM kirik=2') 'devam penceresi kırık T2 kipinde açıldı'
Dogru (-not $script:IsAktif -and (Eding-Durum) -notlike 'RUN*') "'tam' (kaldığı yerden) kırık kaydında kabul edilmedi"

Bolum '9b) Kırık frez iş milinde (Eding T2): çıkarıldı onayı yoksa başlamaz'
$script:DevamSecimi = 'frez'; $script:SahteOnay = $false
$script:UiKayit.Clear()
[void](Komut-Isle 'is.baslat' ''); Tik 2
Dogru (($script:UiKayit -join "`n") -match 'Kırık frez iş milinden çıkarıldı mı\? \(PENS AÇ\)') 'operatöre "Kırık frez iş milinden çıkarıldı mı? (PENS AÇ)" soruldu'
Dogru (-not $script:IsAktif -and (Eding-Durum) -notlike 'RUN*') 'onay yok: başlamadı'
Esit 2 ([Eding]::CncGetCurrentToolNumber()) "Eding'de hâlâ T2 (hiçbir şey gönderilmedi)"
Esit 2 (Devam-Kirik (Devam-Oku)) 'kırık kaydı duruyor'

Bolum '9c) Kırık frez çıkarıldı, yeni T2 takıldı: T2''nin işi baştan'
$script:SahteOnay = $true
(Frez-Omru-Kayit 2).Dakika = 50.0
$script:UiKayit.Clear()
Esit $true (Komut-Isle 'is.baslat' '') 'BAŞLAT'
$ui = ($script:UiKayit -join "`n")
Dogru ($ui -match 'Yeni frez takıldı: T2 ömrü sıfırlansın mı') 'frez ömrü sıfırlama soruldu'
Esit 0.0 ([double](Frez-Omru-Kayit 2).Dakika) 'T2 ömrü sıfırlandı'
Dogru (@($script:KayitListesi | Where-Object { [string]$_.Metin -match "iş milindeki frez T0 bildiriliyor" }).Count -ge 1) "Eding'e T0 bildirildi (hareketsiz)"
Dogru (Bekle-Kosul { (Eding-Durum) -like 'RUN*' } 10) 'program çalışıyor'
Dogru ((SimDosya) -like '*COK_TAKIM_devam.nc') "Eding'e devam programı yüklendi ($(SimDosya))"
Esit $t2 ([int]$script:DevamHarita.Orijinal) "asıl işte T2 M6 satırından ($t2) başlıyor"
$dv = [System.IO.File]::ReadAllLines([System.IO.Path]::Combine($IsKlasor, 'COK_TAKIM_devam.nc'))
Esit 'T2 M6' $dv[$script:DevamHarita.Bas - 1] 'devam programının asıl iş kısmı T2 M6 satırıyla başlıyor'
Dogru (@($dv | Select-Object -First ($script:DevamHarita.Bas - 1) | Where-Object { $_ -match '(?i)\bM0*6\b' }).Count -eq 0) 'başlıkta takım değişimi yok (değişimi T2 M6 satırı yapar)'
$k2 = Devam-Oku
Esit 0 (Devam-Kirik $k2) 'başlayınca kırık kaydı temizlendi'
Esit $t2 ([int]$k2.Satir) 'yeni kayıt T2 M6 satırında'
Is-Calistir-Satira ($script:DevamHarita.Bas + 100)
Esit 2 ([Eding]::CncGetCurrentToolNumber()) "programdaki T2 M6 ile Eding'de yeni T2"
[void](Komut-Isle 'is.durdur' ''); Tik 5
$k3 = Devam-Oku
Dogru ([int]$k3.Satir -ge $t2 -and [int]$k3.Satir -le $t2 + 2000) "devam programında durunca satır asıl dosyaya göre ($($k3.Satir))"

Bolum '10) Panel kapanırken iş sürüyorsa son satır kaydedilir'
$dur = Yeni-Is 'ZY2_45_eding.nc' 7000
Panel-Kapanis
$k = Devam-Oku
Esit 'panel_kapandi' ([string]$k.Durum) 'panel kapanışı: durum panel_kapandi'
Dogru ([math]::Abs([int]$k.Satir - $dur) -le 300) "panel kapanışı: kayıt satırı ($($k.Satir) ~ $dur)"
Ozet 'Devam akışı'
