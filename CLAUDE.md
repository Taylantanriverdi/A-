# Primer Lab — çalışma notları

## Teslim kuralı (kullanıcı isteği)
Her değişiklikten sonra kullanıcıya **tek bir zip** verilir; ayrı ayrı dosya/paket verilmez:

```
./paket_olustur.sh V<n>        # ör. ./paket_olustur.sh V11
```

- Çıktı: `dagitim/PrimerLab_TumYazilim_V<n>.zip` (git'e eklenmez).
- Betik ana kaynakları `YeniBilgisayarKurulumu/kaynak` kopyasına eşitler, `.bat`
  dosyalarının ASCII + CRLF olduğunu denetler ve `SURUM.txt` yazar.
- Sürüm numarası bir öncekinin bir fazlasıdır; son sürüm `YeniBilgisayarKurulumu/SURUM.txt` içindedir.
- Zip hem yeni kurulum (KURULUM.bat) hem güncelleme (PrimerLab_Guncelle.bat) içindir.

## Kaynakların yeri
- Arka uç: `PrimerLabV2_Kaynak/` (asıl kaynak)
- Sayfalar: `PrimerLabV2_Paket/PrimerLabV2/Pages/` (Index, HekimPortali, TeknisyenPaneli)
- Kurulum kiti: `YeniBilgisayarKurulumu/` (csproj ve appsettings.json yalnız burada)
- Kullanıcı ile Türkçe konuşulur.
