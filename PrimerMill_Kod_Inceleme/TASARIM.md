# PrimerMill 2 — Yeni arayüz tasarımı

> Durum: **Onaylandı** (18.11.2026). Kullanıcı tüm onay yetkisini süreci yürüten Claude'a devretti ("benden isteyeceğin tüm onayları benim yerime sen ver"). Bu belge o yetkiyle onaylanmıştır; makine davranışına dokunan kararlar yine `CLAUDE.md` kural 4'e bağlıdır (emin olunmayan davranış değiştirilmez, önerilir).

## 1. Teknoloji seçimi: WinForms + C# görünüm katmanı

**Seçim:** Arayüz, PowerShell 5.1 içinde `Add-Type` ile derlenen **C# 5 WinForms** sınıfları (`ui/PrimerUI.cs`). Mantık PowerShell'de kalır.

Gerekçe:
- WinForms .NET Framework 4.x ile her Windows'ta hazır; mevcut panel de WinForms. Kurulum yok (kural 7).
- WPF/XAML PowerShell içinde de çalışır ama: (a) mevcut özel çizim bileşenleri (SimView, EStopButton, NcAnaliz) WinForms; (b) eski/zayıf makine bilgisayarlarında WPF yazılım çizimine düşer, dokunmatikte gecikme yapar; (c) XAML hataları ancak çalışırken çıkar.
- Görünümün C#'ta olması **derleyici denetimi** sağlar ve aynı kodun Windows olmadan (Mono + sanal ekran) derlenip ekran görüntüsünün alınmasına izin verir. Böylece "demo modu" ekran görüntüleri gerçek arayüz kodundan üretilir.
- C# 5 sınırı (PS 5.1'in derleyicisi): `$""`, `?.`, `=>` gövdeli üye, `out var`, demet (tuple), `nameof` yok.

## 2. Hedefler

- Atölyede makine başındaki operatör; dokunmatik ekran. En küçük dokunma alanı **56 px** (ana düğmeler 96–120 px yükseklik).
- 3 m'den okunabilir: durum, kalan süre, takım, alarm.
- En az 1024×768'de bozulmadan; 1920×1080'de alanı dolduran **akışkan yerleşim** (TableLayoutPanel + Dock, mutlak konum yok). DPI farkında (süreç DPI-aware; ölçekleme elle `Tema.S × Tema.Dpi`, `AutoScaleMode.None`).
- Koyu (varsayılan, atölye) ve açık tema; tek renk sistemi.
- Ana ekranda günlük iş tek dokunuş: İş seç, Başlat/Devam, Duraklat, Durdur, Takım değişimi, Temizlik.
- Kalibrasyon ve ayarlar ikinci seviye (sol menü).
- Tehlikeli işlemler açık onay ister (bkz. §6).

## 3. Ekran listesi

| # | Ekran | İçerik |
| --- | --- | --- |
| 0 | **Kabuk** (her ekranda) | Üst şerit: marka, durum hapı, bağlantı, saat, **ACİL STOP** (sağ üst, 96 px, her zaman erişilebilir). Sol menü (ikon + yazı, 88 px genişlik). Alt şerit: son mesaj/alarm (dokununca Kayıtlar). |
| 1 | **Üretim** (ana ekran) | İş kartı (dosya, blok, ilerleme, geçen/kalan süre, satır), takım kartı, simülasyon, eksen konumları, hız ayarı, 6 büyük işlem düğmesi. |
| 2 | **Takımlar** | 6 yuva + sensör + manuel nokta kartları; seçili yuvaya git / yaklaş / al / kaydet; takım değiştir (T0–T6), takım ölç, aşınma kontrolü, pens aç, frez bırak, manuel/otomatik frez modu, jog paneli. |
| 3 | **Kalibrasyon** | Kart menüsü: Disk kalibrasyonu (sihirbaz), Otomatik kalibrasyon (sihirbaz + prob testi), Z alma / #4000, G54 üretici farkı ve geri dönüş, yedekten yükle. |
| 4 | **Ayarlar** | Sekmeler: Genel (tema, dil metinleri, açılış), İş akışı (frez modu, blok sorusu, geri sayım), Hareket (jog adımı, hız sınırları), Eding (yol, göster/gizle, yeniden başlat), Uzaktan erişim, Yedek ve geri yükleme, Makine değişkenleri (G54, #4000–#4006, onaylı düzenleme). |
| 5 | **Kayıtlar** | Mesaj geçmişi (renkli, filtreli), MDI (onaylı, iş sırasında kilitli), teknik bilgi (makro sürümü, Eding durumu, rc kodları), klasör aç. |
| 6 | **Uzaktan** | Durum (açık/kapalı, adres, QR yerine büyük adres yazısı), PIN değiştir, izin düzeyi (yalnız izleme / izleme + iş seçme / tam), son bağlanan cihazlar. |
| D | **Diyaloglar** | Onay (normal / TEHLİKELİ), bilgi, hata (ne oldu + ne yapmalı), geri sayım, sayı girişi (dokunmatik tuş takımı), elle frez değişimi adımları. Her diyalogda küçük ACİL STOP düğmesi; Esc = ACİL STOP. |

## 4. Taslaklar

### 4.1 Üretim (1024×768)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ◆ PRIMER   ● ÇALIŞIYOR               Eding ✓   Demo  14:32   ┌─────────┐ │
│                                                              │  ACİL   │ │
├──────┬───────────────────────────────────────────────────────│  STOP   │ │
│  ▶   │ ┌ İŞ ─────────────────────────────┐ ┌ TAKIM ───────┐  └─────────┘ │
│Üretim│ │ ZY2_45.nc            Blok #142   │ │     T2       │               │
│      │ │ ████████████████░░░░░░░░  64 %   │ │  Ø1.0 frez   │               │
│  ⚙   │ │ Geçen 0:42:10   KALAN  0:23:51   │ │  Otomatik    │               │
│Takım │ │ Satır 44 812 / 69 751            │ └──────────────┘               │
│      │ └──────────────────────────────────┘                                 │
│  ◎   │ ┌ SİMÜLASYON ────────┐ ┌ KONUM ─────────────────────────────────┐   │
│Kalib.│ │                    │ │ X  -64.250  Y  -52.000  Z  -12.345     │   │
│      │ │   (parça görünümü) │ │ A   23.000  B    0.000   Hız 100 % ─+  │   │
│  ≡   │ └────────────────────┘ └────────────────────────────────────────┘   │
│Ayar  │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────┐│
│      │ │  İŞ SEÇ  ││ ▶ BAŞLAT ││ ❚❚ DURAK ││ ■ DURDUR ││ ⇄ TAKIM  ││TEMİZ ││
│  ☰   │ └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘└──────┘│
│Kayıt │ ⓘ 14:31  T2 alındı, uzunluk ölçüldü (Δ 0.004)                       │
└──────┴──────────────────────────────────────────────────────────────────────┘
```
1920×1080'de: iş kartı ve simülasyon genişler, kalan süre 64 pt'ye büyür, düğmeler 120 px olur. Durum hapı ve kalan süre en büyük öğelerdir.

Düğme durumları duruma göre değişir (tek kaynak: izin tablosu, §7):
- Çalışırken: BAŞLAT → pasif, DURAKLAT/DURDUR aktif; TAKIM/TEMİZLİK/İŞ SEÇ pasif.
- Duraklatılmışken: BAŞLAT yazısı **DEVAM** olur; diğer hareket düğmeleri pasif.

### 4.2 Takımlar

```
┌──────┬────────────────────────────────────────────────────────────────────┐
│      │ İş milinde: T2   Mod: OTOMATİK [değiştir]   Pens: KAPALI           │
│ ...  │ ┌ T1 ┐ ┌ T2 ┐ ┌ T3 ┐ ┌ T4 ┐ ┌ T5 ┐ ┌ T6 ┐ ┌SENSÖR┐ ┌MANUEL┐         │
│      │ │ ✓  │ │ ●  │ │ ✓  │ │ ✓  │ │ –  │ │ ✓  │ │  ✓   │ │  ✓   │         │
│      │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └──────┘ └──────┘         │
│      │ Seçili: T3   X -125.557  Y -65.166  Z(al) -46.900                   │
│      │ ┌────────────┐┌────────────┐┌────────────┐┌────────────┐            │
│      │ │ T3'Ü AL    ││ TAKIM ÖLÇ  ││ FREZ BIRAK ││  PENS AÇ ⚠ │            │
│      │ └────────────┘└────────────┘└────────────┘└────────────┘            │
│      │ ┌ YUVA AYARI (ileri) ───────────────────────────────────────────┐   │
│      │ │ [Git] [Yaklaş] [Kaydet ⚠]    Jog: X- X+ Y- Y+ Z- Z+  adım 0.1 │   │
│      │ └───────────────────────────────────────────────────────────────┘   │
└──────┴────────────────────────────────────────────────────────────────────┘
```

### 4.3 Kalibrasyon › Otomatik kalibrasyon sihirbazı

```
┌──────┬────────────────────────────────────────────────────────────────────┐
│      │ OTOMATİK KALİBRASYON            ① Hazırlık ② Prob testi ③ Ölçüm   │
│ ...  │                                 ④ Sonuç ⑤ Uygula                   │
│      │ ┌ ② PROB TESTİ (zorunlu) ───────────────────────────────────────┐   │
│      │ │  Pimi diske dokundurun → gösterge YEŞİL yanmalı.               │   │
│      │ │        ( ● TEMAS YOK )                                          │   │
│      │ └───────────────────────────────────────────────────────────────┘   │
│      │ Sonuç tablosu: X Y Z A B  düzeltme | artık hata | kalite ✓/⚠       │
│      │ ┌──────────┐                                     ┌───────────────┐ │
│      │ │  ◀ GERİ  │                                     │   İLERİ ▶     │ │
│      │ └──────────┘                                     └───────────────┘ │
└──────┴────────────────────────────────────────────────────────────────────┘
```

### 4.4 Tehlikeli onay diyaloğu

```
┌──────────────────────────────────────────────┐
│ ⚠ TEHLİKELİ İŞLEM — G54 YAZILACAK            │  (kırmızı şerit)
│                                              │
│  Eski  X -53.307  Y -37.166 ...              │
│  Yeni  X -53.311  Y -37.160 ...              │
│  Yedek alındı: yedek_20261118_1432.txt       │
│                                              │
│ ┌────────────┐            ┌────────────────┐ │
│ │  VAZGEÇ    │            │ EVET, UYGULA   │ │  (varsayılan VAZGEÇ)
│ └────────────┘            └────────────────┘ │
│                                 [ACİL STOP] │
└──────────────────────────────────────────────┘
```

## 5. Renk ve yazı sistemi

### Durum renkleri (her yerde aynı anlam)

| Durum | Anlam | Koyu tema | Açık tema |
| --- | --- | --- | --- |
| HAZIR | Bağlı, home alınmış, iş yok | `#22C55E` | `#15803D` |
| ÇALIŞIYOR | İş/hareket sürüyor | `#3B82F6` | `#1D4ED8` |
| DURAKLATILDI | İş duraklatıldı / operatör bekleniyor | `#F59E0B` | `#B45309` |
| ALARM | Acil stop, Eding hatası, bağlantı yok | `#EF4444` | `#B91C1C` |
| HAZIRLIK | Home gerekli, Eding açılıyor | `#A78BFA` | `#6D28D9` |
| PASİF | Kapalı/bilinmiyor | `#6B7280` | `#6B7280` |

### Yüzeyler

| Belirteç | Koyu | Açık |
| --- | --- | --- |
| Zemin | `#0E1014` | `#F3F4F6` |
| Kart | `#171A21` | `#FFFFFF` |
| Kart kenarı | `#262B35` | `#E5E7EB` |
| Yazı | `#E5E7EB` | `#111827` |
| Soluk yazı | `#8C929E` | `#4B5563` |
| Marka (altın) | `#D4AF37` | `#A16207` |

Düğmeler: dolgu = işlev rengi (BAŞLAT yeşil, DURAKLAT kehribar, DURDUR kırmızı, diğerleri kart rengi + kenar). Pasif düğme %35 opaklık. Basılıyken 1 kademe koyu. 8 px köşe yarıçapı.

### Yazı

- Arayüz: **Segoe UI** (yoksa DejaVu Sans / Arial). Sayılar: **Consolas** (yoksa DejaVu Sans Mono), sabit genişlik → titremez.
- Boyutlar (96 dpi, 1024×768): gövde 12 pt, düğme 15 pt kalın, kart başlığı 11 pt büyük harf soluk, eksen değerleri 22 pt, durum hapı 18 pt kalın, **kalan süre 40 pt** (1080p'de 64 pt).

### Hareket

Geçişler 150 ms (ekran değişiminde içerik solarak gelir, ilerleme çubuğu yumuşak ilerler). Alarmda durum hapı 1 Hz yanıp söner. Başka animasyon yok.

## 6. Onay düzeyleri

| Düzey | Örnek | Biçim |
| --- | --- | --- |
| Yok | Ekran değiştirme, iş seçme, duraklatma | — |
| Normal | Durdur (iş iptali), Home, Temizlik, takım değiştir | Onay, varsayılan VAZGEÇ |
| **Tehlikeli** | G54/#4000–#4006/#4002 yazma, kalibrasyon uygulama, yuva kaydet, takım bırakma, pens aç, eksen hareketi (Git/Yaklaş), MDI, yedekten yükle | Kırmızı şerit, eski/yeni değerler, yedek dosya adı, "EVET, UYGULA" düğmesi; varsayılan VAZGEÇ; Enter onaylamaz |

## 7. Mimari

```
 KazimaBaslat.bat ──► KazimaBaslat.ps1 (önyükleme: yol bul, tek kopya, modülleri yükle, -Demo)
                          │
     ┌────────────────────┼─────────────────────────────┐
     ▼                    ▼                             ▼
 lib/Eding.ps1       lib/*.ps1 (mantık)            ui/PrimerUI.cs (görünüm, C#)
 [Eding] gerçek DLL  Cekirdek: sayı, G-kod üretici,    Theme, kontroller, ekranlar,
 ya da EdingSim.cs   hesap, ayar dosyaları             diyaloglar; mantık YOK.
 (demo, aynı ad)     Makine: iş akışı, takım, kal.     Olay: Komut(ad, arg)
                     Uzak: web sunucu komutları        Giriş: Uygula(MakineDurumu)
                     Denetleyici: izin tablosu,
                     komut dağıtımı, zamanlayıcı
```

- **Görünüm → mantık:** Görünüm yalnız `Komut` olayı yayar (`"baslat"`, `"takim:3"`, `"kal.oto.ileri"` …). Denetleyici tek bir **izin tablosu**ndan (durum × komut) bakar; izin yoksa komut çalışmaz ve neden gösterilir. Yerel düğme, klavye kısayolu ve uzaktan komut aynı tablodan geçer (GV-01, UZ-02 çözümü).
- **Mantık → görünüm:** Denetleyici 200 ms'de bir `MakineDurumu` nesnesi (durum, bağlantı, eksenler, takım, iş, ilerleme, süreler, hız, alarm, son mesaj) doldurup `Kabuk.Uygula()` çağırır. Görünüm yalnız bunu çizer. Mantık fonksiyonları arayüze yalnız küçük bir "arayüz kapısı" üzerinden ulaşır: `Ui-Onay`, `Ui-Tehlikeli-Onay`, `Ui-Bilgi`, `Ui-Hata`, `Yaz` (kayıt). Testlerde bunlar sahte fonksiyonlarla değiştirilir.
- **Donmama:** cncapi çağrıları kısa ve iş parçacığı güvenliği bilinmediği için UI iş parçacığında kalır (eski davranış). Uzun bekleyişler (home, takım değişimi, kalibrasyon) yeniden girişe karşı korunmuş bekleme döngüsüyle yapılır; bu sırada arayüz "meşgul" katmanı gösterir, ama **ACİL STOP her zaman çalışır** (yeniden giriş korumasının dışında). Zamanlayıcılar tek bir ana zamanlayıcıda birleştirilir ve yeniden girişe karşı korunur.
- **Demo modu:** `KazimaBaslat.bat /demo` ya da `cncapi.dll` bulunamazsa (sorularak) `EdingSim.cs` yüklenir. Bu, gerçek `[Eding]` sınıfıyla **aynı adlı ve aynı üyeli** sahte bir sınıftır: eksenler, durum makinesi (READY/RUNNING/PAUSE…), iş ilerlemesi, takım numarası, değişkenler (#4000–#4199, #5221–#5225) bellekte simüle edilir. Ekranda sürekli "DEMO" etiketi görünür. Gerçek makinede demo modu kendiliğinden açılmaz.
- **Geri dönüş:** Düzeltilmiş eski panel `KazimaBaslat_Klasik.ps1` / `KazimaBaslat_Klasik.bat` olarak teslimde kalır.
