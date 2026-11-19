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

function Bekle-Kosul([scriptblock]$kosul, [double]$sn = 10) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 20 }
    return [bool](& $kosul)
}
function Tik([int]$n = 1) { for ($i = 0; $i -lt $n; $i++) { Zamanlayici-Tik } }

$script:DevamSecimi = 'tam'
function script:Ui-Devam([string]$dosya, [string]$bilgi, [int]$takim) { Ui-Not "DEVAM $dosya | $bilgi"; return @{ Secim = $script:DevamSecimi; Takim = $takim } }
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

function Is-Calistir-Satira([int]$hedef) {
    [Eding]::SimHizCarpani = 1.0; [Eding]::SimSatirHizi = 6000.0
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

Ozet 'Devam akışı'
