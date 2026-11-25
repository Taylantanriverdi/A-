# Gmail Tarayıcı

Gmail hesaplarına gelen mailleri tarar; şüpheli (oltalama/spam) mailleri puanlar,
anahtar kelime eşleşmelerini bulur, CSV raporu üretir ve isterseniz Gmail'de etiketler.
Birden fazla hesabı destekler (her hesap için ayrı oturum dosyası tutulur).

## Neleri kontrol eder?

| Kontrol | Açıklama |
|---|---|
| SPF / DKIM / DMARC | `Authentication-Results` başlığında `fail` varsa puan ekler |
| Reply-To farklı | Yanıt adresi gönderenden farklı alan adındaysa |
| Ad sahteciliği | Görünen ad bir marka/e-posta içeriyor ama gönderen alan adı uyuşmuyorsa |
| Link uyuşmazlığı | Linkin görünen metni ile gerçek adresi farklı alan adındaysa |
| IP adresli / kısaltılmış link | `http://1.2.3.4/...`, bit.ly vb. |
| Tehlikeli ekler | `.exe .scr .js .vbs .bat .iso .docm .xlsm` … |
| Anahtar kelimeler | `ayarlar.json` içindeki kelimeler ve puanları |
| Engelli / izlenen göndericiler | Listeye göre işaretler |

Toplam puan `supheli_esik_puani` değerini (varsayılan 40) aşarsa mail **ŞÜPHELİ** sayılır.

## Kurulum

1. Python 3.9+ kurulu olsun, sonra:
   ```bash
   pip install -r requirements.txt
   ```
2. **Google Cloud Console** → yeni proje → *APIs & Services* → **Gmail API**'yi etkinleştirin.
3. *OAuth consent screen* → External → kendi Gmail adresinizi **Test users** listesine ekleyin.
4. *Credentials* → **Create credentials → OAuth client ID → Desktop app** → JSON'u indirin,
   bu klasöre `credentials.json` adıyla koyun.

> `credentials.json` ve `token_*.json` dosyaları gizlidir, `.gitignore` ile hariç tutulur. Kimseyle paylaşmayın.

## Kullanım

```bash
# Tek seferlik tarama (ilk çalıştırmada tarayıcı açılır, Google ile giriş yaparsınız)
python gmail_tarayici.py

# Başka bir hesap (her hesap için ayrı isim verin)
python gmail_tarayici.py --hesap is
python gmail_tarayici.py --hesap kisisel

# Özel Gmail sorgusu
python gmail_tarayici.py --sorgu "is:unread from:banka.com"

# Sürekli izleme: her 60 sn'de yeni gelen mailleri tarar
python gmail_tarayici.py --izle

# Sonuçları CSV'ye yaz ve şüphelileri Gmail'de etiketle
python gmail_tarayici.py --csv rapor.csv --etiketle

# Sadece şüphelileri göster
python gmail_tarayici.py --sadece-supheli
```

Etiketleme kullanılmadığı sürece program **salt okunur** izinle çalışır
(`gmail.readonly`); `--etiketle` verilirse `gmail.modify` izni istenir.
Program hiçbir maili silmez veya göndermez.
