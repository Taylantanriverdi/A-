# Kamera Hareket Takibi

## En kolay yol (Windows): tek dosya

**İndir (her zaman en güncel sürüm):**
https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/ecstatic-fermat-gzzjnm/kamera-takip/KameraTakip.zip

ZIP'i ayıkla, **`Guncelle.bat`** dosyasına çift tıkla. Her açılışta en son sürümü
indirir ve programı başlatır (`KameraTakip.bat` güncellemeden doğrudan başlatır).

**Guncelle.bat — her zaman doğrudan iner (en son sürüm):**
https://github.com/Taylantanriverdi/A-/releases/latest/download/Guncelle.bat

Diğerleri: `.../releases/latest/download/KameraTakip.bat` ve `.../KameraTakip.zip`.
`kamera-takip/` her değiştiğinde GitHub Actions bu dosyaları "son-surum"
release'ine otomatik yükler. Gerisini kendisi yapar:
Python yoksa kurar, kütüphaneleri kurar, go2rtc'yi indirip başlatır, Xiaomi
girişi için tarayıcıyı açar. Giriş yapınca hesaptaki kamerayı bütün bölgelerde
kendisi arar, go2rtc'ye ekler ve takibi başlatır. Hareket kayıtları
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

## Sürüm

Her güncellemede sürüm numarası artar (`v1`, `v2`, ...). Görüntünün sağ alt
köşesinde, pencere başlığında ve siyah pencerenin başında görünür; güncellemenin
geldiğini buradan anlarsın. Sürüm `takip.py` içindeki `SURUM` satırındadır.

## Mavi ışık (v13)

Kameranın üzerindeki mavi durum ışığı, görüntüde bir kişi göründüğü sürece yanıp
söner; kişi gidince 2 saniye sonra eski haline döner. Işığı açıp kapatan ayar
kameranın MIoT özellik listesinden (genelde "Indicator Light") kendiliğinden
bulunur; kızılötesi gece ışığı gibi diğer ışıklara dokunulmaz.
Deneme: kamera penceresinde **L** ya da web sayfasında "Mavi ışığı dene".

## Selam kameranın hoparlöründen (v11)

Selam artık kameranın kendi hoparlöründen duyulur. go2rtc'nin iki yönlü ses
özelliği kullanılır; sesi kameranın anlayacağı biçime (PCMA ya da Opus) çevirmek
için FFmpeg gerekir, o da `imageio-ffmpeg` paketiyle otomatik kurulur ve yeri
`go2rtc.yaml` dosyasına yazılır (go2rtc bir kez yeniden başlatılır).

- `--hoparlor kamera` (varsayılan), `bilgisayar` ya da `ikisi`.
- Kamera hoparlörü kullanılamazsa ses kendiliğinden bilgisayardan çalar.
- Kamera sesini Xiaomi Home uygulamasından açabilirsin (kamera ayarları → ses).

## Türkçe (v10)

- Kamera penceresindeki bütün yazılar Türkçe harflerle (Segoe UI yazı tipi), siyah
  pencere ve web sayfası düzgün Türkçe.
- Selam sesi **Microsoft'un doğal Türkçe sesiyle** söylenir (Emel; erkek sesi için
  `--ses ahmet`). Olmazsa Google Türkçe sesi, o da olmazsa Windows sesi.
  Her cümle bir kez üretilip `ses_onbellek` klasöründe saklanır.
- Selam günün saatine göre: "Günaydın / Merhaba / İyi akşamlar / İyi geceler
  Taylan, hoş geldin." Büyük harfle kaydedilen adlar Türkçe kurallarla düzeltilir
  (TAYLAN → Taylan, IŞIL → Işıl).

## Kişileri tanıma ve isimle selamlama (v5)

Program kayıtlı kişileri yüzünden tanır, ekranda adını yazar ve bilgisayar
hoparlöründen **"Merhaba <isim>"** der. Tanıma tamamen bilgisayarda yapılır
(OpenCV SFace modeli, ilk açılışta ~38 MB iner); hiçbir şey internete gönderilmez.

**Kişi kaydetmek (telefon sayfası → Kişiler):** kişi kameraya bakarken adını yaz,
**Kaydet**'e bas. 4 saniye boyunca 10 örnek alınır; bu sırada başını hafifçe
çevirsin. Aynı kişiyi farklı ışıkta/açıda tekrar kaydetmek tanımayı güçlendirir.

**Toplu kayıt:** `%LOCALAPPDATA%\KameraTakip\kisiler\<İsim>\` klasörüne o kişinin
net yüz fotoğraflarını koy; program açılışta öğrenir.

- Ekranda: tanınan kişi yeşil + adı, tanınmayan turuncu **Taninmiyor**,
  henüz karar verilmemiş açık yeşil **Yuz N**.
- Karar son 7 tahminin çoğunluğuyla verilir (tek karelik hata etiketi değiştirmez).
- Aynı kişi en fazla 10 dakikada bir selamlanır (`--selam-ara`). Kapatmak: `--selam kapali`.
- Türkçe ses için Windows'ta Türkçe konuşma paketi gerekir (Ayarlar → Saat ve dil →
  Konuşma). Yoksa Windows'un varsayılan sesi okur.
- Telefon sayfasında "Selamı telefonda da sesli söyle" seçilirse telefon da söyler.
- Kişiler `kisiler.json` dosyasında saklanır; sayfadan silinebilir.
- Yüz verisi kişisel veridir (KVKK): ev dışında çalışanları/ziyaretçileri
  kaydedeceksen kişilerin bilgisi ve onayıyla yap.

## Çalışma alanı / açı sınırları (v4)

Kameranın tarama ve takip yaparken çıkmayacağı açı aralığını belirleyebilirsin.

1. Kamerayı oklarla sol sınır olacak yöne çevir → **1** tuşu (veya web'de
   "Sol sınır burası"). Sağ sınır → **2**. İstersen üst → **3**, alt → **4**.
2. **0** (veya "Sınırları sil") hepsini kaldırır.
3. Tarama sınıra gelince geri döner, dikey seviyeler alan içinde seçilir,
   takip de sınırın ötesine dönmez. Oklar her yere gider (yeni sınır koymak için).
4. Görüntünün alt ortasındaki çubuk: yeşil = izinli alan, kırmızı çizgiler =
   sınırlar, beyaz nokta = kameranın baktığı yer. Siyah pencerede ve web
   sayfasında adım ve yaklaşık derece yazar.

Konum, kameraya gönderilen adımlar sayılarak tutulur ve `alan_<did>.json`
dosyasına kaydedilir; program kapanıp açılınca kaldığı yerden devam eder.
Kamerayı Xiaomi Home uygulamasından çevirirsen veya kamera yeniden başlarsa
konum kayar: sınırları silip yeniden belirle.

## İnternetten, her yerden erişim (v8)

Program açılınca kendiliğinden ücretsiz bir **Cloudflare tüneli** açar
(`https://....trycloudflare.com`). Modemden port açmak, hesap açmak gerekmez.

- Tünel adresi her açılışta değişir. Bu yüzden program güncel adresi gizli,
  rastgele adlı bir **ntfy.sh** sayfasına yazar. O sayfanın adresi hiç değişmez:
  **sabit yer imi** (`https://ntfy.sh/kamera-...`). Telefonun yer imlerine bir kez
  ekle; açınca en üstteki mesajda "Kamerayi ac" düğmesi vardır.
- Sabit yer imi: siyah pencerede, web sayfasının "İnternetten erişim" bölümünde,
  kamera penceresinde **U** tuşuyla QR kod olarak.
- Giriş için PIN gerekir. 10 yanlış denemede giriş 15 dakika kilitlenir.
- Canlı akış bağlantı tarafından tamponlanırsa sayfa 6 sn sonra kendiliğinden
  saniyede ~4 kare moduna geçer.
- Bilgisayar açık ve program çalışıyor olmalı. Kapatmak: `--uzak kapali`.
- ntfy sayfasındaki mesajlar ~12 saat saklanır; program adresi 6 saatte bir
  yeniden yazar.

## Telefondan izleme ve kontrol (v3)

Program çalışırken küçük bir web sayfası açar (port 18765; doluysa sonraki boş port). Siyah pencerede
adresler ve 6 haneli PIN yazar:

```
 Telefondan / baska cihazdan izle ve kontrol et:
   http://192.168.1.20:18765   (ev agi)
   http://100.101.102.103:18765   (Tailscale - disaridan)
 PIN: 123456
```

- **Evde:** telefon aynı Wi-Fi'deyken "ev agi" adresini aç.
- **Dışarıdan:** bilgisayara ve telefona **Tailscale** kur (aynı hesap), "Tailscale"
  adresini aç. Modemden port açmaya gerek yok, açma.
- PIN her cihazda bir kez sorulur (`web_pin.txt` içinde saklanır).
- Sayfada takip görüntüsü, ok düğmeleri (dokun = bir adım, basılı tut = sürekli)
  ve OTOMATİK/SABİT düğmesi var. Bağlantı koparsa kamera kendiliğinden durur.
- İlk açılışta Windows Güvenlik Duvarı Python için izin sorarsa **İzin ver** de.
- Kapatmak için: `--web-port 0`.

## Döner kamera (360° / yukarı-aşağı)

Kamera go2rtc ile eklendiyse program kameranın motorunu da kullanır:

1. **İlk açılışta kalibrasyon:** go2rtc'nin kaydettiği Xiaomi girişiyle (yeni kod
   istemez) kameranın MIoT özellik listesini indirir, motorla ilgili komutları
   bulur ve her birini dener. Görüntünün hangi yöne ne kadar kaydığını ölçerek
   sol/sağ/yukarı/aşağı komutlarını öğrenir ve `ptz_<did>.json` dosyasına kaydeder.
   Bu sırada kamera birkaç kez döner. Yeniden yapmak için `--ptz-kalibre`.
2. **Hızlı tarama:** Yüz yokken kamera bir yöne azami hızla kesintisiz döner
   (komut aralığı 0,12 sn, aynı anda 3 komut). Görüntü kaymayı bırakınca (dönme
   sınırı) yön değiştirir ve dikey seviyeye geçer: orta → bir yan → öbür yan.
   Sınır yoksa her tam turda seviye değişir. Tam tur süresi kalibrasyondaki adım
   büyüklüğünden hesaplanıp siyah pencereye yazılır. Tarama sırasında yüz eşiği
   biraz düşürülür ve 1280 px çözünürlükte aranır; yanlış alarm olmasın diye yüz
   2 karede görülünce takibe geçilir. Durum: `TARAMA`.
3. **Takip:** Yüz görülünce tarama durur, kamera yüzü ekranın ortasında tutacak
   şekilde döner. Durum: `YUZ TAKIP`.
4. **Yüz kaybolursa** 3 sn bekler, sonra taramaya döner.

**Hız:** `--ptz-hiz 3` (varsayılan, hızlı), `2` normal, `1` sakin. Motorun kendi
dönüş hızı kamerada sabittir; hız ayarı komutlar arasındaki beklemeyi ve bir
seferde gönderilen adım sayısını değiştirir. Adımlar paralel gönderilir ve
Xiaomi bağlantısı açık tutulur.

**Elle kontrol (v2):** Görüntünün sol altında ok tuşları ve mod düğmesi var.
- **OTOMATIK / SABIT** düğmesi veya **P** tuşu: SABIT modda kamera kendiliğinden
  hiç hareket etmez (yüz yine bulunur ve fotoğraflanır).
- **Oklar** (ekrandaki düğmeler, klavye okları veya W/A/S/D): tıkla/bas = bir adım,
  basılı tut = akıcı dönüş. Oka dokununca program SABIT moda geçer, kamera
  bıraktığın yerde kalır. Otomatik taramaya dönmek için tekrar P.

Xiaomi Home uygulamasındaki kendi **"Hareket takibi"** ayarını **kapat**,
yoksa kamera iki yerden komut alır. Motor kullanılamazsa program sabit kamera
moduna geçer. Motoru hiç kullanmamak için: `--ptz kapali`.

## Nasıl çalışıyor

1. **Hareket algılama (MOG2):** Sabit sahneyi öğrenir; değişen pikselleri bulur.
   Hareketler ekrana kutu olarak çizilmez, sadece sağ üstteki durum yazısı değişir
   (`Bekleniyor` → `HAREKET - yuz araniyor`). İstersen `--hareket-goster`.
2. **Yüz arama (YuNet):** Hareket görülünce OpenCV'nin YuNet yüz modeli çalışır
   (model ilk açılışta otomatik iner, ~230 KB). Hareket bittikten sonra da 1,5 sn
   aramaya devam eder.
3. **Yüz takibi:** Bulunan yüz köşe işaretli çerçeve ve `Yuz 1` etiketiyle
   kareden kareye aynı numarayla izlenir; sağ üstte yakın planı gösterilir.
   Durum `YUZ TAKIP: 1` olur.
4. **Yakalama:** Yeni bir yüz 5 kare boyunca net görülünce fotoğrafı
   `Resimler\KameraTakip` klasörüne kaydedilir (her yüz için bir kez).

| Ek seçenek | Açıklama |
|---|---|
| `--yuz-esik 0.75` | Yüz güven eşiği; yanlış yüz çıkıyorsa yükselt (0.85), kaçırıyorsa düşür (0.6) |
| `--yuz-klasor KLASOR` | Yakalanan yüz fotoğraflarının kaydedileceği yer |
| `--hareket-goster` | Hareket bölgesini ince gri çizgiyle göster |
