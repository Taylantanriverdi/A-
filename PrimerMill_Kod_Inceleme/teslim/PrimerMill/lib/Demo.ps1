# Demo.ps1 - DEMO modu: gerçek Eding / makine yok, [Eding] = lib/EdingSim.cs (aynı ad, aynı üyeler, bellekte sahte makine).
# Önyükleme yalnız demo modunda, diğer lib/*.ps1 dosyalarından SONRA yükler; Eding programı / penceresi / Windows başlangıcı
# ile ilgili fonksiyonları zararsız sürümleriyle değiştirir. Mantık (iş akışı, izinler, G-kod, kalibrasyon) değişmez.
# Gerçek makinede demo kendiliğinden açılmaz: KazimaBaslat.bat /demo ya da cncapi.dll bulunamayınca sorularak.
# PowerShell 5.1 (32 bit) uyumlu.

$script:Demo = $true
$script:DemoEdingAcik = $true

function Eding-Pencere-Acik { return [bool]$script:DemoEdingAcik }
function Eding-Sunucu-Acik { return [bool]$script:DemoEdingAcik }
function Eding-Temizle { try { [void][Eding]::CncDisConnectServer() } catch { }; $script:Bagli = $false }
function Eding-Kapat-Nazik { try { [void][Eding]::CncDisConnectServer() } catch { }; $script:Bagli = $false; $script:DemoEdingAcik = $false; Yaz 'DEMO: Eding kapatıldı (sahte).' }
function Eding-Gizle-Tik { }
function Eding-Goster { $script:EdingGosteriliyor = $true; Ui-Bildir 'DEMO: gerçek Eding penceresi yok.' 'Bilgi' }
function Eding-Gizle { $script:EdingGosteriliyor = $false }
function Eding-Exe-Bul { return 'DEMO' }
function Eding-Baslat {
    if ($script:DemoEdingAcik -and $script:Bagli) { return }
    $script:DemoEdingAcik = $true
    $script:SonEdingBaslatma = Get-Date
    $script:MakroYamaBekliyor = $false
    $script:MakroKontrolTamam = $false
    Yaz 'DEMO: Eding (EdingSim) başlatıldı.'
}
function Eding-Yeniden {
    if (Is-Suruyor-Uyari 'Eding yeniden başlat') { return }
    if (-not (Onay "DEMO: sahte Eding sıfırlanacak (bütün eksenler, değişkenler cnc.ini değerlerine döner, home gerekir). Devam?" 'Eding yeniden başlat')) { return }
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    [Eding]::SimSifirla()
    $script:AcilisYeniden = $true   # GV-09: yeniden açılışta otomatik home yok (gerçek davranışla aynı)
    $script:DemoEdingAcik = $false
    Eding-Baslat
    $script:AcilisDurum = 'bekliyor'
}
function Acilis-Eding-Sifirla { }
function Macro-Pens-Yamasi { }
function Windows-Baslangic-Ayarla { }
function Eding-Baslangic-Kaldir { }

# Ekran görüntüsü turu (yalnız demo + PRIMERMILL_EKRAN ortam değişkeni: tests/Demo_Ekran_Testi.ps1).
# Her ekranı Kabuk.EkranGoster ile açar, Control.DrawToBitmap ile PNG kaydeder, sonunda paneli kapatır.
$script:EkranTuru = @('uretim', 'takimlar', 'takimlar.yuva', 'takimlar.hareket', 'takimlar.ismili', 'kalibrasyon', 'kalibrasyon.disk', 'kalibrasyon.oto',
    'ayarlar.0', 'ayarlar.1', 'ayarlar.2', 'ayarlar.3', 'ayarlar.4', 'ayarlar.5', 'ayarlar.6', 'kayitlar', 'uzaktan')
function Ekran-Turu-Baslat([string]$klasor) {
    [void][System.IO.Directory]::CreateDirectory($klasor)
    $script:EkranTuruKlasor = $klasor; $script:EkranTuruSira = 0
    $script:EkranTuruZaman = New-Object System.Windows.Forms.Timer
    $script:EkranTuruZaman.Interval = 1500
    $script:EkranTuruZaman.Add_Tick({
        try {
            $i = $script:EkranTuruSira
            if ($i -gt 0) {
                $onceki = $script:EkranTuru[$i - 1]
                $k = $script:Kabuk
                $bmp = New-Object System.Drawing.Bitmap($k.ClientSize.Width, $k.ClientSize.Height)
                $k.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)))
                $bmp.Save([System.IO.Path]::Combine($script:EkranTuruKlasor, ('{0:00}_{1}.png' -f $i, $onceki.Replace('.', '_'))), [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
            }
            if ($i -ge $script:EkranTuru.Count) { $script:EkranTuruZaman.Stop(); [Kayit]::Yaz('EKRAN TURU: bitti'); $script:Kabuk.Close(); return }
            $script:Kabuk.EkranGoster($script:EkranTuru[$i])
            $script:EkranTuruSira = $i + 1
        } catch { [Kayit]::Yaz("EKRAN TURU: $($_.Exception.Message)") }
    })
    $script:EkranTuruZaman.Start()
}
