/*
 * Otonom Lazerli Sinek İmha Prototipi — Taret & Güvenlik Firmware'i
 * Hedef kart : Arduino Nano / Uno (ATmega328P, 16 MHz, 5 V lojik)
 *
 * Görev ayrımı:
 *   Raspberry Pi  -> görüntü işleme, hedef seçimi, kinematik (YAVAŞ, Linux)
 *   Bu firmware   -> servo sürme, lazer darbesi, TÜM yazılımsal güvenlik kilitleri
 *                    (deterministik, Pi çökse bile lazeri kapatır)
 *
 * Yazılımsal güvenlik katmanları (donanımsal katmanlar ayrıca var, bkz. doküman):
 *   1. ARM olmadan atış yok; ARM için anahtar + E-stop + varlık sensörü temiz olmalı
 *   2. Heartbeat zaman aşımı (500 ms) -> laser OFF + DISARM + röle bırak
 *   3. Darbe süresi donanım zamanlayıcısı gibi loop()'ta kesin sınırlanır (<= 60 ms)
 *   4. Atışlar arası bekleme (cooldown) + dakikadaki maksimum atış sayısı
 *   5. Servolar hareket ederken / yerleşmeden atış yok
 *   6. Açı yazılımsal limitleri (tavan/zemin/pencere yönü)
 *   7. AVR watchdog (250 ms): kilitlenme -> reset -> pinler giriş -> pull-down lazeri kapatır
 *   8. Şarj pompası (charge pump) çıkışı: röle yalnızca MCU canlı ve ARM iken kapanır
 *   9. Hatalar MANDALLI (latched): temizlemek için DISARM + girişler güvenli + 'C' komutu
 *
 * Seri protokol: 115200 8N1, "$GÖVDE*CS\n", CS = XOR(GÖVDE) iki haneli HEX
 *   H | A,1 | A,0 | M,pan_cdeg,tilt_cdeg | P,1 | P,0 | F,ms,pwm | S | C
 */

#include <Servo.h>
#include <avr/wdt.h>

// ------------------------------ PIN HARİTASI ------------------------------
const uint8_t PIN_ESTOP_SENSE   = 2;   // E-stop 2. NC kontağı -> GND. Basılınca açılır -> HIGH = HATA
const uint8_t PIN_LASER_TTL     = 3;   // Timer2 PWM (OC2B) -> lazer sürücü TTL/PWM girişi (10k pull-down!)
const uint8_t PIN_POINTER       = 4;   // 650 nm <1 mW nişan lazeri (NPN/MOSFET üzerinden)
const uint8_t PIN_BUZZER        = 5;   // aktif buzzer: ARM uyarısı
const uint8_t PIN_STATUS_LED    = 6;   // ARM göstergesi (kırmızı LED, kutu dışında)
const uint8_t PIN_KEY_SENSE     = 7;   // anahtarlı şalter kontağı -> GND. Açık (HIGH) = HATA
const uint8_t PIN_PRESENCE      = 8;   // LD2410 OUT: HIGH = insan/evcil hayvan var -> HATA
const uint8_t PIN_SERVO_PAN     = 9;   // Timer1 (Servo kütüphanesi)
const uint8_t PIN_SERVO_TILT    = 10;
const uint8_t PIN_CHARGE_PUMP   = 12;  // ~1 kHz kare dalga -> şarj pompası -> güvenlik rölesi
const uint8_t PIN_HEARTBEAT_LED = 13;

// ------------------------------ PARAMETRELER ------------------------------
// DS3218MG (180° sürüm): 500..2500 µs ≈ 0..180°, merkez 1500 µs
const float    US_CENTER_PAN   = 1500.0f;
const float    US_CENTER_TILT  = 1500.0f;
const float    US_PER_DEG      = 2000.0f / 180.0f;   // 11.11 µs/derece
const int8_t   PAN_DIR         = +1;                 // montaja göre +1 / -1
const int8_t   TILT_DIR        = +1;
const int16_t  PAN_MIN_CDEG    = -6000, PAN_MAX_CDEG  = 6000;   // ±60.00°
const int16_t  TILT_MIN_CDEG   = -3500, TILT_MAX_CDEG = 4500;   // tavana / zemine sınır
const float    SLEW_DPS        = 250.0f;   // yumuşak hareket: akım darbesini ve sallanmayı azaltır
const uint16_t SETTLE_MS       = 150;      // hedefe varıştan sonra mekanik oturma süresi

const uint16_t MAX_FIRE_MS        = 60;
const uint16_t COOLDOWN_MS        = 1000;
const uint8_t  MAX_SHOTS_PER_MIN  = 12;
// Wokwi'de komutları elle yazarken heartbeat yetiştirilemez -> 1 yapın (GERÇEK DONANIMDA ASLA)
#define WOKWI_MANUAL 0
#if WOKWI_MANUAL
const uint16_t HEARTBEAT_TIMEOUT  = 60000;
#else
const uint16_t HEARTBEAT_TIMEOUT  = 500;
#endif
const uint16_t ARM_WARN_MS        = 1500;  // ARM'dan sonra buzzer uyarısı, bu sürede atış yok

// ------------------------------ HATA KODLARI ------------------------------
enum Fault : uint8_t {
  F_NONE = 0, F_ESTOP = 1, F_KEY = 2, F_PRESENCE = 4, F_HEARTBEAT = 8, F_PROTOCOL = 16
};

// ------------------------------ DURUM -------------------------------------
Servo sPan, sTilt;
float panCur = 0, tiltCur = 0;          // derece (slew sonrası)
float panTgt = 0, tiltTgt = 0;
uint32_t arrivedAt = 0;
bool     moving = false;

bool     armed = false;
uint32_t armedAt = 0;
uint8_t  faults = F_NONE;               // mandallı hatalar
bool     laserOn = false;
uint32_t laserOffAt = 0;
uint32_t lastShot = 0;
uint32_t shotTimes[MAX_SHOTS_PER_MIN];
uint8_t  shotIdx = 0;
uint32_t lastHeartbeat = 0;
uint32_t lastSlew = 0;

char     rx[48];
uint8_t  rxLen = 0;

// ------------------------------ YARDIMCILAR -------------------------------
inline void laserHardOff() {
  // PWM'i kes ve pini kesin LOW'a çek
  TCCR2A &= ~(_BV(COM2B1) | _BV(COM2B0));
  digitalWrite(PIN_LASER_TTL, LOW);
  laserOn = false;
}

void disarm() {
  laserHardOff();
  digitalWrite(PIN_POINTER, LOW);
  armed = false;
  digitalWrite(PIN_STATUS_LED, LOW);
  digitalWrite(PIN_BUZZER, LOW);
}

uint8_t readInputs() {
  uint8_t f = F_NONE;
  if (digitalRead(PIN_ESTOP_SENSE) == HIGH) f |= F_ESTOP;    // kontak açık = basılı / kablo kopuk
  if (digitalRead(PIN_KEY_SENSE)   == HIGH) f |= F_KEY;
  if (digitalRead(PIN_PRESENCE)    == HIGH) f |= F_PRESENCE;
  return f;
}

void latchFault(uint8_t f) {
  if (f == F_NONE) return;
  faults |= f;
  disarm();
}

uint8_t xorSum(const char *s, uint8_t n) {
  uint8_t c = 0;
  for (uint8_t i = 0; i < n; i++) c ^= (uint8_t)s[i];
  return c;
}

void reply(const char *body) {
  char buf[64];
  uint8_t n = strlen(body);
  snprintf(buf, sizeof(buf), "$%s*%02X\n", body, xorSum(body, n));
  Serial.print(buf);
}

void writeServos() {
  sPan.writeMicroseconds((int)(US_CENTER_PAN + PAN_DIR * panCur * US_PER_DEG + 0.5f));
  sTilt.writeMicroseconds((int)(US_CENTER_TILT + TILT_DIR * tiltCur * US_PER_DEG + 0.5f));
}

bool settled() {
  return !moving && (millis() - arrivedAt >= SETTLE_MS);
}

uint8_t shotsLastMinute() {
  uint8_t n = 0;
  uint32_t now = millis();
  for (uint8_t i = 0; i < MAX_SHOTS_PER_MIN; i++)
    if (shotTimes[i] != 0 && now - shotTimes[i] < 60000UL) n++;
  return n;
}

// ------------------------------ LAZER DARBESİ -----------------------------
// Timer2 hızlı PWM, ön bölücü 8 -> 16 MHz / 8 / 256 = 7.8 kHz
// (çoğu CNC lazer sürücüsü 1–20 kHz TTL/PWM kabul eder; sürücü veri sayfasını kontrol edin)
void laserPulse(uint16_t ms, uint8_t pwm) {
  if (pwm >= 255) {
    TCCR2A &= ~(_BV(COM2B1) | _BV(COM2B0));
    digitalWrite(PIN_LASER_TTL, HIGH);
  } else {
    OCR2B = pwm;
    TCCR2A |= _BV(COM2B1);
  }
  laserOn = true;
  laserOffAt = millis() + ms;
}

// ------------------------------ KOMUT İŞLEME ------------------------------
void handle(char *body) {
  char cmd = body[0];
  char *arg = (body[1] == ',') ? body + 2 : nullptr;

  switch (cmd) {
    case 'H':
      lastHeartbeat = millis();
      reply("OK,H");
      return;

    case 'S': {
      char b[48];
      snprintf(b, sizeof(b), "S,%d,%u,%d,%d,%d", armed ? 1 : 0, faults,
               (int)(panCur * 100), (int)(tiltCur * 100), settled() ? 0 : 1);
      reply(b);
      return;
    }

    case 'A': {
      if (!arg) { reply("ERR,ARG"); return; }
      if (arg[0] == '0') { disarm(); reply("OK,A"); return; }
      uint8_t in = readInputs();
      if (faults || in) { latchFault(in); reply("ERR,FAULT"); return; }
      armed = true;
      armedAt = millis();
      digitalWrite(PIN_STATUS_LED, HIGH);
      reply("OK,A");
      return;
    }

    case 'C': {
      if (armed || readInputs()) { reply("ERR,BUSY"); return; }
      faults = F_NONE;
      reply("OK,C");
      return;
    }

    case 'M': {
      if (!arg) { reply("ERR,ARG"); return; }
      char *c2 = strchr(arg, ',');
      if (!c2) { reply("ERR,ARG"); return; }
      long p = atol(arg), t = atol(c2 + 1);
      p = constrain(p, PAN_MIN_CDEG, PAN_MAX_CDEG);
      t = constrain(t, TILT_MIN_CDEG, TILT_MAX_CDEG);
      if (laserOn) laserHardOff();          // hareket ederken asla ışın yok
      panTgt = p / 100.0f;
      tiltTgt = t / 100.0f;
      moving = true;
      reply("OK,M");
      return;
    }

    case 'P': {
      if (!arg) { reply("ERR,ARG"); return; }
      digitalWrite(PIN_POINTER, arg[0] == '1' && !faults ? HIGH : LOW);
      reply("OK,P");
      return;
    }

    case 'F': {
      if (!arg) { reply("ERR,ARG"); return; }
      char *c2 = strchr(arg, ',');
      long ms = atol(arg);
      long pwm = c2 ? atol(c2 + 1) : 255;
      uint32_t now = millis();
      if (!armed || faults)                       { reply("ERR,NOTARMED"); return; }
      if (now - armedAt < ARM_WARN_MS)            { reply("ERR,WARNING"); return; }
      if (ms <= 0 || ms > MAX_FIRE_MS)            { reply("ERR,DURATION"); return; }
      if (pwm < 0 || pwm > 255)                   { reply("ERR,PWM"); return; }
      if (!settled())                             { reply("ERR,MOVING"); return; }
      if (now - lastShot < COOLDOWN_MS)           { reply("ERR,COOLDOWN"); return; }
      if (shotsLastMinute() >= MAX_SHOTS_PER_MIN) { reply("ERR,RATE"); return; }
      uint8_t in = readInputs();
      if (in)                                     { latchFault(in); reply("ERR,FAULT"); return; }
      digitalWrite(PIN_POINTER, LOW);
      laserPulse((uint16_t)ms, (uint8_t)pwm);
      lastShot = now;
      shotTimes[shotIdx] = now;
      shotIdx = (shotIdx + 1) % MAX_SHOTS_PER_MIN;
      reply("OK,F");
      return;
    }
  }
  reply("ERR,CMD");
}

void pollSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '$') { rxLen = 0; continue; }
    if (ch == '\n' || ch == '\r') {
      if (rxLen < 4) { rxLen = 0; continue; }
      rx[rxLen] = 0;
      char *star = strrchr(rx, '*');
      if (!star) { rxLen = 0; reply("ERR,FRAME"); continue; }
      *star = 0;
      uint8_t cs = (uint8_t)strtol(star + 1, nullptr, 16);
      if (cs != xorSum(rx, strlen(rx))) { rxLen = 0; reply("ERR,CRC"); continue; }
      handle(rx);
      rxLen = 0;
      continue;
    }
    if (rxLen < sizeof(rx) - 1) rx[rxLen++] = ch;
    else { rxLen = 0; reply("ERR,LEN"); }
  }
}

// ------------------------------ SETUP / LOOP ------------------------------
void setup() {
  // İLK İŞ: lazer pinini LOW yap (harici 10k pull-down zaten LOW tutuyor)
  pinMode(PIN_LASER_TTL, OUTPUT);
  digitalWrite(PIN_LASER_TTL, LOW);
  pinMode(PIN_POINTER, OUTPUT);       digitalWrite(PIN_POINTER, LOW);
  pinMode(PIN_CHARGE_PUMP, OUTPUT);   digitalWrite(PIN_CHARGE_PUMP, LOW);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_HEARTBEAT_LED, OUTPUT);
  pinMode(PIN_ESTOP_SENSE, INPUT_PULLUP);
  pinMode(PIN_KEY_SENSE, INPUT_PULLUP);
  pinMode(PIN_PRESENCE, INPUT);       // LD2410 push-pull çıkış; kablo kopukluğuna karşı 10k pull-UP ekleyin

  // Timer2: hızlı PWM, ön bölücü 8 (7.8 kHz). Çıkış bağlantısı yalnızca darbe sırasında.
  TCCR2A = _BV(WGM21) | _BV(WGM20);
  TCCR2B = _BV(CS21);
  OCR2B = 0;

  sPan.attach(PIN_SERVO_PAN, 500, 2500);
  sTilt.attach(PIN_SERVO_TILT, 500, 2500);
  writeServos();

  Serial.begin(115200);
  lastHeartbeat = millis();
  faults = F_HEARTBEAT;   // açılışta mandallı: Pi bağlanıp 'C' göndermeli
  wdt_enable(WDTO_250MS);
  reply("OK,BOOT");
}

void loop() {
  wdt_reset();
  uint32_t now = millis();

  pollSerial();

  // 1) Darbe süresi sınırı — her şeyden önce
  if (laserOn && (int32_t)(now - laserOffAt) >= 0) laserHardOff();

  // 2) Güvenlik girişleri (ARM değilken bile E-stop izlenir ve mandallanır)
  uint8_t in = readInputs();
  if (in && (armed || laserOn)) latchFault(in);

  // 3) Heartbeat
  if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    if (armed || laserOn || !(faults & F_HEARTBEAT)) latchFault(F_HEARTBEAT);
  }

  // 4) Slew-limitli servo güncellemesi (5 ms periyot)
  if (now - lastSlew >= 5) {
    float dt = (now - lastSlew) / 1000.0f;
    lastSlew = now;
    float step = SLEW_DPS * dt;
    float dp = panTgt - panCur, dtl = tiltTgt - tiltCur;
    panCur  += (fabs(dp)  <= step) ? dp  : (dp  > 0 ? step : -step);
    tiltCur += (fabs(dtl) <= step) ? dtl : (dtl > 0 ? step : -step);
    writeServos();
    bool nowMoving = (panCur != panTgt) || (tiltCur != tiltTgt);
    if (moving && !nowMoving) arrivedAt = now;
    moving = nowMoving;
    if (moving && laserOn) laserHardOff();
  }

  // 5) Şarj pompası: yalnızca ARM + hatasız iken kare dalga üret.
  //    Pin sabit HIGH ya da LOW kalırsa (kilitlenme) kondansatör DC geçirmez -> röle düşer.
  static uint32_t lastPump = 0;
  if (armed && !faults) {
    uint32_t us = micros();
    if (us - lastPump >= 500) { lastPump = us; digitalWrite(PIN_CHARGE_PUMP, !digitalRead(PIN_CHARGE_PUMP)); }
  } else {
    digitalWrite(PIN_CHARGE_PUMP, LOW);
  }

  // 6) Uyarılar: ARM sonrası buzzer, heartbeat LED
  digitalWrite(PIN_BUZZER, (armed && now - armedAt < ARM_WARN_MS) ? HIGH : LOW);
  digitalWrite(PIN_HEARTBEAT_LED, ((now / 250) & 1) && !faults);
}
