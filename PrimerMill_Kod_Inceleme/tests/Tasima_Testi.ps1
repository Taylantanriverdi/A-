# Tasima_Testi.ps1 - "birebir taşıma" kanıtı: düzeltilmiş eski paneldeki (PrimerMill/KazimaBaslat.ps1) her fonksiyon
# teslimde (teslim/PrimerMill, *_Klasik.ps1 hariç) aynı metinle var mı?
#  - Karşılaştırmadan önce eski metne yalnız taşıma aracının (tests/tasima/tasi.ps1) üç mekanik dönüşümü uygulanır:
#      [Kayit]::Show(..) -> (Ui-Kutu ..), [System.Windows.Forms.Application]::DoEvents() -> Ui-Olaylar,
#      [Kayit]::AcikPencere -> (Ui-Acik-Diyalog); satır sonları LF yapılır.
#  - Aynı çıkmayan ya da teslimde olmayan her fonksiyon tests/TASIMA_DEGISEN.txt içinde gerekçesiyle listelenmeli
#    ("Ad | DEGISTI | gerekçe" ya da "Ad | KALDIRILDI | gerekçe"). Listede olup aslında aynı kalan madde de hata sayılır.
# Çalıştırma: pwsh -NoProfile -File tests/Tasima_Testi.ps1 [-Kaynak teslim/PrimerMill] [-Eski PrimerMill/KazimaBaslat.ps1] [-Fark]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [string]$Eski = '', [switch]$Fark)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak -or -not (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib', 'Denetleyici.ps1')))) {
    $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'teslim', 'PrimerMill'))
}
if (-not $Eski) { $Eski = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'PrimerMill', 'KazimaBaslat.ps1')) }
Write-Host "Eski  : $Eski"
Write-Host "Teslim: $Kaynak"

function Mekanik([string]$t) {
    $a = [System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$null)
    $deg = @()
    foreach ($n in $a.FindAll({ param($x) $x -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
        if ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.Name -eq 'Kayit' -and $n.Member.Value -eq 'Show') {
            $ar = @()
            foreach ($g in $n.Arguments) {
                $gt = $g.Extent.Text
                if (-not ($g -is [System.Management.Automation.Language.StringConstantExpressionAst] -or $g -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or $g -is [System.Management.Automation.Language.VariableExpressionAst])) { $gt = "($gt)" }
                $ar += $gt
            }
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = '(Ui-Kutu ' + ($ar -join ' ') + ')' }
        } elseif ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.FullName -eq 'System.Windows.Forms.Application' -and $n.Member.Value -eq 'DoEvents') {
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = 'Ui-Olaylar' }
        }
    }
    foreach ($n in $a.FindAll({ param($x) $x -is [System.Management.Automation.Language.MemberExpressionAst] -and -not ($x -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) }, $true)) {
        if ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.Name -eq 'Kayit' -and $n.Member.Value -eq 'AcikPencere') {
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = '(Ui-Acik-Diyalog)' }
        }
    }
    foreach ($d in ($deg | Sort-Object B -Descending)) { $t = $t.Substring(0, $d.B) + $d.Y + $t.Substring($d.S) }
    return $t.Replace("`r`n", "`n")
}

$eskiAst = [System.Management.Automation.Language.Parser]::ParseFile($Eski, [ref]$null, [ref]$null)
$eskiF = [ordered]@{}
foreach ($s in $eskiAst.EndBlock.Statements) { if ($s -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $eskiF[$s.Name] = $s.Extent.Text } }
$yeni = (Kaynak-Tarama $Kaynak).Fonk
$liste = @{}
$lYol = [System.IO.Path]::Combine($PSScriptRoot, 'TASIMA_DEGISEN.txt')
foreach ($l in [System.IO.File]::ReadAllLines($lYol)) {
    $t = $l.Trim(); if (-not $t -or $t.StartsWith('#')) { continue }
    $p = $t.Split('|'); if ($p.Length -lt 3) { Kaldi "TASIMA_DEGISEN.txt biçimi: $t"; continue }
    $liste[$p[0].Trim()] = @{ Tur = $p[1].Trim(); Neden = $p[2].Trim() }
}

Bolum 'Fonksiyonlar'
$ayni = 0; $degisti = 0; $kalkti = 0
foreach ($ad in $eskiF.Keys) {
    $l = $liste[$ad]
    if (-not $yeni.ContainsKey($ad)) {
        $kalkti++
        if ($l -and $l.Tur -eq 'KALDIRILDI') { Gecti "$ad : kaldırıldı ($($l.Neden))" }
        else { Kaldi "$ad teslimde yok" 'TASIMA_DEGISEN.txt içinde KALDIRILDI ve gerekçe olmalı' }
        continue
    }
    $e = Mekanik $eskiF[$ad]; $y = $yeni[$ad].Metin.Replace("`r`n", "`n")
    if ($e -ceq $y) {
        $ayni++
        if ($l) { Kaldi "$ad listede ($($l.Tur)) ama birebir aynı" 'listeden çıkarılmalı' }
        continue
    }
    $degisti++
    if ($l -and $l.Tur -eq 'DEGISTI') { Gecti "$ad : değişti ($($l.Neden))" }
    else { Kaldi "$ad değişti" "TASIMA_DEGISEN.txt içinde DEGISTI ve gerekçe olmalı ($([System.IO.Path]::GetFileName($yeni[$ad].Dosya)))" }
    if ($Fark) {
        $ea = $e.Split("`n"); $ya = $y.Split("`n")
        for ($i = 0; $i -lt [math]::Max($ea.Length, $ya.Length); $i++) {
            $x = if ($i -lt $ea.Length) { $ea[$i] } else { '<yok>' }; $z = if ($i -lt $ya.Length) { $ya[$i] } else { '<yok>' }
            if ($x -cne $z) { Write-Host "      - $x" -ForegroundColor DarkRed; Write-Host "      + $z" -ForegroundColor DarkGreen }
        }
    }
}
foreach ($ad in $liste.Keys) { if (-not $eskiF.Contains($ad)) { Kaldi "TASIMA_DEGISEN.txt: '$ad' eski panelde yok" } }
Bilgi "eski panelde $($eskiF.Count) fonksiyon: $ayni birebir, $degisti değişti (gerekçeli), $kalkti kaldırıldı (gerekçeli)"
Dogru ($ayni -ge 90) "en az 90 fonksiyon birebir taşındı ($ayni)"   # 95 idi; Devam-Kaydet / Devam-Sil / Devam-NC-Uret kaldığı yerden devam senaryoları için bilerek değişti
Ozet 'Taşıma'
