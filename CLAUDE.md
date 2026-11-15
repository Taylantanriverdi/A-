# Proje kuralları

## Kural: Her şey `IsTakip-Baslat.bat` ile çalışmalı

Kullanıcı Windows'ta tüm güncellemeleri yalnızca kök dizindeki `IsTakip-Baslat.bat` dosyasına
çift tıklayarak alır ve program bu dosyayla otomatik başlar. Bu yüzden her değişiklikte:

1. Değişiklik, bat dosyasının yaptığı "git fetch + checkout + başlat" ile ek bir el işlemi olmadan çalışmalı.
2. Yeni bir npm paketi, sistem programı, ortam değişkeni, port, klasör veya kurulum adımı eklenirse
   bat dosyası da aynı committe güncellenmeli (bat, `package.json` içinde `dependencies` varsa `npm install` çalıştırır).
3. Veri şeması değişirse eski `data/db.json` dosyaları sunucu açılırken otomatik dönüştürülmeli;
   kullanıcıdan elle işlem istenmemeli. `data/` klasörü git dışında kalmalı (kullanıcı verisi).
4. Çalışma dalı değişirse bat içindeki `BRANCH` ayarı güncellenmeli.
5. `.bat` dosyaları CRLF satır sonuyla ve yalnızca ASCII karakterlerle yazılmalı (bkz. `.gitattributes`).
6. Değişiklikler commit edilip ilgili dala push edilmeli; push edilmeyen değişiklik kullanıcıya ulaşmaz.
