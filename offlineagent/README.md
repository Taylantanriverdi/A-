# Offline Agent

Tamamen kendi bilgisayarında çalışan, internet ve API gerektirmeyen yapay zeka asistanı.
Bir kez kurulur; sonrasında hiçbir ücret ya da bağlantı gerekmez.

| Özellik | Ne yapar | Model |
|---|---|---|
| **Genel** | Soru-cevap, yazı, özet, çeviri | `qwen2.5:7b` |
| **Kod** | Programlama yardımı | `qwen2.5-coder:7b` |
| **Ajan** | Dosya okur/yazar, Python ve PowerShell çalıştırır; her riskli işlemde **onayını** ister | `qwen2.5:7b` |
| **Resim anlama** | 📎 ile resim ekle ya da Ctrl+V ile ekran görüntüsü yapıştır, sorunu sor | `gemma3:4b` |
| **Belgelerim** | PDF, Word, Excel, TXT dosyalarından kaynak göstererek cevap verir | `nomic-embed-text` |
| **OCR** | Taranmış PDF ve resim dosyalarındaki yazıyı okuyup belgelere ekler | `gemma3:4b` |
| **Sesle yazma** | 🎤 ile konuş, yazıya çevrilsin | Whisper `small` |
| **Sesli cevap** | Cevapları Windows'un Türkçe sesiyle okur | Windows sesi |
| **Panel düğmesi** | Hekim/Teknisyen/Gelen İşler panellerinde sağ altta asistan düğmesi | — |
| **Kamera** | 📷 ile seni görür, ne yaptığını anlatır, öğrettiğin kişileri tanır | `gemma3:4b` + OpenCV |
| **Canlı mod** | Kamerayı sürekli izler, gördüklerini sesli yorumlar, eller serbest sesli sohbet | `gemma3:4b` + Whisper |
| **Hafıza** | Senin hakkında öğrendiklerini kalıcı olarak hatırlar | — |
| **Ayarlar** | ⚙ ile modeller, hafıza, kişiler ve telefon ayarları; arayüzden model indirme/silme | — |
| **Telefondan erişim** | Aynı Wi-Fi'deki telefondan şifreyle kullanma | — |
| **Sohbet araçları** | Sohbetlerde arama; Word, PDF ve Markdown olarak dışa aktarma | — |

## Kurulum (bir kez, internet gerekir)

**Yol 1: Tek satır.** Başlat menüsünde **PowerShell**'i aç ve şunu yapıştır:

```powershell
irm https://raw.githubusercontent.com/Taylantanriverdi/A-/claude/keen-wozniak-zjal69/offlineagent/kurulum.ps1 | iex
```

Dosyalar `D:\offlineagent` klasörüne iner ve kurulum kendiliğinden başlar.

**Yol 2: Elle.** Bu depodaki `offlineagent` klasörünün içeriğini `D:\offlineagent` klasörüne kopyala ve `KUR.bat` dosyasına çift tıkla.

Kurulum şunları yapar:

1. Ollama'yı kontrol eder, yoksa kurar.
2. Modellerin `D:\offlineagent\modeller` klasöründe saklanmasını ayarlar. Daha önce C: diskine indirilmiş modeller varsa onları buraya kopyalar.
3. Python'u bu klasöre kurar (`araclar\`). Sisteme hiçbir şey eklemez.
4. Gerekli paketleri kurar.
5. Modelleri indirir (yaklaşık 13 GB).
6. Ses modelini indirir (yaklaşık 500 MB).
7. Masaüstüne **Offline Agent** kısayolu ekler. İstersen Windows açılışında otomatik başlatmayı da açar.

Bir adım yarıda kalırsa `KUR.bat`'ı tekrar çalıştır; kaldığı yerden devam eder.

## Günlük kullanım

| Dosya | Ne yapar |
|---|---|
| `BASLAT.bat` (veya masaüstü kısayolu) | Sistemi başlatır ve tarayıcıda `http://127.0.0.1:8765` adresini açar |
| `DURDUR.bat` | Sunucuyu kapatır |
| `GUNCELLE.bat` | Programı, paketleri ve modelleri günceller (internet gerekir) |
| `KUR.bat` | Kurulumu yapar ya da onarır |

**Otomatik güncelleme:** `BASLAT.bat` her açılışta (günde en fazla bir kez) internet olup olmadığına bakar. İnternet varsa program dosyalarını sessizce günceller, yoksa hiçbir şey yapmadan çalışmaya devam eder.

## Belgelerimden cevap

1. Dosyaları arayüze sürükle-bırak yap, **Ekle** düğmesini kullan ya da `D:\offlineagent\belgeler` klasörüne kopyala.
2. Klasöre elle kopyaladıysan **Tara** düğmesine bas. Yeni ve değişen dosyalar işlenir.
3. Üstteki **Belgelerimi kullan** kutusunu işaretle ve sorunu sor. Cevabın altında hangi belgeden alındığı görünür.

Desteklenenler: `.pdf .docx .xlsx .txt .md .csv .json .log` ve resimler (`.png .jpg .jpeg .webp .bmp`). Taranmış PDF sayfaları ve resimlerdeki yazı OCR ile okunur. OCR sayfa başına 10-30 saniye sürebilir; ilerleme sol altta görünür.

## Ajan modu

Üstten **Ajan**'ı seç ve ne istediğini yaz. Örnekler: "Masaüstümdeki dosyaları listele", "Şu Excel'deki toplamları hesaplayan bir Python kodu yaz ve çalıştır", "Disk doluluk durumunu göster".

- **Onaysız çalışan işlemler:** dosya ve klasör okuma, belgelerde arama, tarih/saat.
- **Onay isteyen işlemler:** dosya yazma (sadece `D:\offlineagent\calisma` klasörüne), Python kodu ve PowerShell komutu çalıştırma. Ajan ne yapacağını gösterir; **Onayla** demeden hiçbir şey çalışmaz.
- Kod ve komutlar senin kullanıcı yetkinle çalışır. Onaylamadan önce mutlaka oku, özellikle silme komutlarını.
- Küçük modeller hata yapabilir. Ajan hatayı görünce genelde kendisi düzeltip tekrar dener.

## Kamera ve yüz tanıma

- **📷** düğmesi kamerayı açar. Seni tanıyorsa "👋 Merhaba Taylan" der.
- **Fotoğraf ekle:** O anki görüntüyü mesaja ekler.
- **Ne yapıyorum?:** Görüntüyü gönderir ve ne gördüğünü anlatır.
- **Her mesajda görüntü ekle:** Kamera açıkken yazdığın her mesaja o anki görüntü eklenir; asistan seni görerek cevap verir.
- **Kişi öğretmek:** ⚙ Ayarlar > **Kişiler** > isim yaz > **Kameradan öğret**. 3 saniyede birkaç kare alınır. Farklı ışıkta birkaç kez öğretmek tanımayı güçlendirir.
- **Gizlilik:** Fotoğraf saklanmaz. Sadece yüzün sayısal özeti `veri\yuzler.json` dosyasında tutulur ve bilgisayardan çıkmaz. Başka birini eklemeden önce iznini al.
- Normal modda asistan görüntüyü sadece sen mesaj gönderdiğinde ya da bir düğmeye bastığında görür. Sürekli izlemesi için **Canlı mod**'u aç.

### Canlı mod: izlesin, yorumlasın, konuşsun

Kamera panelindeki **🔴 Canlı izle ve konuş** düğmesine bas. Videonun etrafında kırmızı çerçeve ve **● CANLI** yazısı çıkar.

- **Görür ve yorumlar:** Görüntüde bir değişiklik olduğunda (hareket ettin, biri geldi, eline bir şey aldın) o kareye bakar. Önemli bir şey görürse sesli söyler. Görüntü değişmezse ekran kartını yormaz; yine de 45 saniyede bir kontrol eder.
- **Tanır:** Öğrettiğin biri kameraya girince hemen "Hoş geldin Taylan!" der.
- **Eller serbest konuşma:** "Beni dinle" açıkken konuşmaya başlaman yeterli. Cümlen bitince (1 saniyelik sessizlik) yazıya çevrilir ve o anki görüntüye bakarak kısa, sesli cevap verir. Asistan konuşurken mikrofon kendi sesini duymasın diye beklemeye geçer.
- **Konuşkanlık:** "Az konuşsun" sadece önemli durumlarda (biri geldi, sana bir şey gösteriyorsun), "Ara sıra" yeni ve dikkat çekici değişikliklerde, "Çok konuşsun" sık sık konuşur.
- **Gözlem günlüğü:** Neler gördüğünü saatleriyle listeler. Günlük kaydedilmez; canlı mod kapanınca silinir.

**Gerçekçi beklenti:** 6 GB ekran kartında her bakış 2-5 saniye sürer. Bu yüzden video gibi her anı değil, birkaç saniyede bir kareyi yorumlar. Sesli cevap için Windows'ta Türkçe ses yüklü olmalı. Canlı mod telefonda çalışmaz.

## Hafıza

Offline Agent sohbet ettikçe senin hakkında kalıcı bilgileri öğrenir (adın, işin, tercihlerin gibi) ve sonraki sohbetlerde hatırlar. ⚙ Ayarlar > **Hafıza** bölümünden neleri hatırladığını görebilir, düzeltebilir, silebilir ya da kendin ekleyebilirsin. Otomatik öğrenmeyi Ayarlar > Genel'den kapatabilirsin.

## Telefondan erişim

1. `D:\offlineagent\TELEFON_AC.bat` dosyasını bir kez çalıştır. Yönetici izni ister; Windows güvenlik duvarında izin açar ve Wi-Fi ağının "Özel" olup olmadığını kontrol eder.
2. ⚙ Ayarlar > **Telefon** bölümünde şifre belirle ve **Telefondan erişim açık** kutusunu işaretle. Program kendiliğinden yeniden başlar.
3. Telefonda gösterilen adresi aç ya da QR kodu okut, şifreyle giriş yap.

Telefondan ajan modu, klasör açma ve ayarlar **kapalıdır**. Tarayıcı güvenliği nedeniyle telefonda mikrofon ve canlı kamera çalışmaz; 📷 düğmesi telefonun kamerasıyla fotoğraf çekip gönderir. Bilgisayar açık ve Offline Agent çalışıyor olmalıdır.

## Sohbetleri arama ve dışa aktarma

- Sol üstteki **arama kutusu** sohbet başlıklarında ve içeriklerinde arar.
- Sağ üstteki **⤓** düğmesi açık sohbeti **Word**, **PDF** (yazdır > PDF olarak kaydet) ya da **Markdown** olarak indirir.

## Ses

- **Sesle yazma (🎤):** Bir kez tıkla ve konuş, bitince tekrar tıkla. Konuşman yazıya çevrilir. İlk kullanımda model belleğe yüklendiği için birkaç saniye sürer. Tarayıcı mikrofon izni ister.
- **Sesli cevap:** Windows'ta Türkçe ses yüklü olmalıdır. Yüklü değilse: Ayarlar > Saat ve dil > Konuşma > **Ses ekle** > Türkçe. Sesli cevap açıkken 🎤 ile konuştuğunda mesaj kendiliğinden gönderilir; böylece eller serbest sohbet edebilirsin.

## Panellere asistan düğmesi

Paneller (Hekim Portalı, Teknisyen Paneli, Gelen İşler) herkes tarafından kullanıldığı için düğme **sadece senin açtığın bilgisayarda** görünür:

1. Paneli bu bilgisayarda bir kez adresin sonuna `?asistan=1` ekleyerek aç (ör. `...HekimPortaliMobil.html?asistan=1`).
2. Bundan sonra o tarayıcıda sağ altta **AI** düğmesi çıkar. Kapatmak için `?asistan=0` ile aç.
3. Offline Agent çalışmıyorsa düğme görünmez; panel normal çalışır. Diğer kullanıcılar hiçbir değişiklik görmez.

Gömülü pencerede güvenlik için ajan modu ve dosya yükleme kapalıdır.

## Klasör yapısı

```
D:\offlineagent\
  KUR.bat  BASLAT.bat  GUNCELLE.bat  DURDUR.bat
  ayarlar.json        <- senin ayarların (güncelleme bunu değiştirmez)
  belgeler\           <- senin belgelerin
  calisma\            <- ajanın dosya yazdığı klasör
  TELEFON_AC.bat      <- telefondan erişim için güvenlik duvarı izni
  modeller\           <- yapay zeka modelleri
  veri\               <- belge indeksi ve kayıtlar (sunucu-hata.log)
  araclar\  .venv\    <- Python ve araçlar
  app\  scripts\      <- program dosyaları (güncellemeyle yenilenir)
```

Sohbet geçmişi tarayıcıda saklanır.

## Ayarlar

Çoğu ayar arayüzden değiştirilir: ⚙ **Ayarlar** (sol alt). Aşağıdaki tablo `ayarlar.json` dosyasındaki karşılıklarıdır.

### `ayarlar.json`

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `genel_model` | `qwen2.5:7b` | Sohbet modeli |
| `kod_model` | `qwen2.5-coder:7b` | Kod modeli |
| `gorsel_model` | `gemma3:4b` | Resim anlama ve OCR modeli |
| `ses_modeli` | `small` | Whisper boyutu: `base` daha hızlı, `medium` daha doğru ama yavaş |
| `ses_dili` | `tr` | Konuşma dili (boş bırakılırsa otomatik algılar) |
| `ocr` | `true` | Taranmış PDF ve resimlerden yazı okuma |
| `hafiza` / `otomatik_hafiza` | `true` | Hafıza ve sohbetlerden otomatik öğrenme |
| `yuz_tanima` | `true` | Kamerada yüz tanıma |
| `ag_erisimi` | `false` | Telefondan erişim (Ayarlar > Telefon'dan açılır) |
| `embed_model` | `nomic-embed-text` | Belge arama modeli |
| `baglam_uzunlugu` | `8192` | Modelin aynı anda aklında tutabileceği metin miktarı. Ekran kartı belleği yetmezse `4096` yap |
| `port` | `8765` | Arayüz adresi |
| `otomatik_guncelleme` | `true` | Açılışta günde bir güncelleme kontrolü |
| `guncelleme_dali` | `claude/keen-wozniak-zjal69` | Güncellemelerin alındığı GitHub dalı |

Model değiştirmek için ilgili satırı düzenle (ör. `"genel_model": "gemma3:4b"`) ve `BASLAT.bat`'ı çalıştır. Eksik model internet varsa otomatik indirilir.

## Sorun giderme

- **Arayüzde "Ollama çalışmıyor" yazıyor:** Başlat menüsünden Ollama'yı aç ya da `BASLAT.bat`'ı tekrar çalıştır.
- **Cevaplar çok yavaş geliyor:** PowerShell'de `ollama ps` yaz. `PROCESSOR` sütunu `100% GPU` değilse `baglam_uzunlugu` değerini `4096` yap.
- **Sunucu açılmıyor:** `veri\sunucu-hata.log` dosyasına bak.
- **Gizlilik:** Sunucu yalnızca `127.0.0.1` adresinde dinler, yani başka cihazlardan erişilemez. Hiçbir veri internete gönderilmez.
