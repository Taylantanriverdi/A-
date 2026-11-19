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
