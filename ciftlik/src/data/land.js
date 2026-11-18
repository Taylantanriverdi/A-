// Arazi verisi — parseller ve dekorla kaplı (ekilemez) karolar.
// P1_BLOCKED: render/layout.js'teki ev, kuyu, fener, ağaç gövdesi, çalı ve patika ayak izlerinden
// beyin tarafından hesaplandı (araç: scratchpad blocked.mjs). Dekor yeri değişirse bu liste güncellenir.
// Değer: engel türü → UI etiketi için BLOCK_LABELS_TR.
export const PARCELS = {
  // K21: başlangıç arazisi genişletildi (serbest yerleşim için) — eski P1 (32,6,16×12) bunun içinde
  P1: { tx: 20, ty: 5, w: 49, h: 17, price: 0, level: 1 },
  // Aşama 8 (PLAN §15): satın alınabilir komşu parseller (emlak vergisi TAX.propertyRate × fiyat / mevsim)
  P2: { tx: 69, ty: 5, w: 11, h: 17, price: 12000, name: 'Doğu tarlası' },
  P3: { tx: 8,  ty: 5, w: 12, h: 17, price: 15000, name: 'Batı çayırı' },
  P4: { tx: 0,  ty: 5, w: 8,  h: 17, price: 9000,  name: 'Dere kenarı' },
  // K25: kuzey ve güney genişleme (dünya yüksekliği 40 karo)
  P5: { tx: 20, ty: 0,  w: 49, h: 5,  price: 8000,  name: 'Kuzey yamacı' },     // ufka bakan dar şerit
  P6: { tx: 20, ty: 22, w: 49, h: 9,  price: 18000, name: 'Güney ovası' },
  P7: { tx: 20, ty: 31, w: 49, h: 9,  price: 22000, name: 'Göl kıyısı' },
  P8: { tx: 0,  ty: 22, w: 20, h: 18, price: 20000, name: 'Güneybatı korusu' },
  P9: { tx: 69, ty: 22, w: 11, h: 18, price: 14000, name: 'Güneydoğu bayırı' },
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

// ── K26: Organik parsel sınırları ─────────────────────────────────────
// Parseller veri olarak dikdörtgen tanımlanır, ama her karonun hangi parsele ait olduğu düşük frekanslı
// gürültüyle bükülmüş koordinatlarla belirlenir → kıvrımlı, düzensiz sınırlar (deterministik, kayıttan bağımsız).
// P1 çekirdeği (ev, tezgâh, sundurma, başlangıç tarlası) her zaman P1'de kalır.
import { WORLD_TILES_X as _GW, WORLD_TILES_Y as _GH } from '../core/constants.js';

export const ORGANIC = { amp: 5.5, period: 7, seed: 1729, p1Core: { x0: 31, x1: 51, y0: 6, y1: 20 }, smoothPasses: 3 };

function _h(x, y, s) { let n = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function _sm(t) { return t * t * (3 - 2 * t); }
function _noise(x, y, s) {
  const P = ORGANIC.period, gx = x / P, gy = y / P, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = _sm(gx - x0), fy = _sm(gy - y0);
  const a = _h(x0, y0, s), b = _h(x0 + 1, y0, s), c = _h(x0, y0 + 1, s), d = _h(x0 + 1, y0 + 1, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy - 0.5; // −0.5..0.5
}

const _IDS = Object.keys(PARCELS);
const _MAP = new Int8Array(_GW * _GH).fill(-1);
(function buildParcelMap() {
  const C = ORGANIC.p1Core, A = ORGANIC.amp * 2;
  for (let ty = 0; ty < _GH; ty++) for (let tx = 0; tx < _GW; tx++) {
    let idx = -1;
    if (tx >= C.x0 && tx <= C.x1 && ty >= C.y0 && ty <= C.y1) idx = _IDS.indexOf('P1');
    else {
      const px = tx + 0.5 + _noise(tx, ty, ORGANIC.seed) * A, py = ty + 0.5 + _noise(tx, ty, ORGANIC.seed + 7) * A;
      let best = Infinity;
      for (let i = 0; i < _IDS.length; i++) {
        const r = PARCELS[_IDS[i]];
        const dx = px < r.tx ? r.tx - px : px > r.tx + r.w ? px - (r.tx + r.w) : 0;
        const dy = py < r.ty ? r.ty - py : py > r.ty + r.h ? py - (r.ty + r.h) : 0;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; idx = i; if (d === 0) break; }
      }
    }
    _MAP[ty * _GW + tx] = idx;
  }
  // Çoğunluk filtresi: tek karoluk adaları/çıkıntıları komşuların çoğunluğuna kat (P1 çekirdeği hariç)
  const tmp = new Int8Array(_MAP.length), cnt = new Int16Array(_IDS.length);
  for (let pass = 0; pass < ORGANIC.smoothPasses; pass++) {
    tmp.set(_MAP);
    for (let ty = 0; ty < _GH; ty++) for (let tx = 0; tx < _GW; tx++) {
      if (tx >= C.x0 && tx <= C.x1 && ty >= C.y0 && ty <= C.y1) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= _GW || y >= _GH) continue;
        cnt[tmp[y * _GW + x]]++;
      }
      let bi = tmp[ty * _GW + tx], bc = cnt[bi];
      for (let i = 0; i < cnt.length; i++) if (cnt[i] > bc) { bc = cnt[i]; bi = i; }
      if (bc >= 5) _MAP[ty * _GW + tx] = bi;
    }
  }
})();

/** Karonun parsel kimliği ('P1'…) ya da dünya dışıysa null. */
export function parcelAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= _GW || ty >= _GH) return null;
  const i = _MAP[ty * _GW + tx];
  return i >= 0 ? _IDS[i] : null;
}
const _TILES = {};
/** Parselin karoları [[tx,ty],…] (önbellekli). */
export function tilesOfParcel(id) {
  if (_TILES[id]) return _TILES[id];
  const out = []; const k = _IDS.indexOf(id);
  for (let ty = 0; ty < _GH; ty++) for (let tx = 0; tx < _GW; tx++) if (_MAP[ty * _GW + tx] === k) out.push([tx, ty]);
  return (_TILES[id] = out);
}
/** Parselin karo sayısı ve ağırlık merkezi (tabela yeri için). */
export function parcelInfo(id) {
  const t = tilesOfParcel(id); let sx = 0, sy = 0;
  for (const [x, y] of t) { sx += x; sy += y; }
  const n = t.length || 1, cx = sx / n, cy = sy / n;
  let best = t[0] || [0, 0], bd = Infinity;            // merkeze en yakın parsel karosu (iç bükey şekillerde dışarı düşmesin)
  for (const [x, y] of t) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
  return { area: t.length, center: { tx: best[0], ty: best[1] } };
}
