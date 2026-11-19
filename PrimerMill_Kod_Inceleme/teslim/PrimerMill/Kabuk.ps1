# ============================================================
#  PrimerMill 2 - Kiosk kabuğu (Windows Gezgini / explorer.exe yerine)
#  KIOSK_KUR.bat bunu operatör hesabının kabuğu yapar:
#    HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell =
#    "<32 bit powershell>" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "<PrimerMill>\Kabuk.ps1"
#  Görev: Windows hiç görünmesin. Hemen siyah tam ekran (PRIMER · Başlatılıyor…) açar, paneli (KazimaBaslat.ps1, 32 bit,
#  -STA) başlatır ve çıkış koduna bakar:
#    10 = cihaz kapatılıyor (ya da kapaniyor.txt yeni)  -> siyah ekranda bekle (Windows kapatır)
#    11 = Windows'a geçildi, panel PIN ile kapatıldı    -> Windows masaüstü açık kalır, kabuk biter
#    12 = başka panel zaten açık (o öne çağrıldı)       -> o kapanana kadar bekle
#    diğer (çökme, derleme hatası)                       -> paneli yeniden aç; 2 dakikada 3 kez yeniden açıldıysa
#                                                          KURTARMA: explorer.exe açılır ve Türkçe açıklama gösterilir.
#  Kurtarma yolları (bilgisayar asla kilitli kalmaz):
#    - kiosk.on yoksa (KIOSK_KALDIR.bat siler ya da başka hesaptan / Güvenli Moddan elle silinir): Windows masaüstü + panel
#    - Güvenli Mod: her zaman Windows masaüstü (panel açılmaz)
#    - Kabuk açılırken Shift basılı tutulursa: Windows masaüstü (zamanlama tutmayabilir; asıl yol yukarıdakiler)
#  Bu dosya bilerek kendi başınadır (lib/ yüklemez): lib'de bir hata kabuğu bozmasın. Günlük: loglar\kabuk.log
#  PowerShell 5.1 (32 bit) uyumlu.
# ============================================================
$ErrorActionPreference = 'Continue'
$Klasor = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bayrak = [System.IO.Path]::Combine($Klasor, 'kiosk.on')
$Isaret = [System.IO.Path]::Combine($Klasor, 'kapaniyor.txt')
$Panel = [System.IO.Path]::Combine($Klasor, 'KazimaBaslat.ps1')
$LogKlasor = [System.IO.Path]::Combine($Klasor, 'loglar')
$KabukAnahtari = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
$EnCokYenidenAcma = 3
$YenidenAcmaPenceresiSn = 120

function Kabuk-Log([string]$m) {
    try {
        [void][System.IO.Directory]::CreateDirectory($LogKlasor)
        [System.IO.File]::AppendAllText([System.IO.Path]::Combine($LogKlasor, 'kabuk.log'), (Get-Date).ToString('yyyy-MM-dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture) + "  $m`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
}

try { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing } catch { }
$GorevCubuguArama = $false
try {
    if (-not ('PrimerMillKabuk.Yerel' -as [type])) {
        Add-Type -Namespace PrimerMillKabuk -Name Yerel -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr FindWindow(string c, string t);'
    }
    $GorevCubuguArama = $true
} catch { }

function Explorer-Var {
    if ($GorevCubuguArama) { try { return ([PrimerMillKabuk.Yerel]::FindWindow('Shell_TrayWnd', [NullString]::Value) -ne [IntPtr]::Zero) } catch { } }
    return [bool](Get-Process -Name explorer -ErrorAction Ignore)
}

# explorer.exe yalnız oturumun kabuğuysa görev çubuğu / masaüstü açar: Shell değeri başlatma süresince kaldırılır, sonra geri yazılır
# (lib/Kiosk.ps1 Explorer-Baslat ile aynı yöntem)
function Explorer-Baslat {
    if (Explorer-Var) { return }
    $eski = $null
    try { $eski = [string](Get-ItemProperty -LiteralPath $KabukAnahtari -Name Shell -ErrorAction Stop).Shell } catch { }
    try {
        if ($eski) { Remove-ItemProperty -LiteralPath $KabukAnahtari -Name Shell -ErrorAction Stop }
        $win = $env:SystemRoot; if (-not $win) { $win = 'C:\Windows' }
        Start-Process -FilePath ([System.IO.Path]::Combine($win, 'explorer.exe'))
        $son = (Get-Date).AddSeconds(15)
        while (-not (Explorer-Var) -and (Get-Date) -lt $son) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 250 }
        Start-Sleep -Milliseconds 500
    } catch { Kabuk-Log "explorer başlatılamadı: $($_.Exception.Message)" }
    finally {
        if ($eski) { try { Set-ItemProperty -LiteralPath $KabukAnahtari -Name Shell -Value $eski -ErrorAction Stop } catch { Kabuk-Log "UYARI kabuk değeri geri yazılamadı: $($_.Exception.Message)" } }
    }
    Kabuk-Log "explorer: $(if (Explorer-Var) { 'açık' } else { 'AÇILAMADI' })"
}

function PowerShell32 {
    $win = $env:SystemRoot; if (-not $win) { $win = 'C:\Windows' }
    $p = [System.IO.Path]::Combine($win, 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
    if ([System.IO.File]::Exists($p)) { return $p }
    return [System.IO.Path]::Combine($win, 'System32\WindowsPowerShell\v1.0\powershell.exe')
}

function Panel-Baslat([bool]$bekle) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (PowerShell32)
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$Panel`""
    $psi.WorkingDirectory = $Klasor
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true    # konsol penceresi hiç görünmesin
    $p = [System.Diagnostics.Process]::Start($psi)
    Kabuk-Log "panel başlatıldı (pid $($p.Id))"
    return $p
}

function Mesaj([string]$metin, [string]$simge) {
    try {
        $sahip = New-Object System.Windows.Forms.Form
        $sahip.TopMost = $true; $sahip.ShowInTaskbar = $false; $sahip.StartPosition = 'CenterScreen'; $sahip.Size = New-Object System.Drawing.Size(1, 1)
        $sahip.Show(); $sahip.Activate()
        [void][System.Windows.Forms.MessageBox]::Show($sahip, $metin, 'PrimerMill 2', 'OK', $simge)
        $sahip.Close()
    } catch { }
}

function Shift-Basili { try { return (([System.Windows.Forms.Control]::ModifierKeys -band [System.Windows.Forms.Keys]::Shift) -ne 0) } catch { return $false } }

Kabuk-Log "=== KABUK BAŞLADI ===  Kullanıcı: $env:USERNAME"

# ------------------------------------------------------------------ kurtarma yolları
$guvenli = $false
try { $guvenli = ("$([System.Windows.Forms.SystemInformation]::BootMode)" -ne 'Normal') } catch { }
if ($guvenli) { Kabuk-Log 'Güvenli Mod: Windows masaüstü açılıyor (panel açılmaz)'; Explorer-Baslat; exit 0 }
if (-not [System.IO.File]::Exists($Bayrak)) {
    Kabuk-Log 'kiosk.on yok: Windows masaüstü ve panel (kiosk kapalı)'
    Explorer-Baslat
    try { [void](Panel-Baslat $false) } catch { Kabuk-Log "panel açılamadı: $($_.Exception.Message)" }
    exit 0
}
try { if ([System.IO.File]::Exists($Isaret)) { [System.IO.File]::Delete($Isaret) } } catch { }

# ------------------------------------------------------------------ siyah açılış ekranı
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'; $form.WindowState = 'Maximized'; $form.StartPosition = 'Manual'
$form.BackColor = [System.Drawing.Color]::Black; $form.ShowInTaskbar = $false; $form.Text = 'PrimerMill 2'
# TopMost DEĞİL: panelin ilk soruları (MessageBox) bunun arkasında kalmasın
$marka = New-Object System.Windows.Forms.Label
$marka.Text = [string][char]0x25C6 + ' PRIMER'; $marka.ForeColor = [System.Drawing.Color]::FromArgb(212, 175, 55)
$marka.Font = New-Object System.Drawing.Font('Segoe UI', 40, [System.Drawing.FontStyle]::Bold); $marka.AutoSize = $true
$yazi = New-Object System.Windows.Forms.Label
$yazi.Text = 'Başlatılıyor…'; $yazi.ForeColor = [System.Drawing.Color]::FromArgb(140, 146, 158)
$yazi.Font = New-Object System.Drawing.Font('Segoe UI', 16); $yazi.AutoSize = $true
$form.Controls.Add($marka); $form.Controls.Add($yazi)
$ortala = {
    $w = $form.ClientSize.Width; $h = $form.ClientSize.Height
    $marka.Left = [int](($w - $marka.Width) / 2); $marka.Top = [int]($h / 2 - $marka.Height)
    $yazi.Left = [int](($w - $yazi.Width) / 2); $yazi.Top = [int]($h / 2 + 10)
}
$form.Add_Resize($ortala); $form.Add_Shown($ortala)
function Ekran([string]$metin) {
    $yazi.Text = $metin; & $ortala
    if (-not $form.Visible) { $form.Show() }
    $form.Activate()
}

# ------------------------------------------------------------------ durum makinesi (300 ms)
$script:Durum = 'shift'        # shift -> baslat -> izle -> (kapaniyor | diger | bekle) ...
$script:Surec = $null
$script:Baslangic = Get-Date
$script:BekleBitis = [datetime]::MinValue
$script:Cokmeler = New-Object System.Collections.Generic.List[datetime]
$script:GorunurAni = [datetime]::MinValue

function Kurtarma {
    Kabuk-Log "KURTARMA: panel $YenidenAcmaPenceresiSn sn içinde $EnCokYenidenAcma kezden fazla beklenmedik kapandı; Windows masaüstü açılıyor"
    $script:Zaman.Stop()
    Ekran 'Kurtarma: Windows masaüstü açılıyor…'
    Explorer-Baslat
    $form.Hide()
    Mesaj ("PrimerMill paneli üst üste beklenmedik şekilde kapandı (2 dakikada $EnCokYenidenAcma kezden fazla).`r`n`r`n" +
        "Bilgisayar kilitli kalmasın diye Windows masaüstü açıldı.`r`n`r`n" +
        "Ne yapmalı:`r`n" +
        "  - Paneli yeniden açmak için masaüstündeki 'PrimerMill 2' kısayolunu kullanın.`r`n" +
        "  - Panel yine açılmazsa PrimerMill klasöründeki HataBul.bat'ı çalıştırın; loglar klasörünü gönderin.`r`n" +
        "  - Kiosk modunu kaldırmak için KIOSK_KALDIR.bat (yönetici olarak).") 'Warning'
    [System.Windows.Forms.Application]::ExitThread()
}

function Cikis-Isle([int]$kod) {
    $isaretYeni = $false
    try { if ([System.IO.File]::Exists($Isaret)) { $isaretYeni = (((Get-Date) - [System.IO.File]::GetLastWriteTime($Isaret)).TotalMinutes -lt 5) } } catch { }
    Kabuk-Log "panel kapandı, çıkış kodu $kod$(if ($isaretYeni) { ' (kapatma işareti var)' })"
    if ($kod -eq 10 -or $isaretYeni) {
        $script:Durum = 'kapaniyor'; $script:BekleBitis = (Get-Date).AddMinutes(2)
        Ekran 'Kapatılıyor…'
        return
    }
    if ($kod -eq 11) {
        Kabuk-Log 'Windows''a geçildi ve panel PIN ile kapatıldı: kabuk bitiyor'
        $script:Zaman.Stop()
        Explorer-Baslat
        $form.Hide()
        [System.Windows.Forms.Application]::ExitThread()
        return
    }
    if ($kod -eq 12) { $script:Durum = 'diger'; $script:BekleBitis = (Get-Date).AddSeconds(3); return }
    # beklenmedik
    $simdi = Get-Date
    $script:Cokmeler.Add($simdi)
    while ($script:Cokmeler.Count -gt 0 -and ($simdi - $script:Cokmeler[0]).TotalSeconds -gt $YenidenAcmaPenceresiSn) { $script:Cokmeler.RemoveAt(0) }
    if ($script:Cokmeler.Count -gt $EnCokYenidenAcma) { Kurtarma; return }
    Ekran 'Panel yeniden başlatılıyor…'
    $script:Durum = 'bekle'; $script:BekleBitis = $simdi.AddSeconds(2)
}

function Diger-Panel-Var {
    try { return (@(Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'KazimaBaslat(_Klasik)?\.ps1' }).Count -gt 0) } catch { return $false }
}

$script:Zaman = New-Object System.Windows.Forms.Timer
$script:Zaman.Interval = 300
$script:Zaman.Add_Tick({
    try {
        switch ($script:Durum) {
            'shift' {
                if (Shift-Basili) {
                    Kabuk-Log 'Shift basılı: kurtarma, Windows masaüstü (panel açılmadı)'
                    $script:Zaman.Stop(); Ekran 'Windows masaüstü açılıyor…'; Explorer-Baslat; $form.Hide()
                    Mesaj "Shift basılı tutuldu: PrimerMill paneli açılmadı, Windows masaüstü açıldı.`r`nPaneli açmak için masaüstündeki 'PrimerMill 2' kısayolu." 'Information'
                    [System.Windows.Forms.Application]::ExitThread(); return
                }
                if (((Get-Date) - $script:Baslangic).TotalMilliseconds -ge 1500) { $script:Durum = 'baslat' }
            }
            'baslat' {
                $script:Surec = Panel-Baslat $true
                $script:GorunurAni = [datetime]::MinValue
                $script:Durum = 'izle'
            }
            'izle' {
                $p = $script:Surec
                if ($p.HasExited) { Cikis-Isle ([int]$p.ExitCode); return }
                if ($form.Visible) {
                    $p.Refresh()
                    if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
                        if ($script:GorunurAni -eq [datetime]::MinValue) { $script:GorunurAni = Get-Date }
                        elseif (((Get-Date) - $script:GorunurAni).TotalMilliseconds -ge 1500) { $form.Hide() }   # panel ekranda: siyah perdeyi kaldır
                    }
                }
            }
            'kapaniyor' {
                # Windows kapatırken bu süreç de kapanır. 2 dk içinde kapanmadıysa (shutdown iptal) panel yeniden açılır.
                if ((Get-Date) -gt $script:BekleBitis) {
                    Kabuk-Log 'kapatma 2 dk içinde gerçekleşmedi: panel yeniden açılıyor'
                    try { [System.IO.File]::Delete($Isaret) } catch { }
                    Ekran 'Başlatılıyor…'; $script:Durum = 'baslat'
                }
            }
            'diger' {
                if ((Get-Date) -gt $script:BekleBitis) {
                    if (Diger-Panel-Var) { $script:BekleBitis = (Get-Date).AddSeconds(3) }
                    else { Cikis-Isle -1 }
                }
            }
            'bekle' { if ((Get-Date) -gt $script:BekleBitis) { $script:Durum = 'baslat' } }
        }
    } catch {
        Kabuk-Log "HATA: $($_.Exception.Message)"
        # kabuğun kendisi takılırsa da bilgisayar kilitli kalmasın
        if ($script:Durum -eq 'baslat') { Kurtarma }
    }
})
$form.Add_Shown({ $script:Zaman.Start() })
try { [System.Windows.Forms.Application]::Run($form) }
catch { Kabuk-Log "KABUK ÇÖKTÜ: $($_.Exception.Message)"; Explorer-Baslat }
Kabuk-Log '=== KABUK BİTTİ ==='
