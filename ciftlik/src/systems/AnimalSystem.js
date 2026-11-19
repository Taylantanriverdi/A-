// AnimalSystem — hayvancılık (PLAN.md §10). Phaser import ETMEZ.
// Dinler: building:built {type, placedId, tx, ty} (PlacementSystem), placed:changed. Dışa: canRemove(state, placedId).
// Komutlar: shop:buyAnimal {animal, buildingId?}, animal:action {type, buildingId, animalId?, itemId?}.
// Olaylar: animal:born {animal, reason}, animal:result {ok, type, buildingId?, reason?, text?, ...},
//          animals:changed {buildingIds}, xp:add. Para yalnızca EconomySystem.transact (kategori 'other').
// State: state.buildings[], state.animals[] (PLAN §10).
import { ANIMALS, CARE, VET, ANIMAL_PRODUCTS } from '../data/animals.js';
import { BUILDINGS, TROUGH } from '../data/buildings.js';
import { ITEMS } from '../data/items.js';
import { isPlainObject } from '../core/GameState.js';
import { createRng } from '../core/Rng.js';
import { calendar } from '../core/timeUtils.js';
import { transact } from './EconomySystem.js';
import { isRuined } from './world/occupancy.js';
import * as Inv from './InventorySystem.js';
import {
  buildingId, placedIdOf, buildingOf, animalsIn, newBuilding, newAnimal, hourStep, dayStep, feedNeedPerDay, acceptedFeed, troughCap, boxCount,
  BOX_MAX, MIN_HEALTH,
} from './animals/sim.js';

export { BOX_MAX };
export const REASONS = {
  badBuilding: 'Bilinmeyen bina.',
  noMoney: 'Yeterli paran yok.',
  sellFirst: 'Önce hayvanları sat.',
  needBuilding: (name) => `Önce ${name.toLowerCase()} inşa et.`,
  full: 'Bina dolu.',
  noBuilding: 'Bina bulunamadı.',
  noAnimals: 'Binada hayvan yok.',
  noFeedItem: 'Bu yem bu hayvanlara uygun değil.',
  noFeed: 'Envanterde yem yok.',
  troughFull: 'Yemlik dolu.',
  waterFull: 'Suluk dolu.',
  clean: 'Burası zaten temiz.',
  boxEmpty: 'Toplanacak ürün yok.',
  invFull: 'Envanter dolu.',
  petted: 'Bugün zaten sevildi.',
  notSick: 'Hasta hayvan yok.',
};

const dayOf = (state) => calendar(state.time.totalMinutes).day;
const isHive = (type) => type === 'hive';
let busRef = null;
let rngRef = null;
let offs = [];


function result(bus, p) { if (bus) bus.emit('animal:result', p); return p; }
function changed(bus, ids) { if (bus && ids.length) bus.emit('animals:changed', { buildingIds: ids }); }

/** building:built {type: coop|barn|hive, placedId, tx, ty} → bina kaydı (hive: bina + bir arı). Ücret PlacementSystem'de alınır. */
function onBuilt(state, bus, p = {}, rng) {
  const type = p.type;
  if (!BUILDINGS[type] || p.placedId == null) return null;
  const id = buildingId(p.placedId);
  if (buildingOf(state, id)) return null;
  const b = newBuilding(type, p.placedId, dayOf(state));
  state.buildings.push(b);
  if (isHive(type)) {
    const a = newAnimal(state, 'bee', b.id, rng, true);
    state.animals.push(a);
    bus.emit('animal:born', { animal: a, reason: 'bought' });
  }
  changed(bus, [b.id]);
  return b;
}

/** build:remove öncesi kontrol (PlacementSystem çağırır). */
export function canRemove(state, placedId) {
  const b = state.buildings.find((x) => placedIdOf(x) === placedId);
  if (!b) return { ok: true };
  if (animalsIn(state, b.id).length) return { ok: false, reason: REASONS.sellFirst };
  return { ok: true };
}

/** Yerleştirilmiş listesinde olmayan bina kayıtlarını (ve varsa hayvanlarını) sil. */
function syncPlaced(state, bus) {
  if (!Array.isArray(state.placed)) return;
  const live = new Set(state.placed.map((o) => o.id));
  const gone = state.buildings.filter((b) => b.placedId != null && !live.has(b.placedId));
  if (!gone.length) return;
  const ids = new Set(gone.map((b) => b.id));
  state.buildings = state.buildings.filter((b) => !ids.has(b.id));
  state.animals = state.animals.filter((a) => !ids.has(a.buildingId));
  changed(bus, [...ids]);
}

function buyAnimal(state, bus, p = {}, rng) {
  const type = p.animal;
  const def = ANIMALS[type];
  const fail = (reason) => result(bus, { ok: false, type: 'buy', animal: type, reason });
  if (!def) return fail(REASONS.badBuilding);
  const bdef = BUILDINGS[def.building];
  const cands = state.buildings.filter((x) => x.type === def.building && (!p.buildingId || x.id === p.buildingId));
  if (!cands.length) return fail(REASONS.needBuilding(bdef.name));
  const b = cands.find((x) => animalsIn(state, x.id).length < bdef.capacity);
  if (!b) return fail(REASONS.full);
  if (!transact(state, bus, { amount: -def.price, category: 'animals', label: `Hayvan: ${def.name}` })) return fail(REASONS.noMoney);
  const a = newAnimal(state, type, b.id, rng, true);
  state.animals.push(a);
  bus.emit('animal:born', { animal: a, reason: 'bought' });
  changed(bus, [b.id]);
  return result(bus, { ok: true, type: 'buy', animal: type, buildingId: b.id, animalId: a.id, text: `${a.name} çiftliğe katıldı.` });
}

function feedBuilding(state, bus, b, list, itemId) {
  const ok = acceptedFeed(list);
  const res = (r) => result(bus, { type: 'feed', buildingId: b.id, ...r });
  if (!list.length) return res({ ok: false, reason: REASONS.noAnimals });
  const pv = ok[itemId];
  if (!pv) return res({ ok: false, reason: REASONS.noFeedItem });
  const cap = troughCap(list);
  if (b.trough.feed + 1e-6 >= cap) return res({ ok: false, reason: REASONS.troughFull });
  const dayNeed = feedNeedPerDay(list);
  const have = Inv.count(state, itemId);
  if (have <= 0) return res({ ok: false, reason: REASONS.noFeed });
  const n = Math.min(Math.ceil(dayNeed / pv - 1e-9), Math.ceil((cap - b.trough.feed) / pv - 1e-9), have);
  const took = Inv.remove(state, itemId, n);
  b.trough.feed = Math.min(cap, b.trough.feed + took * pv);
  changed(bus, [b.id]);
  return res({ ok: true, itemId, qty: took, text: `Yemliğe ${took} ${ITEMS[itemId].name} kondu.` });
}

function collect(state, bus, b) {
  const res = (r) => result(bus, { type: 'collect', buildingId: b.id, ...r });
  const got = {};
  let xp = 0, any = false, blocked = false;
  for (const itemId of Object.keys(b.box)) {
    const stacks = b.box[itemId];
    for (let i = 0; i < stacks.length; i++) {
      const s = stacks[i];
      if (s.qty <= 0) continue;
      any = true;
      const n = Inv.canAdd(state, itemId, s.qty, s.q, false);
      if (n < s.qty) blocked = true;
      if (n <= 0) continue;
      const added = Inv.add(state, itemId, n, s.q, false);
      s.qty -= added;
      got[itemId] = (got[itemId] || 0) + added;
      xp += added * (ANIMAL_PRODUCTS[itemId]?.basePrice || 0) * 0.1;
    }
    b.box[itemId] = stacks.filter((s) => s.qty > 0);
    if (!b.box[itemId].length) delete b.box[itemId];
  }
  if (!any) return res({ ok: false, reason: REASONS.boxEmpty });
  const total = Object.values(got).reduce((s, n) => s + n, 0);
  if (!total) return res({ ok: false, reason: REASONS.invFull });
  const amount = Math.max(1, Math.round(xp));
  bus.emit('xp:add', { amount, reason: 'animal' });
  changed(bus, [b.id]);
  return res({ ok: true, collected: got, qty: total, xp: amount, partial: blocked });
}

function action(state, bus, p = {}) {
  const type = p.type;
  const b = buildingOf(state, p.buildingId);
  if (!b) return result(bus, { ok: false, type, buildingId: p.buildingId, reason: REASONS.noBuilding });
  const list = animalsIn(state, b.id);
  const res = (r) => result(bus, { type, buildingId: b.id, ...r });
  switch (type) {
    case 'feed': return feedBuilding(state, bus, b, list, p.itemId);
    case 'water': {
      if (!list.length) return res({ ok: false, reason: REASONS.noAnimals });
      if (b.trough.water + 1e-6 >= TROUGH.waterDaysMax) return res({ ok: false, reason: REASONS.waterFull });
      b.trough.water = TROUGH.waterDaysMax;
      changed(bus, [b.id]);
      return res({ ok: true, text: 'Suluk doldu.' });
    }
    case 'clean': {
      if (b.dirt <= 0) return res({ ok: false, reason: REASONS.clean });
      b.dirt = 0;
      changed(bus, [b.id]);
      return res({ ok: true, text: 'Temizlendi.' });
    }
    case 'collect': return collect(state, bus, b);
    case 'pet': {
      const today = dayOf(state);
      const targets = list.filter((a) => (p.animalId ? a.id === p.animalId : true) && a.pettedDay !== today);
      if (!targets.length) return res({ ok: false, reason: REASONS.petted });
      for (const a of targets) { a.pettedDay = today; a.happiness = Math.min(100, a.happiness + CARE.petHappiness); }
      changed(bus, [b.id]);
      return res({ ok: true, count: targets.length, text: targets.length === 1 ? `${targets[0].name} sevildi.` : 'Hayvanlar sevildi.' });
    }
    case 'vet': {
      const sick = list.filter((a) => a.sick && (p.animalId ? a.id === p.animalId : true));
      if (!sick.length) return res({ ok: false, reason: REASONS.notSick });
      const cost = VET.visitPrice * sick.length;
      if (!transact(state, bus, { amount: -cost, category: 'other', label: 'Veteriner' })) return res({ ok: false, reason: REASONS.noMoney });
      for (const a of sick) { a.sick = false; a.health = Math.max(a.health, VET.healthAfter); }
      changed(bus, [b.id]);
      return res({ ok: true, count: sick.length, cost, text: 'Hayvan iyileşti.' });
    }
    default: return res({ ok: false, reason: 'Bilinmeyen eylem.' });
  }
}

function onHour(state, bus) {
  const ids = [];
  for (const b of state.buildings) {
    const list = animalsIn(state, b.id);
    if (!list.length || isRuined(state, b.placedId)) continue; // K29: harap bina işlevsiz
    hourStep(b, list);
    ids.push(b.id);
  }
  changed(bus, ids);
}

function onDay(state, bus, ctx) {
  const today = ctx.now.day;
  const ids = [];
  for (const b of state.buildings) {
    const list = animalsIn(state, b.id);
    if (!list.length || isRuined(state, b.placedId)) continue; // K29
    // arı bakım gideri (para yetmezse atlanır, ceza yok)
    for (const a of list) {
      const up = ANIMALS[a.type]?.upkeepPerDay;
      if (up > 0) transact(state, bus, { amount: -up, category: 'other', label: 'Kovan bakımı' });
    }
    const out = dayStep(state, b, list, ctx, today);
    for (const baby of out.born) bus.emit('animal:born', { animal: baby, reason: 'bred' });
    ids.push(b.id);
  }
  changed(bus, ids);
}

// ---------------- Doğrulama ----------------
const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function validate(state, onFix = () => {}) {
  if (!Array.isArray(state.buildings)) { onFix('buildings'); state.buildings = []; }
  if (!Array.isArray(state.animals)) { onFix('animals'); state.animals = []; }
  if (!isPlainObject(state.flags)) state.flags = {};
  const pids = new Set();
  const kept = [];
  state.buildings.forEach((b, i) => {
    const path = `buildings.${i}`;
    const pid = isPlainObject(b) ? placedIdOf(b) : null;
    if (pid == null || !BUILDINGS[b.type] || pids.has(pid)) { onFix(path); return; }
    pids.add(pid);
    const f = (cond, key) => { if (!cond) onFix(`${path}.${key}`); };
    f(b.id === buildingId(pid), 'id'); b.id = buildingId(pid);
    f(Number.isFinite(b.builtDay), 'builtDay'); b.builtDay = num(b.builtDay, 1, 0, 1e9);
    f(Number.isFinite(b.dirt), 'dirt'); b.dirt = num(b.dirt, 0, 0, 100);
    if (!isPlainObject(b.trough)) { onFix(`${path}.trough`); b.trough = { feed: 0, water: 0 }; }
    b.trough.feed = num(b.trough.feed, 0, 0, 1e6); b.trough.water = num(b.trough.water, 0, 0, TROUGH.waterDaysMax);
    if (!isPlainObject(b.box)) { onFix(`${path}.box`); b.box = {}; }
    for (const id of Object.keys(b.box)) {
      const arr = b.box[id];
      const clean = Array.isArray(arr) && ITEMS[id]
        ? arr.filter((s) => isPlainObject(s) && ['A', 'B', 'C'].includes(s.q) && Number.isInteger(s.qty) && s.qty > 0) : [];
      if (!Array.isArray(arr) || clean.length !== arr.length) onFix(`${path}.box.${id}`);
      if (clean.length) b.box[id] = clean; else delete b.box[id];
    }
    kept.push(b);
  });
  state.buildings.length = 0; state.buildings.push(...kept);
  const ids = new Set();
  const animals = [];
  state.animals.forEach((a, i) => {
    const path = `animals.${i}`;
    const def = isPlainObject(a) ? ANIMALS[a.type] : null;
    const b = def ? kept.find((x) => x.id === a.buildingId) : null;
    if (!def || !b || b.type !== def.building) { onFix(path); return; }
    if (typeof a.id !== 'string' || ids.has(a.id)) {
      onFix(`${path}.id`);
      let n = (Number(state.flags.animalSeq) || 0) + 1; while (ids.has(`a${n}`)) n++;
      state.flags.animalSeq = n; a.id = `a${n}`;
    }
    ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name) { onFix(`${path}.name`); a.name = def.name; }
    a.ageDays = num(a.ageDays, 0, 0, 1e9);
    for (const k of ['hunger', 'thirst', 'health', 'happiness']) {
      if (!Number.isFinite(a[k])) onFix(`${path}.${k}`);
      a[k] = num(a[k], 100, 0, 100);
    }
    if (a.health < MIN_HEALTH) a.health = MIN_HEALTH;
    if (typeof a.sick !== 'boolean') { onFix(`${path}.sick`); a.sick = false; }
    a.pettedDay = Number.isFinite(a.pettedDay) ? a.pettedDay : -1;
    a.productTimer = num(a.productTimer, 0, 0, 1e6);
    animals.push(a);
  });
  state.animals.length = 0; state.animals.push(...animals);
  const seq = animals.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), 0);
  if (!(Number(state.flags.animalSeq) >= seq)) state.flags.animalSeq = seq;
  return state;
}

const AnimalSystem = {
  id: 'animals',
  validate,
  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    busRef = bus;
    rngRef = registry?.ctx?.rng || createRng(state);
    validate(state, () => {});
    offs.push(bus.on('building:built', (p) => onBuilt(state, bus, p, rngRef)));
    offs.push(bus.on('placed:changed', () => syncPlaced(state, bus)));
    offs.push(bus.on('shop:buyAnimal', (p) => buyAnimal(state, bus, p, rngRef)));
    offs.push(bus.on('animal:action', (p) => action(state, bus, p)));
    // Hava/olay etkisi (fırtına): tüm hayvanların mutluluğu düşer (PLAN §14)
    offs.push(bus.on('hazard:animals', (p) => {
      const d = Number(p?.happiness);
      if (!Number.isFinite(d) || d === 0) return;
      for (const a of state.animals) a.happiness = Math.max(0, Math.min(100, a.happiness + d));
      bus.emit('animals:changed', { buildingIds: [] });
    }));
  },
  onHour,
  onDay,
};

export default AnimalSystem;
