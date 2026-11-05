@echo off
rem ================================================================
rem  DIGICAD Dental - OTOMATIK KURULUM / GUNCELLEME
rem  Kullanim: yeni ZIP'i indirin, bu dosyaya cift tiklayin. Bu kadar.
rem  - Indirilenler klasorundeki en yeni digicad-yerel*.zip dosyasini bulur
rem  - Paketin eksiksiz oldugunu kontrol eder, programi yedekler,
rem    C:\digicad-yerel klasorune kopyalar (veri klasorune DOKUNMAZ),
rem    sunucuyu arka planda yeniden baslatir ve calistigini dogrular.
rem  - Sunucu acilmazsa eski surumu otomatik geri yukler.
rem ================================================================
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title DIGICAD - Kurulum ve Guncelleme
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $s=[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8); iex $s.Substring($s.LastIndexOf('#PS-BASLA#')+10)"
echo.
pause
exit /b
#PS-BASLA#
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$hedef = 'C:\digicad-yerel'
$burasi = Split-Path -Parent $f
$gecici = $null
$basladi = $false
try {
  if ((Test-Path (Join-Path $burasi 'paket-listesi.txt')) -and ($burasi.TrimEnd('\') -ne $hedef)) {
    # Bu dosya açılmış bir paketin içinden çalıştırıldı
    $kaynak = $burasi
    Write-Host ('Paket: ' + $kaynak)
  } else {
    # İndirilenler (ve Masaüstü) klasöründeki en yeni ZIP'i bul
    $yerler = @()
    try { $yerler += (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path } catch {}
    $yerler += (Join-Path $env:USERPROFILE 'Downloads')
    $yerler += [Environment]::GetFolderPath('Desktop')
    $zip = Get-ChildItem -Path ($yerler | Select-Object -Unique) -Filter 'digicad-yerel*.zip' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $zip) { throw 'İndirilenler klasöründe digicad-yerel ile başlayan bir ZIP bulunamadı. Önce yeni ZIP dosyasını indirin.' }
    Write-Host ''
    Write-Host ('Bulunan paket : ' + $zip.Name) -ForegroundColor Cyan
    Write-Host ('İndirilme     : ' + $zip.LastWriteTime.ToString('dd.MM.yyyy HH:mm')) -ForegroundColor Cyan
    $gecici = Join-Path $env:TEMP ('digicad-guncelleme-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $gecici -Force
    $ic = Get-ChildItem -Path $gecici -Recurse -Filter 'paket-listesi.txt' -File | Select-Object -First 1
    if (-not $ic) { throw 'Bu ZIP otomatik güncellemeyi desteklemiyor (paket-listesi.txt yok). En yeni ZIP dosyasını indirin.' }
    $kaynak = $ic.DirectoryName
  }
  $basladi = $true
  & (Join-Path $kaynak 'araclar\guncelle.ps1') -Kaynak $kaynak -Hedef $hedef
} catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  if ($basladi) { Write-Host 'Bu pencerenin ekran görüntüsünü gönderin.' -ForegroundColor Yellow }
  else { Write-Host 'Mevcut sisteminizde hiçbir değişiklik yapılmadı.' -ForegroundColor Yellow }
} finally {
  if ($gecici) { Remove-Item -LiteralPath $gecici -Recurse -Force -ErrorAction SilentlyContinue }
}
