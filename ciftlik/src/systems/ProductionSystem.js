// ProductionSystem — üretim zincirleri (PLAN.md §11). Phaser import ETMEZ.
// Komutlar: shop:buildMachine {machine}, machine:queue {machineId, recipe}, machine:auto {machineId, recipe|null},
//           machine:collect {machineId}, machine:repair {machineId}.
// Olaylar: building:built {type, lotId, tx, ty}, machines:changed {ids}, machine:result {ok, type, machineId?, reason?, text?},
//          machine:done {machineId, itemId, qty}, xp:add. Para yalnızca EconomySystem.transact
// (kategoriler 'buildings', 'electricity', 'maintenance').
// State: state.machines[] (PLAN §11). Kuyruğun yalnızca başındaki işin bitiş dakikası tickMinute'ta denetlenir.
import { MACHINES, MACHINE_RULES, RECIPES } from '../data/recipes.js';
import { ITEMS } from '../data/items.js';
import { isPlainObject } from '../core/GameState.js';
import { calendar } from '../core/timeUtils.js';
import { transact } from './EconomySystem.js';
import * as Inv from './InventorySystem.js';
import {
  QRANK, machineOf, machineIdOf, newMachine, durationMin, isStopped, repairCost, powerCost, addOutput, outputCount,
} from './production/sim.js';

export const REASONS = {
  badMachine: 'Bilinmeyen makine.',
  locked: (lv) => `Seviye ${lv} gerekir.`,
  noMoney: 'Yeterli paran yok.',
  built: 'Bu atölye zaten kurulu.',
  notBuilt: 'Önce atölyeyi inşa et.',
  badRecipe: 'Bu makine bu tarifi yapamaz.',
  queueFull: 'Kuyruk dolu.',
  stopped: 'Makine bakım istiyor.',
  noInput: (name) => `Yeterli ${name} yok.`,
  noPower: 'Elektrik ücretini ödeyemezsin.',
  boxEmpty: 'Toplanacak ürün yok.',
  invFull: 'Envanter dolu.',
  fine: 'Makine zaten bakımlı.',
};

let offs = [];
const nowMin = (state) => Math.floor(state.time.totalMinutes);
const dayOf = (state) => calendar(state.time.totalMinutes).day;
const levelOf = (state) => Number(state.player?.level) || 1;
const result = (bus, p) => { if (bus) bus.emit('machine:result', p); return p; };
const changed = (bus, ids) => { if (bus && ids.length) bus.emit('machines:changed', { ids }); };

/** Girdileri en düşük kaliteden al; {q: en düşük kalite, organic: hepsi organik mi}. Önce var olduğunu doğrula. */
function takeInputs(state, recipeId) {
  const r = RECIPES[recipeId];
  let worst = 'A', organic = true;
  for (const id of Object.keys(r.in)) {
    let need = r.in[id];
    const stacks = (state.inventory.items[id] || []).slice();
    // kalite artan, aynı kalitede önce organik olmayan
    stacks.sort((a, b) => QRANK[a.q] - QRANK[b.q] || (a.organic ? 1 : 0) - (b.organic ? 1 : 0));
    for (const s of stacks) {
      if (need <= 0) break;
      const take = Math.min(s.qty, need);
      const took = Inv.remove(state, id, take, s.q, !!s.organic);
      if (took > 0) {
        need -= took;
        if (QRANK[s.q] < QRANK[worst]) worst = s.q;
        if (!s.organic) organic = false;
      }
    }
  }
  return { q: worst, organic };
}

/** Kuyruğun başındaki iş henüz başlamadıysa (startMin null) ve makine çalışabiliyorsa başlat. */
function startHead(m, at) {
  const j = m.queue[0];
  if (!j || j.endMin != null || isStopped(m)) return false;
  j.startMin = at;
  j.endMin = at + durationMin(j.recipe, m.condition);
  return true;
}

function completeJobs(state, bus, m, now) {
  let any = false;
  while (m.queue.length && m.queue[0].endMin != null && m.queue[0].endMin <= now) {
    const job = m.queue.shift();
    const r = RECIPES[job.recipe];
    for (const id of Object.keys(r.out)) {
      addOutput(m, id, r.out[id], job.inputs.q, job.inputs.organic);
      bus.emit('machine:done', { machineId: m.id, itemId: id, qty: r.out[id] });
    }
    m.condition = Math.max(0, m.condition - MACHINE_RULES.wearPerJob);
    startHead(m, job.endMin);
    any = true;
  }
  return any;
}

/** Otomatik tarif: kuyruk boşsa girdi ve para varsa 1 iş ekle (sessiz). */
function autoFill(state, bus, m) {
  if (!m.auto || m.queue.length) return false;
  return queueJob(state, bus, m, m.auto, true).ok;
}

function queueJob(state, bus, m, recipeId, silent = false) {
  const type = 'queue';
  const fail = (reason) => (silent ? { ok: false, reason } : result(bus, { ok: false, type, machineId: m.id, reason }));
  const r = RECIPES[recipeId];
  if (!r || r.machine !== m.type) return fail(REASONS.badRecipe);
  if (m.queue.length >= MACHINE_RULES.queueMax) return fail(REASONS.queueFull);
  if (isStopped(m)) return fail(REASONS.stopped);
  for (const id of Object.keys(r.in)) {
    if (Inv.count(state, id) < r.in[id]) return fail(REASONS.noInput(ITEMS[id]?.name || id));
  }
  const cost = powerCost(recipeId);
  if (!transact(state, bus, { amount: -cost, category: 'electricity', label: `Elektrik: ${MACHINES[m.type].name}` })) return fail(REASONS.noPower);
  const inputs = takeInputs(state, recipeId);
  m.queue.push({ recipe: recipeId, startMin: null, endMin: null, inputs });
  if (m.queue.length === 1) startHead(m, nowMin(state));
  changed(bus, [m.id]);
  if (silent) return { ok: true };
  return result(bus, { ok: true, type, machineId: m.id, recipe: recipeId, cost, text: 'İş kuyruğa eklendi.' });
}

function buildMachine(state, bus, p = {}) {
  const type = p.machine;
  const def = MACHINES[type];
  const fail = (reason) => result(bus, { ok: false, type: 'build', machine: type, reason });
  if (!def) return fail(REASONS.badMachine);
  if (machineOf(state, type)) return fail(REASONS.built);
  if (levelOf(state) < def.level) return fail(REASONS.locked(def.level));
  if (!transact(state, bus, { amount: -def.price, category: 'buildings', label: `İnşaat: ${def.name}` })) return fail(REASONS.noMoney);
  const m = newMachine(type, dayOf(state));
  state.machines.push(m);
  bus.emit('building:built', { type, lotId: type, tx: (def.lot.x0 + def.lot.x1) / 2, ty: (def.lot.y0 + def.lot.y1) / 2 });
  changed(bus, [m.id]);
  return result(bus, { ok: true, type: 'build', machine: type, machineId: m.id, text: `${def.name} inşa edildi.` });
}

function collect(state, bus, m) {
  const res = (r) => result(bus, { type: 'collect', machineId: m.id, ...r });
  const got = {};
  let xp = 0, any = false, blocked = false;
  for (const itemId of Object.keys(m.output)) {
    const stacks = m.output[itemId];
    for (const s of stacks) {
      if (s.qty <= 0) continue;
      any = true;
      const n = Inv.canAdd(state, itemId, s.qty, s.q, s.organic);
      if (n < s.qty) blocked = true;
      if (n <= 0) continue;
      const added = Inv.add(state, itemId, n, s.q, s.organic);
      s.qty -= added;
      got[itemId] = (got[itemId] || 0) + added;
      xp += added * (ITEMS[itemId]?.basePrice || 0) * 0.05;
    }
    m.output[itemId] = stacks.filter((s) => s.qty > 0);
    if (!m.output[itemId].length) delete m.output[itemId];
  }
  if (!any) return res({ ok: false, reason: REASONS.boxEmpty });
  const total = Object.values(got).reduce((s, n) => s + n, 0);
  if (!total) return res({ ok: false, reason: REASONS.invFull });
  const amount = Math.max(1, Math.round(xp));
  bus.emit('xp:add', { amount, reason: 'production' });
  changed(bus, [m.id]);
  return res({ ok: true, collected: got, qty: total, xp: amount, partial: blocked });
}

function command(state, bus, p, fn) {
  const m = machineOf(state, p?.machineId);
  if (!m) return result(bus, { ok: false, type: p?.type, machineId: p?.machineId, reason: REASONS.notBuilt });
  return fn(m);
}

function onMinute(state, bus) {
  const now = nowMin(state);
  let ids = null;
  for (const m of state.machines) {
    const head = m.queue[0];
    if (!head || head.endMin == null || head.endMin > now) continue;
    completeJobs(state, bus, m, now);
    autoFill(state, bus, m);
    (ids || (ids = [])).push(m.id);
  }
  if (ids) changed(bus, ids);
}

function onHour(state, bus) {
  // Boşta kalan otomatik makineler (girdi sonradan geldi)
  const ids = [];
  for (const m of state.machines) if (m.auto && !m.queue.length && autoFill(state, bus, m)) ids.push(m.id);
  changed(bus, ids);
}

// ---------------- Doğrulama ----------------
const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const validStack = (s) => isPlainObject(s) && ['A', 'B', 'C'].includes(s.q) && Number.isInteger(s.qty) && s.qty > 0;

export function validate(state, onFix = () => {}) {
  if (!Array.isArray(state.machines)) { onFix('machines'); state.machines = []; }
  const seen = new Set();
  const kept = [];
  state.machines.forEach((m, i) => {
    const path = `machines.${i}`;
    if (!isPlainObject(m) || !MACHINES[m.type] || seen.has(m.type)) { onFix(path); return; }
    seen.add(m.type);
    if (m.id !== machineIdOf(m.type)) { onFix(`${path}.id`); m.id = machineIdOf(m.type); }
    if (!Number.isFinite(m.builtDay)) onFix(`${path}.builtDay`);
    m.builtDay = num(m.builtDay, 1, 0, 1e9);
    if (!Number.isFinite(m.condition)) onFix(`${path}.condition`);
    m.condition = num(m.condition, 100, 0, 100);
    if (!Array.isArray(m.queue)) { onFix(`${path}.queue`); m.queue = []; }
    const q = [];
    for (const j of m.queue) {
      const r = isPlainObject(j) ? RECIPES[j.recipe] : null;
      if (!r || r.machine !== m.type || q.length >= MACHINE_RULES.queueMax) { onFix(`${path}.queue`); continue; }
      const inp = isPlainObject(j.inputs) && ['A', 'B', 'C'].includes(j.inputs.q) ? j.inputs : { q: 'B', organic: false };
      q.push({
        recipe: j.recipe,
        startMin: Number.isFinite(j.startMin) ? j.startMin : null,
        endMin: Number.isFinite(j.endMin) ? j.endMin : null,
        inputs: { q: inp.q, organic: inp.organic === true },
      });
    }
    // yalnızca baş iş zamanlıdır; sonrakiler bekler
    q.forEach((j, k) => { if (k > 0) { j.startMin = null; j.endMin = null; } });
    m.queue = q;
    if (!isPlainObject(m.output)) { onFix(`${path}.output`); m.output = {}; }
    for (const id of Object.keys(m.output)) {
      const arr = m.output[id];
      const clean = Array.isArray(arr) && ITEMS[id]
        ? arr.filter(validStack).map((s) => ({ q: s.q, organic: s.organic === true, qty: s.qty })) : [];
      if (!Array.isArray(arr) || clean.length !== arr.length) onFix(`${path}.output.${id}`);
      if (clean.length) m.output[id] = clean; else delete m.output[id];
    }
    if (m.auto != null && !(RECIPES[m.auto] && RECIPES[m.auto].machine === m.type)) { onFix(`${path}.auto`); m.auto = null; }
    if (m.auto === undefined) m.auto = null;
    kept.push(m);
  });
  state.machines.length = 0;
  state.machines.push(...kept);
  return state;
}

const ProductionSystem = {
  id: 'production',
  validate,
  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    validate(state, () => {});
    offs.push(bus.on('shop:buildMachine', (p) => buildMachine(state, bus, p)));
    offs.push(bus.on('machine:queue', (p) => command(state, bus, { ...p, type: 'queue' }, (m) => queueJob(state, bus, m, p.recipe))));
    offs.push(bus.on('machine:auto', (p) => command(state, bus, { ...p, type: 'auto' }, (m) => {
      const rec = p.recipe ?? null;
      if (rec !== null && !(RECIPES[rec] && RECIPES[rec].machine === m.type)) return result(bus, { ok: false, type: 'auto', machineId: m.id, reason: REASONS.badRecipe });
      m.auto = rec;
      autoFill(state, bus, m);
      changed(bus, [m.id]);
      return result(bus, { ok: true, type: 'auto', machineId: m.id, recipe: rec, text: rec ? 'Otomatik üretim açıldı.' : 'Otomatik üretim kapandı.' });
    })));
    offs.push(bus.on('machine:collect', (p) => command(state, bus, { ...p, type: 'collect' }, (m) => collect(state, bus, m))));
    offs.push(bus.on('machine:repair', (p) => command(state, bus, { ...p, type: 'repair' }, (m) => {
      if (m.condition >= 100) return result(bus, { ok: false, type: 'repair', machineId: m.id, reason: REASONS.fine });
      const cost = repairCost(m.type);
      if (!transact(state, bus, { amount: -cost, category: 'maintenance', label: `Bakım: ${MACHINES[m.type].name}` })) {
        return result(bus, { ok: false, type: 'repair', machineId: m.id, reason: REASONS.noMoney });
      }
      m.condition = 100;
      if (m.queue.length) startHead(m, nowMin(state));
      autoFill(state, bus, m);
      changed(bus, [m.id]);
      return result(bus, { ok: true, type: 'repair', machineId: m.id, cost, text: 'Makine bakıldı.' });
    })));
  },
  tickMinute: onMinute,
  onHour,
};

export { outputCount };
export default ProductionSystem;
