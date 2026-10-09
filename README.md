# A-
Aİ

## DIGICAD CAM – STL → NC (HyperDent alternatifi)

`DigicadCAM.html` dosyası tarayıcıda (Chrome/Edge) açılarak kurulumsuz çalışan bir dental CAM yazılımıdır.
STL dosyalarını 5 eksenli dental freze için HyperDent ile aynı formatta NC dosyasına çevirir.

### Kullanım
1. **STL Yükle** – bir veya birden çok STL (köprü, kron vb.). Model disk merkezine otomatik ortalanır.
2. **Model** sekmesi – disk çapı/kalınlığı, konum ve dönüş (X/Y/Z, Z dönüşü, eğimler).
3. **Bağlantı** sekmesi – işleme sınır payı ve konnektörler: *Otomatik yerleştir* veya *Tıklayarak ekle*.
4. **İşlemler** sekmesi – varsayılan sıra: Kaba Üst/Alt (P04 Ø2.5) → İnce Üst/Alt (P07 Ø1.0) → (isteğe bağlı) Detay (P06 Ø0.6).
   *3+2 Açılı* işlem: “Modelden nokta/eksen seç” ile alttan kesik (undercut) bölgeleri eğik açıda işler.
5. **NC Hesapla** → **NC İndir**.

### NC formatı
Yüklenen HyperDent örneğiyle birebir aynı: `G200 P{T}` / `G54 P{T}` takım çağırma, `M07`, `S… M03`,
`(RETRACT TO SAFE HEIGHT)` blokları, üst taraf `B0. A0.`, alt taraf `B0. A180.`, açılı işlemler `B… A…`,
N satır numaraları, CRLF, güvenli Z 11.15. Tüm şablonlar **Makine** sekmesinden düzenlenebilir ve profil olarak kaydedilebilir.

### Önemli – ilk kullanımda doğrulayın
- **A/B ekseni yönü**: Açılı (3+2) işlemlerde makinenizin dönüş yönü örnek dosyadan kesin çıkarılamadı.
  Aynı işin STL'ini ve HyperDent NC'sini birlikte yükleyin (**NC Görüntüle**); açılı yollar modele oturmuyorsa
  Makine sekmesinden A/B yönünü değiştirin. Sadece üst/alt (A0/A180) işlemler bu ayardan etkilenmez.
- İlk işi **havada (malzemesiz)** veya düşük ilerlemeyle deneyin; takım çapları/devirler Takımlar sekmesindedir.
- Henüz desteklenmeyenler: implant vida kanalı delme (P12) döngüsü, kenar (margin) çizgisi takibi.
