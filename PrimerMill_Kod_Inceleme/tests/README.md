# PrimerMill testleri

Bu klasördeki testler **Eding CNC ve makine olmadan** çalışır. Panel kodu (`PrimerMill/*.ps1`) çalıştırılmaz:
dosyalar ayrıştırıcıyla (AST) okunur, yalnız denenecek fonksiyonlar ve sabitler yüklenir. Eding'e bağlı kısımlar
için gerçek `cncapi.dll` yerine `lib/EdingSim.cs` (demo modunun sahte Eding sınıfı) kullanılır.

Testler Windows PowerShell 5.1 (32 ve 64 bit) ve PowerShell 7 (`pwsh`, Windows/Linux) ile çalışır.
Kodun kendisi PS 5.1 uyumludur.

## Hepsini çalıştırma

Proje klasöründe (`PrimerMill_Kod_Inceleme`):

```bat
powershell -ExecutionPolicy Bypass -File tests\Calistir.ps1
```

32 bit Windows PowerShell ile (panelin gerçekte çalıştığı ortam):

```bat
%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File tests\Calistir.ps1
```

PowerShell 7 ile:

```sh
pwsh -NoProfile -File tests/Calistir.ps1
```

`Calistir.ps1` her `*_Testi.ps1` dosyasını **ayrı bir süreçte** (kendisini çalıştıran PowerShell ile) açar,
sonunda bir özet tablo basar. Çıkış kodu yalnız hepsi geçerse 0'dır.

Seçenekler:

| Seçenek | Anlamı |
| --- | --- |
| `-Kaynak <klasör veya .ps1>` | Denenecek kod. Varsayılan `..\PrimerMill`. Yeniden düzenlenmiş teslim kopyası için `-Kaynak teslim\PrimerMill` (fonksiyonlar `lib\*.ps1` içinde olabilir; klasör alt klasörleriyle taranır). |
| `-Filtre <desen>` | Yalnız adı uyan testler, ör. `-Filtre GKod*` |
| `-Exe <yol>` | Alt süreç için başka bir PowerShell, ör. 32 bit `powershell.exe` |
| `-Sessiz` | Testlerin kendi çıktısını basma, yalnız özet tablo |

Tek bir test de doğrudan çalıştırılabilir, ör. `pwsh -NoProfile -File tests/GKod_Altin_Testi.ps1 -Kaynak teslim/PrimerMill`.

## Testler

| Dosya | Ne denetler |
| --- | --- |
| *(yerleşik)* Sözdizimi | `Calistir.ps1` önce kaynak ve test `.ps1` dosyalarını ayrıştırır: hata olmamalı, dosyalar BOM'lu UTF-8 olmalı. `pwsh` altında PowerShell 7'ye özgü sözdizimi (`??`, `?.`, `?:`, `&&`, `\|\|`, `??=`) de aranır. |
| `EdingSim_Testi.ps1` | `lib/EdingSim.cs`: gerçek `[Eding]` sınıfıyla (panelin `Add-Type` bloğu, bir isim alanında derlenip yansımayla) **aynı üyeler ve imzalar**; durum makinesi (POWERUP/READY/RUNNING/RUN-SUB/PAUSE/ABORTED/INT-ERR), cnc.ini değişkenleri, MDI (`#n = ifade`, G0/G1/G53/G90/G91, G10 L2, G38.2, M6 T, M3/M5, M54/M55, G4, gosub), iş yükle/başlat/duraklat/devam/iptal, hız oranı, M0, acil stop ve reset; panelin `Eding-Durum`, `Mesgul`, `Hatali`, `Durakli-Mi` fonksiyonlarının simülasyonla doğru sonuç vermesi. |
| `GKod_Altin_Testi.ps1` | Tüm G-kod üreticileri (`Blok-Kazima-NC`, `Blok-Birlesik-Uret`, `Kal-NC-Uret`, `OtoKal-NC-Uret`, `OtoKal-Sim-Uret`, `Devam-NC-Uret`), toplam 24 girdi varyantı. Çıktı, **orijinal koddan** (git `35a684f`) üretilmiş `golden/` dosyalarıyla bayt bayt karşılaştırılır. |
| `Sayi_Kultur_Testi.ps1` | `Sayi`, `Metin-Sayi`, `Sure`, `Sade-Sure`, `Kal-Saat`, `Blok-Metin-Temizle`; InvariantCulture, tr-TR, zh-CN, de-DE altında: gidiş-dönüş, virgül/nokta girişi, negatif sıfır, yuvarlama, binlik ayırıcı. Ayrıca tüm G-kod varyantlarının her kültürde InvariantCulture ile **aynı** çıkması. |
| `Ayar_Testi.ps1` | `Tercih-Yaz`/`Tercih-Oku` (panel_ayarlar.ini), `ayarlar.txt` → `Eding-Exe-Bul`, `Degisken-Yaz`, `Ayar-Yedekle` (ayar_*.txt biçimi), `Ayar-Geri-Yukle`, `Ayar-Kaydet` (virgüllü giriş): geçici klasörde, Türkçe karakterli yollarla, dört kültürde. Eding yerine EdingSim; pencereler ve onaylar sahte. |
| `OtoKal_Hesap_Testi.ps1` | Otomatik kalibrasyon hesabı (`OtoKal-Hesapla-Ic`): sentetik ölçümle bilinen hataların geri bulunması. |
| `Kal_NC_Cep_Testi.ps1` | Disk kalibrasyon programındaki cep çapları (`Kal-NC-Uret`). |
| `Denetleyici_Testi.ps1` | PrimerMill 2 denetleyicisi (`teslim/PrimerMill/lib`): `lib/*.ps1` + EdingSim + sahte arayüz kapısı (`_Ortak.ps1` `Ui-Sahte-Yukle`). İzin tablosu (home yok, iş sürerken, duraklıyken, ACİL STOP, RafEksik), demo iş BAŞLAT → DURAKLAT → DEVAM → bitiş, `MakineDurumu` alanları, uzaktan BAŞLAT reddi (duraklı / diyalog açık / kalibrasyon ekranı), tehlikeli onay + yedek, `ui/ARAYUZ_API.md`'deki her komutun dağıtıcıda karşılığı. |
| `Kiosk_Testi.ps1` | Kiosk modu ve CİHAZI KAPAT (`lib/Kiosk.ps1`, `lib/Kiosk.cs`, `Kabuk.ps1`, `KIOSK_KUR.bat` / `KIOSK_KALDIR.bat`): PIN doğru / yanlış / baştaki sıfır / 5 yanlış → 60 sn kilit, PIN günlüğe yazılmaz, PIN değiştirme; `sistem.kapat` iş / duraklama / panel işlemi sürerken reddi, DEMO'da shutdown hiç çağrılmaz, gerçek modda sahte shutdown yürütücüsü (/s, /r, vazgeç, hata kodu → panel geri döner); Windows'a geç, panele dönüş, kiosk'ta PIN'li kapatma (çıkış kodu 11); `KioskKilit.Engelle` tuş tablosu (Esc tek başına serbest), `mcs -langversion:5`; .bat ilkelerinin tam tersinin alınması. |
| `Tasima_Testi.ps1` | Birebir taşıma kanıtı: eski paneldeki 185 fonksiyonun her biri teslimde mekanik dönüşümler dışında aynı mı; değişen / kaldırılan her biri `TASIMA_DEGISEN.txt` içinde gerekçeli olmalı (`-Fark` farkı satır satır basar). |
| `Demo_Ekran_Testi.ps1` | Yalnız Windows: paneli `-Demo` ile açar, 17 ekranı `Kabuk.EkranGoster` ile gezer, `teslim/ekran_goruntuleri_demo/*.png` kaydeder, kapanır. Windows dışında yalnız ayrıştırır ve atlar. |
| `ui/demo_ekran_testi.sh` | (bash, Mono) teslimdeki bütün C# dosyalarının `mcs -langversion:5` ile birlikte (demo ve makine takımı) ve tek tek derlendiği, `ui/` ve `lib/EdingSim.cs` kopyalarının kanonik dosyalarla aynı olduğu. |

## Altın (golden) çıktılar

- `golden/<Üretici>/<varyant>.nc`: orijinal kodun çıktısı. `golden/girdi/`: üreticilere verilen girdi dosyaları
  (`ZY2_45_kisa.nc` = `ornekler/ZY2_45_eding.nc`'nin kısaltılmışı ve arasına eklenmiş yapay bir `T2 M6`; `kucuk_is.nc`).
- Karşılaştırmada yalnız şu normalleştirmeler yapılır (`_Ortak.ps1` → `GKod-Normal`):
  1. satır sonları LF yapılır (Windows'ta CRLF, Linux'ta LF yazılır),
  2. harften sonra gelen negatif sıfır (`Y-0`, `X-0.000`) işaretsiz yazılır: .NET Core ile .NET Framework bunu farklı biçimler, Eding için aynı sayıdır,
  3. yalnız `(PrimerMill disk kalibrasyon testi …)`, `(PrimerMill OTOMATIK KALIBRASYON …)` ve
     `(SIMULASYON - PrimerMill OTOMATIK KALIBRASYON …)` başlık satırlarındaki tarih/saat `<TARIH>` olur.
- **Bilinçli farklar** `golden/BEKLENEN_FARKLAR.txt` dosyasına `Üretici/varyant` (ya da `Üretici/*`) olarak yazılır;
  bunlar farklıysa fark basılır ama "beklenen fark" sayılır. Her satırın gerekçesi `INCELEME_RAPORU.md`'de olmalı.
- Altınları yeniden üretmek yalnız orijinal kodla yapılmalı:
  ```sh
  git show 35a684f:PrimerMill_Kod_Inceleme/PrimerMill/KazimaBaslat.ps1 > /tmp/orijinal/KazimaBaslat.ps1
  pwsh -NoProfile -File tests/GKod_Altin_Testi.ps1 -AltinYaz -Kaynak /tmp/orijinal/KazimaBaslat.ps1
  ```

## Yeni test yazmak

```powershell
param([string]$Kaynak = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
[void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Sayi', 'Kal-NC-Uret' -Degiskenler 'KalGruplar' -Bagimliliklar)
Esit '1.500' (Sayi 1.5) 'Sayi 1.5'
Yakin 2.0 (Metin-Sayi '2,0') 1e-9 'virgül'
Dogru ($true) 'koşul'
Ozet 'Benim testim'     # çıkış kodu = başarısız sayısı
```

- `Kaynak-Fonksiyonlari` **nokta ile** çağrılmalı (`. Kaynak-Fonksiyonlari …`), yoksa fonksiyonlar global kapsamda tanımlanır.
- `-Bagimliliklar`: istenen fonksiyonların çağırdığı, kaynakta tanımlı diğer fonksiyonlar da yüklenir.
  Arayüze dokunan fonksiyonları (ör. `Baglan`, `Onay`, `Yaz`) yükledikten **sonra** sahte sürümleriyle yeniden tanımla.
- `Kulturde 'tr-TR' { … }` bir bloğu verilen kültürde çalıştırır; `Gecici-Klasor` geçici klasör açar.
- Dosyayı **BOM'lu UTF-8** kaydet ve PS 5.1 sözdizimi kullan.

## Bilinen sınırlar

- Testler gerçek Eding davranışını değil, `EdingSim.cs` modelini dener. Durum kodları, dönüş kodu metinleri ve süreler
  simülasyona özgüdür; makinede ilk deneme yine Eding simülasyon modunda yapılmalı.
- Arayüz (WinForms), uzaktan erişim sunucusu ve makine hareket sıraları (takım değişimi, home) bu testlerin dışında.
