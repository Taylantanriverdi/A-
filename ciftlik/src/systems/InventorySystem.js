// InventorySystem — envanter yığınları, kapasite ve bozulma (PLAN.md §8, §9). Phaser import ETMEZ.
// state.inventory = { capacity /* yuva = yığın sayısı */, items: { [itemId]: [{ q:'A'|'B'|'C', organic, qty /* ≤ stackMax */, age }] } }
// Aynı (q, organic) için birden çok yığın olabilir (her biri ≤ stackMax).
// Dışa açık saf yardımcılar: add / remove / count / canAdd / freeSlots / usedSlots / spoilDay / validate.
// Olaylar: inventory:changed {itemId, delta, quality, organic}, inventory:full {itemId}, inventory:spoiled {itemId, fromQ, toQ, qty, changes}.
import { ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { INVENTORY } from '../data/progression.js';
import { isPlainObject } from '../core/GameState.js';

export const QUALITIES = ['A', 'B', 'C'];
const REMOVE_ORDER = ['C', 'B', 'A']; // kalite belirtilmezse önce en düşük kalite harcanır
const NEXT_Q = { A: 'B', B: 'C', C: null };
const LEGACY_CAPACITY = 60;           // Aşama 2 kayıtlarındaki yer tutucu değer
const MIGRATED_FLAG = 'inventorySlotsV2';

let busRef = null;
let offs = [];

const stackMax = () => INVENTORY.stackMax;

function itemsOf(state) {
  if (!isPlainObject(state.inventory)) state.inventory = { capacity: INVENTORY.startSlots, items: {} };
  if (!isPlainObject(state.inventory.items)) state.inventory.items = {};
  return state.inventory.items;
}

function capacityOf(state) {
  const c = state?.inventory?.capacity;
  return Number.isInteger(c) && c > 0 ? c : INVENTORY.startSlots;
}

function emitChanged(itemId, delta, quality, organic) {
  if (busRef && delta !== 0) busRef.emit('inventory:changed', { itemId, delta, quality, organic });
}

function sortStacks(stacks) {
  // A, B, C; aynı kalitede organik olmayan önce; aynı anahtarda büyük yığın önce
  stacks.sort((a, b) => {
    if (a.q !== b.q) return a.q < b.q ? -1 : 1;
    if (a.organic !== b.organic) return a.organic ? 1 : -1;
    return b.qty - a.qty;
  });
}

function normQ(q) { return QUALITIES.includes(q) ? q : 'B'; }

/** Kullanılan yuva (toplam yığın sayısı). */
export function usedSlots(state) {
  const items = state?.inventory?.items;
  if (!isPlainObject(items)) return 0;
  let n = 0;
  for (const id in items) if (Array.isArray(items[id])) n += items[id].length;
  return n;
}

/** Boş yuva sayısı (≥ 0). */
export function freeSlots(state) {
  const f = capacityOf(state) - usedSlots(state);
  return f > 0 ? f : 0;
}

/** Mevcut (q, organic) yığınlarındaki boş yer. */
function roomInStacks(stacks, q, org) {
  if (!Array.isArray(stacks)) return 0;
  let r = 0;
  const max = stackMax();
  for (let i = 0; i < stacks.length; i++) {
    const st = stacks[i];
    if (st.q === q && st.organic === org && st.qty < max) r += max - st.qty;
  }
  return r;
}

/**
 * Şu an eklenebilecek adet (≤ qty). Envanteri değiştirmez.
 * @returns {number}
 */
export function canAdd(state, itemId, qty, q = 'B', organic = false) {
  const n = Math.floor(Number(qty));
  if (!ITEMS[itemId] || !(n > 0)) return 0;
  const room = roomInStacks(state?.inventory?.items?.[itemId], normQ(q), organic === true) + freeSlots(state) * stackMax();
  return room < n ? room : n;
}

/**
 * Envantere eklenebildiği kadar ekler: önce aynı (q, organic) yığınları stackMax'a kadar doldurur,
 * sonra boş yuvalara yeni yığın açar. Hepsi sığmazsa `inventory:full {itemId}` yayar.
 * @returns {number} eklenen adet
 */
export function add(state, itemId, qty, q = 'B', organic = false) {
  const n = Math.floor(Number(qty));
  if (!ITEMS[itemId] || !(n > 0)) return 0;
  const quality = normQ(q);
  const org = organic === true;
  const items = itemsOf(state);
  const max = stackMax();
  let stacks = items[itemId];
  if (!Array.isArray(stacks)) stacks = items[itemId] = [];
  let left = n;
  for (let i = 0; i < stacks.length && left > 0; i++) {
    const st = stacks[i];
    if (st.q !== quality || st.organic !== org || st.qty >= max) continue;
    const put = Math.min(max - st.qty, left);
    st.qty += put; left -= put;
  }
  let free = freeSlots(state);
  let opened = false;
  while (left > 0 && free > 0) {
    const put = Math.min(max, left);
    stacks.push({ q: quality, organic: org, qty: put, age: 0 });
    left -= put; free--; opened = true;
  }
  if (opened) sortStacks(stacks);
  if (stacks.length === 0) delete items[itemId];
  const added = n - left;
  emitChanged(itemId, added, quality, org);
  if (left > 0 && busRef) busRef.emit('inventory:full', { itemId });
  return added;
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
      let took = 0;
      for (let i = stacks.length - 1; i >= 0 && need > 0; i--) {
        const st = stacks[i];
        if (st.q !== qq || st.organic !== oo) continue;
        const take = Math.min(st.qty, need);
        st.qty -= take; need -= take; took += take;
        if (st.qty <= 0) stacks.splice(i, 1);
      }
      if (took > 0) { removed += took; emitChanged(itemId, -took, qq, oo); }
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

// ---------------- Bozulma ----------------

/**
 * Tek bir günlük bozulma adımı (saf; olayları `emit` ile bildirir).
 * category 'crop' ve 'animal' (süre: ITEMS[id].freshDays ?? CROPS[crop].freshDays): age++; age ≥ freshDays → bir kalite düşer, age 0, aynı (q, organic)
 * yığınlarına stackMax'a kadar birleşir (age = max), taşan kısım ayrı yığın kalır; C → yok olur.
 * Ürün başına en fazla bir `inventory:spoiled` olayı: fromQ/toQ en yüksek düşen kaliteye aittir,
 * qty toplam etkilenen adettir; ayrıntı `changes: [{fromQ, toQ, qty}]`.
 * @param {object} state
 * @param {(name:string, payload:object)=>void} [emit]
 * @returns {Array<{itemId, fromQ, toQ, qty, changes}>}
 */
export function spoilDay(state, emit) {
  const items = state?.inventory?.items;
  const out = [];
  if (!isPlainObject(items)) return out;
  const max = stackMax();
  for (const itemId of Object.keys(items)) {
    const def = ITEMS[itemId];
    if (!def || (def.category !== 'crop' && def.category !== 'animal')) continue;
    const fresh = def.freshDays ?? CROPS[def.crop]?.freshDays;
    const stacks = items[itemId];
    if (!(fresh > 0) || !Array.isArray(stacks)) continue;
    const expired = [];
    for (let i = stacks.length - 1; i >= 0; i--) {
      const st = stacks[i];
      st.age = (Number(st.age) || 0) + 1;
      if (st.age >= fresh) { expired.push(st); stacks.splice(i, 1); }
    }
    if (!expired.length) continue;
    // C'den başla: düşen yığın aynı gün tekrar düşmesin (yeni age 0 zaten).
    expired.sort((a, b) => (a.q === b.q ? 0 : a.q > b.q ? -1 : 1));
    const changes = [];
    for (const st of expired) {
      const to = NEXT_Q[st.q];
      let ch = changes.find((c) => c.fromQ === st.q && c.organic === st.organic);
      if (!ch) { ch = { fromQ: st.q, toQ: to, qty: 0, organic: st.organic }; changes.push(ch); }
      ch.qty += st.qty;
      if (!to) continue; // çürüdü
      let left = st.qty;
      for (let i = 0; i < stacks.length && left > 0; i++) {
        const o = stacks[i];
        if (o.q !== to || o.organic !== st.organic || o.qty >= max) continue;
        const put = Math.min(max - o.qty, left);
        o.qty += put; left -= put;
        // age = max(mevcut, 0) → mevcut yığının yaşı korunur
      }
      if (left > 0) stacks.push({ q: to, organic: st.organic, qty: left, age: 0 });
    }
    sortStacks(stacks);
    if (stacks.length === 0) delete items[itemId];
    const head = changes.reduce((h, c) => (!h || c.fromQ < h.fromQ ? c : h), null);
    const total = changes.reduce((s, c) => s + c.qty, 0);
    const ev = {
      itemId, fromQ: head.fromQ, toQ: head.toQ, qty: total,
      changes: changes.map((c) => ({ fromQ: c.fromQ, toQ: c.toQ, qty: c.qty, organic: c.organic })),
    };
    out.push(ev);
    if (emit) {
      for (const c of ev.changes) {
        emit('inventory:changed', { itemId, delta: -c.qty, quality: c.fromQ, organic: c.organic });
        if (c.toQ) emit('inventory:changed', { itemId, delta: c.qty, quality: c.toQ, organic: c.organic });
      }
      emit('inventory:spoiled', ev);
    }
  }
  return out;
}

// ---------------- Doğrulama / göç ----------------

/**
 * Kapasite göçü: Aşama 2 kayıtlarındaki 60 (veya geçersiz) → INVENTORY.startSlots; yığın sayısı
 * kapasiteyi aşıyorsa kapasite yığın sayısına yükseltilir (eşya silinmez). Bir kez (flags.inventorySlotsV2).
 */
function migrateCapacity(state, onFix) {
  const inv = state.inventory;
  if (!isPlainObject(state.flags)) state.flags = {};
  const legacy = !state.flags[MIGRATED_FLAG];
  if (!(Number.isInteger(inv.capacity) && inv.capacity > 0) || (legacy && inv.capacity === LEGACY_CAPACITY)) {
    onFix('inventory.capacity');
    inv.capacity = INVENTORY.startSlots;
  }
  const used = usedSlots(state);
  if (used > inv.capacity) { onFix('inventory.capacity'); inv.capacity = used; }
  state.flags[MIGRATED_FLAG] = true;
}

/**
 * Kayıt doğrulayıcı: items düz nesne; her değer {q∈A/B/C, organic:boolean, qty>0 tamsayı, age≥0} dizisi.
 * Geçersiz yığınlar atılır; aynı (q, organic) yığınları birleştirilip stackMax'lık parçalara bölünür
 * (age = max). Eski kayıtta organic yoksa false. Ardından kapasite göçü.
 */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.inventory)) { onFix('inventory'); state.inventory = { capacity: INVENTORY.startSlots, items: {} }; }
  const inv = state.inventory;
  if (!isPlainObject(inv.items)) { onFix('inventory.items'); inv.items = {}; }
  const max = stackMax();
  for (const id of Object.keys(inv.items)) {
    const path = `inventory.items.${id}`;
    const raw = inv.items[id];
    if (!ITEMS[id] || !Array.isArray(raw)) { onFix(path); delete inv.items[id]; continue; }
    const merged = [];
    let bad = false;
    for (const st of raw) {
      const ok = isPlainObject(st) && QUALITIES.includes(st.q) && Number.isInteger(st.qty) && st.qty > 0;
      if (!ok) { bad = true; continue; }
      let age = st.age;
      if (!(typeof age === 'number' && Number.isFinite(age) && age >= 0)) { bad = true; age = 0; }
      let org = st.organic;
      if (typeof org !== 'boolean') { if ('organic' in st) bad = true; org = false; }
      const same = merged.find((o) => o.q === st.q && o.organic === org);
      if (same) { same.qty += st.qty; if (age > same.age) same.age = age; } else merged.push({ q: st.q, organic: org, qty: st.qty, age });
    }
    const out = [];
    for (const m of merged) {
      let left = m.qty;
      while (left > 0) { const put = Math.min(max, left); out.push({ q: m.q, organic: m.organic, qty: put, age: m.age }); left -= put; }
    }
    if (out.length !== raw.length) bad = true;
    if (bad) onFix(path);
    if (out.length) { sortStacks(out); inv.items[id] = out; } else delete inv.items[id];
  }
  migrateCapacity(state, onFix);
  return state;
}

const InventorySystem = {
  id: 'inventory',
  add, remove, count, canAdd, freeSlots, usedSlots, spoilDay, validate,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    busRef = bus;
    itemsOf(state);
    migrateCapacity(state, () => {});
    offs.push(bus.on('inventory:add', (p) => {
      if (!p || !ITEMS[p.itemId]) return;
      add(state, p.itemId, p.qty ?? 1, p.quality ?? 'B', p.organic === true);
    }));
  },

  onDay(state, bus) {
    spoilDay(state, (n, p) => bus.emit(n, p));
  },
};

export default InventorySystem;
