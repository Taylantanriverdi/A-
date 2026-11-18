// Görsel yardımcılar: renk, interpolasyon, gün paleti örnekleme. Phaser'a bağımlı değil.
import { DAY_KEYS } from '../data/palette.js';
import { DEPTH } from '../core/constants.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** '#rrggbb' → [r,g,b] 0..1 */
export function hexToRgb(hex, out = [0, 0, 0]) {
  const n = parseInt(hex.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
  return out;
}
export function rgbToInt(c) {
  return ((clamp(Math.round(c[0] * 255), 0, 255) << 16) | (clamp(Math.round(c[1] * 255), 0, 255) << 8) | clamp(Math.round(c[2] * 255), 0, 255));
}
export function intToCss(n) { return '#' + n.toString(16).padStart(6, '0'); }
export function mixRgb(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
export function mulRgb(a, b, out) { out[0] = a[0] * b[0]; out[1] = a[1] * b[1]; out[2] = a[2] * b[2]; return out; }
export function scaleRgb(a, s, out) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
export function copyRgb(a, out) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
export const luma = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/** Y-sıralı nesne derinliği: DEPTH.OBJECTS (50) .. ~61 aralığında kalır, WEATHER (70) altında. */
export { depthForY } from '../core/constants.js';

// --- Gün paleti ---
const MOON_LIGHT = '#9fb4ff';
const KEYS = DAY_KEYS.map((k) => ({
  hour: k.hour,
  skyTop: hexToRgb(k.skyTop), skyBottom: hexToRgb(k.skyBottom), ambient: hexToRgb(k.ambient),
  sun: hexToRgb(k.sun || k.ambient), hasSun: !!k.sun,
  fog: k.fog, shadowAlpha: k.shadowAlpha, light: k.light,
}));
// DAY_KEYS 'sun: null' (21:00) için ışık rengi ambient'ten türetilir; ay rengiyle karışır.
for (const k of KEYS) if (!k.hasSun) mixRgb(k.sun, hexToRgb(MOON_LIGHT), 0.5, k.sun);

export function createDaySample() {
  return { skyTop: [0, 0, 0], skyBottom: [0, 0, 0], ambient: [0, 0, 0], sun: [0, 0, 0], fog: 0, shadowAlpha: 0, light: 0, hour: 0 };
}

/** Saat (ondalıklı) → palet örneği; aralar smoothstep ile karışır, 24 → ilk anahtar. Bellek ayırmaz. */
export function sampleDay(hour, out) {
  const h = ((hour % 24) + 24) % 24;
  const n = KEYS.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) { if (KEYS[k].hour <= h) i = k; else break; }
  const a = KEYS[i];
  const b = KEYS[(i + 1) % n];
  const bh = i + 1 < n ? b.hour : 24 + b.hour;
  let t = (h - a.hour) / (bh - a.hour);
  t = t * t * (3 - 2 * t);
  mixRgb(a.skyTop, b.skyTop, t, out.skyTop);
  mixRgb(a.skyBottom, b.skyBottom, t, out.skyBottom);
  mixRgb(a.ambient, b.ambient, t, out.ambient);
  mixRgb(a.sun, b.sun, t, out.sun);
  out.fog = lerp(a.fog, b.fog, t);
  out.shadowAlpha = lerp(a.shadowAlpha, b.shadowAlpha, t);
  out.light = lerp(a.light, b.light, t);
  out.hour = h;
  return out;
}
