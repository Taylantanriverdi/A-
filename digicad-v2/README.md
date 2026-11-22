# DigiCAD v2

Diş protez laboratuvarı yönetim yazılımının güvenli yeniden yazımı. Eski tek dosyalı HTML + Firebase RTDB sistemi **donmuş arşiv** olarak kalır; bu proje yeni bir Firebase projesinde çalışır.

- **Ön yüz:** Vite + TypeScript, çok sayfalı (`admin`, `hekim`, `teknisyen`, `gelen-isler`).
- **Arka uç:** Cloud Firestore, Storage, Cloud Functions (Node 20, TS), Authentication (Identity Platform, TOTP), App Check (reCAPTCHA Enterprise), Hosting.
- **Güvenlik ilkesi:** varsayılan reddet; roller custom claims; klinik/finans kayıtlarında fiziksel silme yok (yumuşak silme + değişmez geçmiş); verilerle `innerHTML` yok; sıkı CSP.

## Dizin yapısı
| Yol | İçerik |
|---|---|
| `src/lib` | `dom.ts` (güvenli `h()`), `auth.ts`, `firebase.ts` (`callFn`: tek kullanımlık App Check token'lı callable), `store.ts` (Firestore erişimi), `files.ts`, `ui.ts`, `gate.ts` (giriş/MFA/rol kapısı), `format.ts` (para/durum + **Europe/Istanbul** tarih yardımcıları), `teeth.ts` (FDI diş şeması, tek kaynak), `zip.ts` (ZIP indirme), `chatbox.ts` (hekim/teknisyen ve iş sohbeti) |
| `src/admin`, `src/pages` | Yönetim paneli ve hekim/teknisyen/gelen-işler sayfaları |
| `firestore.rules`, `storage.rules` | Güvenlik kuralları |
| `functions/` | `adminCreateUser/adminSetRole/adminResetPassword/adminDisableUser/copyJobFiles/clearMustChangePassword`, geçmiş+denetim tetikleyicisi, `parseOrderMail`, günlük yedek |
| `cors.json` | Storage bucket GET CORS örneği (ZIP indirme `fetch` için; alan adını değiştirin) |
| `migration/` | Eski RTDB JSON dışa aktarımından Firestore'a göç aracı + doğrulama raporu |
| `tests/rules`, `tests/unit`, `migration/test` | Kural (emülatör), birim ve göç testleri |
| `docs/` | `GOC_REHBERI.md`, `GUVENLIK.md`, `OZELLIK_ENVANTERI.md` |

## Kurulum
```bash
cd digicad-v2
npm install
npm --prefix functions install
cp .env.example .env        # yer tutucuları YENİ projenin değerleriyle doldurun
```
`.firebaserc` içindeki `YENI-PROJE-ID` değerini yeni proje kimliğiyle değiştirin. **Eski `primer-dental` projesi hiçbir yerde kullanılmaz.**

## Komutlar
| Komut | Açıklama |
|---|---|
| `npm run dev` | Yerel geliştirme sunucusu |
| `npm run build` | `tsc --noEmit` + Vite üretim derlemesi (`dist/`) |
| `npm run typecheck` / `npm run lint` | Tip denetimi / ESLint (eval, innerHTML yasağı) |
| `npm test` | Birim + göç testleri (Vitest) |
| `npm run test:rules` | Firestore/Storage kural testleri (emülatör + Java gerekir) |
| `npm run migrate -- --input yedek.json` | Göç (varsayılan DRY-RUN) |

## Ortam değişkenleri (`.env`, derleme zamanı)
| Değişken | Anlamı |
|---|---|
| `VITE_FIREBASE_*` | Yeni projenin web yapılandırması (bkz. `.env.example`) |
| `VITE_RECAPTCHA_SITE_KEY` | App Check reCAPTCHA Enterprise site anahtarı |
| `VITE_GOOGLE_CLIENT_ID` | Gmail entegrasyonu için OAuth istemci kimliği |
| `VITE_USE_EMULATORS` | `true` → Auth/Firestore/Storage/Functions emülatörlerine bağlanır |
| `VITE_OFFLINE_CACHE` | Varsayılan **kapalı** (bellek önbelleği; tarayıcıya hasta verisi yazılmaz). `true` → kalıcı IndexedDB önbelleği (çıkışta silinir; paylaşımlı cihazda açmayın) |
| `VITE_AUTH_PERSISTENCE` | Varsayılan **sekme ömürlü** oturum (sekme kapanınca biter; ayrıca hareketsizlik zaman aşımı: yönetici kısa, diğerleri daha uzun). `local` → kalıcı oturum |

## Çalışma alanları (lab) ve yönetici hesapları
Her kullanıcının `lab` claim'i vardır (`digicad`, `primer`, ...). **Yönetici yalnızca kendi claim'indeki çalışma alanına erişir** (kurallar + callable'lar + arayüz); başka alana geçiş seçicisi yoktur. `adminCreateUser` hedef lab olarak **çağıranın** lab'ını kullanır. Primer Teknoloji için **ayrı bir yönetici hesabı** açın:
```bash
GOOGLE_APPLICATION_CREDENTIALS=anahtar.json npx tsx scripts/bootstrap-admin.ts PROJE-ID digicad-yonetici@ornek.com            # --lab varsayılan: digicad
GOOGLE_APPLICATION_CREDENTIALS=anahtar.json npx tsx scripts/bootstrap-admin.ts PROJE-ID primer-yonetici@ornek.com --lab primer
```
Claim adları her yerde aynıdır: `role` (`admin|doctor|tech`), `lab`, `doctorId`, `techId` (**metin**), `mustChangePassword` (+ sunucu içi `pwt`).

## Yerel çalıştırma (emülatör)
```bash
npm --prefix functions run build
npx firebase emulators:start --project demo-digicad     # firestore, storage, auth, functions
VITE_USE_EMULATORS=true npm run dev
```
Emülatörde ilk yöneticiyi `scripts/bootstrap-admin.ts` ile (emülatör ortam değişkenleriyle) oluşturabilirsiniz. **Dikkat:** Firestore/Storage kuralları admin için `sign_in_second_factor` (TOTP ile girilmiş token) ister; emülatörde de yönetici ilk girişte TOTP kaydı yapmalı (kapı bunu zorlar) ve sonraki girişte kodu girmelidir. Yalnızca callable'larda `FUNCTIONS_EMULATOR` altında MFA gevşetilir; gerçek projede **zorunludur**. Arayüzde `VITE_USE_EMULATORS=true` iken oturumun ikinci faktörle açılmış olması şartı gevşetilir ama kurallar yine ister.

## Dağıtım (yeni projeye)
1. Firebase konsolunda yeni proje, **Blaze** planı. Firestore (Native, **`europe-west1`**; `eur3` DEĞİL: Cloud Functions ve yedek bölgesi `europe-west1`, Firestore tetikleyicileri aynı bölgede olmalı), Storage (aynı bölge önerilir), Authentication açın.
2. Authentication → Identity Platform'a yükseltin; **Multi-factor authentication → TOTP** etkinleştirin. Anonim girişi **kapalı** tutun; yalnızca E-posta/Şifre açık olsun. Kendi kendine kayıt (self sign-up) kapatın (Identity Platform ayarı: "Enable create (sign-up)" kapalı).
3. App Check: reCAPTCHA Enterprise anahtarı oluşturun, Web uygulamasını kaydedin; site anahtarını `.env` → `VITE_RECAPTCHA_SITE_KEY`. Firestore, Storage ve Functions için **Enforce** açın (önce "Metrics"te birkaç gün izleyin).
4. Gizli anahtar: `firebase functions:secrets:set OPENAI_API_KEY`
5. Yedek bucket'ı (bkz. `GOC_REHBERI.md` "Yedekleme"), ardından `functions/.env.<proje>` içine `BACKUP_BUCKET=bucket-adi` (**zorunlu**; yoksa `scheduledBackup` her gün hata verir ve günlüğe `YEDEK BAŞARISIZ` yazar — bu metin için Cloud Logging uyarısı kurun). Storage dosyaları Firestore yedeğine DAHİL DEĞİLDİR: ana bucket'ta nesne sürümlemeyi açın (`GOC_REHBERI.md` §8).
5b. Storage CORS (yönetim panelindeki toplu **ZIP indirme** `fetch` kullanır; CORS yoksa ZIP içine `_INDIRILEMEDI.txt` konur): `cors.json` içindeki yer tutucu alan adlarını gerçek Hosting adreslerinizle değiştirip `gsutil cors set cors.json gs://<PROJE>.firebasestorage.app` çalıştırın.
6. Dağıtım:
```bash
npm run build
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
```
7. İlk yönetici: `GOOGLE_APPLICATION_CREDENTIALS=anahtar.json npx tsx scripts/bootstrap-admin.ts PROJE-ID eposta@... [--lab digicad]` → ilk girişte şifre değişimi ve TOTP kurulumu istenir. Primer için ayrı hesap: `--lab primer` (yukarıya bakın).
8. Hosting başlıkları (`firebase.json`): CSP, HSTS, X-Frame-Options, Referrer-Policy. Callable'lar `https://europe-west1-<proje>.cloudfunctions.net/<ad>` adresinden çağrılır (v2 `onCall` dahil); CSP `connect-src` bu yüzden `https://*.cloudfunctions.net` içerir (CSP'de joker yalnızca en soldaki etikette olabilir, `europe-west1-*` yazılamaz). `*.run.app` **gerekmez**, eklemeyin.
9. App Check: yönetici callable'ları `consumeAppCheckToken` (tek kullanımlık token, replay koruması) ister; istemci `callFn` ile her çağrıda `limitedUseAppCheckTokens` kullanır. İkisi birlikte çalışır; App Check anahtarı olmadan callable çağrıları reddedilir.

## Hesaplar ve şifre akışı
- `adminCreateUser` (Hekimler/Teknisyenler → **Hesap aç**) geçici şifre üretir ve `mustChangePassword` + `pwt` (hesabın `tokensValidAfterTime` zamanı) claim'i yazar; kullanıcı ilk girişte şifre değiştirir → istemci `clearMustChangePassword` callable'ını çağırır (şifre gerçekten değişmediyse sunucu reddeder) → `getIdToken(true)` ile claim yenilenir. `adminResetPassword` aynı akışı yeniden başlatır.
- Göç aracı ve `bootstrap-admin` de `pwt` yazar; `pwt` olmayan hesapta bayrak kaldırılmaz (yönetici "Şifre sıfırla" ile hesabı yeniden hazırlar).
- Hekim/teknisyen **silinince** (yumuşak silme) bağlı Auth hesabı `adminDisableUser` ile devre dışı bırakılır ve oturumları iptal edilir; Silinenler'den geri alınınca yeniden etkinleştirilir.
- **Ortak e-postalı hekim/teknisyenler** (iki kayıt aynı e-posta) göçte otomatik hesap almaz; elle hesap açma adımı için `docs/GOC_REHBERI.md`.

## Dosya akışı
Hekim taramaları `labs/<lab>/submissions/<hekimId>/` altına yüklenir (teknisyen buraya erişemez). Gönderim **siparişe aktarılınca** yönetici paneli `copyJobFiles` callable'ını çağırır: dosyalar sunucuda `jobFiles/<işId>/` altına kopyalanır ve iş kaydındaki yollar güncellenir (teknisyen yalnızca `jobFiles` okur). Kopya başarısız olursa uyarı çıkar; İş Detayı → Tarama sekmesindeki **Dosyaları teknisyen için hazırla** ile yeniden denenir. Storage kuralları ayrıca tehlikeli dosya adı uzantılarını (`.html .svg .js .exe .xml ...`) reddeder.

## Notlar
- Rol/claims yalnızca Cloud Functions ile atanır; istemciden değiştirilemez.
- localStorage'a hasta verisi yazılmaz; Firestore önbelleği varsayılan olarak bellektedir (`VITE_OFFLINE_CACHE` ile kalıcı yapılabilir; paylaşımlı bilgisayarda oturumu kapatın).
- Hekim/teknisyen portalı sorguları `where('deleted','==',false)` içerir (kurallar çöp kayıtları bu şartla gizler). Göç aracı `deleted` alanını jobs/pendingJobs/doctorSubmissions için her zaman yazar; alanı olmayan kayıt bu listelerde görünmez.
- Gmail erişim anahtarı yalnızca bellekte tutulur.
