// Sağlık, zararlı, hastalık, yabani ot — saf fonksiyonlar (PLAN.md §3, §8). Rastgelelik yalnızca rng.
import { HEALTH, THREATS, SOIL } from '../../data/farming.js';
import { inSeason } from './growth.js';

/** Saatlik sağlık değişimi (stres yoksa iyileşme). */
export function healthDeltaHour(t, crop, def, season) {
  let d = 0;
  const m = t.moisture;
  if (m < SOIL.droughtBelow) d -= HEALTH.droughtPerHour;
  if (m > SOIL.waterlogAbove) d -= HEALTH.waterlogPerHour;
  d -= HEALTH.pestPerHour * crop.pest + HEALTH.diseasePerHour * crop.disease + HEALTH.weedsPerHour * t.weeds;
  if (d === 0 && (def.frostHardy || inSeason(def, season))) d = HEALTH.recoverPerHour;
  return d;
}

const G = THREATS.growthPerDay;

function grow(v, inc) { const r = v + inc; return r > 1 ? 1 : r; }

/** Yabani ot (sürülmüş karo, ekinli/ekinsiz). @returns {boolean} değişti mi */
export function dailyWeeds(t, rng) {
  if (t.state !== 'plowed') return false;
  if (t.weeds > 0) {
    if (t.weeds >= 1) return false;
    t.weeds = grow(t.weeds, G.weeds);
    return true;
  }
  if (rng.next() < THREATS.weedDaily) { t.weeds = G.weeds; return true; }
  return false;
}

/** Zararlı/hastalık oluşumu ve şiddet artışı (canlı ekin). @returns {number} bit 1: yeni zararlı, 2: yeni hastalık, 4: şiddet değişti */
export function dailyPestDisease(t, crop, season, rng) {
  let r = 0;
  if (crop.pest > 0) { if (crop.pest < 1) { crop.pest = grow(crop.pest, G.pest); r |= 4; } } else {
    let p = THREATS.pestDaily;
    if (season === 'summer') p *= 2;
    if ((crop.rot ?? 1) < 1) p *= 1.5; // ekim nöbeti ihlali
    if (rng.next() < p) { crop.pest = G.pest; r |= 1; }
  }
  if (crop.disease > 0) { if (crop.disease < 1) { crop.disease = grow(crop.disease, G.disease); r |= 4; } } else {
    let p = THREATS.diseaseDaily;
    if (t.moisture > 85) p *= 2.5;
    if (crop.health < 50) p *= 1.5;
    if (rng.next() < p) { crop.disease = G.disease; r |= 2; }
  }
  return r;
}

/**
 * Komşuya yayılma (şiddet > 0.5). src/dst canlı ekinli karolar.
 * @returns {number} bit 1: zararlı yayıldı, 2: hastalık yayıldı
 */
export function spreadTo(src, dst, rng) {
  let r = 0;
  const a = src.crop, b = dst.crop;
  if (a.pest > 0.5 && b.pest === 0 && rng.next() < THREATS.spreadChance) { b.pest = G.pest; r |= 1; }
  if (a.disease > 0.5 && b.disease === 0 && rng.next() < THREATS.spreadChance) { b.disease = G.disease; r |= 2; }
  return r;
}

/** İlaç uygulaması: her hedefte efficacy olasılığıyla sıfırla, değilse yarıya indir. */
export function applyTreatment(crop, item, rng) {
  const e = item.effect;
  let cured = 0, tried = 0;
  for (const key of e.targets) {
    if (!(crop[key] > 0)) continue;
    tried++;
    if (rng.next() < e.efficacy) { crop[key] = 0; cured++; } else crop[key] = crop[key] / 2;
  }
  return { tried, cured };
}
