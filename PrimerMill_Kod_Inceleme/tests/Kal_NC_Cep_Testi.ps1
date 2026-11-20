# Kal_NC_Cep_Testi.ps1 - DİSK KALİBRASYONU test programındaki cep çaplarını denetler (Eding'siz, AST ile çıkarım).
# Çalıştırma: pwsh -NoProfile -File tests/Kal_NC_Cep_Testi.ps1 [-Kaynak <KazimaBaslat.ps1>]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '')
$ErrorActionPreference = 'Stop'
if (-not $Kaynak) {
    foreach ($a in @([System.IO.Path]::Combine($PSScriptRoot, '..', 'PrimerMill', 'KazimaBaslat.ps1'))) { if (Test-Path -LiteralPath $a) { $Kaynak = (Resolve-Path -LiteralPath $a).Path; break } }
}
# Kaynak klasörse (teslim/PrimerMill: fonksiyonlar lib/*.ps1 içinde) bütün .ps1 dosyaları (*_Klasik hariç) tek metin olarak ayrıştırılır
if (Test-Path -LiteralPath $Kaynak -PathType Container) {
    $metin = (@(Get-ChildItem -LiteralPath $Kaynak -Filter '*.ps1' -Recurse -File | Where-Object { $_.Name -notlike '*_Klasik.ps1' } | Sort-Object FullName | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n")
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($metin, [ref]$null, [ref]$null)
} else { $ast = [System.Management.Automation.Language.Parser]::ParseFile($Kaynak, [ref]$null, [ref]$null) }
$fAd = @('Kal-Saat', 'Kal-Duzen', 'Kal-Nokta', 'Kal-NC-Uret', 'Park-Satirlari'); $vAd = @('KalGruplar', 'KalHalkaR')
foreach ($n in $ast.EndBlock.Statements) {
    if ($n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and ($vAd -contains $n.Left.VariablePath.UserPath)) { Invoke-Expression $n.Extent.Text }
}
foreach ($fd in $ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { if ($fAd -contains $fd.Name) { Invoke-Expression $fd.Extent.Text } }
$hata = 0
foreach ($D in @(2.0, 1.0, 3.0)) {
    $nc = Kal-NC-Uret 16 $D 1
    $dz = Kal-Duzen 1
    foreach ($ad in @('Sag', 'On', 'Sol', 'Arka', 'Orta')) {
        $c = $dz[$ad]; $rMax = 0.0
        foreach ($ln in ($nc -split "`r?`n")) {
            $m = [regex]::Match($ln, '^G1 X(-?[\d.]+) Y(-?[\d.]+) Z(-?[\d.]+)')
            if ($m.Success) {
                $x = [double]::Parse($m.Groups[1].Value, [System.Globalization.CultureInfo]::InvariantCulture); $y = [double]::Parse($m.Groups[2].Value, [System.Globalization.CultureInfo]::InvariantCulture)
                $r = [math]::Sqrt(($x - $c.X) * ($x - $c.X) + ($y - $c.Y) * ($y - $c.Y)); if ($r -lt $c.R + 1.5 -and $r -gt $rMax) { $rMax = $r }
            }
        }
        $cap = 2 * ($rMax + $D / 2); $bek = 2 * $c.R
        $dur = 'GECTI'; if ([math]::Abs($cap - $bek) -gt 0.02) { $dur = 'KALDI'; $hata++ }
        Write-Host ("[{0}] T1 Ø{1}  cep {2,-5} beklenen Ø{3}  kazılan Ø{4}" -f $dur, $D, $ad, $bek, $cap.ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture))
    }
}
exit $hata
