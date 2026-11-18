// Doluluk ızgarası — PLAN.md §12 (Aşama 5b). Saf: Phaser/bus yok. Önbellek state nesnesine (WeakMap) bağlıdır;
// PlacementSystem değişiklikte `invalidate(state)` çağırır (placed:changed ile aynı anda).
import { WORLD_TILES_X as GW, WORLD_TILES_Y as GH, TILE_W, TILE_H } from '../../core/constants.js';
import { P1_BLOCKED, PARCELS, BLOCK_LABELS_TR, parcelAt } from '../../data/land.js';
import { PLACEABLES } from '../../data/placeables.js';
import { TREES, BUSHES } from '../../render/layout.js';

const F_PLACED = 1;  // yerleştirilmiş, yürünemez
const F_WALK = 2;    // yerleştirilmiş, yürünebilir (patika)
const F_DECOR = 4;   // temizlenmemiş ağaç/çalı
const F_FIXED = 8;   // P1_BLOCKED (ev vb.), yürünemez
const F_FIXWALK = 16; // P1_BLOCKED 'path' — yürünebilir
const F_GLASS = 32;  // sera ayak izi: ekilebilir (farm için engel değil), yürünebilir

// Sabit dekor ayak izleri (saf veri; 1×1): { id, kind, tx, ty }
export const DECOR = [];
TREES.forEach((t, i) => DECOR.push({ id: `tree_${i}`, kind: 'tree', tx: Math.floor(t[0] / TILE_W), ty: Math.floor(t[1] / TILE_H) }));
BUSHES.forEach((b, i) => DECOR.push({ id: `bush_${i}`, kind: 'bush', tx: Math.floor(b[0] / TILE_W), ty: Math.floor(b[1] / TILE_H) }));
export const decorById = (id) => DECOR.find((d) => d.id === id) || null;

const FIXED = [];
for (const k in P1_BLOCKED) { const [x, y] = k.split(',').map(Number); FIXED.push({ x, y, kind: P1_BLOCKED[k] }); }

const caches = new WeakMap();
let versionSeq = 0;

export function invalidate(state) { caches.delete(state); }

function build(state) {
  const flags = new Uint8Array(GW * GH);
  const owner = new Int16Array(GW * GH).fill(-1);  // placed dizini
  const decor = new Int16Array(GW * GH).fill(-1);  // DECOR dizini
  const walkBlocked = new Uint8Array(GW * GH);
  const fixedKind = new Map();
  for (const f of FIXED) {
    if (f.x < 0 || f.y < 0 || f.x >= GW || f.y >= GH) continue;
    flags[f.y * GW + f.x] |= f.kind === 'path' ? F_FIXWALK : F_FIXED;
    fixedKind.set(f.y * GW + f.x, f.kind);
  }
  const removed = new Set(Array.isArray(state.removedDecor) ? state.removedDecor : []);
  DECOR.forEach((d, i) => {
    if (removed.has(d.id) || d.tx < 0 || d.ty < 0 || d.tx >= GW || d.ty >= GH) return;
    flags[d.ty * GW + d.tx] |= F_DECOR; decor[d.ty * GW + d.tx] = i;
  });
  const placed = Array.isArray(state.placed) ? state.placed : [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    const def = PLACEABLES[p.type];
    if (!def) continue;
    for (let y = p.ty; y < p.ty + def.h; y++) {
      for (let x = p.tx; x < p.tx + def.w; x++) {
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        const c = y * GW + x;
        flags[c] |= def.walkable ? F_WALK : (def.covered ? (F_PLACED | F_GLASS) : F_PLACED);
        owner[c] = i;
      }
    }
  }
  for (let c = 0; c < GW * GH; c++) {
    const f = flags[c];
    walkBlocked[c] = ((f & F_GLASS) ? (f & (F_DECOR | F_FIXED)) : (f & (F_PLACED | F_DECOR | F_FIXED))) ? 1 : 0;
  }
  const entry = { flags, owner, decor, walkBlocked, fixedKind, version: ++versionSeq, placed };
  caches.set(state, entry);
  return entry;
}
const get = (state) => caches.get(state) || build(state);

export function version(state) { return get(state).version; }
/** Yürüme ızgarası (1 = engelli; patika ve köy yolu geçilebilir). 80×24, satır öncelikli. DEĞİŞTİRME. */
export function walkGrid(state) { return get(state).walkBlocked; }

/**
 * @param {{walk?:boolean}} [opts] walk:true → patika ve köy yolu geçilebilir (yerleştirilmiş çit/yapı yine engel).
 */
export function isBlocked(state, tx, ty, opts = {}) {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return true;
  let f = get(state).flags[ty * GW + tx];
  if ((opts.farm || opts.walk) && (f & F_GLASS)) f &= ~(F_PLACED | F_GLASS); // sera içi: ekim ve yürüyüş için engel değil
  if (opts.walk) return (f & (F_PLACED | F_DECOR | F_FIXED)) !== 0;
  return f !== 0;
}

/** Karo bir seranın (covered yapı) ayak izinde mi? Mevsim/hava muafiyeti için. */
export function isCovered(state, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return false;
  return (get(state).flags[ty * GW + tx] & F_GLASS) !== 0;
}

/** Karodaki nesne: placed kaydı | {decorId, kind, tx, ty} | {fixed:true, kind} | null. */
export function objectAt(state, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return null;
  const e = get(state), c = ty * GW + tx;
  if (e.owner[c] >= 0) return e.placed[e.owner[c]] || null;
  if (e.decor[c] >= 0) { const d = DECOR[e.decor[c]]; return { decorId: d.id, kind: d.kind, tx: d.tx, ty: d.ty }; }
  const fk = e.fixedKind.get(c);
  return fk ? { fixed: true, kind: fk } : null;
}

/** Engel etiketi (Türkçe) — farm kartı / uyarılar için. */
export function labelOf(obj) {
  if (!obj) return null;
  if (obj.type) return PLACEABLES[obj.type]?.name ?? obj.type;
  return BLOCK_LABELS_TR[obj.kind] ?? obj.kind;
}

function inOwnedParcel(state, tx, ty) {
  const id = parcelAt(tx, ty); // K26: organik parsel haritası
  if (!id) return false;
  if (id === 'P1') return true;
  const owned = (state.land?.parcels || []).find((p) => p.id === id);
  return !!(owned && owned.owned);
}

export const NOT_OWNED = 'Bu arazi senin değil — satın al';

export function canPlace(state, type, tx, ty, ignoreId) {
  const def = PLACEABLES[type];
  if (!def || !Number.isInteger(tx) || !Number.isInteger(ty)) return { ok: false, reason: 'Geçersiz yapı' };
  const e = get(state);
  for (let y = ty; y < ty + def.h; y++) {
    for (let x = tx; x < tx + def.w; x++) if (!inOwnedParcel(state, x, y)) return { ok: false, reason: parcelAt(x, y) ? NOT_OWNED : 'Arazinin dışında' };
  }
  for (let y = ty; y < ty + def.h; y++) {
    for (let x = tx; x < tx + def.w; x++) {
      const c = y * GW + x;
      const o = e.owner[c];
      if (e.flags[c] & (F_FIXED | F_FIXWALK | F_DECOR)) return { ok: false, reason: 'Burası dolu' };
      if (o >= 0 && e.placed[o].id !== ignoreId) return { ok: false, reason: 'Burası dolu' };
      const t = state.tiles?.[`${x},${y}`];
      if (t && (t.crop || (t.state && t.state !== 'grass' && !def.covered))) {
        return { ok: false, reason: type === 'fence' || type === 'path' ? `Ekili/sürülmüş toprağa ${type === 'fence' ? 'çit' : 'patika'} konmaz` : 'Ekili/sürülmüş toprağa yapı konmaz' };
      }
    }
  }
  if (ignoreId == null && def.price > 0 && (Number(state.finance?.money) || 0) < def.price) return { ok: false, reason: 'Yeterli paran yok' };
  return { ok: true };
}

/** Binanın hayvan/gezinme alanı: ayak izinin hemen altında (w+2) × 3; kenardaki tamamen engelli sıra/sütunlar kırpılır. */
export function penOf(state, placedId) {
  const p = (Array.isArray(state.placed) ? state.placed : []).find((q) => q.id === placedId);
  const def = p && PLACEABLES[p.type];
  if (!def) return null;
  let x0 = Math.max(0, p.tx - 1), x1 = Math.min(GW - 1, p.tx + def.w);
  let y0 = p.ty + def.h, y1 = Math.min(GH - 1, p.ty + def.h + 2);
  if (y0 > y1) return null;
  const rowFree = (y) => { for (let x = x0; x <= x1; x++) if (!isBlocked(state, x, y)) return true; return false; };
  const colFree = (x) => { for (let y = y0; y <= y1; y++) if (!isBlocked(state, x, y)) return true; return false; };
  while (y1 > y0 && !rowFree(y1)) y1--;
  while (y0 < y1 && !rowFree(y0)) y0++;
  while (x1 > x0 && !colFree(x1)) x1--;
  while (x0 < x1 && !colFree(x0)) x0++;
  return { x0, x1, y0, y1 };
}
