# Klinik ⇄ Teknisyen İş Takip Sistemi

Diş kliniği ile dental teknisyen/laboratuvar arasındaki işleri **hasta bazlı** takip eden web uygulaması.
İki taraf da aynı işi gerçek zamanlı görür: iş gönderir, iş alır, not bırakır, STL yükler ve her aşamanın zamanını izler.

## Kurulum ve çalıştırma

### Windows: tek tıkla (önerilen)

Deponun kökündeki **`IsTakip-Baslat.bat`** dosyasına çift tıklayın. Dosya Git ve Node.js yoksa kurar,
programı indirir ya da en son sürüme günceller, verileri `data/yedek` içine yedekler, eski sunucuyu kapatıp
yenisini başlatır ve tarayıcıyı açar. Güncelleme almak için her seferinde aynı dosyaya çift tıklamanız yeterli.
Bat dosyasını tek başına (ör. Masaüstüne) indirip çalıştırırsanız program `%USERPROFILE%\IsTakip\a-` klasörüne kurulur.

### Elle

Gereken tek şey **Node.js 18+**. Ek paket kurulmaz.

```bash
cd is-takip
npm start            # http://localhost:3000
```

Demo hesaplar (şifre `1234`):

| Rol        | E-posta               |
|------------|-----------------------|
| Klinik     | klinik@demo.com       |
| Klinik 2   | klinik2@demo.com      |
| Teknisyen  | teknisyen@demo.com    |
| Teknisyen 2| teknisyen2@demo.com   |

İki farklı tarayıcıda (ya da biri gizli pencerede) klinik ve teknisyen olarak girip canlı akışı deneyebilirsiniz.
Ağdaki diğer bilgisayarlar `http://SUNUCU-IP:3000` adresinden bağlanır. Port: `PORT=8080 npm start`.

## Özellikler

- **Hasta merkezli yapı:** her hastanın adının altında o hastaya ait tüm işler (aktif / geçmiş)
- **İki yönlü iş gönderme:** klinik → teknisyen ya da teknisyen → klinik; alıcı işi kabul eder veya gerekçeyle reddeder
- **İş akışı:** Gönderildi → Kabul → Üretimde → Provada (⇄ Revizyon) → Hazır → Teslim → Tamamlandı (+ Reddedildi, İptal).
  Her rol yalnızca kendine düşen adımları görür, sunucu da yetkiyi denetler
- **Notlar / mesajlaşma:** iş bazında sohbet, durum değişiklikleri ve dosya olayları aynı zaman çizelgesinde, "Görüldü" bilgisi
- **Dosyalar:** STL, PLY, OBJ, fotoğraf, PDF, ZIP (300 MB'a kadar), sürükle-bırak, yükleme ilerleme çubuğu
- **3D STL görüntüleyici:** tarayıcıda döndür/yakınlaştır, tel kafes, renk, ölçü (mm), üçgen sayısı, ekran görüntüsü
- **Zaman bilgisi:** oluşturma/güncelleme saatleri, her aşamaya ulaşma zamanı, aşamalarda geçen süre,
  toplam süre, teslim tarihi geri sayımı, geciken iş uyarısı, ortalama tamamlanma süresi
- **İş detayları:** FDI diş şeması, Vita renk, materyal, öncelik (Acil/Yüksek/Normal/Düşük), açıklama, otomatik iş numarası (2026-0001)
- **Pano:** yeni gelen işler, sizden işlem bekleyenler, geciken / bugün teslim, aşama dağılımı, son hareketler
- **Anlık bildirim:** sayfa yenilemeden güncellenir, toast ve masaüstü bildirimi, okunmamış sayaçları
- Arama, filtreleme, sıralama, **CSV (Excel) dışa aktarma**, açık/koyu tema, mobil uyumlu arayüz
- Kayıt/giriş, scrypt ile şifre saklama, HttpOnly oturum çerezi, köken (CSRF) kontrolü, rol bazlı erişim

## Veri

- Veriler `is-takip/data/db.json`, yüklenen dosyalar `is-takip/data/uploads/` içinde tutulur.
- Yedek almak için `data/` klasörünü kopyalamanız yeterli. Demo verilere sıfırlamak için `data/` klasörünü silin.
- Farklı bir konum için: `DATA_DIR=/yol/veri npm start`

## Test

```bash
npm test   # tam iş akışını, yetkileri, dosya yükleme/indirmeyi ve güvenlik kontrollerini dener
```

## Yapı

```
is-takip/
  server.js           HTTP sunucu, REST API, canlı bildirim (SSE), JSON veri deposu
  public/index.html   uygulama kabuğu
  public/app.js       tek sayfa arayüz
  public/styles.css   tasarım (açık/koyu tema, mobil)
  public/stl-viewer.js 3D STL görüntüleyici
  public/vendor/      three.js (MIT), internet olmadan da çalışır
  test/smoke.js       uçtan uca API testi
```

> İnternete açık kullanımda sunucuyu HTTPS arkasında (ör. Nginx/Caddy) çalıştırın.
