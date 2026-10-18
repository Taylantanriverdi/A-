# ROBOT KOL - otomatik kurulum betigi (ROBOT_KOL_KURULUM_V<n>.bat icine gomulur)
# Her guncellemede bir artirilir; bat dosyasinin adi da buna gore olusur (V1, V2, V3 ...).
$SURUM = 'V4'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Baslik($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Bilgi($t)  { Write-Host "  $t" }
function Uyari($t)  { Write-Host "  UYARI: $t" -ForegroundColor Yellow }
function Tamam($t)  { Write-Host "  OK: $t" -ForegroundColor Green }

function Arduino {
    & $script:cli --config-file $script:cfg @args
    if ($LASTEXITCODE -ne 0) { throw "arduino-cli hata verdi: $($args -join ' ')" }
}

$utf8 = New-Object Text.UTF8Encoding $false
$FQBN = 'esp32:esp32:esp32:PartitionScheme=huge_app'
$ESP32_SURUM = '2.0.17'

Write-Host '##############################################' -ForegroundColor Cyan
Write-Host "   ROBOT KOL - Otomatik Kurulum  (surum $SURUM)" -ForegroundColor Cyan
Write-Host '##############################################' -ForegroundColor Cyan

# ---------------------------------------------------------------------------
Baslik '1/7 Masaustunde ROBOT KOL klasoru hazirlaniyor'
$masaustu = [Environment]::GetFolderPath('Desktop')
$ana = Join-Path $masaustu 'ROBOT KOL'
New-Item -ItemType Directory -Force -Path $ana | Out-Null
Tamam $ana

# Arduino araclari (Go tabanli) bosluk, Turkce karakter ve kisayol (junction) iceren
# yollarda hata verebildigi icin araclar gercek bir klasorde (C:\RobotKol) tutulur.
# ROBOT KOL\araclar bu klasore acilan bir kisayoldur; icerigi masaustunden gorulebilir.
function Kisayol-mi($yol) {
    (Test-Path $yol) -and ((Get-Item $yol -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}
$arac = 'C:\RobotKol'
# Surum 1.0 C:\RobotKol'u masaustune kisayol olarak acmisti: once onu kaldir (sadece kisayol silinir).
if (Kisayol-mi $arac) { [IO.Directory]::Delete($arac, $false) }
try { New-Item -ItemType Directory -Force -Path $arac | Out-Null }
catch { $arac = 'C:\Users\Public\RobotKol'; New-Item -ItemType Directory -Force -Path $arac | Out-Null }
foreach ($eski in 'araclar', 'kutuphaneler') {   # surum 1.0'dan kalan yarim kurulum klasorleri
    $y = Join-Path $ana $eski
    if ((Test-Path $y) -and -not (Kisayol-mi $y)) { Remove-Item $y -Recurse -Force }
}
$link = Join-Path $ana 'araclar'
if (-not (Test-Path $link)) {
    try { New-Item -ItemType Junction -Path $link -Target $arac | Out-Null } catch { Uyari "Kisayol acilamadi: $link" }
}
Bilgi "Arduino araclari: $arac  (masaustunde: ROBOT KOL\araclar)"

$cliDir  = Join-Path $arac 'arduino-cli'
$script:cli = Join-Path $cliDir 'arduino-cli.exe'
$script:cfg = Join-Path $arac 'arduino-cli.yaml'
$kutuph  = Join-Path $arac 'kutuphaneler'
$libDir  = Join-Path $kutuph 'libraries'
$sketch  = Join-Path $arac 'proje\RobotKol_PS4'
$build   = Join-Path $arac 'derleme'
$ayar    = Join-Path $ana 'ayarlar.txt'
New-Item -ItemType Directory -Force -Path $cliDir, $libDir, $sketch | Out-Null

# ---------------------------------------------------------------------------
Baslik '2/7 PS4 kolu MAC adresi'
$mac = $null
if (Test-Path $ayar) {
    $satir = Get-Content $ayar | Where-Object { $_ -match '^PS4_MAC=' } | Select-Object -First 1
    if ($satir) { $mac = ($satir -split '=', 2)[1].Trim() }
}
if (-not $mac) {
    Bilgi 'SixaxisPairTool ile PS4 koluna yazdiginiz MAC adresini girin.'
    Bilgi '(Bos birakip Enter''a basarsaniz varsayilan kullanilir: a0:b1:c2:d3:e4:f5)'
    $g = (Read-Host '  MAC').Trim()
    if ($g -match '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$') { $mac = $g.Replace('-', ':').ToLower() }
    else { if ($g) { Uyari 'Gecersiz bicim, varsayilan kullaniliyor.' }; $mac = 'a0:b1:c2:d3:e4:f5' }
    [IO.File]::WriteAllText($ayar, "PS4_MAC=$mac`r`n", $utf8)
}
Tamam "MAC = $mac  (degistirmek icin: $ayar)"

# ---------------------------------------------------------------------------
Baslik '3/7 Proje dosyalari yaziliyor / guncelleniyor'
$bat = [IO.File]::ReadAllText($env:ROBOTKOL_BAT, [Text.Encoding]::UTF8)
$veri = $bat.Substring($bat.IndexOf('#' + '#PS_BITIS'))
$re = [regex]'(?ms)^##DOSYA (.+?)\r?\n(.*?)\r?\n##DOSYA_SON'
$damga = Get-Date -Format 'yyyyMMdd_HHmmss'
foreach ($m in $re.Matches($veri)) {
    $rel = $m.Groups[1].Value.Trim()
    $hedef = Join-Path $ana $rel
    $icerik = ($m.Groups[2].Value -replace "`r?`n", "`r`n") + "`r`n"
    if ($rel -like '*.ino') {
        $icerik = $icerik -replace 'const char\* PS4_MAC = "[^"]*";', "const char* PS4_MAC = `"$mac`";"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $hedef) | Out-Null
    if (Test-Path $hedef) {
        $eski = [IO.File]::ReadAllText($hedef, [Text.Encoding]::UTF8)
        if ($eski -eq $icerik) { Bilgi "degisiklik yok: $rel"; continue }
        $yedek = Join-Path (Join-Path (Join-Path $ana 'yedekler') $damga) $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $yedek) | Out-Null
        Copy-Item $hedef $yedek -Force
        Bilgi "eski surum yedeklendi: yedekler\$damga\$rel"
    }
    [IO.File]::WriteAllText($hedef, $icerik, $utf8)
    Tamam "yazildi: $rel"
}
# Klasorde sadece guncel surumun bat dosyasi durur, eskiler yedekler\eski_surumler'e tasinir
$batKopya = Join-Path $ana "ROBOT_KOL_KURULUM_$SURUM.bat"
$eskiDir = Join-Path $ana 'yedekler\eski_surumler'
foreach ($b in Get-ChildItem $ana -Filter 'ROBOT_KOL_KURULUM*.bat') {
    if ($b.FullName -eq $batKopya -or $b.FullName -eq (Resolve-Path $env:ROBOTKOL_BAT).Path) { continue }
    New-Item -ItemType Directory -Force -Path $eskiDir | Out-Null
    Move-Item $b.FullName (Join-Path $eskiDir $b.Name) -Force
    Bilgi "eski surum tasindi: yedekler\eski_surumler\$($b.Name)"
}
if ((Resolve-Path $env:ROBOTKOL_BAT).Path -ne $batKopya) { Copy-Item $env:ROBOTKOL_BAT $batKopya -Force }
[IO.File]::WriteAllText((Join-Path $ana 'SURUM.txt'), "Kurulum surumu: $SURUM`r`nSon calisma: $(Get-Date)`r`n", $utf8)

# ---------------------------------------------------------------------------
Baslik '4/7 Arduino CLI hazirlaniyor'
if (-not (Test-Path $script:cli)) {
    $zip = Join-Path $arac 'arduino-cli.zip'
    Bilgi 'Arduino CLI indiriliyor...'
    Invoke-WebRequest 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $cliDir -Force
    Remove-Item $zip
}
$yaml = @"
board_manager:
  additional_urls:
    - https://espressif.github.io/arduino-esp32/package_esp32_index.json
directories:
  data: '$(Join-Path $arac 'arduino15')'
  downloads: '$(Join-Path $arac 'indirilenler')'
  user: '$kutuph'
library:
  enable_unsafe_install: true
"@
[IO.File]::WriteAllText($script:cfg, $yaml, $utf8)
Tamam 'Arduino CLI hazir'

# ---------------------------------------------------------------------------
Baslik "5/7 ESP32 kart paketi ($ESP32_SURUM) ve kutuphaneler (ilk seferde uzun surer)"
# Paket ve kutuphane listelerini guncelle. Bir liste guncellenemese bile (or. "Some indexes
# could not be updated") ESP32 listesi diskte varsa kuruluma devam edilir.
& $script:cli --config-file $script:cfg update
if ($LASTEXITCODE -ne 0) {
    $espIndex = Join-Path $arac 'arduino15\package_esp32_index.json'
    if (-not (Test-Path $espIndex)) { throw 'ESP32 paket listesi indirilemedi. Internet baglantisini kontrol edin.' }
    Uyari 'Bazi listeler guncellenemedi, diskteki listelerle devam ediliyor.'
}
$kurulu = & $script:cli --config-file $script:cfg core list | Out-String
if ($kurulu -notmatch "esp32:esp32\s+$([regex]::Escape($ESP32_SURUM))") {
    Bilgi 'ESP32 paketi indiriliyor (~600 MB)...'
    Arduino core install "esp32:esp32@$ESP32_SURUM"
}
Tamam 'ESP32 kart paketi'
Arduino lib install 'Adafruit PWM Servo Driver Library'
$ps4Dir = Join-Path $libDir 'PS4Controller'
if (-not (Test-Path (Join-Path $ps4Dir 'library.properties'))) {
    Bilgi 'PS4Controller kutuphanesi indiriliyor...'
    $zip = Join-Path $arac 'ps4.zip'
    $gecici = Join-Path $arac 'ps4_gecici'
    Invoke-WebRequest 'https://github.com/aed3/PS4-esp32/archive/refs/heads/master.zip' -OutFile $zip -UseBasicParsing
    if (Test-Path $gecici) { Remove-Item $gecici -Recurse -Force }
    Expand-Archive $zip -DestinationPath $gecici -Force
    if (Test-Path $ps4Dir) { Remove-Item $ps4Dir -Recurse -Force }
    Move-Item (Get-ChildItem $gecici -Directory | Select-Object -First 1).FullName $ps4Dir
    Remove-Item $zip, $gecici -Recurse -Force
}
Tamam 'Kutuphaneler: Adafruit PWM Servo Driver, PS4Controller'

# ---------------------------------------------------------------------------
Baslik '6/7 Kod derleniyor'
Copy-Item (Join-Path $ana 'RobotKol_PS4\RobotKol_PS4.ino') $sketch -Force   # derleme kopyasi
Arduino compile --fqbn $FQBN --build-path $build $sketch
Tamam 'Derleme basarili'

# ---------------------------------------------------------------------------
Baslik '7/7 ESP32''ye yukleniyor'
function Port-Bul {
    $liste = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\((COM\d+)\)' } |
        ForEach-Object { [pscustomobject]@{ Port = ([regex]::Match($_.Name, 'COM\d+')).Value; Ad = $_.Name } })
    $esp = @($liste | Where-Object { $_.Ad -match 'CP210|CH340|CH341|CH910|CH343|USB-SERIAL|USB Serial|UART|FTDI|USB JTAG' })
    if ($esp.Count -eq 1) { return $esp[0].Port }
    if ($liste.Count -eq 1) { return $liste[0].Port }
    if ($liste.Count -gt 1) {
        for ($i = 0; $i -lt $liste.Count; $i++) { Bilgi "[$($i + 1)] $($liste[$i].Ad)" }
        $s = Read-Host '  ESP32 hangi numarada'
        if ($s -match '^\d+$' -and [int]$s -ge 1 -and [int]$s -le $liste.Count) { return $liste[[int]$s - 1].Port }
    }
    return $null
}

$port = $null
while (-not $port) {
    $port = Port-Bul
    if ($port) { break }
    Uyari 'ESP32 bulunamadi. USB kablosunu takin (sadece sarj kablosu olmamali).'
    Bilgi 'Surucu gerekebilir: CP210x -> https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers'
    Bilgi '                    CH340  -> https://www.wch-ic.com/downloads/CH341SER_EXE.html'
    $c = Read-Host '  Taktiktan sonra Enter''a basin (yuklemeyi atlamak icin H yazin)'
    if ($c -match '^[Hh]') { break }
}

if ($port) {
    Bilgi "Port: $port"
    $basarili = $false
    for ($deneme = 1; $deneme -le 2 -and -not $basarili; $deneme++) {
        & $script:cli --config-file $script:cfg upload -p $port --fqbn $FQBN --input-dir $build $sketch
        if ($LASTEXITCODE -eq 0) { $basarili = $true }
        elseif ($deneme -eq 1) {
            Uyari 'Yukleme basarisiz. ESP32 uzerindeki BOOT tusuna basili tutun,'
            Read-Host '  sonra Enter''a basin ("Connecting..." yazisi gecince birakin)' | Out-Null
        }
    }
    if ($basarili) {
        Tamam 'Kod ESP32''ye yuklendi! PS4 kolunun PS tusuna basin.'
        $c = Read-Host '  Seri monitor acilsin mi? (E/H)'
        if ($c -match '^[Ee]') {
            Bilgi 'Kapatmak icin Ctrl+C'
            & $script:cli --config-file $script:cfg monitor -p $port -c baudrate=115200
        }
    } else { Uyari 'Yukleme yapilamadi. Derlenmis kod hazir, bu dosyaya tekrar cift tiklayarak deneyebilirsiniz.' }
} else {
    Uyari 'Yukleme atlandi. ESP32''yi takip bu dosyayi tekrar calistirin.'
}

Write-Host ''
Write-Host "Tum dosyalar: $ana" -ForegroundColor Green
Start-Process explorer.exe $ana
