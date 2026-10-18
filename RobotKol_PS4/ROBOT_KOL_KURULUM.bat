@echo off
setlocal
chcp 65001 >nul
title ROBOT KOL - Otomatik Kurulum
set "ROBOTKOL_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:ROBOTKOL_BAT,[Text.Encoding]::UTF8); $a=$s.IndexOf('#'+'#PS_BASLA'); $b=$s.IndexOf('#'+'#PS_BITIS'); try { Invoke-Expression $s.Substring($a,$b-$a) } catch { Write-Host ''; Write-Host ('HATA: '+$_) -ForegroundColor Red; Write-Host 'Bu ekranin goruntusunu gonderin veya dosyaya tekrar cift tiklayin.' -ForegroundColor Yellow }"
echo.
pause
exit /b
##PS_BASLA
# ROBOT KOL - otomatik kurulum betigi (ROBOT_KOL_KURULUM.bat icine gomulur)
$SURUM = '1.2'
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
$batKopya = Join-Path $ana 'ROBOT_KOL_KURULUM.bat'
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
Arduino core update-index
$kurulu = & $script:cli --config-file $script:cfg core list 2>$null | Out-String
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
##PS_BITIS
##DOSYA RobotKol_PS4/RobotKol_PS4.ino
/*
 * 6 Eksenli Robot Kol - ESP32 + PCA9685 + PS4 (DualShock 4) Bluetooth kontrolü
 *
 * Kütüphaneler (Arduino IDE > Kütüphane Yöneticisi / GitHub):
 *   - PS4Controller          (aed3/PS4-esp32)
 *   - Adafruit PWM Servo Driver Library (Adafruit_PWMServoDriver)
 * Kart: ESP32 Dev Module. Not: PS4Controller, ESP32 Arduino Core 2.0.x ile
 * sorunsuz çalışır (3.x sürümlerinde derleme hatası verebilir -> 2.0.17 önerilir).
 *
 * KONTROL HARİTASI
 *   Sol çubuk  X  -> Eksen 1: Taban dönüşü
 *   Sol çubuk  Y  -> Eksen 2: Omuz
 *   Sağ çubuk  Y  -> Eksen 3: Dirsek
 *   Sağ çubuk  X  -> Eksen 5: Bilek dönüşü (roll)
 *   Yön ↑ / ↓     -> Eksen 4: Bilek eğimi (pitch)
 *   R2 / L2       -> Eksen 6: Kıskaç kapat / aç (basınç kadar hızlı)
 *   Yön ← / →     -> Hız kademesi düşür / artır (%25 - %50 - %100, LED rengi değişir)
 *   OPTIONS       -> Tüm eksenleri yavaşça başlangıç (home) pozisyonuna getir
 *
 * YUMUŞAKLIK (SMOOTH) NASIL SAĞLANIYOR?
 *   1) Ölü bölge (deadzone): çubuk merkezdeki küçük titreşimler yok sayılır.
 *   2) Expo eğrisi: çubuğun az itilmesi çok yavaş, tam itilmesi hızlı hareket verir.
 *   3) Hız kontrolü: çubuk açıyı değil HIZI belirler; hedef açı her döngüde
 *      hız * dt kadar ilerler (çubuk bırakılınca kol olduğu yerde kalır).
 *   4) Alçak geçiren filtre: servoya giden açı hedefe üstel olarak yaklaşır,
 *      ayrıca döngü başına maksimum adım sınırlanır (ani sıçrama olmaz).
 *   5) Mikrosaniye çözünürlüklü PWM: writeMicroseconds ile ince adımlar.
 */

#include <Arduino.h>
#include <Wire.h>
#include <PS4Controller.h>
#include <Adafruit_PWMServoDriver.h>

// ---- PS4 kolunun eşleştirildiği MAC adresi (SixaxisPairTool ile yazılan) ----
const char* PS4_MAC = "a0:b1:c2:d3:e4:f5";

// ---- Donanım ----
#define I2C_SDA      21
#define I2C_SCL      22
#define PCA_ADDR     0x40
#define SERVO_FREQ   50          // Analog servolar için 50 Hz

Adafruit_PWMServoDriver pwm(PCA_ADDR);

// ---- Kontrol ayarları ----
const uint32_t LOOP_MS     = 20;     // 50 Hz kontrol döngüsü
const int      STICK_DEAD  = 12;     // çubuk ölü bölgesi (0..127)
const int      TRIG_DEAD   = 10;     // tetik ölü bölgesi (0..255)
const float    EXPO        = 0.6f;   // 0 = doğrusal, 1 = tam kübik
const float    SMOOTHING   = 0.18f;  // filtre katsayısı (küçük = daha yumuşak)
const float    SPEED_LEVELS[] = {0.25f, 0.5f, 1.0f};

struct Joint {
  const char* name;
  uint8_t  channel;    // PCA9685 kanalı
  float    minDeg;     // mekanik alt sınır
  float    maxDeg;     // mekanik üst sınır
  float    homeDeg;    // başlangıç pozisyonu
  float    maxSpeed;   // tam çubukta derece/saniye
  int8_t   dir;        // yön ters ise -1 yapın
  uint16_t usMin;      // 0° için darbe genişliği (µs)
  uint16_t usMax;      // 180° için darbe genişliği (µs)
  float    target;     // hedef açı
  float    current;    // servoya yazılan (filtrelenmiş) açı
};

// Sınırları kendi kolunuzun mekaniğine göre ayarlayın!
Joint joints[6] = {
  // isim          kn  min   max  home  hız  yön  usMin usMax
  {"Taban",        0,   0, 180,   90,  90,  +1,  500, 2500},
  {"Omuz",         1,  15, 165,   90,  60,  +1,  500, 2500},
  {"Dirsek",       2,  10, 170,   90,  70,  +1,  500, 2500},
  {"Bilek Egim",   3,   0, 180,   90,  90,  +1,  500, 2500},
  {"Bilek Donus",  4,   0, 180,   90, 120,  +1,  500, 2500},
  {"Kiskac",       5,  30, 120,   60, 150,  +1,  500, 2500},
};
enum { BASE = 0, SHOULDER, ELBOW, WRIST_PITCH, WRIST_ROLL, GRIPPER };

uint8_t  speedLevel = 1;
bool     homing     = false;
bool     prevLeft = false, prevRight = false;
uint32_t lastLoop = 0, lastPrint = 0;

// -------------------------------------------------------------------------
// Çubuk değerini (-128..127) ölü bölge + expo uygulanmış -1..1 aralığına çevirir
float stickToNorm(int v) {
  int a = abs(v);
  if (a < STICK_DEAD) return 0.0f;
  float n = (float)(a - STICK_DEAD) / (127 - STICK_DEAD);
  if (n > 1.0f) n = 1.0f;
  n = EXPO * n * n * n + (1.0f - EXPO) * n;
  return v < 0 ? -n : n;
}

float triggerToNorm(int v) {
  if (v < TRIG_DEAD) return 0.0f;
  return (float)(v - TRIG_DEAD) / (255 - TRIG_DEAD);
}

void writeServo(const Joint& j) {
  float us = j.usMin + (j.usMax - j.usMin) * (j.current / 180.0f);
  pwm.writeMicroseconds(j.channel, (uint16_t)(us + 0.5f));
}

void updateLed() {
  if (!PS4.isConnected()) return;
  if (speedLevel == 0)      PS4.setLed(0, 255, 0);    // yavaş: yeşil
  else if (speedLevel == 1) PS4.setLed(0, 0, 255);    // orta: mavi
  else                      PS4.setLed(255, 0, 0);    // hızlı: kırmızı
  PS4.sendToController();
}

void onConnect() {
  Serial.println("PS4 kolu baglandi.");
  updateLed();
}

void onDisconnect() {
  // Güvenlik: bağlantı koparsa kol olduğu yerde durur
  Serial.println("PS4 baglantisi koptu! Kol donduruldu.");
  homing = false;
  for (auto& j : joints) j.target = j.current;
}

// -------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);   // PCA9685 dahili osilatör kalibrasyonu
  pwm.setPWMFreq(SERVO_FREQ);
  delay(10);

  // Açılışta servolar home pozisyonuna gider
  for (auto& j : joints) {
    j.target = j.current = j.homeDeg;
    writeServo(j);
    delay(150);   // servoları sırayla başlatıp ani akım çekişini azalt
  }

  PS4.attachOnConnect(onConnect);
  PS4.attachOnDisconnect(onDisconnect);
  PS4.begin(PS4_MAC);
  Serial.println("PS4 kolu bekleniyor... (PS tusuna basin)");
}

void loop() {
  uint32_t now = millis();
  if (now - lastLoop < LOOP_MS) return;
  float dt = (now - lastLoop) / 1000.0f;
  lastLoop = now;

  float vel[6] = {0, 0, 0, 0, 0, 0};   // -1..1 normalize hız komutları

  if (PS4.isConnected()) {
    // --- Analog çubuklar ---
    vel[BASE]       = stickToNorm(PS4.LStickX());
    vel[SHOULDER]   = stickToNorm(PS4.LStickY());
    vel[ELBOW]      = stickToNorm(PS4.RStickY());
    vel[WRIST_ROLL] = stickToNorm(PS4.RStickX());

    // --- Yön tuşları: bilek eğimi ---
    if (PS4.Up())   vel[WRIST_PITCH] =  1.0f;
    if (PS4.Down()) vel[WRIST_PITCH] = -1.0f;

    // --- R2 kapatır, L2 açar (analog: ne kadar basılırsa o kadar hızlı) ---
    vel[GRIPPER] = triggerToNorm(PS4.R2Value()) - triggerToNorm(PS4.L2Value());

    // --- Yön ← / → : hız kademesi (kenar algılama) ---
    bool l = PS4.Left(), r = PS4.Right();
    if (l && !prevLeft  && speedLevel > 0) { speedLevel--; updateLed(); }
    if (r && !prevRight && speedLevel < 2) { speedLevel++; updateLed(); }
    prevLeft = l; prevRight = r;

    // --- OPTIONS: home pozisyonu ---
    if (PS4.Options()) homing = true;
  }

  // Herhangi bir manuel komut gelirse home hareketini iptal et
  for (float v : vel) if (v != 0.0f) { homing = false; break; }

  float scale = SPEED_LEVELS[speedLevel];

  for (int i = 0; i < 6; i++) {
    Joint& j = joints[i];

    // 1) Hız -> hedef açı (entegrasyon)
    if (homing) j.target = j.homeDeg;
    else        j.target += vel[i] * j.dir * j.maxSpeed * scale * dt;
    j.target = constrain(j.target, j.minDeg, j.maxDeg);

    // 2) Alçak geçiren filtre + adım sınırı ile yumuşak takip
    float step    = (j.target - j.current) * SMOOTHING;
    float maxStep = j.maxSpeed * dt;
    step = constrain(step, -maxStep, maxStep);

    if (fabsf(step) > 0.01f) {
      j.current += step;
      writeServo(j);
    }
  }

  // Seri port üzerinden durum bilgisi (2 Hz)
  if (now - lastPrint > 500) {
    lastPrint = now;
    for (auto& j : joints) { Serial.print(j.name); Serial.print(':'); Serial.print(j.current, 1); Serial.print("  "); }
    Serial.println();
  }
}
##DOSYA_SON
##DOSYA README.md
# 6 Eksenli Robot Kol – ESP32 + PCA9685 + PS4 Kolu

Kod: [`RobotKol_PS4.ino`](RobotKol_PS4.ino)

## Bağlantı Şeması

```
                 HARİCİ GÜÇ KAYNAĞI (5–6 V, en az 6–10 A)
                   (+)                         (–)
                    │                           │
                    │   ┌──── 1000 µF kapasitör ─┤
                    ▼   ▼                       ▼
 ┌──────────┐     ┌──────────────────────────────────┐
 │  ESP32   │     │            PCA9685               │
 │          │     │  V+ (vida klemens) ◄── (+)       │
 │      3V3 ├────►│  VCC (lojik)                     │
 │      GND ├────►│  GND  ◄── (–)  ORTAK TOPRAK!     │
 │   GPIO21 ├────►│  SDA                             │
 │   GPIO22 ├────►│  SCL                             │
 │          │     │  OE  → boş bırak (veya GND)      │
 └──────────┘     │                                  │
   USB ile        │  Kanal 0 ─ Taban servo           │
   beslenir       │  Kanal 1 ─ Omuz servo            │
                  │  Kanal 2 ─ Dirsek servo          │
                  │  Kanal 3 ─ Bilek eğim servo      │
                  │  Kanal 4 ─ Bilek dönüş servo     │
                  │  Kanal 5 ─ Kıskaç servo          │
                  └──────────────────────────────────┘
 Servo konnektörü (her kanalda):  GND = kahverengi/siyah,  V+ = kırmızı,  PWM = turuncu/sarı
```

1. **I²C:** ESP32 GPIO21 → PCA9685 SDA, GPIO22 → SCL.
2. **Lojik besleme:** ESP32 3V3 → PCA9685 VCC (PCA9685 lojiği 3.3 V ile çalışır).
3. **Toprak:** ESP32 GND → PCA9685 GND. Harici güç kaynağının (–) ucu da aynı GND'ye bağlanmalı.
4. **Servo gücü:** Harici 5–6 V kaynağın (+) ucu PCA9685'in mavi vida klemensindeki **V+**'ya. Servoları asla ESP32'nin 5V/3V3 pininden beslemeyin.
5. **Kapasitör:** V+ ile GND arasına 470–1000 µF elektrolitik kapasitör (kutuplara dikkat).
6. **Servolar:** Kanal 0–5'e, kahverengi kablo kartın kenarındaki GND sırasına gelecek şekilde takılır.
7. **Adres:** A0–A5 köprüleri açık bırakılırsa adres `0x40` olur.

**Güç hesabı:** MG996R tipi bir servo yük altında 1.5–2.5 A çekebilir. 6 servo için 5 V / 10 A (ya da 6 V) bir adaptör veya BEC önerilir.

## PS4 Kolunu Eşleştirme

1. *SixaxisPairTool* ile PS4 kolunu USB'den bilgisayara takın, "Master MAC" alanına bir MAC yazın (ör. `a0:b1:c2:d3:e4:f5`) ve **Update** deyin.
2. Aynı MAC'i koddaki `PS4_MAC` değişkenine yazın.
3. ESP32 Arduino Core **2.0.x** (ör. 2.0.17) kullanın.
4. Kodu yükledikten sonra kolun **PS** tuşuna basın; ışık çubuğu mavi yanınca bağlantı kurulmuştur.

## Tek Tıkla Kurulum (Windows)

`ROBOT_KOL_KURULUM.bat` dosyasına çift tıklayın. Dosya şunları kendisi yapar:

1. Masaüstünde **ROBOT KOL** klasörünü oluşturur. Bütün dosyalar ve araçlar bu klasöre konur.
2. PS4 kolunun MAC adresini bir kez sorar ve `ayarlar.txt` dosyasına kaydeder.
3. Kodu ve bu belgeyi yazar. Bir dosya değiştiyse eski sürümünü `yedekler\` klasörüne alır.
4. Arduino CLI'yi, ESP32 kart paketini (2.0.17) ve kütüphaneleri indirip kurar.
5. Kodu derler, ESP32'nin bağlı olduğu COM portunu bulur ve kodu karta yükler.

Yeni bir sürüm geldiğinde güncel `.bat` dosyasına çift tıklamanız yeterli. Not: `kurulum/bat_olustur.sh` betiği, `.bat` dosyasını bu klasördeki dosyalardan yeniden üretir.
##DOSYA_SON
