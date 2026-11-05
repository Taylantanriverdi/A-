# ═══════════════════════════════════════════════════════════════════
#  DIGICAD Dental — SESSİZ YAZDIRMA
#  Sunucu tarafından çağrılır; ekrana hiçbir pencere açmadan seçili
#  yazıcıya iş formu basar. Ek program gerekmez (Windows'un kendi
#  System.Drawing yazdırma altyapısı kullanılır).
#    yazdir.ps1 -Liste                                  → yazıcı listesi (JSON)
#    yazdir.ps1 -Resim form.png -Yazici "Ad" -Kagit A5  → hazır form resmini bas
#                (Sipariş Takip Formu; sunucu Edge ile resme çevirir)
#    yazdir.ps1 -Veri is.json -Yazici "Ad" -Kagit A5    → yedek: formu kendisi çizer
# ═══════════════════════════════════════════════════════════════════
param([string]$Veri, [string]$Resim, [string]$Baslik = 'DIGICAD Sipariş Formu', [string]$Yazici, [int]$Kopya = 1, [string]$Kagit = 'A5', [switch]$Liste)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

if ($Liste) {
  $l = @(Get-CimInstance Win32_Printer | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ ad = [string]$_.Name; varsayilan = [bool]$_.Default; cevrimdisi = [bool]$_.WorkOffline }
  })
  Write-Output (ConvertTo-Json -InputObject $l -Compress)
  exit 0
}

Add-Type -AssemblyName System.Drawing
if ($Resim) { $script:resim = [System.Drawing.Image]::FromFile($Resim) }
else { $script:d = Get-Content -LiteralPath $Veri -Raw -Encoding UTF8 | ConvertFrom-Json }

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($Yazici) { $pd.PrinterSettings.PrinterName = $Yazici }
if (-not $pd.PrinterSettings.IsValid) { throw ('Yazıcı bulunamadı: ' + $Yazici) }
if ($Kopya -gt 1) { $pd.PrinterSettings.Copies = [int16]$Kopya }
$pd.DocumentName = $(if ($Resim) { $Baslik } else { 'DIGICAD İş Talebi - ' + $script:d.hasta })
# Durum penceresi ("Yazdırılıyor...") açılmasın
$pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
# Kağıt boyutu: A5 (148x210 mm) varsayılan, A4 isteğe bağlı. Ölçüler 1/100 inç.
$script:A5 = ($Kagit -ne 'A4')
$tur = $(if ($script:A5) { [System.Drawing.Printing.PaperKind]::A5 } else { [System.Drawing.Printing.PaperKind]::A4 })
$kagitBoyu = $pd.PrinterSettings.PaperSizes | Where-Object { $_.Kind -eq $tur } | Select-Object -First 1
if (-not $kagitBoyu) {
  # Yazıcı sürücüsü listede A5/A4 göstermiyorsa özel boyut tanımla
  $kagitBoyu = $(if ($script:A5) { New-Object System.Drawing.Printing.PaperSize('A5', 583, 827) } else { New-Object System.Drawing.Printing.PaperSize('A4', 827, 1169) })
}
$pd.DefaultPageSettings.PaperSize = $kagitBoyu
$pd.DefaultPageSettings.Landscape = $false
$pd.DefaultPageSettings.Margins = $(if ($Resim) { New-Object System.Drawing.Printing.Margins(12, 12, 12, 12) } elseif ($script:A5) { New-Object System.Drawing.Printing.Margins(32, 32, 28, 28) } else { New-Object System.Drawing.Printing.Margins(55, 55, 45, 45) })

if ($Resim) {
  # Hazır form resmini (A4 oranında) sayfaya orantılı sığdır — A5'te birebir küçültülmüş hâli çıkar
  $pd.add_PrintPage({
    param($gonderen, $e)
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $b = $e.MarginBounds
    $img = $script:resim
    $oran = [Math]::Min(($b.Width / $img.Width), ($b.Height / $img.Height))
    $gen = [single]($img.Width * $oran); $yuk = [single]($img.Height * $oran)
    $sol = [single]($b.Left + ($b.Width - $gen) / 2)
    $g.DrawImage($img, (New-Object System.Drawing.RectangleF($sol, [single]$b.Top, $gen, $yuk)))
    $e.HasMorePages = $false
  })
} else {
$pd.add_PrintPage({
  param($gonderen, $e)
  $d = $script:d
  $o = $(if ($script:A5) { [single]0.78 } else { [single]1 })   # A5 ölçeği
  $g = $e.Graphics
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $m = $e.MarginBounds
  $x = [single]$m.Left; $y = [single]$m.Top; $w = [single]$m.Width
  $siyah = [System.Drawing.Brushes]::Black
  $beyaz = [System.Drawing.Brushes]::White
  $gri = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(95, 95, 95))
  $kalin = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single](2 * $o))
  $ince = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 150, 150), [single]1)
  $fBaslik = New-Object System.Drawing.Font('Segoe UI', [single](17 * $o), [System.Drawing.FontStyle]::Bold)
  $fAlt = New-Object System.Drawing.Font('Segoe UI', [single](9 * $o))
  $fEtiket = New-Object System.Drawing.Font('Segoe UI', [single](10 * $o), [System.Drawing.FontStyle]::Bold)
  $fDeger = New-Object System.Drawing.Font('Segoe UI', [single](11 * $o))
  $fBuyuk = New-Object System.Drawing.Font('Segoe UI', [single](15 * $o), [System.Drawing.FontStyle]::Bold)
  $fDis = New-Object System.Drawing.Font('Segoe UI', [single](8 * $o), [System.Drawing.FontStyle]::Bold)
  $orta = New-Object System.Drawing.StringFormat
  $orta.Alignment = [System.Drawing.StringAlignment]::Center
  $orta.LineAlignment = [System.Drawing.StringAlignment]::Center

  # Başlık
  $g.DrawString('DIGICAD Dental Laboratuvarı', $fBaslik, $siyah, $x, $y)
  $g.DrawString([string]$d.baslik, $fAlt, $gri, $x, ($y + 32 * $o))
  $sag = New-Object System.Drawing.StringFormat; $sag.Alignment = [System.Drawing.StringAlignment]::Far
  $g.DrawString(([string]$d.tarih + "`n" + 'Talep No: ' + [string]$d.no), $fAlt, $gri, (New-Object System.Drawing.RectangleF($x, ($y + 4 * $o), $w, (40 * $o))), $sag)
  $y += 56 * $o
  $g.DrawLine($kalin, $x, $y, $x + $w, $y)
  $y += 12 * $o

  if ($d.test) {
    $g.DrawString('*** TEST SAYFASI — gerçek bir iş değildir ***', $fEtiket, $siyah, (New-Object System.Drawing.RectangleF($x, $y, $w, (20 * $o))), $orta)
    $y += 26 * $o
  }

  # Hasta ve hekim (büyük)
  $g.DrawString('HASTA', $fEtiket, $gri, $x, $y)
  $g.DrawString('HEKİM', $fEtiket, $gri, $x + $w / 2, $y)
  $y += 18 * $o
  $g.DrawString([string]$d.hasta, $fBuyuk, $siyah, (New-Object System.Drawing.RectangleF($x, $y, ($w / 2 - 10), (54 * $o))))
  $g.DrawString([string]$d.hekim, $fBuyuk, $siyah, (New-Object System.Drawing.RectangleF(($x + $w / 2), $y, ($w / 2), (54 * $o))))
  $y += 50 * $o

  # Bilgi satırları
  $etiketGen = [single](135 * $o)
  $satirlar = @(
    @('İş Türü', $d.isTuru), @('Diş Rengi', $d.renk), @('Çene', $d.cene),
    @('Teslim Tarihi', $d.teslim), @('Tasarım', $d.tasarim), @('İmplant', $d.implant)
  )
  foreach ($s in $satirlar) {
    $deger = [string]$s[1]
    if (-not $deger) { continue }
    $alan = New-Object System.Drawing.RectangleF(($x + $etiketGen), $y, ($w - $etiketGen), (200 * $o))
    $yuk = $g.MeasureString($deger, $fDeger, [int]($w - $etiketGen)).Height
    $g.DrawString($s[0], $fEtiket, $siyah, $x, ($y + 2))
    $g.DrawString($deger, $fDeger, $siyah, $alan)
    $y += [Math]::Max($yuk, (18 * $o)) + 7 * $o
    $g.DrawLine($ince, $x, ($y - 3 * $o), $x + $w, ($y - 3 * $o))
  }
  $y += 8 * $o

  # Diş şeması (FDI)
  $g.DrawString('DİŞLER', $fEtiket, $siyah, $x, $y)
  $secili = @{}
  foreach ($n in @($d.disler)) { if ($n) { $secili[[int]$n] = $true } }
  $g.DrawString(([string]$d.dislerMetin), $fDeger, $siyah, (New-Object System.Drawing.RectangleF(($x + $etiketGen), $y, ($w - $etiketGen), (40 * $o))))
  $y += 26 * $o
  $ust = @(18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28)
  $alt = @(48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38)
  $bosluk = [single](16 * $o)
  $kutu = [single](($w - $bosluk) / 16)
  $kutuY = [single](24 * $o)
  foreach ($sira in @($ust, $alt)) {
    for ($i = 0; $i -lt 16; $i++) {
      $kx = $x + $i * $kutu + $(if ($i -ge 8) { $bosluk } else { 0 })
      $r = New-Object System.Drawing.RectangleF($kx, $y, ($kutu - 3 * $o), $kutuY)
      $no = $sira[$i]
      if ($secili.ContainsKey($no)) {
        $g.FillRectangle($siyah, $r)
        $g.DrawString([string]$no, $fDis, $beyaz, $r, $orta)
      } else {
        $g.DrawRectangle($ince, $r.X, $r.Y, $r.Width, $r.Height)
        $g.DrawString([string]$no, $fDis, $gri, $r, $orta)
      }
    }
    $y += $kutuY + 4 * $o
  }
  $g.DrawLine($ince, ($x + $w / 2), ($y - 2 * $kutuY - 10 * $o), ($x + $w / 2), ($y - 4 * $o))
  $y += 12 * $o

  # Notlar
  if ([string]$d.notlar) {
    $g.DrawString('NOTLAR', $fEtiket, $siyah, $x, $y); $y += 18 * $o
    $yuk = [Math]::Min($g.MeasureString([string]$d.notlar, $fDeger, [int]($w - 12 * $o)).Height, (220 * $o))
    $kutuR = New-Object System.Drawing.RectangleF($x, $y, $w, ($yuk + 12 * $o))
    $g.DrawRectangle($ince, $kutuR.X, $kutuR.Y, $kutuR.Width, $kutuR.Height)
    $g.DrawString([string]$d.notlar, $fDeger, $siyah, (New-Object System.Drawing.RectangleF(($x + 6 * $o), ($y + 6 * $o), ($w - 12 * $o), $yuk)))
    $y += $yuk + 22 * $o
  }

  # Dosyalar ve bağlantılar
  $dosyalar = @($d.dosyalar)
  if ($dosyalar.Count -and $dosyalar[0]) {
    $g.DrawString(('DOSYALAR / BAĞLANTILAR (' + $dosyalar.Count + ')'), $fEtiket, $siyah, $x, $y); $y += 18 * $o
    foreach ($f in $dosyalar) {
      if ($y -gt ($m.Bottom - 40 * $o)) { $g.DrawString('…', $fDeger, $siyah, $x, $y); break }
      $metin = '• ' + [string]$f.ad + $(if ($f.baglanti) { "`n   " + [string]$f.baglanti } else { '' })
      $yuk = $g.MeasureString($metin, $fAlt, [int]$w).Height
      $g.DrawString($metin, $fAlt, $siyah, (New-Object System.Drawing.RectangleF($x, $y, $w, $yuk)))
      $y += $yuk + 3 * $o
    }
  }

  # Alt bilgi
  $g.DrawLine($ince, $x, ($m.Bottom - 14 * $o), $x + $w, ($m.Bottom - 14 * $o))
  $g.DrawString('Hekim Portalı üzerinden gönderildi · DIGICAD Dental otomatik yazdırma', $fAlt, $gri, $x, ($m.Bottom - 11 * $o))
  $e.HasMorePages = $false
})
}

try { $pd.Print() } finally { if ($script:resim) { $script:resim.Dispose() } }
Write-Output 'YAZDIRILDI'
