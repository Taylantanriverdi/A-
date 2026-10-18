# ROBOT KOL – Sürüm Geçmişi

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
