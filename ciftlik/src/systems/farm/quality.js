// Kalite ve verim — saf fonksiyonlar (PLAN.md §8 careScore, verim).
import { WATER_BANDS } from '../../data/crops.js';
import { QUALITY, XP } from '../../data/farming.js';
import { CROPS } from '../../data/crops.js';
import { nutrientRatio } from './growth.js';

/** Saatlik bakım örneği 0..100: nem bandı 40 + besin 25 + sağlık 20 + tehdit yokluğu 15. */
export function careSample(t, crop, def) {
  const b = WATER_BANDS[def.water];
  const m = t.moisture;
  const mIn = m >= b.min && m <= b.max ? 1 : 0;
  const nut = nutrientRatio(t, def, 1);
  let threat = crop.pest + crop.disease + t.weeds;
  threat = threat > 1 ? 1 : threat;
  return 40 * mIn + 25 * nut + 0.2 * crop.health + 15 * (1 - threat);
}

/** careSum/careCount; örnek yoksa fallback. */
export function careScore(crop, fallback = 100) {
  return crop.careCount > 0 ? crop.careSum / crop.careCount : fallback;
}

export function gradeFor(score) {
  const th = QUALITY.thresholds;
  return score >= th.A ? 'A' : score >= th.B ? 'B' : 'C';
}

/** Beklenen verim (kesirli): yield × rotasyon × (sağlık<50 ? 0.5 : 1). */
export function expectedYield(def, crop) {
  return def.yield * (crop.rot ?? 1) * (crop.health < 50 ? 0.5 : 1);
}

/** Hasat adedi: kesirli kısım rng ile (beklenen değer korunur), en az 1. */
export function harvestYield(def, crop, rng) {
  const v = expectedYield(def, crop);
  const base = Math.floor(v);
  const q = base + (rng.next() < v - base ? 1 : 0);
  return q < 1 ? 1 : q;
}

export function harvestXp(cropId, qty, q) {
  const v = (CROPS[cropId]?.basePrice ?? 0) * qty * (QUALITY.priceMult[q] ?? 1);
  return Math.max(1, Math.round(v * XP.harvestPerValue));
}
