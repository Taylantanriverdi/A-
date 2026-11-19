# tasi.ps1 - lib/*.ps1 ilk sürümünü düzeltilmiş eski panelden MEKANİK olarak üretir (tarihçe / kanıt için saklanır).
# Yalnız ilk taşıma commit'inde çalıştırıldı; sonraki elle uyarlamalar git geçmişinde ve tests/TASIMA_DEGISEN.txt içinde.
# Dönüşümler: [Kayit]::Show(..) -> (Ui-Kutu ..), [System.Windows.Forms.Application]::DoEvents() -> Ui-Olaylar, [Kayit]::AcikPencere -> (Ui-Acik-Diyalog).
# Eski panelden lib/*.ps1 üretir: fonksiyonlar ve üst düzey satırlar BİREBİR, yalnız mekanik dönüşümler.
param([string]$Eski = (Join-Path $PSScriptRoot '../../PrimerMill/KazimaBaslat.ps1'),
      [string]$Hedef = (Join-Path $PSScriptRoot '../../teslim/PrimerMill/lib'))
$ErrorActionPreference = 'Stop'
$metin = [System.IO.File]::ReadAllText($Eski)
$satir = $metin.Split(@("`r`n"), [StringSplitOptions]::None)
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Eski, [ref]$null, [ref]$null)
$fonk = @{}
foreach ($s in $ast.EndBlock.Statements) { if ($s -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $fonk[$s.Name] = $s } }

function Donustur([string]$t) {
    $a = [System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$null)
    $deg = @()
    foreach ($n in $a.FindAll({ param($x) $x -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
        if ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.Name -eq 'Kayit' -and $n.Member.Value -eq 'Show') {
            $args2 = @()
            foreach ($g in $n.Arguments) {
                $gt = $g.Extent.Text
                if (-not ($g -is [System.Management.Automation.Language.StringConstantExpressionAst] -or $g -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or $g -is [System.Management.Automation.Language.VariableExpressionAst])) { $gt = "($gt)" }
                $args2 += $gt
            }
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = '(Ui-Kutu ' + ($args2 -join ' ') + ')' }
        }
        elseif ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.FullName -eq 'System.Windows.Forms.Application' -and $n.Member.Value -eq 'DoEvents') {
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = 'Ui-Olaylar' }
        }
    }
    foreach ($n in $a.FindAll({ param($x) $x -is [System.Management.Automation.Language.MemberExpressionAst] -and -not ($x -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) }, $true)) {
        if ($n.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and $n.Expression.TypeName.Name -eq 'Kayit' -and $n.Member.Value -eq 'AcikPencere') {
            $deg += [pscustomobject]@{ B = $n.Extent.StartOffset; S = $n.Extent.EndOffset; Y = '(Ui-Acik-Diyalog)' }
        }
    }
    foreach ($d in ($deg | Sort-Object B -Descending)) { $t = $t.Substring(0, $d.B) + $d.Y + $t.Substring($d.S) }
    return $t
}

$spec = Import-PowerShellDataFile (Join-Path $PSScriptRoot 'spec.psd1')
foreach ($dosya in $spec.Keys) {
    $c = $spec[$dosya]
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($l in $c.Bas) { $out.Add($l) }
    foreach ($o in $c.Oge) {
        if ($o.StartsWith('F:')) {
            $ad = $o.Substring(2)
            if (-not $fonk.ContainsKey($ad)) { throw "yok: $ad" }
            $f = $fonk[$ad]
            # fonksiyonun hemen üstündeki yorum satırları da gelir
            $i = $f.Extent.StartLineNumber - 2; $yorum = @()
            while ($i -ge 0 -and $satir[$i].TrimStart().StartsWith('#')) { $yorum = @($satir[$i]) + $yorum; $i-- }
            foreach ($y in $yorum) { $out.Add($y) }
            $out.Add((Donustur $f.Extent.Text).Replace("`r`n", "`n").Replace("`n", "`r`n"))
        } elseif ($o.StartsWith('L:')) {
            $p = $o.Substring(2).Split('-'); $a1 = [int]$p[0]; $a2 = [int]$p[$p.Length - 1]
            $out.Add((Donustur (($satir[($a1 - 1)..($a2 - 1)]) -join "`r`n")))
        } elseif ($o.StartsWith('T:')) { $out.Add($o.Substring(2)) }
        else { $out.Add('') }
    }
    $yol = Join-Path $Hedef $dosya
    $govde = ($out -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($yol, $govde, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host "$dosya : $($out.Count) parça"
}
