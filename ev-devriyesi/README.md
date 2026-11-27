# Ev Devriyesi 🤖📷

Roborock robot süpürge + üstüne takılan IP kamera ile ev devriye robotu.

Robot belirlediğin noktaları sırayla gezer, her noktada durup fotoğraf çeker,
YOLO ile **insan / kedi / köpek** arar. İnsan görürse fotoğrafı anında
**Telegram**'a gönderir. Devriye bitince şarja döner ve özet yollar.

```
 Home Assistant  ──tetikler──►  devriye.py  ──git(x,y)──►  Roborock
 (çıkış, saat,                  (Pi / PC)   ◄──RTSP────    + üstte kamera
  kapı sensörü)                     │
                                    └──foto + alarm──►  Telegram
```

## 1. Donanım

| Parça | Not |
|---|---|
| Roborock (LiDAR'lı model) | "Hedefe git" özelliği olmalı (S5, S6, S7, S8, Q7, Q8 vb.) |
| Küçük Wi‑Fi kamera | RTSP desteği şart. Hafif olsun (< 200 g) |
| Powerbank (5000 mAh, ince) | Kamerayı besler. Robotun bataryasına bağlama |
| 3D baskı / alüminyum L parça | Kamerayı LiDAR kulesinin **önüne veya yanına**, kuleyi kapatmadan bağla |
| Raspberry Pi 5 / evdeki PC | Kodu çalıştırır |

**Montaj kuralları**
- LiDAR kulesinin 360° görüşü kapanmamalı. Kameranın en yüksek noktası kule
  üstünden en fazla 3‑4 cm yüksekte olsun.
- Robot artık daha uzun. Altına sıkıştığı koltuk/yatakları uygulamada
  **yasak bölge** yap.
- Kamerayı hafif yukarı (10‑15°) baktır: insanlar kadrajın içinde kalsın.
- Çarpma tamponunu (bumper) engelleme.

## 2. Robot kontrolünü seç

**A) Home Assistant (önerilen başlangıç, root yok)**
1. Home Assistant'a *Roborock* entegrasyonunu ekle (Roborock hesabınla).
2. Profil → Güvenlik → *Uzun ömürlü erişim tokeni* oluştur.
3. `config.yaml` içinde `tur: homeassistant`.

**B) Valetudo (ileri seviye, tamamen yerel, buluta veri gitmez)**
- Robotu [valetudo.cloud](https://valetudo.cloud) rehberine göre root'la
  (garanti biter, modelin desteklenip desteklenmediğine önce bak).
- `config.yaml` içinde `tur: valetudo`.

## 3. Kurulum

```bash
git clone <bu repo> && cd A-/ev-devriyesi
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml   # sonra düzenle
```

**Telegram botu:** Telegram'da `@BotFather` → `/newbot` → token'ı al.
Botuna bir mesaj at, sonra `https://api.telegram.org/bot<TOKEN>/getUpdates`
adresinde `chat.id` değerini bul.

## 4. Nokta koordinatlarını bulmak

Roborock haritasında birim milimetre; şarj istasyonu genelde
`(25500, 25500)` civarındadır.

- **Valetudo:** Web arayüzünde haritaya tıkla → *Go to* noktası koordinatı
  gösterir.
- **Home Assistant:** HACS'tan **Xiaomi Vacuum Map Card**'ı kur. Kalibrasyon
  sonrası haritaya tıkladığında koordinatı gösterir/kopyalar.
- **Deneme‑yanılma:** Bir koordinat yaz, `python devriye.py --nokta salon`
  ile sadece oraya gönder, nereye gittiğine bak, düzelt.

İpucu: noktaları odanın **kapısına yakın, odayı gören** yerlere koy; robotu
odanın ortasına değil, köşeden odaya bakacak yere gönder.

## 5. Çalıştır

```bash
python devriye.py --deneme        # robot hareket etmez, kamera + YOLO + Telegram testi
python devriye.py --nokta mutfak  # tek nokta testi
python devriye.py                 # tam devriye
```

Fotoğraflar `kayitlar/<tarih_saat>/<nokta>.jpg` altına kaydedilir.

## 6. Otomatik başlatma

`homeassistant_otomasyon.yaml` içinde hazır örnekler var:
- Herkes evden çıkınca 10 dk sonra devriye
- Gece 03:00 devriyesi (evde kimse yoksa)
- Kapı sensörü açılınca anında devriye

Basit alternatif (Home Assistant'sız, cron):
```bash
crontab -e
0 3 * * * cd /home/pi/A-/ev-devriyesi && .venv/bin/python devriye.py >> devriye.log 2>&1
```

## 7. Sorun giderme

| Sorun | Çözüm |
|---|---|
| Kedi/köpek "insan" sanılıyor | `esik` değerini 0.6‑0.7 yap |
| Fotoğraflar bulanık | `bekleme` değerini 3‑4 sn yap |
| "Kamera açılamadı" | RTSP adresini VLC ile dene; robot Wi‑Fi'nin zayıf olduğu yerde olabilir |
| Robot noktaya gitmiyor | HA'da *Geliştirici Araçları → Servisler*'den `vacuum.send_command`, `app_goto_target`, `[x, y]` elle dene |
| Robot hep "ulaşılamadı" diyor | `zaman_asimi` değerini artır; noktanın engelin içinde olmadığından emin ol |

## 8. Sonraki adımlar

- [ ] Gece devriyesi için kameraya IR / küçük LED ışık
- [ ] Ev sesleri: cam kırılması / duman alarmı sesi duyunca devriye
- [ ] Görüntüleri bir yapay zekâya sorma: "Pencere açık mı? Ocak açık mı?"
- [ ] Telegram'dan komutla devriye: `/devriye`, `/git mutfak`
- [ ] Yüz tanıma ile ev halkını alarm dışı bırakma
