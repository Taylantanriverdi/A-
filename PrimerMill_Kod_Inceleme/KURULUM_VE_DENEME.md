# PrimerMill 2 — Kurulum ve deneme

Bu belge yeni paneli makineye kurmayı, eski sürüme dönmeyi ve güvenli deneme sırasını anlatır.
Önemli: Yeni arayüz bu çalışmada **Windows'ta hiç çalıştırılamadı** (geliştirme ortamı Linux'tu). Mantık ve hesaplar testlerle denendi; arayüz kodu derleyiciden geçti ve ekran görüntüleri arayüz kodundan alındı. Bu yüzden ilk çalıştırma mutlaka **önce ofis bilgisayarında demo modunda** yapılmalıdır.

## 0. Teslim klasörü

```
teslim/
  PrimerMill/            → makinede PrimerMill klasörünün yerine
    KazimaBaslat.bat       yeni panel (KazimaBaslat.bat /demo = demo modu)
    KazimaBaslat_Klasik.bat  düzeltilmiş eski panel (geri dönüş)
    EdingKapat.bat, HataBul.bat, YoneticiKurulum.bat, portal.html, uzak.html, eding_yolu.txt
    KIOSK_KUR.bat, KIOSK_KALDIR.bat, Kabuk.ps1   kiosk modu (§6, isteğe bağlı)
    lib/  ui/  demo/
  P_CNC_icin/macro.cnc   → makinede P:\CNC\macro.cnc (makro sürüm 5)
  ekran_goruntuleri/     → yeni arayüzün görüntüleri
```

## 1. Ofis bilgisayarında testler ve demo (makineye dokunmadan)

1. Proje klasörünü (`PrimerMill_Kod_Inceleme`) bilgisayara kopyalayın.
2. Testler (32 bit PowerShell 5.1; hepsi **GEÇTİ** olmalı):
   ```
   %SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File tests\Calistir.ps1 -Kaynak teslim\PrimerMill
   ```
   `Demo_Ekran_Testi` Windows'ta paneli demo modunda açar, her ekranın görüntüsünü `teslim\ekran_goruntuleri_demo\` altına kaydeder ve kapanır.
3. Demo: `teslim\PrimerMill\KazimaBaslat.bat /demo`. Üst şeritte turuncu **DEMO** etiketi görünmelidir. Sırayla deneyin:
   - Açılış geri sayımı: süre dolunca **hiçbir şey yapmamalı** (yeni güvenlik); ŞİMDİ BAŞLA → home.
   - İŞ SEÇ → `ORNEK_ZY2_45_kisa` → BAŞLAT → DURAKLAT. Duraklıyken jog, pens aç, MDI, G54 kaydet **soluk ve nedenli** olmalı. DEVAM → iş biter.
   - Takımlar, Kalibrasyon (otomatik sihirbaz prob testi geçmeden ② adımından ileri gitmemeli), Ayarlar › Makine değişkenleri (KAYDET → kırmızı tehlikeli onay, eski/yeni değerler, yedek dosya adı), Kayıtlar (MDI onayı), Uzaktan (`http://127.0.0.1:8080`, 6 haneli PIN).
   - Ayarlar › Genel › Tema › **Geçişli**: zemin maviye döner; iş başlatılınca yüzde ilerledikçe zemin ve kartlar sıçramadan camgöbeği üzerinden yeşile kaymalı, iş bitince tam yeşil kalmalı, yeni dosya seçilince yavaşça maviye dönmeli. Yazılar ve durum hapı her renkte okunur olmalı. Panel kapatılıp açılınca tema korunmalı (`panel_ayarlar.ini` `Tema=gecisli`). Koyu/Açık'a dönüş anında olmalı. **Şafak** için aynısı: gece çiviti → erik → bakır; seçim düğmesinde dört seçenek ("Koyu / Açık / Geçişli / Şafak") kesilmeden okunmalı.
   - Takımlar › **Frez ömrü**: demo örnek verileriyle gelir (T2 %91 kehribar, T3 %104 kırmızı, T5 ömür girilmedi). T1 ÖMRÜ AYARLA → `1000,5` yazın (virgül de olur) → "1000.5 dk". İŞ SEÇ → BAŞLAT: iş T3'ü kullanıyorsa "T3 ömrünü doldurdu: 1043/1000 dk. Yine de başlatılsın mı?" sorulmalı (Enter = VAZGEÇ, iş başlamaz). İş sürerken iş milindeki frezin dakikası artmalı, DURAKLAT'ta durmalı; o işin frezleri için SIFIRLA soluk olmalı (bkz. §7).
   - Herhangi bir diyalogda **Esc = ACİL STOP** olmalı.
   - `teslim\PrimerMill\loglar\Panel_*.log` içinde `PROGRAM HATASI` satırı olmamalı.
   Sorun görürseniz `HataBul.bat` çalıştırıp çıkan metni ve log dosyasını saklayın.

## 2. Makineye kurulum

1. **Yedek alın** (geri dönüş için şart):
   - `P:\CNC\macro.cnc` → `P:\CNC\macro_yedek_<tarih>.cnc`
   - Mevcut `PrimerMill` klasörünün tamamı → `PrimerMill_eski_<tarih>`
   - Eding'in `cnc.ini` dosyası → `cnc_yedek_<tarih>.ini` (G54 ve #4000–#4199 burada)
2. Eding'i **EdingKapat.bat** ile kapatın (ayarları kaydederek kapanır; iş sürüyorsa kapatmaz).
3. `teslim\PrimerMill\` içeriğini makinedeki PrimerMill klasörüne kopyalayın. `panel_ayarlar.ini`, `ayarlar.txt`, `devam.json`, `yedekler\`, `loglar\` gibi mevcut dosyaların üzerine yazmayın (teslimde yoklar; eski dosyalar korunur).
4. `teslim\P_CNC_icin\macro.cnc` → `P:\CNC\macro.cnc`.
5. `eding_yolu.txt` yalnız açıklama satırları içerir; makinede `P:\CNC` kendiliğinden bulunur. Farklı bir klasör gerekiyorsa dosyaya tek satır yol yazın.
6. Başlangıç görevi ve güvenlik duvarı için `YoneticiKurulum.bat`'ı **yönetici olarak** bir kez çalıştırın (görev artık yeni `KazimaBaslat.bat`'ı açar ve 72 saat sınırı kaldırılır).
7. Paneli açın. Açılışta panel Eding'deki makro sürümünü kontrol eder; **5** değilse uyarır ve iş başlatmaz. Bu durumda Eding'i kapatıp açın.
8. Takım yuvaları ve sensör değişkenleri (#4010–#4021, #4031–#4032) boşsa panel artık **kendiliğinden yazmaz**. Uyarı verir ve BAŞLAT/M6'yı engeller. Ayarlar › Yuva ayarı'ndan gerçek konumları ölçüp kaydedin. "Doğrulanmış değerlere dön" düğmesinin değerleri üreticininkinden farklıdır (bkz. `INCELEME_RAPORU.md` › MAKİNEDE DOĞRULA).

## 3. Eski sürüme geri dönme

- **Hızlı:** Aynı klasörde `KazimaBaslat_Klasik.bat` (düzeltilmiş eski panel; aynı ayar dosyalarını ve makro sürüm 5'i kullanır). İki panel aynı anda açılmaz.
- **Tam geri dönüş (orijinal yazılım):** Eding'i kapatın, `PrimerMill_eski_<tarih>` klasörünü ve `macro_yedek_<tarih>.cnc` dosyasını geri koyun, Eding'i açın. Orijinal panel makro sürüm 3 bekler; yeni makro ile orijinal panel birlikte kullanılmamalıdır.
- Başlangıç görevinin klasik paneli açması için `KazimaBaslat.bat`'ın içeriğini `KazimaBaslat_Klasik.bat` ile değiştirmek yeterlidir.

## 4. Deneme sırası

### 4.1 Eding simülasyon modunda (makine hareket etmez)

Eding'i simülasyon moduna alın (panelde SİMÜLASYON çipi görünür), sonra `KazimaBaslat.bat`.
1. Açılış, home, iş seç / başlat / duraklat / devam / durdur.
2. Duraklıyken jog, pens aç, MDI, G54 kaydet engelli mi?
3. Takım değişimi T1→T2→T0, elle frez modu adımları (Esc = ACİL STOP).
4. Yuva değişkenlerinden birini 0 yapıp `M6` → makro hareket etmeden hata vermeli (MC-03). Değeri geri yazın (yedekten yükle).
5. "Kaldığı yerden devam": Eding T2'deyken devamda T3 seçin → eksenler **kıpırdamamalı**, Eding T3 göstermeli.
6. ACİL STOP'u takım değişimi sırasında basın → RESET → BAŞLAT: panel iş milindeki frezi sormalı.
6a. **Kaldığı yerden devam, senaryo 1 (her durma yolunda kayıt):** iş sürerken iş kartında soluk "Son kayıt: satır N (hh:mm:ss)" görünmeli (Kayıtlar › Teknik › "Devam kaydı" satırında durum da yazar). Sırayla deneyin, her birinden sonra BAŞLAT → KALDIĞI YERDEN DEVAM programın durduğu satırın ~10 sn gerisinden başlamalı:
   - DURDUR (durum `durduruldu`), ACİL STOP → KİLİDİ KALDIR (`acil`), kompresörü kapatıp EXTERR → ALARMI TEMİZLE (`exterr`), bir Eding hatası (`hata`), iş sürerken RESET (`reset`).
   - Eding'i görev yöneticisinden kapatın (`eding_kapandi`), iş sürerken paneli kapatın (`panel_kapandi`), elektrik kesintisi yerine bilgisayarı resetleyin (son 2 sn'lik `calisiyor` kaydı).
   - Duraklatılmışken ve elle frez beklerken de kayıt zamanı ilerlemeli (Teknik satırındaki saat).
   - ALARMI TEMİZLE / KİLİDİ KALDIR sonrası yarım işin dosyası kendiliğinden seçili gelmeli.
6b. **Kaldığı yerden devam, senaryo 2 (kırık frez):** birden çok frez kullanan bir işte (ör. T1 → T2 → T5) T2'nin işinden sonraki M100 ölçümünde kırık oluşturun (simülasyonda #4005'i geçici olarak 0.001 yapın; denemeden sonra geri yazın). Beklenen:
   - Eding errmsg ile durur, panelde **FREZE HATASI** penceresi: 1) ALARMI TEMİZLE 2) PENS AÇ ile kırık frezi çıkar (iş milinde kırık T2) 3) yeni T2'yi yuvasına tak (otomatik) / elinde hazırla (manuel) 4) BAŞLAT → T2'NİN İŞİNİ BAŞTAN.
   - BAŞLAT'ta yalnız **T2'NİN İŞİNİ BAŞTAN BAŞLAT**, **TÜM İŞİ BAŞTAN**, VAZGEÇ (kaldığı yerden / yakın / işlem başı YOK; nerede kırıldığı bilinemez).
   - PENS AÇ yapmadan seçerseniz (Eding hâlâ T2): "Kırık frez iş milinden çıkarıldı mı? (PENS AÇ)" sorusu; HAYIR → hiçbir şey kıpırdamaz. EVET → Eding T0 olur (hareketsiz).
   - "Yeni frez takıldı: T2 ömrü sıfırlansın mı?" sorusu, sonra onay penceresinde başlayacağı satır = dosyadaki `T2 M6` satırı. Program güvenli Z'ye kalkar, T2'yi yuvasından alır, ölçer ve T2'nin işini baştan keser (MAKİNEDE DOĞRULA 30–31).
   - Başladıktan sonra kırık kaydı silinir; iş biterse devam kaydı da silinir.
7. Disk kalibrasyonu test programını üretin: cep çapları Ø4/5/6/7/8 olmalı (eski sürümde Ø5 ve Ø7 hatalı olarak Ø6 çıkıyordu).
8. Telefondan: PIN ile izleme, dosya yükleme. Duraklıyken uzaktan BAŞLAT reddedilmeli.

### 4.2 Makinede, düşük ilerleme hızıyla

Hız ayarı **%10–30**, el fiziksel acil stop düğmesinde (varsa), önce iş milinde frez yokken:
1. HOME, TEMİZLİK, PARK, YUKARI (her biri onay sorar).
2. İş mili `S10000 M3` çalışırken PENS AÇ → iş mili tamamen durmadan pens **açılmamalı**. Durma süresini ölçün (makrodaki `g4 p3` yeterli mi?).
3. Frezsiz `Takım ölç` → makro hata verip durmalı, G92 değişmemeli (MC-07).
4. Yuvaya git: her yuva ve sensör, Takımlar ve Yuva ayarı sayfalarından; hedefler eski panelle aynı mı?
5. Tek bir otomatik takım değişimi (T1), sonra frezli kısa bir iş.
6. Otomatik kalibrasyon: önce prob testi (zorunlu). İlk ölçümü yalıtkan sahte bir yüzeyle ve %50 hızla yapın (prob temas etmezse pim 6–8.7 mm dalabilir; G-kodu değiştirilmedi).
7. `INCELEME_RAPORU.md` › **MAKİNEDE DOĞRULA** listesindeki her maddeyi işaretleyin.

## 5. Sorun olursa

- Panel açılmıyorsa: `HataBul.bat` ve `loglar\Panel_*.log`.
- Panel yavaş ya da donuyor gibiyse: Kayıtlar › Teknik bilgide tık süresine bakın; geçici olarak klasik panele dönün.
- Her durumda geri dönüş için §3.

## 6. Kiosk modu (isteğe bağlı)

Amaç: makine Windows tabanlı görünmesin. Açılışta, kullanımda ve kapanışta yalnız PRIMER ekranı görünür; Windows'a yalnız panelden, PIN ile geçilir. Kiosk **yalnız kurulduğu Windows hesabında** geçerlidir (HKCU); diğer hesaplar normal Windows'tur.

### 6.1 Kurulum

1. Önce paneli normal kurun ve deneyin (§2, §4). Kiosk, panel sorunsuz açılıyorsa kurulmalı.
2. Operatör hesabında oturum açın (makinede her gün kullanılan hesap). En kolayı: operatör hesabı aynı zamanda yönetici olsun.
3. `PrimerMill\KIOSK_KUR.bat` → sağ tık → **Yönetici olarak çalıştır**. Ekranda hangi hesaba kurulacağı yazar; UAC penceresine başka bir yöneticinin parolasını yazdıysanız o hesabın adı görünür: **H** deyin ve operatör hesabında yeniden deneyin.
4. Yaptıkları (her adım ekrana yazılır):
   - Bu hesabın kabuğu Windows Gezgini yerine `Kabuk.ps1` olur (`HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell`). Kabuk siyah ekranda PRIMER · Başlatılıyor… gösterir ve paneli açar.
   - `kiosk.on` bayrağı: panel çerçevesiz tam ekran, en üstte açılır; klavye kilidi Win, Menü, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Boşluk tuşlarını keser (tek başına **Esc = ACİL STOP çalışmaya devam eder**); KÜÇÜLT pasif; paneli kapatmak PIN ister.
   - İlkeler: Görev Yöneticisi, ekran kilidi, parola değiştirme, oturum kapatma, hızlı kullanıcı değiştirme, kilit ekranı, ilk oturum animasyonu, "Hoş geldiniz / Kapatılıyor" yazıları, dokunmatik ekran kenar kaydırmaları, bildirimler kapatılır. Önceden var olan değerler `kiosk_yedek.txt`'ye yazılır.
   - **Kapat / Yeniden başlat Windows menülerinden bilerek kaldırılmadı** (NoClose yok): doğru yol paneldeki **Kapat** düğmesidir (Eding ayarlarını kaydeder); Ctrl+Alt+Del ekranındaki güç düğmesi yalnız acil durum içindir.
   - Açılış: `bcdedit /set {globalsettings} bootuxdisabled on` ve `bcdedit /set {current} quietboot on` (Windows logosu ve dönen noktalar görünmez, ekran siyah kalır). Önceki değerler yedeklenir.
   - İsteğe bağlı otomatik oturum açma (varsayılan **hayır**). Kurulmazsa açılışta Windows giriş ekranı görünür. Kurulursa parola kayıt defterinde **düz metin** saklanır.
   - `YoneticiKurulum.bat`'ın kurduğu "PrimerMill" başlangıç görevi kapatılır (paneli artık kabuk açar).
5. Yeniden başlatın.

Not: Bilgisayar üreticisinin (BIOS/UEFI) logosu donanım yazılımıdır; yalnız BIOS/UEFI ayarlarından (ör. "Quiet Boot", "Logo") kapatılabilir.

Not: Kabuktan açılan panel yönetici değildir (UAC). Eding'i panel kendisi açtığı için gizleme yine çalışır; Eding ayrıca yönetici olarak açılmışsa gizlenemeyebilir, panel yine en üstte kalır (MAKİNEDE DOĞRULA).

### 6.2 Kullanım

- **Cihazı kapatma:** sol menünün en altındaki **Kapat** (her ekranda). KAPAT / YENİDEN BAŞLAT / VAZGEÇ. İş sürerken, duraklıyken ya da bir panel işlemi sürerken pasiftir. Eding ayarlarını kaydederek kapanır (en çok 15 sn beklenir), sonra bilgisayar kapanır. DEMO'da bilgisayar kapanmaz. Kiosk kurulu olmasa da çalışır.
- **Windows'a geçiş:** Ayarlar › Genel › Kiosk modu › **WINDOWS'A GEÇ** → PIN **2457**. Klavye kilidi kalkar, Windows masaüstü açılır, panel simge durumuna küçülür ve çalışmaya devam eder. İş sürerken geçilemez.
- **Panele dönüş:** görev çubuğundaki PrimerMill'e ya da masaüstündeki "PrimerMill 2" kısayoluna dokunun: panel tam ekran ve kilitli olarak geri gelir (kısayol ikinci panel açmaz, açık olanı öne çağırır).
- **PIN değiştirme:** Ayarlar › Genel › Kiosk modu › **PIN** (önce mevcut PIN, sonra yeni PIN iki kez, 4–8 rakam). Ya da panel kapalıyken `panel_ayarlar.ini` içine `KioskPin=1234` satırı. 5 yanlış PIN → 60 sn bekleme. PIN günlüğe yazılmaz.
- Paneli kapatmak (Ayarlar › Genel › KAPAT, Alt+F4) kiosk'ta PIN ister; kapanınca Windows masaüstü açık kalır. Yeniden kiosk için bilgisayarı yeniden başlatın.

### 6.3 Kurtarma (bilgisayar hiçbir zaman kilitli kalmaz)

1. **PIN ile:** WINDOWS'A GEÇ (yukarıda).
2. **Panel çökerse:** kabuk paneli yeniden açar; 2 dakikada 3 kezden fazla çökerse Windows masaüstünü açar ve Türkçe açıklama gösterir (`loglar\kabuk.log`, `HataBul.bat`).
3. **kiosk.on'u silmek:** `PrimerMill\kiosk.on` silinirse sonraki oturumda kabuk Windows masaüstünü ve paneli normal açar (kiosk kapalı). Bunu başka bir Windows hesabından, ağdan ya da Güvenli Moddan yapabilirsiniz.
4. **Güvenli Mod:** Güvenli Modda kabuk paneli açmaz, doğrudan Windows masaüstünü açar. Güvenli Moda girmek: giriş ekranında Shift basılıyken Yeniden başlat → Sorun gider → Gelişmiş seçenekler → Başlangıç Ayarları → 4; ya da açılışta 3 kez üst üste elektriği kesip Windows Kurtarma Ortamı. Sonra `KIOSK_KALDIR.bat`.
5. **Shift:** oturum açılırken (siyah PRIMER ekranının ilk 1,5 saniyesinde) Shift basılı tutulursa kabuk paneli açmaz, Windows masaüstünü açar. Zamanlaması tutmayabilir; asıl yollar yukarıdakilerdir. (Otomatik oturum açmada Shift ayrıca otomatik oturumu da atlatır.)
6. Ctrl+Alt+Del yazılımla engellenemez; ekranında Görev Yöneticisi, Kilitle, Parola değiştir ve Kullanıcı değiştir kapalıdır, Oturumu kapat/güç düğmesi kalabilir (oturum yeniden açılınca yine kiosk gelir).

### 6.4 Kaldırma

Kiosk'un kurulduğu hesapta (önce WINDOWS'A GEÇ) `KIOSK_KALDIR.bat` → **Yönetici olarak çalıştır**. Kabuk Windows Gezgini olur, `kiosk.on` silinir, ilkeler kaldırılır (önceden var olanlar eski değerine döner), bcdedit değerleri geri yüklenir, KIOSK_KUR kurduysa otomatik oturum kapatılır ve kayıtlı parola silinir, "PrimerMill" başlangıç görevi yeniden açılır. Yeniden başlatın.

## 7. Frez ömrü (takım başına kesim süresi)

Panel her frezin (T1–T6; makroda başka numara kullanılırsa onlar da "Diğer takımlar" satırında) **kesimde geçen süresini dakika olarak** sayar ve operatörün girdiği ömre göre yüzde gösterir. Örnek: T1 ömrü 1000 dk, 100 dk çalıştı → **%10**. Makineye hiçbir komut gönderilmez, G-kodu değişmez.

- **Nerede:** Takımlar › **Frez ömrü** sekmesi (kullanılan dk ve saat, ömür, %, son "yeni frez" tarihi); Takımlar › Takım değişimi yuva kartlarında `%23` ve `230 / 1000 dk`; Üretim › TAKIM kartında iş milindeki frez için "Ömür %23 · 230/1000 dk". Renk: %80'in altı normal, %80–99 kehribar, %100 ve üstü kırmızı. Ömür girilmemişse yalnız dakika ve "ömür girilmedi".
- **Ömrü ayarlamak:** Frez ömrü › ilgili satırda **ÖMRÜ AYARLA** → dakika yazın (0–100000; `1000,5` ya da `1000.5`; **0 = ömür girilmedi**). Kullanılan süreye dokunmaz. İş sürerken de yapılabilir.
- **Yeni frez takınca:** **SIFIRLA · YENİ FREZ** → onay (varsayılan VAZGEÇ). Kullanılan süre 0 olur, ömür ayarı korunur, eski değer ve tarih günlüğe (`loglar\Panel_*.log`) yazılır. İş sürerken (duraklıyken de) o işin kullandığı ya da iş milindeki frez için düğme soluktur: iş bitince sıfırlayın.
- **Ne sayılır:** yalnız panelden başlatılan iş Eding'de tam olarak **RUNNING** iken ve iş milinde frez varken (takım değişimi makrosu RUN-SUB, DURAKLAT, elle frez değişimi beklemesi, jog, MDI, home sayılmaz). Süre gerçek saatle ölçülür; panel donarsa tek seferde en çok 2 sn eklenir. Eding'in kendi ekranından başlatılan iş sayılmaz.
- **BAŞLAT'ta uyarı:** işin kullandığı bir frez ömrünün %100'üne ulaşmışsa "T2 ömrünü doldurdu: 1050/1000 dk. Yine de başlatılsın mı?" sorusu (VAZGEÇ = iş başlamaz; EVET = iş normal başlar). %90–99 ise yalnız alt şeritte uyarı. Kesim sırasında %100'e ulaşan frez için bir kez alt şerit bildirimi; iş durmaz.
- **Dosya:** `PrimerMill\frez_omru.json` (demo modunda `demo_calisma\frez_omru.json`, gerçek dosyaya dokunulmaz). Sayılırken 30 sn'de bir, iş durunca ve panel kapanırken yazılır. Bozulursa panel boş başlar, bozuk dosyayı `frez_omru.json.bozuk_<tarih>` olarak saklar. Kurulumda bu dosyanın üzerine yazmayın (teslimde yok).
- **Makinede ilk denemede:** bir işi kronometreyle izleyin; Frez ömrü sekmesindeki dakika artışı kronometredeki kesim süresiyle (takım değişimleri hariç) uyuşmalı (bkz. `INCELEME_RAPORU.md` › MAKİNEDE DOĞRULA 27).
