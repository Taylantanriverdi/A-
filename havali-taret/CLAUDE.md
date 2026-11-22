# Havalı Hedef Tareti — Proje Kuralları

Bu klasördeki tüm çalışmalar (kod, donanım notları, belgeler) bu kurallara uyar.
Kurallar hem insan geliştiriciler hem de Claude için bağlayıcıdır.

## 1. Amaç ve kapsam
- Proje, **kağıt hedef / teneke / gong** gibi cansız hedeflere atış yapan,
  kameralı ve bilgisayardan nişan alınan bir **hobi atış tareti**dir.
- Hedef **asla** insan veya hayvan değildir. Bu amaca yönelik özellik eklenmez.

## 2. Kesin yasaklar (istisnasız)
- **Otomatik ateş yok.** Atış her zaman bir insanın ekranda bilerek bastığı
  tetik komutuyla olur. Yazılım kendi başına ateşleyemez.
- **İnsan/yüz/hayvan algılayıp takip etme yok.** Görüntü işleme yalnızca
  renkli hedef kağıdı veya ArUco/QR işaretçisi tanımak için kullanılır.
- **İnternete açık kontrol yok.** Arayüz yalnızca yerel ağda (LAN) çalışır;
  port yönlendirme, bulut erişimi, uzaktan tünel kurulmaz.
- **Ev yapımı basınç tankı yok.** PVC boru, pet şişe, kaynaklı/onaysız kap
  basınç haznesi olarak kullanılmaz. Yalnızca basınç sertifikalı parçalar.
- **Ölümcül mermi yok.** Metal bilye, çivi, cıvata vb. atılmaz. Yalnızca
  airsoft BB (6 mm), paintball/pepperball-benzeri boya topu veya köpük dart.

## 3. Enerji ve basınç sınırları
- Taret girişinde **regülatör** zorunlu; namlu tarafı basıncı varsayılan
  **2 bar**, en fazla **4 bar**. Kompresörün 8 barı doğrudan namluya verilmez.
- Regülatörden sonra **emniyet ventili** (açma basıncı ≤ 4,5 bar) bulunur.
- Hedef çıkış enerjisi **≤ 1 J** (airsoft sınıfı). Değişiklikten sonra
  kronograf ile ölçülür ve `OLCUMLER.md` dosyasına yazılır.
- Yerel mevzuat (Türkiye’de 6136 sayılı Kanun ve havalı silah yönetmeliği)
  kontrol edilir; sınırı aşan bir tasarım yapılmaz.

## 4. Zorunlu güvenlik donanımı
- Fiziksel **acil stop butonu**: hem selenoid valf gücünü hem de motor
  gücünü donanımsal olarak keser (yazılıma bağlı değildir).
- Fiziksel **emniyet anahtarı (arming switch)**: kapalıyken valf rölesi
  enerjilenemez. Yazılım "SİLAHLI" durumunu ancak bu anahtar açıksa gösterir.
- **Hava boşaltma vanası**: bakımdan önce sistem sıfır basınca indirilir.
- **Mekanik dönüş sınırları**: pan/tilt, atış alanı dışına (yukarı, yanlara)
  dönemeyecek şekilde fiziksel stoplarla sınırlanır; yazılım sınırları buna ek.
- Atış alanının arkasında **mermi tutucu (backstop)** bulunur.

## 5. Yazılım kuralları
- Varsayılan durum **EMNİYETTE**. Program her açılışta, bağlantı koptuğunda
  veya hata olduğunda EMNİYET durumuna döner.
- **Heartbeat**: arayüzden 500 ms boyunca sinyal gelmezse mikrodenetleyici
  valfi kapatır ve motorları durdurur.
- Tetik komutu = tek atış, valf açık kalma süresi kodda **sabit üst sınır**
  (ör. en fazla 80 ms). Seri atış için ayrı ve sınırlı bir mod gerekir.
- Ateş komutu iki adımlıdır: `ARM` (silahla) → `FIRE` (ateş). `ARM` 10 sn
  içinde kullanılmazsa kendiliğinden düşer.
- Her `ARM`/`FIRE`/`ESTOP` olayı zaman damgasıyla `logs/` altına kaydedilir.
- Arayüz parola ile korunur; varsayılan parola kodda bırakılmaz.

## 6. Kullanım kuralları
- Atış sırasında alanda kimse bulunmaz; çevredekiler göz koruyucu takar.
- Taret kullanılmadığında: emniyet anahtarı kapalı, hava boşaltılmış,
  şarjör boş.
- Çocukların erişebileceği yerde basınçlı bırakılmaz.

## 7. Belgeleme kuralları (bu klasördeki .md dosyaları için)
- Tüm belgeler **Türkçe** yazılır; teknik terimin İngilizcesi parantezde verilir.
- Her donanım değişikliği `REHBER.md` içindeki ilgili bölüme ve parça
  listesine işlenir.
- Basınç/enerji ölçümleri `OLCUMLER.md` dosyasında tablo olarak tutulur:
  tarih, basınç (bar), mermi tipi/ağırlık, hız (m/s), enerji (J).
- Bir değişiklik bu dosyadaki bir kuralı gevşetiyorsa **yapılmaz**; kural
  değişikliği ayrı ve gerekçeli bir commit ile tartışılır.
