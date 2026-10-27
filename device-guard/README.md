# Device Guard — Uzaktan Cihaz Kullanım Engelleme

Sahip olduğunuz bir Windows bilgisayarı, **farklı ağlarda olsa bile internet
üzerinden** istediğinizde kullanıma kapatıp açmanızı sağlayan basit, şeffaf bir
araç. Açılışta çalışır, sizin kontrol ettiğiniz bir "durum bayrağı"nı okur ve
`LOCK` olduğunda ekranı kaplayan bir kilit ekranı gösterir.

> **Önemli / Dürüst uyarı:** Bu bir **caydırıcı ve yönetim aracıdır**, kırılamaz
> bir sistem değildir. Yönetici (admin) yetkisi olan biri süreci kapatabilir ya
> da güvenli modda açabilir. Yalnızca **kendi sahibi olduğunuz / yönetme hakkınız
> olan** cihazlarda kullanın (kendi bilgisayarınız, çocuğunuzun cihazı, kiosk vb.).
> Başkasının cihazını gizlice kilitlemek için tasarlanmamıştır ve bu amaçla
> kullanılmamalıdır.

## Nasıl çalışır?

```
[Sen]  --edit-->  durum.txt (GitHub/Gist/Dropbox)  <--oku--  [Cihazdaki ajan]
                         "LOCK" / "UNLOCK"                         |
                                                                   v
                                                    LOCK ise -> kilit ekranı
```

1. İnternette **senin düzenleyebildiğin** bir metin dosyası tutarsın. İçeriği ya
   `LOCK` ya da `UNLOCK` olur.
2. Cihazdaki ajan her birkaç saniyede bir bu dosyayı okur.
3. `LOCK` görürse tam ekran kilit açılır; `UNLOCK` görürse kilit kalkar.

## Kurulum

### 1) Python
Windows'ta Python 3 kurulu olmalı (kurulumda "Add to PATH" işaretli). Ekstra
paket gerekmez — sadece standart kütüphaneler (`tkinter`, `urllib`).

### 2) Durum bayrağı dosyasını oluştur
En kolayı **GitHub**:
- Bir repo aç, içine `durum.txt` koy, içeriğini `UNLOCK` yap.
- Dosyanın **raw** linkini al:
  `https://raw.githubusercontent.com/KULLANICI/REPO/main/durum.txt`

Alternatifler: GitHub Gist (raw link), Dropbox (paylaşım linkini `?dl=1` ile raw
yap), Pastebin (raw link). Önemli olan: **sadece senin düzenleyebildiğin**,
herkesin okuyabildiği bir metin.

> Not: GitHub raw içeriği birkaç dakika önbelleğe alınabilir. Anında tepki
> istiyorsan Gist genelde daha hızlı günceller ya da `poll_interval_seconds`
> değerini küçük tut.

### 3) Yapılandır
`config.example.json` dosyasını `config.json` olarak kopyala ve düzenle:
- `status_url`: yukarıdaki raw link.
- `poll_interval_seconds`: kontrol aralığı (örn. 15).
- `on_network_error`: internet yoksa `"keep"` (son durumu koru) ya da `"lock"`
  (güvenli tarafta kal, kilitle).

Acil-açma şifresi belirle (internet gitse bile sen girebilesin diye):
```
python set_password.py
```

### 4) Test et
```
python device_guard.py
```
`durum.txt` içeriğini `LOCK` yapıp kaydet → birkaç saniye içinde kilit ekranı
açılmalı. `UNLOCK` yap → kilit kalkmalı.

### 5) Açılışta otomatik başlat
`install_startup.bat` dosyasına **sağ tık → Yönetici olarak çalıştır**. Bu, her
oturum açılışında ajanı sessizce (`pythonw`) başlatan bir Zamanlanmış Görev
oluşturur. Kaldırmak için `uninstall_startup.bat`.

## Kullanım

- **Kilitle:** `durum.txt` içeriğini `LOCK` yap, kaydet.
- **Aç:** `UNLOCK` yap, kaydet.
- **Cihazdan acil açma:** kilit ekranında acil-açma şifreni gir.

## Sınırlar ve daha sağlamı

Bu sürüm basit ve şeffaftır. İsterseniz şunları ekleyebiliriz:
- Ajanı bir **Windows servisi** olarak çalıştırma + süreç kapatılırsa yeniden
  başlatan bir **watchdog**.
- Durum için kendi küçük **HTTPS sunucun/bulut fonksiyonun** (önbellek derdi yok,
  cihaz kimliği, log).
- Birden fazla cihazı tek panelden yönetme.

Sıfır-kod alternatif: **Microsoft Family Safety** (ekran süresi/uzaktan engelleme)
ya da kurumsal cihazlar için bir **MDM** çözümü.
