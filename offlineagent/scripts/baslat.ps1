# Offline Agent - baslatma (internet gerekmez)
param([switch]$Arkaplan)
. (Join-Path $PSScriptRoot 'ortak.ps1')

try {
    $ayar = Get-Ayarlar
    $adres = Get-SunucuAdres $ayar

    if (-not (Test-Path $Yollar.Python)) { throw 'Kurulum yapilmamis. Once KUR.bat dosyasini calistirin.' }

    if (Test-Sunucu $ayar) {
        Yaz 'Offline Agent zaten calisiyor.' Green
        if (-not $Arkaplan) { Start-Process $adres }
        exit 0
    }

    # Gunde en fazla bir kez, internet varsa sessizce guncelle
    if ($ayar.otomatik_guncelleme -and ((Get-Date) - (Get-SonGuncelleme)).TotalHours -ge 24) {
        if (Test-Internet) {
            Yaz 'Guncellemeler kontrol ediliyor...'
            try { & (Join-Path $PSScriptRoot 'guncelle.ps1') -Sessiz }
            catch { Yaz "Guncelleme atlandi: $($_.Exception.Message)" Yellow }
        }
    }

    Yaz 'Ollama baslatiliyor...'
    if (-not (Start-Ollama)) { Yaz 'UYARI: Ollama baslatilamadi. Ollama kurulu mu?' Yellow }

    Yaz 'Sunucu baslatiliyor...'
    New-Item -ItemType Directory -Force $Yollar.Veri | Out-Null
    $env:OFFLINEAGENT_PORT = "$($ayar.port)"
    $islem = Start-Process -FilePath $Yollar.Pythonw `
        -ArgumentList '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', "$($ayar.port)" `
        -WorkingDirectory $Yollar.App -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Yollar.Veri 'sunucu.log') `
        -RedirectStandardError (Join-Path $Yollar.Veri 'sunucu-hata.log')
    Set-Content -Path $Yollar.PidDosya -Value $islem.Id

    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Sunucu $ayar) { break }
        if ($islem.HasExited) { throw "Sunucu kapandi. Ayrinti: $(Join-Path $Yollar.Veri 'sunucu-hata.log')" }
    }
    if (-not (Test-Sunucu $ayar)) { throw "Sunucu yanit vermedi. Ayrinti: $(Join-Path $Yollar.Veri 'sunucu-hata.log')" }

    Yaz "Offline Agent hazir: $adres" Green
    if (-not $Arkaplan) { Start-Process $adres }
} catch {
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $Arkaplan) { Read-Host 'Kapatmak icin Enter' }
    exit 1
}
