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
    lib/  ui/  demo/
  P_CNC_icin/macro.cnc   → makinede P:\CNC\macro.cnc (makro sürüm 4)
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
7. Paneli açın. Açılışta panel Eding'deki makro sürümünü kontrol eder; **4** değilse uyarır ve iş başlatmaz. Bu durumda Eding'i kapatıp açın.
8. Takım yuvaları ve sensör değişkenleri (#4010–#4021, #4031–#4032) boşsa panel artık **kendiliğinden yazmaz**. Uyarı verir ve BAŞLAT/M6'yı engeller. Ayarlar › Yuva ayarı'ndan gerçek konumları ölçüp kaydedin. "Doğrulanmış değerlere dön" düğmesinin değerleri üreticininkinden farklıdır (bkz. `INCELEME_RAPORU.md` › MAKİNEDE DOĞRULA).

## 3. Eski sürüme geri dönme

- **Hızlı:** Aynı klasörde `KazimaBaslat_Klasik.bat` (düzeltilmiş eski panel; aynı ayar dosyalarını ve makro sürüm 4'ü kullanır). İki panel aynı anda açılmaz.
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
