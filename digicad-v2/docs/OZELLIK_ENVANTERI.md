# Özellik Envanteri (eski sistemden çıkarıldı) ve v2 Eşleştirmesi

Kaynaklar: `PrimerLab_5.html` (admin, 13.000 satır), `HekimPortaliMobil.html`, `TeknisyenPaneliMobil.html`, `GelenIslerPaneliMobil.html`.
Durum sütunu: **TAM** = v2'de çalışır uygulandı, **KISMİ** = çekirdek akış var, ayrıntılar eksik, **YOK** = henüz taşınmadı.

## Veri modeli (eski RTDB `db/digicad/...` → v2 Firestore `labs/digicad/...`)
doctors, jobs, payments, technicians, pendingJobs, expenses, sales, orderForms, doctorSubmissions, statementClosures, settings, mailFilters, chats/{dr_ID|tech_ID|**job_İŞID**}/messages, pass (taşınmaz). İş durumları: `Bekliyor, Tasarımda, Üretimde, Makyajda, Tamamlama Onayı, Tamamlandı` (eski kodda ayrıca yazım varyantı `Bekleyen`; `Beklemede/Gönderildi/İptal` **satış** durumlarıdır); bekleyen: `Onay Bekliyor/Onaylandı/Reddedildi`; hekim gönderimi: `Yeni/İncelendi/Aktarıldı/Reddedildi`. Çalışma alanları: `digicad` ve `primer` — v2'de her biri ayrı `lab` claim'li yönetici hesabıyla yönetilir (bir yönetici yalnızca kendi alanını görür).

## Admin paneli
| Sayfa / özellik | v2 durumu |
|---|---|
| Genel Bakış (sayaçlar, gecikenler, açık bakiye, bu ay gider) | TAM |
| Sipariş Formu (çok kalem, para birimi, hekim fiyat listesi, otomatik teknisyen `autoTechId`, **FDI diş şeması**, yazdırma) | TAM |
| Hekimden Gelenler (siparişe aktar, reddet, dosya/ZIP, yumuşak silme) | TAM; aktarımda dosyalar `copyJobFiles` ile işe kopyalanır |
| Mesajlar (hekim/teknisyen konuşmaları, **iş sohbetleri `job_*`**, görsel/PDF eki, mesaj gizleme) | TAM |
| Onay Bekleyen (onayla/reddet/düzenle; biten iş onayı) | TAM; hekim eşleşmezse hekim seçtirir (hekimsiz iş oluşmaz) |
| İş Dağıtım Merkezi (atama, yük, en az yüklü öneri) | TAM |
| Devam Eden / Tamamlanan İşler (durum, arama/süzme, detay sekmeleri: genel, tarama, tasarım, sipariş formu, geçmiş; yumuşak silme) | TAM; eski/bilinmeyen durum "(eski)" olarak gösterilir |
| Dosyalar (iş dosyaları, **toplu ZIP**) | TAM (Storage CORS gerekir) |
| Hekimler (CRUD, hesap aç/şifre sıfırla, fiyat listesi, bakiye/ekstre, dönem kapatma/geri alma) | TAM; silince Auth hesabı devre dışı (`adminDisableUser`) |
| Teknisyenler (CRUD, hesap, özet) | TAM |
| Mail Kutusu (Gmail GIS bellek-içi token + `parseOrderMail`, filtreler) | KISMİ (filtre yönetimi temel; ayrıştırma yalnızca öneri) |
| Kasa / Arşiv (tahsilat, ekstre, dönem kapatma) | TAM (kapalı dönem kurallarla korunur) |
| Giderler | TAM |
| Aylık Rapor | TAM (İstanbul saatine göre aylar, çok para birimli) |
| Satışlar (`sales`: Sarf/Servis/Karma, KDV, yazdırma) | TAM |
| Silinenler (geri alma) | TAM |
| Ayarlar (lab bilgisi, JSON anlık yedek indirme) | TAM; şifre/PIN KALDIRILDI (bilinçli) |
| Çalışma alanı | `lab` claim'ine bağlı (seçici yok; ikinci alan için ayrı yönetici hesabı) |
| Bildirimler (tamamlandı / onay bekliyor / tasarım yüklendi) | KISMİ (canlı toast; e-posta/push yok) |
| Yazdırma çıktıları (sipariş formu, iş emri, ekstre, listeler) | TAM |
| Denetim/geçmiş görüntüleme (`auditLog`, `history`) | KISMİ (iş geçmişi sekmesi + Ayarlar'da son 50 denetim kaydı: `oversize`, sıkıştırılmış kayıt, `actor:'system'` yedek durumu gösterilir; filtre/arama ve eski kayıt sayfalama YOK) |

## Hekim portalı
Giriş (Auth), hekimin işleri (devam eden/tamamlanan, arama/tarih süzgeci, yazdır), **yeni gönderim (FDI diş şeması, renk, notlar, tarama dosyaları)**, gönderimlerim (aşama göstergesi, bağlı işler), laboratuvarla mesajlaşma ve **iş sohbeti** (iş detayından) — TAM. Çöpteki kayıtlar görünmez.

## Teknisyen paneli
Atanmış işler, durum güncelleme (eski durum değerleri korunur), tasarım dosyası yükleme, not, mesajlaşma, **iş sohbeti**, hızlı iş talebi (`pendingJobs`, hekim yönetici onayında seçilir) — TAM. Çöpteki kayıtlar görünmez; hekim gönderimi dosyaları siparişe aktarılınca `jobFiles` altına kopyalandığı için görünür.

## Gelen İşler paneli (yalnızca yönetici)
`doctorSubmissions` (görüldü/reddet/yazdır) ve `orderForms` (yazdırıldı) — TAM.

## Henüz YOK / bilinen eksikler
Denetim günlüğü filtre/arama/sayfalama (yalnızca son 50 kayıt); e-posta/push bildirimi; Storage dosyalarının otomatik yedeği (sürümleme elle açılır); E2E tarayıcı testleri; WebAuthn/passkey.

## Bilinçli değişiklikler
4 haneli PIN ve düz metin şifreler kaldırıldı; localStorage'a hasta verisi yazılmaz; fiziksel silme yok; çalışma alanları arası geçiş kaldırıldı (claim'e bağlı); iş sohbetlerinde adlar yerine rol etiketi gösterilir (eski davranış).
