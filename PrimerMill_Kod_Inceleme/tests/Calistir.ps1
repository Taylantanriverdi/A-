# Calistir.ps1 - tests klasöründeki tüm *_Testi.ps1 betiklerini ayrı bir PowerShell sürecinde çalıştırır ve özet tablo basar.
# Önce yerleşik "Sözdizimi" denetimi: kaynak ve test .ps1 dosyaları ayrıştırıcıdan hatasız geçmeli, BOM'lu UTF-8 olmalı,
# pwsh altında çalışırken PowerShell 7'ye özgü sözdizimi (??, ?., ?:, &&, ||, ??=) aranır.
#
# Çalıştırma (Windows):  powershell -ExecutionPolicy Bypass -File tests\Calistir.ps1
#   32 bit:              %SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File tests\Calistir.ps1
#   pwsh:                pwsh -NoProfile -File tests/Calistir.ps1
# Seçenekler:
#   -Kaynak <klasör|.ps1>  test edilecek kod (varsayılan ../PrimerMill). Klasör verilirse eski iki test (Kal_NC_Cep, OtoKal_Hesap)
#                          o klasördeki KazimaBaslat.ps1'i alır.
#   -Filtre <desen>        yalnız adı desene uyan testler (ör. 'GKod*')
#   -Exe <yol>             alt süreç için PowerShell (varsayılan: bu betiği çalıştıran PowerShell)
#   -Sessiz                testlerin kendi çıktısını basma, yalnız özet
# Çıkış kodu: 0 yalnız hepsi geçerse.
param([string]$Kaynak = '', [string]$Filtre = '*', [string]$Exe = '', [switch]$Sessiz)
$ErrorActionPreference = 'Stop'
$testKlasor = $PSScriptRoot
if (-not $Kaynak) { $Kaynak = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($testKlasor, '..', 'PrimerMill')) }
else { $Kaynak = (Resolve-Path -LiteralPath $Kaynak).Path }
if (-not $Exe) { $Exe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName }
$pwshMi = ($PSVersionTable.PSEdition -eq 'Core')

Write-Host "Kaynak    : $Kaynak"
Write-Host "PowerShell: $Exe  ($($PSVersionTable.PSVersion), $(if ([IntPtr]::Size -eq 4) { '32' } else { '64' }) bit)"
Write-Host ''

$sonuclar = @()

# ------------------------------------------------------------------ yerleşik: sözdizimi denetimi
$t0 = Get-Date
$sorun = @()
$dosyalar = @()
if (Test-Path -LiteralPath $Kaynak -PathType Container) { $dosyalar += @(Get-ChildItem -LiteralPath $Kaynak -Filter '*.ps1' -Recurse -File | ForEach-Object { $_.FullName }) }
else { $dosyalar += $Kaynak }
# teslim klasöründe: .ps1 dosyaları CRLF, .bat dosyaları ASCII olmalı (CLAUDE.md kural 2)
$teslimMi = (Test-Path -LiteralPath $Kaynak -PathType Container) -and (Test-Path -LiteralPath ([System.IO.Path]::Combine($Kaynak, 'lib')))
$dosyalar += @(Get-ChildItem -LiteralPath $testKlasor -Filter '*.ps1' -File | ForEach-Object { $_.FullName })
$ps7Turler = @('TernaryExpressionAst', 'PipelineChainAst')
foreach ($d in $dosyalar) {
    $kisa = [System.IO.Path]::GetFileName($d)
    $b = [System.IO.File]::ReadAllBytes($d)
    if (-not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) { $sorun += "$kisa : BOM'lu UTF-8 değil" }
    if ($teslimMi -and $d.StartsWith($Kaynak)) {
        $lfSay = 0; for ($i = 0; $i -lt $b.Length; $i++) { if ($b[$i] -eq 10 -and ($i -eq 0 -or $b[$i - 1] -ne 13)) { $lfSay++ } }
        if ($lfSay -gt 0) { $sorun += "$kisa : $lfSay satır CRLF değil" }
    }
    $tok = $null; $perr = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($d, [ref]$tok, [ref]$perr)
    foreach ($e in $perr) { $sorun += "$kisa satır $($e.Extent.StartLineNumber): $($e.Message)" }
    if ($pwshMi -and $ast) {
        $bul = $ast.FindAll({ param($n) ($ps7Turler -contains $n.GetType().Name) -or
                ($n -is [System.Management.Automation.Language.BinaryExpressionAst] -and "$($n.Operator)" -eq 'QuestionQuestion') -or
                ($n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Operator)" -eq 'QuestionQuestionEquals') -or
                ($n -is [System.Management.Automation.Language.MemberExpressionAst] -and $n.NullConditional) }, $true)
        foreach ($n in $bul) { $sorun += "$kisa satır $($n.Extent.StartLineNumber): PowerShell 7 sözdizimi: $($n.Extent.Text.Split("`n")[0])" }
    }
}
if ($teslimMi) {
    foreach ($bat in @(Get-ChildItem -LiteralPath $Kaynak -Filter '*.bat' -Recurse -File)) {
        $bb = [System.IO.File]::ReadAllBytes($bat.FullName)
        if (@($bb | Where-Object { $_ -gt 127 }).Count) { $sorun += "$($bat.Name) : ASCII dışı karakter var (.bat ASCII olmalı)" }
        $lfSay = 0; for ($i = 0; $i -lt $bb.Length; $i++) { if ($bb[$i] -eq 10 -and ($i -eq 0 -or $bb[$i - 1] -ne 13)) { $lfSay++ } }
        if ($lfSay -gt 0) { $sorun += "$($bat.Name) : $lfSay satır CRLF değil (.bat CRLF olmalı)" }
    }
}
$durum = 'GECTI'; if ($sorun.Count) { $durum = 'KALDI' }
if ($sorun.Count) { foreach ($s in $sorun) { Write-Host "  [KALDI] $s" -ForegroundColor Red } }
$sonuclar += [pscustomobject]@{ Test = 'Sozdizimi (yerlesik)'; Sonuc = $durum; Kod = $sorun.Count; Sure = ((Get-Date) - $t0).TotalSeconds; Ozet = "$($dosyalar.Count) dosya, $($sorun.Count) sorun" }

# ------------------------------------------------------------------ testler
$testler = @(Get-ChildItem -LiteralPath $testKlasor -Filter '*_Testi.ps1' -File | Where-Object { $_.Name -like $Filtre } | Sort-Object Name)
foreach ($t in $testler) {
    Write-Host ('=' * 70) -ForegroundColor Cyan
    Write-Host "  $($t.Name)" -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor Cyan
    $icerik = [System.IO.File]::ReadAllText($t.FullName)
    $arg = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $t.FullName)
    if ($icerik -match '\$Kaynak') {
        $k = $Kaynak
        # _Ortak.ps1 kullanmayan eski testler tek bir KazimaBaslat.ps1 dosyası bekler; klasör kabul edenler (fonksiyonlar lib/*.ps1
        # içinde olabilir: 'PathType Container' denetimi yapanlar) klasörü alır
        if (($icerik -notmatch '_Ortak\.ps1') -and ($icerik -notmatch 'PathType Container') -and (Test-Path -LiteralPath $Kaynak -PathType Container)) {
            $k = [System.IO.Path]::Combine($Kaynak, 'KazimaBaslat.ps1')
            if (-not (Test-Path -LiteralPath $k)) {
                $aday = @(Get-ChildItem -LiteralPath $Kaynak -Filter 'KazimaBaslat*.ps1' -Recurse -File | Select-Object -First 1)
                if ($aday.Count) { $k = $aday[0].FullName }
            }
        }
        $arg += @('-Kaynak', $k)
    }
    $bas = Get-Date
    $cikti = @()
    $eskiEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        & $Exe @arg 2>&1 | ForEach-Object {
            $s = "$_"; $cikti += $s
            if (-not $Sessiz) { Write-Host $s }
        }
        $kod = $LASTEXITCODE
    } catch { $kod = 999; $cikti += $_.Exception.Message; Write-Host $_.Exception.Message -ForegroundColor Red }
    $ErrorActionPreference = $eskiEap
    $sure = ((Get-Date) - $bas).TotalSeconds
    $ozet = @($cikti | Where-Object { $_ -match '^\s*SONUC|^\s*SONUÇ|gecti|geçti' } | Select-Object -Last 1)
    $oz = ''; if ($ozet.Count) { $oz = $ozet[0].Trim() }
    if ($oz.Length -gt 70) { $oz = $oz.Substring(0, 70) + '…' }
    $durum = 'GECTI'; if ($kod -ne 0) { $durum = 'KALDI' }
    $sonuclar += [pscustomobject]@{ Test = $t.BaseName; Sonuc = $durum; Kod = $kod; Sure = $sure; Ozet = $oz }
}

# ------------------------------------------------------------------ özet tablo
Write-Host ''
Write-Host ('{0,-26} {1,-6} {2,5} {3,8}  {4}' -f 'TEST', 'SONUC', 'KOD', 'SURE(sn)', 'OZET')
Write-Host ('-' * 100)
$kalan = 0
foreach ($s in $sonuclar) {
    $renk = 'Green'; if ($s.Sonuc -ne 'GECTI') { $renk = 'Red'; $kalan++ }
    Write-Host ('{0,-26} {1,-6} {2,5} {3,8}  {4}' -f $s.Test, $s.Sonuc, $s.Kod, ([double]$s.Sure).ToString('0.0', [System.Globalization.CultureInfo]::InvariantCulture), $s.Ozet) -ForegroundColor $renk
}
Write-Host ('-' * 100)
if ($kalan -eq 0) { Write-Host "HEPSI GECTI ($($sonuclar.Count))" -ForegroundColor Green; exit 0 }
Write-Host "$kalan / $($sonuclar.Count) KALDI" -ForegroundColor Red
exit 1
