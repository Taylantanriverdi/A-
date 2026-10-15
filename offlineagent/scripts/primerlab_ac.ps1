# Offline Agent - PrimerLab'i yapay zeka ile ac
# PrimerLab .html dosyasini bulur, uygulamalar klasorune koyar ve Offline Agent'in uygulama adresinden acar.
# Bu adresten acilan PrimerLab, bu bilgisayardaki yapay zekayi kullanabilir (hicbir siteye izin acilmaz).
. (Join-Path $PSScriptRoot 'ortak.ps1')

try {
    $ayar = Get-Ayarlar
    $port = [int]$ayar.port + 1
    $uygulamalar = Join-Path $Kok 'uygulamalar'
    $hedef = Join-Path $uygulamalar 'PrimerLab.html'
    New-Item -ItemType Directory -Force $uygulamalar | Out-Null

    Baslik 'PrimerLab dosyasi araniyor'
    $indirilenler = Join-Path $env:USERPROFILE 'Downloads'
    $yerler = @($Kok, (Join-Path $Kok 'dosyalar'), $indirilenler, [Environment]::GetFolderPath('Desktop'),
                [Environment]::GetFolderPath('MyDocuments'))
    $adaylar = foreach ($y in $yerler) {
        if ($y -and (Test-Path $y)) { Get-ChildItem $y -File -Filter 'PrimerLab*.htm*' -ErrorAction SilentlyContinue }
    }
    $en_yeni = $adaylar | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($en_yeni -and (-not (Test-Path $hedef) -or $en_yeni.LastWriteTime -gt (Get-Item $hedef).LastWriteTime)) {
        Copy-Item $en_yeni.FullName $hedef -Force
        Yaz "Kullanilan dosya: $($en_yeni.FullName)" Green
    } elseif (Test-Path $hedef) {
        Yaz "Kullanilan dosya: $hedef" Green
    } else {
        throw "PrimerLab .html dosyasi bulunamadi. Dosyayi (adi PrimerLab ile baslamali) $uygulamalar klasorune ya da Indirilenler'e koyup tekrar deneyin."
    }
    $icerik = Get-Content $hedef -Raw -Encoding UTF8
    if ($icerik -notmatch "location\.origin \+ '/ollama'") {
        Yaz 'UYARI: Bu PrimerLab dosyasi eski surum; yapay zeka baglanamayabilir. Claude''un gonderdigi en yeni PrimerLab_5_offline.html dosyasini indirip bu dosyayi tekrar calistirin.' Yellow
    }

    Baslik 'Offline Agent kontrol ediliyor'
    $uygulamaAcik = $false
    try { $null = Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 3; $uygulamaAcik = $true } catch { }
    if (-not $uygulamaAcik) {
        $baslat = Join-Path $PSScriptRoot 'baslat.ps1'
        if (Test-Sunucu $ayar) { & $baslat -YenidenBaslat -Arkaplan } else { & $baslat -Arkaplan }
        for ($i = 0; $i -lt 60 -and -not $uygulamaAcik; $i++) {
            Start-Sleep -Seconds 1
            try { $null = Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 2; $uygulamaAcik = $true } catch { }
        }
    }
    if (-not $uygulamaAcik) { throw 'Offline Agent baslatilamadi. GUNCELLE.bat ile guncelleyip tekrar deneyin.' }

    $adres = "http://localhost:$port/PrimerLab.html"
    Yaz "PrimerLab aciliyor: $adres" Green
    Yaz 'Bu adresi tarayicida yer imlerine ekleyebilirsiniz (Offline Agent acikken calisir).' Gray
    Start-Process $adres
} catch {
    Yaz "HATA: $($_.Exception.Message)" Red
    pause
}
