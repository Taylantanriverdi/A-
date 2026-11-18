# PrimerMill — kod inceleme ve iyileştirme

PrimerMill, Bloomden/DentMill X5 dental 5 eksen freze makinesinin operatör paneli. Eding CNC V4.03.54 (CPU5B kartı) üzerinde çalışır, Eding'in kendi ekranını gizler ve yerine Türkçe, sade bir panel koyar. Gerçek bir makineyi hareket ettirir: hatalı bir değişiklik çarpışmaya, kırık takıma veya bozuk kalibrasyona yol açar.

## Klasörler

| Yol | İçerik |
| --- | --- |
| `PrimerMill/KazimaBaslat.ps1` | Ana program (~6000 satır). WinForms arayüzü, Eding API bağlantısı, iş akışı, takım değişimi, kalibrasyon sihirbazları, otomatik kalibrasyon, uzaktan erişim web sunucusu |
| `PrimerMill/KazimaBaslat.bat` | Başlatıcı. Eding'in cncapi.dll'i 32 bit olduğu için **32 bit PowerShell 5.1** (SysWOW64) ile, `-STA` açar |
| `PrimerMill/EdingKapat.ps1/.bat` | Eding'i ayarları kaydederek kapatır |
| `PrimerMill/HataBul.ps1/.bat` | Panel açılmazsa hatayı gösterir |
| `PrimerMill/YoneticiKurulum.bat` | Açılış görevi (schtasks) ve güvenlik duvarı kuralı (TCP 8080–8084, 18080, 28080, yalnız yerel ağ) |
| `PrimerMill/portal.html`, `uzak.html` | Telefondan uzaktan izleme/kumanda sayfaları (PIN'li), `KazimaBaslat.ps1` içindeki TcpListener sunucusu yayınlar |
| `PrimerMill/eding_yolu.txt` | Eding klasörünü elle belirtme. Bu kopyada dizüstü yolu (`C:\CNC_X5`) yazılı; makinede yol `P:\CNC` |
| `Eding/macro.cnc` | PrimerMill'in Eding makrosu (46 alt program: home, takım al/bırak, manuel değişim, güvenli konumlar, kontroller). Eding makro dilinde |
| `Eding/macro_X5_orijinal.cnc` | Üreticinin orijinal makrosu. **Yalnız referans**, değiştirme |
| `Eding/cnc.ini` | Makinenin gerçek Eding ayarları (eksen sınırları, IO, `[VARIABLES]` içinde G54 = #5221–#5225, #4000–#4006). **Yalnız referans**, değiştirme |
| `ornekler/` | Otomatik kalibrasyon programı örnekleri ve CAM çıktısı örneği (ZY2_45) |
| `belgeler/` | Kurulum ve otomatik kalibrasyon kılavuzları |

`cncapi.dll` pakette yok (Eding'in kapalı kaynak dosyası). Kullanılan 28 fonksiyonun imzaları `KazimaBaslat.ps1` içindeki `Add-Type` bloğunda (`[Eding]` sınıfı) tanımlı.

## Mimari notlar

- Eding ile tüm konuşma `[Eding]` sınıfı üzerinden: `CncGetVariable` (~100 çağrı), `CncRunSingleLine` (MDI), iş yükle/başlat/duraklat/iptal, giriş/çıkış, acil stop.
- Kalıcı değişkenler: #4000–#4199 PrimerMill'in kendi değişkenleri (takım yuvaları, Z sıfırı #4002, kalibrasyon sonuçları #4100–#4145, makro sürümü #4038). #5221–#5225 G54.
- `macro.cnc` ile panel sürüm kontrolüyle eşleşir (`sub pm_surum` → `#4038 = 3`). Makroda değişiklik yaparsan sürüm numarasını ve paneldeki beklentiyi birlikte güncelle.
- Otomatik kalibrasyon (`OtoKal-*` fonksiyonları): G38.2 ile 18 nokta ölçer, 10 bilinmeyenli modele Gauss-Newton ile uydurur (`OtoKal-Hesapla-Ic` saf hesap, Eding'siz test edilebilir), yedek alıp G54 ve #4002'ye yazar.
- Makine bilgisayarı Çince Windows olabilir (cnc.ini'de `locale = 2052`). Sayılar her yerde `InvariantCulture` ile yazılmalı/okunmalı.

## Zorunlu kurallar

1. **Hedef: Windows PowerShell 5.1, 32 bit.** PowerShell 7 sözdizimi yasak: `??`, `?:` üçlü operatör, `&&`/`||` zincirleri, `-Parallel`, `ForEach-Object -Parallel`, `clean` bloğu, yeni .NET API'leri. Her değişikliği bu kurala göre kontrol et.
2. **Dosya kodlaması:** `.ps1` dosyaları **BOM'lu UTF-8** kalmalı (PS 5.1 Türkçe karakterleri ancak böyle doğru okur). `.bat` dosyaları ASCII; Türkçe karakter ekleme.
3. **Eding makro dili:** `macro.cnc` Eding 4.03 sözdizimine uymalı (`sub/endsub`, `gosub`, `if/else/endif`, `while/endwhile`, `#nr`, `msg`, `errmsg`, `warnmsg`, `dlgmsg`, `M54/M55 P`, `G38.2`, #5063/#5067). LinuxCNC veya Fanuc sözdizimi kullanma.
4. **Makine hareketine dokunan her değişiklik** (G-kod üretimi, koordinatlar, güvenli yükseklikler, takım değişimi sırası, G54/#4002 yazma, eksen sınırları) ayrı bir maddede, gerekçesiyle ve "MAKİNEDE DOĞRULA" etiketiyle raporlanmalı. Bu kısımlarda emin olmadığın hiçbir davranışı değiştirme; öner.
5. **Kullanıcıya görünen metinler Türkçe** kalacak.
6. **Özellik eşitliği:** Mevcut panelin yaptığı her iş yeni sürümde de yapılabilmeli. Önce mevcut özelliklerin tam envanterini çıkar (`OZELLIK_ENVANTERI.md`), teslimde her maddenin yeni arayüzde nerede olduğunu işaretle. Kullanıcı yeni bir arayüz istedi; arayüzün yeniden tasarlanması serbest, ama makine davranışı (kural 4) korunur.
7. **Yeni çalışma zamanı kurulumu yok:** Makine bilgisayarında internet olmayabilir. Windows'la birlikte gelen .NET Framework 4.x ve PowerShell 5.1 dışında bir şey kurulmasını gerektirme (WebView2, Electron, Python, yeni .NET sürümü yok). WinForms veya WPF (XAML) kullanılabilir.
8. `cnc.ini` ve `macro_X5_orijinal.cnc` dosyalarını değiştirme.

## İnceleme sırası

1. Önce `git init` yap ve dosyaları olduğu gibi ilk commit olarak kaydet. Her düzeltme ayrı, açıklamalı bir commit olsun.
2. **Sözdizimi ve PS 5.1 uyumu:** Ayrıştırıcıyla (`[System.Management.Automation.Language.Parser]::ParseFile`) tüm `.ps1` dosyalarını kontrol et. Mümkünse PSScriptAnalyzer çalıştır.
3. **Çökme ve hata yönetimi:** Eding bağlantısı koptuğunda, DLL bulunamadığında, dosya kilitliyken, Eding meşgulken paneller ne yapıyor? Yakalanmayan istisnalar, boş `catch` blokları, zamanlayıcıların (Timer) çakışması.
4. **Makine güvenliği:** Acil stop, duraklatma, iş sırasında yasaklanması gereken düğmeler, takım değişimi sırasında kullanıcı girişleri, G54/#4002 yazmadan önce yedek alınması, sayı ayrıştırma (virgül/nokta, Çince Windows).
5. **macro.cnc:** Alt programların panelin çağırdıklarıyla eşleşmesi, kullanılmayan/eksik alt programlar, değişken çakışmaları (#4000–#4199 ve #5xxx), hata mesajlarından sonra makinenin güvenli durumda kalması.
6. **Uzaktan erişim (TcpListener + HTML):** PIN kontrolü, yalnız yerel ağ, girdi doğrulama, uzaktan tehlikeli komutların (hareket, başlat) korunması.
7. **Otomatik kalibrasyon:** `OtoKal-Hesapla-Ic` için Eding'siz bir test betiği yaz: bilinen hatalarla sentetik ölçüm üret (`OkModel`), hesabın bu hataları geri bulduğunu doğrula.
8. **Okunurluk ve yapı:** Tekrarlanan kodu birleştir, ölü kodu kaldır. Yeni arayüz için mantığı (Eding bağlantısı, G-kod üretimi, hesaplar) arayüzden ayırmak serbest; ayırırken davranışın aynı kaldığını testlerle göster.

## Test

Bu bilgisayarda Eding ve makine yok. Bu yüzden:
- Tüm `.ps1` dosyaları ayrıştırıcıdan hatasız geçmeli.
- Eding'e bağlı olmayan saf fonksiyonlar (hesaplar, G-kod üreticileri, sayı biçimleme) için `tests/` klasörüne çalıştırılabilir test betikleri yaz. `pwsh` ile de çalışabilsinler, ama kodun kendisi PS 5.1 uyumlu kalsın.
- G-kod üreten fonksiyonların çıktısını değişiklikten önce ve sonra karşılaştır; fark varsa raporla.

## Teslim

1. Düzeltilmiş dosyalar (aynı klasör yapısı).
2. `INCELEME_RAPORU.md`: bulunan her sorun için önem derecesi (KRİTİK / YÜKSEK / ORTA / DÜŞÜK), dosya ve satır, ne yapıldığı; "MAKİNEDE DOĞRULA" listesi; uygulanmayan öneriler.
3. `tests/` klasörü ve nasıl çalıştırılacağı.
4. Makinede deneme sırası: önce Eding simülasyon modunda, sonra makinede düşük ilerleme hızıyla.
