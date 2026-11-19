# Ayar_Testi.ps1 - ayar dosyalarının yaz/oku gidiş-dönüşü (geçici klasörde, Türkçe karakterlerle, tr-TR / zh-CN / de-DE altında).
#  - Tercih-Yaz / Tercih-Oku  (panel_ayarlar.ini: anahtar=değer)
#  - ayarlar.txt (Eding programının yolu) -> Eding-Exe-Bul
#  - Degisken-Yaz, Ayar-Yedekle (ayar_*.txt), Ayar-Geri-Yukle, Ayar-Kaydet: Eding yerine lib/EdingSim.cs kullanılır;
#    arayüz parçaları (Baglan, Yaz, Onay, Hazir-Hareket, Ayar-Oku, dosya seçme penceresi, metin kutuları) sahte.
# Çalıştırma: pwsh -NoProfile -File tests/Ayar_Testi.ps1 [-Kaynak <PrimerMill klasörü | .ps1>] [-Sim <EdingSim.cs>]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [string]$Sim = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
if (-not $Sim) {
    $Sim = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'lib', 'EdingSim.cs'))
    if (-not (Test-Path -LiteralPath $Sim)) { $alt = [System.IO.Path]::Combine($Kaynak, 'lib', 'EdingSim.cs'); if (Test-Path -LiteralPath $alt) { $Sim = $alt } }
}
Write-Host "Kaynak: $Kaynak"
Write-Host "Sim   : $Sim"

if (-not ('Eding' -as [type])) { Add-Type -Path $Sim }
if (-not ('Kayit' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Collections.Generic;
public static class Kayit {
    public static List<string> Satirlar = new List<string>();
    public static List<string> Mesajlar = new List<string>();
    public static void Yaz(string s) { Satirlar.Add(s); }
    public static string Show(string metin, string baslik, string dugme, string ikon) { Mesajlar.Add(baslik + ": " + metin); return "OK"; }
}
'@
}

[void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Tercih-Oku', 'Tercih-Yaz', 'Eding-Exe-Bul', 'Ayar-Yedekle', 'Ayar-Geri-Yukle', 'Ayar-Kaydet', 'Degisken-Yaz', 'Sayi', 'Metin-Sayi', 'Rc-Tamam', 'Komut-Sonucu' -Degiskenler 'ParamTanim', 'RafTanim' -Bagimliliklar)
$script:ApiHazir = $true; $script:Bagli = $true; $script:IsAktif = $false

# --- sahte arayüz / bağlantı
$script:Loglar = New-Object System.Collections.Generic.List[string]
function Yaz([string]$m) { $script:Loglar.Add($m) }
function Baglan { return $true }
function Hazir-Hareket([string]$islem) { return $true }
function Onay([string]$metin, [string]$baslik) { $script:SonOnay = $metin; return $true }
function Ayar-Oku { }
$form = $null
# PrimerMill 2 (teslim/PrimerMill, lib/*.ps1): arayüz kapısı sahteleri. Mesaj kutuları eskisi gibi [Kayit]::Show sahtesine,
# tehlikeli onay Onay sahtesiyle aynı yere ($script:SonOnay), yedek seçici sahte dosyaya gider. Eski panelde kullanılmazlar.
function Ui-Kutu([string]$metin, [string]$baslik, [string]$dugme = 'OK', [string]$simge = '') { return [Kayit]::Show($metin, $baslik, $dugme, $simge) }
function Ui-Tehlikeli-Onay([string]$baslik, [string]$metin, $eski, $yeni, [string]$yedek) { $script:SonOnay = $metin; $script:SonYedekOnay = $yedek; return $true }
function Ui-Liste-Sec([string]$baslik, [string[]]$ogeler, [string[]]$aciklamalar, [string]$ek) { return [array]::IndexOf($ogeler, [System.IO.Path]::GetFileName([string]$script:SahteDosya)) }
function Ui-Dosya-Ac([string]$baslik, [string]$filtre, [string]$klasor) { return $script:SahteDosya }

$kok = Gecici-Klasor 'pm_ayar'
$ScriptKlasor = [System.IO.Path]::Combine($kok, 'PrimerMill_Çalışma İşleri')
$EdingKlasor = [System.IO.Path]::Combine($kok, 'CNC_Ğüşiöç')
[void][System.IO.Directory]::CreateDirectory($ScriptKlasor); [void][System.IO.Directory]::CreateDirectory($EdingKlasor)
$TercihDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'panel_ayarlar.ini')
$AyarDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'ayarlar.txt')
Bilgi "geçici klasör: $kok"

[Eding]::SimSifirla(); [void][Eding]::CncConnectServer('')

foreach ($k in @('', 'tr-TR', 'zh-CN', 'de-DE')) {
    $kad = $k; if (-not $kad) { $kad = 'Invariant' }
    Bolum "Kültür: $kad"
    Kulturde $k {
        # ---------------------------------------------------------- Tercih-Yaz / Tercih-Oku
        if (Test-Path -LiteralPath $TercihDosyasi) { Remove-Item -LiteralPath $TercihDosyasi -Force }
        $script:Tercih = @{ OtomatikHazirlik = '1' }
        Tercih-Oku
        Esit 1 $script:Tercih.Count "[$kad] dosya yokken Tercih-Oku varsayılanları korur"
        $ornek = [ordered]@{
            MakineAdi = 'Atölye Ğüşiöç İIı'; IsKlasor = 'P:\CNC\İşler\çıktı'; KalT = '18,50'; BlokYuk = '3.0'; WebPin = '0427'
            Esitli = 'a=b=c'; Bos = ''; Işık = 'açık'; FrezModu = 'MANUEL'; Uzun = ('x' * 500); Cince = '机床设置'
        }
        $script:Tercih = @{}; foreach ($a in $ornek.Keys) { $script:Tercih[$a] = $ornek[$a] }
        Tercih-Yaz
        Dogru (Test-Path -LiteralPath $TercihDosyasi) "[$kad] Tercih-Yaz dosya oluşturdu"
        $ham = [System.IO.File]::ReadAllBytes($TercihDosyasi)
        $bom = ($ham.Length -ge 3 -and $ham[0] -eq 0xEF -and $ham[1] -eq 0xBB -and $ham[2] -eq 0xBF)
        Bilgi "[$kad] panel_ayarlar.ini UTF-8, BOM: $bom, $($ham.Length) bayt"
        $metin = [System.IO.File]::ReadAllText($TercihDosyasi, [System.Text.Encoding]::UTF8)
        Dogru ($metin.Contains('MakineAdi=Atölye Ğüşiöç İIı')) "[$kad] dosyada Türkçe karakterler doğru (UTF-8)"
        $script:Tercih = @{}
        Tercih-Oku
        foreach ($a in $ornek.Keys) { Esit ([string]$ornek[$a]) ([string]$script:Tercih[$a]) "[$kad] Tercih gidiş-dönüş: $a" }
        Esit $ornek.Count $script:Tercih.Count "[$kad] Tercih anahtar sayısı"
        $sira = @([System.IO.File]::ReadAllLines($TercihDosyasi) | ForEach-Object { ($_ -split '=', 2)[0] })
        Bilgi ("[$kad] dosyadaki sıra (Sort-Object, kültüre bağlı olabilir): " + ($sira -join ' '))
        if (-not $script:TercihSira) { $script:TercihSira = $sira -join ' ' }
        elseif ($script:TercihSira -ne ($sira -join ' ')) { Bilgi "[$kad] UYARI: anahtar sırası InvariantCulture'dakinden farklı (yalnız dosya düzeni; okuma etkilenmez)" }

        # Elle düzenlenmiş dosya: BOM'lu, boşluklu, yorum ve bölüm satırları
        $elle = "; yorum satırı`r`n[Bölüm]`r`n  GeriSayim =  7  `r`nKoordinat=MAKINE`r`nbozuk satır`r`nMakineAdi = Çınar `r`n"
        [System.IO.File]::WriteAllText($TercihDosyasi, $elle, (New-Object System.Text.UTF8Encoding($true)))
        $script:Tercih = @{ Koordinat = 'IS' }
        Tercih-Oku
        Esit '7' $script:Tercih.GeriSayim "[$kad] elle yazılmış: boşluklar kırpılır"
        Esit 'MAKINE' $script:Tercih.Koordinat "[$kad] elle yazılmış: dosyadaki değer varsayılanı ezer"
        Esit 'Çınar' $script:Tercih.MakineAdi "[$kad] BOM'lu UTF-8 dosya Türkçe okunur"
        Esit 3 $script:Tercih.Count "[$kad] yorum / bölüm / bozuk satır yok sayılır"

        # ---------------------------------------------------------- ayarlar.txt -> Eding-Exe-Bul
        $exe = [System.IO.Path]::Combine($EdingKlasor, 'cnc_Şimşek.exe')
        [System.IO.File]::WriteAllText($exe, 'MZ')
        [System.IO.File]::WriteAllText($AyarDosyasi, $exe)           # Eding-Baslat ile aynı yazma biçimi
        Esit $exe (Eding-Exe-Bul) "[$kad] ayarlar.txt'deki Türkçe yol okunur"
        [System.IO.File]::WriteAllText($AyarDosyasi, "  $exe  `r`n")
        Esit $exe (Eding-Exe-Bul) "[$kad] ayarlar.txt boşluk/satır sonu kırpılır"
        [System.IO.File]::WriteAllText($AyarDosyasi, $exe.ToUpperInvariant())
        $sonuc = Eding-Exe-Bul
        if ([System.IO.File]::Exists($exe.ToUpperInvariant())) { Esit $exe.ToUpperInvariant() $sonuc "[$kad] büyük/küçük harf farkı (dosya sistemi duyarsız)" }
        else { Bilgi "[$kad] dosya sistemi büyük/küçük harfe duyarlı: büyük harfli yol yok sayıldı -> '$sonuc'" }
        $cnc = [System.IO.Path]::Combine($EdingKlasor, 'cnc.exe'); [System.IO.File]::WriteAllText($cnc, 'MZ')
        [System.IO.File]::WriteAllText($AyarDosyasi, 'C:\Baska\Yer\cnc.exe')
        Esit $cnc (Eding-Exe-Bul) "[$kad] Eding klasörü dışındaki kayıt yok sayılır, cnc.exe bulunur"
        Remove-Item -LiteralPath $cnc -Force

        # ---------------------------------------------------------- Degisken-Yaz (EdingSim)
        Dogru (Degisken-Yaz 4100 1.5) "[$kad] Degisken-Yaz 4100 1.5 -> rc tamam"
        Yakin 1.5 ([Eding]::CncGetVariable(4100)) 1e-12 "[$kad] #4100 = 1.5 (nokta ile gönderildi)"
        Dogru (Degisken-Yaz 4101 -0.0004) "[$kad] Degisken-Yaz küçük negatif"
        Yakin 0 ([Eding]::CncGetVariable(4101)) 1e-12 "[$kad] #4101 = 0 (3 basamak)"
        Dogru ([Kayit]::Satirlar[[Kayit]::Satirlar.Count - 1] -match '^DEĞİŞKEN> #4101=-?0\.000 ') "[$kad] kayıt satırı noktalı" ([Kayit]::Satirlar[[Kayit]::Satirlar.Count - 1])

        # ---------------------------------------------------------- Ayar-Yedekle / Ayar-Geri-Yukle
        [Eding]::SimSifirla(); [void][Eding]::CncConnectServer('')
        $YedekKlasoru = [System.IO.Path]::Combine($ScriptKlasor, 'yedekler_ş')
        if (Test-Path -LiteralPath $YedekKlasoru) { Remove-Item -LiteralPath $YedekKlasoru -Recurse -Force }
        $once = @{}; foreach ($nr in @(5221, 5222, 5223, 5224, 5225) + @($ParamTanim.Keys | ForEach-Object { [int]$_ }) + @($RafTanim.Keys | ForEach-Object { [int]$_ })) { $once[$nr] = [Eding]::CncGetVariable($nr) }
        [Eding]::SimDegiskenYaz(4010, -125.557); [Eding]::SimDegiskenYaz(4011, -89.166); $once[4010] = -125.557; $once[4011] = -89.166
        [void](Ayar-Yedekle $true)
        $dosyalar = @(Get-ChildItem -LiteralPath $YedekKlasoru -Filter 'ayar_*.txt')
        Esit 1 $dosyalar.Count "[$kad] Ayar-Yedekle bir dosya yazdı (Türkçe klasör adıyla)"
        if ($dosyalar.Count -eq 1) {
            $yedek = $dosyalar[0].FullName
            Dogru ($dosyalar[0].Name -match '^ayar_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$') "[$kad] yedek dosya adı biçimi" $dosyalar[0].Name
            $sat = [System.IO.File]::ReadAllLines($yedek)
            Dogru ($sat[0].StartsWith('; PrimerMill ayar yedeği')) "[$kad] yedek başlık satırı"
            $bozuk = @($sat | Select-Object -Skip 1 | Where-Object { $_ -notmatch '^#\d+=-?\d+\.\d{3}$' })
            Dogru ($bozuk.Count -eq 0) "[$kad] tüm satırlar '#nr=sayı' ve nokta ondalıklı" ($bozuk -join ' | ')
            $d = @{}; foreach ($l in $sat) { $m = [regex]::Match($l, '^#(\d+)=(-?[0-9.]+)'); if ($m.Success) { $d[[int]$m.Groups[1].Value] = $m.Groups[2].Value } }
            foreach ($nr in @(5221, 5223, 5225, 4002, 4010)) { Esit (Sayi $once[$nr]) $d[$nr] "[$kad] yedekte #$nr" }
            $kayip = 0.0; foreach ($nr in $d.Keys) { $fk = [math]::Abs([double]::Parse($d[$nr], $script:CI) - [Eding]::CncGetVariable($nr)); if ($fk -gt $kayip) { $kayip = $fk } }
            if ($kayip -gt 1e-9) { Bilgi ("[$kad] UYARI: yedek 3 ondalık basamak saklıyor; cnc.ini değerlerinde en çok {0} fark (ör. #5221 -53.1425 -> -53.143)" -f $kayip.ToString('0.0000', $script:CI)) }

            # Değerleri boz, yedekten geri yükle (dosya seçme penceresi sahte)
            foreach ($nr in @(5221, 5222, 5223, 5224, 5225, 4002, 4005, 4010, 4011)) { [Eding]::SimDegiskenYaz($nr, 999.0) }
            $script:SahteDosya = $yedek
            function New-Object {
                param([string]$TypeName, [object[]]$ArgumentList)
                if ($TypeName -eq 'System.Windows.Forms.OpenFileDialog') {
                    $o = [pscustomobject]@{ InitialDirectory = ''; Filter = ''; FileName = $script:SahteDosya }
                    $o | Add-Member -MemberType ScriptMethod -Name ShowDialog -Value { param($sahip) return 'OK' }
                    return $o
                }
                if ($ArgumentList) { return (Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName -ArgumentList $ArgumentList) }
                return (Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName)
            }
            try { [void](Ayar-Geri-Yukle) } finally { Remove-Item -LiteralPath function:New-Object -ErrorAction SilentlyContinue }
            Dogru ($script:SonOnay -match 'G54  X -53\.143') "[$kad] geri yükleme onay metni G54 değerlerini gösterir"
            foreach ($nr in @(5221, 5222, 5223, 5224, 5225, 4002, 4005, 4010, 4011)) {
                Yakin $once[$nr] ([Eding]::CncGetVariable($nr)) 0.0005000001 "[$kad] geri yüklendi #$nr (±0.0005, 3 basamak)"
            }
            Remove-Item -LiteralPath $yedek -Force
        }

        # ---------------------------------------------------------- Ayar-Kaydet (metin kutuları sahte, virgüllü giriş)
        $script:G54Kutu = @{}; $script:ParamKutu = @{}
        $g = @{ X = '-53,1425'; Y = '-53.456'; Z = '208,9'; A = '20,209'; B = '-2.3508' }
        foreach ($a in $g.Keys) { $script:G54Kutu[$a] = [pscustomobject]@{ Text = $g[$a] } }
        foreach ($nr in $ParamTanim.Keys) { $script:ParamKutu[$nr] = [pscustomobject]@{ Text = (Sayi ([Eding]::CncGetVariable([int]$nr))).Replace('.', ',') } }
        $script:ParamKutu[4002].Text = '32,5'
        [void](Ayar-Kaydet)
        Yakin -53.143 ([Eding]::CncGetVariable(5221)) 1e-9 "[$kad] Ayar-Kaydet '-53,1425' -> G54 X -53.143 (Sayi 3 basamak)"
        Yakin 208.9 ([Eding]::CncGetVariable(5223)) 1e-9 "[$kad] Ayar-Kaydet '208,9' -> G54 Z"
        Yakin 32.5 ([Eding]::CncGetVariable(4002)) 1e-9 "[$kad] Ayar-Kaydet '32,5' -> #4002"
        $script:G54Kutu['X'].Text = 'abc'; $onceX = [Eding]::CncGetVariable(5221); [Kayit]::Mesajlar.Clear()
        [void](Ayar-Kaydet)
        Esit $onceX ([Eding]::CncGetVariable(5221)) "[$kad] Ayar-Kaydet sayı olmayan değerde hiçbir şey yazmaz"
        Dogru (([Kayit]::Mesajlar -join ' ') -match 'sayı değil') "[$kad] Ayar-Kaydet uyarı gösterir"
    }
}

try { Remove-Item -LiteralPath $kok -Recurse -Force } catch { }
Ozet 'Ayarlar'
