# PLAN.md — "Altın Saat Çiftliği" (Sinematik 2D Çiftlik Simülasyonu)

> Bu dosya projenin tek doğru kaynağıdır. Mimari kararlar, veri sözleşmeleri, ekonomi değerleri ve ilerleme burada tutulur.
> Sahibi: Beyin (baş mimar / sanat yönetmeni / proje yöneticisi). İşçiler bu dosyaya aykırı karar veremez; öneriyi raporla iletir.

---

## 0. İlerleme Durumu

| Aşama | Konu | Durum |
|---|---|---|
| 0 | İşçi ajanları + PLAN.md | ✅ Onaylandı |
| 1 | Temel motor, kamera, sinematik görsel altyapı, gün-gece | ✅ Onaylandı |
| 2 | Tarım ve toprak mekaniği | ✅ Onaylandı |
| 3 | Envanter, mağaza, pazar | ✅ Onaylandı |
| 4 | Hayvancılık | ✅ Onaylandı |
| 5 | Üretim binaları ve zincirleri + ilk çalışan (Çırak + eşek) | ✅ Onaylandı |
| 5b | Serbest yerleşim (inşa modu) + seviye sisteminin kaldırılması | ✅ Onaylandı |
| 6 | Ekonomi, banka, giderler, finans paneli, sözleşmeler | ✅ Onaylandı |
| 7 | Hava durumu, mevsimler, rastgele olaylar | ✅ Onaylandı |
| 8 | İşçiler, makineler, arazi genişletme, sera ve depolama | ✅ Tamamlandı (8 sim 0 hata + beyin duman testi) — onay bekleniyor |
| 9 | Ses, cilalama, sinematik geçişler, kayıt, denge | — |

### İşçi kadrosu (`.claude/agents/`; Aşama 4+ `model: sonnet`, kullanıcı kararı)
| Ajan (model: sonnet — ekonomik mod) | Alan |
|---|---|
| engine-dev | Phaser yapılandırması, sahneler, ana döngü, EventBus, GameState, SaveSystem, kamera |
| visual-dev | Gökyüzü, paralaks, ışık/color grading, gölgeler, hava FX, parçacıklar, post-process, prosedürel dokular |
| gameplay-dev | Tarım, toprak, hayvanlar, üretim zincirleri, işçiler, makineler, envanter, ilerleme |
| economy-dev | Pazar, dinamik fiyat, satış kanalları, mağaza, giderler, banka, finans defteri |
| ui-dev | DOM tabanlı HUD/paneller, dokunmatik kontroller, grafikler, bildirimler |
| qa-tester | Derleme, Playwright ile masaüstü+mobil test, FPS/bellek ölçümü, hata raporu (kod düzeltmez) |

---

## 0b. Ekonomik Çalışma Düzeni (Aşama 3'ten itibaren, kullanıcı isteği)
- Aşama başına en fazla 2 işçi; küçük işleri beyin doğrudan yapar.
- İşçiler ekran görüntüsü döngüsü yapmaz (en fazla 1 kontrol karesi); headless FPS ölçümü yapılmaz.
- QA: aşama sonunda tek tur, kısa duman testi + kritik akışlar. Ayrı regresyon turu yalnızca yüksek önemli hata çıkarsa.
- Oynanabilir sürüm her aşama sonunda aynı Artifact adresinde güncellenir (`npm run play`).

## 1. Teknik Altyapı

- **Vite + Phaser 3 (3.80.x) + JavaScript (ES modülleri)**. TypeScript yerine JS + JSDoc tip yorumları: işçiler arası hız ve sade derleme için.
- Proje klasörü: **`ciftlik/`** (depo kökündeki eski HTML oyunlarından ayrı tutulur).
- Harici görsel/ses dosyası yok. Grafik: Phaser `Graphics` → `generateTexture`, `CanvasTexture`, gürültü fonksiyonları, GLSL PostFX. Ses: Web Audio API.
- Renderer: WebGL (PostFX için). Canvas'a düşerse efektler kapanır, oyun çalışmaya devam eder.
- Hedef: 60 FPS. Mobilde DPR en fazla 2, kalite seviyesi otomatik (high / medium / low).

### Klasör yapısı
```
ciftlik/
  index.html            # #game (canvas) + #ui (DOM katmanı)
  vite.config.js
  src/
    main.js             # Phaser.Game yapılandırması, sistemlerin kaydı, window.__game
    core/
      EventBus.js       # on/off/emit, tek global örnek
      GameState.js      # createInitialState(), state şeması, sürüm
      SaveSystem.js     # localStorage, sürüm göçü, otomatik kayıt
      SystemRegistry.js # sistemlerin sıralı update'i (sabit adım)
      Rng.js            # tohumlu rastgele (mulberry32), state.rngSeed
      constants.js      # TILE_W, TILE_H, MIN_PER_DAY, vb.
    systems/            # SİMÜLASYON — Phaser'a bağımlı değil (Node'da test edilebilir)
      TimeSystem.js  WeatherSystem.js  FarmSystem.js  AnimalSystem.js
      ProductionSystem.js  InventorySystem.js  MarketSystem.js  ContractSystem.js
      EconomySystem.js  BankSystem.js  WorkerSystem.js  EventSystem.js  ProgressionSystem.js
    data/               # TÜM denge değerleri
      crops.js animals.js recipes.js items.js buildings.js machines.js
      prices.js shop.js economy.js events.js workers.js land.js palette.js
    scenes/
      BootScene.js      # prosedürel dokuların üretimi, yükleme ekranı
      WorldScene.js     # dünya render + giriş
      UIScene.js        # (yalnızca canvas tarafı gereken UI efektleri; asıl UI DOM'da)
    render/             # GÖRSEL — state'i okur, asla yazmaz
      Renderer.js       # katmanların kurulumu ve güncellenmesi
      CameraDirector.js # takip, zoom, sinematik çekimler
      SkyLayer.js ParallaxLayer.js GroundLayer.js ShadowSystem.js
      Lighting.js       # color grading + ışık kaynakları
      WeatherFX.js Particles.js
      postfx/  GradePipeline.js BloomPipeline.js CinematicPipeline.js (vinyet+gren+letterbox)
      textures/ noise.js terrain.js plants.js animals.js buildings.js props.js
    world/              # oyun nesnelerinin görsel temsilleri (CropView, AnimalView, BuildingView)
    ui/                 # DOM UI: hud, panels, toast, touch, charts, strings.js, styles.css
    audio/              # AudioEngine.js + prosedürel ses üreticileri (Aşama 9)
  tools/
    sim-economy.mjs     # Node ile ekonomi simülasyonu
  qa/                   # qa-tester ekran görüntüleri ve raporları
```

### Katman kuralı (en önemli mimari karar)
```
 data/  ──►  systems/ (saf simülasyon, GameState'i değiştirir)  ──emit──►  EventBus
                ▲                                                         │
                │ komut olayları (ui:*, input:*)                          ▼
             ui/ (DOM)  ◄────────── okur ───────────  GameState  ◄── okur ── render/, world/
```
- **Simülasyon (systems/) Phaser'ı import etmez.** Bu sayede ekonomi ve tarım Node'da hızlı simüle edilip dengelenebilir.
- **Render ve UI state'e yazmaz.** Oyuncu eylemleri komut olayı olarak gider, ilgili sistem işler.
- Tüm para hareketleri `EconomySystem.transact()` üzerinden geçer → `finance.ledger`.

### Ana döngü
- Phaser `update(time, delta)` → `SystemRegistry.tick(delta)`.
- Oyun zamanı **sabit adımla** ilerler: 1 simülasyon adımı = 1 oyun dakikası. Gerçek süre: 600 sn / 1440 dk = **0,4167 sn/oyun dakikası** (1x).
- Hız: ⏸ 0x, ▶ 1x, ⏩ 2x, ⏭ 4x; "Sabaha geç" (gece 22:00'den sonra uyku → 06:00).
- Kare başına en fazla 240 simülasyon adımı (kare atlama koruması).
- Sistem sırası: Time → Weather → Event → Farm → Animal → Production → Worker → Market → Contract → Bank → Economy → Progression.
- Render her karede, interpolasyonla (`time.minuteFraction`).

### Sistem arayüzü (sözleşme)
```js
// Her sistem bu şekli uygular
export default {
  id: 'farm',
  init(state, bus) {},            // olay aboneliği
  tickMinute(state, bus, ctx) {}, // her oyun dakikası (hafif tutulmalı)
  onHour(state, bus, ctx) {},     // her oyun saati
  onDay(state, bus, ctx) {},      // her gün 00:00
  onSeason(state, bus, ctx) {},   // mevsim değişimi
};
// ctx = { rng, data, now: {day, hour, minute, season, year} }
```

### EventBus olay sözleşmesi (çekirdek)
| Olay | Yük (payload) | Yayan |
|---|---|---|
| `time:minute` / `time:hour` / `time:day` / `time:season` | `{day, hour, season, year}` | TimeSystem |
| `time:speed` | `{speed}` | UI → TimeSystem |
| `weather:changed` | `{type, intensity, wind}` | WeatherSystem |
| `farm:action` | `{type:'plow'|'plant'|'water'|'fertilize'|'treat'|'weed'|'harvest', tileId, itemId?}` | UI/giriş → FarmSystem |
| `farm:changed` | `{tileIds}` | FarmSystem |
| `inventory:changed` | `{itemId, delta}` | InventorySystem |
| `market:sell` | `{itemId, quality, qty, channel}` | UI → MarketSystem |
| `shop:buy` | `{itemId, qty}` | UI → MarketSystem |
| `money:changed` | `{amount, balance, category}` | EconomySystem |
| `event:started` / `event:ended` | `{id, title, text, effects}` | EventSystem |
| `camera:cinematic` | `{target:{x,y}, zoom, duration, letterbox:boolean, reason}` | herkes → CameraDirector |
| `toast` | `{text, kind:'info'|'good'|'bad'|'event'}` | herkes → UI |
| `save:request` / `save:done` | `{}` | herkes / SaveSystem |

### GameState şeması (JSON-serileştirilebilir, `version` alanlı)
```js
{
  version: 1,
  rngSeed: 123456,
  time: { totalMinutes: 360, speed: 1 },         // gün/saat/mevsim türetilir
  weather: { type: 'clear', intensity: 0, wind: 0.2, forecast: [...3 gün], puddles: 0, snowCover: 0 },
  player: { name: 'Çiftçi', level: 1, xp: 0, reputation: 10 },
  finance: { money: 5000, ledger: [], loans: [], dailySummary: [] },
  inventory: { capacity: 60, items: { 'seed_potato': [{q:'B', qty:10, age:0}] } },
  land: { parcels: [{ id:'P1', owned:true }, ...] },
  tiles: { 'x,y': { state:'grass'|'plowed'|'planted', moisture, n, p, k, ph,
                    history:['potato', ...], crop:{ id, plantedAt, stage, growth, health,
                    careScore, pest, disease, weeds, watered } } },
  animals: [{ id, type, name, ageDays, hunger, thirst, health, happiness, productTimer, buildingId }],
  buildings: [{ id, type, x, y, condition, queue: [...] }],
  machines: [{ id, type, condition, fuel }],
  workers: [{ id, name, skills:{farm, animal, machine}, wage, speed, task }],
  market: { prices: { itemId: { mult, saturation } }, activeEvents: [] },
  contracts: [{ id, itemId, qty, minQuality, reward, deadlineDay, penalty }],
  stats: { harvested:{}, sold:{}, earned:0, spent:0 },
  settings: { quality: 'auto', sound: 0.8, music: 0.5 },
}
```

### Kayıt sistemi
- Anahtar: `altin-saat-ciftligi:save:v1` (+ `:backup` önceki kayıt).
- Otomatik kayıt: her oyun saatinde, `visibilitychange` (hidden) ve `pagehide`'da.
- Yükleme: JSON parse + `version` kontrol + `migrations[v]()` zinciri; hata olursa yedeğe, o da bozuksa yeni oyun (ve toast ile bildir).
- **Şema temizleme (`sanitize`)**: her yüklemede state, `createInitialState()` referansıyla derin doğrulanır (null/yanlış tip → varsayılan, sayılar sonlu ve sınırlı). Onarım olursa toast. Kurulumda istisna → kayıt `:corrupt` anahtarına karantinaya alınır, yeni oyun açılır.
- **Ayarlar ayrı anahtarda**: `altin-saat-ciftligi:settings` (kalite/ses/müzik). "Yeni oyun" ayarları korur.
- **Kural (Aşama 2+)**: Her yeni sistem kendi state alanı için bir doğrulayıcı (`validate(state, onFix)`) sağlar ve SaveSystem'in sanitize kancasına kaydeder; dizi elemanları (animals, ledger, tiles…) o sistemin sorumluluğundadır.

### Hata ayıklama kancası (qa-tester için)
`window.__game = { state, bus, debug: { setTime(hour), skip(minutes), setSpeed(x), setWeather(type), addMoney(n), cinematic(), quality(level) } }` — yalnızca `import.meta.env.DEV` veya `?debug=1` iken.

---

## 2. Sanat Yönetimi — "Sinematik 2D"

### Bakış açısı ve dünya
- **Diyorama tarzı 3/4 eğik görünüm** (izometrik değil): düz dikdörtgen ızgara, üstte ufuk çizgisi. Ufkun gerisinde paralaks katmanlar, önde zemin düzlemi ve tarlalar, en önde rüzgârda sallanan çimler.
- Karo: **64 × 44 px** (basık oran derinlik hissi verir). Nesneler **y değerine göre sıralanır**.
- Dünya: 80 × 24 karo (5120 × 1056 px). Başlangıç parseli P1: 16 × 12 karo; 24 karo sürülmüş hâlde başlar.
- Şekil dili: yumuşak, yuvarlak hatlar; düz renk + gradyan + hafif doku gürültüsü; ince koyu kontur yok (animasyon filmi hissi), bunun yerine kenar ışığı (rim light) ve gölge ile hacim.

### Katman sırası (depth) ve paralaks faktörü
| Depth | Katman | Paralaks |
|---|---|---|
| 0 | Gökyüzü gradyanı (shader veya büyük gradyan doku) | 0 |
| 5 | Yıldızlar, ay, güneş, güneş halesi | 0.02 |
| 10 | Uzak dağlar (2 ton, atmosferik perspektif: uzak = maviye yakın, düşük kontrast) | 0.10 |
| 15 | Bulutlar (yavaş kayar, rüzgârla) | 0.18 |
| 20 | Tepeler | 0.30 |
| 25 | Orman şeridi (ağaçlar rüzgârda salınır) | 0.55 |
| 30 | Sis bandı (sabah yoğun) | 0.70 |
| 40 | Zemin: çim/toprak dokusu, yollar, tarla karoları, ıslaklık | 1.0 |
| 45 | Gölgeler (güneşe göre) + bulut gölgeleri (kayan yumuşak lekeler) | 1.0 |
| 50 | Ekinler, hayvanlar, binalar, ağaçlar (y-sıralı) | 1.0 |
| 70 | Hava parçacıkları (yağmur, kar), toz, ateş böcekleri | 1.0 |
| 80 | Ön plan çimleri ve çiçekler (kenarlarda) | 1.15 |
| 90 | Işık katmanı: ambient tint (MULTIPLY) + nokta ışıkları (ADD: pencere, fener) | — |
| PostFX | Grade → Bloom → Vinyet + Film greni + Letterbox | — |

### Gün içi renk paleti (color grading anahtar kareleri, aralar yumuşak interpolasyon)
| Saat | An | Gök üst | Gök alt (ufuk) | Ambient tint | Güneş/Işık | Sis | Gölge |
|---|---|---|---|---|---|---|---|
| 04:30 | Gece sonu | `#0b1026` | `#2a2f55` | `#3a4470` | ay `#9fb4ff` | 0.30 | ay, çok zayıf |
| 06:30 | Gün doğumu | `#3b4a8a` | `#ff9e6b` | `#d9a48e` | `#ffb37a` | **0.70** | çok uzun, 0.20 |
| 09:00 | Sabah | `#6fa8dc` | `#d6ecf7` | `#f4f0e6` | `#fff1d6` | 0.15 | uzun, 0.30 |
| 13:00 | Öğle | `#4f95e0` | `#c4e3ff` | `#ffffff` | `#ffffff` | 0 | kısa, 0.38 |
| 17:30 | Altın saat | `#5b7fc4` | `#ffc27a` | `#ffdca6` | `#ffb347` | 0.10 | uzun, 0.32, sıcak |
| 19:30 | Gün batımı | `#2c2f6b` | `#ff6f61` | `#d98c7c` | `#ff7a4d` | 0.20 | çok uzun, 0.18 |
| 21:00 | Alacakaranlık | `#141a3d` | `#4a3a6b` | `#6c6ca6` | — | 0.25 | yok |
| 00:00 | Gece | `#050816` | `#121a3a` | `#2f3b6e` | ay `#9fb4ff` | 0.30 | ay, 0.10 |

**Mevsim grading'i** (gün paletinin üstüne): İlkbahar: yeşiller +%10 doygunluk, taze; Yaz: sıcak (+kırmızı), yüksek kontrast; Sonbahar: ton turuncuya kayar, ağaçlar turuncu/kızıl; Kış: doygunluk −%35, mavi gölgeler, kar örtüsü.

### Gölge kuralı
- Güneş açısı saate göre: doğu (06:00) → tepe (13:00) → batı (20:00).
- Gölge = nesne silüetinin yumuşatılmış (blur'lu) koyu kopyası, tabandan **güneşin tersi yönde** eğilir (skew) ve uzar: `length = clamp(1 / tan(elevation), 0.3, 4)`; `alpha = 0.38 × güneşYoğunluğu × (1 − bulutluluk×0.6)`.
- Bulutlu/yağmurlu havada gölgeler neredeyse kaybolur; gece ay gölgesi çok zayıf ve mavimsi.

### Atmosfer ve parçacıklar
- Sabah sisi: 05:30–09:00 arası, alçak katmanlarda yatay kayan yumuşak sis bantları.
- Toz/polen zerreleri: gündüz, ışık huzmesinde parlayan (ADD) yavaş zerreler.
- Ateş böcekleri: yaz ve ilkbahar geceleri, 20:30–04:00, bloom ile parlar.
- Rüzgâr: global `wind` (0–1) → ekin/ağaç/çim salınım genliği ve frekansı, bulut hızı, yağmur eğimi.
- Yağmur: eğik çizgi parçacıkları + zeminde sıçrama halkaları + birikinti dokusu + ıslak zemin parlaması (zemin koyulaşır, ışık kaynaklarında speküler yansıma).
- Fırtına: yoğun yağmur + şimşek (ekran flaşı + 0,5–2 sn gecikmeli gök gürültüsü) + güçlü rüzgâr.
- Kar: yavaş, salınımlı tanecikler; zeminde birikim (`snowCover`), çatılarda beyaz örtü.

### Kamera dili
- Yumuşak takip (lerp 0.08), zoom 0.5x–2x (tekerlek/pinch), yumuşak zoom geçişi.
- Sinematik anlar (`camera:cinematic`): hasat, yeni bina açılışı, ilk hayvan, mevsim geçişi, olaylar → letterbox bantları (ekran yüksekliğinin %10'u) kayarak girer, kamera yavaş pan + hafif zoom-in, 2–4 sn sonra geri döner.
- Açılış sahnesi: siyah bantlarla, ufuktan tarlaya yavaş inen kamera (gün doğumunda), başlık yazısı solarak belirir.

### Post-process
- **Bloom**: parlak alanlar (güneş, ateş böceği, pencere ışığı) — eşik 0.75, yumuşak.
- **Vinyet**: 0.25–0.35 (gece daha güçlü).
- **Film greni**: çok hafif (0.04), zamanla değişen gürültü.
- **Letterbox**: açılış ve ara sahnelerde.
- Mobil "low" kalitede bloom kapalı, gren kapalı, parçacık sayısı %40.

### UI stili
- Yarı saydam koyu cam paneller (`rgba(18,20,28,0.55)` + `backdrop-filter: blur(10px)`), 14px yuvarlatma, sıcak krem metin `#f5ecd9`, vurgu rengi altın `#f2b84b`, pozitif `#7fd18b`, negatif `#ff7a6b`.
- Yazı tipi: sistem sans-serif (harici font yok). Paneller kaydırma + solma ile 220 ms'de açılır.
- HUD minimal: sol üst saat/gün/mevsim/hava, sağ üst para, alt orta araç çubuğu; geri kalan her şey açılıp kapanan panellerde.

---

## 3. Oyun Mekanikleri — Sistem Tasarımı

### Zaman ve takvim
- 1 gün = 600 gerçek saniye (1x). 1 mevsim = 28 gün. 1 yıl = 4 mevsim = 112 gün.
- **Finansal "ay" = 1 mevsim (28 gün)**. Hafta = 7 gün (kredi taksitleri, toptancı ödemeleri).
- Mevsimler: İlkbahar → Yaz → Sonbahar → Kış.

### Toprak modeli (her karo)
| Değer | Aralık | Not |
|---|---|---|
| `moisture` | 0–100 | Sulama +60 (en fazla 100), saatte −0,6 (yaz −1,0, yağmur +4/saat). <20 kuraklık stresi, >90 uzun süre → kök çürüğü riski |
| `n`, `p`, `k` | 0–100 | Başlangıç 55/50/50. Her hasat ürüne göre tüketir. Gübre ekler |
| `ph` | 4.5–8.5 | Başlangıç 6,5. İdeal 6,0–7,0. Kireç +0,4; NPK −0,1 |
| `history` | son 3 ürün | Aynı ürün art arda: verimlilik çarpanı ×0,85 (2. kez), ×0,70 (3. kez). Baklagil (fasulye) sonrası N +15 |

**Büyüme formülü (her oyun saati):**
`growth += (1 / büyümeSaati) × nemFaktörü × besinFaktörü × phFaktörü × mevsimFaktörü × sağlık`
- nemFaktörü: 40–85 → 1,0; 20–40 → 0,6; <20 → 0,2 (+sağlık kaybı)
- besinFaktörü: ürünün NPK ihtiyacına göre ortalama karşılanma oranı (0,5–1,1)
- Görsel aşamalar: **tohum → filiz → genç bitki → olgunlaşan → hasada hazır** (+ solgun/ölü varyantlar). Hasattan 3 gün sonra çürüme başlar.
- Don: kış dışında ani don olayı veya mevsim dışı kalan ürün → sağlık −40. Kuraklık: nem <20 iken saatte sağlık −1.
- Zararlı / hastalık / yabani ot: günlük olasılık (nem, sıcaklık, ekim nöbeti ihlali artırır). Kimyasal ilaç: %95 etkili, "organik" etiketi düşer. Organik sprey: %65 etkili, organik ürün pazarda +%15.
- **Kalite (A/B/C):** `careScore` (sulama düzeni, besin, sağlık, zararlı süresi ortalaması, 0–100). ≥90 → A, 55–89 → B, <55 → C.

### Hayvan modeli
- Değerler 0–100: açlık, susuzluk, sağlık, mutluluk. Açlık/susuzluk saatte azalır; 0'a yakınsa sağlık düşer.
- Mutluluk: temiz ahır, yeterli alan, beslenme, mevsim (kışın ısıtma), okşama. Üretim miktarı ve kalitesi mutluluğa bağlı.
- Ahır kirliliği günlük artar; >60 hastalık riski. Veteriner: muayene/tedavi.
- Yaşam: yavru → yetişkin (üretken) → yaşlı (üretim azalır). Yeterli mutlulukta çift varsa üreme şansı; kapasite sınırlı.

### Üretim makineleri
- Her makinede: kuyruk (en fazla 3 iş), süre, elektrik tüketimi (kWh/iş), `condition` (her iş −2; <50 → %30 yavaş, <20 → durur). Bakım = satın alma fiyatının %4'ü, condition'ı 100 yapar.

---

## 4. Ekonomi Dengesi (Taslak v0.1)

> Para birimi: **₺**. Tüm değerler `src/data/*.js` içinde tutulacak ve Node simülasyonuyla ayarlanacak. Hedef his: ilk mevsim dar ama umutlu; ilk yılın sonunda mandıra + kümes + ahır; 2. yılda makineleşme.

### Başlangıç
| Kalem | Değer |
|---|---|
| Başlangıç parası | **5.000 ₺** |
| Arazi | P1 parseli (16×12 karo), 24 karo sürülmüş |
| Envanter | 10 marul tohumu, 6 patates tohumu, 10 kompost |
| Aletler | Çapa, sulama kovası, el tırpanı (ücretsiz) |
| Binalar | Küçük ev, kuyu (ücretsiz manuel sulama) |
| İtibar / Seviye | 10 / 1 |

### Ürünler (1 karo başına; satış fiyatı B kalite, pazar yeri baz fiyatı)
| Ürün | Mevsim | Tohum ₺ | Süre (gün) | Verim | Birim satış ₺ | Karo başı brüt ₺ | ₺/gün/karo | Not |
|---|---|---|---|---|---|---|---|---|
| Marul | İlkbahar | 15 | 4 | 1 | 45 | 45 | 7,5 | Başlangıç ürünü, hızlı |
| Patates | İlkbahar | 25 | 6 | 2 | 50 | 100 | 12,5 | Güvenilir |
| Çilek | İlkbahar | 60 | 8 → her 3 gün | 3 | 18 | 54/hasat | ~14 | Tekrar verir, reçel girdisi |
| Buğday | İlkbahar, Sonbahar | 8 | 7 | 4 | 12 | 48 | 5,7 | Düşük emek, un zinciri, biçerdöverle ×1,25 |
| Fasulye | İlkbahar, Yaz | 20 | 6 | 2 | 32 | 64 | 7,3 | Baklagil: toprağa N +15 |
| Domates | Yaz | 40 | 8 → her 3 gün | 3 | 20 | 60/hasat | ~16 | Kuraklık olaylarına duyarlı fiyat |
| Mısır | Yaz | 30 | 10 | 2 | 55 | 110 | 8 | Hayvan yemi (1 mısır = 2 porsiyon) |
| Karpuz | Yaz | 80 | 12 | 1 | 320 | 320 | 20 | Yüksek su ihtiyacı, riskli |
| Ayçiçeği | Yaz | 20 | 8 | 1 | 90 | 90 | 8,75 | Arı kovanına bal bonusu |
| Kabak | Sonbahar | 60 | 11 | 1 | 260 | 260 | 18 | Festival yarışma ürünü |
| Havuç | Sonbahar | 12 | 5 | 2 | 28 | 56 | 8,8 | Ucuz, hızlı |
| Üzüm | Sonbahar | 70 | 10 → her 4 gün | 3 | 25 | 75/hasat | ~15 | Reçel / meyve suyu |
| Ispanak | Kış (açık alan) | 18 | 6 | 2 | 30 | 60 | 7 | Soğuğa dayanıklı tek açık alan ürünü |

**Kalite çarpanı:** A ×1,40 · B ×1,00 · C ×0,65. Organik etiketi +%15.

### Tarım girdileri (mağaza)
| Ürün | Fiyat ₺ | Etki |
|---|---|---|
| Kompost (organik) | 10 | N+10 P+6 K+6, yavaş (3 günde) |
| NPK gübre | 35 | N+25 P+20 K+20, anında, pH −0,1 |
| Kireç | 25 | pH +0,4 |
| Kimyasal ilaç | 45 | Zararlı/hastalık %95, organik etiketi düşer |
| Organik sprey (neem) | 25 | %65 etkili |
| Gelişmiş sulama kovası | 600 | 3×3 alan tek seferde |

### Hayvanlar
| Hayvan | Fiyat ₺ | Yem/gün ₺ | Ürün | Sıklık | Birim ₺ (B) | Net ₺/gün | Bina |
|---|---|---|---|---|---|---|---|
| Tavuk | 350 | 4 | Yumurta | 1/gün | 18 | ~14 | Kümes |
| Keçi | 1.800 | 15 | Keçi sütü | 1/gün | 70 | ~55 | Ahır |
| Koyun | 2.200 | 15 | Yün | 3 günde 1 | 200 | ~52 | Ahır |
| İnek | 4.000 | 31 | Süt | 1/gün | 130 | ~99 | Ahır |
| Arı kovanı | 1.200 | 3 (bakım) | Bal | 5 günde 1 (kış yok) | 280 | ~53 | Açık alan |

- Yem: Tavuk yemi çuvalı (10 porsiyon) 40 ₺; Saman balyası (10 porsiyon) 220 ₺. İnek 1,4, koyun/keçi 0,7, tavuk 1 (tavuk porsiyonu) porsiyon/gün. Kendi mısırını yedirerek yem gideri ~%60 düşer.
- Veteriner: muayene 150 ₺, tedavi 300 ₺. Ahır temizliği: elle ücretsiz veya işçiyle.
- Ömür: tavuk 4 yıl, keçi/koyun 6, inek 8 (oyun yılı). Yaşlılıkta üretim %50.

### Üretim zincirleri
| Makine (bina) | Fiyat ₺ | Tarif | Süre (saat) | Enerji kWh | Girdi değeri → Çıktı değeri |
|---|---|---|---|---|---|
| Mandıra | 9.000 | 3 süt → 1 peynir | 6 | 4 | 390 → **650** |
|  |  | 2 süt → 1 tereyağı | 3 | 2 | 260 → 360 |
|  |  | 1 süt → 1 yoğurt | 4 | 1 | 130 → 200 |
| Değirmen | 7.000 | 4 buğday → 1 un | 2 | 3 | 48 → 85 |
| Fırın | 5.000 | 1 un → 2 ekmek | 3 | 5 | 85 → 140 |
| Konserve atölyesi | 4.500 | 3 çilek → 1 çilek reçeli | 4 | 2 | 54 → 130 |
|  |  | 3 üzüm → 1 üzüm reçeli | 4 | 2 | 75 → 160 |
|  |  | 4 domates/üzüm → 2 meyve suyu | 2 | 2 | 80–100 → 2×70 |
| İplikhane | 6.000 | 2 yün → 1 iplik | 4 | 3 | 400 → 520 |
| Dokuma tezgâhı | 9.000 | 2 iplik → 1 kumaş | 8 | 6 | 1.040 → **1.450** |

Elektrik: **2,5 ₺/kWh**. Zincir uzadıkça marj artar ama makine yatırımı, süre ve bakım gerekir.

### Binalar ve genişleme
| Bina | Fiyat ₺ | Etki |
|---|---|---|
| Kümes | 1.500 | 8 tavuk |
| Ahır | 6.000 | 6 büyükbaş/küçükbaş; kışın ısıtma 6 kWh/gün |
| Silo | 4.000 | 300 porsiyon yem / tahıl, bozulma yok |
| Depo | 3.000 | Envanter +100 yuva |
| Soğuk hava deposu | 10.000 | Bozulmayı %80 yavaşlatır; 8 kWh/gün |
| Sera | 15.000 | 24 karo, mevsimsiz ekim, don/dolu yok; 5 kWh/gün kışın |
| Sulama sistemi | 5.000 / parsel | Otomatik sulama, şebeke suyu 0,8 ₺/karo/gün |
| Arazi P2 / P3 / P4 / P5 | 12.000 / 25.000 / 45.000 / 80.000 | Her biri 16×12 karo, seviye kilidi 3/6/10/14 |

### Makineler
| Makine | Fiyat ₺ | Etki | İşletme |
|---|---|---|---|
| Küçük traktör | 28.000 | Sürme/ekme 3×3 alan, hız ×4 | Yakıt 15 ₺/saat kullanım |
| Ekim makinesi (traktör eki) | 14.000 | Ekimi otomatikleştirir | — |
| Biçerdöver | 65.000 | Tahıl hasadı ×1,25 verim, çok hızlı | Yakıt 25 ₺/saat |
| Sağım makinesi | 12.000 | İnek/keçi sütü otomatik, süt kalitesi +1 sınıf şansı | 3 kWh/gün |

### İşçiler
| Kademe | Günlük maaş ₺ | Hız | Yetenek (1–5) | Not |
|---|---|---|---|---|
| Çırak | 90 | 0,6 | 1–2 | %10 hata (ör. sulamayı atlama) |
| Deneyimli | 170 | 1,0 | 2–4 | Bir uzmanlık alanı (tarım/hayvan/makine) |
| Usta | 300 | 1,5 | 4–5 | Bakım kalitesine +%10 (A kalite şansı) |
Her işçinin rastgele adı, yetenek dağılımı ve maaşı ±%15 değişir. Görev öncelikleri oyuncu tarafından atanır (sula / hasat / hayvan bakımı / makine).

### Pazar ve dinamik fiyat
```
fiyat = baz × mevsimÇarpanı[ürün][mevsim] × olayÇarpanı × doygunluk × gürültü × kalite × kanal
```
- **mevsimÇarpanı:** kendi mevsiminde 1,0; mevsim dışı (sera/depo ürünü) 1,35–1,6.
- **doygunluk:** pazar yerinde satılan her birim ×(1 − 0,004); toptancıda etkisi yarı. Her gün açığın %15'i kapanır (1'e döner). Alt sınır 0,50.
- **gürültü:** günlük ±%4 rastgele yürüyüş, 0,85–1,15 arasında sınırlı.
- **olayÇarpanı:** ör. "Bölgede kuraklık: domates +%40" (5–10 gün), "Fiyat çöküşü: patates −%35".
- **Kanallar:**
  | Kanal | Çarpan | Kural |
  |---|---|---|
  | Pazar yeri | ×0,85 | Anında nakit, her ürün için günlük 40 birim sınırı |
  | Toptancı | ×1,00 | En az 50 birim; ödeme 1 gün sonra; doygunluk etkisi yarı |
  | Sözleşme | ×1,35–1,70 | Miktar + min. kalite + süre (3–10 gün). Gecikme/eksik → sözleşme değerinin %30'u ceza + itibar −5. İtibar arttıkça daha büyük/kârlı sözleşmeler |
- **Bozulma:** her ürünün tazelik süresi (gün): marul 4, çilek 3, domates 6, süt 2, yumurta 10, ekmek 3, yoğurt 7, peynir 30, un 60, reçel 120, tahıl (siloda) ∞. Süre dolunca kalite bir sınıf düşer, C'den sonra çürür. Soğuk hava deposu süreyi ×5 uzatır.

### Giderler
| Gider | Kural |
|---|---|
| Elektrik | 2,5 ₺/kWh (makine işleri + binaların günlük tüketimi) |
| Su | Kuyu ücretsiz (elle); sulama sistemi 0,8 ₺/karo/gün |
| Gelir vergisi | Her "ay" (mevsim) sonunda pozitif net kârın **%10'u** |
| Emlak vergisi | Her mevsim sonunda sahip olunan arazi değerinin %1'i (P1 hariç) |
| İşçi maaşı | Her gün 20:00'de |
| Makine bakımı | Satın alma fiyatının %4'ü (isteğe bağlı ama bozulma riski) |
| Bozulma | Kalite/ürün kaybı olarak (deftere "fire" kalemi) |

### Banka
- **Kredi limiti** = 5.000 + net varlığın %40'ı (arazi + bina + makine + hayvan değeri − mevcut borç).
- **Faiz:** mevsimlik %6 (≈ yıllık %26), vade 1–4 mevsim, **haftalık eşit taksit** (otomatik çekilir).
- Gecikme: taksit tutarının %3'ü ceza + itibar −3; 3 gecikmeden sonra yeni kredi kapalı.
- Erken kapama: kalan anapara + %1.

### Seviye ve itibar
- XP: hasat (ürün değeri / 10), satış, sözleşme tamamlama (+50–300), bina açma (+100).
- Seviye eşiği: `100 × seviye^1.6`. Seviye kilitleri: 2 → kümes, 3 → P2 + toptancı, 4 → ahır, 5 → mandıra/değirmen, 7 → sera, 8 → traktör, 10 → dokuma, 12 → biçerdöver.
- İtibar (0–100): sözleşmeler, festival ödülleri, kaliteli satış ile artar; gecikme ve hastalıklı hayvan ile düşer. Sözleşme ödül çarpanını ve teklif sıklığını belirler.

### Rastgele olaylar (günlük olasılık, mevsime göre ağırlıklı)
| Olay | Olasılık | Etki |
|---|---|---|
| Bölgesel kuraklık | %3 (yaz %6) | İlgili ürün fiyatı +%30–50, toprak nemi kaybı ×1,5 |
| Dolu | %1,5 (ilkbahar/yaz) | Açık alan ekinlerine sağlık −30 (sera korur) |
| Ani don | %2 (ilkbahar başı, sonbahar sonu) | Dayanıksız ekinlere sağlık −40 |
| Hayvan hastalığı salgını | %1 | Temizlik <60 olan ahırlarda hastalık; veteriner gerekir |
| Festival (ürün yarışması) | Her mevsimin 21. günü | En iyi ürün yarışır; ödül 500–3.000 ₺ + itibar |
| Fiyat çöküşü | %2 | Bir ürün −%30–40 (5–8 gün) |
| Devlet teşviki | %1,5 | Makine/sera alımında %20 indirim veya hibe 2.000 ₺ |
| Zararlı istilası | %2 (yaz) | Bölgede zararlı olasılığı ×3 (3 gün) |

### İlk mevsim denge kontrolü (kaba hesap — Node simülasyonuyla doğrulanacak)
- 1. gün: 12 patates + 8 marul + 4 çilek = 660 ₺ tohum, 14 kompost ≈ 140 ₺ → kasa ≈ 4.200 ₺.
- 5. gün marul: +360 ₺; 7. gün patates: +1.200 ₺; 9. günden itibaren çilek: +216 ₺/3 gün.
- ~10. gün kümes + 4 tavuk (2.900 ₺) alınabilir; mevsim sonunda beklenen kasa **≈ 7.000–9.000 ₺**, net varlık ≈ 11.000 ₺.
- Hedef: 1. yıl sonu net varlık **60.000–100.000 ₺** (mandıra + ahır + 2 inek + sera); 2. yıl traktör ve P2–P3.
- Risk payı: kredi ile hızlanmak mümkün ama haftalık taksitler kötü hava olaylarında baskı yaratmalı.

---

## 5. Aşama Planı ve Görev Dağılımı

### Aşama 1 — Temel motor + sinematik görsel altyapı + gün-gece (ONAY SONRASI)
**Paralel görevler:**
1. **engine-dev:** Vite+Phaser iskeleti (`ciftlik/`), `core/*` (EventBus, GameState, SaveSystem, SystemRegistry, Rng, constants), `TimeSystem`, `scenes/*`, `CameraDirector` (takip/zoom/pan/pinch/sinematik), `window.__game` debug kancası, otomatik kayıt.
2. **visual-dev:** `render/*`: gökyüzü + güneş/ay/yıldızlar, 4 paralaks katman (dağ/bulut/tepe/orman), zemin dokusu, ön plan çimleri, gün-gece color grading (yukarıdaki tablo), güneşe bağlı gölge sistemi (birkaç örnek ağaç/çit/ev ile), sabah sisi, toz zerreleri, ateş böcekleri, PostFX (bloom, vinyet, gren, letterbox), kalite seviyeleri.
3. **ui-dev:** DOM UI kökü, HUD (saat/gün/mevsim, para, hız düğmeleri), toast sistemi, kalite/ses ayar paneli iskeleti, mobil dokunmatik uyumu.
4. **qa-tester:** derleme, masaüstü+mobil ekran görüntüleri (06:30 / 13:00 / 17:30 / 19:30 / 00:00), FPS, kayıt/yükleme testi.

**Kabul kriterleri:**
- `npm run dev` ve `npm run build` hatasız; konsolda hata yok.
- Gün döngüsü 10 dakikada tamamlanır; hız 0/1/2/4x çalışır; palet geçişleri kesintisiz ve yumuşak.
- 5 anahtar anın her biri belirgin biçimde farklı görünür (qa ekran görüntüleri).
- Gölgeler güneş konumuyla yön ve uzunluk değiştirir; gece kaybolur/zayıflar.
- Paralaks kamera kaydırıldığında derinlik hissi verir; zoom 0,5x–2x; mobilde pinch ve sürükleme çalışır.
- `__game.debug.cinematic()` letterbox'lı sinematik çekimi oynatır.
- Sayfa yenilenince zaman ve kamera durumu geri gelir; bozuk kayıtta oyun çökmez.
- Masaüstü (headless Chromium) ortalama ≥55 FPS hedef; mobil emülasyonda kalite otomatik düşer.

### Aşama 2–9 (özet; her aşama başında ayrıntılı görev kartları buraya yazılacak)
| Aşama | engine-dev | visual-dev | gameplay-dev | economy-dev | ui-dev |
|---|---|---|---|---|---|
| 2 Tarım | karo seçimi/girdi | ekin büyüme aşamaları, ıslak toprak | FarmSystem, toprak, kalite, zararlı | — | araç çubuğu, karo bilgi kartı |
| 3 Envanter/Pazar | — | hasat sinematiği parçacıkları | InventorySystem, bozulma | MarketSystem, mağaza, kanallar | envanter, mağaza, pazar panelleri |
| 4 Hayvan | — | hayvan çizimleri/animasyonları | AnimalSystem | yem/hayvan fiyatları | hayvan paneli |
| 5 Üretim | — | bina çizimleri, duman/ışık | ProductionSystem | tarif değerleri | üretim kuyruğu paneli |
| 6 Ekonomi | — | — | — | Economy/Bank/Contract, defter, sim betiği | finans paneli, grafikler |
| 7 Hava/Olay | — | yağmur, fırtına, kar, birikinti, bulut gölgesi | hava etkileri (don, kuraklık) | olay → fiyat | olay bildirimleri, tahmin |
| 8 İşçi/Makine/Arazi | yol bulma (ızgara A*) | işçi/traktör çizimleri | WorkerSystem, makineler, arazi | maaş, yakıt, arazi fiyatı | işçi ve arazi panelleri |
| 9 Cilalama | açılış sahnesi, kayıt yuvaları | sinematik geçişler, son rötuş | denge | denge simülasyonu | menü, ayarlar | 
| Ses (9) | AudioEngine (engine-dev): kuş, rüzgâr, yağmur, hayvan, UI sesleri — prosedürel |

Her aşamanın sonunda: **qa-tester raporu → hatalar düzeltilir → kullanıcıya rapor → onay**.

---

## 6. Karar Günlüğü
| # | Karar | Gerekçe |
|---|---|---|
| K1 | JS + JSDoc (TS değil) | Çok işçili hızlı geliştirme, derleme sadeliği |
| K2 | Simülasyon Phaser'dan bağımsız | Node'da ekonomi/denge simülasyonu, test edilebilirlik |
| K3 | UI DOM katmanında | Keskin metin, kolay erişilebilirlik ve dokunmatik, backdrop-blur ile sinematik cam paneller |
| K4 | 3/4 eğik diyorama görünüm (izometrik değil) | Paralaks ve gün-gece ışığı ile "film karesi" etkisi; çizim maliyeti düşük |
| K5 | 1 finansal ay = 1 mevsim (28 gün) | Takvimle tutarlı; haftalık taksitler ritim sağlar |
| K6 | Oyun projesi `ciftlik/` alt klasöründe | Depo kökündeki mevcut HTML oyunlarına dokunmamak |
| K7 | Oyun zamanı `game.loop.rawDelta` ile ilerler | Phaser'ın yumuşatılmış delta'sı düşük FPS'te zamanı yavaşlatıyordu |
| K8 | DPR kaliteye bağlı (2 / 1.5 / 1) | Mobilde dolgu oranı maliyetini sınırlamak |
| K9 | Uyku sırasında dakikalar sessiz modda tek tek simüle edilir | Determinizm; ağır sistemler gelirse toplu "catch-up" fonksiyonu eklenecek |
| K10 | Sulama nemi hedefe (80) doldurur, toplamaz; nem kaybı ilkbahar 1.2/saat | "Her gün sula" doğal ritmi cezalandırılmamalı; atlanan gün stres yaratmalı (sim-farm bulgusu) |
| K11 | Alet seçiliyken tek parmak sürükleme = boyama, kamera iki parmak/sağ tık | 24+ karoyu tek tek dokunmak mobilde yorucu |
| K12 | Envanter yığını (kalite, organik) çiftiyle anahtarlanır | Aşama 3 organik pazar bonusu |
| K13 | A kalite eşiği careScore 90 | Günlük bakım A, iki günde bir sulama B olmalı (sim-farm) |
| K14 | Dekorla kaplı karolar `data/land.js` P1_BLOCKED'de (zemin izi + görsel silüet arkası: çatı, kuyu çatısı, ağaç tacı); ekilemez, kart açılmaz | QA: evin arkasına ekin ekilebiliyordu |
| K15 | Hastalık yayılma 0.08; başlangıçta 4 organik sprey | QA: bakımsız salgın 10 günde tarlayı siliyordu, mağaza yokken çaresizlik |
| K16 | Sinematik, boyama darbesi bitene kadar ertelenir | QA: ilk hasat sinematiği boyamalı hasatı yarıda kesiyordu |
| K19 | Meyve suları 3 meyve → 2 şişe | sim-production: üzüm suyu zarardaydı |
| K20 | Seviye/XP sistemi kaldırıldı; tüm içerik baştan açık, tek koşul para | Kullanıcı isteği |
| K21 | Serbest yerleşim; başlangıç arazisi karo 20..68 × 5..21; sabit yalnızca çiftlik evi ve köy yolu | Kullanıcı kendi çiftlik düzenini kurmak istiyor |
| K22 | Kredi limiti = 5.000 + brüt varlık × 0.4 − borç (borç bir kez düşülür); vergi matrahı yatırımları gider sayar | Oyuncu dostu, sade |
| K23 | Kredi anaparası günlük gelir/gider ve kâr-zararda sayılmaz | Grafikte kredi gelir gibi görünüyordu |
| K24 | Kuraklık 0.012; yağmur nemi 88'de durur; festival rakipleri güçlendirildi | sim-weather: kuraklık %18 gün, uzun yağmur ekini çürütüyordu, festival hep kazanılıyordu |
| K25 | Dünya 80×40 karo; kuzey (P5) ve güney (P6–P9) parselleri eklendi | Kullanıcı arazinin yukarı/aşağı da büyümesini istedi |
| K26 | Parsel sınırları organik (data/land.js parcelAt/tilesOfParcel: gürültüyle bükülmüş harita + çoğunluk filtresi); sahip olunan arazinin dış sınırı ahşap çit; dikdörtgen başlangıç çiti kaldırıldı | Kullanıcı isteği: kare/dikdörtgen değil, düzensiz sınırlar ve çit |
| K27 | Yeni oyun bomboş arazide başlar: sürülmüş tarla, tezgâh, kuyu, sundurma, çit yok (yalnız çiftlik evi ve köy yolu sabit); tezgâh 600, kuyu 400, sundurma 500 ₺ ile kurulur | Kullanıcı isteği |
| K28 | Rüzgâr salınımları ayrı yavaş saatle (env.wt = gerçek zaman × 0.42): ekin, ağaç, orman şeridi, ön plan çimi, tente, tabela | Kullanıcı: normal hızda bile salınım çok hızlı |
| K29 | 'Gece İstilası' modu (isteğe bağlı): gece canavar baskınları, savunma yapıları, kiralık askerler; aile dostu ürkütücü-sevimli tarz, kimse ölmez (bayılır) | Kullanıcı isteği |
| K30 | İstila dengesi: ev 600 hp, yağma cezası en fazla 1.500 ₺, kule hasarı 9, dalga artışı yavaş; canavarlar kuzey şeridine (evin arkası) giremez; 1×1 savunma/çit köy yoluna konabilir | sim-defense: savunmalı oyuncu bile evi kaybediyordu (ev kuzey sınırda savunmasızdı, yol çit halkasında boşluk bırakıyordu) |
| K18 | Hayvan ürününde A için mutluluk ≥ 90 (sevme gerekir); tavuk 400 ₺, yumurta 15 ₺ | sim-animals: kümes ve ahır yatırımı ~47 günde geri döner |
| K17 | Toptancı ×0.95, çilek 16 ₺; fiyatlar ezilmedi | sim-economy optimal oyuncu ilk mevsim ≈12.4k ₺ (Aşama 3'te harcama yeri yok); gerçek oyuncu hedefi 7–9k korunur, Aşama 4'te kümes/hayvan yatırımıyla yeniden ölçülecek |

---

## 7. Aşama 1 Entegrasyon Sözleşmesi (bağlayıcı)

Beyin tarafından yazılan ortak dosyalar (işçiler DEĞİŞTİRMEZ, gerekirse önerir):
`src/core/constants.js`, `src/core/EventBus.js`, `src/core/timeUtils.js`, `src/data/palette.js`.
`src/main.js`, `src/render/Renderer.js`, `src/render/textures/index.js`, `src/ui/index.js` şu an **stub**; sahibi olan işçi değiştirir.

### Dosya sahipliği
| İşçi | Dosyalar |
|---|---|
| engine-dev | `src/main.js`, `src/core/GameState.js`, `SaveSystem.js`, `SystemRegistry.js`, `Rng.js`, `src/systems/TimeSystem.js`, `src/scenes/BootScene.js`, `src/scenes/WorldScene.js`, `src/render/CameraDirector.js` |
| visual-dev | `src/render/**` (CameraDirector hariç) |
| ui-dev | `src/ui/**` |

### Dünya koordinatları
- Zemin düzlemi: dünya `y ∈ [0, WORLD_H=1056]`, `x ∈ [0, WORLD_W=5120]`. Ufuk çizgisi `y = 0`. Gökyüzü ve arka plan katmanları `y ∈ [-SKY_H=-700, 0]`.
- Karo `(tx, ty)` → dünya `x = tx*64`, `y = ty*44`. P1 parseli karo `(32,6)`'dan `16×12`. Faz 1'de P1 içinde 6×4 sürülmüş karo alanı ve çiftlik evi dekor olarak çizilir (visual-dev).
- Kamera sınırları: `x 0..WORLD_W`, `y -SKY_H..WORLD_H`. Açılış kamerası P1 merkezine bakar.

### Main / sahneler (engine-dev)
```js
// main.js
const state = SaveSystem.load() ?? createInitialState();   // state.camera = {x,y,zoom}|null eklenir
registry.register(TimeSystem);
new Phaser.Game({ type: Phaser.AUTO (WebGL tercih), scale: RESIZE, scene: [BootScene, WorldScene] });
mountUI({ state, bus, calendar, debug });                     // ui-dev
window.__game = { state, bus, debug: {...} }                  // DEV veya ?debug=1
// BootScene.create(): generateTextures(this, p => ...) → this.scene.start('World')
// WorldScene.create(): renderer = new Renderer(this, state, bus); renderer.create(); camera = new CameraDirector(this, state, bus)
// WorldScene.update(time, delta): registry.tick(delta) → camera.update(delta) → renderer.update(frame)
// frame = { time, delta, totalMinutes /* kesirli, interpolasyonlu */, cal: calendar(totalMinutes) }
```
- Kalite: açılışta `state.settings.quality === 'auto'` ise engine çözer (dokunmatik + kısa kenar < 900px → `medium`, aksi `high`) ve `settings:quality {level}` yayar. UI'dan `settings:set {key, value}` gelir → engine state.settings'i günceller, `quality` ise yeniden `settings:quality` yayar, `save:request`.
- `save:reset` → localStorage temizlenir, sayfa yenilenir.

### Olaylar (Aşama 1)
| Olay | Yük | Yayan → Dinleyen |
|---|---|---|
| `time:minute` `time:hour` `time:day` `time:season` | `calendar()` çıktısı | TimeSystem → herkes |
| `time:speed` | `{speed: 0|1|2|4}` | UI → TimeSystem |
| `time:speedChanged` | `{speed}` | TimeSystem → UI |
| `time:sleep` | `{}` (yalnız 22:00–05:59 geçerli → ertesi 06:00) | UI → TimeSystem |
| `settings:set` | `{key, value}` | UI → main |
| `settings:quality` | `{level:'high'|'medium'|'low'}` | main → Renderer, UI |
| `camera:cinematic` | `{target:{x,y}, zoom, duration, letterbox, reason}` | herkes → CameraDirector |
| `cinematic:letterbox` | `{amount: 0..1, duration: ms}` | CameraDirector → Renderer |
| `toast` | `{text, kind}` | herkes → UI |
| `save:request` / `save:done` / `save:reset` | `{}` | herkes ↔ SaveSystem/main |
| `fps` | `{fps}` (saniyede bir) | Renderer → UI (debug) |
| `time:slept` | `{from, to}` | TimeSystem → Renderer (kararma geçişi) |
| `save:before` | `{}` | SaveSystem → herkes (kayıttan hemen önce state tazele) |
| `camera:cinematicStart` / `camera:cinematicDone` | `{reason}` | CameraDirector → herkes |
| `input:tap` | `{x, y, screenX, screenY, button, touch}` (dünya koordinatı) | CameraDirector → gameplay (Aşama 2 karo seçimi) |

**Onaylanan ekler (K7–K9):** `state.rngState` kayda girer; sistem `init(state, bus, registry)` 3. argümanı alır; `frame` nesnesi yeniden kullanılır ve `zoom` (kullanıcı zoom'u) ile `dpr` içerir. Kamera `cam.zoom = zoom × dpr`; canvas aygıt pikseliyle çizilir (DPR üst sınırı: high 2, medium 1.5, low 1).

### Renderer API (visual-dev)
```js
export default class Renderer {
  constructor(scene, state, bus)
  create()                 // katmanlar, dekor, PostFX
  update(frame)            // her kare; state'e YAZMAZ
  setQuality(level)        // 'high'|'medium'|'low'
  destroy()
  // Sonraki aşamalar için açık uçlar:
  shadows.register(obj, { footX, footY, height, width }) → handle; handle.remove()
  lights.addPoint({ x, y, radius, color, intensity, nightOnly }) → handle
}
// render/sunModel.js
export function getSun(hourFloat)  → { visible, dir /* -1 doğu .. +1 batı */, elevationDeg, intensity /* 0..1 */ }
export function getMoon(hourFloat) → aynı şekil
// render/textures/index.js
export function generateTextures(scene, onProgress) // senkron, bir kez; scene.textures'a anahtarla kaydeder
```

### UI API (ui-dev)
```js
export function mountUI({ state, bus, calendar, debug }) → { destroy() }
```
- HUD: sol üst saat (`HH:MM`), "İlkbahar · 1. Gün · Yıl 1", hava ikonu (`state.weather.type`), sağ üst para (`state.finance.money`, `money:changed` ile animasyonlu sayaç), alt/sağ hız kontrolleri (⏸ ▶ ⏩ ⏭), 22:00–06:00 arası "Sabaha geç" düğmesi, ayarlar düğmesi.
- Ayarlar paneli: kalite (Otomatik/Yüksek/Orta/Düşük), ses ve müzik kaydırıcıları (değer kaydedilir, ses Aşama 9), "Yeni oyun" (onaylı → `save:reset`).
- Toast kuyruğu (`toast` olayı). Debug iken FPS göstergesi (`fps` olayı).
- Klavye: Boşluk = duraklat/devam, 1/2/3 = hız, Esc = paneli kapat.

---

## 8. Aşama 2 Entegrasyon Sözleşmesi — Tarım ve Toprak (bağlayıcı)

Beyin dosyaları (DEĞİŞTİRME, öner): `src/data/crops.js`, `src/data/farming.js`, `src/data/items.js` + §7'dekiler.

### Dosya sahipliği
| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `src/systems/FarmSystem.js`, `src/systems/InventorySystem.js`, `src/systems/farm/*` (saf yardımcılar: soil.js, growth.js, threats.js, quality.js, rules.js), `tools/sim-farm.mjs` |
| visual-dev | `src/world/FieldView.js` (karoları ve ekinleri state'ten çizer), `src/render/textures/crops.js`, `src/render/textures/soil.js`, `src/render/**` içinde gerekli değişiklikler (P1'deki sabit "sürülmüş alan" dekoru kaldırılır — artık state'ten çizilir) |
| ui-dev | `src/ui/toolbar.js`, `src/ui/tileCard.js`, `src/ui/itemIcons.js` + `src/ui/**` |
| engine-dev | `src/main.js`, `src/core/*` (beyin dosyaları hariç), `src/scenes/*`, `src/render/CameraDirector.js`, yeni `src/core/Cinematics.js` |

### State (FarmSystem sahibi)
```js
state.tiles['tx,ty'] = {
  tx, ty, state: 'grass' | 'plowed',           // 'planted' yok: ekin varsa crop != null
  moisture, n, p, k, ph,                        // farming.js SOIL.start ile başlar
  weeds: 0..1, organic: true,                   // kimyasal kullanılınca false (bir sonraki hasada kadar)
  history: ['potato', ...],                     // son 3 hasat edilen ürün
  pendingFert: [{ n, p, k, daysLeft }],         // kompost yavaş salınım
  idleDays: 0,                                  // boş sürülmüş karo sayacı (grassRecoverDays)
  crop: null | {
    id, plantedDay, growth: 0..1, stage: 0..4, health: 0..100,
    pest: 0..1, disease: 0..1, careSum, careCount, readyDays: 0, harvests: 0, dead: false,
    rot: 1.0,                                   // ekim anındaki ekim nöbeti verim çarpanı
  },
}
state.inventory.items[itemId] = [{ q: 'A'|'B'|'C', organic: boolean, qty, age: 0 }]   // InventorySystem sahibi; yığın anahtarı (q, organic)
state.flags = { farmInitialized: true, firstHarvest: { potato: true } }   // engine GameState'e `flags:{}` ekler
```
- Yeni oyunda FarmSystem.init: `flags.farmInitialized` yoksa P1 (karo 32..47 × 6..17) için tüm karoları `grass` olarak oluşturur, **(34..39 × 8..11)** 24 karoyu `plowed` yapar, `STARTING_INVENTORY`'yi ekler, bayrağı koyar.
- Yalnızca sahip olunan parsellerdeki karolar etkileşime açıktır (Aşama 2'de yalnızca P1). `data/land.js` P1_BLOCKED karoları (ev, kuyu, ağaç, çalı, patika) hiçbir eyleme açık değildir.
- Her yüklemede eksik P1 karoları (bozuk kayıt / validator silmesi) varsayılanla tamamlanır.

### Simülasyon (FarmSystem)
- `onHour`: her ekili karo için nem kaybı/yağmur kazancı, büyüme (PLAN §3 formülü + farming.js GROWTH), sağlık, care örneklemesi. Boş karolarda nem.
- `onDay`: zararlı/hastalık/ot olasılıkları ve şiddet artışı, yayılma, kompost salınımı, `readyDays` → ROT_AFTER_DAYS sonunda `dead`, boş sürülmüş karo `idleDays`.
- `onSeason`: mevsim dışı kalan, frostHardy olmayan ürünlere hasar (HEALTH.outOfSeasonOnChange), sonra günlük hasar.
- **careScore** = careSum/careCount; saatlik örnek = nem bandında mı (40%), besin karşılanma (25%), sağlık/100 (20%), zararlı+hastalık+ot yokluğu (15%). Hasatta QUALITY eşiklerine göre A/B/C.
- **Verim**: `yield × rotasyonÇarpanı × (sağlık<50 ? 0.5 : 1)`, en az 1 (ölü hariç). Hasatta `uptake` besinleri düşer, `history`'ye eklenir; baklagil N ekler.
- Tüm rastgelelik `ctx.rng`.
- Performans: `onHour` karo başına sabit iş, bellek ayırma yok; ~1000 karoda < 2 ms.

### Komutlar ve olaylar
| Olay | Yük | Yön |
|---|---|---|
| `tool:select` | `{tool, itemId?}` (TOOLS listesi) | UI → herkes (FieldView imleci, CameraDirector boyama modu) |
| `tile:hover` | `{tx, ty, tileId} \| null` | CameraDirector → FieldView, UI |
| `tile:tap` | `{tx, ty, tileId, x, y}` | CameraDirector → UI |
| `farm:action` | `{type:'plow'|'plant'|'water'|'fertilize'|'treat'|'weed'|'harvest', tileId, itemId?}` | UI → FarmSystem |
| `farm:result` | `{ok, type, tileId, reason?, itemId?, qty?, quality?}` | FarmSystem → FieldView (efekt), UI (başarısızsa toast) |
| `farm:changed` | `{tileIds:[...]}` (saatlik toplu da olabilir) | FarmSystem → FieldView, UI |
| `farm:harvested` | `{tileId, tx, ty, cropId, itemId, qty, quality}` | FarmSystem → FieldView, UI, Cinematics |
| `farm:milestone` | `{kind:'firstHarvest'|'firstPlant', cropId, tileId, tx, ty}` | FarmSystem → Cinematics |
| `inventory:changed` | `{itemId, delta, quality}` | InventorySystem → UI |
| `inventory:add` | `{itemId, qty, quality}` (debug/sonraki aşamalar) | herkes → InventorySystem |
| `xp:gained` | `{amount, reason}` | FarmSystem → UI |

### Saf yardımcılar (systems/farm/rules.js — UI ve FieldView import edebilir, sadece okur)
```js
canApply(state, action, season) → { ok: boolean, reason?: string }   // TR mesaj: "Bu mevsimde ekilemez", "Önce sürmelisin"...
tileInfo(state, tileId, now) → { soil:{moisture,n,p,k,ph}, crop:{name, stage, stageName, growthPct, health, daysLeft, qualityEstimate, pest, disease, readyIn}, weeds, history, warnings:[...] }
cropVisual(tile) → { cropId, stage, wither: boolean, dead: boolean, pest, disease, weeds }
```
InventorySystem dışa açık: `add(state, itemId, qty, q)`, `remove(state, itemId, qty, q?) → removed`, `count(state, itemId, q?)`.

### Girdi (engine-dev)
- `input:tap` → dünya koordinatından karo `tx = floor(x/TILE_W), ty = floor(y/TILE_H)`; dünya içindeyse `tile:tap`.
- Masaüstünde fare hareketi → `tile:hover` (yalnızca karo değişince).
- **Boyama modu**: `tool:select` ile `hand` dışı bir alet seçiliyken tek parmak / sol tık sürükleme kamerayı kaydırmaz, geçilen her YENİ karo için `tile:tap` yayar. Bu modda kaydırma: iki parmak, sağ/orta tık, WASD. `hand` iken eski davranış.
- `Cinematics.js`: `farm:milestone firstHarvest` → `camera:cinematic {target: karo merkezi, zoom 1.5, duration 2200, letterbox: true, reason:'firstHarvest'}`. Kural tablosu genişletilebilir (Aşama 5 bina açılışı vb.).
- `SaveSystem.registerValidator(fn(state, onFix))`: main.js validator'ları **load'dan önce** kaydeder. FarmSystem ve InventorySystem `validate` dışa açar (tiles/crop/inventory elemanlarını doğrular).
- Debug: `addItem(id, qty=10, q='B')` → `inventory:add`; `grow(days)` → `skip(days*1440)`.

### Görsel (visual-dev — FieldView)
- Karolar: çim / sürülmüş (kuru ↔ ıslak: nem ≥ 50 koyu ve hafif parlak), ot yoğunluğu, organik olmayan karoda görünmez. Toprak bir RenderTexture'a **yalnızca değişen karolar** yeniden çizilerek basılır.
- Ekinler: her ürün için `shape` (leafy/bush/berry/grain/vine/tall/melon/root) ve renklerden 5 aşama + solgun + ölü prosedürel doku; y-sıralı (`depthForY`), rüzgârla salınım, olgun (stage ≥3) ekinler küçük gölge.
- Zararlı (küçük böcek noktaları) ve hastalık (sararmış/lekeli tint) görünür olmalı.
- İmleç: `tile:hover` karosunda yumuşak vurgu; alet geçerliyse sıcak beyaz, değilse kırmızımsı (`canApply`). Mobilde son `tile:tap` karosu.
- Efektler (`farm:result ok`): çapa toz bulutu, ekim küçük toprak serpintisi, sulama damla sıçraması + ıslaklık yayılması, gübre granülleri, ilaç sis bulutu, ot koparma yaprakları, hasat: ekin "pop" + parıltı + ürün ikonu yukarı süzülür.

### UI (ui-dev)
- Alt orta **araç çubuğu**: İncele, Çapa, Ek (tohum seçici açılır: envanterdeki tohumlar + adet, mevsimde ekilemeyenler soluk), Sula, Gübrele (kompost/NPK/kireç seçici), İlaçla (ilaç/organik sprey seçici), Ot temizle, Hasat. Klavye: `1–8` araçlar, hız kısayolları `Shift+1/2/3`'e taşınır, `Esc` → İncele.
- `tile:tap` + seçili alet → `farm:action`. İncele modunda **karo bilgi kartı** (cam panel): nem çubuğu, N/P/K çubukları, pH, ekin adı/aşama/ilerleme %, kalan gün, sağlık, tahmini kalite (A/B/C rozet), zararlı/hastalık/ot uyarıları, son ekilen ürünler. `farm:changed` ile canlı güncellenir.
- `farm:result ok:false` → toast (reason). `farm:harvested` → küçük "+2 Patates (A)" bildirimi. `xp:gained` göstergesi (ince).
- Ürün/tohum/gübre ikonları SVG, `crops.js` / `items.js` renklerinden.

---

## 9. Aşama 3 Entegrasyon Sözleşmesi — Envanter, Mağaza, Pazar (bağlayıcı)

Beyin veri dosyaları (DEĞİŞTİRME, öner): `src/data/economy.js` (fiyat formülü parametreleri, kanallar), `src/data/shop.js` (katalog + seviye kilidi), `src/data/progression.js` (XP eğrisi, açılımlar, envanter yuvası), `crops.js` `freshDays`.

### Dosya sahipliği
| İşçi | Dosyalar |
|---|---|
| economy-dev | `src/systems/MarketSystem.js`, `src/systems/EconomySystem.js`, `src/systems/market/*` (pricing.js — saf), `tools/sim-economy.mjs` |
| gameplay-dev | `src/systems/InventorySystem.js` (kapasite, bozulma), yeni `src/systems/ProgressionSystem.js`, FarmSystem'de XP refaktörü |
| ui-dev | `src/ui/inventoryPanel.js`, `shopPanel.js`, `marketPanel.js`, `sparkline.js`, HUD düğmeleri, seviye atlama kutlaması |
| visual-dev | `src/world/MarketStall.js` (pazar tezgâhı), satış/alış efektleri, `src/render/textures/*` |
| engine-dev | `src/main.js` (sistem/validator kaydı, debug), tezgâh tıklaması → `ui:open`, `tools/make-play.mjs` (oynanabilir sürüm paketi) |

### State
```js
state.finance = { money, ledger: [{ day, min, amount, category, label, itemId?, qty? }],   // en fazla LEDGER_MAX_ENTRIES (eskiler atılır)
                  dailySummary: [{ day, income, expense, byCategory: { sales: 120, seeds: -60 } }],   // son 112 gün
                  receivables: [{ dueMinute, amount, label }] }                             // toptancı ödemeleri
state.market = { prices: { [itemId]: { saturation: 1, noise: 1, soldToday: 0 } },
                 history: { [itemId]: [B-kalite pazar yeri fiyatı, … son 28 gün] },
                 activeEvents: [] }                                                          // Aşama 7
state.inventory = { capacity: 24 /* yuva = yığın */, items: { [itemId]: [{ q, organic, qty /* ≤ 99 */, age }] } }
state.player = { level: 1, xp: 0 /* mevcut seviyedeki XP */, totalXp: 0, reputation: 10 }
```

### Fiyat formülü (economy-dev, `systems/market/pricing.js` — saf, UI import eder)
```
birim = crops.basePrice × seasonMult(crop, season) × olay (activeEvents; şimdilik 1) × doygunluk × gürültü
        × QUALITY.priceMult[q] × (organic ? 1 + QUALITY.organicBonus : 1) × CHANNELS[kanal].mult
```
- Bir satışta her birim doygunluğu `×(1 − perUnit[kanal])` düşürür → toplam = birimlerin sırayla toplamı (ilk birim en pahalı). Yuvarlama: toplam tam ₺'ye.
- `quote(state, { itemId, q, organic, qty, channel }, now) → { ok, reason?, unit, total, avg, limitLeft, minLot }`
- `currentPrice(state, itemId, now) → B kalite pazar yeri birim fiyatı` ; `trend(state, itemId) → { change: -0.12 .. +0.2, history: [...] }`
- onDay: doygunluk açığın %15'i kapanır; gürültü ±%4 rastgele yürüyüş (0.85–1.15, `ctx.rng`); `soldToday = 0`; history'ye günün fiyatı eklenir.
- onHour: vadesi gelen `receivables` ödenir (`transact`, kategori `wholesale`).

### Para (economy-dev, EconomySystem)
- **Tek giriş noktası:** `transact(state, bus, { amount, category, label, itemId?, qty? }) → boolean` (negatif tutar bakiye yetmezse `false`, hiçbir şey değişmez). Defter + günlük özet günceller, `money:changed {amount, balance, category}` yayar. Debug addMoney de bunu kullanır (kategori `other`).
- Dışa açık: default nesne `EconomySystem` üzerinde `transact`, `validate`.

### Komutlar ve olaylar
| Olay | Yük | Yön |
|---|---|---|
| `market:sell` | `{ itemId, q, organic, qty, channel }` | UI → MarketSystem |
| `market:result` | `{ ok, reason?, itemId, qty, total, channel, paidNow }` | MarketSystem → UI, MarketStall (efekt) |
| `shop:buy` | `{ itemId, qty }` | UI → MarketSystem |
| `shop:result` | `{ ok, reason?, itemId, qty, total }` | MarketSystem → UI |
| `market:pricesUpdated` | `{}` (günlük) | MarketSystem → UI |
| `xp:add` | `{ amount, reason }` | Farm/Market → ProgressionSystem |
| `xp:gained` | `{ amount, reason, level, xp, toNext }` | ProgressionSystem → UI |
| `level:up` | `{ level, unlocks: [...] }` | ProgressionSystem → UI, Cinematics |
| `inventory:full` | `{ itemId }` | InventorySystem → UI |
| `inventory:spoiled` | `{ itemId, fromQ, toQ /* null = çürüdü */, qty }` | InventorySystem → UI |
| `ui:open` | `{ panel: 'market'|'shop'|'inventory' }` | herkes → UI |

- Satış kuralları: envanterde yeterli adet; pazar yerinde ürün başına günlük 40 birim (`soldToday`); toptancı seviye ≥ 3 ve en az 50 birim, ödeme ertesi gün 08:00. Yalnızca `category: 'crop'` eşyalar satılır (Aşama 5'te işlenmiş ürünler eklenecek).
- Mağaza kuralları: seviye kilidi (`shop.js`), bakiye (`transact` false → "Yeterli paran yok"), envanter yeri (yoksa "Envanter dolu"); alınan eşyanın organikliği `ITEMS[id].organic`.
- XP: hasat (FarmSystem → `xp:add`, değer = B pazar değeri × 0.1), satış (MarketSystem → `xp:add`, hasılat × 0.02), çapa/ekim 1. FarmSystem artık `state.player.xp`'ye doğrudan yazmaz.

### Envanter (gameplay-dev)
- Kapasite = yığın sayısı (`state.inventory.capacity`, başlangıç `INVENTORY.startSlots` = 24); yığın en fazla 99 adet. Yeni yığın gerekiyor ve yer yoksa `add` eklenebildiği kadar ekler, kalanı döndürür → FarmSystem hasatta yer yoksa hasat etmez ("Envanter dolu"), `inventory:full`.
- `add(state, itemId, qty, q, organic) → eklenen`, `remove`, `count`, `freeSlots(state)`, `canAdd(state, itemId, qty, q, organic) → number`.
- Bozulma (onDay): yalnızca `crop` kategorisi; yığın `age++`; `age ≥ freshDays` → bir kalite düşer (A→B→C), `age = 0`, aynı (q, organic) yığını varsa birleşir (age = max); C'den sonra yığın yok olur ("çürüdü"). `inventory:spoiled` yayar (gün başına ürün başına bir olay).

### Görsel (visual-dev)
- **Pazar tezgâhı**: P1 dışında, patikanın çıktığı yolun yanında, dünya ≈ (2770, 860) ayak noktası (karo ~43,19). Tenteli ahşap tezgâh, sandıklarda envanterdeki en çok bulunan 3 ürünün ikonları; gece fener. `depthForY`, gölge. Tıklanınca (engine `tile:tap` ile tezgâh karoları 42–44 × 18–19) `ui:open {panel:'market'}`.
- **Efektler**: `market:result ok` → tezgâhtan altın sikke parçacıkları ve kısa parıltı; `level:up` → ekran ortasında ince altın ışık dalgası (post-process'e yük bindirmeden).

### UI (ui-dev)
- HUD'a üç düğme (masaüstünde etiketli, mobilde ikon): **Envanter (I)**, **Pazar (P)**, **Mağaza (M)**; `ui:open` olayıyla da açılır. Aynı anda tek büyük panel.
- **Envanter paneli**: yuva ızgarası (kullanılan/kapasite), her yığında ikon, adet, kalite rozeti, organik yaprağı, tazelik çubuğu (age / freshDays), kategori filtreleri.
- **Pazar paneli**: satılabilir yığınlar listesi; her satırda birim fiyat (o yığının kalite/organik değeriyle), 28 günlük sparkline + değişim yüzdesi, doygunluk göstergesi, kanal seçimi (Pazar yeri / Toptancı — kilitliyse "Seviye 3"), adet kaydırıcısı (limit ve minLot'a göre), anlık `quote` toplamı, "Sat" düğmesi. Satış sonrası para sayacı ve kısa bildirim.
- **Mağaza paneli**: sekmeler (Tohumlar / Gübre / Bakım), kartlarda ikon, ad, fiyat, mevsim etiketi (tohumlar), kilitliyse "Seviye N", adet seçici, toplam, "Satın al"; bakiye yetmezse düğme pasif.
- **Seviye**: XP göstergesi gerçek ilerlemeyi gösterir (`xp / toNext`); `level:up` → zarif kutlama kartı + açılımlar listesi.
- Bozulma ve dolu envanter bildirimleri (toast; spam yok).

---

## 10. Aşama 4 Sözleşmesi — Hayvancılık (bağlayıcı, kısa)

Beyin dosyaları: `data/animals.js` (ANIMALS, CARE, VET, ANIMAL_PRODUCTS), `data/buildings.js` (BUILDINGS + sabit arsalar, TROUGH), `items.js` (chicken_feed, hay, hayvan ürünleri category 'animal'), `shop.js` (Yem/Hayvanlar/Binalar sekmeleri). Beyin ayrıca: pricing/MarketSystem hayvan ürünlerini satar; `WorldLinks` arsalara dokununca `ui:open {panel:'building', buildingType, lotId}`; `Cinematics` `building:built {type, lotId, tx, ty}` → sinematik.

| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `systems/AnimalSystem.js` (+ `systems/animals/*`), InventorySystem bozulmasının `ITEMS[id].freshDays`'e genellenmesi, `ui/buildingPanel.js` (+ shopPanel'e Hayvanlar/Binalar sekme kartları), main.js'e kayıt (tek satır) |
| visual-dev | `world/BuildingView.js`, `world/AnimalView.js`, `render/textures/animals.js`, `render/textures/buildings.js`; arsalardaki dekoru (layout.js, P1 dışı) temizleme |

### State
```js
state.buildings = [{ id, type: 'coop'|'barn'|'hive', lotId, builtDay, dirt: 0..100,
                     trough: { feed: porsiyon, water: gün }, box: { [itemId]: [{ q, qty }] } }]
state.animals = [{ id, type, name, buildingId, ageDays, hunger, thirst, health, happiness /*0..100*/,
                   sick: false, pettedDay: -1, productTimer: 0 /*gün*/ }]
```
### Komutlar / olaylar
| Olay | Yük | Yön |
|---|---|---|
| `shop:build` | `{ building, lotId }` | UI → AnimalSystem (seviye, bakiye `transact` 'other', arsa boş) → `building:built {type, lotId, tx, ty}` |
| `shop:buyAnimal` | `{ animal, buildingId? }` | UI → AnimalSystem (bina kapasitesi; arı için boş kovan yeri = bina 'hive' oluşturur) → `animal:born {animal, reason:'bought'|'bred'}` |
| `animal:action` | `{ type: 'feed'|'water'|'clean'|'collect'|'pet'|'vet', buildingId, animalId?, itemId? }` | UI → AnimalSystem → `animal:result {ok, reason?, ...}` |
| `animals:changed` | `{ buildingIds }` | AnimalSystem → görsel/UI |
- **feed**: bina hayvanları için 1 günlük ihtiyacı envanterden yemliğe (TROUGH.feedDaysMax'a kadar); `itemId` yem ya da altFeed ekin (porsiyon değeriyle). **water**: kuyudan ücretsiz, suluk dolar. **clean**: dirt 0. **collect**: kutudaki ürünler envantere (`canAdd`). **pet**: günde bir, mutluluk +10. **vet**: `transact` −300, hasta → iyileşir.
- **onHour**: yemlik/suluktan tüketim (perDay/24), açlık/susuzluk/sağlık (CARE). **onDay**: kir, hastalık şansı (ctx.rng), yaş, mutluluk (beslenme, su, temizlik, sevme, sağlık ortalaması), üretim (timer ≥ intervalDays ve eşikler; kalite mutluluğa göre; yaşlı %50; arı kışın yok, 4+ ayçiçeğinde ×1.3), üreme (aynı türden 2+, mutluluk > 80, yer var, breedChance). Ürünler binanın kutusuna gider, oyuncu toplar.
- Hayvan ürünleri `category 'animal'`, bozulma `ITEMS[id].freshDays` ile (InventorySystem genellenir). XP: toplama `xp:add` (B değer × 0.1).
- Bina paneli (arsaya dokununca): boş arsa → fiyat/seviye/"İnşa et"; dolu → hayvan listesi (durum çubukları, Sev/Veteriner), yemlik/suluk/kir göstergeleri, Yem koy (yem seçici), Su doldur, Temizle, Ürünleri topla (kutudaki adetler), "Hayvan al" (kapasite).
### Görsel
- Kümes (sevimli ahşap, kırmızı çatı, rampa), ahır (büyük kırmızı-ahşap, çift kapı), kovan (beyaz ahşap kutu, arılar). Boş arsa: ince işaretli kazık/ip çevrili toprak + tabela. Gece pencere ışığı. Gölge, `depthForY`.
- Hayvanlar pen alanında dolaşır (basit durum makinesi: yürü/otla/dur), yetişkin/yavru boyutu, hasta (soluk, yavaş), mutlu (zıplama). Tavuklar gagalar, inekler kuyruk sallar, arılar kovan çevresinde uçar. Gece hayvanlar binaya girer (görünmez). `building:built` → inşa "pop" + toz/parıltı.

---

## 11. Aşama 5 Sözleşmesi — Üretim Zincirleri + İlk Çalışan (bağlayıcı, kısa)

Kullanıcı isteği: kullanıcının paylaştığı fotoğraftaki çocuktan esinlenen bir karakter çiftliğin ilk çalışanı "Çırak" olur; **yakın işlere yürür, uzak işlere eşekle gider**. Fotoğraf oyuna konmaz; karakter prosedürel çizilir. Karakter tarifi (visual-dev için bağlayıcı): ~11 yaşında erkek çocuk; kısa, alında yana doğru taranmış, uçları hafif dağınık **koyu kahverengi** saç; **kalın koyu kaşlar**; iri **kahverengi gözler**; açık buğday ten, hafif pembe yanaklar; sakin, hafif yana çekik **gülümseme**; **gri-lacivert-lila kamuflaj desenli kapüşonlu sweatshirt**, göğsünde **kırmızı** yazı/desen; koyu pantolon, spor ayakkabı. Animasyon filmi tarzı, sevimli, saygılı.

Beyin dosyaları: `data/recipes.js` (MACHINES + sabit arsalar, MACHINE_RULES, RECIPES, PROCESSED), `data/workers.js` (WORKER_TYPES.apprentice, DONKEY, WORKER_HOME), items.js (işlenmiş ürünler 'processed'), economy.js (yeni defter kategorileri: buildings, animals, electricity, maintenance, wages). Beyin ayrıca: pazar işlenmiş ürünleri satar; `WorldLinks`: atölye arsası → `ui:open {panel:'machine', machine}`, eşek sundurması → `ui:open {panel:'worker'}`.

| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `systems/ProductionSystem.js` (+ `systems/production/*`), `ui/machinePanel.js`, mağazaya 'Atölyeler' kartları (shopPanel), main.js kaydı |
| engine-dev | `systems/WorkerSystem.js` (+ `systems/workers/*`: görev seçimi, hareket, eşek), `ui/workerPanel.js`, main.js kaydı |
| visual-dev | `world/MachineView.js`, `world/WorkerView.js` (çocuk + eşek), `render/textures/machines.js`, `render/textures/worker.js`, UI portresi `src/ui/portrait.js` (SVG, aynı tarif) |

### State
```js
state.machines = [{ id: 'm_dairy', type, builtDay, condition: 100, queue: [{ recipe, startMin, endMin, inputs:{q, organic} }], output: { [itemId]: [{ q, organic, qty }] }, auto: null | recipeId }]
state.workers = [{ id: 'w1', type: 'apprentice', name, hiredDay, enabled: true, tasks: { water: true, harvest: true, animals: true, machines: true },
                   x, y /* dünya px */, mode: 'idle'|'walk'|'ride'|'work'|'home', task: null | { kind, target, endMin }, onDonkey: false }]
state.donkey = { x, y, mode: 'home'|'carrying' }
```
### ProductionSystem (gameplay-dev)
- `shop:buildMachine {machine}` → seviye + `transact(-price, 'buildings')` → `building:built {type: machine, lotId: machine, tx, ty}` (sinematik).
- `machine:queue {machineId, recipe}`: girdiler envanterde (en düşük kaliteden alınır) → `transact(-kwh×2.5, 'electricity')` → kuyruğa (max 3; iş sıralı çalışır, süre `hours`, condition < 50 → ×1.3, < 20 → durur). `machine:auto {machineId, recipe|null}`: kuyruk boşaldıkça girdi varsa otomatik ekle (çalışan da yapabilir).
- tickMinute/onHour: biten iş → `output` kutusu, condition −2, `machine:done`. `machine:collect {machineId}` → envanter (`canAdd`), XP (değer × 0.05). `machine:repair` → `transact(-price×0.04, 'maintenance')` → 100.
- Olaylar: `machines:changed {ids}`, `machine:result {ok, reason?}`, `machine:done {machineId, itemId, qty}`.
- Makine paneli: boş arsa → inşa; kurulu → tarif kartları (girdi/çıktı/süre/elektrik/kâr tahmini: çıktı değeri − girdi değeri − elektrik, `currentPrice` ile), kuyruk (ilerleme çubukları), çıktı kutusu + Topla, durum (condition) + Bakım, Otomatik tarif seçici.
- Node testi `tools/sim-production.mjs`: süt→peynir, buğday→un→ekmek zincirleri; kâr tablosu.

### WorkerSystem (engine-dev)
- Yeni oyunda Çırak işe alınmaz; mağaza/çalışan panelinde "İşe al" (WORKER_TYPES.apprentice.hireLevel 1, ücretsiz alım, günlük maaş 90 ₺ saat 20:00'de `transact(-wage, 'wages')`; para yetmezse o gün çalışmaz + toast). İşe alınınca evin önünde belirir; eşek sundurmada bekler.
- Çalışma saatleri 07–19. Her karar anında (iş bitince / boştayken 5 oyun dakikada bir) etkin görev türlerinden **en yakın** işi seçer, öncelik sırası `tasks`: water (nem < 45 ekili karo), harvest (hazır ekin; envanter yeri), animals (yemlik boş + envanterde yem → feed; suluk < 1 gün → water; kutuda ürün → collect), machines (çıktı kutusu dolu → collect; `auto` tarif ve girdi varsa → load). Aynı hedefi iki kez seçmez (rezervasyon).
- **Hareket:** hedefe Öklid mesafe ≤ `donkeyAbove` karo → yürür; uzaksa önce eşeğe gider (sundurma), eşekle hedefe gider (eşek hedefte bekler), iş bitince sıradaki hedef uzaksa eşekle devam, yakınsa iner ve yürür; gün sonu (19:00) eşeği sundurmaya bırakıp eve yürür. Hız oyun dakikası başına karo (oyun hızıyla ölçeklenir). Yol bulma: düz çizgi + engelli karolardan (P1_BLOCKED, bina/makine arsaları) kaçınan basit ızgara A* (8 yön, ~100×30 ızgara, sonuç önbellekli).
- Eylemler gerçek komutlarla yapılır (`farm:action`, `animal:action`, `machine:collect`/`machine:queue`) — kurallar aynı kalır; sonuçlar `worker:did {workerId, kind, ok}`.
- Çalışan paneli (`ui:open {panel:'worker'}` ve HUD'da küçük portre düğmesi): portre (visual-dev'in `ui/portrait.js`), ad (düzenlenebilir), durum ("Domatesleri suluyor", "Eşekle mandıraya gidiyor"), görev anahtarları ve sırası, maaş, "Kamerayla takip et" (`camera follow`), İşe al / Çıkar.
- `workers:changed`, `worker:state {workerId, mode, x, y, onDonkey}` (görsel için mod değişiminde).
### Görsel (visual-dev)
- Atölye binaları (mandıra: beyaz-mavi süt evi; değirmen: taş gövde + dönen kanatlı yel değirmeni; fırın: tuğla, bacadan duman; konserve: kırmızı kapılı küçük atölye; iplikhane ve dokuma: ahşap atölye, dokumada renkli kumaş). Çalışırken duman/hareket, gece ışık; boş arsa işareti. Kirli/aşınmış (condition < 50) hafif yıpranmış görünüm.
- **Çırak**: tarif edilen karakter, 3/4 görünüm, yürüme döngüsü (4–6 kare, sol/sağ ayna), iş animasyonu (sulama kovası, sepet, eğilme), boşta göz kırpma; **eşek** (gri-kahve, uzun kulaklar, heybe), binerken çocuk eşeğin üstünde; eşek yürüyüşü, kulak/kuyruk hareketi. `depthForY`, gölge, gece fener (çocuk 19:00'da eve gider). Kamera takip edilirken akıcı.
- `ui/portrait.js`: SVG portre (baş-omuz), aynı tarif; panelde ve HUD düğmesinde kullanılır.

---

## 12. Aşama 5b Sözleşmesi — Serbest Yerleşim (bağlayıcı, kısa)

Kullanıcı isteği: kümes, ahır, kovan, atölyeler, tezgâh, kuyu, sundurma, çit ve patikayı **oyuncu kendisi yerleştirir, taşır, kaldırır**; ağaç/çalı temizlenebilir; tarlayı istediği yere çapalar. Seviye yok (K20).
Beyin dosyaları: `data/placeables.js` (PLACEABLES, BUILD_CATS, CLEAR_COST, START_LAYOUT, START_FENCE), `data/land.js` (P1 = 20..68 × 5..21; P1_BLOCKED yalnızca ev + köy yolu).

### State
```js
state.placed = [{ id: 'p12', type, tx, ty }]           // tx,ty = sol-üst karo; ayak izi PLACEABLES[type].w×h
state.removedDecor = ['tree_3', 'bush_5']               // render/layout.js TREES/BUSHES dizinleri
state.buildings[i].placedId / state.machines[i].placedId // lotId yerine (eski kayıt göçü)
```
### Çekirdek (engine-dev): `systems/PlacementSystem.js` + `systems/world/occupancy.js` (saf)
- `occupancy`: `isBlocked(state, tx, ty, {walk})` (yerleştirilenler + temizlenmemiş dekor ayak izi + P1_BLOCKED; `walk:true` iken patika ve köy yolu geçilebilir), `canPlace(state, type, tx, ty, ignoreId?) → {ok, reason}` (arazi içinde, boş, ekinli/sürülmüş karo değil — çit ve patika sürülmüş karoya konamaz), `objectAt(state, tx, ty) → placed|decor|null`, `penOf(state, placedId) → {x0,x1,y0,y1}` (ayak izinin hemen altında, w+2 × 3, engelsiz karolar). Önbellek `placed:changed`'de yenilenir; render/layout.js yalnızca saf veri olarak import edilir.
- Komutlar: `build:place {type, tx, ty}` → `canPlace` + `transact(-price,'buildings')` → `placed:changed`, `building:built {type, placedId, tx, ty}` (sinematik yalnızca bina/atölye/kovan için; çit/patika için yok). `build:move {placedId, tx, ty}` (ücretsiz; içerik/hayvanlar taşınır). `build:remove {placedId}` (unique+required kaldırılamaz; hayvanlı bina/kuyruğu dolu makine reddedilir: "Önce hayvanları sat/taşı"; iade `price×refund`). `build:clear {decorId}` → `transact(-CLEAR_COST)` → removedDecor. `build:result {ok, reason}`.
- Yeni oyun: START_LAYOUT + START_FENCE çiti `state.placed`'e yazılır. **Eski kayıt göçü:** lot'lu binalar/makineler lot konumunda placed nesnelere, sabit tezgâh/kuyu/sundurma/çit varsayılan konumlarına dönüştürülür.
- `rules.canApply` (farm) ve `WorkerSystem` yol bulma `occupancy` kullanır (P1_BLOCKED doğrudan değil); WorldLinks yerine **placed nesneye dokunma** → `PLACEABLES[type].link` paneli (`placedId` ekli) — WorldLinks bu tabloyu dinamik üretir.
- FarmSystem: genişleyen P1 için eksik karoları mevcut `ensureParcelTiles` tamamlar (gameplay-dev doğrular).
### Sistem uyarlaması (gameplay-dev)
- AnimalSystem: `shop:build`/lot mantığı kalkar; `building:built` (coop/barn/hive) → bina kaydı (`placedId`), hive → bina + arılar. Kalem: `build:move` hayvan konumlarına dokunmaz (görsel pen'den alır); `build:remove` boş binayı siler. ProductionSystem: `shop:buildMachine` kalkar; `building:built` (makine türü) → makine kaydı; makine türü başına birden fazla atölye serbest (`id = m_<placedId>`). Mağazadaki Binalar/Atölyeler kartları kaldırılır (inşa artık İnşa modunda). Paneller arsa yerine `placedId` ile açılır. Seviye artıkları (levelLock metinleri) temizlenir. Simler güncellenir.
### Görsel (visual-dev)
- Tüm görünümler (BuildingView, MachineView, AnimalView pen, MarketStall, kuyu, sundurma, WorkerView eşek evi) konumu `state.placed`'ten alır, `placed:changed`'de kurar/taşır/yok eder. Sabit "boş arsa" işaretleri kalkar. Decor: `removedDecor` ağaç/çalıları gizler; P1 içi ve dışı sabit dekor `layout.js`'ten okunur (ev ve köy yolu sabit).
- **Çit** (otomatik bağlanan ahşap çit: komşu çitlere göre yatay/dikey/köşe parçaları) ve **taş patika** (komşulara göre birleşen taşlar) dokuları ve görünümü; eski P1 çiti artık bu sistemden çizilir (render'daki sabit çit kalkar).
- **Hayalet önizleme:** `build:ghost {type, tx, ty, valid} | null` → yarı saydam sprite, yeşilimsi/kırmızımsı kenar; taşıma modunda seçili nesne hafif kalkık. Yerleştirme: pop + toz.
### UI (ui-dev)
- HUD'a **İnşa** düğmesi (B). İnşa modu: alt kenarda kategori sekmeli katalog (BUILD_CATS; kartta ikon, ad, fiyat, ayak izi), üstte mod çubuğu: **Yerleştir / Taşı / Kaldır / Temizle (ağaç)** ve Bitti. Seçili nesne → `tool:select {tool:'build'}` (CameraDirector boyama semantiği) ve `tile:hover`/`tile:tap` → `build:ghost` (+ `canPlace`) → masaüstünde tık = yerleştir; mobilde ilk dokunuş hayaleti koyar, "Onayla" düğmesi yerleştirir; çit/patika sürükleyerek boyanır (her karo bir `build:place`). Taşı: nesneye dokun → hayalet → hedef → onay. Kaldır: dokun → iade tutarıyla onay. Temizle: ağaç/çalıya dokun → bedelle onay. `build:result ok:false` → toast (darbe başına bir). Esc/Bitti → çıkış, alet İncele'ye döner.
- Seviye artıkları: mağaza/pazar/çalışan/bina/makine panellerindeki seviye kilidi metinleri ve level:up kartı kaldırılır (veriler zaten level 1).

---

## 13. Aşama 6 Sözleşmesi — Banka, Giderler, Vergiler, Sözleşmeler, Finans Paneli (bağlayıcı, kısa)

Beyin dosyası: `data/economy.js` (BANK, VALUATION, TAX, UPKEEP_KWH, CONTRACTS, yeni defter kategorileri). Seviye yok (K20): itibar yalnızca sözleşme ödül çarpanını etkiler.

| İşçi | Dosyalar |
|---|---|
| economy-dev | `systems/BankSystem.js`, `systems/ContractSystem.js`, `systems/EconomySystem.js` (vergi, günlük sabit giderler, net varlık), `systems/economy/*` (saf: valuation.js, loans.js), `tools/sim-economy.mjs` güncellemesi, main.js kaydı |
| ui-dev | `ui/financePanel.js` (sekmeler: Özet · Grafikler · Defter · Banka · Sözleşmeler), `ui/charts.js` (canvas 2D), HUD **Finans** düğmesi (F), sözleşme bildirimleri |

### State
```js
state.finance.loans = [{ id, principal, remaining, rate, termSeasons, installment, nextDueMin, paidCount, totalCount, lates }]
state.finance.bankLates = 0
state.finance.seasonSummary = [{ year, season, income, expense, profit, tax, byCategory }]   // son 8 mevsim
state.contracts = { offers: [{ id, itemId, qty, minQ, reward, deadlineDays, expiresMin }],
                    active: [{ id, itemId, qty, delivered, minQ, reward, dueMin, penalty }], history: [...son 20] }
state.player.reputation (0..100)
```
### Kurallar
- **Banka:** `bank:borrow {amount, termSeasons}` → limit kontrolü (`loanLimit(state)` = base + netWorth×0.4 − kalan borç; `bankLates ≥ 3` → kapalı) → `transact(+amount,'loan')`. Taksit = eşit ödeme (anapara + mevsimlik faiz, vade × 4 hafta); her 7 günde 09:00 `transact(-installment, 'interest' faiz kısmı + 'loan' anapara kısmı)`; yetmezse taksit + %3 ceza ertelenir (`lates++`, `bankLates++`, toast). `bank:repay {loanId}` erken kapama (kalan + %1).
- **Net varlık** (`netWorth(state)`): para + yapılar (inşa bedeli × 0.6) + hayvanlar (fiyat × 0.7) + envanter (pazar fiyatı × 0.8) − kalan borç. Günlük özetle birlikte saklanır (grafik için `dailySummary[i].netWorth`).
- **Vergi:** mevsimin son günü 23:00: o mevsimin `profit > 0` ise `profit × 0.10` (`tax`); ilk mevsim muaf. Emlak vergisi P1 için 0 (Aşama 8'de ek parseller). Mevsim özeti yazılır, `finance:seasonClosed` olayı + toast "Mevsim kapandı: kâr X ₺, vergi Y ₺".
- **Sabit giderler:** her gün 20:00 ev 2 kWh + kışın ahır 6, kümes 2 kWh (yerleştirilmiş bina sayısına göre) × 2.5 ₺ → 'electricity'.
- **Sözleşmeler:** her sabah 07:00 1–2 teklif (pano ≤ 4; yalnızca oyuncunun bildiği ürünler — `stats.harvested`/`sold`/üretilenler; hiç yoksa marul/patates). Ödül = B pazar fiyatı × adet × çarpan (itibarla 1.35→1.7). `contract:accept {id}` → aktif; `contract:deliver {id, qty?}` → envanterden min kalite ve üstü düşer (önce en düşük uygun kalite), tamamlanınca `transact(+reward,'contracts')`, itibar +4; süre dolarsa ceza `transact(-penalty,'penalty')` (para yetmezse 0'a kadar, kalan borç değil), itibar −6. Olaylar: `contracts:changed`, `contract:result {ok, reason?}`, `contract:completed`, `contract:failed`.
- Tüm para hareketleri `transact` ile; defter kategorileri `LEDGER_CATEGORIES`.
### Finans paneli (ui-dev)
- **Özet:** para, net varlık, bugünkü/bu mevsimki gelir-gider-kâr, kalan borç, itibar; son 7 günün mini grafiği.
- **Grafikler:** günlük gelir (yeşil) / gider (kırmızı) çubukları + net varlık çizgisi (son 28 gün, kaydırılabilir 112 gün); mevsim kâr-zarar tablosu (kategori satırları × son 4 mevsim, vergi satırı).
- **Defter:** son kayıtlar (filtre: kategori), tarih-saat, tutar renkli.
- **Banka:** limit, aktif krediler (kalan, taksit, sonraki ödeme tarihi, ilerleme), yeni kredi (tutar kaydırıcısı + vade seçimi + toplam geri ödeme önizlemesi), erken kapama.
- **Sözleşmeler:** teklifler (ürün ikonu, adet, min kalite rozeti, ödül, birim ödül vs pazar fiyatı farkı %, süre, "Kabul et"), aktifler (teslim edilen/gereken, kalan süre, envanterde uygun adet, "Teslim et"). HUD rozeti: yeni teklif / süresi yaklaşan sözleşme sayısı.

---

## 14. Aşama 7 Sözleşmesi — Hava, Mevsim Görselleri, Rastgele Olaylar (bağlayıcı, kısa)

Beyin dosyaları: `data/weather.js` (SEASON_WEATHER, WIND, INTENSITY, PERSISTENCE, FORECAST_DAYS, INTRADAY_CHANGE, EFFECTS), `data/events.js` (EVENTS, FESTIVAL).

| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `systems/WeatherSystem.js`, `systems/EventSystem.js`, Farm/Animal/Market/Placement'ta olay ve hava etkileri, `ui/weatherStrip.js` (HUD tahmin şeridi), `ui/eventCard.js` (olay kartı + festival paneli), main.js kaydı, `tools/sim-weather.mjs` |
| visual-dev | `render/WeatherFX.js` (yağmur, fırtına+şimşek, kar, sis, bulut gölgeleri, birikintiler, ıslak zemin parlaması), mevsim görselleri (kış kar örtüsü: zemin, çatılar, ağaçlar; sonbahar yaprakları), olay görsel ipuçları |

### State
```js
state.weather = { type, intensity, wind, forecast: [{ type, intensity, wind }] /*3 gün*/, puddles: 0..1, snowCover: 0..1, wetness: 0..1, changeAtMin: null|dk }
state.market.activeEvents = [{ id, kind, itemId?, mult, untilMin }]   // pricing.js eventMult zaten okur
state.events = { active: [{ id, kind, startMin, untilMin, data }], history: [...son 20], festival: { lastYearSeason } }
```
### Kurallar (gameplay-dev)
- **WeatherSystem:** 05:00'te tahminden bugünün havası (PERSISTENCE + mevsim dağılımı, ctx.rng), tahmin 3 güne tamamlanır; gün içinde INTRADAY_CHANGE ile öğleden sonra bir değişim. Saatlik: puddles/wetness (yağmurda artar, açıkta kurur), snowCover (kar yağarken artar, sıcak mevsimde/açıkta erir). `weather:changed {type, intensity, wind}` (mevcut debug setWeather ile uyumlu). Kar: açık alan ekin büyümesi durur (soil/growth), Fırtına: EFFECTS.storm ekin hasarı + hayvan mutluluğu. Kuraklık olayı aktifken yağmur çıkmaz, nem kaybı ×1.5.
- **EventSystem:** 06:00'da EVENTS (chance, seasons, summerMult, 'edge'); aktif aynı tür tekrar çıkmaz. Etkiler: priceMult → `market.activeEvents` (pricing zaten uygular), cropDamage (açık alan ekinleri; frost yalnız frostHardy olmayan), sickChanceMult (AnimalSystem okur), pestChanceMult (farm threats okur), subsidy → `transact(+grant,'other')` + PlacementSystem inşa bedelinde %20 indirim (aktifken). `event:started {id, kind, title, text}`, `event:ended`. Festival: her mevsimin 21. günü 10:00 → `festival:open`; oyuncu panelde envanterden bir ürün seçer (`festival:enter {itemId, q}`) → puan = pazar değeri × kalite; rakipler rng; ödül `transact(+,'contracts')` + itibar; `festival:result {rank, prize}`. 12:00'ye kadar seçmezse katılmamış sayılır.
- **UI:** HUD saat kartının altında 3 günlük tahmin şeridi (ikon + sıcaklık yok, yalnız tür); olay başladığında ortada kısa olay kartı (başlık, metin, etki çipleri, 6 sn veya dokun), aktif olaylar saat kartında küçük çipler; festival paneli (ürün seçimi, sonuç kartı).
### Görsel (visual-dev)
- Yağmur: eğik çizgi parçacıkları (rüzgârla eğim), zeminde sıçrama halkaları, `puddles`'a göre birikinti lekeleri (yumuşak, hafif gök yansıması), `wetness`'e göre zemin ve toprak koyulaşması + ışık kaynaklarında parlama; çatılardan damla.
- Fırtına: yoğun yağmur, güçlü rüzgâr (ekin/ağaç salınımı artar), şimşek: rastgele aralıkla ekran flaşı + gökte çatallı şimşek + 0.5–2 sn sonra kamera hafif sarsıntısı (ses Aşama 9).
- Kar: salınımlı tanecikler; `snowCover`'a göre zemin, çatılar, çit üstleri, ağaç tepeleri beyazlaşır (doku katmanı, tint'e dayanmadan Canvas uyumlu); kışın göl/birikinti yok.
- Sis: yoğun alçak sis katmanı (mevcut sabah sisi altyapısı, gün boyu).
- Bulutlu: güneş yoğunluğu ve gölgeler azalır; kayan bulut gölgeleri (zemin üstünde büyük yumuşak lekeler, rüzgâr yönünde).
- Mevsim: sonbaharda düşen yapraklar parçacığı; kışın kar örtüsü (yağış olmasa da snowCover > 0 iken).
- Olay ipuçları: kuraklıkta zemin hafif sararır, dolu (fırtına + beyaz dolu taneleri), don: sabah zemin ve ekinlerde beyaz kırağı tonu (gün içinde erir).
- Performans: parçacık havuzları, kaliteye göre sayı, update'te bellek ayırma yok.

---

## 15. Aşama 8 Sözleşmesi — Çalışanlar, Makineler, Arazi, Depolama (bağlayıcı, kısa)

Beyin dosyaları: `data/workers.js` (WORKER_TYPES apprentice/experienced/master, MAX_WORKERS, WORKER_NAMES, HIRING), `data/land.js` (PARCELS P2–P4), `data/placeables.js` (greenhouse, coldStorage, warehouse, silo, garage; VEHICLES tractor/harvester/milker), economy.js (fuel, land, vehicles kategorileri).

| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `systems/LandSystem.js` (arazi alımı), `systems/VehicleSystem.js` (traktör/biçerdöver/sağım), Farm (sera karoları: `covered`), Inventory (depo/silo kapasitesi, soğuk hava + silo bozulma çarpanı), Placement (yeni yapıların kuralları), ilgili UI: `ui/landPanel.js`, mağazada 'Makineler' sekmesi, araç çubuğuna traktör/biçerdöver modu |
| engine-dev | WorkerSystem çoklu çalışan: türler, iş ilanı panosu, yetenek/hız/kalite, `plow`/`plant` görevleri, araçla iş (traktör/biçerdöver garajdan alınır), çalışan paneli (liste + tekil kart + ilan panosu) |
| visual-dev | sera (cam, içi görünür ekinler), soğuk hava deposu, depo, silo, garaj; traktör ve biçerdöver (sürüş animasyonu, 3×3 geçiş, egzoz/toz), yetişkin çalışan figürleri (3–4 kıyafet/ten/saç varyantı), satılık parsel tabelaları ve parsel sınırı |
### Kurallar
- **Arazi:** `land:buy {parcelId}` → `transact(-price,'land')` → `state.land.parcels[id].owned = true` → `ensureParcelTiles` + occupancy yenilenir → `land:changed`. Satılık parselde yerleştirme/çapa yapılamaz ("Bu arazi senin değil — satın al"). Emlak vergisi: mevsim sonu `TAX.propertyRate × price` (sahip olunan P2+).
- **Sera:** `covered` yapı; ayak izi içindeki karolar ekilebilir (yapı engeli farm için değil, diğer yerleştirmeler için), bu karolarda mevsim kısıtı yok, don/dolu/fırtına/kar etkilemez, yağmur sulamaz. Kışın 5 kWh/gün.
- **Depolama:** depo +24, silo +12 envanter yuvası (yerleştirilince `inventory.capacity` artar; kaldırma yalnızca dolu yuva sayısı yeni kapasiteye sığıyorsa). Soğuk hava deposu varken tüm bozulma ×0.2 (8 kWh/gün); silo varken `noSpoil` eşyalar bozulmaz.
- **Araçlar:** `shop:buyVehicle {vehicle}` (garaj gerekir; sağım makinesi ahır gerekir) → `state.vehicles = [{ id, type, garageId, condition }]`. Oyuncu araç çubuğunda Traktör seçerse çapa/ekim (seçili tohum) 3×3 alana uygulanır (her karo `farm:action`; yakıt `fuelPerTile` 'fuel'); Biçerdöver: 3×3 içindeki `crops` hasat ×1.25 verim. Sağım makinesi: her sabah 07:00 ahırdaki süt/keçi sütünü envantere taşır, %15 ihtimalle bir kalite üstü; 3 kWh/gün. Görsel için `vehicle:run {type, tiles:[...], driverId?}`.
- **Çalışanlar:** iş ilanı panosu her 7 günde 3 aday (`HIRING`; tür, isim, yetenekler farm/animal/machine 1–5, maaş ±%15). `worker:hire {candidateId}` → `hireCost` 'wages' → çalışan. En fazla `MAX_WORKERS`. Çırak benzersiz ve eşekli kalır. Eylem süresi = `actionMinutes × (1.25 − 0.1 × yetenek) / speedMult`. Usta: hasat ettiği/baktığı ekinin careScore'una +10. Yeni görevler: `plow` (işaretli karo yok → oyuncunun işaretlediği "sürülecek" alan: araç çubuğunda yeni **İşaretle** aleti `farm:mark {tileId, plan:'plow'|'plant', itemId?}`), `plant` (işaretli karo + envanterde tohum). Traktör garajdaysa ve çalışanın makine yeteneği ≥ 3 ise 3×3 iş için traktörü alır. Çalışanlar birbirinin rezerve ettiği işi almaz.

---

## 16. Gece İstilası Modu (K29) — Sözleşme (bağlayıcı, kısa)

Beyin dosyaları: `data/defense.js` (RAID_MODE, RAID_SCHEDULE, WAVES, MONSTERS, DAMAGE, DEFENSES, SOLDIERS, MAX_SOLDIERS, SOLDIER_NAMES), `placeables.js` (DEFENSES → 'defense' kategorisi, `BUILD_CATS` içinde `raidOnly`), economy.js (defense, repairs, soldiers, loot).
Mod: `state.settings.raids` (boolean). Kapalıyken DefenseSystem hiçbir şey yapmaz, savunma kategorisi ve asker paneli gizlidir; mevcut savunma yapıları durur ama etkisizdir.

| İşçi | Dosyalar |
|---|---|
| gameplay-dev | `systems/DefenseSystem.js` (+ `systems/defense/*`: raid.js, monsters.js, combat.js, soldiers.js), occupancy'ye savunma engelleri (canavar yolu için ayrı ızgara), Placement'a yapı hp'si ve onarım, `tools/sim-defense.mjs`, main.js kaydı |
| visual-dev | `world/MonsterView.js`, `world/SoldierView.js`, `world/DefenseView.js` (telli çit, taş duvar, tuzak, meşale, kule), baskın atmosferi (kızıl ay, koyu mavi-mor gece tonu, yerden sis), savaş efektleri, hasar görselleri |
| ui-dev | Mod seçimi (Ayarlar anahtarı + Yeni oyun onayında "Gece İstilası" seçeneği), baskın uyarı bandı (19:00), gece HUD (dalga, kalan canavar, ev canı), sabah hasar raporu kartı, `ui/soldierPanel.js` (kirala/çıkar/maaş), bina/makine panellerinde **Onar** düğmesi, İnşa kataloğunda 'Savunma' sekmesi (mod açıkken) |

### State
```js
state.settings.raids = false
state.defense = { nightPlanned: false, bloodMoon: false, wave: 0, wavesLeft: 0, nextWaveMin: null, houseHp, houseMax,
                  monsters: [{ id, type, x, y, hp, targetId, state:'walk'|'attack', path }],
                  soldiers: [{ id, type, name, hp, x, y, state:'sleep'|'patrol'|'fight'|'down', towerId? }],
                  stats: { nights, kills, lootTotal }, lastReport: null | { day, kills, loot, damaged:[...], houseDamage } }
state.placed[i].hp / .maxHp / .ruined   // savunma ve tüm yapılar (mod açıkken)
```
### Kurallar (gameplay-dev)
- **Takvim:** her gün 19:00'da (mod açık, gün ≥ firstDay) baskın kararı: şans = min(max, base + gün × perDay); her 14. gün kızıl ay (kesin, canavar ×1.6). Karar varsa 19:00 `raid:warning {bloodMoon}`; 21:00 `raid:start`; WAVES.perNight dalga, aralarında gapMinutes; tüm canavarlar ölünce veya 04:30'da `raid:end` → sabah 06:00 `raid:report`.
- **Doğma:** sahip olunan arazinin dışındaki karolardan (arazi sınırına 2–6 karo uzak, rastgele kenar), ctx.rng.
- **Yapay zekâ:** hedef = `targets` önceliğine göre en yakın (ekin karosu, hayvan binası, ev, diğer yapı). Yol: canavar ızgarası (engel: duvar/telli çit/yapılar; hayalet engelleri yok sayar) üzerinde A*; yol yoksa en yakın engel (çit/duvar) hedef olur ve kırılır. Hareket oyun dakikası tabanlı; ekin karosuna basınca cropTrample hasarı (karo başına bir kez/gece).
- **Savaş:** canavar saldırısı hedef hp'sini düşürür (`rate` × dakika); telli çite saldıran canavar contactDmg alır; tuzak karosuna giren trapDmg alır (uses azalır, 0 → kırık, Onar ile yenilenir); meşale yarıçapında zombi ×0.5 hız, hayalet yaklaşmaz (kaçar). Kule menzildeki en yakın canavara `dmg × rate` (içinde okçu varsa × mannedMult). Askerler gece 20:30–05:00 evin çevresinde devriye, en yakın canavara gider, menzildeyse vurur; okçu boş kuleye yerleşir. Asker hp 0 → `down` (sabah iyileşir). Öldürülen canavar `reward` ₺ (`transact(+,'loot')`), `monster:killed {x,y,reward}`.
- **Hasar:** yapı hp 0 → `ruined` (işlevsiz: hayvan binası üretmez, makine çalışmaz, kule ateş etmez); ev hp 0 → sabah paranın %10'u kaybedilir. Onarım: `defense:repair {placedId}` → `transact(-maliyet,'repairs')`; ev: `defense:repairHouse`. Sabah raporu: öldürülen, ganimet, hasarlı/harap yapılar, ev hasarı.
- **Askerler:** `soldier:hire {type}` (hireCost 'soldiers'), maaş her gün 20:00 'soldiers'; para yetmezse o gece nöbet tutmaz (toast). `soldier:fire`. En fazla MAX_SOLDIERS.
- Olaylar: `raid:warning/start/wave/end/report`, `monster:spawned/killed`, `defense:changed`, `defense:hit {x,y,kind}`, `soldiers:changed`. Tüm rastgelelik ctx.rng; mod kapalıyken sistem erken döner.
### Görsel (visual-dev)
- Canavarlar sevimli-ürkütücü: **zombi** (yeşilimsi, kambur, kollar önde, sallanan yürüyüş), **iskelet** (krem kemikler, takırdayan hızlı yürüyüş), **hayalet** (yarı saydam, süzülen, kuyruklu); hepsinde parlayan gözler (bloom), gölge, depthForY; vurulunca beyaz flaş + geri itme; ölünce toz/duman + küçük sikke parıltısı (kan yok).
- Askerler: bekçi (mızrak, deri zırh), okçu (yay, kapüşon), şövalye (zırh, kalkan); devriye/saldırı/bayılma (yere oturur, yıldızlar) animasyonları; okçu kulede.
- Savunmalar: telli çit (direkler + dikenli tel, komşulara bağlanır), taş duvar (birleşen taş blok), kazık tuzağı (zemine gömülü), meşale (alev + ışık, bloom), gözcü kulesi (ahşap, çatılı, ok atış animasyonu: ok mermisi izi). Hasar: çatlak/is katmanı, harap: kırık/eğik + duman.
- Atmosfer: baskın gecesi kızıl ay (kızıl ayda daha büyük ve kırmızı), ambient koyu mor-mavi, yerden sis, uzaktan gelen canavarların gözleri; şafakta yumuşak geçiş. 19:00 uyarısında gök hafif kızıllaşır.
