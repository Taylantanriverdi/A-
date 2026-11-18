// Ürün tanımları — PLAN.md §4 "Ürünler" tablosu. Denge değerleri yalnızca burada.
// growDays: ekimden hasada gün. regrowDays: tekrar veren ürünlerde sonraki hasat aralığı (null → tek hasat).
// yield: karo başına ürün adedi. basePrice: B kalite pazar baz fiyatı (Aşama 3 pazar kullanır).
// need: ideal besin seviyesi (0–100). uptake: hasat başına topraktan çekilen puan.
// water: nem ihtiyacı 'low'|'med'|'high' → ideal nem bandı. frostHardy: don/kışa dayanıklı.
// color/accent: görsel ve UI ikonları için ana ve vurgu renkleri.
export const WATER_BANDS = {
  low:  { min: 30, max: 75 },
  med:  { min: 40, max: 85 },
  high: { min: 55, max: 95 },
};

export const CROPS = {
  lettuce:    { name: 'Marul',     seasons: ['spring'],           seedPrice: 15, growDays: 4,  regrowDays: null, yield: 1, basePrice: 45,  water: 'med',  need: { n: 60, p: 35, k: 40 }, uptake: { n: 8,  p: 3, k: 4 }, frostHardy: false, legume: false, color: '#7cc35a', accent: '#c9ec8a', shape: 'leafy' },
  potato:     { name: 'Patates',   seasons: ['spring'],           seedPrice: 25, growDays: 6,  regrowDays: null, yield: 2, basePrice: 50,  water: 'med',  need: { n: 45, p: 55, k: 60 }, uptake: { n: 6,  p: 7, k: 9 }, frostHardy: false, legume: false, color: '#5f9a45', accent: '#c9a26a', shape: 'bush' },
  strawberry: { name: 'Çilek',     seasons: ['spring'],           seedPrice: 60, growDays: 8,  regrowDays: 3,    yield: 3, basePrice: 18,  water: 'high', need: { n: 45, p: 50, k: 55 }, uptake: { n: 3,  p: 3, k: 4 }, frostHardy: false, legume: false, color: '#4f8f3e', accent: '#e8404a', shape: 'berry' },
  wheat:      { name: 'Buğday',    seasons: ['spring', 'autumn'], seedPrice: 8,  growDays: 7,  regrowDays: null, yield: 4, basePrice: 12,  water: 'low',  need: { n: 50, p: 40, k: 40 }, uptake: { n: 7,  p: 4, k: 4 }, frostHardy: true,  legume: false, color: '#9cb850', accent: '#e8c766', shape: 'grain' },
  bean:       { name: 'Fasulye',   seasons: ['spring', 'summer'], seedPrice: 20, growDays: 6,  regrowDays: null, yield: 2, basePrice: 32,  water: 'med',  need: { n: 25, p: 45, k: 45 }, uptake: { n: -15, p: 4, k: 4 }, frostHardy: false, legume: true,  color: '#5aa043', accent: '#a8d45a', shape: 'vine' },
  tomato:     { name: 'Domates',   seasons: ['summer'],           seedPrice: 40, growDays: 8,  regrowDays: 3,    yield: 3, basePrice: 20,  water: 'high', need: { n: 55, p: 55, k: 65 }, uptake: { n: 3,  p: 3, k: 4 }, frostHardy: false, legume: false, color: '#4f8f3e', accent: '#e24a2e', shape: 'vine' },
  corn:       { name: 'Mısır',     seasons: ['summer'],           seedPrice: 30, growDays: 10, regrowDays: null, yield: 2, basePrice: 55,  water: 'med',  need: { n: 70, p: 45, k: 45 }, uptake: { n: 10, p: 5, k: 5 }, frostHardy: false, legume: false, color: '#6aa84f', accent: '#f2c84b', shape: 'tall' },
  watermelon: { name: 'Karpuz',    seasons: ['summer'],           seedPrice: 80, growDays: 12, regrowDays: null, yield: 1, basePrice: 320, water: 'high', need: { n: 50, p: 50, k: 65 }, uptake: { n: 8,  p: 6, k: 10 }, frostHardy: false, legume: false, color: '#4a8a3a', accent: '#2f6b2f', shape: 'melon' },
  sunflower:  { name: 'Ayçiçeği',  seasons: ['summer'],           seedPrice: 20, growDays: 8,  regrowDays: null, yield: 1, basePrice: 90,  water: 'low',  need: { n: 45, p: 45, k: 50 }, uptake: { n: 5,  p: 5, k: 6 }, frostHardy: false, legume: false, color: '#5f9a45', accent: '#f6c032', shape: 'tall' },
  pumpkin:    { name: 'Kabak',     seasons: ['autumn'],           seedPrice: 60, growDays: 11, regrowDays: null, yield: 1, basePrice: 260, water: 'med',  need: { n: 50, p: 55, k: 60 }, uptake: { n: 8,  p: 7, k: 9 }, frostHardy: false, legume: false, color: '#4f8f3e', accent: '#e8862a', shape: 'melon' },
  carrot:     { name: 'Havuç',     seasons: ['autumn'],           seedPrice: 12, growDays: 5,  regrowDays: null, yield: 2, basePrice: 28,  water: 'med',  need: { n: 40, p: 50, k: 55 }, uptake: { n: 4,  p: 5, k: 6 }, frostHardy: true,  legume: false, color: '#6ab04c', accent: '#ef8a2e', shape: 'root' },
  grape:      { name: 'Üzüm',      seasons: ['autumn'],           seedPrice: 70, growDays: 10, regrowDays: 4,    yield: 3, basePrice: 25,  water: 'low',  need: { n: 40, p: 50, k: 60 }, uptake: { n: 3,  p: 3, k: 4 }, frostHardy: false, legume: false, color: '#4a7f3a', accent: '#7a3d8f', shape: 'vine' },
  spinach:    { name: 'Ispanak',   seasons: ['winter'],           seedPrice: 18, growDays: 6,  regrowDays: null, yield: 2, basePrice: 30,  water: 'med',  need: { n: 60, p: 35, k: 40 }, uptake: { n: 7,  p: 3, k: 4 }, frostHardy: true,  legume: false, color: '#3f7f3a', accent: '#6ab04c', shape: 'leafy' },
};

// Büyüme aşamaları: growth (0..1) eşikleri. 0 tohum, 1 filiz, 2 genç, 3 olgunlaşan, 4 hasada hazır.
export const STAGE_THRESHOLDS = [0, 0.12, 0.38, 0.70, 1.0];
export const STAGE_NAMES_TR = ['Tohum', 'Filiz', 'Genç bitki', 'Olgunlaşıyor', 'Hasada hazır'];
// Tekrar veren ürünler hasattan sonra bu aşamaya döner (growth = 0.70) ve regrowDays içinde tekrar hazır olur.
export const REGROW_STAGE = 3;
// Hazır ürün bu kadar gün hasat edilmezse çürür (ölü).
export const ROT_AFTER_DAYS = 3;
