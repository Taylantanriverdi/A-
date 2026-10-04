# A- · Kişisel Yapay Zeka Asistanı

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
