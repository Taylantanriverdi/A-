param(
    [int]$Port = 2593,
    [int]$TimeoutSn = 300,
    [string]$ProcessName = 'ServUO',
    [switch]$Kontrol
)
# Sunucu portu dinlemeye başlayana kadar bekler.
# -Kontrol ile tek seferlik bakar.
# Çıkış kodu: 0 = hazır, 1 = zaman aşımı, 2 = sunucu süreci kapandı.
# netstat yerine bu yöntem kullanılır çünkü Türkçe Windows'ta netstat "LISTENING" yerine "DİNLEME" yazar.

function Test-Listening([int]$p) {
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        return [bool]$c
    }
    # Yedek yöntem: doğrudan bağlanmayı dene
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect('127.0.0.1', $p, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne(1000) -and $tcp.Connected) { return $true }
        return $false
    } catch { return $false } finally { $tcp.Close() }
}

# -Kontrol: beklemeden tek sefer bak (0 = dinleniyor, 1 = dinlenmiyor)
if ($Kontrol) { if (Test-Listening $Port) { exit 0 } else { exit 1 } }

$sw = [Diagnostics.Stopwatch]::StartNew()
$i = 0
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSn) {
    if (Test-Listening $Port) {
        Write-Host ""
        Write-Host ("  Sunucu hazır: port {0} dinleniyor ({1:N0} sn)." -f $Port, $sw.Elapsed.TotalSeconds)
        exit 0
    }
    if ($ProcessName -and $i -gt 3 -and -not (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "  HATA: $ProcessName süreci kapandı. Sunucu penceresindeki hata mesajını kontrol et."
        exit 2
    }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 2
    $i++
}
Write-Host ""
Write-Host "  Zaman aşımı: $TimeoutSn saniye içinde port $Port açılmadı."
exit 1
