// Serbest yerleşim kataloğu — PLAN.md §12 (Aşama 5b). Oyuncu her şeyi kendi arazisine yerleştirir, taşır, kaldırır.
// w,h: kaplanan karo (sol-üst köşe tx,ty). price: inşa bedeli (₺). refund: kaldırınca iade oranı.
// paint: sürükleyerek çoklu yerleştirme (çit, patika). link: dokununca açılan panel.
import { BUILDINGS } from './buildings.js';
import { MACHINES } from './recipes.js';
import { ANIMALS } from './animals.js';

export const BUILD_CATS = [
  { id: 'animals', name: 'Hayvancılık' },
  { id: 'workshops', name: 'Atölyeler' },
  { id: 'fences', name: 'Çit ve Yol' },
  { id: 'farm', name: 'Çiftlik' },
];

export const PLACEABLES = {
  coop:   { name: 'Kümes', cat: 'animals', w: 4, h: 3, price: BUILDINGS.coop.price, refund: 0.5, link: { panel: 'building', buildingType: 'coop' } },
  barn:   { name: 'Ahır',  cat: 'animals', w: 6, h: 4, price: BUILDINGS.barn.price, refund: 0.5, link: { panel: 'building', buildingType: 'barn' } },
  hive:   { name: 'Arı kovanı', cat: 'animals', w: 1, h: 1, price: ANIMALS.bee.price, refund: 0.5, link: { panel: 'building', buildingType: 'hive' } }, // fiyata arılar dahil
  ...Object.fromEntries(Object.entries(MACHINES).map(([id, m]) => [id, { name: m.name, cat: 'workshops', w: 4, h: 3, price: m.price, refund: 0.5, link: { panel: 'machine', machine: id } }])),
  // Aşama 8 (PLAN §15)
  greenhouse:   { name: 'Sera', cat: 'farm', w: 6, h: 4, price: 15000, refund: 0.5, covered: true, kwhWinter: 5 },  // içi ekilebilir: mevsimsiz, don/dolu/kar yok
  coldStorage:  { name: 'Soğuk hava deposu', cat: 'farm', w: 4, h: 3, price: 10000, refund: 0.5, kwhPerDay: 8, spoilMult: 0.2 },
  warehouse:    { name: 'Depo', cat: 'farm', w: 4, h: 3, price: 3000, refund: 0.5, slots: 24 },
  silo:         { name: 'Silo', cat: 'farm', w: 2, h: 2, price: 4000, refund: 0.5, slots: 12, noSpoil: ['wheat', 'corn', 'chicken_feed', 'hay'] },
  garage:       { name: 'Garaj', cat: 'farm', w: 4, h: 3, price: 2500, refund: 0.5, link: { panel: 'machines' } },   // traktör/biçerdöver burada durur
  fence:  { name: 'Ahşap çit', cat: 'fences', w: 1, h: 1, price: 5, refund: 1, paint: true },
  path:   { name: 'Taş patika', cat: 'fences', w: 1, h: 1, price: 3, refund: 1, paint: true, walkable: true },
  stall:  { name: 'Pazar tezgâhı', cat: 'farm', w: 3, h: 2, price: 0, refund: 0, unique: true, required: true, link: { panel: 'market' } },
  well:   { name: 'Kuyu', cat: 'farm', w: 2, h: 2, price: 0, refund: 0, unique: true, required: true },
  shed:   { name: 'Eşek sundurması', cat: 'farm', w: 2, h: 2, price: 0, refund: 0, unique: true, required: true, link: { panel: 'worker' } },
};
// unique+required: tek tane vardır, taşınabilir ama kaldırılamaz. Çiftlik evi sabittir (taşınamaz).

// Dekor temizleme (ağaç/çalı; render/layout.js TREES/BUSHES dizinleri → 'tree_i' / 'bush_i')
// Araçlar ve ekipman (mağaza → 'Makineler' sekmesi; garaj gerekir). Yakıt ₺/karo.
export const VEHICLES = {
  tractor:   { name: 'Traktör',    price: 28000, needs: 'garage', area: 3, actions: ['plow', 'plant'], fuelPerTile: 0.6, minutesPerTile: 0.5 },
  harvester: { name: 'Biçerdöver', price: 65000, needs: 'garage', area: 3, actions: ['harvest'], crops: ['wheat', 'corn', 'sunflower', 'bean'], yieldMult: 1.25, fuelPerTile: 1.0, minutesPerTile: 0.6 },
  milker:    { name: 'Sağım makinesi', price: 12000, needs: 'barn', kwhPerDay: 3, autoCollect: ['milk', 'goat_milk'], qualityUpChance: 0.15 },
};

export const CLEAR_COST = { tree: 40, bush: 10 };

// Yeni oyunun başlangıç yerleşimi (eski sabit yerleşimle aynı görünüm)
export const START_LAYOUT = [
  { type: 'stall', tx: 42, ty: 18 },
  { type: 'well',  tx: 38, ty: 14 },
  { type: 'shed',  tx: 48, ty: 16 },
  // eski P1 çiti: karo 32..47 × 6..17 çevresi, patika geçidi (40–41, 17) açık
];
export const START_FENCE = { x0: 32, x1: 47, y0: 6, y1: 17, gaps: ['40,17', '41,17'] };
