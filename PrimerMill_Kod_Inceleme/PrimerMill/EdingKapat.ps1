# PrimerMill - Eding'i ve paneli düzgün kapatır (Eding gizliyken de; Eding kapanırken ayarlarını kaydeder)
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
Write-Host '  1/3  Panel kapatiliyor...'
$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*KazimaBaslat.ps1*' -and $_.ProcessId -ne $PID }
foreach ($x in $p) { try { (Get-Process -Id $x.ProcessId).CloseMainWindow() | Out-Null } catch { } }
Start-Sleep -Seconds 3
foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host '  2/3  Eding kapatiliyor (ayarlarini kaydetmesi bekleniyor)...'
foreach ($pr in @(Get-Process -Name cnc -ErrorAction SilentlyContinue)) { [void][EdKapat]::Kapat($pr.Id) }
$son = (Get-Date).AddSeconds(10)
while ((Get-Process -Name cnc -ErrorAction SilentlyContinue) -and (Get-Date) -lt $son) { Start-Sleep -Milliseconds 300 }

Write-Host '  3/3  Eding sunucusu kapatiliyor...'
$yollar = @('P:\CNC', 'C:\CNC_X5', 'C:\CNC4.03', 'C:\CNC4.04', 'C:\CNC4.02', 'C:\CNC')
try { $yd = Join-Path $PSScriptRoot 'eding_yolu.txt'; if (Test-Path $yd) { $oy = (Get-Content $yd | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1); if ($oy) { $yollar = @($oy.Trim()) + $yollar } } } catch { }
foreach ($k in $yollar) {
    # Join-Path olmayan sürücüde (P:) hata verir; Combine vermez
    $kill = [System.IO.Path]::Combine($k, 'KillCNC.exe')
    if ([System.IO.File]::Exists($kill)) { Start-Process -FilePath $kill -WorkingDirectory $k -Wait -WindowStyle Hidden; break }
}
Get-Process -Name cnc, CncServer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
