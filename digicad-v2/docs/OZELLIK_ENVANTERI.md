# Özellik Envanteri (eski sistemden çıkarıldı) ve v2 Eşleştirmesi

Kaynaklar: `PrimerLab_5.html` (admin, 13.000 satır), `HekimPortaliMobil.html`, `TeknisyenPaneliMobil.html`, `GelenIslerPaneliMobil.html`.
Durum sütunu: **TAM** = v2'de çalışır uygulandı, **KISMİ** = çekirdek akış var, ayrıntılar eksik, **YOK** = henüz taşınmadı.

## Veri modeli (eski RTDB `db/digicad/...` → v2 Firestore `labs/digicad/...`)
doctors, jobs, payments, technicians, pendingJobs, expenses, sales, orderForms, doctorSubmissions, statementClosures, settings, mailFilters, chats/{dr_ID|tech_ID}/messages, pass (taşınmaz). İş durumları: `Bekliyor, Tasarımda, Üretimde, Makyajda, Tamamlama Onayı, Tamamlandı`; bekleyen: `Onay Bekliyor`; hekim gönderimi: `Yeni/Aktarıldı/Reddedildi`. Çalışma alanları: `digicad` (Firebase) ve `primer` (eski sistemde tarayıcı yerelinde, çevrimdışı).

## Admin paneli
| Sayfa / özellik | v2 durumu |
|---|---|
| Genel Bakış (sayaçlar, özet) | KISMİ (sayaçlar, açık işler, gecikenler) |
| Sipariş Formu (çok kalemli sipariş, otomatik teknisyen `autoTechId`, yazdırma) | KISMİ (çok kalem + otomatik atama + yazdır; diş şeması seçici YOK, dişler metin) |
| Hekimden Gelenler (inceleme, siparişe aktar, reddet) | TAM (aktar/reddet) |
| Mesajlar (hekim/teknisyen konuşmaları, dosya) | KISMİ (metin; dosya eki Storage kurallarında hazır, arayüzde YOK) |
| Onay Bekleyen (onayla/reddet) | TAM |
| İş Dağıtım Merkezi (teknisyene atama) | KISMİ (liste + atama) |
| Devam Eden / Tamamlanan İşler (durum, detay, yumuşak silme) | TAM (renk/ayrıntılı detay sekmeleri KISMİ) |
| Dosyalar (iş dosyaları listesi/indirme) | KISMİ (liste/indirme, toplu ZIP YOK) |
| Hekimler (CRUD, hesap oluşturma, bakiye/ekstre) | KISMİ (CRUD, hesap, bakiye; ekstre kapama temel) |
| Teknisyenler (CRUD, hesap) | KISMİ |
| Mail Kutusu (Gmail GIS + OpenAI ayrıştırma, filtreler) | KISMİ (GIS bellek-içi token, `parseOrderMail`; filtre yönetimi temel) |
| Kasa / Arşiv (tahsilatlar, ekstre kapama) | KISMİ |
| Giderler | TAM (CRUD + yumuşak silme) |
| Aylık Rapor | KISMİ (ciro/tahsilat/gider/net) |
| Satışlar (`sales`) | KISMİ |
| Silinenler (geri alma) | TAM |
| Ayarlar | KISMİ (otomatik teknisyen, genel); şifre/PIN KALDIRILDI (bilinçli) |
| Çalışma alanı seçimi (digicad/primer) | TAM (`labs/primer`) |
| Tamamlandı / tasarım yüklendi bildirimleri | KISMİ (canlı toast) |
| Yazdırma çıktıları | KISMİ (sipariş formu, ekstre) |

## Hekim portalı
Giriş (v2: Auth), hekimin işleri + durum, yeni gönderim (hasta, iş türü, dişler, renk, notlar, tarama dosyaları), gönderimlerim, mesajlaşma — KISMİ/TAM (diş şeması yerine metin).

## Teknisyen paneli
Atanmış işler, durum güncelleme, tasarım dosyası yükleme, not, mesajlaşma, hızlı iş talebi (`pendingJobs`) — KISMİ/TAM.

## Gelen İşler paneli
`orderForms`/yeni işlerin listesi ve yazdırma durumu — KISMİ.

## Bilinçli değişiklikler
4 haneli PIN ve düz metin şifreler kaldırıldı; localStorage'a hasta verisi yazılmaz; fiziksel silme yok.
