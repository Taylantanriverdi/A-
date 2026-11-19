# _Ortak.ps1 - PrimerMill testlerinin ortak yardımcıları. Test betiği bunu nokta ile yükler:
#     . (Join-Path $PSScriptRoot '_Ortak.ps1')
#
# Kaynak-Fonksiyonlari: panel kodunu ÇALIŞTIRMADAN, AST ile ayrıştırıp yalnız istenen fonksiyonları
# (ve istenen üst düzey değişken atamalarını) tanımlar. Kaynak tek bir .ps1 ya da klasör olabilir
# (klasörse içindeki tüm .ps1 dosyaları alt klasörlerle birlikte taranır; böylece aynı testler
# ileride teslim/PrimerMill altındaki lib/*.ps1'e bölünmüş koda karşı da çalışır).
#
# ÖNEMLİ: fonksiyonların test betiğinin kapsamında tanımlanması için NOKTA ile çağır:
#     . Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Sayi', 'Metin-Sayi' -Degiskenler 'BlokFont'
# Noktasız çağrılırsa fonksiyonlar global: kapsamda tanımlanır, değişkenler global olur.
#
# Doğrulama (çıktı vermez, sayaç tutar): Esit, Yakin, Dogru, Kaldi, Beklenen-Fark, Bilgi, Bolum; sonunda Ozet (çıkış kodu = başarısız sayısı).
# PowerShell 5.1 uyumlu (??, ?:, &&, ||, -Parallel yok).

$script:TestGecti = 0
$script:TestKaldi = 0
$script:TestBeklenen = 0
$script:TestKaldiListe = New-Object System.Collections.Generic.List[string]
$script:CI = [System.Globalization.CultureInfo]::InvariantCulture

function Varsayilan-Kaynak {
    # tests/../PrimerMill (klasör). Teslim kopyasında da aynı göreli yapı vardır.
    $k = [System.IO.Path]::Combine($PSScriptRoot, '..', 'PrimerMill')
    return [System.IO.Path]::GetFullPath($k)
}

function Kaynak-Dosyalari([string]$Kaynak) {
    if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
    if (Test-Path -LiteralPath $Kaynak -PathType Container) {
        return @(Get-ChildItem -LiteralPath $Kaynak -Filter '*.ps1' -Recurse -File | Sort-Object FullName | ForEach-Object { $_.FullName })
    }
    if (Test-Path -LiteralPath $Kaynak -PathType Leaf) { return @((Resolve-Path -LiteralPath $Kaynak).Path) }
    throw "Kaynak bulunamadı: $Kaynak"
}

# Fonksiyon tanımlarını ve üst düzey atamaları toplar. Dönüş: @{ Fonk = @{ad=@{Metin;Dosya;Satir}}; Deg = @{ad=@(metinler)} }
function Kaynak-Tarama([string]$Kaynak) {
    $sonuc = @{ Fonk = @{}; Deg = @{}; Dosyalar = @() }
    $dosyalar = Kaynak-Dosyalari $Kaynak
    $sonuc.Dosyalar = $dosyalar
    foreach ($d in $dosyalar) {
        $tok = $null; $perr = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($d, [ref]$tok, [ref]$perr)
        if ($perr -and $perr.Count) { throw "Ayrıştırma hatası: $d satır $($perr[0].Extent.StartLineNumber): $($perr[0].Message)" }
        $fonklar = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
        foreach ($fd in $fonklar) {
            # yalnız iç içe olmayan tanımlar (başka bir fonksiyonun içinde tanımlanan yardımcılar alınmaz)
            $p = $fd.Parent; $ic = $false
            while ($p) { if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $ic = $true; break }; $p = $p.Parent }
            if ($ic) { continue }
            # aynı ad birden çok yerde: sonraki kazanır (PowerShell çalışma anı davranışı)
            $sonuc.Fonk[$fd.Name] = @{ Metin = $fd.Extent.Text; Dosya = $d; Satir = $fd.Extent.StartLineNumber; Ast = $fd }
        }
        $atamalar = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)
        foreach ($as in $atamalar) {
            $p = $as.Parent; $ic = $false
            while ($p) {
                if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst] -or $p -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { $ic = $true; break }
                $p = $p.Parent
            }
            if ($ic) { continue }
            if (-not ($as.Left -is [System.Management.Automation.Language.VariableExpressionAst])) { continue }
            $ad = $as.Left.VariablePath.UserPath -replace '^(?i)(script|global):', ''
            if (-not $sonuc.Deg.ContainsKey($ad)) { $sonuc.Deg[$ad] = New-Object System.Collections.Generic.List[string] }
            $sonuc.Deg[$ad].Add($as.Extent.Text)
        }
    }
    return $sonuc
}

# Kaynak-Fonksiyonlari -Kaynak <dosya|klasör> -Adlar <fonksiyonlar> [-Degiskenler <adlar>] [-Bagimliliklar]
#  -Bagimliliklar: istenen fonksiyonların çağırdığı ve kaynakta tanımlı diğer fonksiyonları da (zincirleme) yükler.
#  -Degiskenler: bu adlara yapılan İLK üst düzey atama çalıştırılır (değeri başka değişkene bağlıysa testte önce onu ver).
#  Dönüş: yüklenen fonksiyonların listesi (ad, dosya, satır) - nokta ile çağrıldığında da çıktı verir, [void] ile yut.
function Kaynak-Fonksiyonlari {
    param([string]$Kaynak = '', [string[]]$Adlar = @(), [string[]]$Degiskenler = @(), [switch]$Bagimliliklar)
    $__kfNokta = ($MyInvocation.InvocationName -eq '.')
    $__kfT = Kaynak-Tarama $Kaynak
    $__kfIstek = New-Object System.Collections.Generic.List[string]
    foreach ($__kfA in $Adlar) { if (-not $__kfIstek.Contains($__kfA)) { $__kfIstek.Add($__kfA) } }
    if ($Bagimliliklar) {
        $__kfI = 0
        while ($__kfI -lt $__kfIstek.Count) {
            $__kfF = $__kfT.Fonk[$__kfIstek[$__kfI]]
            if ($__kfF) {
                foreach ($__kfC in $__kfF.Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
                    $__kfCn = $__kfC.GetCommandName()
                    if ($__kfCn -and $__kfT.Fonk.ContainsKey($__kfCn) -and -not $__kfIstek.Contains($__kfCn)) { $__kfIstek.Add($__kfCn) }
                }
            }
            $__kfI++
        }
    }
    foreach ($__kfA in $__kfIstek) { if (-not $__kfT.Fonk.ContainsKey($__kfA)) { throw "Fonksiyon bulunamadı: $__kfA (kaynak: $Kaynak)" } }
    foreach ($__kfA in $Degiskenler) { if (-not $__kfT.Deg.ContainsKey($__kfA)) { throw "Üst düzey değişken bulunamadı: `$$__kfA (kaynak: $Kaynak)" } }

    foreach ($__kfA in $Degiskenler) {
        $__kfMetin = $__kfT.Deg[$__kfA][0]
        if ($__kfNokta) { Invoke-Expression $__kfMetin }
        else {
            $__kfSag = $__kfMetin.Substring($__kfMetin.IndexOf('=') + 1)
            Set-Variable -Name $__kfA -Scope Global -Value (Invoke-Expression $__kfSag)
        }
    }
    $__kfListe = @()
    foreach ($__kfA in $__kfIstek) {
        $__kfF = $__kfT.Fonk[$__kfA]
        $__kfMetin = $__kfF.Metin
        if (-not $__kfNokta) {
            $__kfMetin = [regex]::Replace($__kfMetin, '^(?i)(function|filter)\s+', '$1 global:')
        }
        Invoke-Expression $__kfMetin
        $__kfListe += ('{0} ({1}:{2})' -f $__kfA, [System.IO.Path]::GetFileName($__kfF.Dosya), $__kfF.Satir)
    }
    return $__kfListe
}

# ---------------------------------------------------------------- doğrulama
function Bolum([string]$ad) { Write-Host ''; Write-Host "=== $ad ===" -ForegroundColor Cyan }
function Bilgi([string]$m) { Write-Host "  [BILGI] $m" -ForegroundColor DarkGray }
function Gecti([string]$ad) { $script:TestGecti++; Write-Host "  [GECTI] $ad" -ForegroundColor Green }
function Kaldi([string]$ad, [string]$neden = '') {
    $script:TestKaldi++
    $m = $ad; if ($neden) { $m = "$ad : $neden" }
    $script:TestKaldiListe.Add($m)
    Write-Host "  [KALDI] $m" -ForegroundColor Red
}
function Beklenen-Fark([string]$ad, [string]$neden = '') {
    $script:TestBeklenen++
    Write-Host "  [BEKLENEN FARK] $ad $neden" -ForegroundColor Yellow
}
function Metne([object]$v) {
    if ($null -eq $v) { return '<null>' }
    if ($v -is [double] -or $v -is [single] -or $v -is [decimal]) { return ([double]$v).ToString('R', $script:CI) }
    return [string]$v
}
function Esit($beklenen, $gercek, [string]$ad) {
    $ok = $false
    if ($null -eq $beklenen -or $null -eq $gercek) { $ok = ($null -eq $beklenen -and $null -eq $gercek) }
    elseif ($beklenen -is [string] -or $gercek -is [string]) { $ok = ([string]$beklenen -ceq [string]$gercek) }
    else { $ok = ($beklenen -eq $gercek) }
    if ($ok) { Gecti $ad } else { Kaldi $ad ("beklenen '" + (Metne $beklenen) + "', gelen '" + (Metne $gercek) + "'") }
}
function Yakin([double]$beklenen, $gercek, [double]$tol, [string]$ad) {
    $ok = ($null -ne $gercek) -and ([math]::Abs([double]$gercek - $beklenen) -le $tol)
    if ($ok) { Gecti $ad } else { Kaldi $ad ("beklenen " + (Metne $beklenen) + " ±" + (Metne $tol) + ", gelen " + (Metne $gercek)) }
}
function Dogru([bool]$kosul, [string]$ad, [string]$neden = '') {
    if ($kosul) { Gecti $ad } else { Kaldi $ad $neden }
}

# Bir betik bloğunu verilen kültürde çalıştırır, kültürü geri yükler
function Kulturde([string]$kultur, [scriptblock]$is) {
    $th = [System.Threading.Thread]::CurrentThread
    $eskiC = $th.CurrentCulture; $eskiU = $th.CurrentUICulture
    try {
        $c = [System.Globalization.CultureInfo]::GetCultureInfo($kultur)
        if ($kultur -eq '') { $c = [System.Globalization.CultureInfo]::InvariantCulture }
        $th.CurrentCulture = $c; $th.CurrentUICulture = $c
        return (& $is)
    } finally { $th.CurrentCulture = $eskiC; $th.CurrentUICulture = $eskiU }
}

function Gecici-Klasor([string]$on = 'pmtest') {
    $k = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), $on + '_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    [void][System.IO.Directory]::CreateDirectory($k)
    return $k
}

# ---------------------------------------------------------------- G-kod üreticileri (altın test + kültür testi ortak)
$script:GKodFonksiyonlar = @('Sayi', 'Blok-Kazima-NC', 'Blok-Birlesik-Uret', 'Kal-Saat', 'Kal-Duzen', 'Kal-Nokta', 'Kal-NC-Uret',
    'OkRot', 'OkModel', 'OtoKal-NC-Uret', 'OtoKal-Sim-Uret', 'Devam-NC-Uret')
$script:GKodDegiskenler = @('BlokFont', 'BlokKonumAci', 'BlokDalma', 'BlokIlerleme', 'KalGruplar', 'KalHalkaR', 'OkTeta', 'OkD', 'OkR', 'OkNoktalar')

# NOKTA ile çağır: . GKod-Yukle $Kaynak   (üreticileri, yardımcılarını ve sabitlerini yükler, $IsKlasor'u geçici klasöre kurar)
function GKod-Yukle([string]$Kaynak) {
    [void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar $script:GKodFonksiyonlar -Degiskenler $script:GKodDegiskenler -Bagimliliklar)
    $script:IsKlasor = Gecici-Klasor 'pm_isler'
    $IsKlasor = $script:IsKlasor
}

# Girdi dosyaları: tests/golden/girdi (kısaltılmış ZY2_45 + yapay takım değişimi; küçük iş) ve ornekler/
function GKod-Girdi([string]$ad) {
    $a = [System.IO.Path]::Combine($PSScriptRoot, 'golden', 'girdi', $ad)
    if (Test-Path -LiteralPath $a) { return [System.IO.Path]::GetFullPath($a) }
    $b = [System.IO.Path]::Combine($PSScriptRoot, '..', 'ornekler', $ad)
    if (Test-Path -LiteralPath $b) { return [System.IO.Path]::GetFullPath($b) }
    throw "Girdi bulunamadı: $ad"
}

# Sahte analiz: her satır 0.25 sn (Devam-NC-Uret 'yakin' modu ~60 sn = 240 satır geri gider)
function GKod-Analiz([string]$yol) {
    $n = [System.IO.File]::ReadAllLines($yol).Length
    $k = New-Object 'double[]' $n
    for ($i = 0; $i -lt $n; $i++) { $k[$i] = ($i + 1) * 0.25 }
    return @{ Kumulatif = $k }
}

# Normalleştirme: (1) satır sonu CRLF/LF farkı (Environment.NewLine platforma göre değişir) -> LF,
# (2) harf + negatif sıfır ("Y-0", "X-0.000") -> "Y0", "X0.000": .NET Core (pwsh) küçük negatifleri "-0" yazar,
#     .NET Framework (PS 5.1) ise kimi durumda "0"; Eding için ikisi aynı sayıdır, karşılaştırmada çalışma zamanı farkı sayılmaz,
# (3) YALNIZ şu başlık satırlarındaki tarih/saat damgası <TARIH> olur (başka hiçbir şey göz ardı edilmez):
#     (PrimerMill disk kalibrasyon testi ... yyyy-MM-dd HH:mm)
#     (PrimerMill OTOMATIK KALIBRASYON ... yyyy-MM-dd HH:mm)
#     (SIMULASYON - PrimerMill OTOMATIK KALIBRASYON ... yyyy-MM-dd HH:mm)
$script:GKodTarihSatiri = '^\((SIMULASYON - )?PrimerMill (disk kalibrasyon testi|OTOMATIK KALIBRASYON) '
function GKod-Normal([string]$m) {
    $m = $m.Replace("`r`n", "`n")
    $m = [regex]::Replace($m, '(?<=[A-Z])-0(\.0+)?(?![\d.])', '0$1')
    $satir = $m.Split("`n")
    for ($i = 0; $i -lt $satir.Length; $i++) {
        if ($satir[$i] -match $script:GKodTarihSatiri) { $satir[$i] = [regex]::Replace($satir[$i], '\d{4}-\d{2}-\d{2} \d{2}:\d{2}', '<TARIH>') }
    }
    return ($satir -join "`n")
}
function Liste-Metin($l) { $sb = New-Object System.Text.StringBuilder; foreach ($x in $l) { [void]$sb.Append([string]$x).Append("`n") }; return $sb.ToString() }

# Tüm üretici varyantlarını çalıştırır. Dönüş: sıralı liste @{ Ad = 'Uretici/varyant'; Metin = normalleştirilmiş çıktı }
function GKod-Uret {
    $ciktilar = New-Object System.Collections.Generic.List[object]
    $ekle = {
        param([string]$ad, [scriptblock]$is)
        $m = ''
        try { $m = GKod-Normal ([string](& $is)) } catch { $m = "HATA: $($_.Exception.Message)" }
        $ciktilar.Add(@{ Ad = $ad; Metin = $m })
    }
    $zy = GKod-Girdi 'ZY2_45_kisa.nc'; $kucuk = GKod-Girdi 'kucuk_is.nc'

    # --- Blok-Kazima-NC (metin, disk T, takım, yazı yüksekliği, konum, derinlik, referans çizgisi)
    & $ekle 'Blok-Kazima-NC/123_T18_t3_y3_saat12' { Liste-Metin (Blok-Kazima-NC '123' 18 3 3.0 '12') }
    & $ekle 'Blok-Kazima-NC/AB-7_T20_t2_y2.5_saat6_d0.3_cizgisiz' { Liste-Metin (Blok-Kazima-NC 'AB-7' 20 2 2.5 '6' 0.3 $false) }
    & $ekle 'Blok-Kazima-NC/PM.4-2_T16_t1_y4_saat3' { Liste-Metin (Blok-Kazima-NC 'PM.4/2' 16 1 4.0 '3') }
    & $ekle 'Blok-Kazima-NC/XYZ09_T25.5_t6_y5_saat9_d0.15' { Liste-Metin (Blok-Kazima-NC 'XYZ09' 25.5 6 5.0 '9' 0.15 $true) }

    # --- Blok-Birlesik-Uret (dosyaya yazar; dosya içeriği karşılaştırılır)
    $bb = {
        param([string]$girdi, $b)
        $y = Blok-Birlesik-Uret $girdi $b
        return ("(@@ dosya " + [System.IO.Path]::GetFileName($y) + ")`n" + [System.IO.File]::ReadAllText($y))
    }
    & $ekle 'Blok-Birlesik-Uret/ZY2_kisa_17_saat12' { & $bb $zy @{ Metin = '17'; T = 18.0; Takim = 3; Yuk = 3.0; Konum = '12'; Cizgi = $true } }
    & $ekle 'Blok-Birlesik-Uret/ZY2_kisa_K-5_saat6_cizgisiz_d0.25' { & $bb $zy @{ Metin = 'K-5'; T = 20.0; Takim = 2; Yuk = 2.5; Konum = '6'; Cizgi = $false; Derin = 0.25 } }
    & $ekle 'Blok-Birlesik-Uret/kucuk_is_kontrolsuz_A1_saat9' { & $bb $kucuk @{ Metin = 'A1'; T = 16.0; Takim = 1; Yuk = 3.5; Konum = '9' } }

    # --- Kal-NC-Uret (disk T, frez çapı D, test no k)
    & $ekle 'Kal-NC-Uret/T16_D2_k1' { Kal-NC-Uret 16 2.0 1 }
    & $ekle 'Kal-NC-Uret/T18_D1_k2' { Kal-NC-Uret 18 1.0 2 }
    & $ekle 'Kal-NC-Uret/T20_D3_k3' { Kal-NC-Uret 20 3.0 3 }
    & $ekle 'Kal-NC-Uret/T14_D2.5_k4' { Kal-NC-Uret 14 2.5 4 }

    # --- OtoKal-NC-Uret (disk T, kimlik)
    & $ekle 'OtoKal-NC-Uret/T16_k1' { OtoKal-NC-Uret 16 1 }
    & $ekle 'OtoKal-NC-Uret/T18_k12345' { OtoKal-NC-Uret 18 12345 }
    & $ekle 'OtoKal-NC-Uret/T10.02_k7' { OtoKal-NC-Uret 10.02 7 }

    # --- OtoKal-Sim-Uret (ölçüm programı metni, disk T)
    & $ekle 'OtoKal-Sim-Uret/uretilen_T16' { OtoKal-Sim-Uret (OtoKal-NC-Uret 16 1) 16 }
    & $ekle 'OtoKal-Sim-Uret/uretilen_T20' { OtoKal-Sim-Uret (OtoKal-NC-Uret 20 99) 20 }
    & $ekle 'OtoKal-Sim-Uret/ornek_olcum_10mm' { OtoKal-Sim-Uret ([System.IO.File]::ReadAllText((GKod-Girdi 'ornek_olcum_programi_10mm.nc'))) 10.02 }

    # --- Devam-NC-Uret (kaynak, durduğu satır, mod, analiz)
    $dv = {
        param([string]$girdi, [int]$satir, [string]$mod, $analiz)
        $r = Devam-NC-Uret $girdi $satir $mod $analiz
        $bas = "(@@ dosya $([System.IO.Path]::GetFileName($r.Yol)) Satir=$($r.Satir) Takim=$($r.Takim) HaritaBas=$($r.Harita.Bas) HaritaOrijinal=$($r.Harita.Orijinal) Tekrar=$(([double]$r.Tekrar).ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)))"
        return ($bas + "`n" + [System.IO.File]::ReadAllText($r.Yol))
    }
    $an = GKod-Analiz $zy
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s400_guvenli' { & $dv $zy 400 'guvenli' $an }
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s400_yakin' { & $dv $zy 400 'yakin' $an }
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s700_yakin_T2' { & $dv $zy 700 'yakin' $an }
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s700_yakin_analizsiz' { & $dv $zy 700 'yakin' $null }
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s5_guvenli' { & $dv $zy 5 'guvenli' $an }
    & $ekle 'Devam-NC-Uret/ZY2_kisa_s99999_yakin' { & $dv $zy 99999 'yakin' $an }
    & $ekle 'Devam-NC-Uret/kucuk_is_s8_yakin' { & $dv $kucuk 8 'yakin' (GKod-Analiz $kucuk) }
    return ,$ciktilar
}

function Ozet([string]$baslik = '') {
    Write-Host ''
    $m = "SONUC $baslik : gecti $($script:TestGecti), kaldi $($script:TestKaldi)"
    if ($script:TestBeklenen) { $m += ", beklenen fark $($script:TestBeklenen)" }
    if ($script:TestKaldi -gt 0) {
        Write-Host $m -ForegroundColor Red
        foreach ($k in $script:TestKaldiListe) { Write-Host "   - $k" -ForegroundColor Red }
    } else { Write-Host $m -ForegroundColor Green }
    $kod = $script:TestKaldi; if ($kod -gt 255) { $kod = 255 }
    exit $kod
}
