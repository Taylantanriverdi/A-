# Offline Agent - PrimerLab baglantisi
# PrimerLab'in yayinlandigi siteye (GitHub Pages) bu bilgisayardaki Ollama'yi kullanma izni verir.
# Sadece listedeki siteler izin alir; diger siteler Ollama'ya eskisi gibi erisemez.
# Siteler: ayarlar.json > "izinli_siteler" (bossa depo sahibinin https://<ad>.github.io adresi).
. (Join-Path $PSScriptRoot 'ortak.ps1')

try {
    $ayar = Get-Ayarlar
    $siteler = @($ayar.izinli_siteler | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim().TrimEnd('/') })
    if (-not $siteler.Count) {
        $sahip = ([string]$ayar.depo -split '/')[0].ToLower()
        if (-not $sahip) { throw 'ayarlar.json icinde "izinli_siteler" ya da "depo" bulunamadi.' }
        $siteler = @("https://$sahip.github.io")
    }
    foreach ($s in $siteler) {
        if ($s -notmatch '^https?://[A-Za-z0-9.\-]+(:\d+)?$') { throw "Gecersiz site adresi: $s (ornek: https://ad.github.io)" }
    }

    Baslik 'Ollama izni ayarlaniyor'
    $mevcut = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
    $liste = @()
    if ($mevcut) { $liste = @($mevcut -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
    foreach ($s in $siteler) { if ($liste -notcontains $s) { $liste += $s } }
    $deger = $liste -join ','
    [Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $deger, 'User')
    $env:OLLAMA_ORIGINS = $deger
    Yaz "Ollama'yi kullanabilecek siteler: $deger" Green

    Baslik 'Ollama yeniden baslatiliyor'
    if (-not (Restart-Ollama)) { throw 'Ollama baslatilamadi.' }
    Yaz 'Ollama calisiyor.' Green

    Baslik 'Baglanti deneniyor'
    $hepsiTamam = $true
    foreach ($s in $siteler) {
        try {
            $y = Invoke-WebRequest 'http://127.0.0.1:11434/api/tags' -Headers @{ Origin = $s } -UseBasicParsing -TimeoutSec 10
            if ($y.Headers['Access-Control-Allow-Origin']) { Yaz "  TAMAM: $s Ollama'ya baglanabilir." Green }
            else { Yaz "  UYARI: $s icin izin basligi gelmedi." Yellow; $hepsiTamam = $false }
        } catch {
            Yaz "  HATA: $s reddedildi ($($_.Exception.Message))." Red
            $hepsiTamam = $false
        }
    }

    Write-Host ''
    if ($hepsiTamam) {
        Yaz 'Hazir. Simdi PrimerLab''i site adresinden acin; Chrome yerel ag izni sorarsa "Izin ver" deyin.' Green
        Yaz 'PrimerLab > Ayarlar > "Baglantiyi test et" ile kontrol edebilirsiniz.' Green
    } else {
        Yaz 'Izin tam uygulanamadi. Bilgisayari yeniden baslatip PRIMERLAB_BAGLA.bat''i tekrar calistirin.' Yellow
    }
    Yaz 'Not: Bilgisayarda cift tiklanarak acilan .html dosyalari Ollama''ya baglanamaz; site adresini kullanin.' Gray
} catch {
    Yaz "HATA: $($_.Exception.Message)" Red
}
