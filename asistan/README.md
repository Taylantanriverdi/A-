# 🤖 Kişisel Bilgisayar Asistanı

Ne istediğini yazıyorsun, asistan da **bilgisayarını bir insan gibi kullanarak** yapıyor:
ekrana bakıyor, fareyi oynatıp tıklıyor, klavyeyle yazıyor, uygulamaları açıyor,
web'de geziniyor, dosyalarla çalışıyor.

Arkada Claude'un **computer use** özelliği çalışıyor: asistan ekran görüntüsü alıyor,
ne gördüğünü anlıyor, bir sonraki fare/klavye hareketine karar veriyor ve bunu iş bitene kadar tekrarlıyor.

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

## Kurulum

### 1. API anahtarı al
[console.anthropic.com](https://console.anthropic.com) adresinden bir hesap aç ve **API Keys** bölümünden bir anahtar oluştur.
(Kullanım ücretlidir; her ekran görüntüsü token harcar. Konsoldan harcama limiti koyabilirsin.)

### 2. Python kur
Python 3.10 veya üstü gerekli: [python.org/downloads](https://www.python.org/downloads/)
(Windows'ta kurarken **"Add Python to PATH"** kutusunu işaretle.)

### 3. Anahtarı tanıt

**Windows** (PowerShell):
```powershell
setx ANTHROPIC_API_KEY "sk-ant-...senin-anahtarın..."
```
Ardından terminali kapatıp yeniden aç.

**macOS / Linux**:
```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-...senin-anahtarın..."' >> ~/.zshrc   # bash kullanıyorsan ~/.bashrc
source ~/.zshrc
```

### 4. İşletim sistemine özel izinler

- **macOS:** *Sistem Ayarları → Gizlilik ve Güvenlik* altında, asistanı çalıştırdığın Terminal uygulamasına
  **Erişilebilirlik** (fare/klavye) ve **Ekran Kaydı** (ekran görüntüsü) izni ver. İzin verdikten sonra Terminal'i yeniden başlat.
- **Linux:** X11 oturumu gerekir (Wayland desteklenmez). Gerekli paketler:
  `sudo apt install python3-tk python3-dev python3-venv xclip`
- **Windows:** Ek bir şey gerekmez.

### 5. Başlat

- **Windows:** `asistan` klasöründeki **`baslat.bat`** dosyasına çift tıkla.
- **macOS / Linux:** terminalde `./baslat.sh`

İlk çalıştırmada gerekli kütüphaneler otomatik kurulur.

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
- Ekran görüntüleri işlenmek üzere Anthropic'e gönderilir. Gizli bir şey açıkken görev verme.

> Not: Bu tür yapay zeka ajanları hâlâ hata yapabilir. Önemli işlerde (para, iş yazışmaları,
> önemli dosyalar) ne yaptığını izle; ilk denemeleri `--onay` modunda yapman iyi olur.

## Ayarlar (isteğe bağlı ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ASISTAN_MODEL` | `claude-opus-5-5` | Kullanılacak model. Daha ucuz/hızlı için `claude-sonnet-5-5` |
| `ASISTAN_EFOR` | `high` | Düşünme düzeyi: `low`, `medium`, `high`, `xhigh`, `max`. Basit işlerde `medium` daha hızlı ve ucuz |
| `ASISTAN_MAKS_ADIM` | `80` | Tek bir görevde en fazla kaç tur çalışacağı |
| `ASISTAN_YEDEK` | `1` | Model bir isteği güvenlik nedeniyle reddederse sunucunun otomatik olarak başka bir modelle devam etmesi. Kapatmak için `0` |

## Dosyalar

- `asistan.py` — sohbet döngüsü, Claude ile iletişim, komut onayları
- `bilgisayar.py` — ekran görüntüsü, fare ve klavye kontrolü (koordinat ölçekleme, Türkçe karakter desteği)
- `baslat.bat` / `baslat.sh` — tek tıkla kurulum + başlatma
