# ROBOT KOL – Sürüm Geçmişi

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
