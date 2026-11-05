# ═══════════════════════════════════════════════════════════════════
#  DIGICAD Dental — SESSİZ YAZDIRMA
#  Sunucu tarafından çağrılır; ekrana hiçbir pencere açmadan seçili
#  yazıcıya A4 "Hekim İş Talebi" formu basar. Ek program gerekmez
#  (Windows'un kendi System.Drawing yazdırma altyapısı kullanılır).
#    yazdir.ps1 -Liste                         → yazıcı listesi (JSON)
#    yazdir.ps1 -Veri is.json -Yazici "Ad"     → formu yazdır
# ═══════════════════════════════════════════════════════════════════
param([string]$Veri, [string]$Yazici, [int]$Kopya = 1, [switch]$Liste)
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
$script:d = Get-Content -LiteralPath $Veri -Raw -Encoding UTF8 | ConvertFrom-Json

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($Yazici) { $pd.PrinterSettings.PrinterName = $Yazici }
if (-not $pd.PrinterSettings.IsValid) { throw ('Yazıcı bulunamadı: ' + $Yazici) }
if ($Kopya -gt 1) { $pd.PrinterSettings.Copies = [int16]$Kopya }
$pd.DocumentName = 'DIGICAD İş Talebi - ' + $script:d.hasta
# Durum penceresi ("Yazdırılıyor...") açılmasın
$pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(55, 55, 45, 45)
try { $pd.DefaultPageSettings.PaperSize = ($pd.PrinterSettings.PaperSizes | Where-Object { $_.Kind -eq [System.Drawing.Printing.PaperKind]::A4 } | Select-Object -First 1) } catch {}

$pd.add_PrintPage({
  param($gonderen, $e)
  $d = $script:d
  $g = $e.Graphics
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $m = $e.MarginBounds
  $x = [single]$m.Left; $y = [single]$m.Top; $w = [single]$m.Width
  $siyah = [System.Drawing.Brushes]::Black
  $beyaz = [System.Drawing.Brushes]::White
  $gri = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(95, 95, 95))
  $kalin = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]2)
  $ince = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 150, 150), [single]1)
  $fBaslik = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
  $fAlt = New-Object System.Drawing.Font('Segoe UI', 9)
  $fEtiket = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $fDeger = New-Object System.Drawing.Font('Segoe UI', 11)
  $fBuyuk = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
  $fDis = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
  $orta = New-Object System.Drawing.StringFormat
  $orta.Alignment = [System.Drawing.StringAlignment]::Center
  $orta.LineAlignment = [System.Drawing.StringAlignment]::Center

  # Başlık
  $g.DrawString('DIGICAD Dental Laboratuvarı', $fBaslik, $siyah, $x, $y)
  $g.DrawString([string]$d.baslik, $fAlt, $gri, $x, $y + 32)
  $sag = New-Object System.Drawing.StringFormat; $sag.Alignment = [System.Drawing.StringAlignment]::Far
  $g.DrawString(([string]$d.tarih + "`n" + 'Talep No: ' + [string]$d.no), $fAlt, $gri, (New-Object System.Drawing.RectangleF($x, ($y + 4), $w, 40)), $sag)
  $y += 56
  $g.DrawLine($kalin, $x, $y, $x + $w, $y)
  $y += 12

  if ($d.test) {
    $g.DrawString('*** TEST SAYFASI — gerçek bir iş değildir ***', $fEtiket, $siyah, (New-Object System.Drawing.RectangleF($x, $y, $w, 20)), $orta)
    $y += 26
  }

  # Hasta ve hekim (büyük)
  $g.DrawString('HASTA', $fEtiket, $gri, $x, $y)
  $g.DrawString('HEKİM', $fEtiket, $gri, $x + $w / 2, $y)
  $y += 18
  $g.DrawString([string]$d.hasta, $fBuyuk, $siyah, (New-Object System.Drawing.RectangleF($x, $y, ($w / 2 - 10), 54)))
  $g.DrawString([string]$d.hekim, $fBuyuk, $siyah, (New-Object System.Drawing.RectangleF(($x + $w / 2), $y, ($w / 2), 54)))
  $y += 50

  # Bilgi satırları
  $etiketGen = [single]135
  $satirlar = @(
    @('İş Türü', $d.isTuru), @('Diş Rengi', $d.renk), @('Çene', $d.cene),
    @('Teslim Tarihi', $d.teslim), @('Tasarım', $d.tasarim), @('İmplant', $d.implant)
  )
  foreach ($s in $satirlar) {
    $deger = [string]$s[1]
    if (-not $deger) { continue }
    $alan = New-Object System.Drawing.RectangleF(($x + $etiketGen), $y, ($w - $etiketGen), 200)
    $yuk = $g.MeasureString($deger, $fDeger, [int]($w - $etiketGen)).Height
    $g.DrawString($s[0], $fEtiket, $siyah, $x, ($y + 2))
    $g.DrawString($deger, $fDeger, $siyah, $alan)
    $y += [Math]::Max($yuk, 18) + 7
    $g.DrawLine($ince, $x, ($y - 3), $x + $w, ($y - 3))
  }
  $y += 8

  # Diş şeması (FDI)
  $g.DrawString('DİŞLER', $fEtiket, $siyah, $x, $y)
  $secili = @{}
  foreach ($n in @($d.disler)) { if ($n) { $secili[[int]$n] = $true } }
  $g.DrawString(([string]$d.dislerMetin), $fDeger, $siyah, (New-Object System.Drawing.RectangleF(($x + $etiketGen), $y, ($w - $etiketGen), 40)))
  $y += 26
  $ust = @(18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28)
  $alt = @(48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38)
  $kutu = [single](($w - 16) / 16)
  foreach ($sira in @($ust, $alt)) {
    for ($i = 0; $i -lt 16; $i++) {
      $kx = $x + $i * $kutu + $(if ($i -ge 8) { 16 } else { 0 })
      $r = New-Object System.Drawing.RectangleF($kx, $y, ($kutu - 3), 24)
      $no = $sira[$i]
      if ($secili.ContainsKey($no)) {
        $g.FillRectangle($siyah, $r)
        $g.DrawString([string]$no, $fDis, $beyaz, $r, $orta)
      } else {
        $g.DrawRectangle($ince, $r.X, $r.Y, $r.Width, $r.Height)
        $g.DrawString([string]$no, $fDis, $gri, $r, $orta)
      }
    }
    $y += 28
  }
  $g.DrawLine($ince, ($x + $w / 2), ($y - 58), ($x + $w / 2), ($y - 4))
  $y += 12

  # Notlar
  if ([string]$d.notlar) {
    $g.DrawString('NOTLAR', $fEtiket, $siyah, $x, $y); $y += 18
    $yuk = [Math]::Min($g.MeasureString([string]$d.notlar, $fDeger, [int]$w).Height, 220)
    $kutuR = New-Object System.Drawing.RectangleF($x, $y, $w, ($yuk + 12))
    $g.DrawRectangle($ince, $kutuR.X, $kutuR.Y, $kutuR.Width, $kutuR.Height)
    $g.DrawString([string]$d.notlar, $fDeger, $siyah, (New-Object System.Drawing.RectangleF(($x + 6), ($y + 6), ($w - 12), $yuk)))
    $y += $yuk + 22
  }

  # Dosyalar ve bağlantılar
  $dosyalar = @($d.dosyalar)
  if ($dosyalar.Count -and $dosyalar[0]) {
    $g.DrawString(('DOSYALAR / BAĞLANTILAR (' + $dosyalar.Count + ')'), $fEtiket, $siyah, $x, $y); $y += 18
    foreach ($f in $dosyalar) {
      if ($y -gt ($m.Bottom - 40)) { $g.DrawString('…', $fDeger, $siyah, $x, $y); break }
      $metin = '• ' + [string]$f.ad + $(if ($f.baglanti) { "`n   " + [string]$f.baglanti } else { '' })
      $yuk = $g.MeasureString($metin, $fAlt, [int]$w).Height
      $g.DrawString($metin, $fAlt, $siyah, (New-Object System.Drawing.RectangleF($x, $y, $w, $yuk)))
      $y += $yuk + 3
    }
  }

  # Alt bilgi
  $g.DrawLine($ince, $x, ($m.Bottom - 14), $x + $w, ($m.Bottom - 14))
  $g.DrawString('Hekim Portalı üzerinden gönderildi · DIGICAD Dental yerel sistem tarafından otomatik yazdırıldı', $fAlt, $gri, $x, ($m.Bottom - 10))
  $e.HasMorePages = $false
})

$pd.Print()
Write-Output 'YAZDIRILDI'
