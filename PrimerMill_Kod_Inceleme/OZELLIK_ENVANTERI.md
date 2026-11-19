# PrimerMill — Özellik Envanteri (Aşama 1)

Bu belge mevcut panelin (`PrimerMill/KazimaBaslat.ps1`, 6028 satır) yaptığı her işi listeler. Amaç: yeni arayüzde **hiçbir özelliğin kaybolmaması** (CLAUDE.md kural 6). Kod değiştirilmedi.

- Satır numaraları `KazimaBaslat.ps1` içindir (aksi yazılmadıysa); `grep -n` ve fonksiyon başı/sonu parantez eşlemesiyle doğrulandı.
- Fonksiyon satır aralığı `başlangıç–bitiş` biçimindedir.
- "Yeni arayüzdeki yeri" sütunu teslimde dolduruldu (PrimerMill 2, `teslim/PrimerMill/`; kaynak: `ui/ARAYUZ_API.md` §8 ve entegrasyon notları): `[x]` = baştan sona bağlı (ekran › denetim, parantez içinde komut / durum alanı; "Arka plan" = düğmesi olmayan, denetleyicinin aynen sürdürdüğü iş), `[~]` = kısmi (eksik kısım yazılı), `[ ]` = yeni arayüzde yok (nedeni yazılı). Özet: 229 `[x]`, 3 `[~]`, 3 `[ ]`.
- **⚠ HAREKET** etiketi: makineyi hareket ettiren ya da makine ayarını (G54, #4xxx, G92) değiştiren madde.
- Önemli sabit: `$script:Sade = $true` (satır 13). Bu yüzden "sade olmayan" kod yolları bugün **çalışmıyor** (aşağıda "ÖLÜ / Sade'de kapalı" diye işaretli). Envantere yine de alındı.

---

## 0. Dosyalar ve başlatıcılar

| # | Özellik | Açıklama | Dosya / fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 0.1 | Paneli başlat | 32 bit PowerShell (SysWOW64) ile `-STA -WindowStyle Hidden` açar; 32 bit yoksa System32'ye düşer | `KazimaBaslat.bat` | 1–5 | [x] Arka plan (bat → ps1 → `Add-Type ui/PrimerUI.cs`) |
| 0.2 | Hata bulucu | Ayrıştırıcıyla yazım kontrolü, arkada açık kopyaları bulup kapatma (E/H sorar), paneli aynı pencerede çalıştırıp hatayı gösterme, masaüstüne transkript `PrimerMill_hata_*.txt` | `HataBul.bat`, `HataBul.ps1` | bat 1–6, ps1 1–28 | [x] Arka plan (HataBul.bat/ps1 aynen); Kabuk istisnaları alt şeride düşer |
| 0.3 | Eding'i düzgün kapat | Onay (`choice E/H`), paneli kapatır (3 sn sonra `Stop-Process -Force`), Eding ana penceresine WM_CLOSE (ayar kaydı için 10 sn bekler), KillCNC.exe, sonra `cnc`/`CncServer` zorla kapatılır | `EdingKapat.bat`, `EdingKapat.ps1` | bat 1–16, ps1 1–44 | [x] Ayarlar › Eding › "Eding'i ayarları kaydederek kapat"; EdingKapat.bat aynen (`eding.kapat`) |
| 0.4 | Yönetici kurulumu | UAC ile kendini yükseltir; `schtasks /create /tn PrimerMill /sc onlogon /rl highest`; Başlangıç kısayolunu siler; güvenlik duvarı kuralı "PrimerMill Uzak" TCP 8080–8084, 18080, 28080, `remoteip=localsubnet` | `YoneticiKurulum.bat` | 1–22 | [x] Arka plan (YoneticiKurulum.bat) |
| 0.5 | Eding klasörünü elle belirtme | `eding_yolu.txt` ilk dolu, `#` ile başlamayan satır aday listesinin başına eklenir (panel ve EdingKapat.ps1) | ana betik; `EdingKapat.ps1` | 20–27; ps1 35–36 | [x] Ayarlar › Eding › Eding klasörü (yol + "eding_yolu.txt ile değiştirilebilir"), KLASÖRÜ AÇ (`Klasorler["Eding"]`, `klasor.ac eding`) |
| 0.6 | Uzaktan sayfalar | `portal.html` (çok cihazlı portal), `uzak.html` (tek cihaz ekran yansıtma) — bkz. bölüm 12 | `portal.html`, `uzak.html` | 1–209, 1–105 | [x] Uzaktan ekranı (adres, sayfa yolları) (`UzakAdres`) |

## 1. Açılış (startup) sırası ve otomatik davranışlar

| # | Özellik | Açıklama | Fonksiyon / kod | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 1.1 | Eding klasörü arama | Adaylar `P:\CNC`, `C:\CNC_X5`, `C:\CNC4.03`, `C:\CNC4.04`, `C:\CNC4.02`, `C:\CNC` (+eding_yolu.txt); `cncapi.dll` bulunan ilk klasör = makine bilgisayarı. Bulunamazsa iş klasörü `PrimerMill\isler`, önizleme modu | ana betik | 9–37 | [x] Arka plan; üst şerit ÖNİZLEME çipi (`Onizleme`) |
| 1.2 | Tek kopya (Mutex) | `Local\PrimerMillPanel`; ikinci açılışta "eskisi kapatılıp yeniden açılsın mı?" sorar, eski powershell süreçlerini (WMI) öldürür, 8 sn mutex bekler | ana betik | 42–57 | [x] Arka plan; soru `Diyalog.Onay` |
| 1.3 | Yönetici mi kontrolü | `$script:Yonetici` (log ve gizleme uyarısında kullanılır) | ana betik | 58–59 | [x] Arka plan; Kayıtlar › Teknik bilgi satırı (`Teknik`) |
| 1.4 | C# bileşenleri derleme | `Kayit`, `EggButton`, `LuxProgress`, `Hayvanlar`, `PartFace/PartModel/SimRenderer/SimView`, `EngravedTitle`, `EStopButton`, `Cip`, `HizCip`, `StatusLamp`, `NcAnaliz` | `Add-Type` | 62–1124 | [x] `ui/PrimerUI.cs` (Kabuk, kontroller); SimView/NcAnaliz/Eding sınıfları denetleyicide kalır — eski görsel sınıflar (EggButton, LuxProgress, Hayvanlar, …) alınmadı, karşılıkları PrimerUI.cs içinde |
| 1.5 | Log dosyası | `loglar\Panel_yyyy-MM-dd_HH-mm-ss.log` (UTF-8 BOM, AutoFlush); her pencere metni ve cevabı da loglanır | `[Kayit]::Ac/Yaz/Kapat`, `Hatalari-Kaydet` (PowerShell `$Error` → log, 1 sn'de bir) | 75–133, 1127–1142 | [x] Arka plan; Kayıtlar listesi + Teknik bilgi "Log" + LOGLAR klasörü (`Kayitlar`, `klasor.ac loglar`) |
| 1.6 | 32 bit zorunluluğu | Makinede 64 bit çalışırsa uyarı + çıkış | ana betik | 1147–1151 | [x] Arka plan (uyarı `Diyalog.Hata`) |
| 1.7 | Eding API (`[Eding]`) | cncapi.dll 28 fonksiyon (bağlan, iş yükle/başlat/duraklat/iptal, tek satır, çıkış, durum, değişken, konum, feed override, simülasyon modu…); `AcilKilit` bayrağı `CncRunOrResumeJob`/`CncRunSingleLine` çağrılarını engeller; `CncRunSingleLineZorla` kilidi aşar; `WorkPos/MachinePos` yedek hesap | `Add-Type` `Eding`, `Cart` | 1152–1255 | [x] Arka plan |
| 1.8 | Dokunmatik ekran klavyesi | Herhangi bir (salt-okunur olmayan) TextBox'a dokununca açılan kendi klavyesi (rakam/harf, ⌫, büyük/küçük, ◀ ▶, Boşluk, Temizle, TAMAM); kutunun altına/üstüne konumlanır | `DokunKlavye` (C#), `[DokunKlavye]::Kur()` | 1302–1401, 6025–6026 | [x] `Diyalog.MetinGir` (Türkçe klavye) + `SayiGir` (tuş takımı); tüm değer kutuları dokununca açar; MDI kutusu (SanalKlavye=1 iken dokununca, her zaman ⌨ düğmesi) (`Ayarlar["SanalKlavye"]`) |
| 1.9 | Tercihleri oku | `panel_ayarlar.ini` (bkz. 13.1); Sade'de `ModSor/BlokSor/EdingSifirla = 0` zorlanır; `Uzak` varsayılan 1; `UzakKilit` 1; `WebPin` yoksa rastgele 4 hane üretilir; `FrezModu` OTOMATIK/MANUEL; `MakineAdi` = bilgisayar adı | `Tercih-Oku`, `Tercih-Yaz` | 3643–3664 | [x] Arka plan → `MakineDurumu.Ayarlar`; değişiklikler `ayar.kaydet` (`ayar.kaydet`) |
| 1.10 | Makro türü algılama | `macro.cnc` içinde `sub manual_change` varsa `$script:OzelMakro = $true` (PrimerMill makrosu) | ana betik | 3665–3669 | [x] Arka plan; Teknik bilgi "Makro sürümü" (`Teknik`) |
| 1.11 | Acil stop kalıcılığı | Panel ACİL STOP basılıyken kapandıysa (`AcilStop=1`) açılışta kilit sürer, otomatik hazırlık iptal | ana betik; `Add_Shown` | 3670, 5877–5881 | [x] Açılışta `AcilStop=true` → kırmızı hap, alarm bandı, KİLİDİ KALDIR (`AcilStop`, `acilstop.kaldir`) |
| 1.12 | Otomatik hazırlık kapalıysa | `OtomatikHazirlik≠1` → `AcilisDurum='iptal'` | ana betik | 3671 | [x] Ayarlar › İş akışı › Açılışta otomatik hazırlık (`ayar.kaydet OtomatikHazirlik=`) |
| 1.13 | Windows başlangıcı ayarı | Zamanlanmış görev "PrimerMill" varsa Başlangıç kısayolunu siler (WinBaslangic=0 ise görevi de siler); yoksa `Startup\PrimerMill.lnk` → KazimaBaslat.bat oluşturur/siler | `Windows-Baslangic-Ayarla` | 5910–5939 (çağrı 5940) | [x] Ayarlar › Genel › Windows açılınca başlasın (`ayar.kaydet WinBaslangic=`) |
| 1.14 | Eding'in kendi açılış kaydını kaldırma ⚠ sistem | Startup/CommonStartup klasörlerindeki Eding kısayollarını `baslangic_yedek\`e taşır; HKCU/HKLM/WOW6432Node `Run` altındaki Eding değerlerini **siler** (`baslangic_yedek_kayit.txt`'ye yazar). Her açılışta çalışır | `Eding-Baslangic-Kaldir` | 5943–5980 (çağrı 5981) | [x] Arka plan (her açılışta) |
| 1.15 | Tam ekran | 1000×640 tasarımı ekrana ölçekler (konum + yazı tipi), çerçevesiz, TopMost, ortalar; sol altta "—" (simge durumu) ve "✕" (kapat, çalışıyorsa uyarılı onay) | `Tam-Ekran-Uygula` | 5983–6022 (çağrı 6023) | [x] Ayarlar › Genel › Tam ekran; Panel penceresi KÜÇÜLT / KAPAT; yerleşim artık akışkan (ölçek döngüsü yok) (`ayar.kaydet TamEkran=`, `panel.kucult`, `panel.kapat`) — eskisi gibi panel yeniden açılınca uygulanır |
| 1.16 | Eding gizleme (ilk) | Form gösterilmeden önce bir kez | `Eding-Gizle-Tik` | 6027 | [x] Arka plan |
| 1.17 | Form açıldığında (Shown) | gizleme zamanlayıcısı başlar; acil stop kilidi gösterilir; makine değilse ana düğmeler devre dışı; klasör/log yazılır; (Sade değilse) `Acilis-Eding-Sifirla`; Sade'de `Macro-Pens-Yamasi`; `Eding-Baslat`; ana/koordinat/(özel makroda) manuel zamanlayıcıları; `Uzak-Baslat`; `Devam-Acilis` | `$form.Add_Shown` | 5875–5895 | [x] Arka plan (Kabuk.Shown'a bağlanır); önizlemede ana düğmeler izinle kapanır (`IzinleriUygula`) |
| 1.18 | Açılışta Eding'i sıfırla (Sade'de kapalı) | Eding açık ve iş yapmıyorsa: bağlantıyı kes, nazik kapat (10 sn), zorla öldür, KillCNC, 15 sn geri sayım, sonra açılır | `Acilis-Eding-Sifirla` | 1790–1817 | [x] Ayarlar › Eding › Açılışta Eding'i sıfırla (sade akışta kapalı) (`ayar.kaydet EdingSifirla=`) — eskisi gibi panel yeniden açılınca uygulanır |
| 1.19 | macro.cnc PENS→T0 yaması ⚠ dosya | `sub pm_pens_t0` yoksa: yedek (`macro_yedek_*.cnc`) alıp `change_tool` başına `#4900` bayraklı blok + sonuna `sub pm_pens_t0` ekler (cp1252). Mevcut macro.cnc'de alt program var → bugün etkisiz | `Macro-Pens-Yamasi`, `Macro-Yaz` | 2601–2621, 2622–2628 | [x] Arka plan |
| 1.20 | Eding'i başlatma ve gizleme | Eding exe yolunu bul (`ayarlar.txt` → `cnc.exe` → tek exe → bir kez OpenFileDialog), sunucu yalnız kaldıysa temizle, `Hidden` (ya da `Minimized`) başlat | `Eding-Exe-Bul`, `Eding-Baslat`, `Eding-Temizle` | 1260–1279, 1773–1786, 1287–1298 | [x] Arka plan; exe seçimi `Diyalog.ListeSec`/OpenFileDialog |
| 1.21 | Eding penceresini sürekli gizleme | 250 ms'de bir: Eding'in görünür ana/büyük pencerelerini `ShowWindow(0)`; başlıklı küçük #32770 uyarı kutularını gizlemez, panelin üstüne (TOPMOST) alır; açık modal pencere varsa onu, yoksa paneli öne getirir | `Eding-Gizle-Tik`, `[Pencere]::Gizle/UyarilariOneAl` | 1746–1768, 1663–1735 | [x] Arka plan; Eding uyarıları öne alınır |
| 1.22 | Bağlantı bekçisi | 2 sn'de bir: Eding+sunucu açıksa POWERUP'ta 30 sn takılırsa yeniden başlat; Eding kapandıysa bağlantıyı düşür (iş takibini "Eding kapandı" yap); 30 sn'de bir yeniden başlatmayı dener, otomatik hazırlığı yeniden kurar | `Baglanti-Bekcisi`, `Baglan`, `Rc-Tamam` | 1839–1871, 1875–1888, 1873 | [x] Arka plan; üst şerit "Eding bağlı / bağlı değil" (`Bagli`) |
| 1.23 | Otomatik hazırlık ⚠ HAREKET | Bağlantıdan sonra bir kez: acil stop yoksa ve Eding meşgul değilse `CncReset`; home alınmamışsa **geri sayım** (GeriSayim sn, varsayılan 5; 0 ise sormadan) sonra `Btn-Home $false`; "makine hazır" | `Acilis-Hazirla`, `Geri-Sayim` | 3205–3233, 3166–3202 | [x] `Diyalog.GeriSayim` (sureBitinceOnay=true ile eski davranış); meşgul katmanı (`Mesgul`, Ayarlar `GeriSayim`) |
| 1.24 | Frez yuvası/sensör/değişim noktası varsayılanlarını yazma ⚠ AYAR | Özel makroda, boşsa (0) onaysız yazar: #4020/#4021 = G54X−72.25 / G54Y; #4031/#4032/#4033 = −64.25/−52/0; #4010–#4018 + #4000 = 22.10.2026 doğrulanmış T1 değerleri (`$RafVarsayilan`, `$RafAralik`) | `Raf-Kontrol` (ana zamanlayıcıdan) | 3899–3923; çağrı 5860; sabitler 3876–3881 | [x] Arka plan; Kalibrasyon menüsü yuva özeti (`RafOzeti`) |
| 1.25 | Yarım iş açılışta seçili gelir | `devam.json` varsa dosyayı seçip kontrol eder, "devam için BAŞLAT" yazar | `Devam-Acilis` | 2911–2923 | [x] Üretim iş kartı (dosya adı + "devam için BAŞLAT" durum metni) (`Dosya`, `DurumMetni`) |
| 1.26 | Uzaktan erişimi başlat | bkz. 12.1 | `Uzak-Baslat` | 2732–2744 | [x] Uzaktan ekranı durumu (`UzakAcik`) — eskisi gibi panel yeniden açılınca uygulanır; Uzaktan ekranındaki anahtar sunucuyu hemen açar/kapatır |

## 2. Zamanlayıcılar

| # | Zamanlayıcı | Aralık | Ne yapar | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 2.1 | `$zamanlayici` (ana) | 1000 ms | `Hatalari-Kaydet`, `Baglanti-Bekcisi`, bağlan; durum lambası/metni (ACİL STOP yanıp söner, Eding hatası, EXTERR, duraklatıldı, kazınıyor/hareket ediyor, home alınmadı, hazır); BAŞLAT↔DEVAM metni; hız çipi okuma; SİMÜLASYON modu başlığı; Detaylar teknik satırı; Ayarlar açıksa makine+iş konumu; `Ilerleme-Guncelle`; manuel istek durumu; `Raf-Kontrol`; `Acilis-Hazirla`; acil stop varken Eding hareket ederse yeniden `Acil-Stop 'bekçi'` | 5805–5864 | [x] Denetleyicinin tek ana zamanlayıcısı → `Kabuk.Uygula` (200 ms) (tüm `MakineDurumu`) |
| 2.2 | `$koordZaman` | 50 ms | Ana ekran eksen değerleri (iş/makine) | 3574–3576 (`Koord-Guncelle` 3564–3572) | [x] Aynı `Uygula` (eksen paneli yalnız değişince çizer) (`X…MB`) |
| 2.3 | `$edingGizleZaman` | 250 ms | Eding penceresini gizleme / uyarıları öne alma | 1769–1771 | [x] Arka plan |
| 2.4 | `$uzakZaman` | 200 ms | Web sunucusu kuyruğundan komut alıp UI iş parçacığında çalıştırır (`UzakMesgul` korumalı); her 5 tikte (~1 sn) `Uzak-Durum` JSON | 2715–2731 | [x] Arka plan; `Diyalog.AcikSayisi` ile modal bilgisi (`Diyalog.AcikSayisi`) |
| 2.5 | `$manuelZaman` | 400 ms | Manuel frez değişimi isteklerini izler (yalnız özel makroda başlar) | 5871–5873, başlatma 5892 | [x] Arka plan → `Diyalog.ManuelFrezAdimi`, iş kartı mesajı (`ManuelMesaj`) |
| 2.6 | `$tmrProb` | 120 ms | Prob testi: 160 girişi okur, değişen ilk girişi prob olarak öğrenir, TEMAS VAR/YOK | 5242–5262 | [x] Arka plan → Oto sihirbaz ② gösterge (`ProbTemas`, `ProbTestAktif`) |
| 2.7 | Geri sayım (yerel) | 1000 ms | Home öncesi geri sayım penceresi | 3194–3197 | [x] `Diyalog.GeriSayim` (kendi 1 sn zamanlayıcısı) |
| 2.8 | C# animasyon | 40 ms / 50 ms | `LuxProgress` (dans eden hayvan, ilerleme), `SimView` canlı çizim | 233–238, 718–722 | [x] ProgressBand (16 ms, yalnız değişirken), SimView denetleyicide |

## 3. Ana ekran (form 1000×640, 3382–3557)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 3.1 | Başlık "PrimerMill" | Kabartma krom başlık (`EngravedTitle`) | — | 3405–3410 | [x] Üst şerit marka (◆ PRIMER) |
| 3.2 | Durum lambası | Renk: sarı hazır, yeşil çalışıyor, turuncu duraklatıldı/home yok, kırmızı hata/acil, gri bağlı değil | `StatusLamp` | 3412–3413, 1002–1033 | [x] Üst şerit durum hapı (tek renk sistemi; KU-04) (`Durum`) |
| 3.3 | Yazılım ACİL STOP düğmesi (sağ üst) | Basınca `Acil-Stop`, basılıyken tekrar basınca `Acil-Stop-Kaldir` (onaylı); ipucu "klavye: Esc" | `EStopButton`, `Acil-Stop` | 3414–3424, 868–920 | [x] Üst şerit sağ (her ekranda), diyaloglarda küçük + canlı katman; kaldırma alt şeritte (`acilstop`, `acilstop.kaldir`) |
| 3.4 | DOSYA SEÇ | bkz. 4.1 | `Btn-DosyaSec` | 3441 | [x] Üretim › İŞ SEÇ (`is.sec`) |
| 3.5 | HOME ⚠ HAREKET | bkz. 4.6 | `Btn-Home` | 3440 | [x] Üretim › bakım şeridi HOME (`home`) |
| 3.6 | BAŞLAT / DEVAM ⚠ HAREKET | bkz. 4.3; duraklatılmışken metin DEVAM | `Btn-Baslat` | 3442, 5836 | [x] Üretim › BAŞLAT (duraklatılmışken DEVAM) (`is.baslat` / `is.devam`) |
| 3.7 | DURAKLAT | bkz. 4.4 | `Btn-Duraklat` | 3443 | [x] Üretim › DURAKLAT (`is.duraklat`) |
| 3.8 | DURDUR | bkz. 4.5 | `Btn-Durdur` | 3444 | [x] Üretim › DURDUR (`is.durdur`) |
| 3.9 | RESET | bkz. 4.7 | `Btn-Reset` | 3445 | [x] Üretim › ALARMI TEMİZLE; alt şerit alarm bandı (`makine.reset`) |
| 3.10 | FREZ BIRAK ⚠ HAREKET | bkz. 4.8 | `Btn-FrezBirak` | 3446 | [x] Takımlar › Takım değişimi › FREZİ BIRAK; ayrıca TAKIM → BOŞALT (T0) (`frez.birak` / `takim.degistir 0`) |
| 3.11 | PENS AÇ / PENS KAPAT | bkz. 4.9 | `Btn-Pens` | 3447 | [x] Takımlar › PENS AÇ / PENS KAPAT (Takım değişimi, Yuva ayarı, İş mili ve hava) (`pens.ac`, `pens.kapat`) |
| 3.12 | TEMİZLİK / PARK ⚠ HAREKET | bkz. 4.10 | `Btn-Temizlik` | 3448 | [x] Üretim › TEMİZLİK ve ayrı PARK düğmesi (`temizlik`, `park`) |
| 3.13 | Eksen satırı X Y Z A B | 50 ms güncellenir; etikete/değerlere/"İŞ" yazısına tıklayınca İŞ ↔ MAKİNE koordinatı | `Koord-Degistir`, `Koord-Guncelle` | 3518–3572 | [x] Üretim › Konum kartı (iş büyük, makine küçük; İŞ/MAKİNE seçimi, panele dokunma) (`ayar.kaydet Koordinat=`) |
| 3.14 | Küçük simülasyon | Seçili işin üst/alt yüz kesim görüntüsü, canlı satır ilerlemesi; tıklayınca büyük simülasyon penceresi | `SimView`, `SimRenderer`, `PartModel` | 3451–3454, 458–734 | [x] Üretim › Simülasyon kartı (`SimHost`), BÜYÜT (`sim.buyuk`) |
| 3.15 | Dosya adı etiketi | "Bir dosya seçin" / dosya adı / "Makine hazır · bir dosya seçin" | `$lblDosya` | 3456 | [x] Üretim › İş kartı başlığı ("Makine hazır · bir iş seçin") (`Dosya`) |
| 3.16 | İlerleme çubuğu + dans eden hayvan | Yüzde; iş sürerken rastgele hayvan (10 tür) dans eder; bitince kutlama | `LuxProgress`, `Hayvanlar` | 3458–3460, 227–457 | [~] İş kartı ProgressBand; hayvan yerine isteğe bağlı parıltı (TASARIM §5 "başka animasyon yok"), bitince "BİTTİ" (`Yuzde`, `Dansci`, `IsTamamlandi`) — dans eden hayvan kaldırıldı; yerine isteğe bağlı ilerleme parıltısı (`Dansci`), bitince "BİTTİ" (TASARIM §5) |
| 3.17 | Süre satırı | Tahmini süre / "Kazıma … · Kalan … · Bitiş HH:mm" / Duraklatıldı / Tamamlandı / Durdu / hata metinleri | `$lblSure`, `Dosya-Ozeti`, `Ilerleme-Guncelle` | 3462, 5675–5682 | [x] GEÇEN / KALAN (büyük) / BİTİŞ / tahmini (`GecenSn`, `KalanSn`, `BitisSaati`, `TahminiSn`) |
| 3.18 | Durum satırı | "● Hazır · T3", "Kazınıyor", "MANUEL FREZ: …", "· simülasyon" | `Durum-Yaz` | 3463, 5669–5673 | [x] İş kartı durum satırı; takım kartı; SİMÜLASYON çipi (`DurumMetni`, `ManuelMesaj`, `EdingSimulasyon`) |
| 3.19 | Çip: Ayarlar | Ayarlar penceresini açar (makine bilgisayarı değilse uyarı) | `$lnkAyar` | 3472, 3486–3490 | [x] Sol menü › Ayarlar |
| 3.20 | Çip: Detaylar | Detaylar penceresini açar | `$lnkDetay` | 3473, 3485 | [x] Sol menü › Kayıtlar (teknik bilgi + log + MDI) |
| 3.21 | Çip: "Blok takıldı" (Sade) / "Frez: Manuel/Otomatik" (Sade değil) | Sade: `Yeni-Blok` diyaloğu; durumu "Blok: 123 ✓", "Blok hazır ✓". Sade değil: frez modu seçimi (+ manuel makro kontrolü) | `$lnkMod`, `Yeni-Blok`, `Blok-Cip-Guncelle`, `Frez-Modu-Sor` | 3474–3484, 3491–3498, 2513–2519 | [x] Üretim › YENİ BLOK (+ blok durum yazısı); frez modu Takımlar başlığı ve Ayarlar › İş akışı (`blok.*`, `frez.modu`) |
| 3.22 | Kazıma hızı çipi [− %100 +] | −/+ 10 (%30–%150), ortası %100; %120 üstü bir kez onay; kabul edilmezse uyarı; renk (kırmızı >120, yeşil ≠100) | `HizCip`, `Hiz-Ayarla`, `Hiz-Oku` | 3476–3481, 3499–3501, 3137–3161, 971–1001 | [x] Üretim › Konum kartı › İlerleme oranı [−] %100 [+] (`hiz.azalt/artir/normal`) |
| 3.23 | Taban markası "PRİMER TEKNOLOJİ" | — | — | 3503–3516 | [x] Üst şerit marka |
| 3.24 | Pencere başlığı | "Primer Teknoloji" / "· SİMÜLASYON" (Eding simülasyon modunda) | ana zamanlayıcı | 3383, 5840–5842 | [x] `Kabuk.Text` = "PrimerMill 2"; SİMÜLASYON çipi (`EdingSimulasyon`) |
| 3.25 | Simge durumu / Kapat (tam ekranda) | Sol alt "—" ve "✕" | `Tam-Ekran-Uygula` | 6005–6020 | [x] Ayarlar › Genel › Panel penceresi (`panel.kucult`, `panel.kapat`) |
| 3.26 | Önizleme modu | Makine bilgisayarı değilse ana düğmeler kapalı, "Önizleme modu", yalnız dosya kontrolü | `Add_Shown`, ana zamanlayıcı | 5882–5884, 5811 | [x] ÖNİZLEME çipi; düğmeler izinle kapalı (`Onizleme`) |

## 4. İş akışı (günlük kullanım)

| # | Özellik | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 4.1 | Dosya seç | İş sürerken yasak; OpenFileDialog (.nc); dosyayı `isler\`e ve `AKTIF_IS.nc` olarak kopyalar; kontrol eder | `Btn-DosyaSec` | 2028–2053 | [x] Üretim › İŞ SEÇ → dokunmatik liste (`Diyalog.ListeSec`, İŞLER klasörü), "GÖZAT…" ek düğmesi Windows dosya seçici (`is.sec`) |
| 4.2 | Dosya kontrolü ve süre tahmini | `NcAnaliz.Oku`: satır, takımlar (`T n M6`), GOSUB/M100/M101 alt programları, M30, G92/G10 (HATA), tahmini süre (hızlı 4000 mm/dk), takım konumları, üst/alt yüz sınırları. Hatalar: <10 satır, M30 yok, T>6, macro.cnc'de olmayan alt program. Uyarı: ayarlanmamış takım. Hata varsa başlatma engellenir (`$script:Engel`). Simülasyona veri, dansçı seçimi | `Dosyayi-Kontrol-Et`, `Makro-AltProgramlari`, `[NcAnaliz]` | 1961–1997, 1942–1959, 1034–1123 | [x] İş kartı: takımlar, tahmini süre, uyarı/hata rozeti → liste; hata varsa kırmızı şerit ve BAŞLAT izni kapalı (`IsTakimlari`, `TahminiSn`, `IsUyarilari`, `IsHatalari`) |
| 4.3 | BAŞLAT ⚠ HAREKET | Çift basış koruması. Sıra: (a) manuel frez isteği bekliyorsa o adımı onayla; (b) duraklatılmışsa devam et (Sade'de onaysız); (c) uzaktan ekran tıklamasıyla (son 5 sn) basıldıysa ve "Blok takıldı" onayı yoksa reddet; (d) dosya/engel/Hazır-Mi (acil kilit, bağlantı, EXTERR→onaylı RESET, home) kontrolleri; (e) bu dosyanın yarım kaydı varsa Devam diyaloğu; (f) (Sade değil) uyarı onayı; (g) (Sade değil) frez modu sorusu; (h) frez modunu Eding'e (#4030) eşitle, manuelde makro sürüm kontrolü; (i) bekleyen yeni blok varsa isim kazımayı programın başına ekle (`*_blok*.nc`); (Sade değil) `Blok-Sor`; (j) (Sade değil) 5 maddelik kontrol onayı; (k) Sade'de iş milinde frez varsa yuvasına bırakmayı sor (M6 T0); (l) `#4034=0`, yükle, `Is-Calistir` (15 sn dener); devam kaydını başlat, takip değişkenlerini sıfırla | `Btn-Baslat`, `Btn-Baslat-Ic`, `Hazir-Mi`, `Is-Calistir`, `Bos-Ismili-Hazirla` | 2958–2962, 2963–3080, 1999–2021, 2926–2938, 2941–2954 | [x] BAŞLAT; alt sorular denetleyicide `Diyalog.*` ile (`is.baslat`) |
| 4.4 | DURAKLAT | Çalışıyorsa `CncPauseJob` | `Btn-Duraklat` | 3082–3086 | [x] DURAKLAT (`is.duraklat`) |
| 4.5 | DURDUR | `CncAbortJob` (onaysız); iş aktifse devam kaydı 'durduruldu' | `Btn-Durdur` | 3088–3097 | [x] DURDUR (DURAKLAT'tan ayrık) (`is.durdur`) |
| 4.6 | HOME ⚠ HAREKET | Acil kilit / bağlantı / EXTERR / çalışıyor kontrolü; (Sade değil) onay; `CncReset` (sürücüleri açar), `gosub home_all`, 240 sn bekler; sonuç kontrolü | `Btn-Home` | 3108–3132 | [x] HOME (`home`) |
| 4.7 | RESET | Acil kilit varsa kaldırma akışı; EXTERR basılıysa uyarı; çalışıyorsa onay; `CncReset`; pens durumu sıfır; `Panel-Sifirla` | `Btn-Reset`, `Panel-Sifirla` | 3309–3321, 3236–3261 | [x] ALARMI TEMİZLE / KİLİDİ KALDIR (`makine.reset`, `acilstop.kaldir`) |
| 4.8 | FREZ BIRAK ⚠ HAREKET | Hazır ve çalışmıyorken; T0 değilse onay ("yuvası BOŞ mu, kompresör açık mı") → `M6 T0` | `Btn-FrezBirak` | 3099–3106 | [x] FREZİ BIRAK (`frez.birak`) |
| 4.9 | PENS AÇ / KAPAT | Aç: (Sade değil onay) `gosub pm_pens_t0` (pens açılır, takım T0; makroda yoksa yalnız `M54 P2`), sonuç T0 değilse uyarı. Kapat: `M55 P2` | `Btn-Pens`, `Pens-Ac-T0` | 3324–3333, 3794–3824 | [x] PENS AÇ / KAPAT (`pens.ac`, `pens.kapat`) — pens açık göstergesi panelden verilen komuta göre (gerçek çıkış okunmuyor, eskisi gibi) |
| 4.10 | TEMİZLİK / PARK ⚠ HAREKET | 1. basış: `G53 G0 Z[#5163]` sonra `G53 G0 A[#5224] B[#5225]` (kol yatay), düğme "PARK" olur. 2. basış: Z üst, `G30` | `Btn-Temizlik` | 3347–3369 | [x] TEMİZLİK, PARK (`temizlik`, `park`) |
| 4.11 | İlerleme takibi | Eding satırından (RUN-SUB'da yok sayılır, büyük sıçrama 3 tik doğrulanır) yüzde, simülasyon satırı, geçen/kalan/bitiş saati (gerçek/tahmini oranla düzeltme), 5'lik yüzde log, 30 sn teşhis; erken bırakılan takibi yeniden başlatma; 2 sn'de bir devam kaydı | `Ilerleme-Guncelle` | 5684–5797 | [x] İş kartı (yüzde, satır, geçen/kalan/bitiş), simülasyon (`Yuzde`, `Satir`…) |
| 4.12 | İş sonu algılama ve hata pencereleri | 5 sn çalışmıyorsa bitti; >%97 tamamlandı (kutlama); EXTERR ile durdu penceresi (basınç); Eding hatası penceresi; **freze hatası** (#4099 > #4005: m100 boy farkı) penceresi; yarım kaldıysa devam kaydı | `Ilerleme-Guncelle` | 5741–5786 | [x] `IsTamamlandi` → BİTTİ; hata pencereleri `Diyalog.Hata(neOldu, neYapmali)` |
| 4.13 | Kaldığı yerden devam ⚠ HAREKET | `devam.json` (atomik yazma); BAŞLAT'ta aynı dosya için diyalog: KALDIĞI YERDEN (son `GOSUB Z_SAFE`'ten), YAKIN NOKTADAN (~60 sn geriden, XY'ye gidip Z'ye F≤600 iner), BAŞTAN, Vazgeç; iş milindeki frezi seçtirir, farklıysa `#4039/#4900=1; M6 Tn; =0` ile Eding'e hareketsiz bildirir; modal durum (T, S/M3, M7/M8, F, A/B, G0-3) toplanıp `*_devam.nc` üretilir; satır haritası | `Devam-Oku`, `Devam-Sil`, `Devam-Kaydet`, `Devam-NC-Uret`, `Devam-Diyalog`, `Devam-Baslat` | 2754–2908 | [x] `Diyalog.Devam` (KALDIĞI YERDEN / YAKIN NOKTADAN / BAŞTAN / VAZGEÇ + iş milindeki frez) (`DevamSonucu`) |
| 4.14 | Hata temizleme | Eding hata/ABORTED durumundaysa komuttan önce `CncReset` | `Hata-Temizle` | 1827–1833 | [x] Arka plan |
| 4.15 | Komut sonucu gösterimi | rc 0/7 = tamam; acil kilitte uyarı; aksi halde hata penceresi | `Komut-Sonucu` | 1890–1901 | [x] Alt şerit bildirim (`Bildir`) ya da `Diyalog.Hata` |
| 4.16 | Hareket bitişini bekleme | DoEvents ile süre sınırlı bekleme, hata durumunu raporlar | `Hareket-Bitene-Kadar-Bekle` | 1903–1917 | [x] Arka plan; meşgul katmanı (`Mesgul`) |

## 5. Yeni blok (blok numarası / ismi kazıma)

| # | Özellik | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 5.1 | "Blok takıldı" diyaloğu (Sade) | İsim (varsayılan `bloklar.csv`'deki son no+1, en çok 10 karakter), kalınlık (10–30), derinlik (0.05–0.5); düğmeler: KAZI VE İŞE BAŞLA (dosya seçiliyse), SADECE İSMİ KAZI, YENİ BLOK HAZIR (işi bilgisayardan başlatacağım), KULLANILMIŞ BLOK hazır, Bekleyen bloğu iptal et, Vazgeç. Uzaktan başlatma kilidini açar (`$script:BlokHazir`) | `Yeni-Blok` | 2520–2598 | [x] Üretim › YENİ BLOK → `Diyalog.YeniBlok` (isim ≤10, kalınlık 10–30, derinlik 0.05–0.5, 5 seçenek + VAZGEÇ) (`blok.kazibasla/sadeceisim/yenihazir/kullanilmis/iptal`) |
| 5.2 | Sadece ismi kazı ⚠ HAREKET | `PM_blok_<isim>.nc`: CHECK_EMPTY_TOOL + kazıma + `T0 M6` + M30; yükle ve çalıştır | `Yeni-Blok` | 2577–2597 | [x] Aynı diyalog (`blok.sadeceisim`) |
| 5.3 | Kazıma G-kodu üretimi ⚠ HAREKET | Tek çizgili 4×6 ızgara yazı tipi (0–9, A–Z, - . /), r=41.5 mm yay, saat 12/3/6/9 yönü, 0.25 mm parçalama, dalma F40 ilerleme F200, S24000, referans çizgisi r 45.5→48.7 + 3 mm dik çizgi; Sade: T2, yükseklik 4 mm, saat 9 (ya da ayardan 3) | `Blok-Kazima-NC`, `$BlokFont`, `Blok-Metin-Temizle` | 2319–2400, 2268–2309, 2311–2316 | [x] Arka plan; taraf ayarı Ayarlar › İş akışı (`ayar.kaydet SadeTaraf=`) |
| 5.4 | İşle birleştirme | İsim kazımayı işin başına ekler, işin ikinci CHECK_EMPTY_TOOL'unu kaldırır, `<iş>_blok<isim>.nc` | `Blok-Birlesik-Uret` | 2481–2500 | [x] Arka plan (`blok.kazibasla`) |
| 5.5 | Blok kaydı | `bloklar.csv` (tarih;no;ilk_is;disk_mm) | `Blok-Kaydet`, `Blok-Sonraki-No` | 2502–2507, 2403–2411 | [x] Arka plan; varsayılan isim `BlokSonrakiIsim` |
| 5.6 | Eski blok sorusu (ÖLÜ / Sade'de kapalı) | Numara, disk, frez T1–T6, çap, yazı yüksekliği 2–5, yer saat 12/3/6/9, referans çizgisi; KULLANILMIŞ / YENİ / Vazgeç | `Blok-Sor` | 2413–2479 | [ ] yerleştirilmedi: ölü kod (Sade=true, bugün çalışmıyor); yeni blok akışı 5.1 kapsar, `BlokSor` anahtarı korunur |

## 6. Manuel frez değişimi (#4030 = 1)

| # | Özellik | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 6.1 | Frez modu ayarı | Ayarlar › PANEL onay kutusu; `FrezModu` kaydı; Eding'e `#4030` yazar; özel makro yoksa reddeder | A-Secim | 5547–5556 | [x] Ayarlar › İş akışı › Frez değişimi MANUEL; Takımlar başlığı (`ayar.kaydet FrezModu=`, `frez.modu`) |
| 6.2 | Frez modu yaz/oku/göster | `#4030` yaz, oku; (Sade değil) çip metni | `Frez-Modu-Yaz`, `Frez-Manuel-Mi`, `Frez-Modu-Goster` | 2065–2071, 2063, 2073–2079 | [x] Takım kartı, Takımlar başlığı (`FrezModu`) |
| 6.3 | Frez modu sorusu | OTOMATİK / MANUEL / Vazgeç (Kal-Test-Hazirla ve Sade-dışı BAŞLAT'ta) | `Frez-Modu-Sor` | 2081–2112 | [x] `Diyalog.Secim` (OTOMATİK / MANUEL) |
| 6.4 | Makro sürüm kontrolü | Dosyada `manual_change` + `pm_surum` var mı; Eding'de yüklü mü (`#4038=0`, `gosub pm_surum`, `#4038 >= 2`); değilse Eding'i yeniden başlatmayı önerir | `Manuel-Macro-Kontrol` | 2115–2143 | [x] Arka plan; yeniden başlatma önerisi `Diyalog.Onay` |
| 6.5 | İstek izleme | 400 ms: `#4034` (1000+T pens açılacak, 2000+T tak, 3000+T hava yok, 4000+T ölçüldü-son onay), `#4036` eski, `#4037` sıra; okunamazsa konum+#5011/#5008+pens çıkışından tahmin; teşhis logu | `Manuel-Izle`, `Manuel-Istek`, `Manuel-Istek-Tahmin` | 2229–2263, 2145–2151, 2155–2162 | [x] Arka plan |
| 6.6 | Manuel adım penceresi | TopMost, ses; faz metinleri; düğmeler PENS'İ AÇ / TAKTIM·PENS'İ KAPAT / ÇIKARDIM / KAZIMAYI BAŞLAT; "İşi durdur" (onaylı); Esc = acil stop; onayda `CncRunOrResumeJob` (8 sn dener) | `Manuel-Diyalog`, `Manuel-Devam` | 2175–2225, 2164–2173 | [x] `Diyalog.ManuelFrezAdimi` (büyük, ses, Esc = ACİL STOP, "İşi durdur" düğmesi) |
| 6.7 | Durum satırında manuel bilgisi | "MANUEL FREZ: …", hava yoksa "KOMPRESÖRÜ AÇ" (kırmızı) | ana zamanlayıcı | 5853–5858 | [x] İş kartı kehribar satır; hava yoksa kırmızı "KOMPRESÖRÜ AÇ" (`ManuelMesaj`, `HavaYok`) |

## 7. Acil stop (yazılım)

| # | Özellik | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 7.1 | ACİL STOP | Kilidi kur (`[Eding]::AcilKilit`), tercihe yaz (kalıcı), işi kes, çıkış 4 (iş mili) ve 11 (hava) = 0, tekrar kes, `CncReset`, zorla `M5`, `M9`, `M55 P4`; takibi bitir, kırmızı lamba | `Acil-Stop` | 3266–3291 | [x] Üst şerit (basınca anında, pasif olmaz) (`acilstop`) |
| 7.2 | Tetikleyiciler | E-stop düğmesi; Esc tuşu (ana, Ayarlar, Detaylar, Simülasyon pencereleri); manuel adım penceresinde Esc; bekçi (kilitliyken Eding hareket ederse) | — | 3418, 5866–5869, 2214, 5824 | [x] E-stop düğmesi, Esc her pencerede/diyalogda, diyalog katmanı; bekçi arka planda (`acilstop`, `Diyalog.AcilStop`) |
| 7.3 | Acil stop kaldır | Onay ("makine kendiliğinden hareket etmez"), kilidi kaldır, tercihe yaz, `CncReset`, pens durumu, `Panel-Sifirla` | `Acil-Stop-Kaldir` | 3293–3307 | [x] Alt şerit KİLİDİ KALDIR; Üretim bakım şeridi (`acilstop.kaldir`) |
| 7.4 | Kilitliyken komut engeli | C# sarmalayıcılar hareket komutlarını göndermez (-1); `Hazir-Mi`, `Btn-Home`, `Uzak-Komut` uyarır | `Eding` sınıfı | 1167–1176 | [x] İzin tablosu (tüm hareket komutları "Acil stop basılı") + arka plan C# kilidi (`IzinleriUygula`) |

## 8. Ayarlar penceresi (980×660, 4124–5603)

Üstte her sekmede görünen **anlık konum** satırı (makine + iş, T, home durumu; ana zamanlayıcı yazar) — `$lblKonum` 4178–4182, güncelleme 5845–5851. Sekme çubuğu 4186–4213 (`Sekme-Goster` 4189–4200: KALİBRASYON'da `Ayar-Oku`, YUVA AYARI'nda liste yenile, DİSK/OTO'da değer göster). Pencere açılınca `Ayar-Oku` + yuva geometrisi (5603). Kapatınca gizlenir (4134). **Sade ve özel makro yoksa** YUVA AYARI, KALİBRASYON, DİSK KALİBRASYONU, OTO KALİBRASYON sekmeleri gizlenir (4216–4223).

### 8.1 HAREKET sekmesi (4226–4265)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.1.1 | Adım seçimi | 0.01 / 0.1 / 1 / 10 mm-derece | `Adim-Isaretle` | 4229–4235, 4244–4247 | [x] Takımlar › Hareket › adım (0.01/0.1/1/10/SÜREKLİ); varsayılan Ayarlar › Hareket (`jog` Arg, `ayar.kaydet JogAdim=`) |
| 8.1.2 | Hız seçimi | Yavaş 100 / Orta 300 / Hızlı 1000 mm/dk (A/B 50–1000) | — | 4236–4243 | [x] Takımlar › Hareket › Yavaş 100 / Orta 300 / Hızlı 1000 (`jog` Arg, `ayar.kaydet JogHiz=`) |
| 8.1.3 | Jog düğmeleri ⚠ HAREKET | X−/X+, Y− arka/Y+ ön, Z− aşağı/Z+ yukarı, A−/A+ kol, B−/B+ disk; `G91 G1 … F…` + `G90`; Z− ≥10 mm onaylı | `Jog`, `Satirlar-Gonder` | 4248–4254, 3691–3699, 3679–3688 | [~] Takımlar › Hareket › X−/X+, Y− arka/Y+ ön, Z− aşağı/Z+ yukarı, A kol, B disk (`jog`, `jog.basla/bitir`) — Adım jog var (0.01–10 mm); **basılı tutarak sürekli jog yok** (`jog.basla/bitir` pasif, nedeni "adım seçin") |
| 8.1.4 | İş mili en üste ⚠ | `G90 G53 G0 Z[#5163]` | `Yukari-Kaldir` | 4257, 3740–3743 | [x] Takımlar › Hareket › İŞ MİLİ EN ÜSTE (`eksen.yukari`) |
| 8.1.5 | Kol düz (takım alma) ⚠ | Z üst, `G53 G0 A[#5224] B[#5225]` | `Konuma-Git` | 4258, 3701–3705 | [x] KOL DÜZ (TAKIM ALMA) (`konum.koldz`) |
| 8.1.6 | Takım alanı ⚠ | `gosub azxy_safe` | `Konuma-Git` | 4259 | [x] TAKIM ALANI (`konum.takimalani`) |
| 8.1.7 | Blok değiştirme ⚠ | Z üst, kol düz, `gosub ClearPos` | `Konuma-Git` | 4260 | [x] BLOK DEĞİŞTİRME (`konum.blok`) |
| 8.1.8 | Park (G30) ⚠ | Z üst, `G30` | `Konuma-Git` | 4261 | [x] PARK (G30) (`konum.park`) |
| 8.1.9 | Konum etiketi | "Konum: …" | `$lblYuva` | 4263–4264 | [x] Hareket sekmesi eksen değerleri (iş + mak) (`X…MB`) |

### 8.2 TAKIM sekmesi (4267–4288)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.2.1 | T1…T6 al, Bırak (T0) ⚠ HAREKET | Onay sonrası `M6 Tn` (180 sn) | `Takim-Degistir` | 4269–4270, 3745–3751 | [x] Takımlar › Takım değişimi (yuva kartı seç → "Tn AL", FREZİ BIRAK); Üretim › TAKIM (`takim.degistir`, `frez.birak`) |
| 8.2.2 | Yuvalara git (T1 T2 T3 Sensör T4 T5 T6) ⚠ HAREKET | Frezeye dokunmadan üstünde durur: önce #4010–#4018/#4020–#4021 değişkenleri, yoksa macro'dan okunan G53 sabitleri, yoksa `#5221−X, #5222±Y` hesabı | `Yuvaya-Git` | 4272–4274, 3708–3730 | [x] Yuva kartı seç → YUVAYA GİT (T1–T6, SENSÖR, MANUEL) (`yuva.git`) |
| 8.2.3 | Yaklaş ⚠ | İş mili boşsa, onayla `G53 G1 Z[#4001] F300` | `Yuvaya-Yaklas` | 4275, 3732–3738 | [x] YAKLAŞ (`yuva.yaklas`) — YAKLAŞ yalnız son YUVAYA GİT yapılan yuvada, araya hareket girmeden (SK-02, MAKİNEDE DOĞRULA) |
| 8.2.4 | Yukarı ⚠ | Z en üst | `Yukari-Kaldir` | 4276 | [x] YUKARI (`eksen.yukari`) |
| 8.2.5 | Takım boyunu ölç ⚠ | Onay, `gosub user_1` (G92 Z) | `Takim-Olc` | 4279, 3753–3758 | [x] TAKIM BOYUNU ÖLÇ (`takim.olc`) |
| 8.2.6 | Aşınma kontrolü ⚠ | `M100`, sonuç `#4002−#5063` ve sınır `#4005` penceresi | `Asinma-Kontrol` | 4280, 3760–3768 | [x] AŞINMA KONTROLÜ (sonuç `Diyalog.Bilgi`) (`takim.asinma`) |
| 8.2.7 | İş mili boş mu? ⚠ | Onay, `gosub is_empty_tool` | `Bos-Mu` | 4281, 3770–3774 | [x] İŞ MİLİ BOŞ MU? (`takim.bosmu`) |
| 8.2.8 | Yuva geometrisi + "macro.cnc'den yeniden oku" | PickTool1..6 içinden G53 X/Y/A/B ya da `#5221 - X`, `#5222 ± Y` desenlerini okur (bugünkü makroda bu desenler yok → varsayılanlar) | `Yuva-Geometrisi-Oku` | 4284–4288, 3611–3640 | [x] Takımlar › Yuva ayarı › MACRO'DAN OKU (`yuva.geometri.oku`) |

### 8.3 YUVA AYARI sekmesi — frez alma kalibrasyonu sihirbazı (4493–4562)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.3.1 | Yuva listesi | T1–T6, Sensör, Değişim; kayıtlı (makine), yeni alınan, fark; seçim | `$lvYuva`, `Yuva-Liste-Yenile`, `Yuva-Kayitli`, `Yuva-Hedef` | 4496–4513, 4332–4360, 4296–4311, 4313–4330 | [x] Yuva ayarı › Yuva listesi tablosu (kayıtlı / yeni / fark; dokunarak seç) (`Yuvalar[].Yeni/Fark`) |
| 8.3.2 | Yuvaya git ⚠ HAREKET | Seçili hedefe (yeni T1 alındıysa kaydırılmış tahmine); frez takılıysa onay; Değişim'de Z'ye de iner | `Yuva-Git` | 4517, 4362–4373 | [x] GİT (`yuva.git`) |
| 8.3.3 | Yaklaş (#4001) ⚠ | İş mili boşsa onayla `G53 G1 Z#4001 F300` | `Yuva-Yaklas` | 4518, 4375–4381 | [x] YAKLAŞ (`yuva.yaklas`) — YAKLAŞ yalnız sihirbazda son GİT yapılan noktada; GİT'ten sonra yalnız ortalama jog'u (XY ≤ 2 mm, Z/A/B değişmemiş) (SK-02/SK-16, MAKİNEDE DOĞRULA) |
| 8.3.4 | Yukarı ⚠ | Z en üst | `Yukari-Kaldir` | 4519 | [x] YUKARI (`eksen.yukari`) |
| 8.3.5 | İnce adım + jog ⚠ HAREKET | Adım 0.01/0.05/0.1/0.5/1; X/Y/Z/A/B ± | `Jog` | 4521–4532 | [x] İnce ayar kartı: adım 0.01/0.05/0.1/0.5/1, X/Y/Z/A/B ± (`jog`) |
| 8.3.6 | Pens aç / Pens kapat / Hava üfle | `Pens-Ac-T0`, `M55 P2`, `M54 P4`+`M55 P4` | `Pens-Ac-T0`, `Tek-Komut`, `Hava-Ufle` | 4536–4538 | [x] İnce ayar kartı (`pens.ac`, `pens.kapat`, `hava.ufle`) |
| 8.3.7 | "T1 alınırken Z'yi alma yüksekliği al" | Onay kutusu | `$chkYuvaZ` | 4539–4543 | [x] Seçili yuva kartı anahtarı (`yuva.zal`) |
| 8.3.8 | BU KONUMU AL | Makine konumunu bellekte alır (Eding'e yazmaz); Sensör'de A=G54A şartı; T2–T6'da X/A sapma uyarısı; sıradakine geçer | `Yuva-Al` | 4545–4546, 4383–4422 | [x] BU KONUMU AL (Tn) (`yuva.al`) |
| 8.3.9 | KAYDET (hepsi) ⚠ AYAR | Özet + onay; ölçülmeyen yuvaları T1 ile kaydırma (Evet/Hayır/İptal); otomatik yedek; #4000, #4010–#4018, #4020–#4021, #4031–#4033 | `Yuva-Kaydet` | 4548–4549, 4424–4462 | [x] KAYDET (`yuva.kaydet`) |
| 8.3.10 | Baştan başla | Bellekteki değerleri siler | `Yuva-Sifirla` | 4550, 4464–4471 | [x] BAŞTAN (`yuva.sifirla`) |
| 8.3.11 | Doğrulanmış değerlere dön ⚠ AYAR | Onay + yedek; `$RafVarsayilan` | `Yuva-Varsayilan` | 4551, 4473–4486 | [x] DOĞRULANMIŞ (`yuva.varsayilan`) |
| 8.3.12 | TEST: T1–T6 al, Bırak ⚠ HAREKET | Kaydedilmemiş değer yoksa `Takim-Degistir` | `Yuva-Test` | 4553–4555, 4488–4491 | [x] TEST AL (seçili yuva); bırak = FREZİ BIRAK (`yuva.test`, `frez.birak`) |
| 8.3.13 | Durum / ortak değerler etiketi | — | `$lblYuvaOrtak`, `$lblYuvaDurum` | 4533–4534, 4556–4557 | [x] İnce ayar kartı 2. satır (kayıtlı ortak), liste başlığında "KAYDEDİLMEDİ" (`YuvaOrtak`, `YuvaKaydedilmemis`) |

### 8.4 İŞ MİLİ VE HAVA sekmesi (5460–5477)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.4.1 | Devir kutusu + Çalıştır (M3) ⚠ | 1000–24000; frez yoksa ya da varsa onay; `S… M3` | `Ismili-Calistir` | 5462–5465, 3777–3785 | [x] Takımlar › İş mili ve hava › Devir kutusu, ÇALIŞTIR (M3) (`ismili.calistir`) |
| 8.4.2 | Durdur (M5) | `M5` | `Tek-Komut` | 5466, 3826–3829 | [x] DURDUR (M5) (`ismili.durdur`) |
| 8.4.3 | Pens aç (→T0) / Pens kapat (M55 P2) / Hava üfle (M54 P4) | — | `Pens-Ac-T0`, `Tek-Komut`, `Hava-Ufle` | 5470–5472, 3787–3792 | [x] Pens ve hava kartı (`pens.ac`, `pens.kapat`, `hava.ufle`) |
| 8.4.4 | M7 aç / M8 aç / Hepsini kapat (M9) | — | `Tek-Komut` | 5475–5477 | [~] Soğutma kartı (`sogutma.m7/m8/kapat`) — komutlar çalışır; M7/M8 açık/kapalı göstergesi yok (`MakineDurumu.M7/M8` doldurulmuyor: çıkış numaraları bilinmiyor) |

### 8.5 KALİBRASYON sekmesi (5481–5526)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.5.1 | G54 X Y Z A B kutuları | #5221–#5225 | `Ayar-Oku` | 5483–5487, 3838–3855 | [x] Ayarlar › Makine değişkenleri (dokun → tuş takımı) (`G54`, `degisken.kaydet`) |
| 8.5.2 | Takım değiştirici parametreleri | #4000 alma Z, #4001 yaklaşma Z, #4002 sensör yüksekliği, #4003 yavaş yaklaşma, #4004 ölçüm alt sınırı, #4005 aşınma sınırı, #4006 takım algılama | `$ParamTanim` | 5488–5495, 3832–3834 | [x] Aynı sayfa, 7 kutu (adlarıyla) (`Param`) |
| 8.5.3 | G92 satırı | #5211–#5215; X/Y/A/B'de G92 varsa kırmızı uyarı | `Ayar-Oku` | 5496, 3845–3848 | [x] Aynı sayfa G92 sütunu (X/Y/A/B ≠ 0 kırmızı); Kalibrasyon bilgi şeridi (`G92`) |
| 8.5.4 | Değerleri oku | — | `Ayar-Oku` | 5497 | [x] DEĞERLERİ OKU (`degisken.oku`) |
| 8.5.5 | Kaydet ⚠ AYAR | Onay; `G10 L2 P1 X Y Z A B` + `#4000–#4006` (**otomatik yedek yok**) | `Ayar-Kaydet` | 5498, 3857–3872 | [x] KAYDET (12 değer) (`degisken.kaydet`) |
| 8.5.6 | Yuva seç + "Şu anki konum = Tn / Sensör" ⚠ AYAR | T1: X/Y/A/B + diğerlerini kaydır (Evet/Hayır/İptal); Tn: yalnız Y; isteğe bağlı Z=#4000; Sensör: A=G54A şartı; otomatik yedek | `Konumu-Yuva-Yap`, `Konumu-Sensor-Yap` | 5499–5510, 3949–3995, 3925–3947 | [x] Kalibrasyon › Konumdan yuva / sensör › KONUMU KAYDET (seçim diyaloğu) (`kal.konum.yuva`) — T1 üçlü soru (diğer yuvalar da kaysın mı) normal seçim diyaloğu; yedek yazmadan önce alınır |
| 8.5.7 | Şu anki Z = alma yüksekliği ⚠ AYAR | `#4000 = Z` (yedek yok) | `Z-Alma-Yap` | 5511, 3997–4002 | [x] Kalibrasyon › Takım boyu ve Z; Makine değişkenleri (`kal.zalma`) |
| 8.5.8 | G92 sıfırla ⚠ | `G92.1` (onaylı) | `G92-Sifirla` | 5512, 4046–4050 | [x] Kalibrasyon › G54 ve üretici; Makine değişkenleri (`kal.g92sifirla`) |
| 8.5.9 | Ayarları yedekle | `yedekler\ayar_*.txt`: #5221–#5225, #4000–#4006, #4010–#4018, #4020–#4021, #4030–#4033, #5161–#5165, #5181–#5185 | `Ayar-Yedekle` | 5514, 4053–4064 | [x] Kalibrasyon › Yedekler; Ayarlar › Yedekler (`yedek.al`) |
| 8.5.10 | Yedekten yükle ⚠ AYAR | Dosya seç, onay, G54 + ParamTanim + RafTanim değerlerini yazar (öncesinde yedek yok) | `Ayar-Geri-Yukle` | 5515, 4066–4083 | [x] Aynı yerler (seçim `Diyalog.ListeSec`) (`yedek.yukle`) |
| 8.5.11 | Yedek klasörü | Explorer'da açar | `Klasor-Ac` | 5516, 4086–4088 | [x] KLASÖR / AÇ (`klasor.ac yedekler`) |
| 8.5.12 | Disk sıfırı: üretici değerine dön ⚠ AYAR | Fark listesi + onay; yedek; `G10 L2 P1` üretici G54 (`$UreticiG54`), `G92.1`; isteğe bağlı sensörü üretici konumuna | `G54-Ureticiye-Don`, `G54-Uretici-Fark` | 5517, 4017–4044, 4007–4015, 4005 | [x] Kalibrasyon › ÜRETİCİYE DÖN; Disk sihirbazı ① (`kal.uretici`) |
| 8.5.13 | Üretici farkı etiketi, frez yuvaları ve sensör özeti | — | `$lblUretici`, `Raf-Metni` | 5518–5522, 3889–3896 | [x] Kalibrasyon kartlarında durum satırları (`UreticiFark`, `RafOzeti`) |

### 8.6 DİSK KALİBRASYONU sekmesi — kumpasla (4859–4925)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.6.1 | Şu anki G54 ve #4002 | — | `Kal-Degerleri-Goster` | 4861–4862, 4737–4741 | [x] Disk sihirbazı ① ve Kalibrasyon bilgi şeridi (`G54`, `Param[2]`) |
| 8.6.2 | 1 Üretici değerlerine dön ⚠ AYAR | = 8.5.12 | `G54-Ureticiye-Don` | 4865 | [x] ① ÜRETİCİ DEĞERLERİNE DÖN (`kal.uretici`) |
| 8.6.3 | 2 Test bloğu: disk kalınlığı, T1 çapı, Test no 1–4, "Yeni disk (test 1)" | Yerleşim açıklaması (saat konumları) | `Kal-Yerlesim-Yaz`, `Kal-Duzen`, `Kal-Saat` | 4868–4900, 4885–4895, 4581–4598, 4574–4579 | [x] ② Disk kalınlığı, T1 çapı, Test no 1–4, YENİ DİSK (TEST 1), yerleşim kartı (`KalT`, `KalD`, `kal.disk.test`, `DiskYerlesim`) |
| 8.6.4 | Test programını hazırla ⚠ HAREKET (program) | Onay, frez modu sorusu (+#4030 yazma), `PM_kalibrasyon_testi_k.nc` üretir ve seçer (T1, cepler, pencere, A±20, `T0 M6`, G30, M30) | `Kal-Test-Hazirla`, `Kal-NC-Uret`, `Kal-Nokta` | 4883, 4743–4775, 4609–4718, 4600–4607 | [x] ② TEST PROGRAMINI HAZIRLA (`kal.disk.hazirla`) |
| 8.6.5 | 3 Ölçümler (9 kutu) | w, d1, d2, dR, dL, dF, dK, dAp, dAm | `$KalOlcumTanim` | 4903–4910, 4724–4734 | [x] ③ 9 kutu (tuş takımı) (`kal.disk.olcum`) |
| 8.6.6 | A/B/Y yönü ters | Tercihe kaydedilir | — | 4911–4916 | [x] ③ üç anahtar (`ayar.kaydet KalSA/KalSB/KalSY=`) |
| 8.6.7 | 4 HESAPLA | Eğim, dX, dY, h (Z), dA, dB, disk ortası kaçıklığı; ✓ ve büyük düzeltme uyarısı | `Kal-Hesapla` | 4918, 4777–4822 | [x] ④ HESAPLA + sonuç tablosu (✓/⚠) + uyarılar (`kal.disk.hesapla`, `DiskSonuc`, `DiskUyarilar`) |
| 8.6.8 | 5 UYGULA VE KAYDET ⚠ AYAR | Onay, yedek, (varsa) `G92.1`, `G10 L2 P1 X Y A B`, `#4002`; `kalibrasyon_gecmisi.csv` | `Kal-Uygula` | 4919–4920, 4824–4857 | [x] ⑤ eski/yeni tablo + UYGULA VE KAYDET (`kal.disk.uygula`) |
| 8.6.9 | Geçmiş | notepad ile CSV | — | 4921 | [x] ⑤ GEÇMİŞ; Ayarlar › Yedekler (`kal.disk.gecmis`) |
| 8.6.10 | Frez boyunu ölç ⚠ | `Takim-Olc` | — | 4924 | [x] ⑤ FREZ BOYUNU ÖLÇ (`takim.olc`) |

### 8.7 OTO KALİBRASYON sekmesi — iletken temas, titanyum disk (5408–5457)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.7.1 | Şu anki G54/#4002, bitmiş ölçüm bildirimi | `#4199` kimlik + `#4100 = 1` ise "SONUÇLARI OKU" | `OtoKal-Goster` | 5410–5411, 5230–5238 | [x] Kalibrasyon menüsü (yeşil şerit + rozet), ④ durum yazısı (`OtoOlcumBitti`) |
| 8.7.2 | Kurulum bilgisi, disk kalınlığı, temas ucu (düz pim / küresel frez) ve çapı | Tercihe kaydedilir | — | 5413–5433 | [x] ① kontrol listesi, kutular, 10/12/18/20, Düz pim / Küresel frez (`ayar.kaydet OkT/OkUc/OkUcD=`) |
| 8.7.3 | Prob testini başlat / durdur | Hareketsiz; giriş öğrenme ve TEMAS VAR/YOK | `OtoKal-Prob-Testi`, `$tmrProb` | 5436, 5264–5270, 5242–5262 | [x] ② PROB TESTİNİ BAŞLAT/DURDUR + büyük TEMAS VAR/YOK göstergesi (zorunlu adım) (`kal.prob.basla/durdur`, `ProbTemas`) |
| 8.7.4 | Girişi yeniden öğren | `ProbIo/ProbAktif` silinir | — | 5437 | [x] ② GİRİŞİ YENİDEN ÖĞREN (`kal.prob.ogren`) |
| 8.7.5 | Ölçüm programını hazırla ⚠ HAREKET (program) | Kontroller (uç çapı 0.5–6, disk 8–30, prob şu an temas göstermemeli), onay, manuelde makro kontrolü; `PM_kalibrasyon_otomatik.nc` (18 nokta × 2 ölçüm, merkez 5 tekrar, G38.2, `T1 M6`, `GOSUB user_1`, A±15°, B±15°, B180, `#4100–#4145`, `#4199`) + simülasyon kopyası `PM_kalibrasyon_otomatik_SIM.nc` | `OtoKal-Hazirla`, `OtoKal-NC-Uret`, `OtoKal-Sim-Uret`, `OtoKal-Prob-Aktif-Mi` | 5444, 5278–5317, 4963–5066, 5189–5228, 5272–5276 | [x] ③ ÖLÇÜM PROGRAMINI HAZIRLA, ÜRETİM EKRANINA GİT (`kal.oto.hazirla`) |
| 8.7.6 | 4 SONUÇLARI OKU | Kimlik ve bitiş kontrolü; 36 ölçüm + 5 tekrar okunur; G54+G92 ofsetleri; Gauss-Newton 10 bilinmeyenli model; kalite (tekrar, çift ölçüm farkı, RMS, artık, açı ölçeği, disk kaçıklığı/kama/eğiklik) uyarıları | `OtoKal-Oku`, `OtoKal-Hesapla-Ic`, `OkModel`, `OkRot`, `OkCoz`, `$OkNoktalar` | 5451, 5319–5370, 5125–5187, 5076–5099, 5068–5074, 5101–5123, 4939–4959 | [x] ④ SONUÇLARI OKU, sonuç + kalite tabloları, uyarılar (büyükse kırmızı) (`kal.oto.oku`, `OtoSonuc`, `OtoKalite`, `OtoUyarilar`, `OtoBuyuk`) |
| 8.7.7 | 5 UYGULA VE KAYDET ⚠ AYAR | Onay (+büyükse ikinci onay), yedek, `G92.1`, `G10 L2 P1 X Y A B`, `#4002`, `#4100 = 0`; `oto_kalibrasyon_gecmisi.csv` | `OtoKal-Uygula` | 5452–5453, 5372–5405 | [x] ⑤ (`kal.oto.uygula`) |
| 8.7.8 | Geçmiş / Frez boyunu ölç | — | — | 5456, 5448 | [x] ⑤ GEÇMİŞ, FREZ BOYUNU ÖLÇ; ③ FREZ BOYUNU ÖLÇ (`kal.oto.gecmis`, `takim.olc`) |

### 8.8 PANEL sekmesi (5528–5598)

| # | Öğe | Açıklama | Tercih anahtarı | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 8.8.1 | Makine adı | Uzaktan portalda görünen ad | `MakineAdi` | 5530–5533 | [x] Ayarlar › Genel › Makine adı (klavye) (`ayar.kaydet MakineAdi=`) |
| 8.8.2 | Dokunmatik ekran klavyesi | Aç/kapa | `SanalKlavye` | 5534 | [x] Ayarlar › Genel (`ayar.kaydet SanalKlavye=`) |
| 8.8.3 | Açılışta otomatik hazırlık (reset + home) | — | `OtomatikHazirlik` | 5535 | [x] Ayarlar › İş akışı (`ayar.kaydet OtomatikHazirlik=`) |
| 8.8.4 | Home öncesi geri sayım (sn) | 0–60 | `GeriSayim` | 5536–5539 | [x] Ayarlar › İş akışı (0–60) (`ayar.kaydet GeriSayim=`) |
| 8.8.5 | Açılışta Eding'i sıfırla (Sade'de gizli) | — | `EdingSifirla` | 5542–5543 | [x] Ayarlar › Eding (`ayar.kaydet EdingSifirla=`) |
| 8.8.6 | Blok ismi tarafı (saat 3 / saat 9) (Sade) | — | `SadeTaraf` | 5544–5546 | [x] Ayarlar › İş akışı (Saat 3 / Saat 9) (`ayar.kaydet SadeTaraf=`) |
| 8.8.7 | Frez değişimi MANUEL | bkz. 6.1 | `FrezModu` | 5547–5556 | [x] Ayarlar › İş akışı (`ayar.kaydet FrezModu=`) |
| 8.8.8 | Dans eden hayvan göster | — | `Dansci` | 5559 | [x] Ayarlar › Genel › İlerleme parıltısı (yerine) (`ayar.kaydet Dansci=`) |
| 8.8.9 | Koordinatları makine koordinatı olarak göster | — | `Koordinat` | 5560 | [x] Ayarlar › Genel; Üretim İŞ/MAKİNE (`ayar.kaydet Koordinat=`) |
| 8.8.10 | Tam ekran (yeniden açılınca) | — | `TamEkran` | 5562 | [x] Ayarlar › Genel (`ayar.kaydet TamEkran=`) |
| 8.8.11 | Windows açılınca başlasın | `Windows-Baslangic-Ayarla` | `WinBaslangic` | 5563 | [x] Ayarlar › Genel (`ayar.kaydet WinBaslangic=`) |
| 8.8.12 | Klasörler: İşler / Loglar / Yedekler / Eding klasörü | Explorer | — | 5565–5569 | [x] Ayarlar › Eding › İŞLER/LOGLAR/YEDEKLER, Eding KLASÖRÜ AÇ; Kayıtlar › Klasörler (`klasor.ac`) |
| 8.8.13 | Eding penceresini göster | Gizli pencereleri gösterir, panel TopMost kapanır (bulamazsa `AppActivate('CNC V4')`) | `Eding-Goster` | 5572, 4089–4099 | [x] Ayarlar › Eding › GÖSTER (`eding.goster`) |
| 8.8.14 | Eding'i gizle | — | `Eding-Gizle` | 5573, 4100–4106 | [x] GİZLE (`eding.gizle`) |
| 8.8.15 | Eding'i yeniden başlat | Çalışıyorsa yasak; onay; bağlantı kes, nazik kapat, KillCNC, başlat, otomatik hazırlık yeniden | `Eding-Yeniden` | 5574, 4107–4121 | [x] YENİDEN BAŞLAT (`eding.yeniden`) |
| 8.8.16 | Eding arka planda çalışsın | — | `EdingGizli` | 5575 | [x] Ayarlar › Eding (`ayar.kaydet EdingGizli=`) |
| 8.8.17 | Bilgi | Eding/iş/panel klasörü, log yolu | — | 5578–5582 | [x] Kayıtlar › Teknik bilgi; Ayarlar › Eding klasörü (`Teknik`, `Klasorler`) |
| 8.8.18 | Uzaktan erişim: adres + PIN gösterimi | — | `Uzak-Etiket-Guncelle` | 5583–5585, 2745–2749 | [x] Uzaktan ekranı; Ayarlar › Uzaktan erişim özeti (`UzakAdres`, `UzakPin`) |
| 8.8.19 | Uzaktan erişim açık (yeniden açılınca) | — | `Uzak` | 5586 | [x] Ayarlar › Uzaktan erişim; Uzaktan › anahtar (`ayar.kaydet Uzak=`, `uzak.ac`) |
| 8.8.20 | Uzaktan başlatma için "Blok takıldı" onayı iste | — | `UzakKilit` | 5587 | [x] Ayarlar › Uzaktan erişim (`ayar.kaydet UzakKilit=`) |
| 8.8.21 | PIN + PIN kaydet | 4–8 rakam ya da boş (PIN'siz) | `WebPin` | 5588–5597 | [x] Uzaktan › PIN DEĞİŞTİR (rakam klavyesi, boş = PIN'siz) (`uzak.pin`) |

## 9. Detaylar penceresi (5606–5658)

| # | Öğe | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 9.1 | Teknik satır | Eding durumu, home, takım, acil stop, ayarlı frezeler, kayıt klasörü, satır/geçen/kalan | ana zamanlayıcı | 5617–5621, 5844–5846 | [x] Kayıtlar › Teknik bilgi tablosu (`Teknik`) |
| 9.2 | Mesaj kutusu (log) | `Yaz` ile eklenen tüm mesajlar (zaman damgalı) | `Yaz` | 5623–5632, 1929–1934 | [x] Kayıtlar › Mesaj geçmişi (renkli, filtreli, kaydırmalı); alt şerit son mesaj (`Kayitlar`, `SonMesaj`) |
| 9.3 | MDI ⚠ HAREKET | Serbest G-kod/makro satırı (Enter ya da Gönder); bağlı ve çalışmıyorken | `Mdi-Gonder` | 5634–5658, 3335–3344 | [x] Kayıtlar › MDI (Enter/GÖNDER, ⌨) (`mdi.gonder`) |

## 10. Büyük simülasyon penceresi (3578–3591)

| # | Öğe | Açıklama | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|
| 10.1 | 1100×680 simülasyon | Ana ekrandaki simülasyonun büyüğü, canlı satır; kapatınca gizlenir; Esc = acil stop | 3578–3591, 5720 | [x] Üretim › BÜYÜT → tam içerik alanı (`SimHostBuyuk`), KÜÇÜLT; Esc = ACİL STOP (`sim.buyuk`) |

## 11. Diyalog / sihirbaz listesi

| # | Diyalog | Kullanım | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 11.1 | Ortak mesaj kutusu | Koyu, TopMost, büyük EVET/HAYIR/TAMAM/VAZGEÇ; metin ve cevap loglanır | `[Kayit]::Show`, `Onay` | 96–131, 2023–2025 | [x] `Diyalog.Onay/Bilgi/Hata/TehlikeliOnay` (metin ve cevap loglaması denetleyicide) |
| 11.2 | Tek kopya sorusu | 1.2 | ana betik | 46–57 | [x] `Diyalog.Onay` |
| 11.3 | Eding exe seçimi | 1.20 | `Eding-Exe-Bul` | 1271–1277 | [x] `Diyalog.ListeSec` ya da OpenFileDialog (denetleyici) — Eding programı seçimi eskisi gibi Windows dosya seçici (OpenFileDialog), dokunmatik liste değil; ana zamanlayıcının dışında açılır (SK-01) |
| 11.4 | NC dosyası seçimi | 4.1 | `Btn-DosyaSec` | 2030–2033 | [x] `Diyalog.ListeSec` ("GÖZAT…" = -2 → OpenFileDialog) (`is.sec`) |
| 11.5 | Frez modu sorusu | 6.3 | `Frez-Modu-Sor` | 2081–2112 | [x] `Diyalog.Secim` |
| 11.6 | Manuel frez adım penceresi | 6.6 | `Manuel-Diyalog` | 2175–2225 | [x] `Diyalog.ManuelFrezAdimi` |
| 11.7 | Blok sorusu (ölü) | 5.6 | `Blok-Sor` | 2413–2479 | [ ] yerleştirilmedi: ölü kod (bkz. 5.6) |
| 11.8 | Yeni blok | 5.1 | `Yeni-Blok` | 2520–2598 | [x] `Diyalog.YeniBlok` (`blok.*`) |
| 11.9 | Yarım kalan iş | 4.13 | `Devam-Diyalog` | 2842–2872 | [x] `Diyalog.Devam` |
| 11.10 | Home geri sayımı (İptal / Şimdi başla) | 1.23 | `Geri-Sayim` | 3166–3202 | [x] `Diyalog.GeriSayim` (İPTAL / ŞİMDİ BAŞLA) |
| 11.11 | Yedek dosyası seçimi | 8.5.10 | `Ayar-Geri-Yukle` | 4068–4070 | [x] `Diyalog.ListeSec` (`yedek.yukle`) |
| 11.12 | Sihirbaz: frez alma kalibrasyonu | 8.3 | YUVA AYARI | 4493–4562 | [x] Takımlar › Yuva ayarı (`yuva.*`) |
| 11.13 | Sihirbaz: disk kalibrasyonu (5 adım) | 8.6 | DİSK KALİBRASYONU | 4859–4925 | [x] Kalibrasyon › Disk kalibrasyonu (5 adım göstergeli) (`kal.disk.*`) |
| 11.14 | Sihirbaz: otomatik kalibrasyon (5 adım) | 8.7 | OTO KALİBRASYON | 5408–5457 | [x] Kalibrasyon › Otomatik kalibrasyon (5 adım, prob testi zorunlu) (`kal.oto.*`, `kal.prob.*`) |
| 11.15 | Dokunmatik klavye | 1.8 | `DokunKlavye` | 1305–1400 | [x] `Diyalog.MetinGir` / `SayiGir` |

## 12. Uzaktan erişim (TcpListener + HTML)

### 12.1 Sunucu

| # | Özellik | Açıklama | Fonksiyon | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 12.1.1 | HTTP sunucusu | `TcpListener(IPAddress.Any, port)`; 8080, 8081–8084, 18080, 28080 sırayla denenir; arka plan iş parçacığı + ThreadPool; elle HTTP ayrıştırma; 30 sn zaman aşımı | `[WebSunucu]::Baslat`, `Kabul`, `Isle` | 1487–1500, 1514–1521, 1553–1651 | [x] Arka plan; Uzaktan › adres(ler) (`UzakAdres`, `UzakAdresler`) |
| 12.1.2 | Başlatma | Yalnız `Uzak=1` ve makine bilgisayarında; PIN, sayfa yolu, iş klasörü atanır; adresler loga ve PANEL sekmesine yazılır | `Uzak-Baslat`, `Adresler` | 2732–2744, 1504–1512 | [x] Arka plan; Uzaktan › AÇIK/KAPALI (`UzakAcik`, `uzak.ac`) |
| 12.1.3 | PIN kontrolü | `X-Pin` başlığı ya da `?pin=`; `Pin` boşsa kontrol yok; yanlışsa 401 | `Isle` | 1585–1587 | [x] Arka plan; PIN kartı (`UzakPin`, `uzak.pin`) — PIN artık zorunlu, 6–8 hane (UZ-03); boş PIN = PIN'siz değil |
| 12.1.4 | CORS | `Access-Control-Allow-Origin: *`, `Allow-Private-Network: true`, OPTIONS → 204 | `Gonder`, `Isle` | 1533–1541, 1577 | [ ] bilinçli kaldırıldı (UZ-04 güvenlik): CORS başlığı yok, Host denetimi var; sayfalar aynı kaynaktan çalışır |
| 12.1.5 | Durum JSON üretimi (~1 sn) | durum, durumMetin, calisiyor, durakli, acil, dosya, dosyaAd, takim, yuzde, sure, hazir (blok), kilit, bekleyenBlok, engel, hatalar, uyarilar, son 12 mesaj, kalinlik, derinlik, sonrakiNo, ad, mod | `Uzak-Durum` | 2696–2714 | [x] Arka plan (`Uzak-Durum`, JSON alanları aynı; değerler denetleyicinin durum değişkenlerinden) |
| 12.1.6 | Komut kuyruğu | Web iş parçacığı kuyruğa koyar, UI zamanlayıcısı çalıştırır, 45 sn cevap bekler | `[WebSunucu]::Al`, `$uzakZaman` | 1502, 1640–1647, 2715–2731 | [x] Arka plan; aynı izin tablosu; `Diyalog.AcikSayisi` |
| 12.1.7 | Kapanışta durdurma | `[WebSunucu]::Durdur()` | `Add_FormClosing` | 1501, 5898 | [x] Arka plan (`Kabuk.FormClosing`) |

### 12.2 HTTP uç noktaları

| Yöntem / yol | PIN | Ne yapar | Makineyi hareket ettirir / iş başlatır mı? | Satır |
|---|---|---|---|---|
| `OPTIONS *` | hayır | CORS ön kontrol 204 | hayır | 1577 |
| `GET /`, `/index.html`, `/portal` | hayır | `portal.html` | hayır | 1578–1583 |
| `GET /tek` | hayır | `uzak.html` | hayır | 1578–1583 |
| `GET /api/durum` | evet | Durum JSON (12.1.5) | hayır | 1589 |
| `GET /api/ekran` | evet | Birincil ekranın JPEG görüntüsü (en çok 1600 px, kalite 72, 150 ms önbellek) | hayır (ama ekrandaki her şeyi gösterir: PIN, ayarlar) | 1590–1594, 1443–1459 |
| `POST /api/tikla?x=&y=` | evet | Makinenin ekranında **gerçek fare tıklaması** (normalize 0–1) | **EVET, dolaylı ve sınırsız**: paneldeki her düğmeye (HOME, BAŞLAT, jog, T1 al, G54 Kaydet, MDI…) basılabilir | 1595–1601, 1460–1468 |
| `POST /api/tus?t=&k=` | evet | Makineye klavye girişi (Unicode metin; Enter, Backspace, Escape, Tab, Delete, oklar) | **EVET, dolaylı**: MDI kutusuna G-kod yazıp Enter ile çalıştırma; `Escape` makinede ACİL STOP tetikler | 1602–1605, 1469–1485 |
| `GET /api/dosyalar` | evet | `isler\*.nc` listesi (AKTIF_IS, PM_*, *_blok* hariç, en yeni 60) | hayır | 1606–1622 |
| `POST /api/yukle?ad=` | evet | Gövdeyi `isler\<ad>.nc` olarak kaydeder (≤200 MB, `.yukleniyor` geçici dosya, var olanın üzerine yazar) | hayır (iş sürerken de çalışır) | 1623–1639 |
| `POST /api/komut?ad=&arg=` | evet | Panel komutu (12.3) | komuta göre | 1640–1647 |

**Yeni arayüzdeki yeri (12.2):** [x] `OPTIONS`, `GET /`, `/tek`, `/api/durum`, `/api/ekran`, `/api/dosyalar`, `/api/yukle`, `/api/komut` arka planda aynen (Uzaktan ekranı: adres, PIN, son komut gönderen cihazlar `UzakCihazlar`). [ ] `POST /api/tikla`, `/api/tus` bilinçli kapatıldı (K4: 403; uzaktan fare/klavye ile her düğmeye basılabiliyordu). [~] "Son bağlanan cihazlar" yalnız komut gönderenleri listeler (izleme istekleri sayılmıyor).

### 12.3 `/api/komut` komutları (`Uzak-Komut`, 2641–2695)

| Komut | Ne yapar | Koruma | Hareket / iş? | Satır |
|---|---|---|---|---|
| `sec` | `isler\` içindeki dosyayı seçer, AKTIF_IS'e kopyalar, kontrol eder | Kazıma sürerken / duraklatılmışken yasak | hayır | 2644–2648, `Uzak-Is-Sec` 2631–2640 |
| `baslat` | Duraklatılmışsa **devam ettirir**; değilse `Btn-Baslat` ile işi başlatır | Acil kilit, bağlantı, EXTERR, home, çalışıyor, dosya, engel; `UzakKilit` açıksa "Blok takıldı" onayı (devam ettirmede bu kontrol yok) | **EVET — iş başlatır / devam ettirir** | 2649–2665 |
| `duraklat` | `CncPauseJob` | Çalışan iş yoksa hata | durdurur | 2666–2670 |
| `durdur` | `Btn-Durdur` (`CncAbortJob`) | Çalışan/duraklatılmış iş yoksa hata | işi keser | 2671–2676 |
| `blok` | `arg = isim|kalınlık|derinlik` → sıradaki işten önce isim kazıma | Kazıma sürerken yasak, sınır kontrolleri | sonraki BAŞLAT'ta kazıma ekler | 2677–2691 |
| `blokiptal` | Bekleyen blok ismini iptal | — | hayır | 2692 |

Not: Paketteki HTML sayfaları yalnız `sec` komutunu kullanır; `baslat/duraklat/durdur/blok/blokiptal` ve `/api/dosyalar` sunucuda var ama sayfalarda düğmesi yok (ekran tıklamasıyla aynı işler yapılabiliyor).

**Yeni arayüzdeki yeri (12.3):** [x] `sec`, `baslat`, `duraklat`, `durdur`, `blok`, `blokiptal` arka planda aynen; yerel düğmelerle aynı izin tablosundan geçer (`is.sec`, `is.baslat`, `is.duraklat`, `is.durdur`, `blok.*`), ek olarak panelde işlem / diyalog sürerken ve Takımlar / Kalibrasyon / Ayarlar ekranı açıkken başlat/seç/blok reddedilir. [ ] uzaktan izin düzeyi seçimi (`uzak.izin`) yok: pasif ve nedenli; uzaktan izleme + bu komutlar PIN ile.

### 12.4 HTML sayfaları

| # | Sayfa | Özellikler | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|
| 12.4.1 | `portal.html` | Çok cihazlı ızgara (cihazlar ve PIN'ler `localStorage pm_cihazlar`), her kartta canlı küçük ekran, durum noktası/metni, yüzde, ilerleme çubuğu, dosya adı; "+ Cihaz ekle" / ⚙ düzenle / Kaldır; "Aç / kontrol et" tam ekran: canlı ekran, tıklama ve klavye makineye; "⬆ Dosya yükle" (yükle + `sec`); durum 2 sn'de bir; PIN URL sorgusunda gönderilir | 1–209 (script 66–207) | [x] Değişmedi (arka plan); adres Uzaktan ekranında |
| 12.4.2 | `uzak.html` | Tek cihaz: PIN ekranı (`localStorage pm_pin`), canlı ekran (300 ms, tıklamadan sonra 80 ms), tıklama halkası, klavye yönlendirme, dosya yükle + seç, tam ekran düğmesi, bağlantı noktası; PIN `X-Pin` başlığında | 1–105 (script 42–103) | [x] Değişmedi; "/tek" yolu Uzaktan ekranında |
| 12.4.3 | Güvenlik duvarı kuralı | 0.4 | `YoneticiKurulum.bat` 18–20 | [x] Arka plan (YoneticiKurulum.bat) |

## 13. Kalıcı veriler ve dosyalar

### 13.1 `panel_ayarlar.ini` anahtarları (`Tercih-Oku/Yaz` 3645–3654)

`OtomatikHazirlik, GeriSayim, Dansci, Koordinat, ModSor, EdingSifirla, EdingGizli, BlokSor, SanalKlavye, TamEkran, WinBaslangic, Uzak, UzakKilit, WebPin, FrezModu, MakineAdi, AcilStop, KalT, KalD, KalTest, KalSA, KalSB, KalSY, BlokTakim, BlokCap, BlokYuk, BlokKonum, BlokCizgi, SadeKalinlik, SadeDerinlik, SadeTaraf, OkT, OkKimlik, OkUc, OkUcD, ProbIo, ProbAktif` — [ ]

### 13.2 Diğer dosyalar

| # | Dosya | İçerik | Yazan | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|---|
| 13.2.1 | `ayarlar.txt` | Eding exe yolu | `Eding-Baslat` | 1258, 1779 | [x] Arka plan |
| 13.2.2 | `devam.json` | Yarım iş kaydı | `Devam-Kaydet` | 2754, 2766–2777 | [x] Arka plan → `Diyalog.Devam` |
| 13.2.3 | `bloklar.csv` | Blok numaraları | `Blok-Kaydet` | 2402, 2502–2507 | [x] Arka plan → `BlokSonrakiIsim` |
| 13.2.4 | `kalibrasyon_gecmisi.csv` | Disk kalibrasyonu geçmişi | `Kal-Uygula` | 4722, 4839–4848 | [x] GEÇMİŞ düğmeleri (`kal.disk.gecmis`) |
| 13.2.5 | `oto_kalibrasyon_gecmisi.csv` | Oto kalibrasyon geçmişi + 18 Z | `OtoKal-Uygula` | 4960, 5385–5393 | [x] GEÇMİŞ düğmeleri (`kal.oto.gecmis`) |
| 13.2.6 | `yedekler\ayar_*.txt` | Değişken yedekleri | `Ayar-Yedekle` | 4052–4064 | [x] Yedekler kartı/sekmesi, TehlikeliOnay "Yedek alındı" satırı (`yedek.*`, `SonYedek`) |
| 13.2.7 | `loglar\Panel_*.log` | Log | `[Kayit]` | 1127 | [x] Kayıtlar, LOGLAR klasörü (`klasor.ac loglar`) |
| 13.2.8 | `isler\` | Seçilen işler, `AKTIF_IS.nc`, `PM_kalibrasyon_testi_k.nc`, `PM_kalibrasyon_otomatik(.SIM).nc`, `PM_blok_*.nc`, `*_blok*.nc`, `*_devam.nc`, uzaktan yüklenenler | çeşitli | 33–36 | [x] İŞLER klasörü, İŞ SEÇ (`klasor.ac isler`) |
| 13.2.9 | `<Eding>\macro_yedek_*.cnc` | Makro yaması öncesi yedek | `Macro-Yaz` | 2622–2628 | [x] Arka plan |
| 13.2.10 | `baslangic_yedek\`, `baslangic_yedek_kayit.txt` | Kaldırılan Eding başlangıç kayıtları | `Eding-Baslangic-Kaldir` | 5945–5974 | [x] Arka plan |

## 14. Klavye kısayolları ve giriş

| # | Kısayol | Etki | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|
| 14.1 | **Esc** (ana pencere, Ayarlar, Detaylar, Simülasyon) | ACİL STOP | 5866–5869 | [x] Kabuk: her ekranda Esc = ACİL STOP (`acilstop`) |
| 14.2 | **Esc** (manuel frez penceresi) | ACİL STOP | 2213–2214 | [x] Tüm diyaloglarda Esc = ACİL STOP (`Diyalog.AcilStop`) |
| 14.3 | **Enter** (MDI kutusu) | MDI satırını gönder | 5647 | [x] Kayıtlar › MDI kutusu (`mdi.gonder`) |
| 14.4 | Enter / Esc (diyaloglar) | AcceptButton (ilk/önerilen düğme) / CancelButton | 124–126, 2109, 2464, 3191 | [x] Enter: Onay'da VAZGEÇ, Bilgi/Hata'da TAMAM, SayiGir/MetinGir'de TAMAM, Tehlikeli/GeriSayim/Manuel'de etkisiz. Esc: ACİL STOP (eski "CancelButton" yerine; TASARIM §3 D) |
| 14.5 | Dokunmatik klavye | TextBox'a dokununca | 1317–1325 | [x] Değer kutuları, MDI |
| 14.6 | Uzaktan klavye | Tarayıcıdaki tuşlar makineye (Esc dahil) | uzak.html 75–80; portal.html 156–161 | [x] Arka plan (uzak.html/portal.html değişmedi) |
| 14.7 | Fare tıklaması koordinat satırına | İŞ ↔ MAKİNE | 3550–3552 | [x] Konum kartı eksen paneline dokunma = İŞ↔MAKİNE (`ayar.kaydet Koordinat=`) |
| 14.8 | Hız çipi bölgeleri | sol −10, orta %100, sağ +10 | 977–982 | [x] Ayrı [−] / yüzde (=%100) / [+] düğmeleri (`hiz.*`) |

## 15. Kapanış

| # | Özellik | Açıklama | Satır | Yeni arayüzdeki yeri |
|---|---|---|---|---|
| 15.1 | Panel kapanırken | Gizleme ve uzak zamanlayıcıları durdurur, web sunucusunu kapatır, **Eding pencerelerini görünür yapar**, ana ve koordinat zamanlayıcılarını durdurur, hataları ve "PANEL KAPATILDI" loglar | 5896–5906 | [x] Arka plan (`Kabuk.FormClosing`) |
| 15.2 | Kapat onayı (tam ekran ✕) | Makine çalışıyorsa uyarılı | 6014–6019 | [x] Ayarlar › Genel › KAPAT → denetleyici onayı (çalışırken uyarılı) (`panel.kapat`) |
| 15.3 | Eding'i ayar kaydederek kapatma | `EdingKapat.bat/.ps1` (0.3); panel içinde `Eding-Kapat-Nazik` (WM_CLOSE, `[Pencere]::Kapat`) | 1739–1744, 1677–1686 | [x] Ayarlar › Eding › KAPAT; EdingKapat.bat (`eding.kapat`) |

## 16. Panelin Eding değişken kullanımı (özet)

| Değişken | Anlam | Panel okur | Panel yazar |
|---|---|---|---|
| #4000–#4006 | Takım değiştirici parametreleri | `Ayar-Oku`, `Yuva-*`, `Asinma-Kontrol` | `Ayar-Kaydet` 3869, `Z-Alma-Yap` 4001, `Yuva-Kaydet`, `Raf-Kontrol` (#4000), `Ayar-Geri-Yukle` |
| #4002 | Z sıfırı / sensör yüksekliği | kalibrasyonlar | `Kal-Uygula` 4837, `OtoKal-Uygula` 5383 |
| #4010–#4018 | Yuva X, T1–T6 Y, A, B | `Yuvaya-Git`, `Raf-Metni`, `Yuva-Kayitli` | `Konumu-Yuva-Yap`, `Yuva-Kaydet`, `Yuva-Varsayilan`, `Raf-Kontrol` |
| #4020–#4021 | Sensör X/Y | çeşitli | `Konumu-Sensor-Yap`, `Yuva-Kaydet`, `G54-Ureticiye-Don`, `Raf-Kontrol` |
| #4030 | Frez modu | `Frez-Manuel-Mi` | `Frez-Modu-Yaz` 2067 |
| #4031–#4033 | Manuel değişim noktası | `Manuel-Istek-Tahmin`, `Yuva-Kayitli` | `Yuva-Kaydet`, `Raf-Kontrol` |
| #4034, #4036, #4037 | Manuel istek, eski takım, sayaç | `Manuel-Istek`, `Manuel-Izle` | `#4034=0` 3059, 3239 |
| #4038 | Makro sürümü | `Manuel-Macro-Kontrol` (≥2) | `#4038=0` 2130 |
| #4039 / #4900 | "Pens elle açıldı / hareketsiz M6" bayrağı | — | `Devam-Baslat` 2882–2886 |
| #4099 | m100 boy farkı | `Ilerleme-Guncelle` 5765 | — |
| #4100, #4101–#4136, #4141–#4145, #4199 | Oto kalibrasyon bitti, ölçümler, tekrar, kimlik | `OtoKal-Oku`, `OtoKal-Goster` | NC programı; `#4100=0` 5384 |
| #5221–#5225 | G54 | çeşitli | `G10 L2 P1` 3868, 4029, 4080, 4836, 5382 |
| #5211–#5215 | G92 | `Ayar-Oku`, `OtoKal-Oku` | `G92.1` 4030, 4049, 4835, 5381 |
| #5161–#5165, #5181–#5185 | G28/G30 konumları (yedek için) | `Ayar-Yedekle` | — |
| #5163 | Z en üst (G28 Z) | hareket satırları | — |
| #5008, #5011 | Eding mevcut / yeni takım | `Manuel-*` | — |
| #5063, #5067 | Prob sonucu, temas | `Asinma-Kontrol`; NC | — |

---

## 17. macro.cnc alt program eşlemesi

Kaynak: `Eding/macro.cnc` (856 satır). **Sayım: 47 alt program** (CLAUDE.md "46" diyor; fark `pm_home_guvenli`). Orijinal makroda (`macro_X5_orijinal.cnc`) 42 alt program var; PrimerMill ekleri: `sensor_check`, `pm_surum`, `pm_pens_t0`, `manual_change`, `pm_home_guvenli`.

Çağrı türleri: **D** = panel doğrudan `CncRunSingleLine` ile çağırır; **N** = panelin ürettiği NC programı içinde; **M** = panelin gönderdiği M-kodu Eding'de bu alt programı çağırır (M6 → `change_tool`, M100 → `m100`); **İ** = yalnız macro içinden başka alt programdan; **CAM** = yalnız CAM (HyperDENT) çıktısında; **—** = hiçbir yerden çağrılmıyor.

| Alt program | Satır | Amaç (tek satır) | Okur (#) | Yazar (#) | Panelden çağrı (fonksiyon:satır) | Tür / durum |
|---|---|---|---|---|---|---|
| `user_1` | 9–38 | Sensörde takım boyu ölçümü, `G92 Z[#4002]` | 4002, 4003, 4004, 4020, 4021, 5063, 5067, 5163, 5224, 5380, 5397, 5399 | (G92 Z) | D: `Takim-Olc`:3757 · N: `OtoKal-NC-Uret`:5011 · İ: `change_tool`:299 | D, N, İ |
| `user_2` | 41–43 | Boş (msg) | — | — | — | **çağrılmıyor** |
| `user_3` | 45–52 | `dlgmsg` ile #4000–#4006 düzenleme (Eding diyaloğu) | 4000–4006, 5398 | (dlgmsg ile 4000–4006) | — | **çağrılmıyor** (Eding gizliyken diyalog görünmez) |
| `user_4` | 54–57 | Pens aç `M54 P2` | — | — | — | **çağrılmıyor** |
| `user_5` | 59–62 | Pens kapat `M55 P2` | — | — | — | **çağrılmıyor** |
| `user_6` | 64–87 | Ctrl-G ile kenar alma, G92 sıfırlama, `G10 L20 P1` ile merkez | 30–33, 5071, 5072 | 30–33, 5211–5216 (+G54 L20) | — | **çağrılmıyor** (G54 değiştirir) |
| `user_7` … `user_12` | 89–111 | Boş (msg) | — | — | — | **çağrılmıyor** (6 alt program) |
| `home_x` | 114–116 | X home | — | — | İ: `home_all`:140 | İ |
| `home_y` | 118–120 | Y home | — | — | İ: `home_all`:141 | İ |
| `home_z` | 122–124 | Z home | — | — | İ: `home_all`:139 | İ |
| `home_a` | 126–128 | A home | — | — | İ: `home_all`:142 | İ |
| `home_b` | 130–132 | B home | — | — | İ: `home_all`:143, 153 | İ |
| `home_c` | 134–136 | C home (makinede C yok) | — | — | — | **çağrılmıyor** |
| `home_all` | 138–158 | Z,X,Y,A,B home, geri çekilme, M81/M80, B tekrar home, G30, G64 | — | — | D: `Btn-Home`:3123 · İ: `pm_home_guvenli`:855 | D |
| `check_pressure` | 160–171 | Hava basıncı gelene kadar bekle (`M56 P1`, #5399) | 5399 | — | İ: `manual_change`, `DropTool*`, `PickTool1–6` | İ |
| `change_tool` | 173–327 | M6 takım değişimi: `#4039`=1 ise hareketsiz T ataması; manuelde `manual_change`; otomatikte Drop/Pick; sonra `user_1` ölçümü; manuelde son onay `M0` (#4034=4000+T) | 4010, 4011, 4020, 4021, 4030, 4037, 4039, 5008, 5011, 5015, 5019, 5151, 5163, 5224, 5225 | 4034, 4037, 4039, 5015, 5019 | M: `M6 Tn` — `Takim-Degistir`:3750, `Btn-FrezBirak`:3105, `Bos-Ismili-Hazirla`:2950, `Devam-Baslat`:2885 (bayraklı) · N: `T$takim M6` `Blok-Kazima-NC`:2334, `T0 M6` `Yeni-Blok`:2587, `T$frez M6` `Devam-NC-Uret`:2821, `T1/T0 M6` `Kal-NC-Uret`:4624/4713, `OtoKal-NC-Uret`:5008/5061 · İ: `pm_pens_t0`:344 · Yama hedefi: `Macro-Pens-Yamasi`:2609 | M, N |
| `sensor_check` | 329–333 | #4020/#4021 boşsa hata | 4020, 4021 | — | İ: `user_1`:11, `is_empty_tool`:399, `m100`:778 | İ |
| `pm_surum` | 336–338 | Makro sürümü `#4038 = 3` | — | 4038 | D: `Manuel-Macro-Kontrol`:2132 (+ varlık kontrolü 2122) | D |
| `pm_pens_t0` | 341–347 | Pens aç, `#4039=1`, `M6 T0` (hareketsiz T0), `#4039=0` | — | 4039 | D: `Pens-Ac-T0`:3806 (varlık kontrolü 3799) · varlık kontrolü `Macro-Pens-Yamasi`:2607 | D |
| `manual_change` | 354–396 | Manuel frez değişimi: değişim noktasına git, `#4034` istekleri + `M0`, pens aç/hava/kapat | 4031, 4032, 4033, 4037, 5008, 5011, 5163, 5224, 5225, 5380, 5397 | 4034, 4036, 4037, 5015 | İ: `change_tool`:210 · panel yalnız varlığını denetler (`Manuel-Macro-Kontrol`:2122, `OzelMakro` 3668) | İ |
| `is_empty_tool` | 398–419 | Sensörde iş mili boş mu (temas varsa hata) | 4003, 4004, 4020, 4021, 5067, 5163 | — | D: `Bos-Mu`:3773 · İ: `DropTool0–6` | D, İ |
| `DropTool0` | 422–434 | T0 "bırak": boşluk kontrolü, basınç, **pensi açar** (`M54 P2`) | 5163, 5380, 5397 | — | İ: `change_tool`:229 | İ |
| `DropTool1` … `DropTool6` | 436–620 | Tn'yi yuvasına bırak (#4010, #401n, #4017, #4018, Z=#4000+1), #4006 ise boşluk kontrolü | 4000, 4006, 4010, 4011–4016, 4017, 4018, 5163, 5224, 5225, 5380, 5397 | — | İ: `change_tool`:233–253 | İ (6 alt program) |
| `PickTool0` | 623–631 | T0 "al": pens kapat, sensör XY'ye git | 4020, 4021, 5163 | 5015 | İ: `change_tool`:258 | İ |
| `PickTool1` … `PickTool6` | 633–775 | Tn'yi yuvadan al (#4001 yaklaş, #4000'e F800 in, pens kapat), sensör XY'ye dön | 4000, 4001, 4010, 4011–4016, 4017, 4018, 4020, 4021, 5163, 5224, 5225, 5380, 5397 | 5015 | İ: `change_tool`:262–282 · panel geometri için metnini okur: `Yuva-Geometrisi-Oku`:3621 | İ (6 alt program) |
| `m100` | 777–819 | M100: takım boyu/aşınma kontrolü, `#4099` > #4005 ise hata | 4002, 4003, 4004, 4005, 4020, 4021, 4099, 5008, 5063, 5067, 5163, 5380, 5397, 5399 | 4099 | D: `Asinma-Kontrol`:3763 (`M100`) · sonucu okur `Ilerleme-Guncelle`:5765 · CAM (ZY2_45) | D, CAM |
| `m101` | 821–823 | M101: yalnız msg | — | — | CAM (ZY2_45); panel yalnız NC analizinde tanır (1089) | **panel çağırmıyor** (CAM) |
| `ClearPos` | 825–833 | Blok değiştirme konumu: Z üst, `X[#5161]`, A0 ya da A−25 (G54) | 5004, 5161, 5163 | — | D: HAREKET › Blok değiştirme 4260 | D |
| `z_safe` | 835–837 | `G53 G0 Z[#5163]` | 5163 | — | N: `Blok-Kazima-NC`:2331/2336/2397, `Devam-NC-Uret`:2819/2824, `Kal-NC-Uret`:4679…4708, `OtoKal-NC-Uret`:5015…5054 · `Devam-NC-Uret` arar: 2783 · CAM | N, CAM |
| `azxy_safe` | 839–842 | Z üst + A=G54A, sensör XY'ye | 4020, 4021, 5163, 5224 | — | D: HAREKET › Takım alanı 4259 · N: `Blok-Kazima-NC`:2332/2338, `Devam-NC-Uret`:2819/2824, `Kal-NC-Uret`:4703/4710, `OtoKal-NC-Uret`:5040…5056 · CAM | D, N, CAM |
| `check_empty_tool` | 844–848 | İş milinde takım varsa hata (#5008≠0) | 5008 | — | N: `Yeni-Blok`:2585, `Kal-NC-Uret`:4621, `OtoKal-NC-Uret`:5003; `Blok-Birlesik-Uret` ekler/kaldırır 2491–2494 · CAM | N, CAM |
| `pm_home_guvenli` | 851–856 | Güvenli home: Z üst, `X[#4901] Y[#4902]`, kol düz, `home_all` | 4901, 4902, 5163, 5224, 5225 | — | — (panel `home_all` çağırıyor; #4901/#4902'yi hiçbir yer yazmıyor) | **çağrılmıyor** |

### 17.1 Özet

- **Toplam alt program: 47.**
- Panelin **doğrudan, ürettiği NC ile ya da M-kodu ile** ulaştığı: `user_1`, `home_all`, `change_tool` (M6), `pm_surum`, `pm_pens_t0`, `is_empty_tool`, `m100` (M100), `ClearPos`, `z_safe`, `azxy_safe`, `check_empty_tool` — **11**.
- Yalnız macro içinden (dolaylı) çağrılan — **22**: `home_x`, `home_y`, `home_z`, `home_a`, `home_b`, `check_pressure`, `sensor_check`, `manual_change`, `DropTool0`–`DropTool6` (7), `PickTool0`–`PickTool6` (7). Panel bunları M6/M100/`home_all` üzerinden dolaylı çalıştırır.
- Yalnız CAM çıktısının çağırdığı — **1**: `m101` (panel yalnız NC analizinde tanır).
- **Hiçbir yerden çağrılmayan (ölü) — 13**: `user_2`, `user_3`, `user_4`, `user_5`, `user_6`, `user_7`, `user_8`, `user_9`, `user_10`, `user_11`, `user_12`, `home_c`, `pm_home_guvenli`.
- Sağlama: 11 + 22 + 1 + 13 = 47. Panelin hiçbir şekilde (dolaylı da) çağırmadığı = 14 (13 ölü + `m101`).
- **Panelin çağırdığı ama macro.cnc'de olmayan alt program: 0.** (`pm_surum`, `pm_pens_t0`, `home_all`, `user_1`, `is_empty_tool`, `azxy_safe`, `ClearPos`, `Z_SAFE`, `AZXY_SAFE`, `CHECK_EMPTY_TOOL`, `M100→m100`, `M6→change_tool` hepsi var.) Not: `Macro-Pens-Yamasi` (2601) orijinal makro için `#4900` kullanıyor, PrimerMill makrosu `#4039` kullanıyor; `Devam-Baslat` (2882) `OzelMakro`'ya göre seçiyor.
- macro.cnc'nin okuduğu ama panelin hiç yazmadığı değişkenler: `#4901`, `#4902` (yalnız `pm_home_guvenli`).
- Panelin metin olarak aradığı ama bugünkü makroda bulunmayan desenler: `Yuva-Geometrisi-Oku` (3611–3640) PickTool içinde `G53 … X… Y…` sabitleri ya da `#5221 - …`, `#5222 ± …` arıyor; makro artık `#4010–#4018` kullanıyor → her zaman varsayılan geometri.
- Eding gizli olduğu için Eding ekranındaki kullanıcı tuşlarına (user_1…user_12) ve tek eksen home düğmelerine operatör erişemiyor; yalnız panelin sunduğu çağrılar kullanılabilir.
