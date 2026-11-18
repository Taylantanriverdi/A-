Bu klasör, gerçek bir dental 5 eksen freze makinesini (Bloomden/DentMill X5, Eding CNC 4.03, CPU5B) yöneten PrimerMill yazılımı. Yazılım bugün çalışıyor ama eksikleri var. Senden istediğim: tüm yazılımı baştan sona kontrol etmen, hatalarını düzeltmen, iyileştirmen ve güncel, dinamik, estetik yeni bir arayüz tasarlayıp uygulaman. Sonunda bana eksiksiz, çalışır durumda, teslim edilebilir yazılımı ver.

Önce CLAUDE.md'yi baştan sona oku. Oradaki kurallar bağlayıcıdır. Bu prompt ile çelişen bir yer olursa CLAUDE.md'deki güvenlik kuralları (makine hareketi, PowerShell 5.1 32 bit, kodlama, Eding 4.03 makro sözdizimi, yeni çalışma zamanı kurulmaması) önceliklidir.

## Çalışma şekli: sen orkestratörsün

Sen beyinsin. İşi bölümlere ayır, her bölüm için alt ajan (Task) başlat, sonuçlarını birleştir ve kararları sen ver.
- Hangi bölüm için kaç alt ajan açılacağına ve her alt ajanın hangi modelle çalışacağına sen karar ver. Derin analiz, makine güvenliği, kalibrasyon matematiği ve mimari kararları için Opus; dosya tarama, metin çıkarma, biçimlendirme gibi mekanik işler için daha hafif bir model kullanabilirsin.
- Birbirinden bağımsız işleri paralel yürüt. Aynı dosyayı aynı anda iki alt ajana düzenletme: düzenlemeleri tek elden sen birleştir.
- Her alt ajana net bir görev, okuması gereken dosyalar, CLAUDE.md'deki ilgili kurallar ve teslim edeceği çıktının biçimini ver.
- Bir alt ajanın bulgusunu kendin doğrulamadan kod değiştirme.

## Aşamalar

### 1. Envanter (kod değişikliği yok)
- `git init` yap, dosyaları olduğu gibi ilk commit olarak kaydet.
- Mevcut panelin yaptığı her işi `OZELLIK_ENVANTERI.md` dosyasında listele: her sekme, her düğme, her sihirbaz, her otomatik davranış (açılışta Eding'i başlatma ve gizleme, zamanlayıcılar, uzaktan erişim, yedekleme, kalibrasyonlar, takım değişimi, frez yuvaları, ayarlar). Her madde için ilgili fonksiyon adları ve satır aralığı.
- `macro.cnc`'nin 46 alt programını ve panelin her birini nereden çağırdığını eşle.

### 2. İnceleme (paralel alt ajanlar, kod değişikliği yok)
En az şu alanları ayrı alt ajanlara incelet:
1. PowerShell 5.1 / 32 bit uyumu ve sözdizimi (ayrıştırıcı + PSScriptAnalyzer)
2. Makine güvenliği: acil stop, duraklatma, iş sırasında kilitlenmesi gereken komutlar, takım değişimi, G54/#4002 yazma ve yedekleme, güvenli yükseklikler
3. Eding API kullanımı ve hata yönetimi: bağlantı kopması, DLL yok, Eding meşgul, zamanlayıcı çakışmaları, yakalanmayan istisnalar
4. macro.cnc: panel ile tutarlılık, değişken çakışmaları, hata sonrası güvenli durum
5. Uzaktan erişim (TcpListener + portal.html/uzak.html): PIN, yerel ağ sınırı, girdi doğrulama, uzaktan tehlikeli komutlar
6. Otomatik kalibrasyon matematiği (`OkModel`, `OtoKal-Hesapla-Ic`): sentetik verilerle doğrulama
7. Sayı ve kültür: Çince/Türkçe Windows'ta ondalık ayırıcı, metin kodlaması
8. Mevcut arayüzün kullanılabilirlik sorunları ve eksikleri (operatör gözüyle)

Bulguları `INCELEME_RAPORU.md` içinde topla: önem derecesi (KRİTİK / YÜKSEK / ORTA / DÜŞÜK), dosya ve satır, açıklama, önerilen düzeltme.

### 3. Yeni arayüz tasarımı (bana onaya sun)
- Teknoloji: WinForms veya WPF (XAML), PowerShell 5.1 32 bit içinde çalışacak. Kurulum gerektiren hiçbir şey kullanma. Seçimini gerekçesiyle yaz.
- Hedef kullanıcı: atölyede makine başında duran operatör. Dokunmatik ekranda rahat kullanılmalı (büyük dokunma alanları), uzaktan okunabilmeli (iş durumu, kalan süre, takım, alarm), en az 1024×768'de bozulmadan çalışmalı, 1920×1080'de alanı iyi kullanmalı.
- Güncel ve estetik: tutarlı renk ve tipografi sistemi, koyu ve açık tema, durum renkleri (hazır / çalışıyor / duraklatıldı / alarm) her yerde aynı anlamda, akıcı ama abartısız geçişler.
- Dinamik: makine durumu, eksen konumları, ilerleme, takım ve alarmlar canlı güncellensin. Arayüz donmasın; Eding çağrıları arayüzü kilitlemesin.
- Ana ekran günlük işi tek dokunuşla yaptırmalı: iş seç, başlat, duraklat, durdur, takım değişimi, temizlik. Kalibrasyon ve ayarlar ikinci seviyede.
- Tehlikeli işlemler (G54 yazma, kalibrasyon uygulama, takım bırakma, eksen hareketi) açık bir onay adımı istesin.
- Tasarımı uygulamadan önce bana şunları sun ve onayımı bekle: ekran listesi, ana ekranın ve en az iki alt ekranın taslağı (ASCII çizim veya basit görsel), renk ve yazı sistemi, mimari (arayüz ile mantığın nasıl ayrılacağı).

### 4. Uygulama
- Önce KRİTİK ve YÜKSEK bulguları düzelt, her biri ayrı commit.
- Mantığı (Eding bağlantısı, G-kod üretimi, hesaplar, ayar dosyaları) arayüzden ayır. Ayırırken davranışın değişmediğini testlerle göster.
- Yeni arayüzü onaylanan tasarıma göre uygula. Envanterdeki her özellik yeni arayüzde olmalı.
- Makine hareketine dokunan her değişikliği `INCELEME_RAPORU.md`'de "MAKİNEDE DOĞRULA" listesine yaz.

### 5. Test
- Tüm `.ps1` dosyaları ayrıştırıcıdan hatasız geçmeli, PS 7'ye özgü sözdizimi olmamalı, BOM'lu UTF-8 kalmalı.
- `tests/` klasöründe Eding'siz çalışan testler: kalibrasyon hesabı (bilinen hataları geri bulma), G-kod üreticileri (eski ve yeni çıktı birebir aynı), sayı biçimleme (Türkçe/Çince kültür), ayar okuma/yazma.
- Eding olmadan arayüzün açılabilmesi için bir "simülasyon/demo modu" ekle: sahte makine durumu ile tüm ekranlar gezilebilsin. Bunu kullanarak her ekranın açıldığını doğrula.

### 6. Bağımsız son kontrol
- Kodu yazan alt ajanlardan bağımsız, yeni bir alt ajana (Opus) tüm değişiklikleri, CLAUDE.md kurallarını ve özellik envanterini ver. Eksik özellik, kural ihlali, güvenlik riski arasın. Bulduklarını düzelt, son kontrolü tekrarla.

## Teslim
1. Çalışan yazılım, makineye kopyalanacak hazır klasör (`teslim/PrimerMill/` ve `teslim/P_CNC_icin/macro.cnc`).
2. `INCELEME_RAPORU.md`: bulunan ve düzeltilen sorunlar, "MAKİNEDE DOĞRULA" listesi, uygulanmayan öneriler.
3. `OZELLIK_ENVANTERI.md`: her özelliğin yeni arayüzdeki yeri, işaretli.
4. `tests/` ve nasıl çalıştırılacağı.
5. `KURULUM_VE_DENEME.md`: makineye kurulum, eski sürüme geri dönme, önce Eding simülasyon modunda sonra makinede düşük ilerleme hızıyla deneme sırası.
6. Yeni arayüzün ekran görüntüleri (demo modundan).

Emin olmadığın bir makine davranışında tahmin etme: bana sor ya da raporda açıkça belirt.
