# Kamera Hareket Takibi

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

## Önemli: Xiaomi kameradan görüntüyü almak

Xiaomi Home kameraları görüntüyü varsayılan olarak **sadece kendi uygulamasına**
gönderir; standart bir RTSP adresi vermez. Programın görüntüye ulaşması için
şu yollardan biri gerekir:

1. **go2rtc** (önerilen, en kolay): Yeni sürümlerinde Xiaomi Mi Home kamera
   desteği var. Xiaomi hesabınla giriş yapıp kamerayı ekliyorsun, go2rtc sana
   yerel bir RTSP adresi veriyor (örn. `rtsp://127.0.0.1:8554/xiaomi`).
   Bu adresi `--kaynak` olarak ver. Her model desteklenmeyebilir.
2. **Alternatif yazılım (hack firmware)**: Bazı eski modeller için topluluk
   firmware'leri RTSP açar. Garanti/riski sana ait.
3. **RTSP destekli kamera**: Tapo, Reolink, Hikvision, Dahua vb. kameralar
   RTSP'yi doğrudan verir; bu program onlarla ek ayar olmadan çalışır.

Kamera modelini (kameranın altındaki etiket ya da Xiaomi Home → kamera →
Ayarlar → Hakkında) öğrenirsen hangi yolun çalışacağı netleşir.

> Not: Kameran 360° döner (PTZ) modelse, Xiaomi Home uygulamasındaki
> **"Hareket takibi"** ayarı kameranın kendisini hareketli nesneye çevirir.
> Bu program ise görüntü üzerinde takip, sayma ve kayıt yapar.

## Nasıl çalışıyor

1. **Arka plan çıkarma (MOG2):** Sabit sahneyi öğrenir, değişen pikselleri bulur.
   Gölgeler ayıklanır.
2. **Temizleme:** Morfolojik açma/genişletme ile gürültü silinir, parçalar birleşir.
3. **Kontur → kutu:** `--min-alan`dan büyük her hareketli bölge bir kutu olur.
4. **Merkez takibi:** Her kutunun merkezi önceki karedeki en yakın nesneyle
   eşleştirilir; böylece nesne kare kare aynı ID ile izlenir. 20 kare görünmeyen
   nesne silinir.
