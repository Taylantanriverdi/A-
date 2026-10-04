# A- · Kişisel Yapay Zeka Asistanı

Bilgisayarını senin gibi kullanan, uygulamaları açıp kullanan, değişiklik yapan ve zamanla
senin adına yazılım geliştirmeye devam eden bir asistan. Claude API'nin bilgisayar kullanımı
(`computer_toolset_20260801`), terminal (`bash`) ve dosya düzenleme araçlarıyla çalışır.

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

```bash
git clone https://github.com/taylantanriverdi/a-.git
cd a-
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-... # Windows: setx ANTHROPIC_API_KEY sk-ant-...
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
| `ASISTAN_MODEL` | `claude-opus-5-5` | Kullanılacak model |
| `ASISTAN_EFOR` | `high` | `low` … `max`; zor kodlama işleri için `xhigh` |
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
```

## Maliyet

Her model turu API ücretine tabidir; ekran görüntüleri en çok token harcayan kısımdır. Uzun
oturumlarda eski bağlam sunucu tarafında otomatik özetlenir. Basit işler için `--efor medium`
kullanarak maliyeti düşürebilirsin.
