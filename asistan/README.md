# 🤖 Kişisel Bilgisayar Asistanı

Ne istediğini yazıyorsun, asistan da **bilgisayarını bir insan gibi kullanarak** yapıyor:
ekrana bakıyor, fareyi oynatıp tıklıyor, klavyeyle yazıyor, uygulamaları açıyor,
web'de geziniyor, dosyalarla çalışıyor.

Arkada **DeepSeek** yapay zekası (`deepseek-flash`, resimleri görebilen model) çalışıyor: asistan ekran
görüntüsü alıyor, ne gördüğünü anlıyor, bir sonraki fare/klavye hareketine karar veriyor ve bunu iş bitene
kadar tekrarlıyor. İstersen Claude ile de çalıştırabilirsin (aşağıda "Ayarlar").

```
👤 Sen: Chrome'u aç, yarın İstanbul'da hava nasıl olacak bak
  📸 ekrana bakıyor
  ⌨️  tuşa basıyor super
  ⌨️  yazıyor 'chrome'
  ...
🤖 Yarın İstanbul'da parçalı bulutlu, en yüksek 22°C bekleniyor.
```

## Neler yapabilir?

- Uygulama açıp kullanmak (tarayıcı, Excel/Word, Spotify, ayarlar…)
- Web'de arama yapmak, form doldurmak, bilgi toplamak
- Dosya/klasör bulmak, düzenlemek, taşımak
- Komut satırında komut çalıştırmak (**her komut senin onayınla**)
- Sohbeti hatırlar: "şimdi bunu masaüstüne kaydet" gibi devam eden istekler verebilirsin

## Kurulum (tek tıkla)

Önce [platform.deepseek.com](https://platform.deepseek.com) adresinden bir hesap aç, biraz bakiye yükle ve
**API Keys** bölümünden bir anahtar oluştur. Kurulum sırasında bu anahtar sorulacak.
(Kullanım ücretlidir ama DeepSeek oldukça ucuzdur; her ekran görüntüsü token harcar.)

### Windows

1. [`kurulum.bat`](https://raw.githubusercontent.com/Taylantanriverdi/A-/main/asistan/kurulum.bat) bağlantısına sağ tıkla → **Bağlantıyı farklı kaydet**.
   (Ya da GitHub'da yeşil **Code → Download ZIP** ile tüm depoyu indir, `asistan` klasörüne gir.)
2. `kurulum.bat` dosyasına çift tıkla. Windows "bilinmeyen yayımcı" uyarısı verirse **Ek bilgi → Yine de çalıştır** de.
3. Kurulum şunları kendisi yapar:
   - Python yoksa kurar (winget ya da python.org üzerinden)
   - Asistan dosyalarını `%LOCALAPPDATA%\KisiselAsistan` klasörüne indirir
   - Gerekli kütüphaneleri kurar
   - API anahtarını sorar ve kaydeder
   - Masaüstüne ve Başlat menüsüne **Kisisel Asistan** kısayolu ekler

Ya da PowerShell'e şunu yapıştır:
```powershell
irm https://raw.githubusercontent.com/Taylantanriverdi/A-/main/asistan/kurulum.bat -OutFile $env:TEMP\kurulum.bat; & $env:TEMP\kurulum.bat
```

### macOS / Linux

Terminale yapıştır:
```bash
curl -fsSL https://raw.githubusercontent.com/Taylantanriverdi/A-/main/asistan/kurulum.sh | bash
```
Dosyalar `~/.kisisel-asistan` klasörüne kurulur. macOS'ta masaüstüne, Linux'ta uygulama menüsüne kısayol eklenir.

- **macOS:** *Sistem Ayarları → Gizlilik ve Güvenlik* altında Terminal'e **Erişilebilirlik** ve
  **Ekran Kaydı** izni ver, sonra Terminal'i yeniden başlat. Python yoksa ve Homebrew varsa otomatik kurulur.
- **Linux:** X11 oturumu gerekir (Wayland desteklenmez). Eksik paketler (`python3-tk`, `xclip` …) otomatik kurulur.

### 🔄 Otomatik güncelleme

Asistanı her açtığında (`baslat.bat` / `baslat.sh` / kısayol) en yeni sürüm GitHub'dan kontrol edilir,
değişen dosyalar indirilir, gerekirse yeni kütüphaneler kurulur. İnternet yoksa mevcut sürümle açılır.
Kapatmak için `ASISTAN_GUNCELLEME=0` ortam değişkenini ayarla.

### Kaldırma

- **Windows:** kurulum klasöründeki `kaldir.bat` (`%LOCALAPPDATA%\KisiselAsistan\kaldir.bat`)
- **macOS / Linux:** `~/.kisisel-asistan/kaldir.sh`

## Kullanım

Açılan pencerede ne istediğini Türkçe yaz. Başlatırken görev de verebilirsin:

```bash
./baslat.sh "masaüstündeki ekran görüntülerini Resimler klasörüne taşı"
```

| Komut | Ne yapar |
|---|---|
| `/yeni` | Yeni sohbet başlatır (asistan öncekini unutur, maliyeti de düşürür) |
| `/onay` | Her fare/klavye hareketinden önce onay sorulmasını açar/kapatır |
| `/cikis` | Çıkar |

Daha temkinli başlamak istersen: `./baslat.sh --onay` (her hareketten önce sorar).

## 🛑 Güvenlik ve kontrol

- **Acil durdurma:** Fareyi hızla ekranın **herhangi bir köşesine** götür → asistan anında durur.
  Terminalde **Ctrl+C** de görevi durdurur.
- Asistan; dosya silme, e-posta/mesaj gönderme, satın alma, ödeme, yazılım kurma gibi
  **geri alınamaz işlerden önce senden onay ister.**
- Şifre ve kart bilgisi yazmaz; bu alanları senin doldurmanı ister.
- Komut satırı komutları **her zaman** çalışmadan önce sana gösterilir ve onayın beklenir.
- Web sayfalarında veya e-postalarda gördüğü talimatlara uymaz, sadece senin isteklerini yapar.
- Asistan çalışırken fareyi/klavyeyi kullanma; ikiniz aynı anda kullanırsanız karışır.
- Ekran görüntüleri işlenmek üzere yapay zeka sağlayıcısına (DeepSeek veya Anthropic) gönderilir. Gizli bir şey açıkken görev verme.

> Not: Bu tür yapay zeka ajanları hâlâ hata yapabilir. Önemli işlerde (para, iş yazışmaları,
> önemli dosyalar) ne yaptığını izle; ilk denemeleri `--onay` modunda yapman iyi olur.

## Ayarlar (isteğe bağlı ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ASISTAN_SAGLAYICI` | otomatik | `deepseek` veya `claude`. Boşsa `DEEPSEEK_API_KEY` varsa DeepSeek, yoksa Claude kullanılır |
| `DEEPSEEK_MODEL` | `deepseek-flash` | DeepSeek modeli (resim görebilen bir model olmalı) |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API adresi |
| `ASISTAN_GORUNTU_SAYISI` | `3` | DeepSeek'e geçmişte gönderilen en fazla ekran görüntüsü (az = ucuz) |
| `ASISTAN_MAKS_ADIM` | `80` | Tek bir görevde en fazla kaç tur çalışacağı |
| `ASISTAN_MODEL` | `claude-opus-5-5` | Claude kullanılırken model |
| `ASISTAN_EFOR` | `high` | Claude kullanılırken düşünme düzeyi |
| `ASISTAN_YEDEK` | `1` | Claude bir isteği reddederse sunucunun başka bir modelle devam etmesi |

**DeepSeek ile Claude farkı:** Claude'un bilgisayar kullanmak için özel eğitilmiş bir aracı var, DeepSeek'te yok;
DeepSeek ekran görüntüsünün üzerine çizilen koordinat ızgarasıyla nereye tıklayacağını tahmin ediyor.
DeepSeek çok daha ucuz, ama karmaşık ekranlarda daha sık yanlış yere tıklayabilir.

## Dosyalar

- `asistan.py` — sohbet penceresi ve Claude motoru
- `deepseek_motor.py` — DeepSeek motoru
- `ortak.py` — ortak parçalar (talimatlar, komut onayı)
- `bilgisayar.py` — ekran görüntüsü, fare ve klavye kontrolü (koordinat ölçekleme, Türkçe karakter desteği)
- `guncelle.py` — otomatik güncelleyici
- `kurulum.bat` / `kurulum.sh` — tek tıkla kurulum
- `baslat.bat` / `baslat.sh` — güncelleyip başlatır
- `kaldir.bat` / `kaldir.sh` — kaldırma
