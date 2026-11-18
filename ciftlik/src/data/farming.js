// Toprak ve tarım kuralları — PLAN.md §3 "Toprak modeli". Denge değerleri yalnızca burada.
export const SOIL = {
  start: { moisture: 45, n: 55, p: 50, k: 50, ph: 6.5 },
  moistureLossPerHour: { spring: 0.6, summer: 1.0, autumn: 0.5, winter: 0.3 },
  rainGainPerHour: { rain: 4, storm: 6, snow: 0.5 },
  waterAmount: 60,            // sulama başına nem
  droughtBelow: 20,           // bunun altı kuraklık stresi
  waterlogAbove: 92,          // uzun süre üstünde → kök çürüğü riski
  phIdeal: [6.0, 7.0],
  phRange: [4.5, 8.5],
  rotationPenalty: [1.0, 0.85, 0.70], // aynı ürün art arda 1., 2., 3+ kez
  legumeNBonus: 15,
  grassRecoverDays: 6,        // sürülmüş ama boş karo bu kadar gün sonra yabani ota/çime döner
};

// Büyüme çarpanları
export const GROWTH = {
  moistureFactor: (m, band) => (m < 20 ? 0.2 : m < band.min ? 0.6 : m <= band.max ? 1.0 : 0.85),
  nutrientClamp: [0.5, 1.1],
  phFactor: (ph) => (ph >= 6.0 && ph <= 7.0 ? 1.0 : ph >= 5.5 && ph <= 7.5 ? 0.85 : 0.6),
  outOfSeasonFactor: 0.0,     // mevsim dışı ürün büyümez
};

// Sağlık
export const HEALTH = {
  droughtPerHour: 1.0,
  waterlogPerHour: 0.4,
  pestPerHour: 0.6,           // pest şiddeti 1 iken
  diseasePerHour: 0.8,
  weedsPerHour: 0.25,         // ot yoğunluğu 1 iken (ayrıca besin çalar)
  outOfSeasonOnChange: 60,    // mevsim değişiminde dayanıksız ürüne hasar
  outOfSeasonPerDay: 20,
  recoverPerHour: 0.3,        // koşullar iyiyken
  witherBelow: 40,            // görsel solgunluk
};

// Zararlı, hastalık, yabani ot (günlük olasılık, karo başına)
export const THREATS = {
  pestDaily: 0.015,           // yaz ×2, ekim nöbeti ihlali ×1.5
  diseaseDaily: 0.01,         // nem > 85 ×2.5, sağlık < 50 ×1.5
  weedDaily: 0.03,            // ekili veya sürülmüş karo
  growthPerDay: { pest: 0.25, disease: 0.2, weeds: 0.2 }, // şiddet artışı
  spreadChance: 0.15,         // komşu karoya yayılma (günlük, şiddet > 0.5)
};

// Kalite: careScore (0..100) → sınıf. Fiyat çarpanları Aşama 3 pazar tarafından kullanılır.
export const QUALITY = {
  thresholds: { A: 80, B: 55 },
  priceMult: { A: 1.4, B: 1.0, C: 0.65 },
  organicBonus: 0.15,
};

// Oyuncu eylemleri: XP (Aşama 3+ seviye sistemi kullanır)
export const XP = { harvestPerValue: 0.1, plow: 1, plant: 1 };
