// Canavar ızgarası ve yol bulma — PLAN §16. Phaser/bus yok. Ayrı ızgara: işçi ızgarasından (occupancy.walkGrid) türetilir;
// kazık tuzağı ve harap çit/duvar zaten geçilebilirdir. Kırılabilir engel (çit/telli çit/taş duvar) ayrıca işaretlenir.
// A*: önce kırılabilir engeller kapalı; yol yoksa kırılabilirler "pahalı ama geçilebilir" açılır (ilk engel hedef olur).
import { WORLD_TILES_X as GW, WORLD_TILES_Y as GH } from '../../core/constants.js';
import { PLACEABLES } from '../../data/placeables.js';
import { MONSTER_AREA, DEFENSES } from '../../data/defense.js';
import { parcelAt } from '../../data/land.js';
import * as occ from '../world/occupancy.js';

export const N = GW * GH;
export { GW, GH };
export const blocked = new Uint8Array(N);          // 1: aşılamaz (kırılabilir engeller dahil)
export const breakOwner = new Int16Array(N).fill(-1); // kırılabilir (harap olmayan) engelin placed dizini
export const trapOwner = new Int16Array(N).fill(-1);  // tuzağın placed dizini
export const lights = [];                              // meşaleler: {i (placed dizini), u, v, r}
export let gen = 0;                                    // ızgara her yeniden kurulduğunda artar (yol önbelleği)
let seenVer = -1, seenState = null, seenPlaced = null;

export const isBreakable = (type) => type === 'fence' || !!DEFENSES[type]?.blocks;

/** Doluluk değiştiyse ızgarayı yeniden kurar. @returns {boolean} yeniden kuruldu mu */
export function sync(state) {
  const v = occ.version(state);
  if (state === seenState && v === seenVer && seenPlaced === state.placed) return false;
  seenState = state; seenVer = v; seenPlaced = state.placed; gen++;
  blocked.set(occ.walkGrid(state));
  // K30: canavarlar kuzey şeridine (ufuk yamacı, evin arkası) giremez ve oradan doğmaz
  for (let y = 0; y < Math.min(GH, MONSTER_AREA.minTy); y++) for (let x = 0; x < GW; x++) blocked[y * GW + x] = 1;
  breakOwner.fill(-1); trapOwner.fill(-1); lights.length = 0;
  const placed = state.placed || [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i], def = PLACEABLES[p.type];
    if (!def) continue;
    const d = DEFENSES[p.type];
    if (d && d.trap) { trapOwner[p.ty * GW + p.tx] = i; continue; }
    if (d && d.light) lights.push({ i, u: p.tx + 0.5, v: p.ty + 0.5, r: d.light });
    if (isBreakable(p.type) && !p.ruined) breakOwner[p.ty * GW + p.tx] = i;
  }
  cache.clear();
  return true;
}

// ---------------------------------------------------------------- doğma karoları
let spawnKey = '', spawnList = [];
function owned(state, tx, ty) {
  const id = parcelAt(tx, ty);
  if (!id) return false;
  if (id === 'P1') return true;
  const o = (state.land?.parcels || []).find((p) => p.id === id);
  return !!(o && o.owned);
}
/** Sahip olunan arazinin 2–6 karo dışındaki yürünebilir karolar (önbellekli; arazi değişince yenilenir). */
export function spawnCells(state) {
  sync(state);
  const key = (state.land?.parcels || []).filter((p) => p.owned).map((p) => p.id).join(',') + `|${gen}`;
  if (key === spawnKey) return spawnList;
  spawnKey = key;
  const own = new Uint8Array(N);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (owned(state, x, y)) own[y * GW + x] = 1;
  const out = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = y * GW + x;
    if (own[c] || blocked[c]) continue;
    let d = 99;
    for (let dy = -6; dy <= 6 && d > 1; dy++) for (let dx = -6; dx <= 6; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= GW || Y >= GH || !own[Y * GW + X]) continue;
      const k = Math.max(Math.abs(dx), Math.abs(dy));
      if (k < d) d = k;
    }
    if (d >= 2 && d <= 6) out.push(c);
  }
  if (!out.length) { // tüm arazi senin: dünya kenarı
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if ((x === 0 || y === 0 || x === GW - 1 || y === GH - 1) && !blocked[y * GW + x]) out.push(y * GW + x);
  }
  spawnList = out;
  return out;
}

// ---------------------------------------------------------------- A*
const gS = new Float32Array(N), par = new Int16Array(N);
const stO = new Uint32Array(N), stC = new Uint32Array(N);
let stamp = 0;
const CAP = N * 8;
const hC = new Int16Array(CAP), hF = new Float32Array(CAP);
let hn = 0, popF = 0;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
const BREAK_COST = 6;

function push(c, f) {
  if (hn >= CAP) return;
  let i = hn++;
  while (i > 0) { const p = (i - 1) >> 1; if (hF[p] <= f) break; hC[i] = hC[p]; hF[i] = hF[p]; i = p; }
  hC[i] = c; hF[i] = f;
}
function pop() {
  const top = hC[0]; popF = hF[0]; hn--;
  if (hn > 0) {
    const c = hC[hn], f = hF[hn]; let i = 0;
    for (;;) {
      let l = 2 * i + 1; if (l >= hn) break;
      if (l + 1 < hn && hF[l + 1] < hF[l]) l++;
      if (hF[l] >= f) break;
      hC[i] = hC[l]; hF[i] = hF[l]; i = l;
    }
    hC[i] = c; hF[i] = f;
  }
  return top;
}

const cache = new Map();
const EMPTY = [];
const ok = (c, goal, brk) => c === goal || blocked[c] === 0 || (brk && breakOwner[c] >= 0);

/** start→goal hücre dizisi (başlangıç hariç, hedef dahil; hedef engelli olsa bile girilebilir). Yol yoksa null. */
export function findPath(state, start, goal, allowBreak) {
  sync(state);
  if (start === goal) return EMPTY;
  const key = (start * N + goal) * 2 + (allowBreak ? 1 : 0);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size > 600) cache.clear();
  const gx = goal % GW, gy = (goal / GW) | 0;
  stamp++; hn = 0;
  gS[start] = 0; stO[start] = stamp; par[start] = -1;
  push(start, 0);
  let found = false;
  while (hn > 0) {
    const c = pop();
    if (stC[c] === stamp) continue;
    stC[c] = stamp;
    if (c === goal) { found = true; break; }
    const cx = c % GW, cy = (c / GW) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (stC[n] === stamp || !ok(n, goal, allowBreak)) continue;
      if (k >= 4 && (!ok(cy * GW + nx, goal, allowBreak) || !ok(ny * GW + cx, goal, allowBreak))) continue; // köşe kesme yok
      const g = gS[c] + (k >= 4 ? 1.4142 : 1) + (blocked[n] === 1 && n !== goal ? BREAK_COST : 0);
      if (stO[n] !== stamp || g < gS[n]) {
        stO[n] = stamp; gS[n] = g; par[n] = c;
        const ax = Math.abs(nx - gx), ay = Math.abs(ny - gy);
        push(n, g + (ax + ay) - 0.5858 * Math.min(ax, ay));
      }
    }
  }
  let res = null;
  if (found) {
    let len = 0;
    for (let c = goal; c !== start; c = par[c]) len++;
    res = new Array(len);
    for (let c = goal, i = len - 1; c !== start; c = par[c], i--) res[i] = c;
  }
  cache.set(key, res);
  return res;
}
