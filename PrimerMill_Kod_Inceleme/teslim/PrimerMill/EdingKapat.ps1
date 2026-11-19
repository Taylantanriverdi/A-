# PrimerMill - Eding'i ve paneli düzgün kapatır (Eding gizliyken de; Eding kapanırken ayarlarını kaydeder)
# ED-24: Eding'de çalışan ya da duraklatılmış bir iş varsa KAPATMAZ (32 bit PowerShell + cncapi.dll ile sorar).
# PS-05: yalnız powershell.exe içindeki panel kapatılır.  PS-06: Eding süreç adı ayarlar.txt'ten (yoksa 'cnc').
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class EdKapat {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    public static int Kapat(int pid) {
        var l = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr x) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().StartsWith("CNC")) l.Add(h); }
            return true;
        }, IntPtr.Zero);
        foreach (var h in l) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
        return l.Count;
    }
}
'@

# --- Eding klasörü ve süreç adı (panelle aynı kaynaklar) ---
$yollar = @('P:\CNC', 'C:\CNC_X5', 'C:\CNC4.03', 'C:\CNC4.04', 'C:\CNC4.02', 'C:\CNC')
try { $yd = Join-Path $PSScriptRoot 'eding_yolu.txt'; if (Test-Path $yd) { $oy = (Get-Content $yd | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1); if ($oy) { $yollar = @($oy.Trim().TrimEnd('\')) + $yollar } } } catch { }
$exeAd = 'cnc'
try {
    $ayar = [System.IO.Path]::Combine($PSScriptRoot, 'ayarlar.txt')
    if ([System.IO.File]::Exists($ayar)) {
        $exe = ([System.IO.File]::ReadAllText($ayar)).Trim()
        if ($exe) { $exeAd = [System.IO.Path]::GetFileNameWithoutExtension($exe); $yollar = @([System.IO.Path]::GetDirectoryName($exe)) + $yollar }
    }
} catch { }
if (-not $exeAd) { $exeAd = 'cnc' }
$edingKlasor = $null
foreach ($k in $yollar) { if ($k -and [System.IO.File]::Exists([System.IO.Path]::Combine($k, 'cncapi.dll'))) { $edingKlasor = $k; break } }

# --- 0/3: Eding'de iş var mı? ---
Write-Host '  0/3  Eding is durumu kontrol ediliyor...'
$durum = $null
if ($edingKlasor -and [IntPtr]::Size -eq 4 -and (Get-Process -Name 'CncServer' -ErrorAction SilentlyContinue)) {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EdDurum {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool SetDllDirectory(string path);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)] public static extern int CncConnectServer(string iniFile);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)] public static extern int CncDisConnectServer();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)] public static extern int CncGetState();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)] public static extern IntPtr CncGetStateText(int state);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)] public static extern int CncGetPauseStatus();
    public static string Metin() { IntPtr p = CncGetStateText(CncGetState()); return p == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(p); }
}
'@
        [void][EdDurum]::SetDllDirectory($edingKlasor)
        [System.IO.Directory]::SetCurrentDirectory($edingKlasor)
        $rc = [EdDurum]::CncConnectServer('')
        if ($rc -eq 0 -or $rc -eq 6 -or $rc -eq 7) {
            $d = ([EdDurum]::Metin()).Trim().ToUpper()
            $pz = [EdDurum]::CncGetPauseStatus()
            $durum = $d
            try { [void][EdDurum]::CncDisConnectServer() } catch { }
            if ($d -like 'RUN*' -or $d -like 'PAUSE*' -or @('SEARCHING', 'AXISJOG', 'IPJOG') -contains $d -or $pz -ne 0) {
                Write-Host ''
                Write-Host "  KAPATILMADI: Eding'de calisan ya da duraklatilmis bir is var (durum: $d)." -ForegroundColor Red
                Write-Host '  Once isi bitir ya da panelden DURDUR, sonra tekrar dene.' -ForegroundColor Red
                exit 1
            }
            Write-Host "       Eding durumu: $d (is yok)"
        }
    } catch { $durum = $null }
}
if ($null -eq $durum -and (Get-Process -Name $exeAd, 'CncServer' -ErrorAction SilentlyContinue)) {
    Write-Host '  UYARI: Eding is durumu okunamadi (makine kaziyor olabilir).' -ForegroundColor Yellow
    $c = Read-Host '  Makinenin calismadigindan eminsen E, degilsen H'
    if ($c -notmatch '^[EeYy]') { Write-Host '  KAPATILMADI.' -ForegroundColor Red; exit 1 }
}

Write-Host '  1/3  Panel kapatiliyor...'
$p = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*KazimaBaslat*.ps1*' -and $_.ProcessId -ne $PID })
foreach ($x in $p) { try { (Get-Process -Id $x.ProcessId).CloseMainWindow() | Out-Null } catch { } }
Start-Sleep -Seconds 3
foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host '  2/3  Eding kapatiliyor (ayarlarini kaydetmesi bekleniyor)...'
foreach ($pr in @(Get-Process -Name $exeAd -ErrorAction SilentlyContinue)) {
    $n = 0; try { $n = [EdKapat]::Kapat($pr.Id) } catch { }
    if ($n -eq 0) { try { $pr.CloseMainWindow() | Out-Null } catch { } }
}
$son = (Get-Date).AddSeconds(10)
while ((Get-Process -Name $exeAd -ErrorAction SilentlyContinue) -and (Get-Date) -lt $son) { Start-Sleep -Milliseconds 300 }

Write-Host '  3/3  Eding sunucusu kapatiliyor...'
foreach ($k in $yollar) {
    # Join-Path olmayan sürücüde (P:) hata verir; Combine vermez
    if (-not $k) { continue }
    $kill = [System.IO.Path]::Combine($k, 'KillCNC.exe')
    if ([System.IO.File]::Exists($kill)) { Start-Process -FilePath $kill -WorkingDirectory $k -Wait -WindowStyle Hidden; break }
}
Get-Process -Name $exeAd, CncServer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
exit 0
