# ROBOT_KOL_KILAVUZ.pdf dosyasını üretir: önce HTML yazılır, sonra Chromium ile PDF'e çevrilir.
#   python3 belge/kilavuz_olustur.py   (Playwright + Chromium gerekir)
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import svgler as S

BURADA = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(BURADA, 'kilavuz.html')
PDF = os.path.join(os.path.dirname(BURADA), 'ROBOT_KOL_KILAVUZ.pdf')

CSS = """
@page { size: A4; margin: 16mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: Inter, 'DejaVu Sans', sans-serif; color: #1d2330; font-size: 10.5pt; line-height: 1.45; margin: 0; }
h1 { font-size: 26pt; margin: 0 0 6px; letter-spacing: -.01em; }
h2 { font-size: 16pt; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 3px solid #2563eb; }
h3 { font-size: 12pt; margin: 16px 0 6px; }
p { margin: 6px 0; }
.sayfa { break-before: page; }
.alt { color: #64748b; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; }
th { background: #eff4ff; text-align: left; padding: 6px 7px; border-bottom: 2px solid #2563eb; }
td { padding: 5px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
tr { break-inside: avoid; }
.kutu { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin: 10px 0; break-inside: avoid; }
.uyari { border-left: 5px solid #f59e0b; background: #fffbeb; border-radius: 6px; padding: 8px 12px; margin: 10px 0; break-inside: avoid; }
.tehlike { border-left: 5px solid #dc2626; background: #fef2f2; border-radius: 6px; padding: 8px 12px; margin: 10px 0; break-inside: avoid; }
.ipucu { border-left: 5px solid #16a34a; background: #f0fdf4; border-radius: 6px; padding: 8px 12px; margin: 10px 0; break-inside: avoid; }
.sekil { text-align: center; margin: 8px 0; break-inside: avoid; }
.sekil figcaption { color: #64748b; font-size: 9pt; margin-top: 4px; }
.adim { display: grid; grid-template-columns: 230px 1fr; gap: 14px; align-items: start; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin: 0 0 10px; break-inside: avoid; }
.adim h3 { margin: 0 0 4px; }
.adim ol, .adim ul { margin: 4px 0; padding-left: 18px; }
.no { display: inline-block; background: #2563eb; color: #fff; border-radius: 50%; width: 22px; height: 22px; text-align: center; line-height: 22px; font-weight: 700; margin-right: 6px; font-size: 10pt; }
.kapak { height: 255mm; display: flex; flex-direction: column; }
.kapak .ust { background: #0f172a; color: #fff; border-radius: 14px; padding: 26px 28px; }
.kapak .ust p { color: #cbd5e1; font-size: 12pt; }
.etiket { display: inline-block; background: #2563eb; color: #fff; border-radius: 99px; padding: 2px 10px; font-size: 9pt; margin-right: 6px; }
.icindekiler { columns: 2; column-gap: 30px; margin-top: 8px; }
.icindekiler div { padding: 3px 0; border-bottom: 1px dotted #cbd5e1; }
.kontrol li { list-style: none; margin: 4px 0; }
.kontrol li::before { content: '☐'; margin-right: 8px; margin-left: -20px; font-size: 12pt; }
code { font-family: 'DejaVu Sans Mono', monospace; background: #f1f5f9; padding: 0 4px; border-radius: 3px; font-size: 9pt; }
.iki { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
"""


def tablo(basliklar, satirlar):
    h = ''.join(f'<th>{b}</th>' for b in basliklar)
    r = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in s) + '</tr>' for s in satirlar)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{r}</tbody></table>'


def sekil(svg, yazi):
    return f'<figure class="sekil">{svg}<figcaption>{yazi}</figcaption></figure>'


def adim(n, baslik, svg, govde):
    return f'<div class="adim"><div>{svg}</div><div><h3><span class="no">{n}</span>{baslik}</h3>{govde}</div></div>'


BOLUMLER = ['Yol haritası', 'Robot kolu tanıyalım', 'Malzeme listesi', '3D yazıcıdan basılacak parçalar',
            'Baskı ayarları', 'Elektrik bağlantıları', 'Yazılım kurulumu', 'PS4 kolunu eşleştirme',
            'Servoları ortalama', 'Mekanik montaj (7 adım)', 'İlk çalıştırma ve kalibrasyon',
            'Kullanım: PS4 ve bilgisayar', 'Sorun giderme', 'Güvenlik', 'Son kontrol listesi']

parcalar = []

# ---------------- Kapak ----------------
parcalar.append(f"""
<section class="kapak">
  <div class="ust">
    <span class="etiket">Kılavuz V7</span><span class="etiket">ESP32 + PCA9685</span>
    <h1>6 Eksenli Robot Kol</h1>
    <p>Malzeme listesi, 3D baskı parçaları, bağlantı şeması, montaj ve kullanım. Sıfırdan çalışan kola kadar her adım.</p>
  </div>
  <div class="sekil" style="margin-top:18px">{S.kol(7, None, True, 470)}
    <figcaption>Turuncu numaralar eksenleri gösterir: 1 taban, 2 omuz, 3 dirsek, 4 bilek eğimi, 5 bilek dönüşü, 6 kıskaç.</figcaption></div>
  <h3>İçindekiler</h3>
  <div class="icindekiler">{''.join(f'<div>{i + 1}. {b}</div>' for i, b in enumerate(BOLUMLER))}</div>
</section>
""")

# ---------------- 1 Yol haritası + 2 Robot kolu ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>1. Yol haritası</h2>
<p>İşleri bu sırayla yapın. Özellikle <b>servoları ortalamadan</b> (adım 5) mekanik montaja geçmeyin; yoksa kol ilk açılışta kendini zorlar.</p>
{S.akis()}
<div class="ipucu"><b>Zaman planı:</b> 3D baskı en uzun iş (yaklaşık 25–35 saat yazıcı süresi). Baskılar sürerken elektronik bağlantıyı ve yazılım kurulumunu yapabilirsiniz.</div>

<h2 style="margin-top:22px">2. Robot kolu tanıyalım</h2>
<p>Kolun 6 hareketli ekseni vardır. Her eksen bir servo motorla döner. Servolar PCA9685 kartının 0–5 numaralı kanallarına bağlanır. Kodda her eksenin açı sınırı tanımlıdır; kol bu sınırların dışına çıkmaz.</p>
{tablo(['Eksen', 'Parça', 'PCA9685 kanalı', 'Önerilen servo', 'Koddaki sınır', 'Başlangıç'], [
    ['1', 'Taban (sağa-sola dönüş)', 'K0', 'MG996R', '0°–180°', '90°'],
    ['2', 'Omuz (kolu kaldırır)', 'K1', 'MG996R (daha iyisi DS3218 20 kg)', '15°–165°', '90°'],
    ['3', 'Dirsek', 'K2', 'MG996R', '10°–170°', '90°'],
    ['4', 'Bilek eğimi (yukarı-aşağı)', 'K3', 'MG90S', '0°–180°', '90°'],
    ['5', 'Bilek dönüşü', 'K4', 'MG90S', '0°–180°', '90°'],
    ['6', 'Kıskaç', 'K5', 'MG90S (SG90 da olur)', '30°–120°', '60°'],
])}
<div class="uyari"><b>Neden bu servolar?</b> Omuz, kolun ve tutulan cismin tüm ağırlığını taşır; en güçlü servo buraya takılmalı. Bilek ve kıskaç hafif olduğundan küçük (9 g) servolar yeterli, ayrıca kolun ucunu hafif tutar. Plastik dişli SG90 yerine metal dişli MG90S daha dayanıklıdır.</div>
</section>
""")

# ---------------- 3 Malzeme listesi ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>3. Malzeme listesi</h2>
<p>Elinizde olanları ✓ ile işaretleyin. Satın alınacakların listesi böylece kendiliğinden çıkar.</p>
<h3>Elektronik</h3>
{tablo(['✓', 'Malzeme', 'Adet', 'Özellik / not'], [
    ['☐', 'ESP32 geliştirme kartı (DevKit V1, 30 veya 38 pin)', '1', 'Bluetooth Classic olmalı (ESP32-S3/C3 <b>olmaz</b>, PS4 kütüphanesi klasik ESP32 ister)'],
    ['☐', 'PCA9685 16 kanal servo sürücü kartı', '1', 'Adres 0x40 (köprülere dokunmayın)'],
    ['☐', 'MG996R servo (metal dişli)', '3', 'Taban, omuz, dirsek. Omuz için DS3218 (20 kg) daha güvenli'],
    ['☐', 'MG90S mikro servo (metal dişli)', '3', 'Bilek eğimi, bilek dönüşü, kıskaç'],
    ['☐', 'Güç kaynağı (adaptör) 5 V – 10 A', '1', '6 V de olur. Servolar yük altında 2 A\'in üzerinde çeker; 3 A\'lik adaptör <b>yetmez</b>'],
    ['☐', 'DC dişi jak – vidalı klemens adaptörü', '1', 'Adaptörü PCA9685\'e kolay bağlamak için'],
    ['☐', 'Elektrolitik kondansatör 1000 µF / 16 V', '1', 'PCA9685 V+ ile GND arasına (bazı kartlarda yerleşik yuvası var)'],
    ['☐', 'Dişi-dişi jumper kablo', '4', 'ESP32 – PCA9685 arası (3V3, GND, SDA, SCL)'],
    ['☐', 'Servo uzatma kablosu 30 cm', '3–4', 'Bilek ve kıskaç servoları için'],
    ['☐', 'Kalın güç kablosu (en az 18 AWG, kırmızı-siyah)', '1 m', 'Adaptör → PCA9685 klemens'],
    ['☐', 'Mikro USB veri kablosu', '1', 'Sadece şarj kablosu olmamalı; kod yükleme ve USB kontrol için'],
    ['☐', 'PS4 DualShock 4 kolu', '1', 'Elinizde var'],
])}
<h3>Mekanik</h3>
{tablo(['✓', 'Malzeme', 'Adet', 'Özellik / not'], [
    ['☐', 'PLA+ veya PETG filament', '~1 kg', 'Bir makara yeter'],
    ['☐', '608ZZ rulman (8×22×7 mm)', '2–4', 'Taban dönüşünü taşır, servonun yükünü alır (tasarıma göre değişir)'],
    ['☐', 'M3 vida seti (8, 12, 16, 20, 25 mm) + somun + pul', '1 kutu', 'Parçaları birleştirmek için'],
    ['☐', 'M4 vida + somun (20–30 mm)', '4–6', 'Gövdeyi tablaya / zemine sabitlemek için'],
    ['☐', 'Metal servo kolu (horn) 25T', '3', 'MG996R için; plastik kollar yük altında kayar'],
    ['☐', 'Zemin plakası (kontrplak / MDF, 25×25 cm)', '1', 'Kol öne devrilmesin diye; vidayla sabitleyin'],
    ['☐', 'Kablo bağı ve spiral kablo toplayıcı', '1 paket', 'Kablolar dönen eksenlere takılmasın'],
])}
</section>
""")

# ---------------- 4 3D baskı parçaları + 5 ayarlar ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>4. 3D yazıcıdan basılacak parçalar</h2>
<div class="uyari"><b>Önemli:</b> Parça çizimleri (STL dosyaları) bu pakette yok. MG996R + MG90S servolara uygun, açık kaynak bir 6 eksenli kol tasarımı indirin (Printables, Thingiverse, MakerWorld'de <i>“6 DOF robot arm MG996R”</i> diye aratın). Aşağıdaki liste böyle bir tasarımda bulunan parçaları ve nasıl basılacaklarını gösterir; adlar tasarıma göre biraz değişebilir.</div>
<h3>Tasarım seçerken kontrol edin</h3>
<ul>
  <li>Servo yuvaları <b>MG996R (40,7 × 19,7 × 42,9 mm)</b> ve <b>MG90S / SG90 (22,8 × 12,2 × 28,5 mm)</b> ölçüsünde olmalı.</li>
  <li>Taban dönüşü rulmanla desteklenmeli; tüm kol ağırlığı servo milinde kalmamalı.</li>
  <li>6 eksen olmalı: taban, omuz, dirsek, bilek eğimi, bilek dönüşü, kıskaç.</li>
  <li>Yorumlarda “baskı sorunsuz” diyen ve montaj fotoğrafı paylaşılmış tasarımı tercih edin.</li>
</ul>
{tablo(['#', 'Parça', 'Adet', 'Malzeme', 'Doluluk', 'Destek', 'Tahmini süre'], [
    ['1', 'Taban gövdesi (taban servosu ve rulmanlar içinde)', '1', 'PETG / PLA+', '%30', 'Gerekebilir', '6–8 sa'],
    ['2', 'Döner tabla (taban servosunun üstüne)', '1', 'PETG / PLA+', '%40', 'Yok', '3–4 sa'],
    ['3', 'Omuz yatağı (omuz servosunu tutar)', '1–2', 'PETG / PLA+', '%40', 'Gerekebilir', '3–5 sa'],
    ['4', 'Üst kol (omuz → dirsek)', '1–2', 'PLA+', '%30', 'Yok', '3–4 sa'],
    ['5', 'Ön kol (dirsek → bilek)', '1', 'PLA+', '%25', 'Yok', '2–3 sa'],
    ['6', 'Bilek gövdesi (bilek eğim servosu)', '1', 'PLA+', '%30', 'Gerekebilir', '1–2 sa'],
    ['7', 'Bilek dönüş adaptörü', '1', 'PLA+', '%40', 'Yok', '0,5–1 sa'],
    ['8', 'Kıskaç gövdesi', '1', 'PLA+', '%30', 'Gerekebilir', '1–2 sa'],
    ['9', 'Kıskaç parmakları', '2', 'PLA+ (uç kısmı TPU olabilir)', '%40', 'Yok', '1 sa'],
    ['10', 'Kıskaç dişlileri', '2', 'PETG / PLA+', '%100', 'Yok', '0,5 sa'],
    ['11', 'Kıskaç bağlantı çubukları', '2–4', 'PLA+', '%50', 'Yok', '0,5 sa'],
    ['12', 'Elektronik kutusu + kapak (ESP32 + PCA9685)', '1+1', 'PLA', '%20', 'Yok', '3–4 sa'],
    ['13', 'Kablo klipsleri', '6–8', 'PLA', '%20', 'Yok', '0,5 sa'],
])}
<div class="ipucu"><b>Önce deneme baskısı:</b> Tüm parçaları basmadan önce, tasarımdaki en küçük servo yuvasını içeren parçayı basıp servonun oturduğunu kontrol edin. Sıkıysa dilimleyicide “yatay genişleme” (XY compensation) ayarını −0,1 mm yapın.</div>

</section>
<section class="sayfa">
<h2>5. Baskı ayarları</h2>
{tablo(['Ayar', 'Değer', 'Neden'], [
    ['Nozul', '0,4 mm', 'Standart'],
    ['Katman yüksekliği', '0,2 mm (dişliler 0,12–0,16 mm)', 'Dişlilerde pürüzsüz diş için ince katman'],
    ['Duvar sayısı', '4 (1,6 mm)', 'Vida delikleri ve servo yuvaları sağlam olur'],
    ['Üst / alt katman', '5 / 5', 'Yüzeyler kırılmaz'],
    ['Doluluk deseni', 'Gyroid, %30–40', 'Her yönde dayanıklı'],
    ['Destek', 'Sadece 50°\'den dik çıkıntılara, ağaç (tree) destek', 'Kolay sökülür, servo yuvaları temiz kalır'],
    ['Yapışma', 'Büyük düz parçalarda 5 mm brim', 'Köşe kalkmasını önler'],
    ['Yön', 'En geniş düz yüz tablaya; kol parçaları yatay', 'Katmanlar yük yönünde dayanıklı olur'],
    ['PLA+ sıcaklığı', 'Nozul 210–220 °C, tabla 60 °C', ''],
    ['PETG sıcaklığı', 'Nozul 235–245 °C, tabla 75–80 °C', 'Taban ve omuz için daha dayanıklı'],
])}
<p><b>Baskı sonrası:</b> Destekleri sökün, servo yuvalarını ve vida deliklerini maket bıçağıyla temizleyin. M3 delikleri 3 mm matkap ucuyla elle bir kez açın.</p>
<h3>Gerekli aletler (malzeme listesinin devamı)</h3>
<p>Yıldız ve düz tornavida, M3 alyan anahtarı, kablo sıyırıcı, yan keski, kumpas, multimetre (gerilim ölçmek için), maket bıçağı / zımpara (baskı temizliği). Havya isteğe bağlıdır.</p>
</section>
""")

# ---------------- 6 Elektrik ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>6. Elektrik bağlantıları</h2>
<div class="tehlike"><b>Bağlantı yaparken güç kaynağı prizde olmasın.</b> Servoları <b>asla</b> ESP32'nin 5V/3V3 pininden beslemeyin; ESP32 yanar veya sürekli yeniden başlar.</div>
{sekil(S.baglanti(), 'Şekil 1 – ESP32, PCA9685, güç kaynağı ve servoların bağlantısı')}
<div class="iki">
<div>
<h3>Adım adım</h3>
<ol>
  <li><b>ESP32 3V3 → PCA9685 VCC</b> (kartın kendi beslemesi)</li>
  <li><b>ESP32 GND → PCA9685 GND</b></li>
  <li><b>ESP32 GPIO21 → PCA9685 SDA</b></li>
  <li><b>ESP32 GPIO22 → PCA9685 SCL</b></li>
  <li>Adaptörün <b>(+)</b> ucu → mavi klemensteki <b>V+</b>, <b>(−)</b> ucu → <b>GND</b>. Kalın kablo kullanın.</li>
  <li>1000 µF kondansatörü V+ ile GND arasına takın: uzun bacak (+), şeritli bacak (−).</li>
  <li>Servoları K0–K5'e takın (sıra yukarıdaki tabloda). Kahverengi tel kartın kenarına (GND sırasına) gelir.</li>
  <li>ESP32'yi USB kabloyla bilgisayara bağlayın.</li>
</ol>
</div>
<div>
<h3>Servo fişi</h3>
{S.servo_konnektor()}
<div class="uyari"><b>Ortak toprak şart:</b> Adaptörün (−) ucu ile ESP32'nin GND'si birbirine bağlı olmalı. PCA9685 üzerinden bu bağlantı zaten oluşur; GND kablosunu unutmayın.</div>
<div class="ipucu"><b>Kontrol:</b> Prize takmadan önce multimetreyi “bip” konumuna alın; V+ ile GND arasında kısa devre (bip) <b>olmamalı</b>. Prize taktıktan sonra V+ – GND arası 5–6 V ölçülmeli.</div>
</div>
</div>
</section>
""")

# ---------------- 7 Yazılım + 8 PS4 ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>7. Yazılım kurulumu (tek tık)</h2>
<p>Tüm yazılım işini <code>ROBOT_KOL_KURULUM_V7.bat</code> dosyası yapar. Bu dosyaya Windows'ta çift tıklayın:</p>
{tablo(['Adım', 'Ne olur', 'Sizin yapmanız gereken'], [
    ['1', 'Masaüstünde <b>ROBOT KOL</b> klasörü açılır', '—'],
    ['2', 'PS4 kolunun MAC adresi sorulur (sadece ilk seferde)', 'Bölüm 8\'deki adresi yazın veya Enter'],
    ['3', 'Kod, belgeler, kontrol paneli ve bu kılavuz klasöre yazılır', '—'],
    ['4–5', 'Arduino CLI, ESP32 paketi (2.0.17) ve kütüphaneler iner (~600 MB, en az 4 GB boş alan)', 'Bekleyin. C: doluysa başka diske kurulur'],
    ['6', 'Kod derlenir', '—'],
    ['7', 'ESP32 bulunur ve kod yüklenir', '“Connecting...” yazıp beklerse ESP32\'deki <b>BOOT</b> tuşuna basılı tutun'],
    ['Son', 'İsterseniz USB kontrol paneli açılır', 'Enter'],
])}
<div class="uyari"><b>Windows uyarısı:</b> “Windows bilgisayarınızı korudu” çıkarsa <b>Ek bilgi → Yine de çalıştır</b>. ESP32 bulunamazsa USB sürücüsü gerekir: kartın üzerindeki çip CP2102 ise <i>Silicon Labs CP210x</i>, CH340 ise <i>WCH CH340</i> sürücüsünü kurun.</div>
<p>Hata alırsanız ekranın görüntüsünü alın; düzeltilmiş kurulum dosyası bir sonraki sürüm numarasıyla (V8, V9 …) gelir. Eski sürümler <code>ROBOT KOL\\yedekler\\eski_surumler</code> içinde saklanır.</p>

<h2 style="margin-top:20px">8. PS4 kolunu eşleştirme</h2>
<p>PS4 kolu yalnızca kayıtlı “ana cihaz” adresine bağlanır. Bu adresi koldan okuyup ESP32 koduna yazarız (veya kola kendi adresimizi yazarız).</p>
<ol>
  <li>Bilgisayara <b>SixaxisPairTool</b> programını indirip kurun.</li>
  <li>PS4 kolunu bilgisayara <b>USB kabloyla</b> takın. Program kolu tanır ve “Current Master” adresini gösterir.</li>
  <li><b>Seçenek A:</b> Gösterilen adresi not edin. <b>Seçenek B:</b> “Change Master” kutusuna kendi adresinizi yazın (ör. <code>a0:b1:c2:d3:e4:f5</code>) ve <b>Update</b>'e basın.</li>
  <li>Bu adresi kurulum dosyası sorduğunda girin. Daha sonra değiştirmek için <code>ROBOT KOL\\ayarlar.txt</code> içindeki <code>PS4_MAC=</code> satırını düzenleyip .bat'ı tekrar çalıştırın.</li>
  <li>Kolu USB'den çıkarın, ESP32 açıkken <b>PS</b> tuşuna basın. Işık çubuğu <b>mavi</b> yanarsa bağlantı tamam (hız kademesi: yeşil %25, mavi %50, kırmızı %100).</li>
</ol>
<div class="ipucu">Kol daha önce bir PS4 konsoluna bağlıysa, konsol yakınken kol ona bağlanmaya çalışabilir. Deneme sırasında konsolu kapalı tutun.</div>
</section>
""")

# ---------------- 9 Servo ortalama ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>9. Servoları ortalama (montajdan önce!)</h2>
<p>Servo kolunu (horn) mile rastgele takarsanız, kol ilk açıldığında servolar “başlangıç” açısına gidip parçaları birbirine dayayabilir. Bunu önlemek için servolar başlangıç açısındayken kollarını takarız. Bizim kodumuz açılışta bunu kendiliğinden yapar:</p>
<div class="iki">
<div>{sekil(S.servo_ortala(), 'Şekil 2 – 90° konumunda servo kolu')}</div>
<div>
<ol>
  <li>Bölüm 6'daki bağlantıları yapın, servolar <b>henüz kola takılmamış</b> (masada serbest) olsun.</li>
  <li>Kodu yükleyin (bölüm 7), sonra güç kaynağını prize takın.</li>
  <li>ESP32 açılırken her servo sırayla başlangıç açısına gider: eksen 1–5 <b>90°</b>, kıskaç <b>60°</b>.</li>
  <li>Gücü kesin. Servo millerini <b>çevirmeden</b> her servoya yazıyla eksen numarasını yazın (bant + kalem).</li>
  <li>Montajda servo kolunu, ilgili parça Şekil 3'teki “başlangıç duruşu”nda olacak şekilde takın.</li>
</ol>
</div>
</div>
<h3>Başlangıç duruşu (tüm servolar 90°)</h3>
{tablo(['Eksen', 'Başlangıçta parça nasıl durmalı'], [
    ['1 Taban', 'Kol tam karşıya (öne) bakıyor'],
    ['2 Omuz', 'Üst kol dik (yukarı) duruyor'],
    ['3 Dirsek', 'Ön kol üst kola dik (yatay öne)'],
    ['4 Bilek eğimi', 'Bilek ön kolla aynı doğrultuda'],
    ['5 Bilek dönüşü', 'Kıskaç parmakları yatay (sağ-sol açılır)'],
    ['6 Kıskaç (60°)', 'Kıskaç yarı açık'],
])}
<div class="uyari">Servo milinin diş yapısı yüzünden kol tam istediğiniz açıya oturmayabilir; en yakın dişe takın. Kalan küçük farkı bölüm 11'deki kalibrasyonla düzeltirsiniz.</div>
</section>
""")

# ---------------- 10 Mekanik montaj ----------------
ADIMLAR = [
    ('Taban gövdesi ve taban servosu (Eksen 1)', """<ol>
      <li>Taban gövdesini zemin plakasına M4 vidalarla sabitleyin.</li>
      <li>Rulmanları (608ZZ) yuvalarına bastırın.</li>
      <li>MG996R'yi (K0) gövdeye yerleştirip M3 vidalarla sıkın. Kablosunu gövdenin kablo deliğinden çıkarın.</li>
    </ol>"""),
    ('Döner tabla', """<ol>
      <li>Metal servo kolunu (25T) taban servosuna, kol <b>öne bakacak</b> şekilde takın ve ortadaki vidayı sıkın.</li>
      <li>Döner tablayı servo koluna M3 vidalarla bağlayın; tabla rulmanların üstüne otursun.</li>
      <li>Tablayı elle zorlamadan çevirin: takılma olmamalı.</li>
    </ol>"""),
    ('Omuz yatağı ve omuz servosu (Eksen 2)', """<ol>
      <li>Omuz yatağını döner tablaya vidalayın.</li>
      <li>En güçlü servoyu (K1) yatağa takın. Kablosunu tablanın ortasından aşağı indirin (dönüşte dolanmasın).</li>
    </ol>"""),
    ('Üst kol ve dirsek servosu (Eksen 3)', """<ol>
      <li>Üst kolu omuz servosunun metal koluna, kol <b>dik</b> duracak şekilde bağlayın.</li>
      <li>Diğer taraftaki serbest mili (varsa) rulman / vida ile destekleyin.</li>
      <li>Dirsek servosunu (K2) üst kolun ucuna takın.</li>
    </ol>"""),
    ('Ön kol ve bilek eğim servosu (Eksen 4)', """<ol>
      <li>Ön kolu dirsek servosuna, <b>yatay öne</b> bakacak şekilde bağlayın.</li>
      <li>MG90S'i (K3) ön kolun ucundaki bilek gövdesine takın.</li>
      <li>Servo uzatma kablolarını kol boyunca kablo klipsleriyle sabitleyin.</li>
    </ol>"""),
    ('Bilek dönüşü (Eksen 5)', """<ol>
      <li>Bilek dönüş adaptörünü bilek eğim servosuna takın.</li>
      <li>İkinci MG90S'i (K4) adaptöre yerleştirin; kıskacı döndürecek mil dışa baksın.</li>
    </ol>"""),
    ('Kıskaç (Eksen 6)', """<ol>
      <li>Kıskaç gövdesine üçüncü MG90S'i (K5) takın.</li>
      <li>Dişlileri ve parmakları birleştirin; servo 60°'deyken kıskaç <b>yarı açık</b> olsun.</li>
      <li>Kıskaç gövdesini bilek dönüş servosuna bağlayın.</li>
      <li>Tüm kabloları spiral toplayıcıyla toplayıp, kol her yöne dönerken gergin olmayacak kadar boşluk bırakın.</li>
    </ol>"""),
]
govde = ''.join(adim(i + 1, b, S.kol(i + 1, i + 1, True, 230), g) for i, (b, g) in enumerate(ADIMLAR))
parcalar.append(f"""
<section class="sayfa">
<h2>10. Mekanik montaj</h2>
<p>Her çizimde <b style="color:#2563eb">mavi</b> parça o adımda eklenen parçadır; gri parçalar önceki adımlarda takılmıştır. Vidaları önce gevşek takın, hepsi yerine oturunca sıkın. Plastikte vidaları fazla sıkmayın; diş yalanır.</p>
{govde}
<div class="ipucu"><b>Elektronik kutusu:</b> ESP32 ve PCA9685'i elektronik kutusuna yerleştirip tabanın arkasına sabitleyin. USB girişine erişebildiğinizden emin olun.</div>
</section>
""")

# ---------------- 11 Kalibrasyon ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>11. İlk çalıştırma ve kalibrasyon</h2>
<div class="tehlike"><b>İlk açılışta</b> elinizi güç kaynağının fişinde tutun. Bir servo uğulduyor, titriyor veya parçayı zorluyorsa hemen fişi çekin.</div>
<h3>İlk test</h3>
<ol>
  <li>Kolun etrafını boşaltın; kol tam uzandığında hiçbir şeye çarpmasın.</li>
  <li>Gücü verin. Servolar sırayla başlangıç duruşuna gelir.</li>
  <li>PS4 kolunu bağlayın, <b>yön ←</b> ile hızı <b>%25</b>'e (yeşil ışık) indirin.</li>
  <li>Her ekseni tek tek, az az hareket ettirin. Yönü ve uç noktaları gözleyin.</li>
</ol>
<h3>Kodda ayarlanacaklar</h3>
<p>Dosya: <code>ROBOT KOL\\RobotKol_PS4\\RobotKol_PS4.ino</code> içindeki eksen tablosu. Değiştirdikten sonra .bat'ı tekrar çalıştırın (eski hali yedeklenir).</p>
<pre style="background:#f1f5f9;border-radius:8px;padding:10px;font-size:8.5pt;font-family:'DejaVu Sans Mono',monospace;break-inside:avoid">// isim          kn  min   max  home  hız  yön  usMin usMax
{{"Taban",        0,   0, 180,   90,  90,  +1,  500, 2500}},
{{"Omuz",         1,  15, 165,   90,  60,  +1,  500, 2500}},</pre>
{tablo(['Sorun', 'Hangi değer', 'Ne yapmalı'], [
    ['Çubuğu ileri itince eksen ters yöne gidiyor', '<code>yön</code>', '<code>+1</code> ise <code>-1</code> yapın'],
    ['Eksen bir uçta parçaya dayanıyor / servo uğulduyor', '<code>min</code> / <code>max</code>', 'O uçtaki sınırı 5–10° içeri çekin'],
    ['Başlangıç duruşu biraz yamuk', '<code>home</code>', 'Birkaç derece artırıp azaltın (ör. 90 → 86)'],
    ['Eksen çok hızlı / sarsıntılı', '<code>hız</code>', 'Değeri düşürün (ör. 90 → 60)'],
    ['Servo 180° dönmüyor ya da uçlarda titriyor', '<code>usMin</code> / <code>usMax</code>', 'Titriyorsa 500→600, 2500→2400 yapın'],
    ['Kıskaç tam kapanmıyor / çok sıkıyor', 'Kıskaç <code>min</code> / <code>max</code>', 'Cismi tutunca servo uğulduyorsa sınırı daraltın'],
    ['Genel olarak daha yumuşak hareket', '<code>SMOOTHING</code>', '0,18 → 0,10 (daha yumuşak, biraz gecikmeli)'],
])}
</section>
""")

# ---------------- 12 Kullanım ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>12. Kullanım</h2>
<h3>PS4 kolu (Bluetooth)</h3>
{sekil(S.ps4(), 'Şekil 4 – PS4 kolu tuş düzeni')}
<p>Çubuk kolun <b>açısını değil hızını</b> belirler: ne kadar iterseniz o kadar hızlı döner, bırakınca kol olduğu yerde kalır. Bağlantı koparsa kol hemen durur.</p>
<h3>Bilgisayardan USB ile</h3>
<ol>
  <li>ESP32'yi USB ile bilgisayara bağlayın.</li>
  <li><code>ROBOT KOL\\KONTROL_PANELI.html</code> dosyasını <b>Chrome</b> veya <b>Edge</b> ile açın.</li>
  <li><b>USB ile bağlan</b> → ESP32'nin COM portunu seçin.</li>
  <li>Kaydırıcılarla, klavyeyle veya bilgisayara USB ile takılı PS4 koluyla kontrol edin.</li>
</ol>
{tablo(['Tuş', 'Görev', 'Tuş', 'Görev'], [
    ['Q / A', 'Taban', 'Y / H', 'Kıskaç kapat / aç'],
    ['W / S', 'Omuz', '1 / 2 / 3', 'Hız %25 / %50 / %100'],
    ['E / D', 'Dirsek', '0', 'Başlangıç pozisyonu'],
    ['R / F', 'Bilek eğimi', 'Boşluk', '<b>DURDUR</b>'],
    ['T / G', 'Bilek dönüşü', '', ''],
])}
<div class="uyari">Panel ve Arduino seri monitörü aynı anda açık olamaz (ikisi aynı COM portunu kullanır). Panel bağlanınca ESP32 yeniden başlayabilir; kol bir kez başlangıç duruşuna döner.</div>
</section>
""")

# ---------------- 13 Sorun giderme + 14 Güvenlik + 15 Kontrol listesi ----------------
parcalar.append(f"""
<section class="sayfa">
<h2>13. Sorun giderme</h2>
{tablo(['Belirti', 'Olası neden', 'Çözüm'], [
    ['Hiçbir servo hareket etmiyor', 'Servo gücü yok veya SDA/SCL ters', 'V+ – GND arası 5–6 V mi ölçün; GPIO21 = SDA, GPIO22 = SCL'],
    ['Servolar hareket edince ESP32 yeniden başlıyor', 'Servolar ESP32\'den besleniyor / adaptör zayıf', 'Servoları sadece adaptörden besleyin; 10 A adaptör ve 1000 µF kondansatör'],
    ['Servolar titriyor', 'Ortak toprak yok veya ince güç kablosu', 'ESP32 GND – PCA9685 GND bağlantısı; kalın kablo'],
    ['PS4 kolu bağlanmıyor (ışık yanıp sönüp kapanıyor)', 'MAC adresi yanlış', 'SixaxisPairTool\'daki adres = ayarlar.txt\'deki adres mi kontrol edin'],
    ['PS4 kolu konsola bağlanıyor', 'Konsol açık', 'Konsolu kapatın'],
    ['Kod yüklenmiyor “Connecting...”', 'ESP32 indirme moduna girmedi', 'BOOT tuşuna basılı tutun, “Connecting” geçince bırakın'],
    ['ESP32 bilgisayarda görünmüyor', 'Sürücü yok / şarj kablosu', 'CP210x veya CH340 sürücüsü; veri kablosu kullanın'],
    ['Kurulumda “not enough space”', 'Disk dolu', 'En az 4 GB boş alan açın; kurulum başka diske de kurabilir'],
    ['Kol bir yönde kendi kendine kayıyor', 'Çubuk merkezi kaymış', 'Kodda <code>STICK_DEAD</code> 12 → 18'],
    ['Omuz kolu kaldıramıyor', 'Servo torku yetmiyor', 'Omuza DS3218 (20 kg) takın, kolun ucunu hafifletin'],
])}
<h2 style="margin-top:18px">14. Güvenlik</h2>
<ul>
  <li>Kol çalışırken parmaklarınızı eklemlerin ve kıskacın arasına sokmayın.</li>
  <li>Kolu zemine sabitleyin; uzandığında devrilebilir.</li>
  <li>Bağlantıları değiştirirken güç kaynağını prizden çekin.</li>
  <li>Adaptör ve kablolar ısınıyorsa kullanımı durdurun; kablo kesitini kontrol edin.</li>
  <li>Bilgisayar panelinde <b>Boşluk</b> tuşu, PS4'te çubukları bırakmak kolu durdurur. Acil durumda fişi çekin.</li>
</ul>
</section>

<section class="sayfa">
<h2>15. Son kontrol listesi</h2>
<div class="iki">
<div>
<h3>Hazırlık</h3>
<ul class="kontrol">
  <li>Malzeme listesindeki her şey hazır</li>
  <li>Kol tasarımı (STL) seçildi, deneme baskısı uydu</li>
  <li>Tüm parçalar basıldı ve temizlendi</li>
  <li>En az 4 GB boş disk alanı var</li>
</ul>
<h3>Elektronik ve yazılım</h3>
<ul class="kontrol">
  <li>ESP32 ↔ PCA9685: 3V3, GND, SDA (21), SCL (22)</li>
  <li>Adaptör → V+ / GND, kondansatör takılı</li>
  <li>Multimetre: kısa devre yok, 5–6 V var</li>
  <li>Kurulum .bat dosyası hatasız bitti</li>
  <li>PS4 MAC adresi girildi, kol mavi ışıkla bağlandı</li>
</ul>
</div>
<div>
<h3>Montaj</h3>
<ul class="kontrol">
  <li>Servolar başlangıç açısında işaretlendi</li>
  <li>Taban, tabla, omuz, üst kol, ön kol, bilek, kıskaç takıldı</li>
  <li>Kablolar toplandı, dönüşte gerilmiyor</li>
  <li>Kol zemine sabitlendi</li>
</ul>
<h3>Çalıştırma</h3>
<ul class="kontrol">
  <li>%25 hızda tüm eksenler denendi</li>
  <li>Ters giden eksenlerin <code>yön</code> değeri düzeltildi</li>
  <li>Dayanan eksenlerin <code>min/max</code> sınırları daraltıldı</li>
  <li>USB kontrol paneli denendi</li>
</ul>
</div>
</div>
<div class="kutu" style="margin-top:20px">
<b>Klasör düzeni (Masaüstü\\ROBOT KOL)</b>
<table>
<tr><td><code>ROBOT_KOL_KURULUM_V7.bat</code></td><td>Kurulum ve güncelleme (çift tık)</td></tr>
<tr><td><code>ROBOT_KOL_KILAVUZ.pdf</code></td><td>Bu kılavuz</td></tr>
<tr><td><code>KONTROL_PANELI.html</code></td><td>Bilgisayardan USB kontrol</td></tr>
<tr><td><code>RobotKol_PS4\\RobotKol_PS4.ino</code></td><td>ESP32 kodu</td></tr>
<tr><td><code>ayarlar.txt</code></td><td>PS4 MAC adresi</td></tr>
<tr><td><code>SURUMLER.md</code></td><td>Sürüm geçmişi</td></tr>
<tr><td><code>yedekler\\</code></td><td>Eski dosyalar ve eski kurulum sürümleri</td></tr>
<tr><td><code>araclar\\</code></td><td>Arduino araçlarına kısayol</td></tr>
</table>
</div>
</section>
""")

html = f'<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Robot Kol Kılavuzu</title><style>{CSS}</style></head><body>{"".join(parcalar)}</body></html>'
open(HTML, 'w', encoding='utf-8').write(html)

js = f"""
const {{ createRequire }} = require('module');
const r = createRequire('/opt/node22/lib/node_modules/');
const {{ chromium }} = r('playwright');
(async () => {{
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://{HTML}');
  await p.pdf({{ path: {PDF!r}, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;color:#94a3b8;width:100%;text-align:center;font-family:Inter,sans-serif">6 Eksenli Robot Kol – Kılavuz V7 · Sayfa <span class=pageNumber></span> / <span class=totalPages></span></div>',
    margin: {{ top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' }} }});
  await b.close();
}})();
"""
subprocess.run(['node', '-e', js], check=True)
print('olusturuldu:', PDF)
