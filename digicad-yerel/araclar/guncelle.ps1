# ═══════════════════════════════════════════════════════════════════
#  DIGICAD Dental — OTOMATİK KURULUM / GÜNCELLEME
#  DIGICAD-Guncelle.bat tarafından, yeni paketin içinden çalıştırılır.
#  1) Paketin eksiksiz ve bozulmamış olduğunu doğrular (paket-listesi.txt)
#  2) Mevcut programı yedekler (veri klasörüne DOKUNMAZ)
#  3) Sunucuyu durdurur, yeni dosyaları kopyalar
#  4) Sunucuyu arka planda başlatır ve çalıştığını kontrol eder
#  5) Sunucu açılmazsa ESKİ SÜRÜMÜ OTOMATİK GERİ YÜKLER
# ═══════════════════════════════════════════════════════════════════
param(
  [Parameter(Mandatory = $true)][string]$Kaynak,
  [string]$Hedef = 'C:\digicad-yerel'
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Yaz($m, $renk = 'Gray') { Write-Host $m -ForegroundColor $renk }
function Adim($m) { Write-Host ''; Write-Host ('>> ' + $m) -ForegroundColor Cyan }

$GorevAdi = 'DIGICAD Sunucu'
$Kaynak = (Resolve-Path $Kaynak).Path.TrimEnd('\')

function Sunucu-Surecleri {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*sunucu.js*' }
}
function Sunucuyu-Durdur {
  if (Get-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $GorevAdi -ErrorAction SilentlyContinue }
  # Baslat.bat ile açılmış pencereler (kendini yeniden başlatan döngü) de kapatılır
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -like '*Baslat.bat*' -or $_.CommandLine -like '*arka-plan.bat*' } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
  Start-Sleep -Seconds 1
  Sunucu-Surecleri | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
  for ($i = 0; $i -lt 10 -and (Sunucu-Surecleri); $i++) { Start-Sleep -Milliseconds 500 }
}
function Port-Oku {
  try { $a = Get-Content (Join-Path $Hedef 'veri\ayarlar.json') -Raw | ConvertFrom-Json; if ($a.icPort) { return [int]$a.icPort } } catch {}
  return 8080
}
function Saglik-Kontrolu([int]$saniye = 40) {
  $port = Port-Oku
  for ($i = 0; $i -lt $saniye; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/ben" -Headers @{ 'X-DL-Panel' = 'yonetici' } -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200 -and $r.Content -like '*kullanici*') { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}
function Kopyala($kaynakKlasor, $hedefKlasor, [string[]]$haric) {
  $arg = @($kaynakKlasor, $hedefKlasor, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($haric) { $arg += '/XD'; $arg += $haric }
  & robocopy @arg | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Dosyalar kopyalanamadı (robocopy kodu $LASTEXITCODE)" }
}
function Servis-Kur {
  try { & (Join-Path $Hedef 'araclar\servis.ps1') -Islem kur | Out-Null; return $true }
  catch { Yaz ('  Arka plan kurulumu hatası: ' + $_.Exception.Message) 'Red'; return $false }
}
function Log-Goster {
  $log = Join-Path $Hedef 'veri\sunucu.log'
  if (Test-Path $log) { Yaz '--- sunucu.log (son satırlar) ---' 'Yellow'; Get-Content $log -Tail 25 -Encoding UTF8 | ForEach-Object { Yaz $_ 'DarkGray' } }
}

Write-Host ''
Write-Host '══════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  DIGICAD Dental — Otomatik Kurulum / Güncelleme' -ForegroundColor Cyan
Write-Host '══════════════════════════════════════════════════════' -ForegroundColor Cyan
$yeniSurum = (Get-Content (Join-Path $Kaynak 'SURUM.txt') -Raw -ErrorAction SilentlyContinue)
$eskiSurum = (Get-Content (Join-Path $Hedef 'SURUM.txt') -Raw -ErrorAction SilentlyContinue)
Yaz ('  Kurulu sürüm : ' + ($(if ($eskiSurum) { $eskiSurum.Trim() } else { '(bilinmiyor)' })))
Yaz ('  Yeni sürüm   : ' + ($(if ($yeniSurum) { $yeniSurum.Trim() } else { '(bilinmiyor)' })))
Yaz ('  Kurulum yeri : ' + $Hedef)

# ── 1) Paket kontrolü ───────────────────────────────────────────────
Adim 'Paket kontrol ediliyor (eksik ya da bozuk dosya var mı)…'
$liste = Join-Path $Kaynak 'paket-listesi.txt'
if (-not (Test-Path $liste)) { throw 'Paket listesi yok — bu ZIP eksik ya da eski. Yeni ZIP indirin.' }
$satirlar = Get-Content $liste -Encoding UTF8 | Where-Object { $_ -match '^[0-9a-f]{64}  ' }
$hatalar = @()
foreach ($s in $satirlar) {
  $ozet = $s.Substring(0, 64); $goreli = $s.Substring(66)
  $yol = Join-Path $Kaynak $goreli
  if (-not (Test-Path -LiteralPath $yol)) { $hatalar += "EKSİK: $goreli"; continue }
  if ((Get-FileHash -LiteralPath $yol -Algorithm SHA256).Hash.ToLower() -ne $ozet) { $hatalar += "BOZUK: $goreli" }
}
if ($hatalar.Count) { $hatalar | ForEach-Object { Yaz "  $_" 'Red' }; throw 'Paket eksik ya da bozuk. Hiçbir şey değiştirilmedi. ZIP dosyasını yeniden indirin.' }
Yaz ("  " + $satirlar.Count + ' dosya eksiksiz ve sağlam.') 'Green'

# ── 2) Node.js ──────────────────────────────────────────────────────
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Start-Process 'https://nodejs.org'
  throw 'Node.js kurulu değil. Açılan sayfadan LTS sürümünü kurup bu dosyayı tekrar çalıştırın.'
}

# ── 3) Mevcut programın yedeği ──────────────────────────────────────
$programYedegi = $null
if (Test-Path (Join-Path $Hedef 'sunucu.js')) {
  Adim 'Mevcut program yedekleniyor (veriler dahil değil, onlara dokunulmaz)…'
  $kok = Join-Path $Hedef 'veri\program-yedekleri'
  $programYedegi = Join-Path $kok (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')
  New-Item -ItemType Directory -Force -Path $programYedegi | Out-Null
  Kopyala $Hedef $programYedegi @((Join-Path $Hedef 'veri'))
  Get-ChildItem $kok -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Yaz "  Yedek: $programYedegi" 'Green'
}

# ── 4-5) Durdur, kopyala, başlat — herhangi bir hata olursa eski sürüme dön ──
$basarili = $false
try {
  Adim 'Sunucu durduruluyor…'
  Sunucuyu-Durdur
  Yaz '  Durduruldu.' 'Green'

  Adim 'Yeni dosyalar kopyalanıyor…'
  New-Item -ItemType Directory -Force -Path $Hedef | Out-Null
  Kopyala $Kaynak $Hedef @((Join-Path $Kaynak 'veri'))
  Yaz '  Kopyalandı.' 'Green'

  # İlk kurulum: PIN yoksa sor
  $ayar = Join-Path $Hedef 'veri\ayarlar.json'
  if (-not (Test-Path $ayar) -or -not ((Get-Content $ayar -Raw) -match '"pin"\s*:\s*\{')) {
    Adim 'İlk kurulum: yönetim paneli PIN''i belirleyin'
    Push-Location $Hedef; & $node sunucu.js --pin-degistir; Pop-Location
  }

  Adim 'Sunucu arka planda başlatılıyor ve kontrol ediliyor…'
  $basarili = (Servis-Kur) -and (Saglik-Kontrolu 40)
} catch {
  Yaz ('  HATA: ' + $_.Exception.Message) 'Red'
  $basarili = $false
}

if ($basarili) {
  Write-Host ''
  Write-Host '══════════════════════════════════════════════════════' -ForegroundColor Green
  Write-Host '  ✓ GÜNCELLEME TAMAMLANDI — sistem çalışıyor' -ForegroundColor Green
  Write-Host ('    http://localhost:' + (Port-Oku)) -ForegroundColor Green
  Write-Host '══════════════════════════════════════════════════════' -ForegroundColor Green
  # Masaüstündeki güncelleme dosyasını da yenile
  try {
    $masaustu = [Environment]::GetFolderPath('Desktop')
    Copy-Item (Join-Path $Hedef 'DIGICAD-Guncelle.bat') (Join-Path $masaustu 'DIGICAD-Guncelle.bat') -Force
  } catch {}
  exit 0
}

# ── 6) Başarısız → eski sürümü geri yükle ───────────────────────────
Write-Host ''
Yaz '  ✗ Yeni sürüm başlatılamadı.' 'Red'
Log-Goster
if ($programYedegi) {
  Adim 'Eski sürüm geri yükleniyor…'
  try {
    Sunucuyu-Durdur
    Kopyala $programYedegi $Hedef $null
    if ((Servis-Kur) -and (Saglik-Kontrolu 40)) {
      Yaz '  Eski sürüm geri yüklendi ve çalışıyor. Verilerinizde değişiklik yok.' 'Yellow'
      Yaz '  Lütfen bu pencerenin ekran görüntüsünü gönderin.' 'Yellow'
    } else {
      Yaz '  Eski sürüm de başlatılamadı! Lütfen bu pencerenin ekran görüntüsünü gönderin.' 'Red'
      Log-Goster
    }
  } catch { Yaz ('  Geri yükleme hatası: ' + $_.Exception.Message) 'Red' }
}
exit 1
