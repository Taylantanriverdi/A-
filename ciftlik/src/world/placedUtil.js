// Serbest yerleşim (PLAN §12) için görünüm yardımcıları: state.placed arama, kayıt → konum eşleme (eski lotId uyumluluğu),
// ayak noktası ve pen alanı. Saf okuma; çağıranlar nesne geçirir (sıcak yolda bellek ayırmaz).
import { TILE_W, TILE_H } from '../core/constants.js';
import { PLACEABLES } from '../data/placeables.js';
import { BUILDINGS } from '../data/buildings.js';
import { MACHINES } from '../data/recipes.js';
import { penOf } from '../systems/world/occupancy.js';

// Sprite ayak noktası, ayak izinin alt-orta noktasından (px) yukarı doğru kaç px içeride durur.
const INSET = { hive: 6, barn: 8, coop: 10, shed: 8, stall: 18, well: 10 };
export const insetOf = (type) => INSET[type] ?? 10;

export function findPlaced(state, id) {
  const a = state && state.placed; if (!Array.isArray(a) || id == null) return null;
  for (let i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i];
  return null;
}
export function firstPlacedOfType(state, type) {
  const a = state && state.placed; if (!Array.isArray(a)) return null;
  for (let i = 0; i < a.length; i++) if (a[i] && a[i].type === type) return a[i];
  return null;
}
export const sizeOf = (type) => { const d = PLACEABLES[type]; return d ? d : null; };

/** Ayak noktası (dünya px) → out.x/out.y */
export function footOf(type, tx, ty, out) {
  const d = PLACEABLES[type]; const w = d ? d.w : 1, h = d ? d.h : 1;
  out.x = (tx + w / 2) * TILE_W; out.y = (ty + h) * TILE_H - insetOf(type);
  return out;
}

/**
 * Bina/makine kaydının konumu. out: {placedId, tx, ty, w, h, legacy}. Bulunamazsa false.
 * kind 'building' | 'machine'. Önce placedId, sonra (makine) id 'm_<placedId>', sonra eski lotId.
 */
export function locate(state, rec, kind, out) {
  if (!rec) return false;
  let p = rec.placedId != null ? findPlaced(state, rec.placedId) : null;
  if (!p && kind === 'machine' && typeof rec.id === 'string' && rec.id.startsWith('m_')) p = findPlaced(state, rec.id.slice(2));
  if (p) { const d = PLACEABLES[p.type]; out.placedId = p.id; out.tx = p.tx; out.ty = p.ty; out.w = d ? d.w : 1; out.h = d ? d.h : 1; out.legacy = false; return true; }
  // eski kayıt: lot konumu
  let lot = null;
  if (kind === 'building') { const L = BUILDINGS[rec.type] && BUILDINGS[rec.type].lots; if (L) for (let i = 0; i < L.length; i++) if (L[i].id === rec.lotId) { lot = L[i]; break; } }
  else lot = MACHINES[rec.type] ? MACHINES[rec.type].lot : null;
  if (!lot) return false;
  out.placedId = rec.lotId ?? rec.type; out.tx = lot.x0; out.ty = lot.y0; out.w = lot.x1 - lot.x0 + 1; out.h = lot.y1 - lot.y0 + 1; out.legacy = true;
  return true;
}

/** Hayvan gezinme alanı. occupancy.penOf → yoksa ayak izinin altında (w+2)×3 (eski lot'ta lot.pen). out: {x0,x1,y0,y1} */
export function penFor(state, b, loc, out) {
  let pen = null;
  if (!loc.legacy) { try { pen = penOf(state, loc.placedId); } catch { pen = null; } }
  if (pen) { out.x0 = pen.x0; out.x1 = pen.x1; out.y0 = pen.y0; out.y1 = pen.y1; return out; }
  if (loc.legacy) {
    const L = BUILDINGS[b.type] && BUILDINGS[b.type].lots;
    if (L) for (let i = 0; i < L.length; i++) if (L[i].id === b.lotId && L[i].pen) { const q = L[i].pen; out.x0 = q.x0; out.x1 = q.x1; out.y0 = q.y0; out.y1 = q.y1; return out; }
  }
  out.x0 = loc.tx - 1; out.x1 = loc.tx + loc.w; out.y0 = loc.ty + loc.h; out.y1 = loc.ty + loc.h + 2;
  return out;
}

export const easeOutBack = (k) => { const c1 = 1.4, c3 = c1 + 1; const x = k - 1; return 1 + c3 * x * x * x + c1 * x * x; };
export const SLIDE_TIME = 0.38;
