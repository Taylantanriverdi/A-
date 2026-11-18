// InventorySystem — envanter yığınları (kalite A/B/C). Phaser import ETMEZ.
// state.inventory.items[itemId] = [{ q:'A'|'B'|'C', organic:boolean, qty, age }]  ((q, organic) başına tek yığın)
// Dışa açık saf yardımcılar: add / remove / count (PLAN.md §8). Kapasite kontrolü Aşama 3.
import { ITEMS } from '../data/items.js';
import { isPlainObject } from '../core/GameState.js';

export const QUALITIES = ['A', 'B', 'C'];
const REMOVE_ORDER = ['C', 'B', 'A']; // kalite belirtilmezse önce en düşük kalite harcanır

let busRef = null;
let offs = [];

function itemsOf(state) {
  if (!isPlainObject(state.inventory)) state.inventory = { capacity: 60, items: {} };
  if (!isPlainObject(state.inventory.items)) state.inventory.items = {};
  return state.inventory.items;
}

function emitChanged(itemId, delta, quality, organic) {
  if (busRef && delta !== 0) busRef.emit('inventory:changed', { itemId, delta, quality, organic });
}

function sortStacks(stacks) {
  // A, B, C; aynı kalitede organik olmayan önce
  stacks.sort((a, b) => (a.q === b.q ? (a.organic === b.organic ? 0 : a.organic ? 1 : -1) : a.q < b.q ? -1 : 1));
}

/**
 * Envantere ekler. Yığın anahtarı (q, organic).
 * @returns {number} eklenen adet
 */
export function add(state, itemId, qty, q = 'B', organic = false) {
  const n = Math.floor(Number(qty));
  if (!ITEMS[itemId] || !(n > 0)) return 0;
  const quality = QUALITIES.includes(q) ? q : 'B';
  const org = organic === true;
  const items = itemsOf(state);
  let stacks = items[itemId];
  if (!Array.isArray(stacks)) stacks = items[itemId] = [];
  let st = null;
  for (let i = 0; i < stacks.length; i++) if (stacks[i].q === quality && stacks[i].organic === org) { st = stacks[i]; break; }
  if (st) st.qty += n;
  else { stacks.push({ q: quality, organic: org, qty: n, age: 0 }); sortStacks(stacks); }
  emitChanged(itemId, n, quality, org);
  return n;
}

/**
 * Envanterden düşer. q/organic verilmezse önce organik olmayan, önce düşük kalite (C → B → A).
 * @returns {number} gerçekten düşülen adet
 */
export function remove(state, itemId, qty, q, organic) {
  let need = Math.floor(Number(qty));
  const stacks = itemsOf(state)[itemId];
  if (!(need > 0) || !Array.isArray(stacks)) return 0;
  let removed = 0;
  const qOrder = q ? [q] : REMOVE_ORDER;
  const oOrder = typeof organic === 'boolean' ? [organic] : [false, true];
  for (const oo of oOrder) {
    for (const qq of qOrder) {
      for (let i = stacks.length - 1; i >= 0 && need > 0; i--) {
        const st = stacks[i];
        if (st.q !== qq || st.organic !== oo) continue;
        const take = Math.min(st.qty, need);
        st.qty -= take; need -= take; removed += take;
        if (st.qty <= 0) stacks.splice(i, 1);
        emitChanged(itemId, -take, qq, oo);
      }
      if (need <= 0) break;
    }
    if (need <= 0) break;
  }
  if (stacks.length === 0) delete state.inventory.items[itemId];
  return removed;
}

/** Toplam adet (q ve/veya organic verilirse yalnızca eşleşen yığınlar). */
export function count(state, itemId, q, organic) {
  const stacks = state?.inventory?.items?.[itemId];
  if (!Array.isArray(stacks)) return 0;
  const fo = typeof organic === 'boolean';
  let n = 0;
  for (let i = 0; i < stacks.length; i++) {
    const st = stacks[i];
    if ((!q || st.q === q) && (!fo || st.organic === organic)) n += st.qty;
  }
  return n;
}

/**
 * Kayıt doğrulayıcı: items düz nesne; her değer {q∈A/B/C, organic:boolean, qty>0 tamsayı, age≥0} dizisi.
 * Geçersiz yığınlar atılır, aynı (q, organic) yığınları birleştirilir. Eski kayıtta organic yoksa false.
 */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.inventory)) { onFix('inventory'); state.inventory = { capacity: 60, items: {} }; }
  const inv = state.inventory;
  if (!isPlainObject(inv.items)) { onFix('inventory.items'); inv.items = {}; return state; }
  for (const id of Object.keys(inv.items)) {
    const path = `inventory.items.${id}`;
    const raw = inv.items[id];
    if (!ITEMS[id] || !Array.isArray(raw)) { onFix(path); delete inv.items[id]; continue; }
    const out = [];
    let bad = false;
    for (const st of raw) {
      const ok = isPlainObject(st) && QUALITIES.includes(st.q) && Number.isInteger(st.qty) && st.qty > 0;
      if (!ok) { bad = true; continue; }
      if (!(typeof st.age === 'number' && Number.isFinite(st.age) && st.age >= 0)) { bad = true; st.age = 0; }
      if (typeof st.organic !== 'boolean') { if ('organic' in st) bad = true; st.organic = false; }
      const same = out.find((o) => o.q === st.q && o.organic === st.organic);
      if (same) { same.qty += st.qty; bad = true; } else out.push({ q: st.q, organic: st.organic, qty: st.qty, age: st.age });
    }
    if (bad) onFix(path);
    if (out.length) { sortStacks(out); inv.items[id] = out; } else delete inv.items[id];
  }
  return state;
}

const InventorySystem = {
  id: 'inventory',
  add, remove, count, validate,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    busRef = bus;
    itemsOf(state);
    offs.push(bus.on('inventory:add', (p) => {
      if (!p || !ITEMS[p.itemId]) return;
      add(state, p.itemId, p.qty ?? 1, p.quality ?? 'B', p.organic === true);
    }));
  },
};

export default InventorySystem;
