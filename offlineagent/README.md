# Offline Agent

Tamamen kendi bilgisayarında çalışan, internet ve API gerektirmeyen yapay zeka asistanı.
Bir kez kurulur; sonrasında hiçbir ücret ya da bağlantı gerekmez.

| Özellik | Ne yapar | Model |
|---|---|---|
| **Genel** | Soru-cevap, yazı, özet, çeviri | `qwen2.5:7b` |
| **Kod** | Programlama yardımı | `qwen2.5-coder:7b` |
| **İş yaptırma** | "Masaüstüne klasör oluştur", "Excel'i aç" dediğinde kendisi yapar; riskli işlerde **onayını** ister | `qwen2.5:7b` |
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

## Dosyalarım: sormadan her işi yapan klasör

Kontrol etmesini istediğin her şeyi `D:\offlineagent\dosyalar` klasörüne koy: sol menüdeki **📂 Dosyalarım > Ekle** düğmesi, dosyaları pencereye sürükle-bırak ya da klasöre Gezgin'den kopyala. Her tür dosya olur (pdf, Word, Excel, resim, kod, zip...).

**Sohbete dosya vermek:** mesaj kutusundaki **📎** düğmesiyle pdf, Word, Excel gibi dosyaları seç (ya da pencereye sürükle). Dosya Dosyalarım'a kaydedilir, mesaja eklenir ve asistan gönderir göndermez okur. İstersen yanına "bunun toplamını çıkar" gibi bir istek yaz; boş gönderirsen özetler.

Bu klasörün içinde asistan **hiç onay sormadan** her işi yapar: okur, içinde arar, yeni dosya yazar, düzenler/üzerine yazar, yeniden adlandırır, alt klasörlere taşır, kopyalar, siler (Geri Dönüşüm Kutusu'na, geri alınabilir).

Örnekler:
- "Dosyalarımda ne var?"
- "Hangi dosyada 'Ahmet Yılmaz' geçiyor?" (dosyaların içinde arar: pdf, docx, xlsx, txt, kod)
- "fatura.pdf'i oku ve toplam tutarı söyle"
- "PDF'leri Faturalar klasörüne, Excel'leri Tablolar klasörüne taşı"
- "notlar.txt'nin sonuna bugünün özetini ekle" / "eski taslakları sil"

Kurallar:
- Göreli yollar (ör. `rapor.txt`, `Faturalar/ocak.pdf`) bu klasöre göredir.
- **Python ve PowerShell** her yerde onay ister: kod çalışınca bir klasörle sınırlanamaz, bütün bilgisayara dokunabilir.
- Klasörün dışındaki silme/taşıma/üzerine yazma önceki gibi onay ister.
- İstersen Ayarlar > Genel > "Dosyalar klasöründe onay sorma" kutusundan bu serbestliği kapatabilirsin.
- Eski sürümlerdeki `calisma` klasörü varsa ilk açılışta `dosyalar` olarak taşınır.
- Klasörü `dosyalarım` adıyla kendin oluşturduysan (`D:\offlineagent\dosyalarım`) otomatik olarak o kullanılır. Başka bir yer istersen `ayarlar.json`'a `"dosyalar_klasoru": "E:\\Arsiv"` yaz ve BASLAT.bat'ı çalıştır.

## Belgelerimden cevap

1. Dosyaları arayüze sürükle-bırak yap, **Ekle** düğmesini kullan ya da `D:\offlineagent\belgeler` klasörüne kopyala.
2. Klasöre elle kopyaladıysan **Tara** düğmesine bas. Yeni ve değişen dosyalar işlenir.
3. Üstteki **Belgelerimi kullan** kutusunu işaretle ve sorunu sor. Cevabın altında hangi belgeden alındığı görünür.

Desteklenenler: `.pdf .docx .xlsx .txt .md .csv .json .log` ve resimler (`.png .jpg .jpeg .webp .bmp`). Taranmış PDF sayfaları ve resimlerdeki yazı OCR ile okunur. OCR sayfa başına 10-30 saniye sürebilir; ilerleme sol altta görünür.

## Bilgisayarda iş yaptırma

Ayrı bir mod seçmen gerekmez: **Genel** modda ne istediğini yazman (ya da canlı modda söylemen) yeterli, asistan işi kendisi yapar.

Örnekler:
- "Masaüstüne Siparişler 2026 isimli klasör oluştur"
- "Hesap makinesini aç" / "Excel'i aç" / "İndirilenler klasörünü aç"
- "PrimerLab'ı aç", "Blender'ı başlat": programı masaüstünde, Başlat menüsünde ve D/E/F sürücülerinde kendisi bulup açar
- "Ekim faturasını bul": dosyayı adından arar
- "İndirilenler'deki PDF'leri Belgeler/Faturalar klasörüne kopyala"
- "Masaüstündeki eski.txt dosyasını sil"
- "Disk doluluk durumunu göster"
- "Şu Excel'deki toplamları hesapla" (Python ile)

Masaüstü, Belgeler ve İndirilenler klasörlerinin gerçek yerini bilir (OneDrive'a taşınmış masaüstü dahil).

**Onay:** Dosyalarım klasörünün içinde hiçbir şey sorulmaz (Python/PowerShell hariç). Diğer yerlerde: klasör oluşturma, kopyalama, uygulama/klasör/belge açma ve okuma işlemleri hemen yapılır. **Silme** (Geri Dönüşüm Kutusu'na), **taşıma**, **üzerine yazma**, **program dosyası başlatma**, **Python** ve **PowerShell** için ne yapacağını gösterip onayını bekler. Ayarlar > Genel > "İşlem onayı" ile her işlemde sormasını seçebilirsin.

Küçük model bazen işi yapmak yerine "şu komutu çalıştırın" gibi talimat yazmaya kalkar. Offline Agent bunu fark edip o cevabı geri alır ve işi yaptırır. Sık istekler (klasör oluşturma, uygulama açma) modele bile sorulmadan anında yapılır.

## Klasör izleme ve bildirim

"Taylan klasörünü 30 saniyede bir kontrol et, yeni gelen klasörleri bana bildir" gibi bir şey yazman yeterli:

- Klasörü adından bulur (Masaüstü, Belgeler, İndirilenler, D/E/F sürücüleri) ya da tam yolu kullanır.
- Arka planda belirttiğin aralıkla (en az 5 sn) bakar; **yeni gelen her öğeyi bir kez** bildirir.
- Sadece klasörleri, sadece dosyaları ya da hepsini izleyebilir.
- Bildirim sağ üstte çıkar. Sol alttaki **"🔔 Windows bildirimlerini aç"** düğmesine bir kez basarsan, pencere arkadayken de Windows bildirimi gelir. "Sesli cevap" açıksa sesli okur.
- İzlenen klasörler sol taraftaki **"İzlenen klasörler"** bölümünde görünür; ✕ ile durdurulur ya da "Taylan klasörünü izlemeyi bırak" yazabilirsin.
- Sadece içine bakar, hiçbir şeyi değiştirmez. Offline Agent açık olduğu sürece çalışır; yeniden açılınca kaldığı yerden devam eder ve kapalıyken gelenleri de bildirir.

## PrimerLab'ı kontrol etme

> **Şimdilik kapalı.** Açmak için ⚙ Ayarlar > Genel > **PrimerLab bağlantısı**.

PrimerLab **V56 veya sonrası** aynı bilgisayarda kuruluysa Offline Agent onu yönetebilir. Yazman ya da canlı modda söylemen yeterli:

- "Geciken işler hangileri?" / "Bugün teslim edilecekler"
- "Dr. Ayşe'nin bakiyesi ne kadar?" / "Bu ayın cirosu?"
- "İş 12'yi üretime al" / "İş 15'e Mehmet'i ata"
- "Dr. Ayşe'den 5000 TL nakit tahsilat ekle"

Laboratuvarla ilgili sorular doğrudan PrimerLab'daki **Primer AI**'a gider; o da veritabanından cevap verir. **Veri değiştiren her işlem onay kartı olarak gelir**: "Onayla" demeden hiçbir şey değişmez; "Reddet" dersen o işlem atlanır.

Sol alttaki Sistem bölümünde **"PrimerLab V56 bağlı"** yazıyorsa bağlantı hazırdır. "PrimerLab kapalı" yazıyorsa masaüstündeki Primer Lab kısayoluyla PrimerLab'ı aç.

Bağlantı PrimerLab'ın ilk açılışta oluşturduğu `C:\PrimerLab\Uygulama\App_Data\Secrets\offline-agent.anahtar` dosyasıyla kurulur ve sadece bu bilgisayardan çalışır. PrimerLab başka bir klasördeyse `ayarlar.json` içindeki `primerlab_anahtar` ve `primerlab_adresi` değerlerini değiştir.

## PrimerLab (web sürümü) yapay zekası

PrimerLab'ın web sürümündeki **AI Mail Analizi** ve **Yardım Asistanı**, OpenAI yerine bu bilgisayardaki modeli kullanabilir (PrimerLab Ayarlar > Yapay zeka: "Offline Agent").

**En kolayı:** PrimerLab `.html` dosyasını İndirilenler'e ya da `D:\offlineagent` içine koy ve **`PRIMERLAB_AC.bat`**'a çift tıkla. Dosyayı bulur, `uygulamalar` klasörüne koyar, gerekirse Offline Agent'ı başlatır ve PrimerLab'ı `http://localhost:8766/PrimerLab.html` adresinden açar. Bu adresten açılan PrimerLab yapay zekayı doğrudan kullanır; hiçbir siteye izin açılmaz. Bu adres Offline Agent arayüzünden ayrıdır, oradan bilgisayarı yöneten işlemlere erişilemez ve sadece bu bilgisayardan açılabilir. Kendi başka web programlarını da `uygulamalar` klasörüne koyup `http://localhost:8766` adresinden açabilirsin.

**Site olarak (GitHub Pages) kullanıyorsan:** ollama güvenlik gereği internet sitelerine kapalıdır. PrimerLab'ın yayınlandığı siteye izin vermek için bir kez **`PRIMERLAB_BAGLA.bat`**'ı çalıştır: siteye izin verir, Ollama'yı yeniden başlatır ve bağlantıyı dener. Varsayılan site depo sahibinin `https://<ad>.github.io` adresidir; farklıysa `ayarlar.json`'a `"izinli_siteler": ["https://site.adresi"]` yaz. Sadece listedeki siteler izin alır. Bilgisayarda çift tıklanarak açılan `.html` dosyaları bağlanamaz, site adresini kullan.

## Ekran izleme

Yazı kutusunun yanındaki **🖥** düğmesine bas ve paylaşılacak ekranı seç. Offline Agent ekranına **belirli aralıklarla** (varsayılan 10 saniyede bir) bakar:

- **Önemli bir şey görürse söyler:** hata mesajı, uyarı, biten bir işlem, onay bekleyen bir iş gibi. "Sesli söyle" açıksa sesli okur.
- **Ekran değişmediyse** modeli çalıştırmaz; bilgisayarı boşuna yormaz.
- **"Ekranda ne var?", "Bu hata ne demek?"** gibi sorularda o anki ekran görüntüsü soruya eklenir.
- **Ekran günlüğü** neler gördüğünü saatleriyle listeler; kaydedilmez.
- **Sadece bakar ve söyler, bilgisayarda kendi başına işlem yapmaz.** Bir şey yapılacaksa sen söylersin.
- Tarayıcının "Paylaşılıyor" göstergesi izleme sürdükçe açık kalır. **⏹ Durdur** ya da tarayıcının "Paylaşımı durdur" düğmesiyle biter.

Offline Agent penceresini simge durumuna küçültme; başka pencerelerin arkasında kalabilir. Görüntüler kaydedilmez ve bilgisayardan çıkmaz.

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

Telefondan bilgisayarda iş yaptırma, klasör açma ve ayarlar **kapalıdır**. Tarayıcı güvenliği nedeniyle telefonda mikrofon ve canlı kamera çalışmaz; 📷 düğmesi telefonun kamerasıyla fotoğraf çekip gönderir. Bilgisayar açık ve Offline Agent çalışıyor olmalıdır.

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

Gömülü pencerede güvenlik için bilgisayarda iş yaptırma ve dosya yükleme kapalıdır.

## Klasör yapısı

```
D:\offlineagent\
  KUR.bat  BASLAT.bat  GUNCELLE.bat  DURDUR.bat
  ayarlar.json        <- senin ayarların (güncelleme bunu değiştirmez)
  belgeler\           <- senin belgelerin
  dosyalar\           <- Dosyalarım: içinde asistan sormadan her işi yapar
  TELEFON_AC.bat      <- telefondan erişim için güvenlik duvarı izni
  PRIMERLAB_AC.bat    <- PrimerLab'ı yapay zekayla aç (localhost:8766)
  PRIMERLAB_BAGLA.bat <- PrimerLab sitesine yerel yapay zeka izni
  uygulamalar\        <- kendi web programların (.html)
  modeller\           <- yapay zeka modelleri
  veri\               <- belge indeksi ve kayıtlar (sunucu-hata.log)
  araclar\  .venv\    <- Python ve araçlar
  app\  scripts\      <- program dosyaları (güncellemeyle yenilenir)
```

Sohbet geçmişi tarayıcıda saklanır.

## Daha iyi model: qwen3:8b

16 GB RAM ve 6 GB ekran kartı için önerilen sohbet modeli **`qwen3:8b`**. İş yapmada (araç kullanma) ve mantıkta `qwen2.5:7b`'den belirgin şekilde iyidir.

1. ⚙ Ayarlar > **Modeller** > öneriler arasından `qwen3:8b`'ye tıkla > **İndir** (~5 GB, internet gerekir).
2. İndirme bitince "kullanılsın mı?" sorusuna **Tamam** de. (Ya da listede modelin yanındaki **Kullan** düğmesi.)
3. Hızlı cevap için "Düşünerek cevapla" kapalı kalsın (varsayılan). Zor sorularda Ayarlar > Genel'den açabilirsin; daha akıllı ama daha yavaş olur.

Modeller 30 dakika boyunca bellekte tutulur; böylece her soruda yeniden yüklenmezler.

## Akıl seviyesi

Ayarlar > Genel > **Akıl seviyesi**:
- **Hızlı**: hiç düşünmeden hemen cevaplar.
- **Akıllı (önerilen)**: basit isteklerde hızlı; hesap, karşılaştırma, analiz, plan, "neden" gibi zor sorularda cevaptan önce düşünür. Düşünürken mesajda "🧠 Düşünüyor…" görünür.
- **Maksimum**: her soruda önce düşünür. En mantıklı cevaplar, ama belirgin şekilde daha yavaş.

Düşünme qwen3 ve deepseek-r1 gibi modellerde çalışır.

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
| `dosyalar_serbest` | `true` | Dosyalarım klasöründe onay sormadan çalışma |
| `dosyalar_klasoru` | (boş) | Dosyalarım klasörünün yeri. Boşsa `dosyalarım` varsa o, yoksa `dosyalar` |
| `akil_seviyesi` | `otomatik` | `hizli`, `otomatik` (zor sorularda düşünür) ya da `maksimum` |
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
