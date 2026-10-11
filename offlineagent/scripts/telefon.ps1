# Offline Agent - telefondan erisim icin Windows Guvenlik Duvari izni (yonetici olarak calisir)
. (Join-Path $PSScriptRoot 'ortak.ps1')

try {
    $ayar = Get-Ayarlar
    $port = [int]$ayar.port

    Baslik "Guvenlik duvari: $port numarali porta yerel agdan izin veriliyor"
    Get-NetFirewallRule -DisplayName 'Offline Agent' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $null = New-NetFirewallRule -DisplayName 'Offline Agent' -Direction Inbound -Protocol TCP -LocalPort $port `
        -Action Allow -Profile Private -Description 'Offline Agent - ayni Wi-Fi agindaki telefondan erisim'
    Yaz 'Izin eklendi (sadece "Ozel" aglarda gecerli).' Green

    Baslik 'Ag profili kontrol ediliyor'
    $genel = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })
    if ($genel.Count -gt 0) {
        foreach ($a in $genel) { Yaz "Bu ag 'Genel' (Public) olarak ayarli: $($a.Name)" Yellow }
        Yaz 'Telefonun baglanabilmesi icin evdeki/isyerindeki Wi-Fi agi "Ozel" olmali.' Yellow
        $cevap = Read-Host 'Bu ag(lar) "Ozel" yapilsin mi? Sadece guvendiginiz aglar icin E deyin (E/H)'
        if ($cevap -match '^[eEyY]') {
            foreach ($a in $genel) { Set-NetConnectionProfile -InterfaceIndex $a.InterfaceIndex -NetworkCategory Private }
            Yaz 'Ag "Ozel" yapildi.' Green
        }
    } else {
        Yaz 'Ag profili uygun (Ozel).' Green
    }

    Write-Host ''
    Yaz 'Simdi Offline Agent > Ayarlar > Telefon bolumunden sifre belirleyip "Telefondan erisim"i acin.' Cyan
} catch {
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
