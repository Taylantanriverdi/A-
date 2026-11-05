# DIGICAD Dental — Yerel Sunucu Kurulumu

Bu klasör, DIGICAD Dental Laboratuvar Yönetim Sistemi'ni **Firebase olmadan,
laboratuvardaki Windows bilgisayarında** çalıştırır. Bütün veriler ve dosyalar
(STL, fotoğraf, PDF) bu bilgisayarda durur.

## Neler değişti, neden daha güvenli?

| Eskiden (Firebase + GitHub Pages) | Şimdi (yerel sunucu) |
|---|---|
| Hekim portalı, giriş için **tüm hekimlerin şifrelerini** tarayıcıya indiriyordu. Sayfa kaynağına bakan herkes görebiliyordu. | Şifre **sunucuda** kontrol ediliyor. Hiçbir şifre tarayıcıya gönderilmiyor. |
| Hekim, teknisyen ve laboratuvarın tüm verileri her portala iniyor, süzme tarayıcıda yapılıyordu. | Hekim **sadece kendi işlerini**, teknisyen **sadece kendine atanan işleri** alıyor. Süzme sunucuda yapılıyor. |
| Oturum tarayıcı belleğindeki bir kimlik numarasıydı. Numarayı değiştiren başka bir hekim gibi görünebiliyordu. | Oturum, sunucunun verdiği tahmin edilemez, şifreli bir çerez. |
| Yönetici şifresi (4 hane) veritabanında açık metin olarak duruyordu ve sınırsız deneme yapılabiliyordu. | PIN şifrelenmiş olarak saklanıyor. 5 hatalı denemede 15 dakika kilit. |
| Yönetim paneline internetteki herkes ulaşabiliyordu. | Yönetim paneline **sadece laboratuvar ağından** girilebiliyor. İnternete açılan kapıda bu sayfa hiç yok. |
| Dosya bağlantısını bilen herkes dosyayı indirebiliyordu. | Dosyaları sadece giriş yapmış kullanıcılar indirebiliyor. |
| Veriler Google sunucularındaydı. | Veriler bu bilgisayarda. Her gün otomatik yedek alınıyor. |

---

## 1. Kurulum (bir kez yapılır)

1. **Node.js kurun:** https://nodejs.org adresinden **LTS** sürümünü indirip
   "Next, Next" ile kurun.
2. **Bu klasörü** (`digicad-yerel`) bilgisayarda kalıcı bir yere kopyalayın,
   örneğin `C:\DIGICAD`. Masaüstüne veya İndirilenler klasörüne koymayın.

## 2. Verileri Firebase'den aktarın (bir kez yapılır)

1. `Firebase-Aktar.bat` dosyasına çift tıklayın.
2. Program Firebase'deki bütün kayıtları ve dosyaları indirir. Dosya sayısına
   göre birkaç dakika sürebilir.
3. Sonunda hekim, iş ve dosya sayılarını gösterir. Kontrol edin.
4. Eski 4 haneli yönetici şifreniz yeni sistemin PIN'i olarak aktarılır.

**Otomatik indirme çalışmazsa:** Firebase konsolunda
(https://console.firebase.google.com → primer-dental → Realtime Database)
sağ üstteki **⋮ → JSON'u dışa aktar** seçeneğine tıklayın. İnen dosyayı bu
klasöre koyun ve komut isteminde şunu çalıştırın:

```
node araclar\firebase-aktar.js indirdiginiz-dosya.json
```

**Primer Teknoloji verileri:** Primer Teknoloji çalışma alanı eskiden sadece
tarayıcı belleğinde duruyordu, Firebase'de değildi. Bu verileri de taşımak için:

1. Eski sitede Primer Teknoloji'yi açın ve **Ayarlar → ⬇️ Yedek İndir (.json)** ile JSON
   dosyasını alın.
2. Aktarımı şu şekilde çalıştırın:

```
node araclar\firebase-aktar.js --primer DIGICAD_yedek_XXXX.json
```

> Aktarımı bir kez daha yapmanız gerekirse sonuna `--uzerine-yaz` ekleyin.
> Mevcut yerel veri önce otomatik olarak yedeklenir.

## 3. Sunucuyu başlatın

`Baslat.bat` dosyasına çift tıklayın. Açılan siyah pencere **sunucunun kendisi**.
Bu pencere açık kaldığı sürece sistem çalışır.

- PIN daha önce belirlenmediyse, ilk açılışta 4 haneli bir PIN sorulur.
- Windows Güvenlik Duvarı izin isterse **sadece "Özel ağlar"** kutusunu
  işaretleyip izin verin.

Tarayıcıda açılacak adresler:

| Sayfa | Adres |
|---|---|
| Ana sayfa (tüm paneller) | http://localhost:8080 |
| Yönetim paneli | http://localhost:8080/PrimerLab.html |
| Gelen İşler paneli | http://localhost:8080/GelenIslerPaneli.html |

**Laboratuvardaki başka bir bilgisayar veya tabletten** girmek için
`localhost` yerine bu bilgisayarın IP adresini yazın. Örnek:
`http://192.168.1.20:8080`. IP adresini öğrenmek için komut isteminde
`ipconfig` yazın ve "IPv4 Adresi" satırına bakın.

## 4. Hekimlerin dışarıdan bağlanması (Tailscale Funnel)

Hekimler muayenehanelerinden iş gönderebilsin diye bilgisayarı internete
**güvenli bir tünelle** açıyoruz. Modeminizde port açmanız gerekmez. Ücretsizdir
ve sabit bir `https://` adresi verir.

1. https://tailscale.com/download adresinden Windows sürümünü kurun ve bir
   hesapla (ör. Google hesabınız) giriş yapın.
2. **Komut İstemi'ni yönetici olarak** açın ve şunu yazın:

   ```
   tailscale funnel --bg 8081
   ```

3. İlk seferde ekranda bir bağlantı çıkar. Bağlantıyı açıp "HTTPS" ve
   "Funnel" özelliklerini onaylayın, sonra komutu tekrar çalıştırın.
4. Ekranda şuna benzer bir adres görünür:
   `https://digicad-pc.tail1234.ts.net`. Hekimlere vereceğiniz adres:

   ```
   https://digicad-pc.tail1234.ts.net/HekimPortali.html
   ```

   Teknisyenler için `/TeknisyenPaneli.html`.

> ⚠️ Tünel **mutlaka 8081'e** yönlendirilmeli, **8080'e değil**. 8081 sadece
> Hekim ve Teknisyen portallarını sunar. Yönetim paneli bu kapıdan açılmaz,
> açılmaya çalışılırsa sunucu girişi reddeder.

`--bg` seçeneği sayesinde tünel bilgisayar yeniden başladığında da kendiliğinden
açılır. Kapatmak için: `tailscale funnel reset`

*Alternatif:* Kendi alan adınız varsa (ör. `digicaddental.com`) Cloudflare
Tunnel ile `https://portal.digicaddental.com` gibi bir adres de
kullanılabilir. Burada da tünel `http://localhost:8081` adresine
yönlendirilmeli.

## 5. Sunucuyu arka planda çalıştırın (pencere açık kalmasın)

`Baslat.bat` ile açılan siyah pencere kapatılırsa sistem durur. Bu pencerenin
sürekli açık kalmaması için sunucuyu bir kez arka plana kurun:

1. `Baslat.bat` ile açtığınız siyah **sunucu penceresini kapatın**.
2. **`Arka-Plan-Kur.bat`** dosyasına çift tıklayın. Windows izin isterse
   **Evet** deyin.
3. Ekranda "Sunucu CALISIYOR" yazısını görünce pencereyi kapatabilirsiniz.

Bundan sonra:

- Sunucu **pencere olmadan** arka planda çalışır.
- Bilgisayar açıldığında, **kimse Windows'a giriş yapmasa bile** kendiliğinden
  başlar.
- Bir hata olup kapanırsa birkaç saniye içinde kendini yeniden başlatır.
- `Baslat.bat` dosyasını artık kullanmayın. Başlangıç klasörüne (`shell:startup`)
  onun kısayolunu koyduysanız silin.

Arka plan sunucusunu yönetmek için şu dosyaları kullanın:

| Dosya | Ne yapar |
|---|---|
| `Sunucu-Durumu.bat` | Sunucu çalışıyor mu, gösterir |
| `Sunucuyu-Yeniden-Baslat.bat` | Güncelleme sonrası ya da sorun olduğunda yeniden başlatır |
| `Sunucuyu-Durdur.bat` | Sunucuyu durdurur. Bilgisayar yeniden açılınca tekrar başlar |
| `Arka-Plan-Kaldir.bat` | Arka plan kurulumunu tamamen kaldırır. Sonra `Baslat.bat` ile eski yönteme dönülür |

Sunucunun ekran çıktıları `veri\sunucu.log` dosyasına yazılır.

Tailscale tarafında da **Preferences → Run unattended** seçeneğinin işaretli
olduğundan emin olun. Böylece tünel de Windows'a giriş yapılmadan açılır.
Tailscale komutlarını çalıştırdığınız yönetici penceresi kapatılabilir, tünel
arka planda çalışmaya devam eder.

Bilgisayarın uyku moduna girmemesi gerekir:
**Ayarlar → Sistem → Güç → Ekran ve uyku → "Uyku: Hiçbir zaman"**.

## 6. Yedekleme

- Sunucu her gün `veri\yedekler\` klasörüne veritabanının bir kopyasını alır
  ve son 60 günü saklar.
- **Bilgisayar bozulursa verileri kaybetmemek için** ikinci bir yere de yedek
  alın. Bunun için `veri\ayarlar.json` dosyasını Not Defteri ile açın ve
  harici disk ya da ağ klasörünü yazın:

  ```json
  "yedekKlasoru": "E:\\DIGICAD-Yedek",
  ```

  Sunucuyu yeniden başlatın. Bundan sonra her gün veritabanı ve tüm dosyalar
  bu klasöre de kopyalanır.
- Yönetim panelindeki "otomatik yedek klasörü" özelliği de çalışmaya devam eder.

**Tüm veriler `veri\` klasöründedir.** Bilgisayar değiştirirken bu klasörü
yeni bilgisayara kopyalamanız yeterlidir.

## 7. Firebase'i kapatın (yeni sistem sorunsuz çalıştıktan sonra)

Yeni sistemi birkaç gün kullanıp verilerin eksiksiz olduğundan emin olduktan
sonra:

1. **Firebase konsolu → Realtime Database → Kurallar** bölümünü şöyle
   değiştirip Yayınla'ya basın:

   ```json
   { "rules": { ".read": false, ".write": false } }
   ```

2. **Storage → Kurallar** bölümünde de bütün erişimi kapatın:

   ```
   rules_version = '2';
   service firebase.storage { match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if false; } } }
   ```

3. **Authentication → Sign-in method** bölümünde **Anonymous** girişi kapatın.
4. Sonra Realtime Database ve Storage'daki verileri silin. İsterseniz projeyi
   tamamen silin.
5. GitHub'da `dental-lab` deposu için iki seçenekten birini uygulayın:
   **Settings → Pages** bölümünden yayını kapatın, ya da depoyu **Private**
   yapın. Böylece eski site de kapanır.
6. OpenAI veya Gmail anahtarlarını eski sitede kullandıysanız, ilgili
   hesaplardan bu anahtarları **iptal edip yenileyin**.

## Veri Aktarımı sayfası (eski sistemden kopyalama ve tam yedek)

Yönetim panelinde **Ayarlar → 🔄 Eski Sistemden Veri Aktar / Tam Yedek**
düğmesiyle ya da doğrudan http://localhost:8080/VeriAktarimi.html adresinden
açılır. Bu sayfadan şunları yapabilirsiniz:

- **Firebase'den doğrudan al:** Eski sistemdeki DIGICAD verisinin güncel hâlini
  çeker. Hasta ve iş kayıtları, hekimler, teknisyenler, kasa (ödemeler, giderler,
  satışlar), arşiv (hesap kapanışları), mesajlar ve dosyaların hepsi gelir.
- **Yedek dosyasından al:** Eski sistemde **Ayarlar → ⬇️ Yedek İndir (.json)**
  ile alınan dosya, Firebase konsolundan dışa aktarılan JSON ya da bu sistemin
  kendi tam yedeği. Primer Teknoloji verileri yalnızca bu yolla aktarılabilir.
- Aktarımı başlatmadan önce **neyin ekleneceğini tabloda görürsünüz**.
- **Sadece eksikleri ekle** (önerilen) seçeneği yalnızca yeni sistemde olmayan
  kayıtları ekler. Yeni sistemde yaptığınız değişikliklere dokunulmaz.
- **Tamamen değiştir** seçeneği, çalışma alanındaki tüm veriyi yedektekiyle
  değiştirir.
- Her aktarımdan önce `veri\yedekler\` klasörüne otomatik yedek alınır.
- **Tam yedeği indir** düğmesi, yeni sistemdeki tüm kayıtları tek bir dosya
  olarak indirir.

## Eski sistemin (Firebase) tam yedeği

Yönetim paneli → **Ayarlar → 🔄 Eski Sistemden Veri Aktar** sayfasındaki
**📥 Firebase'in tam yedeğini al** düğmesi eski sistemi bu bilgisayara yedekler.
Aynı işlemi `Firebase-Yedek-Al.bat` dosyasıyla da yapabilirsiniz.

- **Firebase'deki veriler değiştirilmez.** Yazılım eski sisteme yalnızca
  okuma (GET) isteği gönderir. Yazma, silme ve değiştirme istekleri kod
  içinde engellenir (`lib/firebase-okuyucu.js`).
- Yedek `veri\firebase-yedekleri\<tarih-saat>\` klasörüne alınır:
  - `veritabani.json`: Firebase'in gönderdiği veri, hiç değiştirilmeden
  - `dosyalar\`: Firebase'deki tüm dosyalar, aynı klasör yapısıyla
  - `dosya-listesi.json`: Her dosyanın boyutu ve SHA-256 özeti
  - `OZET.txt`: Kaç hekim, iş, ödeme ve dosya olduğu
- Yedek klasöründeki dosyalar **salt-okunur** işaretlenir.
- **Yeni sisteme yükle** düğmesi yedeği internete ve Firebase'e hiç
  bağlanmadan yükler. Dosyalar yedekten kopyalanır, yedeğin kendisine
  dokunulmaz. Yüklemeden önce yedeğin bozulmadığı SHA-256 ile kontrol edilir.
- Bu yedeği USB belleğe ya da harici diske de kopyalayın. Firebase
  kapatıldıktan sonra eski sistemin elinizdeki tek tam kopyası budur.

## Yazılımı güncelleme (otomatik)

Güncellemeleri `DIGICAD-Guncelle.bat` dosyası sizin yerinize yapar.

**Her güncellemede:**

1. Yeni `digicad-yerel.zip` dosyasını indirin. İndirilenler klasöründe kalsın,
   açmanıza gerek yok.
2. Masaüstündeki **DIGICAD-Guncelle** dosyasına çift tıklayın. Windows izin
   isterse **Evet** deyin.
3. Ekranda yeşil **"GÜNCELLEME TAMAMLANDI"** yazısı çıkınca pencereyi kapatın.

`DIGICAD-Guncelle.bat` şunları yapar:

- İndirilenler klasöründeki **en yeni** `digicad-yerel*.zip` dosyasını bulur.
- Paketteki her dosyayı SHA-256 ile kontrol eder. Eksik ya da bozuk dosya
  varsa **hiçbir şeyi değiştirmeden** durur.
- Mevcut programı `veri\program-yedekleri\` klasörüne yedekler. Son 5 yedek
  saklanır.
- Sunucuyu durdurur ve yeni dosyaları `C:\digicad-yerel` klasörüne kopyalar.
  **`veri` klasörüne (kayıtlarınıza) dokunmaz.**
- Sunucuyu arka planda yeniden başlatır ve çalıştığını kontrol eder.
- **Sunucu açılmazsa eski sürümü otomatik olarak geri yükler.**

**İlk sefer:** Masaüstünde henüz `DIGICAD-Guncelle` yoksa ZIP'i bir kez açın
ve içindeki `DIGICAD-Guncelle` dosyasına çift tıklayın. Güncellemeyi yapar
ve kendini masaüstüne kopyalar. Sonraki güncellemelerde ZIP'i açmanız
gerekmez.

## Masaüstü simgesi

Güncelleme (`DIGICAD-Guncelle`) masaüstüne **DIGICAD Dental** simgesini
kendiliğinden ekler. Simgeye çift tıklayınca yönetim paneli, adres çubuğu
olmayan ayrı bir program penceresinde açılır. Simge silinirse
`Masaustu-Simgesi-Olustur.bat` ile yeniden oluşturulabilir.

## Hekimler için

**Tarama bağlantısı:** Hekim STL/PLY dosyasını yükleyemezse portaldaki
**"🔗 Dosya yükleyemiyor musunuz? Bağlantı olarak gönderin"** kutusuna
WeTransfer, Google Drive, Dropbox, Medit Link, 3Shape Communicate gibi bir
paylaşım bağlantısı yapıştırabilir. Bağlantı laboratuvar tarafında dosyaların
yanında görünür:

- Tıklanınca bağlantı açılır.
- "ZIP olarak indir" ile indirilirse ZIP'in içinde çift tıklanabilir bir
  kısayol (`.url`) olur.
- Bağlantılar yalnızca giriş yapmış kullanıcılar tarafından açılabilir.

**Hekim bilgisayarına kurulum:**

1. Ana sayfadaki **💻 Hekim kurulum dosyası** kartından
   `DIGICAD-Hekim-Portali-Kurulum.bat` dosyasını indirin.
2. Dosyayı hekimlere gönderin. Hekimler isterse portalın giriş ekranındaki
   **Bu bilgisayara kur** bağlantısından da indirebilir.
3. Hekim dosyaya çift tıklar. Dosya:
   - Masaüstüne ve Başlat menüsüne **DIGICAD Hekim Portalı** simgesini ekler.
   - Portalı ayrı bir uygulama penceresinde açar.

   Yönetici izni gerekmez, bilgisayara program kurulmaz.

Windows "Bilgisayarınız korundu" uyarısı gösterirse hekim **Ek bilgi →
Yine de çalıştır** seçeneğine tıklamalı.

Telefonda: portalı açıp tarayıcı menüsünden **"Ana ekrana ekle"** seçilir.
Ana ekranda diş simgesi oluşur.

## Sık sorulanlar

**PIN'i nasıl değiştiririm?**
İki yol var:
- Yönetim panelinde **Ayarlar → 🔒 Program Giriş Şifresi** bölümü.
- Sunucu kapalıyken `PIN-Degistir.bat`.

**Hekim şifresini nasıl değiştiririm?**
Eskisi gibi, yönetim panelinde **Hekimler** sayfasından. Şifre değiştiği anda
hekimin açık oturumları da kapanır.

**"Yönetim paneline sadece laboratuvar ağından erişilebilir" hatası alıyorum.**
Yönetim paneline internet tünelinden girmeye çalışıyorsunuz. Bu bilinçli olarak
engellendi. Laboratuvardaki bir bilgisayardan girin.

**Mail Kutusu (Gmail) çalışmıyor.**
Sayfanın adresi değiştiği için (`localhost:8080`) Google Cloud Console'daki
OAuth istemcisine `http://localhost:8080` adresini "Yetkili JavaScript
kaynakları" listesine eklemeniz gerekir.

**Yapay zekâ özellikleri?**
Kapalı durumdalar. Ayarlardan bir OpenAI anahtarı girilmedikçe çalışmazlar.

**Orijinal sayfalarda değişiklik yaptım, yerel sürüme nasıl aktarırım?**
Değiştirdiğiniz HTML dosyalarını bir klasöre koyun ve şunu çalıştırın:

```
node araclar\sayfalari-donustur.js C:\orijinal-sayfalar-klasoru
```

Dönüştürülmüş sayfalar `public\` klasörüne yazılır. Ardından güvenlik
testlerini çalıştırın:

```
node test\calistir.js
```

## Teknik özet

- `sunucu.js` — sunucu. Ek paket gerektirmez, sadece Node.js yeterli.
  - İç kapı (8080) tüm paneller içindir.
  - Dış kapı (8081, sadece `127.0.0.1`) yalnızca hekim ve teknisyen portalları
    içindir.
- `lib/yetki.js` — kim neyi okuyup yazabilir. Bütün güvenlik kuralları burada.
- `public/firebase-yerel.js` — sayfalardaki Firebase çağrılarını yerel
  sunucuya yönlendirir.
- `veri/veritabani.json` — tüm kayıtlar. Atomik olarak yazılır, yazma sırasında
  elektrik kesilse bile dosya bozulmaz.
- `veri/dosyalar/` — yüklenen dosyalar.
- `veri/ayarlar.json` — kapılar, yedek klasörü ve şifrelenmiş PIN.
- `veri/` klasörü `.gitignore` içinde. Gerçek veriler hiçbir zaman GitHub'a
  gönderilmez.
