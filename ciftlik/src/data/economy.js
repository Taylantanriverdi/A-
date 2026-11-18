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
  wholesale: { name: 'Toptancı',   mult: 0.95, dailyLimitPerItem: Infinity, minLot: 50, payDelayDays: 1, payHour: 8, level: 1 },
};

export const PRICE_HISTORY_DAYS = 28;

// Defter kategorileri (EconomySystem.transact category)
export const LEDGER_CATEGORIES = {
  sales: 'Satış', wholesale: 'Toptan satış', seeds: 'Tohum', fertilizer: 'Gübre', chemicals: 'İlaç',
  buildings: 'Bina', animals: 'Hayvan', electricity: 'Elektrik', maintenance: 'Bakım', wages: 'Maaş',
  contracts: 'Sözleşme', loan: 'Kredi', interest: 'Faiz', tax: 'Vergi', penalty: 'Ceza', refund: 'İade', other: 'Diğer',
};
export const LEDGER_MAX_ENTRIES = 500;

// ── Aşama 6 (PLAN §13) ─────────────────────────────────────────────
// Banka: limit = base + netVarlık × assetRatio − mevcut borç. Faiz mevsimlik (28 gün), haftalık eşit taksit.
export const BANK = {
  base: 5000, assetRatio: 0.4,
  seasonRate: 0.06,               // mevsim başına faiz (≈ yıllık %26)
  termsSeasons: [1, 2, 3, 4],     // vade seçenekleri
  installmentEveryDays: 7, payHour: 9,
  lateFeePct: 0.03,               // ödenemeyen taksitin %3'ü eklenir
  maxLatesBeforeFreeze: 3,        // 3 gecikmeden sonra yeni kredi kapalı
  earlyCloseFeePct: 0.01,
  minLoan: 1000,
};

// Varlık değerleme (net varlık için): yapı değeri = inşa bedeli × oran, hayvan = fiyat × oran
export const VALUATION = { buildingPct: 0.6, animalPct: 0.7, inventoryAtMarket: 0.8 };

// Vergiler: mevsim sonunda (28. günün 23:00'ü)
export const TAX = {
  incomeRate: 0.10,               // mevsimin pozitif net kârı üzerinden
  propertyRate: 0.01,             // P1 dışındaki sahip olunan arazi değeri üzerinden (Aşama 8)
  graceSeasons: 1,                // ilk mevsim vergiden muaf
};

// Günlük sabit giderler (kWh/gün) — 20:00'de ödenir, kategori 'electricity'
export const UPKEEP_KWH = { barn: { winter: 6 }, coop: { winter: 2 }, house: { all: 2 } };

// Sözleşmeli siparişler (kategori 'contracts')
export const CONTRACTS = {
  boardSize: 4,                   // panoda aynı anda en fazla teklif
  newOffersPerDay: [1, 2],        // her sabah 07:00 rng ile
  offerExpiresDays: 3,            // kabul edilmezse kaybolur
  deadlineDays: [3, 10],
  qtyByCategory: { crop: [20, 80], animal: [10, 40], processed: [3, 15] },
  rewardMult: [1.35, 1.7],        // pazar fiyatı (B) × adet × çarpan; itibar yükseldikçe üst sınıra yaklaşır
  minQualityChance: { A: 0.25, B: 0.5, C: 0.25 },
  penaltyPct: 0.30,               // süre dolarsa sözleşme değerinin %30'u ceza
  reputation: { start: 10, onComplete: 4, onFail: -6, max: 100 },
  onlyKnownItems: true,           // yalnızca oyuncunun en az bir kez ürettiği/sattığı ürünler (stats) teklif edilir
};
