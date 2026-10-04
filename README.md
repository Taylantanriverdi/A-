# A-

Bu depoda iki araç var:

1. **[Otopilot](#otopilot--otomatik-proje-geliştirme)** — DeepSeek API (veya Claude Code) ile projeni
   senin yerine geliştirir; limit/bakiye dolunca bekler, açılınca kaldığı yerden devam eder.
2. **[Kişisel Yapay Zeka Asistanı](#kişisel-yapay-zeka-asistanı)** — bilgisayarını senin gibi kullanan
   asistan (DeepSeek API).

---

## Otopilot · otomatik proje geliştirme

Otopilot, bir yapay zeka kodlayıcısına talimat verip projeni durmadan geliştirir. İki motor var:

| Motor | Ne gerekir | Seçim |
|---|---|---|
| **DeepSeek** (varsayılan) | DeepSeek API anahtarı (`DEEPSEEK_API_KEY`) ve bakiye | `--motor deepseek` |
| **Claude Code** | Kurulu ve giriş yapılmış Claude Code (Claude aboneliği) | `--motor claude` |

Motor proje ayarlarına kaydedilir; bir kez seçmen yeter.

```
görev seç → Claude'a talimat ver → testleri çalıştır → hata varsa Claude'a geri ver → commit → sıradaki
          ↘ görev kalmadıysa hedefe göre yeni görevler planlat
          ↘ Claude limiti dolduysa sıfırlanma saatine kadar bekle → kaldığı yerden devam
```

- **Talimat verir:** Senin hedefini somut görevlere böler ve Claude'a tek tek yaptırır. Ekleme de çıkarma da
  yapar (gereksiz kodu siler).
- **Test eder:** Testleri Claude değil otopilot çalıştırır; sonuç başarısızsa çıktıyı aynı Claude oturumuna
  verip düzeltmesini ister (varsayılan 3 deneme). Yine olmazsa değişiklikleri geri alır, yamayı saklar,
  görevi `[!]` işaretler ve sıradakine geçer.
- **Limitte durur, açılınca devam eder:** DeepSeek bakiyesi biterse 30 dakikada bir yeniden dener
  (bakiye yükleyince kendiliğinden devam eder); hız sınırında 2 dakika bekler. Claude motorunda limit
  mesajındaki sıfırlanma saatine kadar bekler. Her durumda aynı oturumu sürdürür.
- **Bilgisayar kapansa da kaybolmaz:** Kaldığı yeri `~/.otopilot/<proje>/` altına yazar. `otomatik-kur` ile
  Windows her açıldığında kendiliğinden başlar.
- **Güvenli:** Yalnızca `otopilot/gelistirme` dalında çalışır, her görevi ayrı commit'ler, asla push yapmaz.
  Senin commit edilmemiş değişikliklerin varsa başlamaz.

### Gereksinimler

- Python 3.10+ ve Git
- DeepSeek motoru için: `pip install openai` ve [DeepSeek API anahtarı](https://platform.deepseek.com/api_keys)
  (`setx DEEPSEEK_API_KEY sk-...`). Model varsayılan olarak `deepseek-chat`; `--model` ile değiştirilebilir.
- Claude motoru için: **Claude Code komut satırı sürümü** kurulu ve giriş yapılmış. Claude masaüstü uygulaması tek başına
  yetmez. Windows'ta PowerShell'de:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```
  Sonra yeni bir pencerede bir kez `claude` yazıp giriş yap (Windows'ta [Git for Windows](https://git-scm.com)
  da gerekir). Otopilot `claude.exe`'yi PATH'te olmasa bile bilinen kurulum yerlerinde arar; farklı bir
  yerdeyse `setx OTOPILOT_CLAUDE "C:\tam\yol\claude.exe"` ile göster.
- Projenin bir git deposu olması

### En kolay yol (Windows): `OTOPILOT_BASLAT.bat`'a çift tıkla

Tek dosya her şeyi yapar:

1. Python, Git ve gerekli Python paketi yoksa kurar.
2. DeepSeek API anahtarı tanımlı değilse anahtar sayfasını açar, anahtarı sorar ve kaydeder.
3. Proje klasörünü pencereden seçtirir. Proje git ile takip edilmiyorsa mevcut halini "ilk sürüm" olarak kaydeder.
4. İstersen bilgisayar her açıldığında otomatik başlamasını ayarlar.
5. Hedefi sorar ve otopilotu başlatır.

Sonraki çift tıklamalarda son projeyle kaldığı yerden devam eder.

### Canlı izleme paneli

`OTOPILOT_BASLAT.bat` başlarken tarayıcıda **canlı paneli** de açar (yalnızca `OTOPILOT_PANEL.bat` ile de
açılabilir): <http://127.0.0.1:8765>

- **Şu an:** ne yapıldığını düz Türkçe anlatır ("Testler başarısız — DeepSeek düzeltiyor, deneme 2/3"),
  üzerinde çalışılan görevi ve o adımda geçen süreyi gösterir; limit/bakiye beklemesinde geri sayım çıkar.
- **İşlem akışı:** Planla → Uygula → Test → Kaydet döngüsü, Düzelt ve Geri al dalları ile Bekle durumu;
  o anki adım yanıp söner, görevde tamamlanan adımlar yeşil, başarısız olan kırmızı görünür.
- **Görevler:** biten / bekleyen / başarısız görevler ve notları; panelden yeni görev eklenebilir, hedef düzenlenebilir.
- **Canlı akış:** her adım, kodlayıcının çalıştırdığı komutlar ve düzenlediği dosyalar, test çıktıları.
- **Son commit'ler** ve özet sayılar.
- **Başlat / Durdur** düğmeleri. Durdurulan otopilot yeniden başlatılınca kaldığı yerden devam eder.

Panel yalnızca bu bilgisayardan açılabilir; değişiklik isteklerini sayfaya gömülü rastgele bir anahtarla doğrular.

### Komut satırından kullanım

Ya da:

```bat
:: İlk çalıştırma: hedefi ver (ayarlar kaydedilir, sonraki çalıştırmalarda gerekmez)
otopilot.bat baslat C:\projeler\uygulama --hedef "Hekim portalına randevu sistemi ve bildirimler ekle"

:: Belirli görevler ekle (hedefle birlikte veya hedefsiz kullanılabilir)
otopilot.bat gorev C:\projeler\uygulama "Giriş sayfasına şifre sıfırlama ekle" "Kullanılmayan eski API'yi kaldır"

:: Durumu gör
otopilot.bat durum C:\projeler\uygulama

:: Windows açılınca otomatik başlasın / kaldır
otopilot.bat otomatik-kur C:\projeler\uygulama
otopilot.bat otomatik-kaldir C:\projeler\uygulama
```

Linux/macOS'ta aynı komutlar: `python -m otopilot baslat ~/projeler/uygulama --hedef "..."`, panel için `python -m otopilot arayuz`.

Görev listesini istediğin zaman `~/.otopilot/<proje>/gorevler.md` dosyasından düzenleyebilirsin:
`- [ ]` bekliyor, `- [x]` bitti, `- [!]` başarısız. İşi incelemek için `git log otopilot/gelistirme`;
beğendiğinde dalı ana dalına birleştir.

### Seçenekler (`baslat`)

| Seçenek | Açıklama |
|---|---|
| `--hedef "..."` | Genel hedef; görevler buna göre planlanır, hedef bitince otopilot durur |
| `--gorev "..." ...` | Başlamadan önce görev ekle |
| `--test "npm test"` | Doğrulama komutu. Verilmezse projeden bulunur (npm/pytest/go/cargo/dotnet/maven/gradle) |
| `--dal ad` | Çalışma dalı (varsayılan `otopilot/gelistirme`) |
| `--model opus` | Claude modeli |
| `--max-deneme 3` | Test başarısız olursa düzeltme denemesi |
| `--izin "Bash(npm *)"` | Claude'a ek komut izni (ör. paket kurmak için) |
| `--tam-yetki` | Claude her komutu sormadan çalıştırır. Yalnızca güvendiğin projede/sanal makinede |
| `--tek-sefer` | Tek görev yapıp çık |

**İzinler (DeepSeek):** Kodlayıcı proje klasöründe dosya düzenleyebilir ve komut çalıştırabilir; tehlikeli
komutlar ve git işlemleri (commit, push, reset, checkout...) engellenir, git'i otopilot yönetir.

**İzinler (Claude):** Varsayılan olarak Claude dosya okuyup düzenleyebilir, `git status/diff/log` ve test komutunu
çalıştırabilir; başka bir komut isterse sormadan reddedilir, süreç asla takılı kalmaz. Projen derleme veya
paket kurulumu gerektiriyorsa `--izin "Bash(npm *)"` gibi ekle.

**Limitler hakkında (Claude):** Otopilot Claude'un limitlerini aşmaz, yalnızca dolduğunda bekler. Limit tüm Claude
kullanımınla ortaktır; otopilot çalışırken Claude'u başka işlerde de kullanırsan limit daha çabuk dolar.

---

# Kişisel Yapay Zeka Asistanı

Bilgisayarını senin gibi kullanan, uygulamaları açıp kullanan, değişiklik yapan ve zamanla
senin adına yazılım geliştirmeye devam eden bir asistan. **DeepSeek API** (OpenAI uyumlu) ile çalışır;
ekran, terminal, dosya ve hafıza araçlarını fonksiyon çağrısıyla kullanır.

> **Ekran kontrolü için görüntü destekleyen bir model gerekir.** Asistan açılışta seçili modelin
> görüntü kabul edip etmediğini dener. Kabul etmiyorsa ekran kontrolünü kapatır ve terminal + dosyalarla
> çalışmaya devam eder (yazılım geliştirme bu modda tam çalışır). Görüntü destekleyen güncel DeepSeek
> modelinin adını [platform.deepseek.com](https://platform.deepseek.com) üzerinden kontrol edip
> `ASISTAN_MODEL` ile ayarla.

## Neler yapabilir

| Yetenek | Nasıl |
|---|---|
| **Ekranı görür, fare ve klavyeyi kullanır** | Ekran görüntüsü alır, tıklar, yazar, kaydırır, sürükler, yakınlaştırır |
| **Terminal** | Kalıcı kabuk oturumu (`cd`, `export`, sanal ortam komutlar arasında korunur) |
| **Dosya düzenleme** | Görüntüleme, oluşturma, değiştirme; yalnızca izin verdiğin dizinlerde |
| **Seni tanır** | `ogren` komutu kod depolarını inceler ve stilini `~/.asistan/profil.md` dosyasına yazar |
| **Hatırlar** | Öğrendiklerini ve yarım kalan işleri `~/.asistan/notlar.md`'de saklar |
| **Senin adına yazılım yazar** | `otonom` modu görev listesini sırayla alır, her biri için ayrı git dalında kodlar, test eder, commit atar |

## Kurulum

### Windows (kolay yol)

1. [Python 3.10+](https://www.python.org/downloads/) kur ("Add python.exe to PATH" kutusunu işaretle).
2. Zip'i bir klasöre çıkar, **`kurulum.bat`**'a çift tıkla. DeepSeek API anahtarını sorar ve kaydeder.
3. **`baslat.bat`** ile asistanı aç.
4. Güncellemek için **`guncelle.bat`**: Git kuruluysa `git pull` yapar, değilse en son sürümü
   GitHub'dan zip olarak indirip üzerine yazar ve paketleri günceller. Profilin ve notların korunur.

```bat
baslat.bat                                  :: sohbet modu
baslat.bat "Not Defteri'ni aç ve alışveriş listesi yaz"
baslat.bat ogren C:\Users\%USERNAME%\projeler   :: seni tanısın
baslat.bat otonom C:\projeler\uygulamam      :: senin adına kod yazsın
```

> Depo gizliyse zip indirme giriş ister; bu durumda Git kurup klasörü `git clone` ile al,
> `guncelle.bat` git üzerinden çalışır.

### Elle kurulum (tüm sistemler)

```bash
git clone -b claude/gifted-knuth-b3ij29 https://github.com/Taylantanriverdi/A-.git
cd A-
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DEEPSEEK_API_KEY=sk-...      # Windows: setx DEEPSEEK_API_KEY sk-...
```

İşletim sistemine göre ek adımlar:

- **macOS:** Sistem Ayarları → Gizlilik ve Güvenlik → *Erişilebilirlik* ve *Ekran Kaydı* altında
  terminal uygulamana izin ver.
- **Linux:** X11 oturumu gerekir (Wayland'de `pyautogui` çalışmaz). `sudo apt install python3-tk python3-dev xclip`
- **Windows:** Ek adım yok. Ekran ölçeklendirmesi %100 değilse koordinatlar otomatik düzeltilir.

## Kullanım

```bash
# 1) Önce seni tanısın — depolarını inceler, birkaç soru sorar, profilini yazar
python -m asistan ogren ~/projeler

# 2) Sohbet modu
python -m asistan

# 3) Tek seferlik görev
python -m asistan "Chrome'da takvimimi aç ve yarınki toplantıları listele"
python -m asistan "İndirilenler klasörünü dosya türüne göre klasörle"

# 4) Otonom yazılım modu — senin yerine kod yazar
python -m asistan otonom ~/projeler/uygulamam
```

İlk otonom çalıştırmada `~/.asistan/gorevler/<proje>.md` oluşturulur. Görevleri yaz:

```markdown
- [ ] Giriş sayfasına "şifremi unuttum" akışı ekle
- [ ] Rapor servisi için birim testleri yaz
```

Her görev için `asistan/<görev-adı>` dalı açılır; asistan projeyi tanır, kodu senin stilinde yazar,
testleri çalıştırır ve commit atar. Biten görev `[x]` olur, altına özet eklenir. Sabah dalları
inceleyip birleştirmen yeterli. Seçenekler:

- `--surekli` — görev bitince kapanmaz, yeni görev bekler (`--bekleme-dk 15`)
- `--push` — biten dalları `origin`'e gönderir (asla `main`'e değil)
- `--ekranli` — otonom modda ekran kontrolüne de izin verir

**Zamanlanmış çalıştırma** (ör. her gece 02:00):

```bash
# Linux/macOS: crontab -e
0 2 * * * cd /yol/a- && .venv/bin/python -m asistan otonom ~/projeler/uygulamam >> ~/.asistan/gece.log 2>&1
```

Windows'ta Görev Zamanlayıcı'da aynı komutu `.venv\Scripts\python.exe` ile tanımla.

## Güvenlik ve kontrol

Bu asistan bilgisayarında gerçek işlemler yapar. Kontrol sende kalsın diye:

| Mod | Davranış |
|---|---|
| `--mod onayli` (varsayılan) | Her terminal komutu ve dosya değişikliği için onay ister; ekran eylemleri serbest |
| `--mod tam` | Fare/klavye dahil her eylem için onay ister |
| `--mod otonom` | Onay istemez (otonom yazılım modunda otomatik) |

Her modda:

- **Acil durdurma:** fareyi ekranın herhangi bir köşesine götür. Çalışan görevi `Ctrl+C` ile kesebilirsin.
- `rm -rf /`, `git push --force`, `mkfs`, `shutdown`, `curl … | sh` gibi tehlikeli komutlar her zaman
  onay ister; gözetimsiz modda reddedilir.
- Dosya düzenleyici yalnızca `ASISTAN_IZINLI_DIZINLER` içindeki dizinlere dokunur (varsayılan: ev dizinin).
- Para transferi, satın alma, mesaj/e-posta gönderme gibi geri alınamaz işlerden önce sana sorar.
- Ekrandaki ve web sayfalarındaki metinleri talimat olarak değil veri olarak görür.
- Her eylem `~/.asistan/gunluk.log` dosyasına kaydedilir.
- Otonom mod yalnızca kendi dallarında çalışır; çalışma ağacında commit edilmemiş değişiklik varsa başlamaz.

> Öneri: Otonom modu ilk zamanlarda ayrı bir kullanıcı hesabında veya sanal makinede çalıştır ve
> açtığı dalları birleştirmeden önce mutlaka incele.

## Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | DeepSeek API anahtarı (zorunlu) |
| `ASISTAN_MODEL` | `deepseek-chat` | Model adı; ekran kontrolü için görüntü destekleyen bir model seç |
| `ASISTAN_API_URL` | `https://api.deepseek.com` | Başka bir OpenAI uyumlu servis için değiştirilebilir |
| `ASISTAN_MAX_TOKENS` | `8192` | Yanıt başına en fazla token |
| `ASISTAN_MAX_GORUNTU` | `3` | Geçmişte tutulan ekran görüntüsü sayısı (eskiler silinir, maliyet düşer) |
| `ASISTAN_MOD` | `onayli` | Onay modu |
| `ASISTAN_IZINLI_DIZINLER` | ev dizini | Dosya düzenleyicinin erişebileceği dizinler (`:` / `;` ile ayır) |
| `ASISTAN_EKRAN` | `1` | `0` ise ekran kontrolü kapalı |
| `ASISTAN_MAX_TUR` | `200` | Bir görevdeki en fazla model turu |
| `ASISTAN_DIZIN` | `~/.asistan` | Profil, notlar, günlük ve görev dosyalarının yeri |

## Proje yapısı

```
otopilot/
  __main__.py   komut satırı (baslat, gorev, durum, otomatik-kur)
  dongu.py      ana döngü: planla, uygula, test et, düzelt, commit, limitte bekle
  deepseek.py   DeepSeek motoru (asistan/ araçlarını kullanır)
  claude.py     Claude Code motoru (CLI sarmalayıcı)
  limit.py      limit mesajından sıfırlanma saatini çıkarma
  proje.py      git ve test komutu
  durum.py      kalıcı durum, görev listesi, olaylar, kilit
  arayuz.py     canlı izleme paneli sunucusu (127.0.0.1:8765)
  arayuz.html   panel sayfası
OTOPILOT_BASLAT.bat  tek tıkla kurulum + başlatma (paneli de açar)
OTOPILOT_PANEL.bat   yalnızca canlı izleme panelini açar
otopilot.bat    Windows komut satırı başlatıcı
asistan/
  __main__.py   komut satırı (sohbet, ogren, otonom)
  ajan.py       ajan döngüsü ve sistem istemi
  bilgisayar.py ekran / fare / klavye (computer toolset üyeleri)
  araclar.py    terminal, dosya düzenleyici, hafıza
  guvenlik.py   onaylar, tehlikeli komut tespiti, günlük
  otonom.py     görev listesinden otonom yazılım geliştirme
  ayarlar.py    ayarlar
kurulum.bat     Windows kurulumu (sanal ortam + paketler + API anahtarı)
baslat.bat      Windows başlatıcı
guncelle.bat    Windows güncelleyici
```

## Maliyet

Her model turu DeepSeek API ücretine tabidir; ekran görüntüleri en çok token harcayan kısımdır.
Geçmişte yalnızca son birkaç ekran görüntüsü tutulur (`ASISTAN_MAX_GORUNTU`). Bakiye biterse
asistan "bakiye yetersiz" uyarısıyla durur.
