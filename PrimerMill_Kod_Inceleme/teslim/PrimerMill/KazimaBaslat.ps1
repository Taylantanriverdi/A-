# ============================================================
#  PrimerMill 2 - Kazıma Paneli - DentMill X5 / Eding CNC V4.03
#  Primer Teknoloji
#  Önyükleme: yol bulma, tek kopya, C# derleme (ui/ + lib/), mantık modülleri (lib/*.ps1), kabuk, ana zamanlayıcı.
#  Eding'e P:\CNC\cncapi.dll üzerinden bağlanır (32 bit, KazimaBaslat.bat ile açılır).
#  DEMO: KazimaBaslat.bat /demo  (ya da cncapi.dll bulunamazsa sorulur) -> sahte makine (lib/EdingSim.cs).
#  Eski (düzeltilmiş) panel: KazimaBaslat_Klasik.bat
# ============================================================
param([switch]$Demo)
# KazimaBaslat.bat /demo -> PowerShell "-Demo" yerine "/demo" da gelebilir
if (-not $Demo -and @($args | Where-Object { "$_" -match '^[-/](?i)demo$' }).Count -gt 0) { $Demo = $true }

# ---------------- AYARLAR ----------------
$EdingAdaylari  = @('P:\CNC')              # Makine (orijinal X5): Eding P:\CNC klasöründe
$EdingKlasor    = $EdingAdaylari[0]
$AktifIsAdi     = 'AKTIF_IS.nc'            # Son seçilen işin sabit adlı kopyası
$AyarliTakimlar = @(1,2,3,4,5,6)           # Konumu doğrulanan takımlar (hepsi G54 + #4000'den hesaplanır)
$script:Sade    = $true                    # sade akış (soru yok); frez modu Ayarlar › PANELden, makro türü otomatik algılanır
if ($script:Sade) { $EdingAdaylari = @('P:\CNC', 'C:\CNC_X5', 'C:\CNC4.03', 'C:\CNC4.04', 'C:\CNC4.02', 'C:\CNC'); $EdingKlasor = $EdingAdaylari[0] }
# -----------------------------------------

$ScriptKlasor = Split-Path -Parent $MyInvocation.MyCommand.Path
# Eding klasörünü bul
$adaylar = @($EdingAdaylari)
# Farklı bilgisayar (örn. dizüstü): PrimerMill klasöründeki eding_yolu.txt'ye yazılan klasör her şeyden önce kullanılır
try {
    $yoluDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'eding_yolu.txt')
    if ([System.IO.File]::Exists($yoluDosyasi)) {
        $ozelYol = ([System.IO.File]::ReadAllLines($yoluDosyasi) | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1)
        if ($ozelYol) { $adaylar = @($ozelYol.Trim().TrimEnd('\')) + $adaylar }
    }
} catch { }
# (Makine sürümü: yalnızca P:\CNC kullanılır; dizüstü simülasyon klasörleri aranmaz)
$MakineBilgisayari = $false
foreach ($k in $adaylar) {
    if ([System.IO.File]::Exists([System.IO.Path]::Combine($k, 'cncapi.dll'))) { $EdingKlasor = $k; $MakineBilgisayari = $true; break }
}
$IsKlasor = [System.IO.Path]::Combine($EdingKlasor, 'isler')
if (-not $MakineBilgisayari) {
    $IsKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'isler')
    if ([System.IO.File]::Exists([System.IO.Path]::Combine($ScriptKlasor, 'macro.cnc'))) { $EdingKlasor = $ScriptKlasor }
}

# SK-04 (KU-07): DPI farkındalığı. Herhangi bir pencere (tek kopya sorusu dahil) açılmadan ÖNCE bildirilmeli; yoksa Windows
# %125/%150 ölçekte paneli bit eşlem olarak büyütür (bulanık), DpiX 96 döner, ekran görüntüsü sanal boyutta alınır.
# Görünüm elle ölçeklenir (Tema.Px = v × S × DpiX/96; formlar AutoScaleMode.None, SK-14). Windows Vista+ (user32 SetProcessDPIAware); başka sistemde / hata olursa atlanır.
try {
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and [Environment]::OSVersion.Version.Major -ge 6) {
        if (-not ('PrimerMillDpi.Yerel' -as [type])) {
            Add-Type -Namespace PrimerMillDpi -Name Yerel -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
        }
        [void][PrimerMillDpi.Yerel]::SetProcessDPIAware()
    }
} catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Kiosk modu (KIOSK_KUR.bat -> kiosk.on): Windows görünmez, Windows'a geçiş PIN'li (lib/Kiosk.ps1). DEMO'da kiosk yok.
$script:KioskBayragi = [System.IO.File]::Exists([System.IO.Path]::Combine($ScriptKlasor, 'kiosk.on')) -and -not $Demo

# Tek kopya: panel ikinci kez açılmasın (başlangıç görevi + kısayol aynı anda çalışırsa)
$script:TekYeni = $false
$script:TekMutex = New-Object System.Threading.Mutex($true, 'Local\PrimerMillPanel', [ref]$script:TekYeni)
# Masaüstü kısayolu / ikinci kopya açık paneli öne çağırır (kiosk: Windows'a geçildiyse panel kiosk olarak geri gelir)
$script:OneAlOlayi = $null
try { $script:OneAlOlayi = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset, 'Local\PrimerMillPanelOneAl') } catch { }
if (-not $script:TekYeni -and $script:KioskBayragi) {
    # Kiosk: soru yok, eskisini kapatma yok; açık panel öne gelir (Kabuk.ps1 çıkış kodu 12'yi tanır)
    try { [void]$script:OneAlOlayi.Set() } catch { }
    exit 12
}
if (-not $script:TekYeni) {
    # Arkada açık (görünmeyen / donmuş) bir kopya varsa sessizce çıkmak yerine sor
    $eski = @()
    try { $eski = @(Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'KazimaBaslat(_Klasik)?\.ps1' -and $_.ProcessId -ne $PID }) } catch { }
    $sahte = New-Object System.Windows.Forms.Form
    $sahte.TopMost = $true; $sahte.ShowInTaskbar = $false; $sahte.StartPosition = 'CenterScreen'; $sahte.Size = New-Object System.Drawing.Size(1, 1); $sahte.Show(); $sahte.Activate()
    $c = [System.Windows.Forms.MessageBox]::Show($sahte, "PrimerMill zaten açık (arkada çalışıyor$(if ($eski.Count) { ", $($eski.Count) kopya" })).`r`n`r`nEskisi kapatılıp PrimerMill yeniden açılsın mı?", 'PrimerMill', 'YesNo', 'Question')
    $sahte.Close()
    if ($c -ne 'Yes') { try { [void]$script:OneAlOlayi.Set() } catch { }; exit 12 }
    foreach ($p in $eski) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { } }
    try { $script:TekYeni = $script:TekMutex.WaitOne(8000) } catch [System.Threading.AbandonedMutexException] { $script:TekYeni = $true } catch { }
    if (-not $script:TekYeni) { [System.Windows.Forms.MessageBox]::Show('Eski PrimerMill kapatılamadı. Bilgisayarı yeniden başlatın.', 'PrimerMill') | Out-Null; exit }
}
$script:Yonetici = $false
try { $script:Yonetici = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }


$PanelKlasor = $ScriptKlasor     # panel dosyaları (ui, lib, portal.html, uzak.html); $ScriptKlasor = veri klasörü (demo modunda ayrı)
$script:Demo = [bool]$Demo
if (-not $script:Demo -and -not $MakineBilgisayari) {
    # Eding yok: eskisi gibi "önizleme" (yalnız dosya kontrolü) ya da DEMO (sahte makine, bütün ekranlar gezilebilir)
    # SK-07: varsayılan düğme HAYIR (önizleme). Makinede P: sürücüsü geç hazır olursa Enter ile sahte makine açılmasın.
    $c = [System.Windows.Forms.MessageBox]::Show("Eding bulunamadı (cncapi.dll yok: $($adaylar -join ', ')).`r`nBu bir makine bilgisayarıysa HAYIR deyin, Eding klasörünü (P:\CNC) kontrol edip paneli yeniden açın.`r`n`r`nDEMO modunda açılsın mı?`r`n`r`nEVET: DEMO, sahte makine. Bütün ekranlar denenebilir; DEMO'da HİÇBİR MAKİNE HAREKET ETMEZ (Eding'e ve makineye bağlanılmaz).`r`nHAYIR (varsayılan): önizleme (yalnız dosya kontrolü).", 'PrimerMill 2', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ("$c" -eq 'Yes') { $script:Demo = $true }
}
if ($script:Demo) {
    # Demo: bütün dosyalar PrimerMill\demo_calisma altında; gerçek Eding klasörüne / ayarlarına dokunulmaz
    $ScriptKlasor = [System.IO.Path]::Combine($PanelKlasor, 'demo_calisma')
    $EdingKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'CNC')
    $IsKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'isler')
    $MakineBilgisayari = $false
    try {
        [void][System.IO.Directory]::CreateDirectory($EdingKlasor); [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $dm = [System.IO.Path]::Combine($PanelKlasor, 'demo')
        $mc = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
        if (-not [System.IO.File]::Exists($mc) -and [System.IO.File]::Exists([System.IO.Path]::Combine($dm, 'macro.cnc'))) { [System.IO.File]::Copy([System.IO.Path]::Combine($dm, 'macro.cnc'), $mc) }
        foreach ($o in @(Get-ChildItem -LiteralPath $dm -Filter '*.nc' -File -ErrorAction Ignore)) {
            $h = [System.IO.Path]::Combine($IsKlasor, $o.Name); if (-not [System.IO.File]::Exists($h)) { [System.IO.File]::Copy($o.FullName, $h) }
        }
    } catch { }
}

# ---------------- C# bileşenleri: görünüm (ui) + yardımcılar (lib) ----------------
$csDosyalari = @('ui\PrimerVeri.cs', 'ui\PrimerUI.cs', 'lib\Kayit.cs', 'lib\NcAnaliz.cs', 'lib\SimGorunum.cs', 'lib\WebSunucu.cs', 'lib\EkranYakala.cs', 'lib\Pencere.cs', 'lib\Kiosk.cs')
# [Eding]: demo -> sahte (EdingSim.cs); makine ve önizleme -> gerçek cncapi.dll sınıfı (önizlemede hiç çağrılmaz, ApiHazir = $false)
if ($script:Demo) { $csDosyalari += 'lib\EdingSim.cs' } else { $csDosyalari += 'lib\EdingApi.cs' }
try {
    Add-Type -Path @($csDosyalari | ForEach-Object { [System.IO.Path]::Combine($PanelKlasor, $_) }) -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core -IgnoreWarnings
} catch {
    [System.Windows.Forms.MessageBox]::Show("Panel bileşenleri derlenemedi:`r`n$($_.Exception.Message)`r`n`r`nEski panel için KazimaBaslat_Klasik.bat kullanılabilir.", 'PrimerMill 2', 'OK', 'Error') | Out-Null
    exit
}

# ---------------- Kayıt (log) dosyası ----------------
[Kayit]::Ac([System.IO.Path]::Combine($ScriptKlasor, 'loglar'))
[Kayit]::Yaz("=== PANEL BAŞLADI ===  Bilgisayar: $env:COMPUTERNAME  Kullanıcı: $env:USERNAME  PowerShell: $($PSVersionTable.PSVersion)  32bit: $([IntPtr]::Size -eq 4)")
if ($script:Demo) { [Kayit]::Yaz("DEMO MODU: sahte Eding (EdingSim), veri klasörü $ScriptKlasor") }
$script:HataSayisi = 0

# ---------------- Eding API (cncapi.dll, stdcall) ----------------
$script:ApiHazir = $false
$script:Bagli    = $false
if ($MakineBilgisayari) {
    if ([IntPtr]::Size -ne 4) {
        [System.Windows.Forms.MessageBox]::Show("Program 32 bit çalışmalı. Lütfen KazimaBaslat.bat ile aç.", 'Kazıma Paneli', 'OK', 'Error') | Out-Null
        exit
    }
    [void][Eding]::SetDllDirectory($EdingKlasor)
    [System.IO.Directory]::SetCurrentDirectory($EdingKlasor)
    Set-Location -LiteralPath $EdingKlasor
    $script:ApiHazir = $true
}
if ($script:Demo) { $script:ApiHazir = $true }

# ---------------- Mantık modülleri ----------------
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'Kalibrasyon', 'Uzak', 'Kiosk', 'Denetleyici', 'ArayuzKapisi')) { . ([System.IO.Path]::Combine($PanelKlasor, 'lib', "$m.ps1")) }
if ($script:Demo) { . ([System.IO.Path]::Combine($PanelKlasor, 'lib', 'Demo.ps1')) }
$script:PanelSurum = 'PrimerMill 2'

Tercih-Baslangic
if ($script:Demo) { Demo-Makine-Hazirla }
$script:Kiosk = Kiosk-Algila
if ($script:Kiosk) {
    [Kayit]::Yaz('KİOSK MODU: kiosk.on var (tam ekran, en üstte, klavye kilidi, PIN''li çıkış)')
    Kiosk-Kabuk-Onar
    # Windows'a geçişte explorer başlangıç kısayolunu çalıştırıp paneli hemen geri çağırmasın
    try {
        $lnk = [System.IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'PrimerMill.lnk')
        if ([System.IO.File]::Exists($lnk)) { [System.IO.File]::Delete($lnk); [Kayit]::Yaz('KİOSK: Windows başlangıç kısayolu kaldırıldı (paneli kabuk açar)') }
    } catch { }
} else {
    # kiosk'ta panel Kabuk.ps1 ile açılır: Windows başlangıç kısayolu kurulmaz (explorer açılınca ikinci kopya başlatmasın)
    try { Windows-Baslangic-Ayarla } catch { }
}
try { Eding-Baslangic-Kaldir } catch { [Kayit]::Yaz("BAŞLANGIÇ: Eding kaydı kontrol edilemedi: $($_.Exception.Message)") }

# ---------------- Kabuk (görünüm) ----------------
$script:Kabuk = New-Object PrimerUI.Kabuk
$script:Kabuk.Text = $(if ($script:Demo) { 'PrimerMill 2  ·  DEMO' } else { 'PrimerMill 2' })
$script:Kabuk.TemaUygula([string](Tema-Normalle $script:Tercih.Tema))   # koyu | acik | gecisli
if ($script:Tercih.TamEkran -ne '0' -or $script:Kiosk) {
    # Eski Tam-Ekran-Uygula: çerçevesiz, ekranı kaplar, Eding ya da başka bir pencere önüne geçemez (yerleşim akışkan: ölçek döngüsü yok)
    $script:Kabuk.FormBorderStyle = 'None'; $script:Kabuk.WindowState = 'Maximized'; $script:Kabuk.TopMost = $true
} else { $script:Kabuk.WindowState = 'Maximized' }
try {
    $script:SimGorunum = New-Object SimView
    $script:SimGorunum.Dock = 'Fill'
    $script:Kabuk.Uretim.SimHost.Controls.Add($script:SimGorunum)
} catch { [Kayit]::Yaz("SİMÜLASYON görünümü kurulamadı: $($_.Exception.Message)") }

# GV-05: her diyalogda Esc ve küçük ACİL STOP düğmesi doğrudan ACİL STOP
[PrimerUI.Diyalog]::AcilStop = [System.Action]{ Acil-Stop 'diyalog' }
$script:Kabuk.add_Komut({ param($s, $e) [void](Komut-Isle $e.Ad $e.Arg 'yerel') })

$script:AnaZaman = New-Object System.Windows.Forms.Timer
$script:AnaZaman.Interval = 200
$script:AnaZaman.Add_Tick({ Zamanlayici-Tik })
$script:Kabuk.Add_Shown({
    if ($script:Kiosk) { try { Kiosk-Uygula } catch { [Kayit]::Yaz("KİOSK: $($_.Exception.Message)") } }
    try { Panel-Acilis } catch { [Kayit]::Yaz("AÇILIŞ: $($_.Exception.Message)") }
    try { Okuma-Yap; Durum-Yenile } catch { }
    $script:AnaZaman.Start()
    # tests/Demo_Ekran_Testi.ps1: yalnız demo modunda, ortam değişkeniyle ekran görüntüsü turu
    $ek = [Environment]::GetEnvironmentVariable('PRIMERMILL_EKRAN')
    if ($script:Demo -and $ek) { try { Ekran-Turu-Baslat $ek } catch { [Kayit]::Yaz("EKRAN TURU: $($_.Exception.Message)") } }
})
$script:Kabuk.Add_FormClosing({
    param($s, $e)
    # Kiosk: pencereyi kapatmak (Alt+F4, KAPAT) PIN ister: kapanış iptal, panel.kapat komutu sıraya (Kiosk-Panel-Kapat)
    if ($script:Kiosk -and -not $script:KapanisIzinli -and "$($e.CloseReason)" -eq 'UserClosing') {
        $e.Cancel = $true
        $script:KomutKuyrugu.Add(@{ Ad = 'panel.kapat'; Arg = ''; Kaynak = 'yerel'; Zaman = (Get-Date); Oncelikli = $false })
        return
    }
    $script:AnaZaman.Stop()   # ED-07: bütün işler tek zamanlayıcıda
    Kiosk-Birak
    Panel-Kapanis
})
[System.Windows.Forms.Application]::Run($script:Kabuk)
# Kabuk.ps1 için çıkış kodu: 0 normal, 10 cihaz kapanıyor, 11 kiosk'ta PIN ile kapatıldı (Windows açık)
exit $script:CikisKodu

