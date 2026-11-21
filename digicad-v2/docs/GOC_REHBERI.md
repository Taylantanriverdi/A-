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
`README.md` → "Dağıtım" adımları 1–6 (Blaze, Firestore, Storage, Identity Platform + TOTP, App Check, Secret, yedek bucket). Ardından kuralları, indeksleri ve fonksiyonları dağıtın.

**Önemli ayarlar (göçten ÖNCE yapın):**
- **Firestore konumu `europe-west1`** olmalı (`eur3` değil): konum sonradan değiştirilemez; Cloud Functions bölgesi (`europe-west1`) ve zamanlanmış yedek bununla uyumludur.
- **`BACKUP_BUCKET`**: `functions/.env.<proje>` içinde yedek bucket adı (§8). Tanımsızsa `scheduledBackup` hata verir ve Cloud Logging'e **`YEDEK BAŞARISIZ`** yazar. Logs-based alert: filtre `severity>=ERROR AND textPayload:"YEDEK BAŞARISIZ"` (veya jsonPayload/message eşleşmesi) → e-posta bildirimi. Ayrıca `labs/<lab>/auditLog` içinde `action=scheduledBackup`, `status=FAILED` kaydı oluşur.
- **Storage CORS**: yönetim panelindeki toplu ZIP indirme tarayıcıdan `fetch` ile yapılır. `cors.json` içindeki yer tutucu alan adlarını Hosting adresinizle değiştirip `gsutil cors set cors.json gs://<BUCKET>` çalıştırın; yoksa ZIP içine `*_INDIRILEMEDI.txt` konur.
- **Ortam değişkenleri** (derleme zamanı, `.env`): `VITE_OFFLINE_CACHE` (varsayılan kapalı = bellek önbelleği; `true` = kalıcı IndexedDB), `VITE_AUTH_PERSISTENCE` (varsayılan sekme ömürlü oturum; `local` = kalıcı). Ayrıntı: README "Ortam değişkenleri".
- **Yönetici hesapları**: `scripts/bootstrap-admin.ts PROJE-ID eposta [--lab digicad]`. Primer Teknoloji için **ayrı bir hesap** ve `--lab primer`: yönetici yalnızca kendi `lab` claim'indeki alana erişir, arayüzde alan seçici yoktur.

Servis hesabı anahtarı: yeni proje → Proje ayarları → Hizmet hesapları → **Yeni özel anahtar**. Dosyayı depo **dışında** saklayın, `export GOOGLE_APPLICATION_CREDENTIALS=/güvenli/yol/anahtar.json`. Göçten sonra anahtarı silin/devre dışı bırakın.

## 3. Dry-run (Firestore/Auth'a hiçbir şey yazmaz, ağ bağlantısı kurmaz)
```bash
npm run migrate -- --input migration/input/primer-dental-YYYYMMDD.json [--files-dir migration/input/storage]
```
Dry-run yalnızca yerel `migration/out/` altına rapor ve dosya manifesti yazar. Çıktıda şunlara bakın:
- Koleksiyon başına **kaynak = plan** sayıları ve "değer muhasebesi" (kaynaktaki her değer bir belgeye ya da listelenmiş bir atlamaya karşılık gelmeli).
- **`HATA:` satırı olmamalı.** Göç şu durumlarda **durur** (hiçbir şey yazmaz): geçersiz belge kimliği (`/`, `.`, `..`, `__x__`), nesne olmayan kayıt, 1 MiB'ı aşan belge, güvenli tam sayı sınırını (2^53) aşan sayı, geçersiz Unicode, 20 seviyeden derin nesne, **tanınmayan üst düzey anahtar** (örn. `db/digicad/bildirimler`) ve **eski kök yapıda (`db/doctors`, `db/jobs`, kök `chats` ...) `db/digicad`'da olmayan kayıtlar**.
  - Eski kök yapıdaki fazladan kayıtlar gerçekten sizin verinizse `--include-legacy-root` ile taşıyın; bilerek vazgeçiyorsanız `--ignore-legacy-root`. Tanınmayan anahtarları bilerek yok sayacaksanız `--ignore-unknown` (uyarı olarak raporlanır; ham JSON arşiviniz zaten sizde).
- `UYARI:` satırları: iç içe diziler (Firestore desteklemez) `{_nestedArray: [...]}` olarak **sarılır, kaybolmaz**; `__x__` ve boş alan adları `x` önekiyle yeniden adlandırılır; her ikisi de belgenin `_legacy` alanında kayıtlıdır. Gizli olabilecek (şifre benzeri adlı) alanlar taşınırsa uyarılır.
- "gizli alan temizlendi": hekim/teknisyen kayıtlarındaki `password/pass/pin/pwd/sifre/şifre/parola` (büyük/küçük harf fark etmez) taşınmaz; yönetici `pass` ve `meta/pass` da taşınmaz. Hekim `username` alanı taşınır (şifresi taşınmaz).
- "e-postasız hesap", "ortak/geçersiz e-posta": bu hekim/teknisyenler için Auth hesabı **açılmaz** (aynı e-postayı paylaşan iki kayıttan biri diğerinin erişimini ezerdi; bir Auth hesabı tek `doctorId`/`techId` claim'i taşır). **Elle hesap açma adımı:** rapordaki listeden kayıtları belirleyin → her kayıt için *farklı* bir e-posta adresi belirleyin (örn. `ad.soyad+klinik@...` takma adı da olur) → Yönetim → Hekimler/Teknisyenler → ilgili kaydı **Düzenle** ile e-postayı girip kaydedin → **Hesap aç** (geçici şifre bir kez gösterilir; güvenli kanaldan iletin). İki kişi gerçekten aynı kutuyu paylaşıyorsa bile her biri için ayrı e-posta/hesap gerekir; ortak bir hesapla iki hekimin verisi görülemez.

Dönüşümler (eski veri bozulmaz, yalnızca erişim kuralları için tamamlanır): işlere `doctorId` (metin; `drId` aynen kalır, hekimsiz işte boş metin) ve `techIds` (metin dizisi; `techId` aynen kalır); `pendingJobs.techId` metne çevrilir (güvenlik kuralı metin karşılaştırır); her belgeye `id` ve `_legacy` (kaynak çalışma alanı/anahtar) eklenir; **`jobs/pendingJobs/doctorSubmissions` belgelerine `deleted` alanı yoksa `false` yazılır** (portallar çöpü `where('deleted','==',false)` ile süzer; alanı olmayan kayıt listede görünmezdi); durumu olmayan işe `status:'Bekliyor'` yazılır (`_legacy.defaultedStatus`); zaman damgası olmayan sohbet mesajına, mesaj kimliğinden (Date.now) `timestamp` türetilir (`_legacy.derivedTimestamp`).

**Eski iş sohbetleri:** eski sistemde sohbet iş bazlıdır (`chats/job_<işId>`); göç bunları `threads/job_<işId>` olarak taşır. Yeni kurallar bu konuşmaları işin hekimine (`doctorId`) ve atanmış teknisyenlerine (`techIds`) açar; hekim/teknisyen portalında iş detayından, yönetici panelinde Mesajlar'dan görülür. Eski mesajların alanları (`senderRole: 'technician'`, `senderName`, ek `fileUrl`) aynen korunur.

**Eski durum değerleri:** eski kodda iş durumu yalnızca `Bekliyor, Tasarımda, Üretimde, Makyajda, Tamamlama Onayı, Tamamlandı` (+ yazım varyantı `Bekleyen`) idi (`Beklemede/Gönderildi/İptal` satışlara, `Yeni/İncelendi/Aktarıldı/Reddedildi` gönderim/onay kayıtlarına aittir). Kurallar `Bekleyen`'i kabul eder; başka/bilinmeyen bir değer göçle gelirse kayıt güncellenebilir (değer aynı kaldığı sürece), arayüz değeri "(eski)" olarak gösterir ve yönetici kanonik bir duruma çekebilir.

**Göçle gelen özel alanlar:** `_legacy`, `{_nestedArray: [...]}` sarmalı ve `x` önekli (`x__id__` gibi) alanlar arayüzde gösterilmez ama **silinmez**: kurallar mevcut alanların kaldırılmasını reddeder, ön yüz yalnızca değişen alanları yazar (testle doğrulanır).

## 4. Gerçek göç
```bash
npm run migrate -- --input migration/input/primer-dental-YYYYMMDD.json \
   --project YENI-PROJE-ID --execute --accounts-csv migration/out/hesaplar.csv
```
- Yalnızca **yeni** projeye yazar. `primer-dental` kimliği büyük/küçük harf, boşluk, noktalama ve alt dizgi (`primer-dental-2`) fark etmeksizin reddedilir; ayrıca `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT`/`FIREBASE_CONFIG` ortam değişkenleri ve servis hesabı anahtarının `project_id`'si eski projeyi gösteriyorsa ya da `--project` ile uyuşmuyorsa, ayrıca emülatör değişkenleri ayarlıysa (`--allow-emulator` hariç) araç **başlamaz**.
- **Hiçbir mevcut belge sessizce ezilmez:** hedefte aynı yolda belge varsa ve içeriği aynıysa atlanır; **göç işareti (`_legacy`) olmayan** (yeni sistemde sonradan oluşturulmuş) belge ise ezilmez, **çakışma** olarak raporlanır (çıkış kodu 2); işaretli ama farklıysa (örn. göçten sonra düzenlenmiş) ezilmeden önce önceki hali `migration/out/yedek-ezilen-*.jsonl` (0600) dosyasına yedeklenir. Yeni sistemde oluşmuş belgelerin üzerine bilerek yazmak için `--overwrite-new-system-docs`. Plan dışı belgeler **asla** silinmez/ezilmez (sayıları raporda "extraInTarget").
- İdempotenttir ve yarıda kesilebilir: belgeler tek tek yazılır (500'lük grup sınırı yok), geçici hatalar yeniden denenir, kalıcı hata alan belge raporlanır ve **diğerleri yazılmaya devam eder**; aynı komutu tekrar çalıştırmak yalnızca eksikleri yazar.
- Hekim/teknisyen Auth hesapları rastgele (144 bit) geçici şifreyle açılır ve ilk girişte şifre değişimi zorunlu olur. Şifreler **hesap açıldığı anda** `hesaplar.csv`'ye eklenir (0600 izinli, ASLA ezilmez, sonradan hata olsa da kaybolmaz; formül enjeksiyonuna karşı korumalı). `.gitignore` `*.csv`, `migration/out/`, `migration/input/` dosyalarını dışarıda tutar. Şifreleri güvenli kanaldan iletin, sonra dosyayı silin. Mevcut **yönetici** hesabı ya da başka bir kayda bağlı hesap ile aynı e-posta çıkarsa hesap **ezilmez**, raporda "skippedExisting" olarak yazılır.
- Eski düz metin şifreler/PIN'ler **taşınmaz**.

## 5. Doğrulama raporunu okuma
Rapor `migration/out/rapor-execute-*.json` ve terminalde özetlenir:
- **Kaynak SHA-256:** indirdiğiniz yedekle aynı olmalı.
- Her koleksiyon için `kaynak / plan / yazılan / değişmemiş / ezilen / doğrulanan / kayıp / farklı / eksikAlan / çakışma / hata`.
- Doğrulama **iki bağımsız yoldan** yapılır: (1) her belge Firestore'dan **geri okunur** ve kanonik SHA-256'sı beklenenle karşılaştırılır; (2) **dönüşüm koduna bağımlı olmayan** bir denetim, ham kaynak JSON'daki her kaydı (yoluyla) alıp her alanının (gizli alanlar hariç) geri okunan belgede aynı değerle bulunduğunu kontrol eder (eksik alan = `eksikAlan`). Bu denetim dry-run'da plana karşı da çalışır.
- **Çıkış kodu 0 değilse göçü kabul etmeyin:** `1` şema/doğrulama hatası, `2` kayıp/farklı/eksik alan/çakışma/yazma hatası, `3` kullanım hatası. Hata listesini düzeltip yeniden çalıştırın (idempotent).
- Doğrulama şunu **kanıtlar:** kaynak JSON'daki her kayıt ve alan yeni sistemde (belgelenmiş dönüşümler dışında) birebir var. **Kanıtlamaz:** Storage dosyalarının taşındığını (aşağıya bakın) ve kaynak JSON'un eski veritabanını eksiksiz yansıttığını (bunun için adım 1.5'teki dosya karması ve konsolda kayıt sayısı karşılaştırması yapın). JSON'da yinelenen anahtar olsa son değer geçerlidir (RTDB dışa aktarımında olmaz).
- Elle örnekleme: konsolda 5–10 işi eski/yeni karşılaştırın.

### Storage dosyaları hakkında
Eski kayıtlar dosyaları eski projenin indirme adresleriyle (`url`, token'lı) tutar; bu alanlar **aynen korunur** (yönetim panelinde "(eski arşiv)" olarak açılır). Araç kaynak JSON'un tamamını tarar (iş dosyaları, tasarım dosyaları, hekim gönderimleri, sohbet ekleri, bilinmeyen alanlar) ve `migration/out/dosya-manifesti.json` üretir: kayıtlardaki her benzersiz dosya, hangi kayıttan geçtiği, token'ı; `--files-dir` verilirse yerel dosya eşleşmesi (boyut, SHA-256, MD5), **eksik** dosyalar ve kayıtsız dosyalar.

Eski projeyi kapatmadan önce dosyaları yeni bucket'a kopyalayın (eski projeye bağlanmaz; yalnızca indirdiğiniz yerel klasörü okur, önce dry-run):
```bash
npx tsx scripts/copy-storage.ts --input migration/input/primer-dental-YYYYMMDD.json --files-dir migration/input/storage \
   --project YENI-PROJE-ID --bucket YENI-BUCKET [--prefix labs/digicad/legacy]            # dry-run
npx tsx scripts/copy-storage.ts ... --execute                                               # gerçek kopya
```
Nesne yolu korunur (`<prefix>/<eski yol>`), eski indirme token'ı yeni nesneye yazılır; her yükleme MD5 ile doğrulanır, var olan farklı içerik ASLA ezilmez, tekrar çalıştırmak güvenlidir. `migration/out/url-eslesme.json` eski URL'yi yeni bucket'taki karşılığına eşler. **Firestore kayıtları değiştirilmez** (eski URL'ler dururken bozulmaz); eski projeyi kapatmaya karar verirseniz bu eşlemeyle `url` alanlarını ayrıca güncelleyin. Çıkış kodu 2: eksik/çakışan/hatalı dosya var. Not: yeni Storage kuralları `labs/*/legacy/` yolunu okumaya kapalıdır; bu dosyalara token'lı URL ile ulaşılır.

## 6. Geçiş günü
1. Mesai dışı bir zaman seçin; hekim/teknisyenlere duyuru yapın (yeni adres, ilk giriş şifresi).
2. Eski sistemde yeni iş girişini durdurun. **Yeni bir JSON dışa aktarımı alın** (adım 1) ve adım 4'ü bu son dosyayla yeniden çalıştırın (idempotent; yalnızca farklar yazılır).
3. Raporu kontrol edin (çıkış kodu 0).
4. Yönetici hesabı ile giriş yapın (TOTP), Genel Bakış sayaçlarını eski sistemle karşılaştırın.
5. Hekim/teknisyen hesap bilgilerini iletin; bir hekim ve bir teknisyenle deneme yapın.
6. Çalışma günü boyunca eski sistemi **yalnızca okumak için** açık tutun.
7. Primer Teknoloji verisi de varsa: ayrı yönetici hesabı (`bootstrap-admin.ts ... --lab primer`) ile giriş yapıp kontrol edin; digicad yöneticisi primer verisini göremez.

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
`BACKUP_BUCKET` parametresini bu bucket adına ayarlayın (`functions/.env.<proje>`: `BACKUP_BUCKET=<bucket>`; gs:// olmadan). `scheduledBackup` her gün 03:15'te (İstanbul) Firestore'un tamamını dışa aktarır. **Geri yükleme provası yapın:** `gcloud firestore import gs://$BUCKET/firestore/YYYY-MM-DD --project=<deneme-projesi>`. Test edilmemiş yedek, yedek değildir.


### Storage dosyalarının yedeği (Firestore yedeği DOSYALARI KAPSAMAZ)
`scheduledBackup` yalnızca Firestore'u dışa aktarır. İş/tasarım/tarama dosyaları ve sohbet ekleri ana Storage bucket'ındadır; kurallar silme ve ezmeyi engeller ama bucket/proje sahibi silebilir. En az şunları yapın:
```bash
gcloud storage buckets update gs://<ANA-BUCKET> --versioning                      # nesne sürümleme (ezilen/silinen sürüm geri getirilebilir)
gcloud storage buckets update gs://<ANA-BUCKET> --soft-delete-duration=30d        # soft delete (silinenler 30 gün tutulur)
# İsteğe bağlı: ikinci bölge/bucket'a düzenli kopya (Storage Transfer Service, günlük)
```
Sürümleme depolama maliyetini artırır; eski sürümler için yaşam döngüsü (lifecycle) kuralı tanımlayın. Geri yükleme provasına Storage nesnelerini de ekleyin.
