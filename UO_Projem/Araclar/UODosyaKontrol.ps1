param([Parameter(Mandatory = $true)][string]$UoFiles)
# ServUO'nun açılabilmesi için gereken temel UO dosyalarını kontrol eder.
# Çıkış kodu: 0 = tamam, 1 = eksik dosya var.
# Her satırdaki seçeneklerden en az biri bulunmalı (ör. map0.mul VEYA map0LegacyMUL.uop).
$gerekli = @(
    @('tiledata.mul'),
    @('map0LegacyMUL.uop', 'map0.mul'),
    @('staidx0.mul'),
    @('statics0.mul'),
    @('multi.mul', 'MultiCollection.uop'),
    @('hues.mul'),
    @('artLegacyMUL.uop', 'art.mul')
)
if (-not (Test-Path -LiteralPath $UoFiles)) {
    Write-Host "  Klasör yok: $UoFiles"
    exit 1
}
$eksik = @()
foreach ($secenekler in $gerekli) {
    $bulundu = $false
    foreach ($ad in $secenekler) {
        if (Test-Path -LiteralPath (Join-Path $UoFiles $ad)) { $bulundu = $true; break }
    }
    if (-not $bulundu) { $eksik += ($secenekler -join '  veya  ') }
}
if ($eksik.Count -eq 0) {
    Write-Host "  Tamam: Temel UO dosyaları bulundu ($UoFiles)."
    exit 0
}
Write-Host "  EKSİK UO DOSYALARI ($UoFiles):"
foreach ($e in $eksik) { Write-Host "    - $e" }
Write-Host ""
Write-Host "  Orijinal Ultima Online Classic kurulum klasöründeki TÜM dosyaları"
Write-Host "  bu klasöre kopyala (bkz. OKU_BENI.txt, bölüm 2)."
exit 1
