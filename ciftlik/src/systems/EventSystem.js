// EventSystem — rastgele olaylar + ürün yarışması festivali (PLAN.md §14). Phaser import ETMEZ.
// state.events = { active:[{id,kind,startMin,untilMin,data}], history:[…son 20], festival:{lastYearSeason,open,deadlineMin,result} }
// Olaylar: event:started {id,kind,title,text,untilMin,data}, event:ended {id,kind,title}, festival:open, festival:result;
//          hazard:crops (dolu/don), weather:force (dolu). Komutlar: festival:enter {itemId,q?}, event:force {kind} (debug).
// Etkiler: fiyat → market.activeEvents (pricing.eventMult); sickChanceMult/pestChanceMult/moistureLossMult/buildDiscount → events/mods.js.
import { EVENTS, FESTIVAL } from '../data/events.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { QUALITY } from '../data/farming.js';
import { MIN_PER_DAY, DAYS_PER_SEASON } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';
import { createRng } from '../core/Rng.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { isSellable, unitBeforeSaturation } from './market/pricing.js';
import * as Inv from './InventorySystem.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const HISTORY_MAX = 20;
const KINDS = Object.keys(EVENTS);

let regRef = null;
let fallbackRng = null;
let offs = [];

function rngOf(state) {
  const r = regRef?.ctx?.rng;
  if (r) return r;
  if (!fallbackRng) fallbackRng = createRng(state);
  return fallbackRng;
}

function ensure(state) {
  if (!isPlainObject(state.events)) state.events = {};
  const e = state.events;
  if (!Array.isArray(e.active)) e.active = [];
  if (!Array.isArray(e.history)) e.history = [];
  if (!isPlainObject(e.festival)) e.festival = {};
  const f = e.festival;
  if (!isNum(f.lastYearSeason)) f.lastYearSeason = -1;
  if (typeof f.open !== 'boolean') f.open = false;
  if (!isNum(f.deadlineMin)) f.deadlineMin = 0;
  if (f.result === undefined) f.result = null;
  if (!isPlainObject(state.market)) state.market = { prices: {}, history: {}, activeEvents: [] };
  if (!Array.isArray(state.market.activeEvents)) state.market.activeEvents = [];
  return e;
}

const itemName = (id) => (ITEMS[id] && ITEMS[id].name) || String(id);

function pickDistinct(rng, pool, n) {
  const a = pool.slice(), out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rng.next() * a.length), 1)[0]);
  return out;
}

function priceItems(state, rng, spec) {
  if (spec === 'randomCrops2') return pickDistinct(rng, Object.keys(CROPS).filter(isSellable), 2);
  if (spec === 'randomSellable1') return pickDistinct(rng, Object.keys(ITEMS).filter((id) => isSellable(id)), 1);
  return [];
}

/** Olayı başlatır (zorlama/seçim sonrası). @returns {object|null} aktif olay */
export function startEvent(state, bus, kind, rng, nowMin = state.time.totalMinutes) {
  const def = EVENTS[kind];
  if (!def) return null;
  const ev = ensure(state);
  if (ev.active.some((a) => a.kind === kind)) return null;
  const eff = def.effect || {};
  const days = rng.int(def.days[0], def.days[1]);
  const data = {};
  const tpl = {};
  if (eff.priceMult) {
    const mult = Math.round(rng.range(eff.priceMult[0], eff.priceMult[1]) * 100) / 100;
    const items = priceItems(state, rng, eff.priceItems);
    data.mult = mult; data.itemIds = items;
    tpl.itemNames = items.map(itemName).join(', ');
    tpl.pct = Math.round(Math.abs(mult - 1) * 100);
  }
  for (const k of ['moistureLossMult', 'sickChanceMult', 'pestChanceMult', 'buildDiscount', 'grant', 'cropDamage']) {
    if (isNum(eff[k])) data[k] = eff[k];
  }
  if (eff.noRain) data.noRain = true;
  if (eff.onlyNonHardy) data.onlyNonHardy = true;
  const id = `${kind}@${nowMin}`;
  const active = { id, kind, startMin: nowMin, untilMin: nowMin + days * MIN_PER_DAY, data };
  ev.active.push(active);
  for (const itemId of data.itemIds || []) state.market.activeEvents.push({ id, kind, itemId, mult: data.mult, untilMin: active.untilMin });
  const text = typeof def.text === 'function' ? def.text(tpl) : String(def.text || '');
  bus.emit('event:started', { id, kind, title: def.title, text, untilMin: active.untilMin, data });
  // anlık etkiler
  if (eff.forceWeather) bus.emit('weather:force', { type: eff.forceWeather, source: kind });
  if (isNum(eff.cropDamage)) bus.emit('hazard:crops', { chance: 1, damage: eff.cropDamage, onlyNonHardy: eff.onlyNonHardy === true, source: kind });
  if (isNum(eff.grant) && eff.grant > 0) transact(state, bus, { amount: eff.grant, category: 'other', label: def.title });
  return active;
}

function endEvent(state, bus, i) {
  const ev = state.events;
  const a = ev.active[i];
  ev.active.splice(i, 1);
  const m = state.market.activeEvents;
  for (let j = m.length - 1; j >= 0; j--) if (m[j] && m[j].id === a.id) m.splice(j, 1);
  ev.history.push({ id: a.id, kind: a.kind, startMin: a.startMin, untilMin: a.untilMin });
  if (ev.history.length > HISTORY_MAX) ev.history.splice(0, ev.history.length - HISTORY_MAX);
  bus.emit('event:ended', { id: a.id, kind: a.kind, title: EVENTS[a.kind]?.title || a.kind });
}

function eligible(state, kind, def, now) {
  if (def.seasons && !def.seasons.includes(now.season)) return 0;
  if (def.when === 'edge' && !(now.dayOfSeason <= 5 || now.dayOfSeason > DAYS_PER_SEASON - 5)) return 0;
  if (state.events.active.some((a) => a.kind === kind)) return 0;
  if (EVENTS[kind].effect?.forceWeather && state.events.active.some((a) => a.data && a.data.noRain)) return 0; // kuraklıkta dolu yağmaz
  let c = def.chance;
  if (now.season === 'summer' && isNum(def.summerMult)) c *= def.summerMult;
  return c;
}

/** Günlük olay seçimi: tek zar, en fazla bir yeni olay. */
export function rollEvent(state, bus, rng, now) {
  const r = rng.next();
  let acc = 0;
  for (const kind of KINDS) {
    const c = eligible(state, kind, EVENTS[kind], now);
    if (c <= 0) continue;
    acc += c;
    if (r < acc) return startEvent(state, bus, kind, rng);
  }
  return null;
}

// ---------------------------------------------------------------- festival
const yearSeasonOf = (now) => (now.year - 1) * 4 + now.seasonIndex;

export function openFestival(state, bus, now, forced = false) {
  const f = ensure(state).festival;
  f.lastYearSeason = yearSeasonOf(now);
  f.open = true;
  f.deadlineMin = Math.floor(state.time.totalMinutes / MIN_PER_DAY) * MIN_PER_DAY + 12 * 60;
  if (forced) f.deadlineMin = Math.max(f.deadlineMin, state.time.totalMinutes + 120);
  f.result = null;
  bus.emit('festival:open', { title: FESTIVAL.title, deadlineMin: f.deadlineMin, prizes: FESTIVAL.prizes.slice(), rivals: FESTIVAL.rivals });
}

function closeFestival(state, bus) {
  const f = state.events.festival;
  if (!f.open) return;
  f.open = false;
  f.result = { entered: false, rank: 0, prize: 0 };
  bus.emit('festival:result', { ...f.result });
}

/** Katılım: ürün envanterden bir adet düşer, puanlanır, rakiplerle sıralanır, ödül verilir. */
export function enterFestival(state, bus, rng, { itemId, q } = {}) {
  const f = ensure(state).festival;
  const fail = (reason) => { bus.emit('festival:result', { ok: false, entered: false, reason, rank: 0, prize: 0 }); return null; };
  if (!f.open) return fail('Festival şu an açık değil.');
  if (!isSellable(itemId)) return fail('Bu ürün yarışmaya uygun değil.');
  const stacks = state.inventory.items[itemId];
  if (!Array.isArray(stacks) || !stacks.length) return fail('Envanterde bu ürün yok.');
  let best = null;
  for (const st of stacks) {
    if (st.qty <= 0 || (q && st.q !== q)) continue;
    const v = unitBeforeSaturation(state, itemId, st.q, st.organic === true, 'market');
    if (!best || v > best.v) best = { q: st.q, organic: st.organic === true, v };
  }
  if (!best) return fail('Envanterde bu kalitede ürün yok.');
  Inv.remove(state, itemId, 1, best.q, best.organic);
  const now = calendar(state.time.totalMinutes);
  let top = 0;
  for (const id in CROPS) if (CROPS[id].seasons.includes(now.season) && CROPS[id].basePrice > top) top = CROPS[id].basePrice;
  if (!(top > 0)) for (const id in CROPS) if (CROPS[id].basePrice > top) top = CROPS[id].basePrice;
  const qs = Object.keys(QUALITY.priceMult);
  const rivals = [];
  for (let i = 0; i < FESTIVAL.rivals; i++) rivals.push(Math.round(((FESTIVAL.rivalMin ?? 0) + rng.next() * (FESTIVAL.rivalSpread ?? 1)) * top * QUALITY.priceMult[qs[rng.int(0, qs.length - 1)]] * 100) / 100);
  const score = Math.round(best.v * 100) / 100;
  let rank = 1;
  for (const r of rivals) if (r > score) rank++;
  const prize = FESTIVAL.prizes[rank - 1] || 0;
  const repGain = FESTIVAL.reputation[rank - 1] || 0;
  if (prize > 0) transact(state, bus, { amount: prize, category: 'contracts', label: `${FESTIVAL.title}: ${rank}. oldun` });
  if (repGain > 0 && state.player) state.player.reputation = Math.max(0, Math.min(100, (Number(state.player.reputation) || 0) + repGain));
  f.open = false;
  f.result = { entered: true, rank, prize, reputation: repGain, score, rivals, itemId, q: best.q };
  bus.emit('festival:result', { ...f.result, rivals: rivals.slice() });
  return f.result;
}

// ---------------------------------------------------------------- döngü
function onHour(state, bus, ctx) {
  const ev = ensure(state);
  const now = ctx.now;
  const t = state.time.totalMinutes;
  for (let i = ev.active.length - 1; i >= 0; i--) if (ev.active[i].untilMin <= t) endEvent(state, bus, i);
  const m = state.market.activeEvents;
  for (let j = m.length - 1; j >= 0; j--) if (!m[j] || !(m[j].untilMin > t)) m.splice(j, 1);
  const rng = rngOf(state);
  if (now.hour === 6) rollEvent(state, bus, rng, now);
  const f = ev.festival;
  if (f.open && t >= f.deadlineMin) closeFestival(state, bus);
  if (now.hour === FESTIVAL.hour && now.dayOfSeason === FESTIVAL.dayOfSeason && f.lastYearSeason !== yearSeasonOf(now)) openFestival(state, bus, now);
}

export function validate(state, onFix = () => {}) {
  if (state.events !== undefined && !isPlainObject(state.events)) onFix('events');
  const ev = ensure(state);
  const act = ev.active.filter((a) => isPlainObject(a) && typeof a.kind === 'string' && EVENTS[a.kind] && typeof a.id === 'string'
    && isNum(a.startMin) && isNum(a.untilMin) && isPlainObject(a.data));
  if (act.length !== ev.active.length) onFix('events.active');
  ev.active = act;
  ev.history = ev.history.filter((h) => isPlainObject(h) && typeof h.kind === 'string').slice(-HISTORY_MAX);
  const ids = new Set(act.map((a) => a.id));
  const m = state.market.activeEvents;
  const keep = m.filter((x) => isPlainObject(x) && isNum(x.mult) && x.mult > 0 && typeof x.itemId === 'string' && (x.id === undefined || ids.has(x.id)));
  if (keep.length !== m.length) { onFix('market.activeEvents'); state.market.activeEvents = keep; }
  return state;
}

const EventSystem = {
  id: 'events',
  validate,
  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    regRef = registry || null;
    fallbackRng = null;
    validate(state, () => {});
    offs.push(bus.on('festival:enter', (p) => { enterFestival(state, bus, rngOf(state), p); }));
    offs.push(bus.on('event:force', (p) => {
      const kind = String(p?.kind);
      if (kind === 'festival') { openFestival(state, bus, calendar(state.time.totalMinutes), true); return; }
      startEvent(state, bus, kind, rngOf(state));
    }));
  },
  onHour,
};

export default EventSystem;
