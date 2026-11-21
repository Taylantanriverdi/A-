# DigiCAD v2

Diş protez laboratuvarı yönetim yazılımının güvenli yeniden yazımı. Eski tek dosyalı HTML + Firebase RTDB sistemi **donmuş arşiv** olarak kalır; bu proje yeni bir Firebase projesinde çalışır.

- **Ön yüz:** Vite + TypeScript, çok sayfalı (`admin`, `hekim`, `teknisyen`, `gelen-isler`).
- **Arka uç:** Cloud Firestore, Storage, Cloud Functions (Node 20, TS), Authentication (Identity Platform, TOTP), App Check (reCAPTCHA Enterprise), Hosting.
- **Güvenlik ilkesi:** varsayılan reddet; roller custom claims; klinik/finans kayıtlarında fiziksel silme yok (yumuşak silme + değişmez geçmiş); verilerle `innerHTML` yok; sıkı CSP.

## Dizin yapısı
| Yol | İçerik |
|---|---|
| `src/lib` | `dom.ts` (güvenli `h()`), `auth.ts`, `store.ts` (Firestore erişimi), `files.ts`, `ui.ts`, `gate.ts` (giriş/MFA/rol kapısı) |
| `src/admin`, `src/pages` | Yönetim paneli ve hekim/teknisyen/gelen-işler sayfaları |
| `firestore.rules`, `storage.rules` | Güvenlik kuralları |
| `functions/` | `adminCreateUser/adminSetRole/adminResetPassword`, geçmiş+denetim tetikleyicisi, `parseOrderMail`, günlük yedek |
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

## Yerel çalıştırma (emülatör)
```bash
npm --prefix functions run build
npx firebase emulators:start --project demo-digicad     # firestore, storage, auth, functions
VITE_USE_EMULATORS=true npm run dev
```
Emülatörde ilk yöneticiyi `scripts/bootstrap-admin.ts` ile (emülatör ortam değişkenleriyle) oluşturabilirsiniz; TOTP zorunluluğu `FUNCTIONS_EMULATOR` altında callable'larda gevşetilir, gerçek projede **zorunludur**.

## Dağıtım (yeni projeye)
1. Firebase konsolunda yeni proje, **Blaze** planı. Firestore (Native, `europe-west1` veya `eur3`), Storage, Authentication açın.
2. Authentication → Identity Platform'a yükseltin; **Multi-factor authentication → TOTP** etkinleştirin. Anonim girişi **kapalı** tutun; yalnızca E-posta/Şifre açık olsun. Kendi kendine kayıt (self sign-up) kapatın (Identity Platform ayarı: "Enable create (sign-up)" kapalı).
3. App Check: reCAPTCHA Enterprise anahtarı oluşturun, Web uygulamasını kaydedin; site anahtarını `.env` → `VITE_RECAPTCHA_SITE_KEY`. Firestore, Storage ve Functions için **Enforce** açın (önce "Metrics"te birkaç gün izleyin).
4. Gizli anahtar: `firebase functions:secrets:set OPENAI_API_KEY`
5. Yedek bucket'ı (bkz. `GUVENLIK.md` / `GOC_REHBERI.md` "Yedekleme"), ardından `functions/.env.<proje>` içine `BACKUP_BUCKET=bucket-adi`.
6. Dağıtım:
```bash
npm run build
npx firebase deploy --only firestore:rules,storage,functions,hosting
```
7. İlk yönetici: `GOOGLE_APPLICATION_CREDENTIALS=anahtar.json npx tsx scripts/bootstrap-admin.ts PROJE-ID eposta@...` → ilk girişte şifre değişimi ve TOTP kurulumu istenir.
8. Hosting başlıkları (`firebase.json`): CSP, HSTS, X-Frame-Options, Referrer-Policy. CSP'deki `*.cloudfunctions.net` / `*.run.app` girdilerini proje bölgenize göre daraltın.

## Notlar
- Rol/claims yalnızca Cloud Functions ile atanır; istemciden değiştirilemez.
- localStorage'a hasta verisi yazılmaz; Firestore'un kendi çevrimdışı önbelleği kullanılır (paylaşımlı bilgisayarda oturumu kapatın).
- Gmail erişim anahtarı yalnızca bellekte tutulur.
