# Kamera Hareket Takibi

## En kolay yol (Windows): tek dosya

**`KameraTakip.bat`** dosyasını bilgisayarına indir ve çift tıkla. Gerisini kendisi yapar:
Python yoksa kurar, kütüphaneleri kurar, go2rtc'yi indirip başlatır, Xiaomi
girişi için tarayıcıyı açar, kamera eklenince takibi başlatır. Hareket kayıtları
`Videolar\KameraTakip` klasörüne gider. Sonraki açılışlarda doğrudan takibe geçer.

(`takip.py` değişirse `python bat_olustur.py` ile bat yeniden üretilir.)


Xiaomi ev tipi IP kameradan (veya herhangi bir kameradan) gelen görüntüde
hareket eden nesneleri bulur, her birine kalıcı bir **ID** verir, etrafına kutu
çizer ve geçtiği yolu (iz) gösterir. İstenirse hareket olduğunda video kaydeder.

## Kurulum

```bash
pip install -r requirements.txt
```

## Çalıştırma

```bash
python takip.py --kaynak rtsp://KULLANICI:SIFRE@KAMERA_IP:554/yol --maske-saat
python takip.py --kaynak kayit.mp4                 # video dosyası
python takip.py --kaynak 0                         # bilgisayarın kamerası
python takip.py --kaynak rtsp://... --kaydet kayitlar   # hareket olunca kaydet
```

| Seçenek | Açıklama |
|---|---|
| `--min-alan 800` | Bu alandan küçük hareketleri yok sayar (gürültü, böcek, ışık titremesi) |
| `--maske-saat` | Sol üstteki Xiaomi tarih/saat yazısını hareket saymaz |
| `--genislik 960` | İşleme çözünürlüğü; düşürürsen daha hızlı çalışır |
| `--kaydet KLASOR` | Hareket olunca MP4 kaydeder, 5 sn hareketsizlikte durur |
| `--goruntusuz` | Pencere açmadan çalışır, sonuçları terminale yazar |

Pencerede `q` veya `Esc` ile çıkılır.

## Senin kameran: Mi 360° Camera (1080p) — MJSXJ10CM

Bu kamera standart RTSP vermez. Görüntüyü bilgisayara **go2rtc** adlı ücretsiz
programla alacağız. go2rtc Xiaomi hesabınla giriş yapıp kameraya **yerel ağdan**
bağlanır ve görüntüyü `rtsp://127.0.0.1:8554/xiaomi` adresinden yayınlar.
Takip programı da bu adresi okur. Xiaomi Home uygulaması çalışmaya devam eder.

### 1. Python ve kütüphaneler
- python.org'dan Python 3 kur ("Add Python to PATH" kutusunu işaretle).
- Bu klasörde: `pip install -r requirements.txt`

### 2. go2rtc'yi indir
- https://github.com/AlexxIT/go2rtc/releases adresinden **en son sürümü** indir
  (Xiaomi desteği v1.9.13'te geldi, v1.9.14'te iyileşti; daha eskisini kullanma).
  Windows için `go2rtc_win64.zip`, içindeki `go2rtc.exe`'yi bu klasöre koy.

### 3. Kamerayı go2rtc'ye ekle
1. `go2rtc.exe`'yi çalıştır (Windows güvenlik duvarı sorarsa izin ver).
2. Tarayıcıda **http://localhost:1984** aç.
3. **Add → Xiaomi** → Xiaomi hesabının e-posta/telefon ve şifresiyle giriş yap.
   SMS/e-posta kodu veya captcha isterse doldur.
4. Hesaptaki kameralar listelenir; kamerayı seç ve ekle. Akışın adını
   **`xiaomi`** yap (ya da `go2rtc.yaml` içinde `streams:` altındaki adı
   `xiaomi` olarak değiştir).
5. Web arayüzünde akışa tıklayıp görüntünün geldiğini kontrol et.

Bilgisayar ve kamera **aynı Wi-Fi/modemde** olmalı. go2rtc her bağlantıda
şifreleme anahtarı almak için kısa süre internete çıkar; görüntü ise yerel ağdan gelir.

### 4. Takibi başlat
```bash
python takip.py --kaynak rtsp://127.0.0.1:8554/xiaomi --maske-saat
```
`--kaynak go2rtc` yazarsan program go2rtc'yi kendisi indirir, başlatır ve
kamera eklenene kadar bekler.

### Görüntü gelmezse
- Akış adresinin sonuna `&subtype=sd` ekle (düşük kalite ama daha uyumlu).
- go2rtc'yi en son sürüme güncelle.
- MJSXJ10CM, go2rtc'nin uyumluluk listesinde henüz yazılı değil (2020 sonrası
  kameraların çoğu çalışıyor). Çalışmazsa
  https://github.com/AlexxIT/go2rtc/issues/1982 sayfasına bak.

> Not: Kameranın kendisinin dönerek nesneyi izlemesini istiyorsan Xiaomi Home →
> kamera → Ayarlar'daki **"Hareket takibi"** seçeneğini aç. Bu program ise
> görüntü üzerinde takip, sayma ve kayıt yapar; ikisi birlikte kullanılabilir.

### Başka kameralar
Tapo, Reolink, Hikvision, Dahua gibi RTSP veren kameralarda go2rtc'ye gerek yok;
kameranın RTSP adresini doğrudan `--kaynak` olarak ver.

## Nasıl çalışıyor

1. **Arka plan çıkarma (MOG2):** Sabit sahneyi öğrenir, değişen pikselleri bulur.
   Gölgeler ayıklanır.
2. **Temizleme:** Morfolojik açma/genişletme ile gürültü silinir, parçalar birleşir.
3. **Kontur → kutu:** `--min-alan`dan büyük her hareketli bölge bir kutu olur.
4. **Merkez takibi:** Her kutunun merkezi önceki karedeki en yakın nesneyle
   eşleştirilir; böylece nesne kare kare aynı ID ile izlenir. 20 kare görünmeyen
   nesne silinir.
