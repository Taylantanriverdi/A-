// Büyüme yardımcıları — saf fonksiyonlar (PLAN.md §3 büyüme formülü). Bellek ayırmaz.
import { CROPS, WATER_BANDS, STAGE_THRESHOLDS, REGROW_STAGE } from '../../data/crops.js';
import { SOIL, GROWTH } from '../../data/farming.js';

export const REGROW_GROWTH = STAGE_THRESHOLDS[REGROW_STAGE]; // 0.70

export function inSeason(def, season) { return def.seasons.indexOf(season) !== -1; }

function ratio(v, need, cap) {
  if (!(need > 0)) return cap;
  const r = v / need;
  return r > cap ? cap : r;
}

/** Besin karşılanma ortalaması; her besin `cap` ile sınırlanır. */
export function nutrientRatio(t, def, cap) {
  const nd = def.need;
  return (ratio(t.n, nd.n, cap) + ratio(t.p, nd.p, cap) + ratio(t.k, nd.k, cap)) / 3;
}

/** Büyüme besin faktörü (GROWTH.nutrientClamp aralığında). */
export function nutrientFactor(t, def) {
  const [lo, hi] = GROWTH.nutrientClamp;
  const r = nutrientRatio(t, def, hi);
  return r < lo ? lo : r > hi ? hi : r;
}

export function moistureFactor(t, def) { return GROWTH.moistureFactor(t.moisture, WATER_BANDS[def.water]); }

/** Temel saatlik büyüme (çarpansız). Tekrar veren üründe ilk hasattan sonra regrow hızı. */
export function baseRatePerHour(crop, def) {
  if (crop.harvests > 0 && def.regrowDays) return (1 - REGROW_GROWTH) / (def.regrowDays * 24);
  return 1 / (def.growDays * 24);
}

/** Mevcut koşullarla saatlik büyüme (PLAN §3 formülü). */
export function growthRatePerHour(t, crop, def, season) {
  const sf = inSeason(def, season) ? 1 : GROWTH.outOfSeasonFactor;
  if (sf === 0) return 0;
  return baseRatePerHour(crop, def) * moistureFactor(t, def) * nutrientFactor(t, def)
    * GROWTH.phFactor(t.ph) * sf * (crop.health / 100);
}

export function stageFor(growth) {
  for (let i = STAGE_THRESHOLDS.length - 1; i > 0; i--) if (growth >= STAGE_THRESHOLDS[i] - 1e-9) return i;
  return 0;
}

/** history sonundaki ardışık aynı ürün sayısı. */
export function rotationCount(history, cropId) {
  let c = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === cropId; i--) c++;
  return c;
}

export function rotationMult(history, cropId) {
  const rp = SOIL.rotationPenalty;
  const c = rotationCount(history, cropId);
  return rp[c < rp.length ? c : rp.length - 1];
}

export function cropDef(id) { return CROPS[id]; }
