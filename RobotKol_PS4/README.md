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
