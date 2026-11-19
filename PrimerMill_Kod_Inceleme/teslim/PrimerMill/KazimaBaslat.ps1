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

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Tek kopya: panel ikinci kez açılmasın (başlangıç görevi + kısayol aynı anda çalışırsa)
$script:TekYeni = $false
$script:TekMutex = New-Object System.Threading.Mutex($true, 'Local\PrimerMillPanel', [ref]$script:TekYeni)
if (-not $script:TekYeni) {
    # Arkada açık (görünmeyen / donmuş) bir kopya varsa sessizce çıkmak yerine sor
    $eski = @()
    try { $eski = @(Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'KazimaBaslat\.ps1' -and $_.ProcessId -ne $PID }) } catch { }
    $sahte = New-Object System.Windows.Forms.Form
    $sahte.TopMost = $true; $sahte.ShowInTaskbar = $false; $sahte.StartPosition = 'CenterScreen'; $sahte.Size = New-Object System.Drawing.Size(1, 1); $sahte.Show(); $sahte.Activate()
    $c = [System.Windows.Forms.MessageBox]::Show($sahte, "PrimerMill zaten açık (arkada çalışıyor$(if ($eski.Count) { ", $($eski.Count) kopya" })).`r`n`r`nEskisi kapatılıp PrimerMill yeniden açılsın mı?", 'PrimerMill', 'YesNo', 'Question')
    $sahte.Close()
    if ($c -ne 'Yes') { exit }
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
    $c = [System.Windows.Forms.MessageBox]::Show("Eding bulunamadı (cncapi.dll yok: $($adaylar -join ', ')).`r`n`r`nDEMO modunda açılsın mı?`r`n`r`nEVET: sahte makine ile bütün ekranlar denenebilir (gerçek makine HAREKET ETMEZ).`r`nHAYIR: önizleme (yalnız dosya kontrolü).", 'PrimerMill 2', 'YesNo', 'Question')
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
$csDosyalari = @('ui\PrimerVeri.cs', 'ui\PrimerUI.cs', 'lib\Kayit.cs', 'lib\NcAnaliz.cs', 'lib\SimGorunum.cs', 'lib\WebSunucu.cs', 'lib\EkranYakala.cs', 'lib\Pencere.cs')
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
foreach ($m in @('Kapi', 'Cekirdek', 'Eding', 'Makine', 'Kalibrasyon', 'Uzak', 'Denetleyici', 'ArayuzKapisi')) { . ([System.IO.Path]::Combine($PanelKlasor, 'lib', "$m.ps1")) }
if ($script:Demo) { . ([System.IO.Path]::Combine($PanelKlasor, 'lib', 'Demo.ps1')) }
$script:PanelSurum = 'PrimerMill 2'

Tercih-Baslangic
try { Windows-Baslangic-Ayarla } catch { }
try { Eding-Baslangic-Kaldir } catch { [Kayit]::Yaz("BAŞLANGIÇ: Eding kaydı kontrol edilemedi: $($_.Exception.Message)") }

# ---------------- Kabuk (görünüm) ----------------
$script:Kabuk = New-Object PrimerUI.Kabuk
$script:Kabuk.Text = $(if ($script:Demo) { 'PrimerMill 2  ·  DEMO' } else { 'PrimerMill 2' })
if ($script:Tercih.Tema -eq 'acik') { $script:Kabuk.TemaUygula($false) }
if ($script:Tercih.TamEkran -ne '0') {
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
    try { Panel-Acilis } catch { [Kayit]::Yaz("AÇILIŞ: $($_.Exception.Message)") }
    try { Okuma-Yap; Durum-Yenile } catch { }
    $script:AnaZaman.Start()
})
$script:Kabuk.Add_FormClosing({
    $script:AnaZaman.Stop()   # ED-07: bütün işler tek zamanlayıcıda
    Panel-Kapanis
})
[System.Windows.Forms.Application]::Run($script:Kabuk)

