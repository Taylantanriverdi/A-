// Izgara A* (8 yön) — PLAN.md §11. Phaser/bus bağımlılığı yok.
// Izgara 80×24 karo. Engel: occupancy (walk:true).
// Sonuçlar (başlangıç, hedef) çiftine göre önbelleklenir; arama ön ayrılmış typed array'lerle yapılır.
import { WORLD_TILES_X, WORLD_TILES_Y } from '../../core/constants.js';
import { walkGrid, version as occVersion } from '../world/occupancy.js';

export const GW = WORLD_TILES_X;
export const GH = WORLD_TILES_Y;
const N = GW * GH;
const SQ2 = Math.SQRT2;

// Engel kaynağı: world/occupancy (yerleştirilenler + dekor + sabit engeller; patika/köy yolu geçilebilir).
// WorkerSystem.init `bindState` ile state'i bağlar; doluluk değişince (version) yol önbelleği temizlenir.
let boundState = null;
let blocked = new Uint8Array(N);
let seenVersion = -1;
export function bindState(state) { boundState = state; seenVersion = -1; }
function sync() {
  if (!boundState) return;
  const v = occVersion(boundState);
  if (v !== seenVersion) { seenVersion = v; blocked = walkGrid(boundState); cache.clear(); }
}

export const cellOf = (tx, ty) => {
  const x = tx < 0 ? 0 : tx >= GW ? GW - 1 : tx | 0;
  const y = ty < 0 ? 0 : ty >= GH ? GH - 1 : ty | 0;
  return y * GW + x;
};
export const isBlockedCell = (c) => { sync(); return blocked[c] === 1; };
export const isBlocked = (tx, ty) => { sync(); return tx < 0 || ty < 0 || tx >= GW || ty >= GH || blocked[ty * GW + tx] === 1; };

/** (tx,ty)'ye en yakın yürünebilir hücre (halka araması). */
export function nearestFree(tx, ty) {
  tx = Math.round(tx); ty = Math.round(ty);
  if (!isBlocked(tx, ty)) return ty * GW + tx;
  let best = -1, bd = Infinity;
  for (let r = 1; r < 16 && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (isBlocked(x, y)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = y * GW + x; }
      }
    }
  }
  return best < 0 ? cellOf(tx, ty) : best;
}

// ---- A* çalışma belleği (bir kez ayrılır) ----
const g = new Float32Array(N);
const parent = new Int16Array(N);
const openStamp = new Uint32Array(N);
const closedStamp = new Uint32Array(N);
let stamp = 0;
const HEAP_CAP = N * 8;
const heapC = new Int16Array(HEAP_CAP);
const heapF = new Float32Array(HEAP_CAP);
let heapN = 0;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

function push(c, f) {
  if (heapN >= HEAP_CAP) return;
  let i = heapN++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapC[i] = heapC[p]; heapF[i] = heapF[p]; i = p;
  }
  heapC[i] = c; heapF[i] = f;
}
let popF = 0;
function pop() {
  const top = heapC[0];
  popF = heapF[0];
  heapN--;
  if (heapN > 0) {
    const c = heapC[heapN], f = heapF[heapN];
    let i = 0;
    for (;;) {
      let l = i * 2 + 1;
      if (l >= heapN) break;
      if (l + 1 < heapN && heapF[l + 1] < heapF[l]) l++;
      if (heapF[l] >= f) break;
      heapC[i] = heapC[l]; heapF[i] = heapF[l]; i = l;
    }
    heapC[i] = c; heapF[i] = f;
  }
  return top;
}
function heur(c, gx, gy) {
  const dx = Math.abs((c % GW) - gx), dy = Math.abs(((c / GW) | 0) - gy);
  return dx > dy ? dx + (SQ2 - 1) * dy : dy + (SQ2 - 1) * dx;
}

const CACHE_MAX = 512;
const cache = new Map();
export function clearPathCache() { cache.clear(); }

/**
 * Hücre indeksinden hücre indeksine yol. Başlangıç/hedef engelli olsa da kabul edilir.
 * @returns {Int16Array|null} hücre indeksleri (başlangıç dahil); yol yoksa null. Önbellekten gelen dizi DEĞİŞTİRİLMEMELİ.
 */
export function findPath(sc, gc) {
  sync();
  const key = sc * N + gc;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result = null;
  if (sc === gc) result = Int16Array.of(sc);
  else {
    stamp++;
    heapN = 0;
    const gx = gc % GW, gy = (gc / GW) | 0;
    g[sc] = 0; parent[sc] = -1; openStamp[sc] = stamp;
    push(sc, heur(sc, gx, gy));
    let found = false;
    while (heapN > 0) {
      const c = pop();
      if (closedStamp[c] === stamp) continue;
      closedStamp[c] = stamp;
      if (c === gc) { found = true; break; }
      const cx = c % GW, cy = (c / GW) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const n = ny * GW + nx;
        if (closedStamp[n] === stamp) continue;
        if (blocked[n] && n !== gc) continue;
        if (d >= 4 && (blocked[cy * GW + nx] || blocked[ny * GW + cx])) continue; // köşe kesme yok
        const ng = g[c] + (d >= 4 ? SQ2 : 1);
        if (openStamp[n] !== stamp || ng < g[n]) {
          g[n] = ng; parent[n] = c; openStamp[n] = stamp;
          push(n, ng + heur(n, gx, gy));
        }
      }
    }
    if (found) {
      let len = 0;
      for (let c = gc; c !== -1; c = parent[c]) len++;
      result = new Int16Array(len);
      let i = len - 1;
      for (let c = gc; c !== -1; c = parent[c]) result[i--] = c;
    }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}
