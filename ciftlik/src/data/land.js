// Arazi verisi — parseller ve dekorla kaplı (ekilemez) karolar.
// P1_BLOCKED: render/layout.js'teki ev, kuyu, fener, ağaç gövdesi, çalı ve patika ayak izlerinden
// beyin tarafından hesaplandı (araç: scratchpad blocked.mjs). Dekor yeri değişirse bu liste güncellenir.
// Değer: engel türü → UI etiketi için BLOCK_LABELS_TR.
export const PARCELS = {
  // K21: başlangıç arazisi genişletildi (serbest yerleşim için) — eski P1 (32,6,16×12) bunun içinde
  P1: { tx: 20, ty: 5, w: 49, h: 17, price: 0, level: 1 },
};

export const BLOCK_LABELS_TR = {
  house: 'Çiftlik evi', well: 'Kuyu', lamp: 'Fener', tree: 'Ağaç', bush: 'Çalı', path: 'Patika',
};

// K21: yalnızca SABİT engeller (çiftlik evi, fener, köy yolu). Kuyu, ağaç, çalı ve tüm yerleştirilenler
// artık dinamik: systems/world/occupancy.js (state.placed + temizlenmemiş dekor).
export const P1_BLOCKED = {
  // K14b: görsel silüet arkası (çatı, kuyu çatısı, ağaç tacı) — QA regresyon Y1/Y2
  '41,6': 'house',
  '41,7': 'house',
  '42,6': 'house',
  '42,7': 'house',
  '43,6': 'house',
  '43,7': 'house',
  '44,6': 'house',
  '44,7': 'house',
  '40,16': 'path',
  '40,17': 'path',
  '41,10': 'house',
  '41,11': 'house',
  '41,14': 'path',
  '41,15': 'path',
  '41,16': 'path',
  '41,17': 'path',
  '41,8': 'house',
  '41,9': 'house',
  '42,10': 'house',
  '42,11': 'house',
  '42,12': 'path',
  '42,13': 'path',
  '42,14': 'path',
  '42,15': 'path',
  '42,8': 'house',
  '42,9': 'house',
  '43,10': 'house',
  '43,11': 'house',
  '43,12': 'path',
  '43,8': 'house',
  '43,9': 'house',
  '44,10': 'house',
  '44,11': 'house',
  '44,8': 'house',
  '44,9': 'house',
};

export function blockedKind(tileId) { return P1_BLOCKED[tileId] ?? null; }
