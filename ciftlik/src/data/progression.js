// Seviye ve XP — PLAN.md §4 "Seviye ve itibar".
// Bir sonraki seviyeye gereken XP: floor(100 × seviye^1.6)  (seviye 1→2: 100, 2→3: 303, 3→4: 580 …)
export const MAX_LEVEL = 20;
export function xpToNext(level) { return Math.floor(100 * Math.pow(level, 1.6)); }

export const XP_RULES = {
  harvestPerValue: 0.1,   // hasat edilen ürünün B-pazar değeri × bu
  salePerValue: 0.02,     // satış hasılatı × bu
  plow: 1, plant: 1,
};

// Seviye açılımları (UI'da "Seviye N: …" olarak gösterilir). Aşama 3'te mağaza ürünleri ve toptancı etkin;
// diğerleri ilgili aşamada devreye girer.
export const UNLOCKS = {
  2: ['Çilek ve ayçiçeği tohumu', 'Zirai ilaç', 'Kümes (Aşama 4)'],
  3: ['Toptancı', 'Kabak ve üzüm tohumu', 'Yeni arazi P2 (Aşama 8)'],
  4: ['Karpuz tohumu', 'Ahır (Aşama 4)'],
  5: ['Mandıra ve değirmen (Aşama 5)'],
  7: ['Sera (Aşama 8)'],
  8: ['Traktör (Aşama 8)'],
  10: ['Dokuma tezgâhı (Aşama 5)'],
  12: ['Biçerdöver (Aşama 8)'],
};

// Envanter
export const INVENTORY = { startSlots: 24, stackMax: 99 };
