# Offline Agent - guncelleme (internet varsa program, paketler ve modeller guncellenir)
# -DosyalarGuncel: dosyalar az once yenilendi, yeni betik kalan adimlari yapiyor
param([switch]$Sessiz, [switch]$DosyalarGuncel, [switch]$PaketDegisti)
. (Join-Path $PSScriptRoot 'ortak.ps1')

# Kullanici verisi: guncelleme bunlara asla dokunmaz
$Korunan = @('ayarlar.json', '.venv', 'araclar', 'modeller', 'veri', 'belgeler')

try {
    $ayar = Get-Ayarlar
    if (-not (Test-Internet)) { Yaz 'Internet baglantisi yok, guncelleme atlandi.' Yellow; return }

    $calisiyordu = $false
    if (-not $Sessiz -and (Test-Sunucu $ayar)) {
        Yaz 'Calisan sunucu guncelleme icin durduruluyor...'
        $calisiyordu = Stop-Sunucu
    }

    $paketDegisti = [bool]$PaketDegisti
    if (-not $DosyalarGuncel) {
        Baslik 'Program dosyalari kontrol ediliyor'
        $eskiSurum = (Get-Content (Join-Path $Kok 'SURUM.txt') -ErrorAction SilentlyContinue | Select-Object -First 1)
        $gecici = Join-Path $env:TEMP 'offlineagent-guncelleme'
        if (Test-Path $gecici) { Remove-Item $gecici -Recurse -Force }
        New-Item -ItemType Directory -Force $gecici | Out-Null
        $zip = Join-Path $gecici 'paket.zip'
        Invoke-WebRequest "https://github.com/$($ayar.depo)/archive/refs/heads/$($ayar.guncelleme_dali).zip" -OutFile $zip -UseBasicParsing
        Expand-Archive $zip -DestinationPath (Join-Path $gecici 'acik') -Force
        $ust = Get-ChildItem (Join-Path $gecici 'acik') -Directory | Select-Object -First 1
        $kaynak = Join-Path $ust.FullName 'offlineagent'
        if (-not (Test-Path $kaynak)) { throw 'Guncelleme paketinde offlineagent klasoru bulunamadi.' }

        $degisen = 0
        $betikDegisti = $false
        foreach ($dosya in Get-ChildItem $kaynak -Recurse -File) {
            $goreli = $dosya.FullName.Substring($kaynak.Length).TrimStart('\')
            if ($Korunan -contains ($goreli -split '\\')[0]) { continue }
            $hedef = Join-Path $Kok $goreli
            if ((Test-Path $hedef) -and ((Get-FileHash $hedef).Hash -eq (Get-FileHash $dosya.FullName).Hash)) { continue }
            New-Item -ItemType Directory -Force (Split-Path $hedef) | Out-Null
            Copy-Item $dosya.FullName $hedef -Force
            if ($goreli -eq 'requirements.txt') { $paketDegisti = $true }
            if ($goreli -like 'scripts\*') { $betikDegisti = $true }
            Yaz "  guncellendi: $goreli"
            $degisen++
        }
        Remove-Item $gecici -Recurse -Force -ErrorAction SilentlyContinue
        $yeniSurum = (Get-Content (Join-Path $Kok 'SURUM.txt') | Select-Object -First 1)
        if ($degisen) { Yaz "Program guncellendi: $eskiSurum -> $yeniSurum ($degisen dosya)" Green }
        else { Yaz "Program guncel (v$yeniSurum)." Green }

        if ($betikDegisti) {
            # Kalan adimlari guncellemenin yeni surumu yapsin
            & $PSCommandPath -DosyalarGuncel -Sessiz:$Sessiz -PaketDegisti:$paketDegisti
            if ($calisiyordu) { & (Join-Path $PSScriptRoot 'baslat.ps1') }
            return
        }
    }

    if ((Test-Path $Yollar.Uv) -and (Test-Path $Yollar.Python) -and ($paketDegisti -or -not $Sessiz)) {
        Baslik 'Python paketleri kontrol ediliyor'
        Install-PythonPaketleri
    }

    if (-not $Sessiz) {
        Baslik 'Modeller guncelleniyor'
        if (-not (Start-Ollama)) { throw 'Ollama baslatilamadi.' }
        foreach ($m in (Get-Modeller $ayar)) { Invoke-ModelIndir $m }
    } else {
        # Sessiz modda sadece eksik modeller indirilir (or. ayarlarda model degistiyse)
        if (Start-Ollama) {
            $yuklu = Get-YukluModeller
            foreach ($m in (Get-Modeller $ayar)) { if (-not (Test-ModelVar $m $yuklu)) { Invoke-ModelIndir $m } }
        }
    }

    if (Test-Path $Yollar.Python) {
        try { Install-SesModeli $ayar }
        catch { Yaz "UYARI: $($_.Exception.Message)" Yellow }
    }

    Set-SonGuncelleme
    Yaz 'Guncelleme tamamlandi.' Green

    if ($calisiyordu) { & (Join-Path $PSScriptRoot 'baslat.ps1') }
} catch {
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    if ($Sessiz) { throw }
    exit 1
}
