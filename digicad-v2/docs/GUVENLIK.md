# Güvenlik Belgesi

> Dürüst not: **"Kırılamaz" sistem yoktur.** Amaç, saldırı maliyetini yükseltmek, etkiyi sınırlamak ve her durumda veriyi geri getirebilmektir.

## Eski sistemdeki başlıca zafiyetler (yeniden yazım gerekçesi)
Yönetici şifresinin ve hekim/teknisyen şifrelerinin düz metin tutulması; 4 haneli PIN; herkesin okuyup yazabildiği RTDB (kayıt bazlı erişim denetimi yok); verilerle `innerHTML` ve satır içi `onclick` (örn. dosya adı `x');alert(1)//` ile XSS); istemcide API anahtarı; fiziksel silme; yedek/denetim izi yok; hasta verisinin localStorage'da tutulması.

## Tehdit modeli ve önlemler
| Tehdit | Önlem |
|---|---|
| Yetkisiz okuma/yazma | Firestore/Storage kuralları varsayılan reddet; rol/claim ve kayıt sahipliği denetimi; anonim giriş yok. Kurallar emülatör testleriyle sınanır (`tests/rules`). |
| Hekimin başka hekimin verisine erişmesi | `doctorId` eşleşmesi zorunlu; liste sorguları filtreli olmak zorunda; Storage'da `firestore.get` ile iş sahipliği kontrolü. |
| Teknisyenin yetkisini aşması | Yalnızca atandığı işleri görür; yalnızca `status` (Tamamlandı hariç), `designFiles`, `techNote` alanlarını günceller. |
| Veri silme/bozma (kötü niyet, hata, fidye yazılımı) | Hiçbir rol için fiziksel silme yok; yumuşak silme; her yazımda `history` + `auditLog` (istemci yazamaz); günlük yedek sürümlemeli/retention'lı ayrı bucket'ta. |
| Parola/şifre ele geçirme | Düz metin şifre yok; Firebase Auth (parola özetleme Google'da); yöneticiler için zorunlu TOTP MFA; geçici şifre + ilk girişte değiştirme; Cloud Function'lar yalnızca MFA'lı admin tokeniyle çalışır. |
| XSS / içerik enjeksiyonu | Verilerle `innerHTML` yok; `h()` yalnızca TextNode/setAttribute; `on*`/`style` öznitelikleri ve `javascript:` URL'leri engellenir; ESLint kuralı; sıkı CSP (`script-src 'self'` + yalnızca gerekli Google alanları, `object-src 'none'`, `frame-ancestors 'none'`). |
| Clickjacking, MIME sniffing, downgrade | X-Frame-Options, X-Content-Type-Options, HSTS (preload), Referrer-Policy, Permissions-Policy. |
| Bot/kötüye kullanım, kaba kuvvet | App Check (reCAPTCHA Enterprise) zorunlu; Firebase Auth'un yerleşik kısıtlaması; Cloud Function'larda Firestore tabanlı oran sınırlama. |
| Sır sızıntısı | OpenAI anahtarı yalnızca Secret Manager'da, yalnızca sunucuda; depoda `.env` yok (`.env.example` yer tutucu); göç geçici şifreleri yerel CSV'de (gitignore). Gmail erişim anahtarı yalnızca bellekte. |
| Yüklenen dosya kötüye kullanımı | Yol bazlı Storage kuralları, boyut (200 MB / sohbet 25 MB) ve MIME beyaz listesi (HTML/çalıştırılabilir reddedilir); üzerine yazma/silme yok; dosya adları `safeFileName` ile temizlenir. |
| Prompt enjeksiyonu (mail → OpenAI) | Girdi temizlenir ve 12.000 karakterle sınırlanır; model çıktısı şema ile zorlanır (`coerceParsed`); sonuç yalnızca bir form taslağıdır, otomatik işlem yapmaz; yalnızca admin çağırabilir. |
| Veri sızması (paylaşımlı cihaz) | Firestore'un çevrimdışı önbelleği tarayıcıda şifresiz tutulur; localStorage'a hasta verisi yazılmaz. Paylaşımlı cihazlarda çıkış yapın. |

## Kalan riskler (dürüst liste)
1. **Cihaz/hesap ele geçirilmesi:** Yönetici bilgisayarına kötü amaçlı yazılım bulaşırsa oturum ve TOTP kodu kötüye kullanılabilir. Yumuşak silme ve geçmiş zararı geri alınabilir kılar ama gizliliği geri getirmez.
2. **Oltalama:** Kullanıcı sahte siteye şifre + TOTP girerse engellenemez (WebAuthn/passkey bu projede yok). Kullanıcılara adresi öğretin.
3. **İçeriden tehdit:** Admin tüm veriyi okuyup yazabilir. `auditLog` yalnızca kaydı tutar; `actor` alanı istemci beyanıdır, **kesin kimlik için Cloud Audit Logs (Data Write) açılmalıdır** (bkz. bakım listesi).
4. **Üçüncü taraf betikler:** Google Identity Services ve reCAPTCHA betikleri dışarıdan yüklenir (SRI uygulanamaz). Google'ın ele geçirilmesi durumunda risk vardır.
5. **Yönetici silme yetkisi yok ama bucket/proje sahibi var:** GCP proje sahibi her şeyi silebilir; proje sahipliğini en az kişiyle sınırlayın, 2 kişili kurtarma hesabı tanımlayın. Retention lock açık bucket bunu hafifletir.
6. **Yazılım açıkları:** Bağımlılıklar zamanla zafiyet barındırır (`npm audit`).
7. **Kurallar kapsamı:** Kurallar alan düzeyinde tam şema doğrulaması yapmaz (kritik alanları doğrular); admin geçerli ama yanlış veri yazabilir. Geçmiş kaydı bunu geri almayı sağlar.
8. **Göç:** Eski sistemden taşınan dosya URL'leri eski projeye bağlıdır; eski proje kapatılırsa kopyalanmaları gerekir. Eski sistemde zaten sızmış olabilecek parolalar yeniden kullanılmamalıdır.
9. **Test kapsamı:** Kurallar ve göç testleri otomatiktir; ön yüz sayfaları için uçtan uca (E2E) test yoktur; gerçek projede el ile kabul testi gerekir.

## Düzenli bakım listesi
**Her gün/hafta:** yedek işinin başarısını kontrol edin (Cloud Scheduler / Functions günlükleri); `auditLog` içinde beklenmedik `DELETE-ALERT` kaydı (kurallar silmeyi engellediği için normalde oluşmaz) ve olağandışı toplu değişiklik arayın.
**Aylık:** `npm audit` ve bağımlılık güncellemeleri; kullanıcı/rol dökümü (çalışmayan hesapları devre dışı bırakın); App Check ve Auth metriklerini inceleyin; bütçe uyarıları (Billing → Budgets) kontrolü.
**Üç ayda bir:** **geri yükleme provası** (yedekten deneme projesine import); servis hesabı anahtarlarını döndürün/silin; CSP ve izinli alan adlarını gözden geçirin; yönetici hesaplarının TOTP cihazlarını doğrulayın.
**Bir kez ama unutmayın:** Cloud Audit Logs → Firestore için "Data Write" günlüklerini açın; GCP proje sahiplerini asgariye indirin; Firebase Auth'ta e-posta numaralandırma korumasını açın; Identity Platform'da kayıt (sign-up) kapalı olsun; faturalandırma bütçesi ve uyarıları tanımlayın.
**Olay müdahalesi:** şüpheli hesapta `adminSetRole` ile rolü kaldırıp tokenları iptal edin (fonksiyon `revokeRefreshTokens` çağırır); parolaları `adminResetPassword` ile sıfırlayın; geçmişten (`history`) kayıtları geri alın; gerekirse yedekten import edin.
