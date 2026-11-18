// Arazi verisi — parseller ve dekorla kaplı (ekilemez) karolar.
// P1_BLOCKED: render/layout.js'teki ev, kuyu, fener, ağaç gövdesi, çalı ve patika ayak izlerinden
// beyin tarafından hesaplandı (araç: scratchpad blocked.mjs). Dekor yeri değişirse bu liste güncellenir.
// Değer: engel türü → UI etiketi için BLOCK_LABELS_TR.
export const PARCELS = {
  P1: { tx: 32, ty: 6, w: 16, h: 12, price: 0, level: 1 },
};

export const BLOCK_LABELS_TR = {
  house: 'Çiftlik evi', well: 'Kuyu', lamp: 'Fener', tree: 'Ağaç', bush: 'Çalı', path: 'Patika',
};

export const P1_BLOCKED = {
  '32,12': 'bush',
  '32,13': 'bush',
  '33,12': 'bush',
  '33,13': 'bush',
  '35,15': 'tree',
  '35,16': 'tree',
  '36,15': 'tree',
  '36,16': 'tree',
  '37,14': 'well',
  '37,15': 'well',
  '38,14': 'well',
  '38,15': 'well',
  '38,16': 'bush',
  '38,17': 'bush',
  '39,14': 'well',
  '39,15': 'well',
  '39,16': 'bush',
  '39,17': 'bush',
  '40,10': 'bush',
  '40,11': 'bush',
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
  '45,10': 'bush',
  '45,11': 'bush',
  '46,10': 'tree',
  '46,9': 'tree',
  '47,10': 'tree',
  '47,9': 'tree',
};

export function blockedKind(tileId) { return P1_BLOCKED[tileId] ?? null; }
