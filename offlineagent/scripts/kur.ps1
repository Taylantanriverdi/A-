# Offline Agent - ilk kurulum (internet sadece bu adimda gerekir)
. (Join-Path $PSScriptRoot 'ortak.ps1')

try {
    Write-Host ''
    Write-Host '=============================================' -ForegroundColor Green
    Write-Host '   OFFLINE AGENT KURULUMU' -ForegroundColor Green
    Write-Host "   Klasor: $Kok" -ForegroundColor Green
    Write-Host '=============================================' -ForegroundColor Green

    foreach ($d in 'Araclar', 'Veri', 'Belgeler', 'Modeller') { New-Item -ItemType Directory -Force $Yollar[$d] | Out-Null }
    $ayarDosya = Join-Path $Kok 'ayarlar.json'
    if (-not (Test-Path $ayarDosya)) { Copy-Item (Join-Path $Kok 'ayarlar.varsayilan.json') $ayarDosya }
    $ayar = Get-Ayarlar

    # 1) Ollama
    Baslik '1/6 Ollama kontrol ediliyor'
    $ollama = Get-OllamaExe
    if (-not $ollama) {
        if (-not (Test-Internet)) { throw 'Ollama yuklu degil ve internet baglantisi yok.' }
        Yaz 'Ollama indiriliyor (yaklasik 1 GB)...'
        $kurucu = Join-Path $Yollar.Araclar 'OllamaSetup.exe'
        Invoke-WebRequest 'https://ollama.com/download/OllamaSetup.exe' -OutFile $kurucu -UseBasicParsing
        Yaz 'Ollama kurulum penceresi aciliyor, "Install" deyip bitmesini bekleyin...' Yellow
        Start-Process -FilePath $kurucu -Wait
        Remove-Item $kurucu -Force -ErrorAction SilentlyContinue
        $ollama = Get-OllamaExe
        if (-not $ollama) { throw 'Ollama kurulumu tamamlanamadi.' }
    }
    Yaz "Ollama bulundu: $ollama" Green

    # 2) Modellerin bu klasorde durmasi
    Baslik '2/6 Model klasoru ayarlaniyor'
    $mevcut = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
    if ($mevcut -ne $Yollar.Modeller) {
        $eski = if ($mevcut) { $mevcut } else { Join-Path $HOME '.ollama\models' }
        if ((Test-Path (Join-Path $eski 'manifests')) -and -not (Test-Path (Join-Path $Yollar.Modeller 'manifests'))) {
            Yaz "Daha once indirilen modeller kopyalaniyor: $eski -> $($Yollar.Modeller)"
            robocopy $eski $Yollar.Modeller /E /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw 'Modeller kopyalanamadi.' }
            Yaz "Kopyalandi. Eski klasoru ($eski) isterseniz silerek C: diskinde yer acabilirsiniz." Yellow
        }
        [Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $Yollar.Modeller, 'User')
        Yaz 'Ollama yeni model klasoruyle yeniden baslatiliyor...'
        $null = Restart-Ollama
    }
    if (-not (Start-Ollama)) { throw 'Ollama baslatilamadi.' }
    Yaz "Modeller burada saklanacak: $($Yollar.Modeller)" Green

    # 3) uv (Python yoneticisi)
    Baslik '3/6 Python ortami hazirlaniyor'
    if (-not (Test-Path $Yollar.Uv)) {
        Yaz 'uv indiriliyor...'
        $zip = Join-Path $Yollar.Araclar 'uv.zip'
        $hedef = Split-Path $Yollar.Uv
        Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip -UseBasicParsing
        Expand-Archive $zip -DestinationPath $hedef -Force
        Remove-Item $zip -Force
        if (-not (Test-Path $Yollar.Uv)) {
            $bulunan = Get-ChildItem $hedef -Recurse -Filter 'uv.exe' | Select-Object -First 1
            if (-not $bulunan) { throw 'uv.exe bulunamadi.' }
            Move-Item $bulunan.FullName $Yollar.Uv -Force
        }
    }
    if (-not (Test-Path $Yollar.Python)) {
        & $Yollar.Uv venv $Yollar.Venv --python 3.12
        if ($LASTEXITCODE -ne 0) { throw 'Python ortami olusturulamadi.' }
    }

    # 4) Python paketleri
    Baslik '4/6 Python paketleri kuruluyor'
    Install-PythonPaketleri

    # 5) Modeller
    Baslik '5/6 Yapay zeka modelleri indiriliyor (ilk seferde ~10 GB)'
    $yuklu = Get-YukluModeller
    foreach ($m in (Get-Modeller $ayar)) {
        if (Test-ModelVar $m $yuklu) { Yaz "Zaten var: $m" Green } else { Invoke-ModelIndir $m }
    }

    # 6) Kisayollar
    Baslik '6/6 Kisayollar olusturuluyor'
    $kabuk = New-Object -ComObject WScript.Shell
    $masaustu = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Offline Agent.lnk'
    $k = $kabuk.CreateShortcut($masaustu)
    $k.TargetPath = Join-Path $Kok 'BASLAT.bat'
    $k.WorkingDirectory = $Kok
    $k.WindowStyle = 7   # simge durumunda
    $k.Save()
    Yaz 'Masaustune "Offline Agent" kisayolu eklendi.' Green

    $cevap = Read-Host 'Windows acildiginda Offline Agent arka planda otomatik baslasin mi? (E/H)'
    $baslangic = Join-Path ([Environment]::GetFolderPath('Startup')) 'Offline Agent.lnk'
    if ($cevap -match '^[eEyY]') {
        $k = $kabuk.CreateShortcut($baslangic)
        $k.TargetPath = 'powershell.exe'
        $k.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'baslat.ps1')`" -Arkaplan"
        $k.WorkingDirectory = $Kok
        $k.WindowStyle = 7
        $k.Save()
        Yaz 'Otomatik baslatma acildi.' Green
    } elseif (Test-Path $baslangic) {
        Remove-Item $baslangic -Force
        Yaz 'Otomatik baslatma kapatildi.'
    }

    Set-SonGuncelleme

    Write-Host ''
    Write-Host '=============================================' -ForegroundColor Green
    Write-Host '   KURULUM TAMAMLANDI' -ForegroundColor Green
    Write-Host '   Artik internet olmadan calisir.' -ForegroundColor Green
    Write-Host '   Baslatmak icin: masaustundeki "Offline Agent"' -ForegroundColor Green
    Write-Host '=============================================' -ForegroundColor Green

    $cevap = Read-Host 'Simdi baslatilsin mi? (E/H)'
    if ($cevap -match '^[eEyY]') { & (Join-Path $PSScriptRoot 'baslat.ps1') }
} catch {
    Write-Host ''
    Write-Host "HATA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Sorunu duzeltip KUR.bat dosyasini tekrar calistirabilirsiniz; kaldigi yerden devam eder.' -ForegroundColor Yellow
    exit 1
}
