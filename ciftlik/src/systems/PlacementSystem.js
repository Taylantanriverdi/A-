// PlacementSystem — serbest yerleşim (PLAN.md §12). Phaser import ETMEZ.
// Komutlar: build:place {type,tx,ty}, build:move {placedId,tx,ty}, build:remove {placedId}, build:clear {decorId}.
// Olaylar: placed:changed {ids, removed?, decor?}, building:built {type,placedId,tx,ty} (yalnızca bina/atölye/kovan),
//          building:removed {type,placedId}, build:result {ok, kind, reason?, ...}.
import { PLACEABLES, CLEAR_COST, START_LAYOUT, START_FENCE } from '../data/placeables.js';
import { BUILDINGS } from '../data/buildings.js';
import { MACHINES } from '../data/recipes.js';
import { WORLD_TILES_X, WORLD_TILES_Y } from '../core/constants.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { canRemove as animalCanRemove } from './AnimalSystem.js';
import { canRemove as machineCanRemove } from './ProductionSystem.js';
import { canRemove as inventoryCanRemove, recomputeCapacity } from './InventorySystem.js';
import { canRemove as vehicleCanRemove, reassignVehicles } from './VehicleSystem.js';
import * as occ from './world/occupancy.js';
import { buildCostMult } from './events/mods.js';

const BUILT_EVENT = (type) => type in BUILDINGS || type in MACHINES;
let offs = [];

const placedArr = (s) => (Array.isArray(s.placed) ? s.placed : (s.placed = []));
const byId = (s, id) => placedArr(s).find((p) => p.id === id) || null;

function nextId(state) {
  state.flags = isPlainObject(state.flags) ? state.flags : {};
  let seq = Number(state.flags.placedSeq) || 0;
  for (const p of placedArr(state)) { const n = Number(String(p.id).slice(1)); if (n > seq) seq = n; }
  seq++;
  state.flags.placedSeq = seq;
  return `p${seq}`;
}
function addPlaced(state, type, tx, ty) {
  const p = { id: nextId(state), type, tx, ty };
  placedArr(state).push(p);
  return p;
}
function result(bus, p) { if (bus) bus.emit('build:result', p); return p; }
function changed(state, bus, extra = {}) {
  occ.invalidate(state);
  reassignVehicles(state);       // garaj/ahır taşındı veya kaldırıldı
  recomputeCapacity(state);      // depo/silo yuvaları (PLAN §15)
  if (bus) bus.emit('placed:changed', { ids: [], ...extra });
}

// ------------------------------------------------------------------ komutlar
export function place(state, bus, { type, tx, ty } = {}, silent = false) {
  const def = PLACEABLES[type];
  const fail = (reason) => result(bus, { ok: false, kind: 'place', type, reason });
  if (!def) return fail('Geçersiz yapı');
  if (def.unique && placedArr(state).some((p) => p.type === type)) return fail('Bu yapıdan zaten var');
  const c = occ.canPlace(state, type, tx, ty);
  if (!c.ok) return fail(c.reason);
  const price = Math.round(def.price * buildCostMult(state)); // devlet teşviki: %20 indirim (PLAN §14)
  if (price > 0 && !transact(state, bus, { amount: -price, category: 'buildings', label: `İnşaat: ${def.name}` })) return fail('Yeterli paran yok');
  const p = addPlaced(state, type, tx, ty);
  changed(state, bus, { ids: [p.id] });
  if (BUILT_EVENT(type) && bus) bus.emit('building:built', { type, placedId: p.id, tx, ty });
  return result(bus, { ok: true, kind: 'place', type, placedId: p.id, text: `${def.name} yerleştirildi.` });
}

export function move(state, bus, { placedId, tx, ty } = {}) {
  const p = byId(state, placedId);
  const fail = (reason) => result(bus, { ok: false, kind: 'move', placedId, reason });
  if (!p) return fail('Nesne bulunamadı');
  const c = occ.canPlace(state, p.type, tx, ty, p.id);
  if (!c.ok) return fail(c.reason);
  p.tx = tx; p.ty = ty;
  changed(state, bus, { ids: [p.id] });
  return result(bus, { ok: true, kind: 'move', placedId: p.id, type: p.type });
}

export function remove(state, bus, { placedId } = {}) {
  const p = byId(state, placedId);
  const fail = (reason) => result(bus, { ok: false, kind: 'remove', placedId, reason });
  if (!p) return fail('Nesne bulunamadı');
  const def = PLACEABLES[p.type];
  if (def.unique && def.required) return fail('Bu yapı kaldırılamaz');
  for (const chk of [animalCanRemove, machineCanRemove, inventoryCanRemove, vehicleCanRemove]) {
    const c = chk(state, p.id);
    if (c && !c.ok) return fail(c.reason);
  }
  const refund = Math.round(def.price * (def.refund || 0));
  placedArr(state).splice(placedArr(state).indexOf(p), 1);
  if (refund > 0) transact(state, bus, { amount: refund, category: 'buildings', label: `İade: ${def.name}` });
  changed(state, bus, { ids: [], removed: [{ id: p.id, type: p.type }] });
  if (bus) bus.emit('building:removed', { type: p.type, placedId: p.id });
  return result(bus, { ok: true, kind: 'remove', placedId: p.id, type: p.type, refund, text: `${def.name} kaldırıldı.` });
}

export function clear(state, bus, { decorId } = {}) {
  const d = occ.decorById(decorId);
  const fail = (reason) => result(bus, { ok: false, kind: 'clear', decorId, reason });
  if (!d) return fail('Temizlenecek bir şey yok');
  if (!Array.isArray(state.removedDecor)) state.removedDecor = [];
  if (state.removedDecor.includes(decorId)) return fail('Zaten temizlendi');
  const cost = CLEAR_COST[d.kind] || 0;
  if (cost > 0 && !transact(state, bus, { amount: -cost, category: 'buildings', label: d.kind === 'tree' ? 'Ağaç temizleme' : 'Çalı temizleme' })) return fail('Yeterli paran yok');
  state.removedDecor.push(decorId);
  changed(state, bus, { ids: [], decor: [decorId] });
  return result(bus, { ok: true, kind: 'clear', decorId, cost, text: d.kind === 'tree' ? 'Ağaç temizlendi.' : 'Çalı temizlendi.' });
}

// ------------------------------------------------------------------ başlangıç + göç
function freeSpot(state, type, tx, ty) {
  if (occ.canPlace(state, type, tx, ty, '_').ok) return [tx, ty];
  for (let r = 1; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (occ.canPlace(state, type, tx + dx, ty + dy, '_').ok) return [tx + dx, ty + dy];
    }
  }
  return [tx, ty];
}

function seedFence(state) {
  if (!START_FENCE) return; // K26: yeni oyunda dikdörtgen başlangıç çiti yok (organik arazi çiti var)
  const f = START_FENCE, gaps = new Set(f.gaps || []);
  const add = (x, y) => {
    if (gaps.has(`${x},${y}`)) return;
    if (!occ.canPlace(state, 'fence', x, y, '_').ok) return; // ev, dekor, sürülmüş karo vb. atlanır
    addPlaced(state, 'fence', x, y); occ.invalidate(state);
  };
  for (let x = f.x0; x <= f.x1; x++) { add(x, f.y0); add(x, f.y1); }
  for (let y = f.y0 + 1; y < f.y1; y++) { add(f.x0, y); add(f.x1, y); }
}

function migrate(state) {
  for (const b of state.buildings || []) {
    if (!isPlainObject(b) || b.placedId || !b.lotId) continue;
    const lot = BUILDINGS[b.type]?.lots.find((l) => l.id === b.lotId);
    if (!lot) continue;
    b.placedId = addPlaced(state, b.type, lot.x0, lot.y0).id;
  }
  for (const m of state.machines || []) {
    if (!isPlainObject(m) || m.placedId) continue;
    const lot = MACHINES[m.type]?.lot;
    if (!lot) continue;
    m.placedId = addPlaced(state, m.type, lot.x0, lot.y0).id;
  }
  occ.invalidate(state);
}

/** Zorunlu sabit nesneler (tezgâh, kuyu, sundurma) yoksa varsayılan konuma eklenir; yeni oyun + eski kayıt göçü bayrağa bağlıdır. */
export function ensureStart(state) {
  state.flags = isPlainObject(state.flags) ? state.flags : {};
  if (!Array.isArray(state.placed)) state.placed = [];
  if (!Array.isArray(state.removedDecor)) state.removedDecor = [];
  occ.invalidate(state);
  const first = !state.flags.placementInit;
  if (first) {
    migrate(state);
    seedFence(state);
    state.flags.placementInit = true;
  }
  for (const s of START_LAYOUT) {
    if (state.placed.some((p) => p.type === s.type)) continue;
    const [x, y] = freeSpot(state, s.type, s.tx, s.ty);
    addPlaced(state, s.type, x, y); occ.invalidate(state);
  }
}

// ------------------------------------------------------------------ doğrulama
export function validate(state, onFix = () => {}) {
  if (!Array.isArray(state.placed)) { onFix('placed'); state.placed = []; }
  if (!Array.isArray(state.removedDecor)) { onFix('removedDecor'); state.removedDecor = []; }
  const ids = new Set(), seenUnique = new Set(), kept = [];
  for (const p of state.placed) {
    const def = isPlainObject(p) ? PLACEABLES[p.type] : null;
    const ok = def && typeof p.id === 'string' && !ids.has(p.id) && Number.isInteger(p.tx) && Number.isInteger(p.ty)
      && p.tx >= 0 && p.ty >= 0 && p.tx + def.w <= WORLD_TILES_X && p.ty + def.h <= WORLD_TILES_Y
      && !(def.unique && seenUnique.has(p.type));
    if (!ok) { onFix('placed.item'); continue; }
    ids.add(p.id); if (def.unique) seenUnique.add(p.type);
    kept.push({ id: p.id, type: p.type, tx: p.tx, ty: p.ty });
  }
  state.placed.length = 0; state.placed.push(...kept);
  const dec = new Set();
  state.removedDecor = state.removedDecor.filter((d) => typeof d === 'string' && occ.decorById(d) && !dec.has(d) && dec.add(d));
  occ.invalidate(state);
}

const PlacementSystem = {
  id: 'placement',
  place, move, remove, clear, ensureStart, validate,
  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    ensureStart(state);
    recomputeCapacity(state);
    offs.push(bus.on('build:place', (p) => place(state, bus, p)));
    offs.push(bus.on('build:move', (p) => move(state, bus, p)));
    offs.push(bus.on('build:remove', (p) => remove(state, bus, p)));
    offs.push(bus.on('build:clear', (p) => clear(state, bus, p)));
  },
};
export default PlacementSystem;
