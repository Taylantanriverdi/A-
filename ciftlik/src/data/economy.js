// Pazar ve ekonomi parametreleri — PLAN.md §4 "Pazar ve dinamik fiyat". Denge değerleri yalnızca burada.
// fiyat = baz × mevsim × olay × doygunluk × gürültü × kalite × organik × kanal
import { CROPS } from './crops.js';

export const START_MONEY = 5000;

// Mevsim çarpanı: ürünün kendi mevsiminde 1.0; mevsim dışında (depodan/seradan) daha pahalı.
export const OFF_SEASON_MULT = { spring: 1.45, summer: 1.40, autumn: 1.45, winter: 1.60 };
export function seasonMult(cropId, season) {
  const c = CROPS[cropId];
  if (!c) return 1;
  return c.seasons.includes(season) ? 1.0 : OFF_SEASON_MULT[season];
}

export const SATURATION = {
  perUnit: { market: 0.004, wholesale: 0.002 }, // satılan her birim doygunluğu ×(1 − perUnit) yapar
  recoverPerDay: 0.15,                            // her gün açığın bu oranı kapanır (1'e doğru)
  min: 0.5,
};

export const NOISE = { dailyStep: 0.04, min: 0.85, max: 1.15 }; // günlük rastgele yürüyüş

export const CHANNELS = {
  market:    { name: 'Pazar yeri', mult: 0.85, dailyLimitPerItem: 40, minLot: 1,  payDelayDays: 0, level: 1 },
  wholesale: { name: 'Toptancı',   mult: 0.95, dailyLimitPerItem: Infinity, minLot: 50, payDelayDays: 1, payHour: 8, level: 3 },
};

export const PRICE_HISTORY_DAYS = 28;

// Defter kategorileri (EconomySystem.transact category)
export const LEDGER_CATEGORIES = {
  sales: 'Satış', wholesale: 'Toptan satış', seeds: 'Tohum', fertilizer: 'Gübre', chemicals: 'İlaç',
  buildings: 'Bina', animals: 'Hayvan', electricity: 'Elektrik', maintenance: 'Bakım', wages: 'Maaş', other: 'Diğer',
};
export const LEDGER_MAX_ENTRIES = 500;
