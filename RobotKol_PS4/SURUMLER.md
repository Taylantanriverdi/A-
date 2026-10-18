# ROBOT KOL – Sürüm Geçmişi

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
