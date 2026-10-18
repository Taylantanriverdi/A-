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
