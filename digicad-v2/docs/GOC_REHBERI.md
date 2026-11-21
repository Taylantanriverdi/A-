# Göç Rehberi (adım adım)

> Altın kural: **Eski projeye (`primer-dental`) yazmayın, silmeyin.** Göç aracı eski projeye hiç bağlanmaz; yalnızca sizin indirdiğiniz JSON dosyasını okur ve **yeni** projeye yazar.

## 0. Hazırlık
- Node 20+, `npm install` (kök dizinde), Firebase CLI (`npx firebase`).
- Çalışma klasörü: `digicad-v2/`. Göç çıktıları `migration/out/` altına yazılır (`.gitignore`'dadır).

## 1. Eski veriden JSON yedeği alma (salt okunur)
1. Firebase konsolu → `primer-dental` → **Realtime Database** → Veri sekmesi.
2. Kök düğümün (`/`) sağındaki **⋮ → JSON'u dışa aktar**. Dosyayı `migration/input/primer-dental-YYYYMMDD.json` olarak kaydedin.
3. Dosyanın bir kopyasını (ör. harici disk/şifreli bulut) saklayın. Bu sizin ham arşivinizdir.
4. İsteğe bağlı: Storage dosyaları için `gsutil -m cp -r gs://<eski-bucket> ./migration/input/storage/` (yalnızca **okuma**; `cp` kaynağı değiştirmez). Ya da konsoldan indirin.
5. Dosya bütünlüğü: `sha256sum migration/input/primer-dental-*.json` çıktısını not edin; göç raporundaki "Kaynak SHA-256" ile **aynı olmalı**.

## 2. Yeni projeyi kurma
`README.md` → "Dağıtım" adımları 1–6 (Blaze, Firestore, Storage, Identity Platform + TOTP, App Check, Secret, yedek bucket). Ardından kuralları ve fonksiyonları dağıtın.

Servis hesabı anahtarı: yeni proje → Proje ayarları → Hizmet hesapları → **Yeni özel anahtar**. Dosyayı depo **dışında** saklayın, `export GOOGLE_APPLICATION_CREDENTIALS=/güvenli/yol/anahtar.json`. Göçten sonra anahtarı silin/devre dışı bırakın.

## 3. Dry-run (hiçbir şey yazmaz, ağ bağlantısı kurmaz)
```bash
npm run migrate -- --input migration/input/primer-dental-YYYYMMDD.json
```
Çıktıda şunlara bakın: koleksiyon başına **kaynak = plan** sayıları; `HATA:` satırı olmamalı (örn. iç içe dizi, geçersiz anahtar); `UYARI:` satırları (tanınmayan üst düzey anahtarlar **taşınmaz**, elle inceleyin); "gizli alan temizlendi" sayısı (düz metin şifreler taşınmaz); "e-postasız hesap" sayısı.

Hekim/teknisyen kayıtlarında `email` alanı yoksa o kişi için hesap açılmaz; hesabı sonradan Yönetim → Hekimler/Teknisyenler → **Hesap aç** ile oluşturursunuz.

## 4. Gerçek göç
```bash
npm run migrate -- --input migration/input/primer-dental-YYYYMMDD.json \
   --project YENI-PROJE-ID --execute --accounts-csv migration/out/hesaplar.csv
```
- Yalnızca **yeni** projeye yazar (`primer-dental` kimliği koda gömülü olarak reddedilir).
- İdempotenttir: aynı id'lerle üzerine yazar; yarıda kesilirse aynı komutu tekrar çalıştırın.
- Hekim/teknisyen Auth hesapları rastgele geçici şifreyle açılır ve ilk girişte şifre değişimi zorunlu olur. Geçici şifreler **yalnızca** `hesaplar.csv`'ye (yerel, 0600 izinli) yazılır; bu dosya depoya girmez. Şifreleri hekimlere güvenli kanaldan iletin, sonra dosyayı silin.
- Eski düz metin şifreler/PIN'ler **taşınmaz**.

## 5. Doğrulama raporunu okuma
Rapor `migration/out/rapor-execute-*.json` ve terminalde özetlenir:
- **Kaynak SHA-256:** indirdiğiniz yedekle aynı olmalı.
- Her koleksiyon için `kaynak / plan / yazılan / değişmemiş / doğrulanan / kayıp / farklı`.
- Doğrulama: her kayıt Firestore'dan geri okunur ve kanonik JSON'unun SHA-256'sı beklenenle karşılaştırılır.
- **Çıkış kodu 0 değilse göçü kabul etmeyin:** `1` şema/doğrulama hatası, `2` kayıp veya farklı kayıt, `3` kullanım hatası. Hata listesini düzeltip yeniden çalıştırın (idempotent).
- Doğrulama şunu **kanıtlar:** yeni sistemdeki kayıtlar, dönüşüm kurallarına göre beklenenle birebir aynı. **Kanıtlamaz:** Storage dosyalarının taşındığını (aşağıya bakın) ve kaynak JSON'un eski veritabanını eksiksiz yansıttığını (bunun için adım 1.5'teki dosya karması ve konsolda kayıt sayısı karşılaştırması yapın).
- Elle örnekleme: konsolda 5–10 işi eski/yeni karşılaştırın.

### Storage dosyaları hakkında
Eski kayıtlar dosyaları eski projenin indirme adresleriyle (`url`) tutar ve bu alanlar aynen korunur; yönetim panelinde "(eski arşiv)" olarak açılır. Eski projeyi tamamen kapatmayı düşünüyorsanız dosyaları yeni bucket'a kopyalayıp kayıtlardaki yolları güncellemeniz gerekir; bu otomatik yapılmaz. `--files-dir` ile yalnızca dosya manifesti (ad, boyut, SHA-256) üretilir. Dosyaları şu komutla yeni bucket'a alabilirsiniz: `gsutil -m cp -r ./migration/input/storage/* gs://YENI-BUCKET/labs/digicad/legacy/`.

## 6. Geçiş günü
1. Mesai dışı bir zaman seçin; hekim/teknisyenlere duyuru yapın (yeni adres, ilk giriş şifresi).
2. Eski sistemde yeni iş girişini durdurun. **Yeni bir JSON dışa aktarımı alın** (adım 1) ve adım 4'ü bu son dosyayla yeniden çalıştırın (idempotent; yalnızca farklar yazılır).
3. Raporu kontrol edin (çıkış kodu 0).
4. Yönetici hesabı ile giriş yapın (TOTP), Genel Bakış sayaçlarını eski sistemle karşılaştırın.
5. Hekim/teknisyen hesap bilgilerini iletin; bir hekim ve bir teknisyenle deneme yapın.
6. Çalışma günü boyunca eski sistemi **yalnızca okumak için** açık tutun.

## 7. Eski projeyi salt-okunur kilitleme (SİZİN kararınız; araç yapmaz)
Geçiş doğrulandıktan sonra Firebase konsolu → `primer-dental` → Realtime Database → **Kurallar**:
```json
{ "rules": { ".read": false, ".write": false } }
```
Bu, eski projeyi herkese kapatır (en güvenli seçenek); arşiviniz adım 1'deki JSON yedeğidir. Storage kurallarını da `allow read, write: if false;` yapın. Eski web sitesini (Hosting) kaldırın veya yönlendirin. Bu adımdan sonra geri dönüş için yedek JSON'u saklayın.

## 8. Yedekleme (yeni proje)
```bash
PROJE=YENI-PROJE-ID; BUCKET=${PROJE}-yedek
gcloud storage buckets create gs://$BUCKET --project=$PROJE --location=europe-west1 --uniform-bucket-level-access
gcloud storage buckets update gs://$BUCKET --versioning
gcloud storage buckets update gs://$BUCKET --retention-period=30d      # retention
# İsteğe bağlı kilit (GERİ ALINAMAZ; süre dolana kadar silinemez):
# gcloud storage buckets update gs://$BUCKET --lock-retention-period
# Cloud Functions çalışma hesabına yazma izni:
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member="serviceAccount:$PROJE@appspot.gserviceaccount.com" --role=roles/storage.objectCreator
gcloud projects add-iam-policy-binding $PROJE --member="serviceAccount:$PROJE@appspot.gserviceaccount.com" --role=roles/datastore.importExportAdmin
```
`BACKUP_BUCKET` parametresini bu bucket adına ayarlayın. `scheduledBackup` her gün 03:15'te (İstanbul) Firestore'un tamamını dışa aktarır. **Geri yükleme provası yapın:** `gcloud firestore import gs://$BUCKET/firestore/YYYY-MM-DD --project=<deneme-projesi>`. Test edilmemiş yedek, yedek değildir.
