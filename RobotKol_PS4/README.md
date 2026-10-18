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

En yüksek numaralı `ROBOT_KOL_KURULUM_V<n>.bat` dosyasına çift tıklayın. Değişiklikler `SURUMLER.md` dosyasında. Dosya şunları kendisi yapar:

1. Masaüstünde **ROBOT KOL** klasörünü oluşturur. Bütün dosyalar ve araçlar bu klasöre konur.
2. PS4 kolunun MAC adresini bir kez sorar ve `ayarlar.txt` dosyasına kaydeder.
3. Kodu ve bu belgeyi yazar. Bir dosya değiştiyse eski sürümünü `yedekler\` klasörüne alır.
4. Arduino CLI'yi, ESP32 kart paketini (2.0.17) ve kütüphaneleri indirip kurar.
5. Kodu derler, ESP32'nin bağlı olduğu COM portunu bulur ve kodu karta yükler.

Yeni bir sürüm geldiğinde güncel `.bat` dosyasına çift tıklamanız yeterli. Not: `kurulum/bat_olustur.sh` betiği, `.bat` dosyasını bu klasördeki dosyalardan yeniden üretir.

## Bilgisayardan USB ile Kontrol

ESP32 bilgisayara USB ile bağlıyken `KONTROL_PANELI.html` dosyasını **Chrome** veya **Edge** ile açın. **USB ile bağlan** düğmesine basıp ESP32'nin COM portunu seçin.

- **Kaydırıcılar:** Her eksen kaydırıcıdaki açıya yumuşakça gider.
- **Klavye:** Q/A taban, W/S omuz, E/D dirsek, R/F bilek eğim, T/G bilek dönüş, Y/H kıskaç kapat/aç. 1/2/3 hız, 0 başlangıç pozisyonu, Boşluk durdur.
- **PS4 kolu (USB ile bilgisayara takılı):** Bluetooth'taki düzenin aynısıyla çalışır.

Panel ve Arduino seri monitörü aynı anda açık olamaz, çünkü ikisi aynı COM portunu kullanır. Servolar USB'den değil, yine harici güç kaynağından beslenmelidir.
