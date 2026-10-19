# ROBOT KOL – Sürüm Geçmişi

## V8
- Yeni: `SIMULASYON.html`, gerçekçi 3D simülasyon. İnternet gerekmez.
  - ESP32 kodundaki kontrol döngüsünün aynısı çalışıyor. Hız, yumuşatma ve açı sınırları doğrudan `RobotKol_PS4.ino` dosyasından okunuyor.
  - Kontrol: kaydırıcılar, klavye ve USB ile takılı PS4 kolu.
  - Kıskaç ucunun konumu (mm), masaya çarpma ve eksen sınırı uyarısı, uç izi.
  - Poz kaydedici: kaydet, oynat, döngü.
  - Dijital ikiz: ESP32'ye USB ile bağlanınca 3D model gerçek kolun açılarını gösteriyor, komutlar gerçek kola gidiyor.
- Kılavuz (15 sayfa) gerçekçi 3D görsellerle yenilendi: kapak, başlangıç duruşu, 7 montaj adımı ve elektronik kutusu. Yeni bölüm: 3D simülasyon.
- ESP32 kodu düzeltmeleri:
  - PS4 bağlanma/kopma olayları artık Bluetooth görevinde değil, ana döngüde işleniyor. Önceden eklem verisine iki görev aynı anda yazabiliyordu.
  - Açılışta eski Bluetooth eşleşmeleri siliniyor. PS4 kolunun yeniden bağlanamama sorununu önler.
  - İlk döngüdeki zaman adımı sınırlandı.
- Kurulum sonunda simülasyon, basit panel veya hiçbiri seçilebiliyor.

## V7
- Yeni: `ROBOT_KOL_KILAVUZ.pdf` (14 sayfa, resimli). İçinde malzeme listesi, 3D baskı parçaları ve ayarları, bağlantı şeması, yazılım kurulumu, PS4 eşleştirme, servo ortalama, 7 adımda montaj, kalibrasyon, kullanım, sorun giderme ve kontrol listesi var.
- Kurulum dosyası kılavuzu da ROBOT KOL klasörüne koyuyor.

## V6
- Yeni: Bilgisayardan USB kablo ile kontrol. `KONTROL_PANELI.html` (Chrome veya Edge ile açılır):
  - Her eksen için kaydırıcı (açılar ESP32'den canlı okunur)
  - Klavye ile kontrol: Q/A, W/S, E/D, R/F, T/G, Y/H; 1-2-3 hız; 0 başlangıç pozisyonu; Boşluk durdur
  - PS4 kolu bilgisayara USB ile takılınca ESP32'deki ile aynı düzende çalışır
- ESP32 kodu USB seri komutlarını kabul ediyor. Kablo çekilir ya da panel kapanırsa kol 0,3 saniye içinde duruyor. PS4 Bluetooth kontrolü aynen çalışmaya devam ediyor.
- Kurulum sonunda seri monitör yerine kontrol paneli açılıyor.

## V5
- Düzeltme: "There is not enough space on the disk" (C: dolu) hatası.
- Kurulumdan önce disklerdeki boş alan gösteriliyor. Araçlar, en az 4 GB boş alanı olan ilk sürücüye kuruluyor (önce C:, yetmezse D:, E: ...).
- Başka sürücüde kalan yarım kurulum silinip yer açılıyor. İndirilmiş dosyalar yeni sürücüye taşınıyor.
- Geçici dosyalar da seçilen sürücüye yazılıyor.
- Kurulum bitince indirme önbelleği (~700 MB) siliniyor.
- Hiçbir sürücüde yer yoksa Windows Disk Temizleme açılıyor.

## V4
- Düzeltme: "arduino-cli hata verdi: core update-index" hatası. Liste güncellemesinde "Some indexes could not be updated" uyarısı çıksa bile ESP32 listesi indirilmişse kurulum devam ediyor.
- Paket listesiyle birlikte kütüphane listesi de güncelleniyor (`arduino-cli update`).

## V3
- Arduino araçları gerçek `C:\RobotKol` klasörüne kuruluyor. Masaüstündeki `ROBOT KOL\araclar` bu klasöre giden bir kısayol.
- Düzeltme: "following symlink ... packages" hatası giderildi.
- Bat dosyalarının adında sürüm numarası var (`ROBOT_KOL_KURULUM_V3.bat`). Eski sürümler `yedekler\eski_surumler` klasörüne taşınıyor.

## V2
- Düzeltme: "A positional parameter cannot be found ... 'update-index'" hatası giderildi (Windows PowerShell'deki `cli` takma adıyla çakışma).

## V1
- İlk sürüm: ROBOT KOL klasörü, PS4 MAC adresi, kod yazma, Arduino CLI, ESP32 2.0.17, kütüphaneler, derleme ve yükleme.
