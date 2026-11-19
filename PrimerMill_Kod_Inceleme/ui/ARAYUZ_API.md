# PrimerMill 2 — Arayüz sözleşmesi (`ui/PrimerUI.cs`)

Bu belge görünüm katmanı ile denetleyici (PowerShell) arasındaki tam sözleşmedir. Tasarım: `TASARIM.md`. Özellik listesi: `OZELLIK_ENVANTERI.md`.

- **Görünüm yalnız çizer.** Eding çağrısı, G-kod, dosya işlemi yok. Ekranlar veri çekmez; her şey `Kabuk.Uygula(MakineDurumu)` ile gelir.
- **Her kullanıcı eylemi** `Kabuk.Komut` olayıyla (`KomutArgs.Ad`, `KomutArgs.Arg`) dışarı çıkar. Görünüm hiçbir eylemin yapılıp yapılmayacağına karar vermez; onayları (Onay / TehlikeliOnay) **denetleyici** açar.
- **İzinler** `Kabuk.IzinleriUygula(...)` ile gelir; pasif düğme %35 opaklıkla çizilir, nedeni düğmenin altında (yer varsa), ipucunda ve dokununca alt şeritte gösterilir.
- Derleyici: C# 5 (PS 5.1 `Add-Type`), .NET Framework 4.x. Başvurular: `System`, `System.Drawing`, `System.Windows.Forms`, `System.Core`. Dosya BOM'lu UTF-8.

## 1. Yükleme (PowerShell 5.1, 32 bit)

```powershell
Add-Type -Path "$PSScriptRoot\..\ui\PrimerUI.cs" `
    -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core
# (Add-Type -TypeDefinition (Get-Content ... -Raw -Encoding UTF8) da olur)
[System.Windows.Forms.Application]::EnableVisualStyles()
$kabuk = New-Object PrimerUI.Kabuk
$kabuk.FormBorderStyle = 'None'; $kabuk.WindowState = 'Maximized'   # tam ekran tercihi denetleyicide
[PrimerUI.Diyalog]::AcilStop = [Action]{ Acil-Stop 'diyalog' }        # verilmezse "acilstop" komutu gönderilir
$kabuk.add_Komut({ param($s, $e) Komut-Isle $e.Ad $e.Arg })
$zaman = New-Object System.Windows.Forms.Timer; $zaman.Interval = 200
$zaman.add_Tick({ $kabuk.Uygula((Durum-Topla)) })                    # MakineDurumu doldur
$kabuk.IzinleriUygulaTablo(@{ 'is.baslat' = $false }, @{ 'is.baslat' = 'Önce iş seçin' })
[System.Windows.Forms.Application]::Run($kabuk)
```

Sayılar görünümde her yerde `InvariantCulture` ile biçimlenir; komut argümanlarındaki sayılar da `.` ondalıklıdır (ör. `KalT=16.02`).

## 2. `Kabuk` (ana pencere, `Form`)

| Üye | Açıklama |
|---|---|
| `event EventHandler<KomutArgs> Komut` | Her kullanıcı eylemi. `e.Ad`, `e.Arg` (boş olabilir, null olmaz). |
| `void Uygula(MakineDurumu d)` | Tüm ekranları günceller (UI iş parçacığı dışından çağrılırsa `BeginInvoke`). |
| `void IzinleriUygula(IDictionary<string,bool> izin, IDictionary<string,string> neden)` | İzin tablosu. Bkz. §6. |
| `void IzinleriUygula(IDictionary<string,string> neden)` | Kısa yol: tablodaki her anahtar pasif, nedeni değer. Tabloda olmayan her şey etkin. |
| `void IzinleriUygulaTablo(IDictionary izin, IDictionary neden)` | PowerShell `Hashtable` kolaylığı. |
| `void TemaUygula(bool koyu)` | Koyu / açık tema (çalışırken). Ayarlar › Genel › Tema da bunu çağırır ve `ayar.kaydet Tema=koyu|acik` gönderir. |
| `void EkranGoster(string ad)` | `uretim`, `takimlar`, `kalibrasyon`, `ayarlar`, `kayitlar`, `uzaktan`; alt sayfa: `takimlar.yuva`, `takimlar.hareket`, `takimlar.ismili`, `kalibrasyon.disk`, `kalibrasyon.oto`, `ayarlar.0`…`ayarlar.6`. |
| `void Bildir(string metin, MesajTuru tur)` | Alt şeritte 5 sn görünen bildirim (kalıcı pencere açmaz; KU-09). |
| `void MesgulGoster(string metin)` | İçerik alanını "meşgul" katmanıyla kapatır (null = kaldır). Üst şerit ve ACİL STOP açık kalır. `MakineDurumu.Mesgul` ile de yapılır. |
| `Uretim`, `Takimlar`, `Kalibrasyon`, `Ayarlar`, `Kayitlar`, `Uzaktan` | Ekran nesneleri (salt okunur alanlar). |
| `Uretim.SimHost`, `Uretim.SimHostBuyuk` | `SimHostPanel`. Denetleyici mevcut `SimView`'i `Controls.Add` + `Dock=Fill` ile buraya koyar. Boşken yer tutucu (stilize disk + dosya adı) çizilir. `Uretim.BuyukSimDegisti` olayı ve `sim.buyuk` komutu, SimView'i iki yuva arasında taşımak içindir. |
| `SonDurum`, `EtkinEkran`, `UstSeritYuksekligi`, `AcilStopEkranda` | Bilgi. |
| Esc tuşu | Her yerde `acilstop` (ana pencere, MDI kutusu dahil). |

Yerleşim akışkandır (TableLayoutPanel + Dock, `AutoScaleMode.Dpi`). Katsayı `Tema.S = min(W/1024, H/768)` (0.8–1.7): 1024×768'de 1.0, 1920×1080'de ≈1.4; yazılar ve satır yükseklikleri buna göre ölçeklenir.

## 3. Komutlar

Sütunlar: **Ad** · **Arg** · **Nereden** · **Önerilen onay** (TASARIM §6; onayı denetleyici açar). Hareket ya da ayar yazan komutlar için kural 4 geçerlidir: makine davranışı değişmez, mevcut fonksiyon çağrılır.

### 3.1 Genel / kabuk

| Ad | Arg | Nereden | Onay |
|---|---|---|---|
| `acilstop` | — | Üst şerit ACİL STOP (basıldığı an), her diyalogdaki küçük ACİL STOP ve diyalog açıkken ana ACİL STOP'un üstüne konan canlı katman (Diyalog.AcilStop atanmamışsa), Esc | yok — anında |
| `acilstop.kaldir` | — | Alt şerit (alarm bandı) "KİLİDİ KALDIR", Üretim bakım şeridi (acil stop varken) | Normal |
| `makine.reset` | — | Alt şerit "ALARMI TEMİZLE" (Durum=Alarm), Üretim "ALARMI TEMİZLE" | Normal (çalışırken) |
| `ekran` | ekran adı | Ekran değişti (bilgi) | — |
| `panel.kucult` / `panel.kapat` | — | Ayarlar › Genel › Panel penceresi | kapat: Normal (çalışırken uyarılı) |

### 3.2 Üretim

| Ad | Arg | Nereden | Onay |
|---|---|---|---|
| `is.sec` | — | İŞ SEÇ | yok (denetleyici `Diyalog.ListeSec` ya da OpenFileDialog açar) |
| `is.baslat` | — | BAŞLAT (durum ≠ Duraklatildi) | denetleyicinin mevcut akışı (yarım iş → `Diyalog.Devam`, frez bırakma sorusu…) |
| `is.devam` | — | Aynı düğme, Durum=Duraklatildi iken yazısı **DEVAM** | önerilen: kısa Onay (KU-16, MAKİNEDE DOĞRULA) |
| `is.duraklat` | — | DURAKLAT | yok |
| `is.durdur` | — | DURDUR (DURAKLAT'tan 14 px boşlukla ayrık) | Normal (KU-02) |
| `takim.degistir` | `0`–`6` | TAKIM → `Diyalog.TakimSec` (görünüm içi seçim) ; Takımlar › "Tn'Yİ AL" | Normal |
| `temizlik` | — | TEMİZLİK | Normal (KU-13) |
| `park` | — | PARK (bakım şeridi; eski TEMİZLİK'in 2. basışı ayrı düğme oldu) | Normal |
| `home` | — | HOME (bakım şeridi; home alınmamışsa altın kenar + "home gerekli") | Normal |
| `hiz.azalt` / `hiz.artir` / `hiz.normal` | — | İlerleme oranı [−] [+]; yüzdeye dokunmak = %100 | %120 üstü: denetleyici onayı |
| `ayar.kaydet` | `Koordinat=0|1` | Konum kartı İŞ/MAKİNE ya da eksen paneline dokunmak | yok |
| `blok.kazibasla` | `isim|kalınlık|derinlik` | YENİ BLOK → `Diyalog.YeniBlok` → KAZI VE İŞE BAŞLA | denetleyici |
| `blok.sadeceisim` | `isim|kalınlık|derinlik` | … → SADECE İSMİ KAZI | Normal (hareket) |
| `blok.yenihazir` | `isim|kalınlık|derinlik` | … → YENİ BLOK HAZIR (uzaktan başlatma kilidini açar) | yok |
| `blok.kullanilmis` | — | … → KULLANILMIŞ BLOK | yok |
| `blok.iptal` | — | … → BEKLEYENİ İPTAL | yok |
| `sim.buyuk` | `1` / `0` | Simülasyon kartı başlığı/alanı (BÜYÜT), büyük görünümde KÜÇÜLT | — |
| (izin anahtarı) `blok.yeni` | — | YENİ BLOK düğmesinin etkinliği (diyaloğu açmadan önce) | — |

Kalan kartında dosya uyarı/hata sayısı (`⚠ 2 UYARI`) dokunulunca görünüm içi `Diyalog.Bilgi` ile listelenir (KU-11).

### 3.3 Takımlar

| Ad | Arg | Nereden | Onay |
|---|---|---|---|
| `frez.modu` | `MANUEL` / `OTOMATIK` | Başlık şeridi "MANUELE AL / OTOMATİĞE AL" | Normal (makro sürüm kontrolü denetleyicide) |
| `takim.degistir` | `1`–`6` | Takım değişimi › "T3'Ü AL" (seçili yuva) | Normal |
| `frez.birak` | — | FREZİ BIRAK (M6 T0) | **Tehlikeli** |
| `takim.olc` | — | TAKIM BOYUNU ÖLÇ (ayrıca Kalibrasyon kartı ve sihirbazlar) | Normal |
| `takim.asinma` | — | AŞINMA KONTROLÜ (M100) | Normal |
| `takim.bosmu` | — | İŞ MİLİ BOŞ MU? | Normal |
| `yuva.git` | `T1`…`T6`, `SENSÖR`, `MANUEL` | YUVAYA GİT, Yuva ayarı › GİT | **Tehlikeli** (hareket) |
| `yuva.yaklas` | aynı | YAKLAŞ (#4001) | **Tehlikeli** |
| `eksen.yukari` | — | YUKARI / İŞ MİLİ EN ÜSTE | Normal |
| `pens.ac` | — | PENS AÇ (her yerde kırmızı çerçeveli) | **Tehlikeli** (KU-01) |
| `pens.kapat` | — | PENS KAPAT | yok |
| `hava.ufle` | — | HAVA / HAVA ÜFLE | yok |
| `yuva.al` | yuva adı | BU KONUMU AL (bellekte; Eding'e yazmaz) | yok |
| `yuva.kaydet` | — | KAYDET (hepsi) | **Tehlikeli** (özet + yedek) |
| `yuva.sifirla` | — | BAŞTAN | Normal |
| `yuva.varsayilan` | — | DOĞRULANMIŞ değerlere dön | **Tehlikeli** |
| `yuva.test` | `1`–`6` | TEST AL | Normal |
| `yuva.zal` | `1` / `0` | "T1 alınırken Z'yi de al" anahtarı (`MakineDurumu.Ayarlar["YuvaZ"]` ile gösterilir) | yok |
| `yuva.geometri.oku` | — | MACRO'DAN OKU | yok |
| `jog` | `<eksen><yön>|<adım>|<hız>` ör. `Z-|0.1|300` | Yuva ayarı (adım 0.01–1, hız 100) ve Hareket sekmesi (adım 0.01/0.1/1/10, hız 100/300/1000) | Z− ≥ 10 mm: Normal (mevcut kural) |
| `jog.basla` / `jog.bitir` | `X+|300` / `X` | Hareket sekmesi adım = SÜREKLİ iken basılı tut / bırak | **yeni özellik; MAKİNEDE DOĞRULA** (denetleyici desteklemiyorsa `jog.basla` için izin kapatılır) |
| `konum.koldz` | — | KOL DÜZ (TAKIM ALMA) | Normal |
| `konum.takimalani` | — | TAKIM ALANI | Normal |
| `konum.blok` | — | BLOK DEĞİŞTİRME | Normal |
| `konum.park` | — | PARK (G30) | Normal |
| `ismili.calistir` | devir, ör. `18000` | İş mili › ÇALIŞTIR (M3); devir kutusu 1000–24000 | Normal |
| `ismili.durdur` | — | DURDUR (M5) | yok |
| `sogutma.m7` / `sogutma.m8` / `sogutma.kapat` | — | Soğutma kartı | yok |

### 3.4 Kalibrasyon

Sihirbaz adımı **denetleyicinindir**: `MakineDurumu.DiskAdim` / `OtoAdim` (0–4). Görünüm `ileri/geri/adim` komutlarını gönderir; denetleyici izin veriyorsa adımı değiştirip bir sonraki `Uygula`'da yansıtır. Prob testi geçilmeden `kal.oto.ileri` için izin kapatılmalıdır (görünüm ② adımını kehribar halkayla gösterir).

| Ad | Arg | Nereden | Onay |
|---|---|---|---|
| `kal.ac` | `hub` / `disk` / `oto` | Kart menüsü ↔ sihirbaz geçişi (değer okumak için: eski `Sekme-Goster` → `Ayar-Oku`) | — |
| `kal.disk.ileri` / `kal.disk.geri` | — | Sihirbaz alt şeridi | — |
| `kal.disk.adim` | `0`–`4` | Adım göstergesine dokunma | — |
| `kal.disk.bitir` | — | Son adımda BİTİR | — |
| `kal.uretici` | — | ① ÜRETİCİ DEĞERLERİNE DÖN; kart menüsü ÜRETİCİYE DÖN | **Tehlikeli** (fark listesi + yedek) |
| `ayar.kaydet` | `KalT=…`, `KalD=…`, `KalSA/KalSB/KalSY=0|1` | ② disk kalınlığı, T1 çapı; ③ yön ters anahtarları | yok |
| `kal.disk.test` | `1`–`4` | ② Test no; YENİ DİSK (TEST 1) → `1` | yok |
| `kal.disk.hazirla` | — | ② TEST PROGRAMINI HAZIRLA | Normal (+ frez modu sorusu) |
| `kal.disk.olcum` | `<anahtar>=<mm>` (`w,d1,d2,dR,dL,dF,dK,dAp,dAm`) | ③ 9 ölçüm kutusu (tuş takımı) | yok |
| `kal.disk.hesapla` | — | ④ HESAPLA | yok |
| `kal.disk.uygula` | — | ⑤ UYGULA VE KAYDET | **Tehlikeli** (eski/yeni + yedek) |
| `kal.disk.gecmis` | — | ⑤ GEÇMİŞ; Ayarlar › Yedekler | yok |
| `kal.oto.ileri` / `geri` / `adim` / `bitir` | aynı biçim | Oto sihirbaz | — |
| `ayar.kaydet` | `OkT=…`, `OkUc=duz|kure`, `OkUcD=…` | ① kalınlık (kutu + 10/12/18/20 hızlı seçim), temas ucu, uç çapı | yok |
| `kal.prob.basla` / `kal.prob.durdur` | — | ② PROB TESTİNİ BAŞLAT/DURDUR (hareketsiz) | yok |
| `kal.prob.ogren` | — | ② GİRİŞİ YENİDEN ÖĞREN | yok |
| `kal.oto.hazirla` | — | ③ ÖLÇÜM PROGRAMINI HAZIRLA | Normal |
| `kal.oto.oku` | — | ④ SONUÇLARI OKU | yok |
| `kal.oto.uygula` | — | ⑤ UYGULA VE KAYDET | **Tehlikeli** (+ büyükse 2. onay) |
| `kal.oto.gecmis` | — | ⑤ GEÇMİŞ; Ayarlar › Yedekler | yok |
| `kal.zalma` | — | Kart menüsü "Z = ALMA (#4000)"; Makine değişkenleri | **Tehlikeli** |
| `kal.g92sifirla` | — | Kart menüsü, Makine değişkenleri | **Tehlikeli** |
| `kal.konum.yuva` | `T1`…`T6` / `SENSÖR` | Kart menüsü KONUMU KAYDET → görünüm içi `Diyalog.Secim` | **Tehlikeli** (+ T1 için "diğerlerini kaydır" sorusu) |
| `yedek.al` / `yedek.yukle` | — | Kart menüsü Yedekler; Ayarlar › Yedekler | yükle: **Tehlikeli** |
| `klasor.ac` | `isler` / `loglar` / `yedekler` / `eding` | Kalibrasyon, Ayarlar, Kayıtlar | yok |

### 3.5 Ayarlar

| Ad | Arg | Nereden |
|---|---|---|
| `ayar.kaydet` | `<Anahtar>=<değer>` | Tüm anahtar / seçim / değer kutuları. Anahtarlar: `Tema` (koyu/acik), `MakineAdi`, `SanalKlavye`, `TamEkran`, `WinBaslangic`, `Koordinat`, `Dansci`, `FrezModu` (MANUEL/OTOMATIK), `OtomatikHazirlik`, `GeriSayim` (0–60), `SadeTaraf` (3/9), `ModSor`, `BlokSor`, `JogAdim`, `JogHiz`, `EdingGizli`, `EdingSifirla`, `Uzak`, `UzakKilit` — açık/kapalı değerleri `1`/`0` |
| `eding.goster` / `eding.gizle` | — | Eding sekmesi |
| `eding.yeniden` | — | Eding sekmesi (Tehlikeli değil, Normal onay; iş sürerken izin kapatılmalı) |
| `eding.kapat` | — | Eding'i ayarları kaydederek kapat (Normal onay) |
| `degisken.oku` | — | Makine değişkenleri › DEĞERLERİ OKU, VAZGEÇ |
| `degisken.kaydet` | `5221=…;5222=…;5223=…;5224=…;5225=…;4000=…;…;4006=…` (tüm 12 değer) | KAYDET (değişen kutular kehribar çerçeveli) — **Tehlikeli**; eski davranışta otomatik yedek yoktu, denetleyici yedek almalı |

### 3.6 Kayıtlar ve Uzaktan

| Ad | Arg | Nereden | Onay |
|---|---|---|---|
| `mdi.gonder` | satır (BÜYÜK HARF, kırpılmış) | MDI kutusu Enter ya da GÖNDER (⌨ ile ekran klavyesi) | **Tehlikeli** (KU-03; G10/#5xxx/#4xxx için ek uyarı + yedek önerilir) |
| `uzak.ac` | `1` / `0` | Uzaktan › anahtar | Normal |
| `uzak.pin` | 4–8 rakam ya da boş | PIN DEĞİŞTİR → `Diyalog.MetinGir` (rakam) | yok |
| `uzak.izin` | `izle` / `sec` / `tam` | İzin düzeyi | yok (**yeni**: sunucu tarafında uygulanmalı) |

## 4. `MakineDurumu` alanları

Tüm alanlar düz (public field). Listeler kurucuda boş oluşturulur; `null` verilirse görünüm "yok" kabul eder.

| Alan | Tür | Kullanım |
|---|---|---|
| `Durum` | `Durum` {Pasif, Hazirlik, Hazir, Calisiyor, Duraklatildi, Alarm} | Durum hapı rengi/yazısı, BAŞLAT↔DEVAM, alarm bandı |
| `DurumMetni` | string | Üretim durum satırı ("Kazınıyor", "Home alınmadı"…) |
| `Bagli`, `Demo`, `EdingSimulasyon`, `Onizleme` | bool | Üst şerit çipleri: Eding bağlı/değil, DEMO, SİMÜLASYON, ÖNİZLEME |
| `HomeAlindi` | bool | "Home gerekli" çipi, HOME düğmesi vurgusu |
| `AcilStop` | bool | Hap "ACİL STOP" (1 Hz yanıp söner), kırmızı alt bant + KİLİDİ KALDIR, E-stop beyaz halka |
| `ExtErr` | bool | (bilgi; denetleyici alarm metniyle verir) |
| `Mesgul` | string | Doluysa meşgul katmanı (ör. "Home alınıyor…") |
| `MakineAdi`, `Surum` | string | Üst şerit, Ayarlar |
| `X,Y,Z,A,B` / `MX,MY,MZ,MA,MB` | double | İş / makine konumu (ikisi birlikte; KU-24) |
| `KoordMakine` | bool | Makine konumu büyük gösterilsin (ya da `Ayarlar["Koordinat"]`) |
| `Takim`, `TakimAciklama` | int, string | Takım kartı (0 = boş) |
| `FrezModu` | "OTOMATIK"/"MANUEL" | Takım kartı, Takımlar başlığı |
| `PensAcik`, `HavaYok` | bool | Pens/hava göstergeleri |
| `ManuelMesaj` | string | İş kartında kehribar "MANUEL FREZ: …" (HavaYok → kırmızı "KOMPRESÖRÜ AÇ") |
| `Dosya`, `Blok` | string | İş kartı, simülasyon yer tutucusu |
| `Satir`, `ToplamSatir` | int | "44 812 / 69 751" |
| `Yuzde` | double 0–100 | İlerleme bandı (yumuşak), yüzde |
| `GecenSn`, `KalanSn`, `TahminiSn` | int | GEÇEN, KALAN (en büyük öğe), tahmini |
| `BitisSaati` | string "HH:mm" | BİTİŞ |
| `IsTakimlari` | string | "T1 · T2 · T3" |
| `IsUyarilari`, `IsHatalari` | List<string> | Ön kontrol rozeti + liste; hata varsa kırmızı şerit |
| `IsTamamlandi` | bool | KALAN yerine "BİTTİ" (yeşil) |
| `Hiz` | int % | İlerleme oranı (>120 kırmızı, ≠100 yeşil) |
| `BlokDurum`, `BekleyenBlok`, `BlokSonrakiIsim`, `BlokKalinlik`, `BlokDerinlik` | | Bakım şeridi yazısı, Yeni blok diyaloğu varsayılanları |
| `SonMesaj`, `SonMesajTuru`, `SonMesajZamani` | | Alt şerit; Hata ise Kayıtlar menüsünde rozet |
| `Yuvalar` | List<YuvaBilgisi> | Takımlar kartları + yuva listesi; `TakimSec` açıklamaları |
| `YuvaOrtak`, `YuvaDurum`, `YuvaKaydedilmemis` | | Yuva ayarı ortak değerler, "KAYDEDİLMEDİ" |
| `IsMiliDevir`, `IsMiliCalisiyor`, `M7`, `M8` | | İş mili ve hava sekmesi |
| `G54[5]`, `G92[5]`, `Param[7]` (#4000–#4006), `DegiskenlerOkundu` | double[] | Makine değişkenleri, Kalibrasyon bilgi şeridi (G92 X/Y/A/B ≠ 0 → kırmızı uyarı) |
| `UreticiFark`, `RafOzeti`, `SonYedek` | string | Kalibrasyon kart menüsü, Ayarlar › Yedekler |
| `DiskAdim`, `DiskTestNo`, `DiskOlcum` (Dictionary anahtar→metin), `DiskYerlesim`, `DiskDurum`, `DiskSonuc` (List<KalSonucSatiri>), `DiskUyarilar`, `DiskSonucHazir` | | Disk sihirbazı |
| `OtoAdim`, `ProbTestAktif`, `ProbTemas`, `ProbTestGecti`, `ProbGiris`, `OtoDurum`, `OtoOlcumBitti` (#4100=1 ve kimlik eşleşti), `OtoSonucHazir`, `OtoBuyuk`, `OtoSonuc`, `OtoKalite` (List<KalKaliteSatiri>), `OtoUyarilar` | | Oto sihirbazı; `OtoOlcumBitti && !OtoSonucHazir` → Kalibrasyon menüsünde rozet |
| `Ayarlar` | Dictionary<string,string> | `panel_ayarlar.ini` anahtarları (§3.5) + `YuvaZ` |
| `Kayitlar` | List<KayitSatiri {Zaman, Tur, Metin}> | Kayıtlar listesi (renk türe göre, filtre) |
| `Teknik` | List<BilgiSatiri {Ad, Deger, Tur}> | Teknik bilgi (Eding durumu, rc, makro sürümü, home, ayarlı frezler, klasör, log…) |
| `Klasorler` | List<BilgiSatiri> | `Ad="Eding"` → Ayarlar › Eding klasörü |
| `UzakAcik`, `UzakAdres`, `UzakAdresler`, `UzakPin`, `UzakIzin`, `UzakDurumMetni`, `UzakCihazlar` (List<UzakCihaz {Adres, Zaman, Son}>) | | Uzaktan ekranı |

Yardımcı sınıflar: `YuvaBilgisi {Ad, Aciklama, Kayitli, Dolu, IsMilinde, Uyari, X,Y,Z,A,B, ZVar, Yeni, Fark}`, `KalSonucSatiri {Eksen, Eski, Duzeltme, Yeni, Iyi}`, `KalKaliteSatiri {Ad, Deger, Tur}`, `MesajTuru {Bilgi, Basari, Uyari, Hata}`.

## 5. `Diyalog` (statik)

Hepsi temalı, dokunmatik boyutlu (düğmeler ≥ 56 px), sahibi `Kabuk`, Kabuk'un üst şeridinin altına ortalanır. **Her diyalogda küçük ACİL STOP** ve **Esc = ACİL STOP** (`Diyalog.AcilStop` çağrılır, diyalog "vazgeç" sonucuyla kapanır). Ayrıca diyalog açıkken Kabuk'un büyük ACİL STOP düğmesinin tam üstüne diyaloğa ait canlı bir ACİL STOP konur (modal pencere sahibi devre dışı bıraktığı için; KU-12).

| Üye | Dönüş | Not |
|---|---|---|
| `Action AcilStop` | — | Kabuk atanmamışsa `acilstop` komutunu bağlar. |
| `int AcikSayisi` | — | Açık diyalog sayısı (uzaktan komut kuyruğu için). |
| `Form Sahip` | — | Kabuk kendini atar. |
| `Onay(baslik, metin [, evetMetni])` | bool | VAZGEÇ / EVET. **Enter = VAZGEÇ.** |
| `TehlikeliOnay(baslik, metin, string[] eski, string[] yeni, string yedekDosyasi)` | bool | Kırmızı bant "TEHLİKELİ İŞLEM — …", eski→yeni tablo (öğeler `"Ad=değer"` ya da değer; değişenler kehribar), "Yedek alındı: …" (boşsa kehribar "Yedek: alınmadı"), VAZGEÇ / **EVET, UYGULA**. **Enter hiçbir şey yapmaz.** Kısa sürüm: `TehlikeliOnay(baslik, metin)`. |
| `Bilgi(baslik, metin)` | — | TAMAM. |
| `Hata(neOldu, neYapmali)` / `Hata(baslik, neOldu, neYapmali)` | — | "NE OLDU" / "NE YAPMALI" (KU-10). |
| `Secim(baslik, metin, string[] secenekler)` | int (-1 = vazgeç/Esc) | >4 seçenekte 2 sütun. "Vazgeç…" ile başlayan seçenek yoksa VAZGEÇ eklenir. |
| `ListeSec(baslik, string[] ogeler, string[] aciklamalar, string ekDugme)` | int (-1 vazgeç, -2 ek düğme) | Dokunmatik, sürüklenebilir liste (iş dosyası seçici, yedek seçici). |
| `TakimSec(int mevcut, string[] aciklamalar /*0..6*/)` | int 0–6 / -1 | T1–T6 + BOŞALT (T0). |
| `SayiGir(baslik, mevcut, min, max [, ondalik=3])` | double? | Tuş takımı; `,` ve `.` kabul edilir, `.`'ya çevrilir, `InvariantCulture` ile ayrıştırılır; aralık dışı/geçersizde TAMAM pasif ve kırmızı uyarı. İlk tuş mevcut değeri siler. Fiziksel klavye de çalışır. |
| `MetinGir(baslik, mevcut [, sadeceRakam, enCok])` | string / null | Türkçe ekran klavyesi (Ğ Ü Ş İ Ö Ç, G-kod simgeleri `- # = [ ] / * + _ :`, ⇧, ◀ ▶, BOŞLUK, TEMİZLE); `sadeceRakam` → rakam tuş takımı (PIN). |
| `GeriSayim(metin, saniye [, sureBitinceOnay=false])` | bool | Halka sayaç; İPTAL → false, ŞİMDİ BAŞLA → true. Süre bitince varsayılan **iptal**. Eski panelde süre bitince home başlıyordu: denetleyici eski davranışı korumak için `sureBitinceOnay=true` vermeli (**MAKİNEDE DOĞRULA**). |
| `ManuelFrezAdimi(adimNo, metin, string[] dugmeler [, baslik])` | int (-1 = Esc/ACİL STOP) | Büyük, kehribar bant, ses çalar; "DURDUR" içeren düğme kırmızı çerçeve, son düğme yeşil. |
| `YeniBlok(isim, kalinlik, derinlik, dosyaSecili, bekleyenVar)` | `BlokSonucu {Secim, Isim, Kalinlik, Derinlik}` | Secim: -1 vazgeç, 0 kazı+başla, 1 sadece isim, 2 yeni hazır, 3 kullanılmış, 4 bekleyeni iptal. |
| `Devam(dosya, bilgi, takim)` | `DevamSonucu {Secim: guvenli|yakin|bastan|iptal, Takim}` | Yarım kalan iş + iş milindeki frez seçimi. |
| `OnizlemeModu`, `SonForm`, `HepsiniKapat()` | | Yalnız geliştirme (ekran görüntüsü). |

## 6. İzinler (`IzinleriUygula`)

- Anahtar = komut adı (§3). Arama sırası: `"ad:arg"` → `"ad"` → en uzun `"önek.*"` (ör. `kal.*`, `yuva.*`, `hiz.*`) → `"*"`. Tabloda olmayan komut **etkindir**.
- Neden tablosu aynı kurallarla aranır; pasif düğmede alt satır, ipucu ve dokununca alt şerit bildirimi olarak gösterilir.
- Görünümün kendi kuralları yalnız görseldir: seçili yuva SENSÖR/MANUEL iken "AL" düğmesi pasif; sihirbaz ilk adımında GERİ pasif. **İzin kararı daima denetleyicinin tablosudur** (yerel düğme, klavye kısayolu ve uzaktan komut aynı tablodan; GV-01/UZ-02).
- Yalnız izin anahtarı olarak kullanılanlar (komutu olay sahibi gönderir): `blok.yeni` (YENİ BLOK), `takim.degistir` (Üretim TAKIM), `kal.konum.yuva`, `degisken.kaydet`, `uzak.pin`, `mdi.gonder`.
- Değer kutuları/anahtarlar `ayar.kaydet:<Anahtar>` biçimiyle de kapatılabilir (ör. `ayar.kaydet:FrezModu` iş sırasında).

Önerilen tablo (denetleyici; örnek `tests/ui/EkranGoruntusu.cs` içinde): çalışırken yalnız `is.duraklat`, `is.durdur`, `hiz.*`, `acilstop` etkin; duraklatılmışken `is.devam`, `is.durdur`; alarmda `makine.reset`/`acilstop.kaldir`; bağlı değilken tüm hareket komutları kapalı.

## 7. Görsel kurallar (TASARIM §5 uygulaması)

- Renk belirteçleri `Tema` içinde birebir: koyu/açık zemin, kart, kenar, yazı, soluk, marka; durum renkleri HAZIR/ÇALIŞIYOR/DURAKLATILDI/ALARM/HAZIRLIK/PASİF. Düğme rolleri: BAŞLAT yeşil dolgu, DURAKLAT kehribar, DURDUR kırmızı; tehlikeli işlemler kırmızı çerçeve; sihirbaz ana eylemleri altın çerçeve. Pasif = %35 opaklık; basılı = 1 kademe koyu; 8 px köşe.
- Yazı: Segoe UI → DejaVu Sans → Arial; sayılar Consolas → DejaVu Sans Mono → Courier New. Kalan süre 40 pt (1080p'de ≈56 pt), durum hapı 18 pt kalın, eksenler 22 pt, düğmeler 15 pt kalın, kart başlıkları 10 pt büyük harf soluk.
- Hareket: ekran geçişi 150 ms solma (Windows), ilerleme bandı yumuşak, ALARM hapı 1 Hz. İsteğe bağlı ilerleme parıltısı (`Dansci=1`).
- Simgeler vektörel çizilir (simge yazı tipine bağımlı değil; KU-26).

## 8. Özellik haritası (OZELLIK_ENVANTERI.md → yeni arayüz)

"Arka plan" = görünümde düğmesi olmayan, denetleyicinin (mantık katmanının) aynen sürdürdüğü iş; varsa ilgili gösterge yazılmıştır. "Denetleyici" sütunu, mantığın bu komutta mevcut fonksiyonu çağırması gerektiğini belirtir.

### 0. Dosyalar ve başlatıcılar

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 0.1 | Paneli başlat | Arka plan (bat → ps1 → `Add-Type ui/PrimerUI.cs`) | — |
| 0.2 | Hata bulucu | Arka plan (HataBul.bat/ps1 aynen); Kabuk istisnaları alt şeride düşer | — |
| 0.3 | Eding'i düzgün kapat | Ayarlar › Eding › "Eding'i ayarları kaydederek kapat"; EdingKapat.bat aynen | `eding.kapat` |
| 0.4 | Yönetici kurulumu | Arka plan (YoneticiKurulum.bat) | — |
| 0.5 | Eding klasörünü elle belirtme | Ayarlar › Eding › Eding klasörü (yol + "eding_yolu.txt ile değiştirilebilir"), KLASÖRÜ AÇ | `Klasorler["Eding"]`, `klasor.ac eding` |
| 0.6 | Uzaktan sayfalar | Uzaktan ekranı (adres, sayfa yolları) | `UzakAdres` |

### 1. Açılış

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 1.1 | Eding klasörü arama / önizleme modu | Arka plan; üst şerit ÖNİZLEME çipi | `Onizleme` |
| 1.2 | Tek kopya (Mutex) sorusu | Arka plan; soru `Diyalog.Onay` | — |
| 1.3 | Yönetici mi | Arka plan; Kayıtlar › Teknik bilgi satırı | `Teknik` |
| 1.4 | C# bileşenleri derleme | `ui/PrimerUI.cs` (Kabuk, kontroller); SimView/NcAnaliz/Eding sınıfları denetleyicide kalır | — |
| 1.5 | Log dosyası | Arka plan; Kayıtlar listesi + Teknik bilgi "Log" + LOGLAR klasörü | `Kayitlar`, `klasor.ac loglar` |
| 1.6 | 32 bit zorunluluğu | Arka plan (uyarı `Diyalog.Hata`) | — |
| 1.7 | Eding API, AcilKilit | Arka plan | — |
| 1.8 | Dokunmatik ekran klavyesi | `Diyalog.MetinGir` (Türkçe klavye) + `SayiGir` (tuş takımı); tüm değer kutuları dokununca açar; MDI kutusu (SanalKlavye=1 iken dokununca, her zaman ⌨ düğmesi) | `Ayarlar["SanalKlavye"]` |
| 1.9 | Tercihleri oku | Arka plan → `MakineDurumu.Ayarlar`; değişiklikler `ayar.kaydet` | `ayar.kaydet` |
| 1.10 | Makro türü algılama | Arka plan; Teknik bilgi "Makro sürümü" | `Teknik` |
| 1.11 | Acil stop kalıcılığı | Açılışta `AcilStop=true` → kırmızı hap, alarm bandı, KİLİDİ KALDIR | `AcilStop`, `acilstop.kaldir` |
| 1.12 | Otomatik hazırlık kapalıysa | Ayarlar › İş akışı › Açılışta otomatik hazırlık | `ayar.kaydet OtomatikHazirlik=` |
| 1.13 | Windows başlangıcı ayarı | Ayarlar › Genel › Windows açılınca başlasın | `ayar.kaydet WinBaslangic=` |
| 1.14 | Eding'in açılış kaydını kaldırma | Arka plan (her açılışta) | — |
| 1.15 | Tam ekran, — / ✕ | Ayarlar › Genel › Tam ekran; Panel penceresi KÜÇÜLT / KAPAT; yerleşim artık akışkan (ölçek döngüsü yok) | `ayar.kaydet TamEkran=`, `panel.kucult`, `panel.kapat` |
| 1.16 | Eding gizleme (ilk) | Arka plan | — |
| 1.17 | Form açıldığında | Arka plan (Kabuk.Shown'a bağlanır); önizlemede ana düğmeler izinle kapanır | `IzinleriUygula` |
| 1.18 | Açılışta Eding'i sıfırla | Ayarlar › Eding › Açılışta Eding'i sıfırla (sade akışta kapalı) | `ayar.kaydet EdingSifirla=` |
| 1.19 | macro.cnc PENS→T0 yaması | Arka plan | — |
| 1.20 | Eding'i başlatma, exe seçimi | Arka plan; exe seçimi `Diyalog.ListeSec`/OpenFileDialog | — |
| 1.21 | Eding penceresini sürekli gizleme | Arka plan; Eding uyarıları öne alınır | — |
| 1.22 | Bağlantı bekçisi | Arka plan; üst şerit "Eding bağlı / bağlı değil" | `Bagli` |
| 1.23 | Otomatik hazırlık (reset + geri sayım + home) | `Diyalog.GeriSayim` (sureBitinceOnay=true ile eski davranış); meşgul katmanı | `Mesgul`, Ayarlar `GeriSayim` |
| 1.24 | Yuva/sensör varsayılanlarını yazma | Arka plan; Kalibrasyon menüsü yuva özeti | `RafOzeti` |
| 1.25 | Yarım iş açılışta seçili | Üretim iş kartı (dosya adı + "devam için BAŞLAT" durum metni) | `Dosya`, `DurumMetni` |
| 1.26 | Uzaktan erişimi başlat | Uzaktan ekranı durumu | `UzakAcik` |

### 2. Zamanlayıcılar

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 2.1 | Ana zamanlayıcı (durum, BAŞLAT↔DEVAM, hız, başlık, teknik satır…) | Denetleyicinin tek ana zamanlayıcısı → `Kabuk.Uygula` (200 ms) | tüm `MakineDurumu` |
| 2.2 | Koordinat 50 ms | Aynı `Uygula` (eksen paneli yalnız değişince çizer) | `X…MB` |
| 2.3 | Eding gizleme 250 ms | Arka plan | — |
| 2.4 | Uzak komut kuyruğu | Arka plan; `Diyalog.AcikSayisi` ile modal bilgisi | `Diyalog.AcikSayisi` |
| 2.5 | Manuel istek izleme | Arka plan → `Diyalog.ManuelFrezAdimi`, iş kartı mesajı | `ManuelMesaj` |
| 2.6 | Prob testi 120 ms | Arka plan → Oto sihirbaz ② gösterge | `ProbTemas`, `ProbTestAktif` |
| 2.7 | Geri sayım | `Diyalog.GeriSayim` (kendi 1 sn zamanlayıcısı) | — |
| 2.8 | C# animasyon | ProgressBand (16 ms, yalnız değişirken), SimView denetleyicide | — |

### 3. Ana ekran

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 3.1 | Başlık | Üst şerit marka (◆ PRIMER) | — |
| 3.2 | Durum lambası | Üst şerit durum hapı (tek renk sistemi; KU-04) | `Durum` |
| 3.3 | Yazılım ACİL STOP | Üst şerit sağ (her ekranda), diyaloglarda küçük + canlı katman; kaldırma alt şeritte | `acilstop`, `acilstop.kaldir` |
| 3.4 | DOSYA SEÇ | Üretim › İŞ SEÇ | `is.sec` |
| 3.5 | HOME | Üretim › bakım şeridi HOME | `home` |
| 3.6 | BAŞLAT / DEVAM | Üretim › BAŞLAT (duraklatılmışken DEVAM) | `is.baslat` / `is.devam` |
| 3.7 | DURAKLAT | Üretim › DURAKLAT | `is.duraklat` |
| 3.8 | DURDUR | Üretim › DURDUR | `is.durdur` |
| 3.9 | RESET | Üretim › ALARMI TEMİZLE; alt şerit alarm bandı | `makine.reset` |
| 3.10 | FREZ BIRAK | Takımlar › Takım değişimi › FREZİ BIRAK; ayrıca TAKIM → BOŞALT (T0) | `frez.birak` / `takim.degistir 0` |
| 3.11 | PENS AÇ / KAPAT | Takımlar › PENS AÇ / PENS KAPAT (Takım değişimi, Yuva ayarı, İş mili ve hava) | `pens.ac`, `pens.kapat` |
| 3.12 | TEMİZLİK / PARK | Üretim › TEMİZLİK ve ayrı PARK düğmesi | `temizlik`, `park` |
| 3.13 | Eksen satırı, İŞ↔MAKİNE | Üretim › Konum kartı (iş büyük, makine küçük; İŞ/MAKİNE seçimi, panele dokunma) | `ayar.kaydet Koordinat=` |
| 3.14 | Küçük simülasyon → büyük | Üretim › Simülasyon kartı (`SimHost`), BÜYÜT | `sim.buyuk` |
| 3.15 | Dosya adı etiketi | Üretim › İş kartı başlığı ("Makine hazır · bir iş seçin") | `Dosya` |
| 3.16 | İlerleme çubuğu + dans eden hayvan | İş kartı ProgressBand; hayvan yerine isteğe bağlı parıltı (TASARIM §5 "başka animasyon yok"), bitince "BİTTİ" | `Yuzde`, `Dansci`, `IsTamamlandi` |
| 3.17 | Süre satırı | GEÇEN / KALAN (büyük) / BİTİŞ / tahmini | `GecenSn`, `KalanSn`, `BitisSaati`, `TahminiSn` |
| 3.18 | Durum satırı (T, manuel, simülasyon) | İş kartı durum satırı; takım kartı; SİMÜLASYON çipi | `DurumMetni`, `ManuelMesaj`, `EdingSimulasyon` |
| 3.19 | Çip: Ayarlar | Sol menü › Ayarlar | — |
| 3.20 | Çip: Detaylar | Sol menü › Kayıtlar (teknik bilgi + log + MDI) | — |
| 3.21 | Çip: Blok takıldı / Frez modu | Üretim › YENİ BLOK (+ blok durum yazısı); frez modu Takımlar başlığı ve Ayarlar › İş akışı | `blok.*`, `frez.modu` |
| 3.22 | Kazıma hızı çipi | Üretim › Konum kartı › İlerleme oranı [−] %100 [+] | `hiz.azalt/artir/normal` |
| 3.23 | Taban markası | Üst şerit marka | — |
| 3.24 | Pencere başlığı / SİMÜLASYON | `Kabuk.Text` = "PrimerMill 2"; SİMÜLASYON çipi | `EdingSimulasyon` |
| 3.25 | Simge durumu / Kapat | Ayarlar › Genel › Panel penceresi | `panel.kucult`, `panel.kapat` |
| 3.26 | Önizleme modu | ÖNİZLEME çipi; düğmeler izinle kapalı | `Onizleme` |

### 4. İş akışı

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 4.1 | Dosya seç | İŞ SEÇ → denetleyici (`Diyalog.ListeSec` dokunmatik seçici önerilir, "GÖZAT…" ek düğme) | `is.sec` |
| 4.2 | Dosya kontrolü, süre tahmini | İş kartı: takımlar, tahmini süre, uyarı/hata rozeti → liste; hata varsa kırmızı şerit ve BAŞLAT izni kapalı | `IsTakimlari`, `TahminiSn`, `IsUyarilari`, `IsHatalari` |
| 4.3 | BAŞLAT akışı | BAŞLAT; alt sorular denetleyicide `Diyalog.*` ile | `is.baslat` |
| 4.4 | DURAKLAT | DURAKLAT | `is.duraklat` |
| 4.5 | DURDUR | DURDUR (DURAKLAT'tan ayrık) | `is.durdur` |
| 4.6 | HOME | HOME | `home` |
| 4.7 | RESET | ALARMI TEMİZLE / KİLİDİ KALDIR | `makine.reset`, `acilstop.kaldir` |
| 4.8 | FREZ BIRAK | FREZİ BIRAK | `frez.birak` |
| 4.9 | PENS AÇ / KAPAT | PENS AÇ / KAPAT | `pens.ac`, `pens.kapat` |
| 4.10 | TEMİZLİK / PARK | TEMİZLİK, PARK | `temizlik`, `park` |
| 4.11 | İlerleme takibi | İş kartı (yüzde, satır, geçen/kalan/bitiş), simülasyon | `Yuzde`, `Satir`… |
| 4.12 | İş sonu, hata pencereleri | `IsTamamlandi` → BİTTİ; hata pencereleri `Diyalog.Hata(neOldu, neYapmali)` | — |
| 4.13 | Kaldığı yerden devam | `Diyalog.Devam` (KALDIĞI YERDEN / YAKIN NOKTADAN / BAŞTAN / VAZGEÇ + iş milindeki frez) | `DevamSonucu` |
| 4.14 | Hata temizleme | Arka plan | — |
| 4.15 | Komut sonucu | Alt şerit bildirim (`Bildir`) ya da `Diyalog.Hata` | — |
| 4.16 | Hareket bitişini bekleme | Arka plan; meşgul katmanı | `Mesgul` |

### 5. Yeni blok

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 5.1 | "Blok takıldı" diyaloğu | Üretim › YENİ BLOK → `Diyalog.YeniBlok` (isim ≤10, kalınlık 10–30, derinlik 0.05–0.5, 5 seçenek + VAZGEÇ) | `blok.kazibasla/sadeceisim/yenihazir/kullanilmis/iptal` |
| 5.2 | Sadece ismi kazı | Aynı diyalog | `blok.sadeceisim` |
| 5.3 | Kazıma G-kodu | Arka plan; taraf ayarı Ayarlar › İş akışı | `ayar.kaydet SadeTaraf=` |
| 5.4 | İşle birleştirme | Arka plan (`blok.kazibasla`) | — |
| 5.5 | Blok kaydı | Arka plan; varsayılan isim `BlokSonrakiIsim` | — |
| 5.6 | Eski blok sorusu (ölü) | **Yerleştirilmedi** — bugün çalışmayan kod yolu (Sade=true). `BlokSor` anahtarı Ayarlar › İş akışı'nda durur; gerekirse `Diyalog.Secim`/`SayiGir` ile kurulur | `ayar.kaydet BlokSor=` |

### 6. Manuel frez değişimi

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 6.1 | Frez modu ayarı | Ayarlar › İş akışı › Frez değişimi MANUEL; Takımlar başlığı | `ayar.kaydet FrezModu=`, `frez.modu` |
| 6.2 | Frez modu göster | Takım kartı, Takımlar başlığı | `FrezModu` |
| 6.3 | Frez modu sorusu | `Diyalog.Secim` (OTOMATİK / MANUEL) | — |
| 6.4 | Makro sürüm kontrolü | Arka plan; yeniden başlatma önerisi `Diyalog.Onay` | — |
| 6.5 | İstek izleme | Arka plan | — |
| 6.6 | Manuel adım penceresi | `Diyalog.ManuelFrezAdimi` (büyük, ses, Esc = ACİL STOP, "İşi durdur" düğmesi) | — |
| 6.7 | Durum satırında manuel bilgisi | İş kartı kehribar satır; hava yoksa kırmızı "KOMPRESÖRÜ AÇ" | `ManuelMesaj`, `HavaYok` |

### 7. Acil stop

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 7.1 | ACİL STOP | Üst şerit (basınca anında, pasif olmaz) | `acilstop` |
| 7.2 | Tetikleyiciler (düğme, Esc, manuel pencerede Esc, bekçi) | E-stop düğmesi, Esc her pencerede/diyalogda, diyalog katmanı; bekçi arka planda | `acilstop`, `Diyalog.AcilStop` |
| 7.3 | Acil stop kaldır | Alt şerit KİLİDİ KALDIR; Üretim bakım şeridi | `acilstop.kaldir` |
| 7.4 | Kilitliyken komut engeli | İzin tablosu (tüm hareket komutları "Acil stop basılı") + arka plan C# kilidi | `IzinleriUygula` |

### 8. Ayarlar penceresi (yeni yerleri)

Üstteki anlık konum satırı → Takımlar › Hareket (iş + makine) ve Yuva ayarı jog kartı (makine), takım ve home üst şeritte.

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 8.1.1 | Adım seçimi | Takımlar › Hareket › adım (0.01/0.1/1/10/SÜREKLİ); varsayılan Ayarlar › Hareket | `jog` Arg, `ayar.kaydet JogAdim=` |
| 8.1.2 | Hız seçimi | Takımlar › Hareket › Yavaş 100 / Orta 300 / Hızlı 1000 | `jog` Arg, `ayar.kaydet JogHiz=` |
| 8.1.3 | Jog düğmeleri | Takımlar › Hareket › X−/X+, Y− arka/Y+ ön, Z− aşağı/Z+ yukarı, A kol, B disk | `jog`, `jog.basla/bitir` |
| 8.1.4 | İş mili en üste | Takımlar › Hareket › İŞ MİLİ EN ÜSTE | `eksen.yukari` |
| 8.1.5 | Kol düz | KOL DÜZ (TAKIM ALMA) | `konum.koldz` |
| 8.1.6 | Takım alanı | TAKIM ALANI | `konum.takimalani` |
| 8.1.7 | Blok değiştirme | BLOK DEĞİŞTİRME | `konum.blok` |
| 8.1.8 | Park (G30) | PARK (G30) | `konum.park` |
| 8.1.9 | Konum etiketi | Hareket sekmesi eksen değerleri (iş + mak) | `X…MB` |
| 8.2.1 | T1…T6 al, Bırak | Takımlar › Takım değişimi (yuva kartı seç → "Tn AL", FREZİ BIRAK); Üretim › TAKIM | `takim.degistir`, `frez.birak` |
| 8.2.2 | Yuvalara git | Yuva kartı seç → YUVAYA GİT (T1–T6, SENSÖR, MANUEL) | `yuva.git` |
| 8.2.3 | Yaklaş | YAKLAŞ | `yuva.yaklas` |
| 8.2.4 | Yukarı | YUKARI | `eksen.yukari` |
| 8.2.5 | Takım boyunu ölç | TAKIM BOYUNU ÖLÇ | `takim.olc` |
| 8.2.6 | Aşınma kontrolü | AŞINMA KONTROLÜ (sonuç `Diyalog.Bilgi`) | `takim.asinma` |
| 8.2.7 | İş mili boş mu | İŞ MİLİ BOŞ MU? | `takim.bosmu` |
| 8.2.8 | Yuva geometrisi, macro'dan oku | Takımlar › Yuva ayarı › MACRO'DAN OKU | `yuva.geometri.oku` |
| 8.3.1 | Yuva listesi | Yuva ayarı › Yuva listesi tablosu (kayıtlı / yeni / fark; dokunarak seç) | `Yuvalar[].Yeni/Fark` |
| 8.3.2 | Yuvaya git | GİT | `yuva.git` |
| 8.3.3 | Yaklaş | YAKLAŞ | `yuva.yaklas` |
| 8.3.4 | Yukarı | YUKARI | `eksen.yukari` |
| 8.3.5 | İnce adım + jog | İnce ayar kartı: adım 0.01/0.05/0.1/0.5/1, X/Y/Z/A/B ± | `jog` |
| 8.3.6 | Pens aç / kapat / hava üfle | İnce ayar kartı | `pens.ac`, `pens.kapat`, `hava.ufle` |
| 8.3.7 | T1 alınırken Z al | Seçili yuva kartı anahtarı | `yuva.zal` |
| 8.3.8 | BU KONUMU AL | BU KONUMU AL (Tn) | `yuva.al` |
| 8.3.9 | KAYDET (hepsi) | KAYDET | `yuva.kaydet` |
| 8.3.10 | Baştan başla | BAŞTAN | `yuva.sifirla` |
| 8.3.11 | Doğrulanmış değerlere dön | DOĞRULANMIŞ | `yuva.varsayilan` |
| 8.3.12 | TEST: Tn al / bırak | TEST AL (seçili yuva); bırak = FREZİ BIRAK | `yuva.test`, `frez.birak` |
| 8.3.13 | Durum / ortak değerler | İnce ayar kartı 2. satır (kayıtlı ortak), liste başlığında "KAYDEDİLMEDİ" | `YuvaOrtak`, `YuvaKaydedilmemis` |
| 8.4.1 | Devir + Çalıştır (M3) | Takımlar › İş mili ve hava › Devir kutusu, ÇALIŞTIR (M3) | `ismili.calistir` |
| 8.4.2 | Durdur (M5) | DURDUR (M5) | `ismili.durdur` |
| 8.4.3 | Pens aç / kapat / hava üfle | Pens ve hava kartı | `pens.ac`, `pens.kapat`, `hava.ufle` |
| 8.4.4 | M7 / M8 / M9 | Soğutma kartı | `sogutma.m7/m8/kapat` |
| 8.5.1 | G54 kutuları | Ayarlar › Makine değişkenleri (dokun → tuş takımı) | `G54`, `degisken.kaydet` |
| 8.5.2 | #4000–#4006 | Aynı sayfa, 7 kutu (adlarıyla) | `Param` |
| 8.5.3 | G92 satırı + uyarı | Aynı sayfa G92 sütunu (X/Y/A/B ≠ 0 kırmızı); Kalibrasyon bilgi şeridi | `G92` |
| 8.5.4 | Değerleri oku | DEĞERLERİ OKU | `degisken.oku` |
| 8.5.5 | Kaydet | KAYDET (12 değer) | `degisken.kaydet` |
| 8.5.6 | Şu anki konum = Tn / Sensör | Kalibrasyon › Konumdan yuva / sensör › KONUMU KAYDET (seçim diyaloğu) | `kal.konum.yuva` |
| 8.5.7 | Şu anki Z = alma | Kalibrasyon › Takım boyu ve Z; Makine değişkenleri | `kal.zalma` |
| 8.5.8 | G92 sıfırla | Kalibrasyon › G54 ve üretici; Makine değişkenleri | `kal.g92sifirla` |
| 8.5.9 | Ayarları yedekle | Kalibrasyon › Yedekler; Ayarlar › Yedekler | `yedek.al` |
| 8.5.10 | Yedekten yükle | Aynı yerler (seçim `Diyalog.ListeSec`) | `yedek.yukle` |
| 8.5.11 | Yedek klasörü | KLASÖR / AÇ | `klasor.ac yedekler` |
| 8.5.12 | Üretici değerine dön | Kalibrasyon › ÜRETİCİYE DÖN; Disk sihirbazı ① | `kal.uretici` |
| 8.5.13 | Üretici farkı, yuva/sensör özeti | Kalibrasyon kartlarında durum satırları | `UreticiFark`, `RafOzeti` |
| 8.6.1 | Şu anki G54 ve #4002 | Disk sihirbazı ① ve Kalibrasyon bilgi şeridi | `G54`, `Param[2]` |
| 8.6.2 | Üretici değerlerine dön | ① ÜRETİCİ DEĞERLERİNE DÖN | `kal.uretici` |
| 8.6.3 | Test bloğu girdileri, yerleşim | ② Disk kalınlığı, T1 çapı, Test no 1–4, YENİ DİSK (TEST 1), yerleşim kartı | `KalT`, `KalD`, `kal.disk.test`, `DiskYerlesim` |
| 8.6.4 | Test programını hazırla | ② TEST PROGRAMINI HAZIRLA | `kal.disk.hazirla` |
| 8.6.5 | 9 ölçüm | ③ 9 kutu (tuş takımı) | `kal.disk.olcum` |
| 8.6.6 | A/B/Y yönü ters | ③ üç anahtar | `ayar.kaydet KalSA/KalSB/KalSY=` |
| 8.6.7 | HESAPLA | ④ HESAPLA + sonuç tablosu (✓/⚠) + uyarılar | `kal.disk.hesapla`, `DiskSonuc`, `DiskUyarilar` |
| 8.6.8 | UYGULA VE KAYDET | ⑤ eski/yeni tablo + UYGULA VE KAYDET | `kal.disk.uygula` |
| 8.6.9 | Geçmiş | ⑤ GEÇMİŞ; Ayarlar › Yedekler | `kal.disk.gecmis` |
| 8.6.10 | Frez boyunu ölç | ⑤ FREZ BOYUNU ÖLÇ | `takim.olc` |
| 8.7.1 | G54/#4002, bitmiş ölçüm bildirimi | Kalibrasyon menüsü (yeşil şerit + rozet), ④ durum yazısı | `OtoOlcumBitti` |
| 8.7.2 | Kurulum, kalınlık, temas ucu, çap | ① kontrol listesi, kutular, 10/12/18/20, Düz pim / Küresel frez | `ayar.kaydet OkT/OkUc/OkUcD=` |
| 8.7.3 | Prob testi başlat / durdur | ② PROB TESTİNİ BAŞLAT/DURDUR + büyük TEMAS VAR/YOK göstergesi (zorunlu adım) | `kal.prob.basla/durdur`, `ProbTemas` |
| 8.7.4 | Girişi yeniden öğren | ② GİRİŞİ YENİDEN ÖĞREN | `kal.prob.ogren` |
| 8.7.5 | Ölçüm programını hazırla | ③ ÖLÇÜM PROGRAMINI HAZIRLA, ÜRETİM EKRANINA GİT | `kal.oto.hazirla` |
| 8.7.6 | Sonuçları oku, kalite | ④ SONUÇLARI OKU, sonuç + kalite tabloları, uyarılar (büyükse kırmızı) | `kal.oto.oku`, `OtoSonuc`, `OtoKalite`, `OtoUyarilar`, `OtoBuyuk` |
| 8.7.7 | UYGULA VE KAYDET | ⑤ | `kal.oto.uygula` |
| 8.7.8 | Geçmiş / Frez boyunu ölç | ⑤ GEÇMİŞ, FREZ BOYUNU ÖLÇ; ③ FREZ BOYUNU ÖLÇ | `kal.oto.gecmis`, `takim.olc` |
| 8.8.1 | Makine adı | Ayarlar › Genel › Makine adı (klavye) | `ayar.kaydet MakineAdi=` |
| 8.8.2 | Dokunmatik klavye | Ayarlar › Genel | `ayar.kaydet SanalKlavye=` |
| 8.8.3 | Otomatik hazırlık | Ayarlar › İş akışı | `ayar.kaydet OtomatikHazirlik=` |
| 8.8.4 | Geri sayım (sn) | Ayarlar › İş akışı (0–60) | `ayar.kaydet GeriSayim=` |
| 8.8.5 | Açılışta Eding'i sıfırla | Ayarlar › Eding | `ayar.kaydet EdingSifirla=` |
| 8.8.6 | Blok ismi tarafı | Ayarlar › İş akışı (Saat 3 / Saat 9) | `ayar.kaydet SadeTaraf=` |
| 8.8.7 | Frez değişimi MANUEL | Ayarlar › İş akışı | `ayar.kaydet FrezModu=` |
| 8.8.8 | Dans eden hayvan | Ayarlar › Genel › İlerleme parıltısı (yerine) | `ayar.kaydet Dansci=` |
| 8.8.9 | Makine koordinatı göster | Ayarlar › Genel; Üretim İŞ/MAKİNE | `ayar.kaydet Koordinat=` |
| 8.8.10 | Tam ekran | Ayarlar › Genel | `ayar.kaydet TamEkran=` |
| 8.8.11 | Windows açılınca başlasın | Ayarlar › Genel | `ayar.kaydet WinBaslangic=` |
| 8.8.12 | Klasörler | Ayarlar › Eding › İŞLER/LOGLAR/YEDEKLER, Eding KLASÖRÜ AÇ; Kayıtlar › Klasörler | `klasor.ac` |
| 8.8.13 | Eding penceresini göster | Ayarlar › Eding › GÖSTER | `eding.goster` |
| 8.8.14 | Eding'i gizle | GİZLE | `eding.gizle` |
| 8.8.15 | Eding'i yeniden başlat | YENİDEN BAŞLAT | `eding.yeniden` |
| 8.8.16 | Eding arka planda | Ayarlar › Eding | `ayar.kaydet EdingGizli=` |
| 8.8.17 | Bilgi (klasörler, log yolu) | Kayıtlar › Teknik bilgi; Ayarlar › Eding klasörü | `Teknik`, `Klasorler` |
| 8.8.18 | Uzaktan adres + PIN | Uzaktan ekranı; Ayarlar › Uzaktan erişim özeti | `UzakAdres`, `UzakPin` |
| 8.8.19 | Uzaktan erişim açık | Ayarlar › Uzaktan erişim; Uzaktan › anahtar | `ayar.kaydet Uzak=`, `uzak.ac` |
| 8.8.20 | Uzaktan başlatma blok onayı | Ayarlar › Uzaktan erişim | `ayar.kaydet UzakKilit=` |
| 8.8.21 | PIN + kaydet | Uzaktan › PIN DEĞİŞTİR (rakam klavyesi, boş = PIN'siz) | `uzak.pin` |

### 9–11. Detaylar, büyük simülasyon, diyaloglar

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 9.1 | Teknik satır | Kayıtlar › Teknik bilgi tablosu | `Teknik` |
| 9.2 | Mesaj kutusu (log) | Kayıtlar › Mesaj geçmişi (renkli, filtreli, kaydırmalı); alt şerit son mesaj | `Kayitlar`, `SonMesaj` |
| 9.3 | MDI | Kayıtlar › MDI (Enter/GÖNDER, ⌨) | `mdi.gonder` |
| 10.1 | Büyük simülasyon | Üretim › BÜYÜT → tam içerik alanı (`SimHostBuyuk`), KÜÇÜLT; Esc = ACİL STOP | `sim.buyuk` |
| 11.1 | Ortak mesaj kutusu | `Diyalog.Onay/Bilgi/Hata/TehlikeliOnay` (metin ve cevap loglaması denetleyicide) | — |
| 11.2 | Tek kopya sorusu | `Diyalog.Onay` | — |
| 11.3 | Eding exe seçimi | `Diyalog.ListeSec` ya da OpenFileDialog (denetleyici) | — |
| 11.4 | NC dosyası seçimi | `Diyalog.ListeSec` ("GÖZAT…" = -2 → OpenFileDialog) | `is.sec` |
| 11.5 | Frez modu sorusu | `Diyalog.Secim` | — |
| 11.6 | Manuel frez adım penceresi | `Diyalog.ManuelFrezAdimi` | — |
| 11.7 | Blok sorusu (ölü) | **Yerleştirilmedi** (bkz. 5.6) | — |
| 11.8 | Yeni blok | `Diyalog.YeniBlok` | `blok.*` |
| 11.9 | Yarım kalan iş | `Diyalog.Devam` | — |
| 11.10 | Home geri sayımı | `Diyalog.GeriSayim` (İPTAL / ŞİMDİ BAŞLA) | — |
| 11.11 | Yedek dosyası seçimi | `Diyalog.ListeSec` | `yedek.yukle` |
| 11.12 | Sihirbaz: frez alma kalibrasyonu | Takımlar › Yuva ayarı | `yuva.*` |
| 11.13 | Sihirbaz: disk kalibrasyonu | Kalibrasyon › Disk kalibrasyonu (5 adım göstergeli) | `kal.disk.*` |
| 11.14 | Sihirbaz: otomatik kalibrasyon | Kalibrasyon › Otomatik kalibrasyon (5 adım, prob testi zorunlu) | `kal.oto.*`, `kal.prob.*` |
| 11.15 | Dokunmatik klavye | `Diyalog.MetinGir` / `SayiGir` | — |

### 12. Uzaktan erişim

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 12.1.1 | HTTP sunucusu | Arka plan; Uzaktan › adres(ler) | `UzakAdres`, `UzakAdresler` |
| 12.1.2 | Başlatma | Arka plan; Uzaktan › AÇIK/KAPALI | `UzakAcik`, `uzak.ac` |
| 12.1.3 | PIN kontrolü | Arka plan; PIN kartı | `UzakPin`, `uzak.pin` |
| 12.1.4 | CORS | Arka plan | — |
| 12.1.5 | Durum JSON | Arka plan (aynı `MakineDurumu`dan üretilebilir) | — |
| 12.1.6 | Komut kuyruğu | Arka plan; aynı izin tablosu; `Diyalog.AcikSayisi` | — |
| 12.1.7 | Kapanışta durdurma | Arka plan (`Kabuk.FormClosing`) | — |
| 12.2 `OPTIONS *`, `GET /`, `/tek` | Sayfalar | Arka plan; Uzaktan ekranında sayfa yolları | — |
| 12.2 `GET /api/durum`, `/api/ekran`, `/api/dosyalar` | Durum, ekran görüntüsü, dosya listesi | Arka plan; son istekler "Son bağlanan cihazlar" tablosu | `UzakCihazlar` |
| 12.2 `POST /api/tikla`, `/api/tus` | Ekran tıklaması / klavye | Arka plan; izin düzeyi seçimiyle sınırlanması önerilir (`uzak.izin`) | `uzak.izin` |
| 12.2 `POST /api/yukle`, `/api/komut` | Yükleme, komut | Arka plan | — |
| 12.3 `sec` | Uzaktan iş seçme | Arka plan (yerel karşılığı `is.sec`) | — |
| 12.3 `baslat` / `duraklat` / `durdur` | Uzaktan iş kontrolü | Arka plan; aynı izin tablosu | — |
| 12.3 `blok` / `blokiptal` | Uzaktan blok ismi | Arka plan (yerel karşılığı `blok.*`) | — |
| 12.4.1 | portal.html | Değişmedi (arka plan); adres Uzaktan ekranında | — |
| 12.4.2 | uzak.html | Değişmedi; "/tek" yolu Uzaktan ekranında | — |
| 12.4.3 | Güvenlik duvarı kuralı | Arka plan (YoneticiKurulum.bat) | — |

### 13–15. Kalıcı veriler, kısayollar, kapanış

| # | Özellik | Yeni arayüzdeki yeri | Komut / alan |
|---|---|---|---|
| 13.1 | panel_ayarlar.ini anahtarları | `MakineDurumu.Ayarlar` + `ayar.kaydet` (Genel/İş akışı/Hareket/Eding/Uzaktan, sihirbaz kutuları: `KalT KalD KalTest KalSA KalSB KalSY OkT OkUc OkUcD`). `ProbIo/ProbAktif` → GİRİŞİ YENİDEN ÖĞREN; `AcilStop` → E-stop; `WebPin` → PIN; `BlokTakim BlokCap BlokYuk BlokKonum BlokCizgi` yalnız ölü 5.6 için (yerleştirilmedi); `SadeKalinlik SadeDerinlik` → Yeni blok diyaloğu varsayılanları | `ayar.kaydet` |
| 13.2.1 | ayarlar.txt | Arka plan | — |
| 13.2.2 | devam.json | Arka plan → `Diyalog.Devam` | — |
| 13.2.3 | bloklar.csv | Arka plan → `BlokSonrakiIsim` | — |
| 13.2.4 | kalibrasyon_gecmisi.csv | GEÇMİŞ düğmeleri | `kal.disk.gecmis` |
| 13.2.5 | oto_kalibrasyon_gecmisi.csv | GEÇMİŞ düğmeleri | `kal.oto.gecmis` |
| 13.2.6 | yedekler\ayar_*.txt | Yedekler kartı/sekmesi, TehlikeliOnay "Yedek alındı" satırı | `yedek.*`, `SonYedek` |
| 13.2.7 | loglar\Panel_*.log | Kayıtlar, LOGLAR klasörü | `klasor.ac loglar` |
| 13.2.8 | isler\ | İŞLER klasörü, İŞ SEÇ | `klasor.ac isler` |
| 13.2.9 | macro_yedek_*.cnc | Arka plan | — |
| 13.2.10 | baslangic_yedek | Arka plan | — |
| 14.1 | Esc (ana, ayarlar, detaylar, simülasyon) | Kabuk: her ekranda Esc = ACİL STOP | `acilstop` |
| 14.2 | Esc (manuel frez penceresi) | Tüm diyaloglarda Esc = ACİL STOP | `Diyalog.AcilStop` |
| 14.3 | Enter (MDI) | Kayıtlar › MDI kutusu | `mdi.gonder` |
| 14.4 | Enter / Esc (diyaloglar) | Enter: Onay'da VAZGEÇ, Bilgi/Hata'da TAMAM, SayiGir/MetinGir'de TAMAM, Tehlikeli/GeriSayim/Manuel'de etkisiz. Esc: ACİL STOP (eski "CancelButton" yerine; TASARIM §3 D) | — |
| 14.5 | Dokunmatik klavye | Değer kutuları, MDI | — |
| 14.6 | Uzaktan klavye | Arka plan (uzak.html/portal.html değişmedi) | — |
| 14.7 | Koordinat satırına tıklama | Konum kartı eksen paneline dokunma = İŞ↔MAKİNE | `ayar.kaydet Koordinat=` |
| 14.8 | Hız çipi bölgeleri | Ayrı [−] / yüzde (=%100) / [+] düğmeleri | `hiz.*` |
| 15.1 | Panel kapanırken | Arka plan (`Kabuk.FormClosing`) | — |
| 15.2 | Kapat onayı | Ayarlar › Genel › KAPAT → denetleyici onayı (çalışırken uyarılı) | `panel.kapat` |
| 15.3 | Eding'i ayar kaydederek kapatma | Ayarlar › Eding › KAPAT; EdingKapat.bat | `eding.kapat` |

Bölüm 16 (değişken kullanımı) ve 17 (macro.cnc eşlemesi) arayüz özelliği değildir; değişkenlerin görünür olanları Ayarlar › Makine değişkenleri ve Kalibrasyon bilgi şeridindedir.

### Yerleştirilemeyen / bilinçli değişen maddeler

| # | Durum | Gerekçe |
|---|---|---|
| 5.6, 11.7 (eski blok sorusu) | Yerleştirilmedi | Bugün ölü kod (Sade=true). Yeni blok akışı 5.1 kapsar. `BlokSor` anahtarı korunur; gerekirse denetleyici mevcut Diyalog'larla kurabilir. |
| 3.16 dans eden hayvan | Değiştirildi | TASARIM §5 "başka animasyon yok"; `Dansci` anahtarı isteğe bağlı ilerleme parıltısını açar. |
| 3.12 TEMİZLİK→PARK aynı düğme | Değiştirildi | KU-13: iki ayrı düğme (`temizlik`, `park`). Makine hareketi aynı fonksiyonlar. |
| 14.4 Esc = Vazgeç (diyaloglar) | Değiştirildi | TASARIM: her diyalogda Esc = ACİL STOP. |
| `jog.basla/bitir`, `uzak.izin` | Yeni | Denetleyici desteklemedikçe izinle kapatılmalı; **MAKİNEDE DOĞRULA**. |

## 9. Ekran görüntüleri

`tests/ui/ekran_goruntusu_al.sh` → `teslim/ekran_goruntuleri/` (Mono + Xvfb, gerçek arayüz kodundan). Koyu tema 1024×768 ve 1920×1080'de her ekran, her sihirbaz adımı (1024) ve önemli diyaloglar; açık temada Üretim, Takımlar, Oto sihirbaz ④ ve Tehlikeli onay.

## 10. Mono ile Windows farkları (bilinen)

- Yazı tipi: Mono/Linux'ta DejaVu Sans/Mono kullanılır (Segoe UI/Consolas yok); Windows'ta glifler biraz daha dar, düğmeler daha ferah görünür. Yazılar ölçülerek sığdırıldığı için taşma olmaz.
- Ekran geçişindeki 150 ms solma yalnız Windows'ta (Mono'da `DrawToBitmap` çocuk kontrolleri çizmediği için kapalı).
- ClearType yalnız Windows; Mono'da gri tonlu kenar yumuşatma.
- Çok satırlı düğme yazılarında Mono satırları sola yaslayabilir (Windows ortalar).
- `ToolTip` Windows'ta normal; ekran görüntüsü aracında kapatılır (`TemelKontrol.IpuculariGoster=false`).
- DPI: Windows'ta `AutoScaleMode.Dpi` + `Tema.Dpi` (CreateGraphics DpiX/96) birlikte çalışır; %125/%150'de makinede kontrol edilmeli.
