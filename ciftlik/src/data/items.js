// Eşya tanımları. category: 'seed' | 'fertilizer' | 'chemical' | 'crop' | 'tool'.
// price: mağaza alış fiyatı (Aşama 3). Ürünlerin satış fiyatı crops.js basePrice'tan gelir.
import { CROPS } from './crops.js';

export const ITEMS = {
  compost:        { name: 'Kompost',          category: 'fertilizer', price: 10, effect: { n: 10, p: 6, k: 6, ph: 0, slowDays: 3 }, organic: true,  color: '#6b4a2b' },
  npk:            { name: 'NPK Gübre',        category: 'fertilizer', price: 35, effect: { n: 25, p: 20, k: 20, ph: -0.1, slowDays: 0 }, organic: false, color: '#5b8fd1' },
  lime:           { name: 'Kireç',            category: 'fertilizer', price: 25, effect: { n: 0, p: 0, k: 0, ph: 0.4, slowDays: 0 }, organic: true, color: '#e8e4d8' },
  pesticide:      { name: 'Zirai İlaç',       category: 'chemical',   price: 45, effect: { efficacy: 0.95, targets: ['pest', 'disease'] }, organic: false, color: '#d14b4b' },
  organic_spray:  { name: 'Organik Sprey',    category: 'chemical',   price: 25, effect: { efficacy: 0.65, targets: ['pest', 'disease'] }, organic: true,  color: '#6fbf6a' },
};

// Her ürün için tohum ve hasat eşyası türetilir: seed_<id>, <id>
for (const [id, c] of Object.entries(CROPS)) {
  ITEMS[`seed_${id}`] = { name: `${c.name} Tohumu`, category: 'seed', price: c.seedPrice, crop: id, color: c.accent };
  ITEMS[id] = { name: c.name, category: 'crop', basePrice: c.basePrice, crop: id, color: c.accent };
}

// Aletler (envanterde değil, araç çubuğunda her zaman var)
export const TOOLS = ['hand', 'hoe', 'seed', 'water', 'fertilize', 'treat', 'weed', 'harvest'];
export const TOOL_NAMES_TR = {
  hand: 'İncele', hoe: 'Çapa', seed: 'Ek', water: 'Sula', fertilize: 'Gübrele', treat: 'İlaçla', weed: 'Ot temizle', harvest: 'Hasat',
};

// Yeni oyun başlangıç envanteri — PLAN §4 "Başlangıç"
export const STARTING_INVENTORY = [
  { itemId: 'seed_lettuce', qty: 10, quality: 'B' },
  { itemId: 'seed_potato', qty: 6, quality: 'B' },
  { itemId: 'compost', qty: 10, quality: 'B' },
];
