# Kameralı, Bilgisayar Kontrollü Havalı Hedef Tareti — Yapım Rehberi

> Önce `CLAUDE.md` içindeki kuralları okuyun. Bu rehber o kurallara göre yazıldı:
> düşük enerji, yalnızca cansız hedef, insan onaylı tek atış.

## 1. Genel yapı

```
[Kompresör 8 bar] → [Filtre/su tutucu] → [Regülatör 2–4 bar] → [Emniyet ventili]
      → [Küçük sertifikalı hava tankı] → [12/24 V selenoid valf] → [Namlu + BB besleyici]

[Kamera (namluya paralel)] ─USB─┐
                                ├─ [Raspberry Pi 4/5 veya PC] ─USB/Seri─ [Arduino/ESP32]
[Tarayıcıdaki arayüz] ──LAN─────┘                                   │
                                                  ┌─────────────────┼──────────────┐
                                             [Pan servo/step]  [Tilt servo/step]  [Röle/MOSFET → valf]
                                                  └──── Acil stop + emniyet anahtarı güç hattında ────┘
```

## 2. Parça listesi (öneri)

| Grup | Parça | Not |
|---|---|---|
| Hava | Filtre + regülatör + manometre | 0–10 bar giriş, 0–4 bar çıkış |
| Hava | Emniyet ventili | ~4,5 bar açma |
| Hava | Küçük hava tankı (≈0,1–0,5 L) | Basınç sertifikalı; PVC değil |
| Hava | Selenoid valf, hızlı (12 V, 1/4") | Normalde kapalı (NC) |
| Hava | Pnömatik hortum, rakorlar | 8 mm PU hortum |
| Atış | Airsoft iç namlu (6,03 mm) + hop-up veya paintball namlusu | Hazır ürün kullanın |
| Atış | Yerçekimi beslemeli BB haznesi / basit besleme mekanizması | |
| Hareket | 2× MG996R servo **veya** 2× NEMA17 + A4988/TMC2209 | Step motor daha hassas |
| Hareket | Pan-tilt braketi / rulman | Mekanik stoplar ekleyin |
| Kontrol | Raspberry Pi 4/5 (veya dizüstü PC) | Görüntü + web sunucu |
| Kontrol | Arduino Nano/Uno veya ESP32 | Motor + valf, heartbeat |
| Kontrol | Lojik seviyeli MOSFET modülü veya röle + flyback diyot | Valfi sürmek için |
| Görüntü | USB kamera (720p/1080p, 30–60 fps) | Namluya sabitlenir |
| Güvenlik | Mantar tipi acil stop, anahtarlı emniyet şalteri | Donanımsal kesme |
| Güç | 12 V adaptör + 5 V buck dönüştürücü | Servolar için ayrı 5–6 V hat |
| Alan | Mermi tutucu (backstop), kağıt hedefler, göz koruyucu | |

## 3. Adım adım yapım

### Adım 1 — Hava hattı
1. Kompresör → filtre → regülatör → manometre → emniyet ventili → tank → valf → namlu.
2. Regülatörü **2 bar** ile başlatın. Kaçak testini sabunlu suyla yapın.
3. Kronografla hız ölçün: `E = ½·m·v²`. 0,20 g BB için 1 J ≈ 100 m/s.
   Hedef **≤ 1 J**. Ölçümleri `OLCUMLER.md`ye yazın.

### Adım 2 — Mekanik
1. Pan (yatay) ve tilt (dikey) ekseni kurun; namlu + kamera tilt ekseninde.
2. Fiziksel stoplar: pan ±60°, tilt −10° / +20° gibi, yalnızca backstop yönüne.
3. Hortumu dönmeye izin verecek gevşeklikte bağlayın.

### Adım 3 — Elektronik
1. Arduino → servo/step sürücüler; Arduino pini → MOSFET → valf (diyot şart).
2. **Acil stop** ve **emniyet anahtarı** valf ve motor besleme hattına seri
   bağlanır (yazılımdan bağımsız).
3. Arduino ile Pi arasında USB seri (115200 baud).

### Adım 4 — Mikrodenetleyici yazılımı (Arduino)
Komut protokolü (satır sonlu metin):
```
P<derece>   pan açısı      ör. P15.5
T<derece>   tilt açısı     ör. T-3.0
ARM         silahla (10 sn geçerli)
FIRE        tek atış (yalnızca ARM durumunda, valf maks. 80 ms)
SAFE        emniyete al
H           heartbeat (her 200 ms)
```
Kurallar: açılışta SAFE; 500 ms heartbeat yoksa SAFE + motor dur;
açılar yazılım sınırları içinde kırpılır.

İskelet:
```cpp
#include <Servo.h>
Servo pan, tilt;
const int VALVE = 7;
const float PAN_MIN=-60, PAN_MAX=60, TILT_MIN=-10, TILT_MAX=20;
const unsigned long PULSE_MS = 60, ARM_TIMEOUT = 10000, HB_TIMEOUT = 500;
bool armed = false; unsigned long armedAt = 0, lastHb = 0;

void setup(){ pinMode(VALVE,OUTPUT); digitalWrite(VALVE,LOW);
  pan.attach(9); tilt.attach(10); Serial.begin(115200); }

void fire(){ if(!armed) return; digitalWrite(VALVE,HIGH); delay(PULSE_MS);
  digitalWrite(VALVE,LOW); armed=false; Serial.println("FIRED"); }

void loop(){
  if(Serial.available()){
    String c = Serial.readStringUntil('\n'); c.trim(); lastHb = millis();
    if(c.startsWith("P")) pan.write(90 + constrain(c.substring(1).toFloat(),PAN_MIN,PAN_MAX));
    else if(c.startsWith("T")) tilt.write(90 + constrain(c.substring(1).toFloat(),TILT_MIN,TILT_MAX));
    else if(c=="ARM"){ armed=true; armedAt=millis(); Serial.println("ARMED"); }
    else if(c=="FIRE") fire();
    else if(c=="SAFE"){ armed=false; Serial.println("SAFE"); }
  }
  if(armed && millis()-armedAt > ARM_TIMEOUT){ armed=false; Serial.println("SAFE"); }
  if(millis()-lastHb > HB_TIMEOUT){ armed=false; digitalWrite(VALVE,LOW); }
}
```

### Adım 5 — Bilgisayar tarafı (Python)
- **Görüntü:** OpenCV ile kamera okunur, MJPEG olarak tarayıcıya yayınlanır.
- **Sunucu:** Flask/FastAPI + WebSocket; `pyserial` ile Arduino'ya komut.
- **Arayüz (tarayıcı):**
  - Canlı görüntü + ortada **artı nişangâh**.
  - Görüntüye **tıklayınca** taret o noktaya döner (piksel → açı dönüşümü).
  - Klavye: ok tuşları ince ayar, `A` = ARM, `Boşluk` = FIRE, `Esc` = SAFE.
  - Durum çubuğu: EMNİYETTE / SİLAHLI, basınç (opsiyonel sensör), atış sayacı.
- **Piksel → açı:** kameranın yatay görüş açısı (FOV) H° ve genişliği W px ise
  `pan_delta = (x - W/2) / W * H`. Tilt için dikey FOV ile aynı.
- **Opsiyonel hedef yardımı:** yalnızca kağıt hedefe yapıştırılan **ArUco
  işaretçisini** bulup nişangâhı ona yaklaştırmak. Ateş yine kullanıcıdadır.

### Adım 6 — Kalibrasyon (sıfırlama)
1. 5 m'ye hedef koyun, birkaç atış yapın.
2. İsabet noktası ile nişangâh arasındaki farkı ölçün.
3. Arayüzde nişangâh ofsetini (px) kaydedin; mesafeye göre düşüş tablosu tutun.

## 4. Klasör yapısı (önerilen)
```
havali-taret/
├── CLAUDE.md        # kurallar
├── REHBER.md        # bu dosya
├── OLCUMLER.md      # kronograf ölçümleri
├── firmware/        # Arduino kodu
├── server/          # Python sunucu + OpenCV
├── web/             # arayüz (HTML/JS)
└── logs/            # ARM/FIRE/ESTOP kayıtları
```

## 5. İlk test kontrol listesi
- [ ] Regülatör 2 bar, emniyet ventili test edildi
- [ ] Acil stop basınca valf ve motorlar duruyor
- [ ] Emniyet anahtarı kapalıyken FIRE çalışmıyor
- [ ] Kablo çekilince (heartbeat yok) sistem SAFE oluyor
- [ ] Kronograf ölçümü ≤ 1 J
- [ ] Backstop yerinde, alanda kimse yok, gözlükler takılı

## 6. Namlu ve besleme mekaniği

Namluyu sıfırdan torna ile yapmak yerine **hazır airsoft parçaları** kullanılır.
Hazır parçalar ucuz ve hassastır, enerjiyi de 1 J sınırında tutmak kolaydır.

### 6.1 Parçalar
| Parça | Öneri | Görevi |
|---|---|---|
| İç namlu | 6,03 mm, 200–250 mm boy, pirinç/paslanmaz | BB'yi yönlendirir |
| Hop-up ünitesi | Standart AEG (V2 gövde) hop-up + bucking (lastik) | BB'ye geri dönüş (backspin) verir, menzili uzatır |
| Nozzle (hava memesi) | AEG nozzle, 1/4" hortum bağlantısına adaptörlü | Havayı hop-up'a verir, BB'yi yuvaya iter |
| Nozzle hareketi | Mini pnömatik silindir (çift etkili, 10 mm strok) **veya** küçük servo | Nozzle'ı ileri/geri sürer |
| Dış namlu | Alüminyum boru (Ø 20–25 mm) | İç namluyu korur, bağlantı noktası |
| Besleme | Yerçekimli BB haznesi + 6,5 mm iç çaplı besleme tüpü | BB'leri hop-up besleme ağzına indirir |
| Gövde | 20×20 sigma (alüminyum profil) + 3B baskı tutucular | Hepsini tilt eksenine bağlar |

> Kolay yol: hazır bir **HPA motoru** (selenoidli airsoft HPA tetik ünitesi)
> almak. Nozzle, valf ve zamanlama içinde gelir. Arduino sadece tetik
> sinyalini verir. Kendi yapacaksan aşağıdaki düzen kullanılır.

### 6.2 Kesit (yandan görünüş)
```
              BB haznesi
                 │ │
                 │●│  besleme tüpü
                 └┬┘
  hava ──[Valf]──[Nozzle]→ ● [bucking]═══════════ iç namlu ═══════════ → namlu ağzı
                    ↑         hop-up ünitesi
          [mini silindir/servo]   (ayar vidası üstte)
```

### 6.3 Bir atışın sırası
1. **Nozzle geri** çekilir → besleme ağzı açılır, bir BB yerçekimiyle düşer.
2. **Nozzle ileri** gider → BB'yi bucking'e oturtur ve besleme ağzını kapatır
   (sonraki BB'ler beklemede kalır).
3. **Valf açılır** (40–80 ms) → hava nozzle'dan geçer, BB namludan çıkar.
4. Valf kapanır → sıra 1'e döner.

Arduino'da bu bir zamanlama dizisidir: `NOZZLE_GERI` (≈60 ms) → `NOZZLE_ILERI`
(≈60 ms) → `VALF` (≤80 ms). FIRE komutu bu diziyi **bir kez** çalıştırır.

### 6.4 Yapım notları
- **Hizalama:** Nozzle, hop-up ve iç namlu aynı eksende olmalı. Hop-up
  gövdesini 3B baskı veya alüminyum bir yatağa sıkıca vidala. Kaçıklık isabeti
  bozar ve BB'yi sıkıştırır.
- **Sızdırmazlık:** Nozzle ucu bucking'in arkasına tam oturmalı. Sızıntı hızı
  düşürür ve atıştan atışa farkı artırır.
- **Hop-up ayarı:** Önce kapalı başla. BB düşüyorsa azar azar aç, yükseliyorsa
  kıs. Düz bir uçuş hedeflenir.
- **BB:** 0,20–0,25 g, kaliteli, dikişsiz BB kullan. Kötü BB namluyu tıkar.
- **Kamera:** Namluya paralel, aynı plakaya sabitle. Titreşimde kayarsa
  kalibrasyon bozulur.
- **Denge:** Tilt ekseni ağırlık merkezinden geçmeli (namlu öne, tank/valf
  arkaya). Servolar daha az zorlanır, nişan titremez.
- **Hortum:** Dönen kısma kıvrımlı PU hortum veya döner rakor kullan.

### 6.5 Enerjiyi sınırda tutmak
Hızı belirleyen başlıca üç şey var: **basınç**, **valf açık kalma süresi** ve
**namlu boyu**. Ayar sırası:
1. Regülatör 2 bar, valf 40 ms ile başla.
2. Kronografla ölç, `OLCUMLER.md`ye yaz.
3. 1 J'nin (0,20 g BB için ≈100 m/s) altında kalacak şekilde süre/basıncı
   ayarla. Kodda valf süresine **sabit üst sınır** koy.
