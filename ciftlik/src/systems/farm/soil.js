// Toprak yardımcıları — saf fonksiyonlar (PLAN.md §3, §8). Değerler data/farming.js'ten.
import { SOIL, THREATS } from '../../data/farming.js';
import { PARCELS, blockedKind } from '../../data/land.js';

export const TILE_STATES = ['grass', 'plowed'];

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function tileKey(tx, ty) { return `${tx},${ty}`; }

/** 'x,y' → [x, y] veya null */
export function parseKey(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(',');
  if (i <= 0) return null;
  const x = Number(id.slice(0, i)), y = Number(id.slice(i + 1));
  return Number.isInteger(x) && Number.isInteger(y) ? [x, y] : null;
}

/** Parsel geometrisi data/land.js PARCELS'tan ({tx, ty, w, h}). */
export function parcelOf(tx, ty) {
  for (const id in PARCELS) {
    const r = PARCELS[id];
    if (tx >= r.tx && tx < r.tx + r.w && ty >= r.ty && ty < r.ty + r.h) return id;
  }
  return null;
}

/** state.land.parcels içinde sahip olunan parsel kimlikleri (PARCELS'te tanımlı olanlar). */
export function ownedParcelIds(state) {
  const out = ['P1']; // başlangıç parseli asla kaybedilemez (bozuk land.parcels'a karşı)
  const parcels = state.land?.parcels;
  if (!Array.isArray(parcels)) return out;
  for (let i = 0; i < parcels.length; i++) {
    const p = parcels[i];
    if (p && p.owned === true && PARCELS[p.id] && out.indexOf(p.id) === -1) out.push(p.id);
  }
  return out;
}

export function isOwnedTile(state, tile) {
  const pid = parcelOf(tile.tx, tile.ty);
  if (!pid) return false;
  const parcels = state.land?.parcels;
  if (!Array.isArray(parcels)) return false;
  for (let i = 0; i < parcels.length; i++) if (parcels[i].id === pid) return parcels[i].owned === true;
  return false;
}

/** Dekor (ev, kuyu, ağaç...) altındaki karo türü veya null. */
export function tileBlocked(tileId) { return blockedKind(tileId); }

export function createTile(tx, ty, st = 'grass') {
  const s = SOIL.start;
  return {
    tx, ty, state: st,
    moisture: s.moisture, n: s.n, p: s.p, k: s.k, ph: s.ph,
    weeds: 0, organic: true, history: [], pendingFert: [], idleDays: 0, crop: null,
  };
}

export function clampSoil(t) {
  t.moisture = clamp(t.moisture, 0, 100);
  t.n = clamp(t.n, 0, 100);
  t.p = clamp(t.p, 0, 100);
  t.k = clamp(t.k, 0, 100);
  t.ph = clamp(t.ph, SOIL.phRange[0], SOIL.phRange[1]);
}

/** Saatlik nem: yağışta kazanç, değilse mevsime göre kayıp. */
export function moistureHour(t, season, weatherType) {
  const gain = SOIL.rainGainPerHour[weatherType];
  let m = t.moisture;
  if (gain !== undefined) m += gain;
  else m -= SOIL.moistureLossPerHour[season] ?? 0.6;
  t.moisture = m < 0 ? 0 : m > 100 ? 100 : m;
}

export function water(t) {
  // "Doldurma" semantiği: nemi hedefe çıkarır, asla üstüne çıkarmaz.
  if (t.moisture < SOIL.waterTarget) t.moisture = SOIL.waterTarget;
}

/** Gübre/kireç uygular. item = ITEMS[...] (category 'fertilizer'). */
export function applyFertilizer(t, item) {
  const e = item.effect;
  if (e.slowDays > 0) {
    if (e.n || e.p || e.k) t.pendingFert.push({ n: e.n, p: e.p, k: e.k, daysLeft: e.slowDays });
  } else {
    t.n += e.n; t.p += e.p; t.k += e.k;
  }
  t.ph += e.ph || 0;
  if (item.organic === false) t.organic = false;
  clampSoil(t);
}

/** Kompost yavaş salınımı (günlük). @returns {boolean} değişti mi */
export function releasePending(t) {
  const list = t.pendingFert;
  if (!list.length) return false;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    const d = f.daysLeft > 1 ? f.daysLeft : 1;
    const dn = f.n / d, dp = f.p / d, dk = f.k / d;
    t.n += dn; t.p += dp; t.k += dk;
    f.n -= dn; f.p -= dp; f.k -= dk;
    f.daysLeft -= 1;
    if (f.daysLeft <= 0) list.splice(i, 1);
  }
  clampSoil(t);
  return true;
}

/** Yabani ot besin çalar (günlük): ot yoğunluğu × THREATS.weedNutrientPerDay. */
export function weedSteal(t) {
  if (!(t.weeds > 0)) return;
  const d = t.weeds * THREATS.weedNutrientPerDay;
  t.n = t.n > d ? t.n - d : 0;
  t.p = t.p > d ? t.p - d : 0;
  t.k = t.k > d ? t.k - d : 0;
}

/** Hasat sonrası besin tüketimi (baklagilde negatif uptake.n N ekler) + geçmiş (yalnızca ilk hasatta). */
export function harvestSoil(t, cropId, def, firstHarvest) {
  const u = def.uptake;
  t.n -= u.n; t.p -= u.p; t.k -= u.k;
  clampSoil(t);
  if (firstHarvest) {
    t.history.push(cropId);
    while (t.history.length > 3) t.history.shift();
  }
  t.organic = true;
}
