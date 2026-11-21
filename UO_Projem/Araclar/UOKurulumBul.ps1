param([string]$Kaynak = '')
# Bilgisayarda kurulu orijinal Ultima Online Classic klasörünü bulur ve yolunu yazar.
# ServUO'nun kendi aradığı kayıt defteri anahtarlarını (Ultima\Files.cs) ve bilinen klasörleri tarar.
# -Kaynak verilirse sadece o klasörü doğrular.
# Çıkış kodu: 0 = bulundu (stdout'a tek satır yol yazılır), 1 = bulunamadı.

function Test-UoDir([string]$d) {
    if (-not $d) { return $false }
    $d = $d.Trim('"', ' ')
    if (-not (Test-Path -LiteralPath $d -PathType Container)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $d 'tiledata.mul'))
}

if ($Kaynak) {
    if (Test-UoDir $Kaynak) { Write-Output $Kaynak.Trim('"', ' '); exit 0 }
    exit 1
}

$adaylar = New-Object System.Collections.Generic.List[string]

$anahtarlar = @(
    'Electronic Arts\EA Games\Ultima Online Classic',
    'Electronic Arts\EA Games\Ultima Online Stygian Abyss Classic',
    'Origin Worlds Online\Ultima Online\KR Legacy Beta',
    'Origin Worlds Online\Ultima Online Samurai Empire\3d\1.0',
    'Origin Worlds Online\Ultima Online Samurai Empire\2d\1.0',
    'Origin Worlds Online\Ultima Online\1.0',
    'Origin Worlds Online\Ultima Online Third Dawn\1.0'
)
foreach ($kok in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE')) {
    foreach ($a in $anahtarlar) {
        $p = Get-ItemProperty -LiteralPath "$kok\$a" -ErrorAction SilentlyContinue
        if (-not $p) { continue }
        foreach ($deger in @('InstallDir', 'Install Dir', 'ExePath')) {
            $v = $p.$deger
            if (-not $v) { continue }
            $v = $v.Trim('"', ' ')
            if ($deger -eq 'ExePath' -or $v -match '\.exe$') { $v = Split-Path -Parent $v }
            $adaylar.Add($v)
        }
    }
}

$pf86 = ${env:ProgramFiles(x86)}
foreach ($taban in @($pf86, $env:ProgramFiles)) {
    if (-not $taban) { continue }
    $adaylar.Add((Join-Path $taban 'Electronic Arts\Ultima Online Classic'))
    $adaylar.Add((Join-Path $taban 'EA Games\Ultima Online Classic'))
    $adaylar.Add((Join-Path $taban 'Ultima Online Classic'))
    $adaylar.Add((Join-Path $taban 'Ultima Online'))
}
foreach ($surucu in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    $r = $surucu.Root
    foreach ($alt in @('Ultima Online Classic', 'Ultima Online', 'Games\Ultima Online Classic', 'Oyunlar\Ultima Online Classic')) {
        $adaylar.Add((Join-Path $r $alt))
    }
}

foreach ($d in $adaylar) {
    if (Test-UoDir $d) { Write-Output $d; exit 0 }
}
exit 1
