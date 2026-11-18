// Güneş ve ay modeli — PLAN.md §2 gölge kuralı, palette.js SUN/MOON değerleri.
// dir: -1 doğu (ekran solu) .. +1 batı (ekran sağı). elevationDeg ufkun altında negatif olabilir.
import { SUN, MOON } from '../data/palette.js';
import { smoothstep } from './util.js';

function body(h, rise, set, maxEl, out) {
  const dur = ((set - rise) + 24) % 24;
  const t = (((h - rise) % 24) + 24) % 24 / dur; // 0 doğuş, 1 batış, >1 ufkun altında
  if (t <= 1) {
    out.elevationDeg = maxEl * Math.sin(Math.PI * t);
    out.dir = -Math.cos(Math.PI * t);
  } else {
    // Ufkun altında: en yakın doğuş/batış anına göre ~12°/saat iner
    const below = (24 - dur);
    const since = (t - 1) * dur; // batıştan beri geçen saat
    const until = below - since; // doğuşa kalan saat
    const d = Math.min(since, until);
    out.elevationDeg = -Math.min(30, d * 12);
    out.dir = since < until ? 1 : -1;
  }
  out.visible = out.elevationDeg > -1.5;
  return out;
}

/** @returns {{visible:boolean, dir:number, elevationDeg:number, intensity:number}} */
export function getSun(hourFloat, out = {}) {
  body(hourFloat, SUN.rise, SUN.set, SUN.maxElevationDeg, out);
  out.intensity = smoothstep(-1.5, 12, out.elevationDeg);
  return out;
}

export function getMoon(hourFloat, out = {}) {
  body(hourFloat, MOON.rise, MOON.set, MOON.maxElevationDeg, out);
  out.intensity = smoothstep(-1.5, 10, out.elevationDeg);
  return out;
}
