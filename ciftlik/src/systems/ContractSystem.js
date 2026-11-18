// ContractSystem — sözleşmeli siparişler (PLAN §13). Phaser import ETMEZ.
// Komutlar: contract:accept {id}, contract:deliver {id, qty?}.
// Olaylar: contracts:changed {}, contract:result {ok, kind, id?, reason?, delivered?}, contract:completed {id,itemId,qty,reward}, contract:failed {id,itemId,penalty}.
// Para: yalnızca EconomySystem.transact ('contracts' ödül, 'penalty' ceza).
import { CONTRACTS } from '../data/economy.js';
import { ITEMS } from '../data/items.js';
import { QUALITY } from '../data/farming.js';
import { MIN_PER_DAY } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { count, remove, QUALITIES } from './InventorySystem.js';
import { currentPrice, isSellable } from './market/pricing.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const HISTORY_MAX = 20;
const FALLBACK_ITEMS = ['lettuce', 'potato'];
let offs = [];

export function ensureContracts(state) {
  if (!isPlainObject(state.contracts)) state.contracts = { offers: [], active: [], history: [] };
  const c = state.contracts;
  for (const k of ['offers', 'active', 'history']) if (!Array.isArray(c[k])) c[k] = [];
  if (!isPlainObject(state.player)) state.player = {};
  if (!isNum(state.player.reputation)) state.player.reputation = CONTRACTS.reputation.start;
  return c;
}

const nameOf = (id) => ITEMS[id]?.name || id;
const clampRep = (v) => Math.max(0, Math.min(CONTRACTS.reputation.max, v));
const changed = (bus) => bus.emit('contracts:changed', {});
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');
const nextId = (state) => `c${(state.flags.contractSeq = (Number(state.flags.contractSeq) || 0) + 1)}`;

/** Oyuncunun bildiği (hasat/satış/envanter) satılabilir ürünler; hiç yoksa marul/patates. */
export function knownItems(state) {
  const set = new Set();
  const add = (o) => { if (isPlainObject(o)) for (const id of Object.keys(o)) if (isSellable(id)) set.add(id); };
  if (CONTRACTS.onlyKnownItems) {
    add(state.stats?.harvested); add(state.stats?.sold); add(state.inventory?.items);
    if (isPlainObject(state.stats?.produced)) add(state.stats.produced);
  } else for (const id of Object.keys(ITEMS)) if (isSellable(id)) set.add(id);
  if (set.size === 0) for (const id of FALLBACK_ITEMS) set.add(id);
  return [...set];
}

function pickQuality(rng) {
  const w = CONTRACTS.minQualityChance;
  let r = rng.next();
  for (const q of QUALITIES) { r -= w[q] || 0; if (r < 0) return q; }
  return 'B';
}

/** Sabah teklif üretimi (pano ≤ boardSize). */
export function generateOffers(state, bus, rng, now) {
  const c = ensureContracts(state);
  const total = state.time.totalMinutes;
  const n0 = c.offers.length;
  c.offers = c.offers.filter((o) => o.expiresMin > total);
  const want = rng.int(CONTRACTS.newOffersPerDay[0], CONTRACTS.newOffersPerDay[1]);
  const pool = knownItems(state);
  const rep = state.player.reputation;
  for (let i = 0; i < want && c.offers.length < CONTRACTS.boardSize; i++) {
    const free = pool.filter((id) => !c.offers.some((o) => o.itemId === id) && !c.active.some((a) => a.itemId === id));
    const itemId = rng.pick(free.length ? free : pool);
    if (!itemId) break;
    const [lo, hi] = CONTRACTS.qtyByCategory[ITEMS[itemId].category] || CONTRACTS.qtyByCategory.crop;
    const qty = rng.int(lo, hi);
    const minQ = pickQuality(rng);
    const mult = CONTRACTS.rewardMult[0] + (CONTRACTS.rewardMult[1] - CONTRACTS.rewardMult[0])
      * Math.min(1, (rep / CONTRACTS.reputation.max) * 0.7 + rng.next() * 0.3);
    const unit = Math.max(1, currentPrice(state, itemId, now));
    const reward = Math.round(unit * (QUALITY.priceMult[minQ] / QUALITY.priceMult.B) * qty * mult);
    c.offers.push({
      id: nextId(state), itemId, qty, minQ, reward,
      deadlineDays: rng.int(CONTRACTS.deadlineDays[0], CONTRACTS.deadlineDays[1]),
      expiresMin: total + CONTRACTS.offerExpiresDays * MIN_PER_DAY,
    });
  }
  if (c.offers.length !== n0 || want > 0) changed(bus);
}

function pushHistory(c, e) {
  c.history.push(e);
  if (c.history.length > HISTORY_MAX) c.history.splice(0, c.history.length - HISTORY_MAX);
}

export function accept(state, bus, p = {}) {
  const c = ensureContracts(state);
  const fail = (reason) => { bus.emit('contract:result', { ok: false, kind: 'accept', id: p.id, reason }); return false; };
  const i = c.offers.findIndex((o) => o.id === p.id);
  if (i < 0) return fail('Teklif artık geçerli değil');
  if (c.active.length >= CONTRACTS.boardSize) return fail('Pano dolu');
  const o = c.offers[i];
  c.offers.splice(i, 1);
  c.active.push({
    id: o.id, itemId: o.itemId, qty: o.qty, delivered: 0, minQ: o.minQ, reward: o.reward,
    dueMin: state.time.totalMinutes + o.deadlineDays * MIN_PER_DAY, penalty: Math.round(o.reward * CONTRACTS.penaltyPct),
  });
  bus.emit('contract:result', { ok: true, kind: 'accept', id: o.id });
  changed(bus);
  return true;
}

/** Min kaliteyi karşılayan kaliteler (düşükten yükseğe sıralı). */
const eligibleQualities = (minQ) => QUALITIES.filter((q) => QUALITIES.indexOf(q) <= QUALITIES.indexOf(minQ)).reverse();

export function eligibleCount(state, a) {
  let n = 0;
  for (const q of eligibleQualities(a.minQ)) n += count(state, a.itemId, q);
  return n;
}

export function deliver(state, bus, p = {}) {
  const c = ensureContracts(state);
  const fail = (reason) => { bus.emit('contract:result', { ok: false, kind: 'deliver', id: p.id, reason }); return false; };
  const a = c.active.find((x) => x.id === p.id);
  if (!a) return fail('Sözleşme bulunamadı');
  const need = a.qty - a.delivered;
  const want = p.qty === undefined ? need : Math.floor(Number(p.qty));
  if (!(want > 0)) return fail('Geçersiz adet');
  const avail = eligibleCount(state, a);
  if (avail <= 0) return fail(count(state, a.itemId) > 0 ? `Bu üründen min. ${a.minQ} kalite gerekiyor` : 'Envanterde yeterli yok');
  let left = Math.min(want, need, avail);
  const total = left;
  for (const q of eligibleQualities(a.minQ)) { // önce en düşük uygun kalite
    if (left <= 0) break;
    left -= remove(state, a.itemId, Math.min(left, count(state, a.itemId, q)), q);
  }
  const given = total - left;
  a.delivered += given;
  const done = a.delivered >= a.qty;
  bus.emit('contract:result', { ok: true, kind: 'deliver', id: a.id, delivered: given, done });
  if (done) {
    c.active.splice(c.active.indexOf(a), 1);
    transact(state, bus, { amount: a.reward, category: 'contracts', label: `Sözleşme: ${nameOf(a.itemId)} ×${a.qty}`, itemId: a.itemId, qty: a.qty });
    state.player.reputation = clampRep(state.player.reputation + CONTRACTS.reputation.onComplete);
    pushHistory(c, { id: a.id, itemId: a.itemId, qty: a.qty, reward: a.reward, ok: true, day: calendar(state.time.totalMinutes).day });
    bus.emit('contract:completed', { id: a.id, itemId: a.itemId, qty: a.qty, reward: a.reward });
    bus.emit('toast', { text: `Sözleşme tamamlandı: +${fmt(a.reward)} ₺`, kind: 'good' });
  }
  changed(bus);
  return true;
}

/** Süresi dolan teklifleri kaldırır; süresi dolan aktifleri cezalandırır (para yetmezse eldeki kadar; borç yok). */
export function expire(state, bus) {
  const c = ensureContracts(state);
  const total = state.time.totalMinutes;
  let dirty = false;
  const offers = c.offers.filter((o) => o.expiresMin > total);
  if (offers.length !== c.offers.length) { c.offers = offers; dirty = true; }
  for (let i = c.active.length - 1; i >= 0; i--) {
    const a = c.active[i];
    if (a.dueMin > total) continue;
    c.active.splice(i, 1);
    const pen = Math.min(a.penalty, Math.max(0, state.finance.money));
    if (pen > 0) transact(state, bus, { amount: -pen, category: 'penalty', label: `Sözleşme cezası: ${nameOf(a.itemId)}`, itemId: a.itemId });
    state.player.reputation = clampRep(state.player.reputation + CONTRACTS.reputation.onFail);
    pushHistory(c, { id: a.id, itemId: a.itemId, qty: a.qty, delivered: a.delivered, penalty: pen, ok: false, day: calendar(total).day });
    bus.emit('contract:failed', { id: a.id, itemId: a.itemId, penalty: pen });
    bus.emit('toast', { text: `Sözleşme kaçırıldı: ${nameOf(a.itemId)}${pen ? `, ceza ${fmt(pen)} ₺` : ''}`, kind: 'bad' });
    dirty = true;
  }
  if (dirty) changed(bus);
}

export function validate(state, onFix = () => {}) {
  if (Array.isArray(state.contracts) || !isPlainObject(state.contracts)) { onFix('contracts'); state.contracts = { offers: [], active: [], history: [] }; }
  const c = state.contracts;
  const str = (v) => typeof v === 'string';
  const okOffer = (o) => isPlainObject(o) && str(o.id) && str(o.itemId) && ITEMS[o.itemId] && isNum(o.qty) && o.qty > 0
    && QUALITIES.includes(o.minQ) && isNum(o.reward) && isNum(o.deadlineDays) && isNum(o.expiresMin);
  const okActive = (a) => isPlainObject(a) && str(a.id) && str(a.itemId) && ITEMS[a.itemId] && isNum(a.qty) && a.qty > 0
    && isNum(a.delivered) && a.delivered >= 0 && QUALITIES.includes(a.minQ) && isNum(a.reward) && isNum(a.dueMin) && isNum(a.penalty);
  for (const [k, fn] of [['offers', okOffer], ['active', okActive], ['history', isPlainObject]]) {
    if (!Array.isArray(c[k])) { if (k in c) onFix(`contracts.${k}`); c[k] = []; continue; }
    const ok = c[k].filter(fn);
    if (ok.length !== c[k].length) onFix(`contracts.${k}`);
    c[k] = ok;
  }
  if (c.history.length > HISTORY_MAX) c.history.splice(0, c.history.length - HISTORY_MAX);
  if (c.offers.length > CONTRACTS.boardSize) c.offers.length = CONTRACTS.boardSize;
  if (!isNum(state.player?.reputation)) { if (isPlainObject(state.player)) { onFix('player.reputation'); state.player.reputation = CONTRACTS.reputation.start; } }
  else state.player.reputation = clampRep(state.player.reputation);
  return state;
}

const ContractSystem = {
  id: 'contracts',
  accept, deliver, expire, generateOffers, validate, knownItems, eligibleCount,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    ensureContracts(state);
    if (!isPlainObject(state.flags)) state.flags = {};
    offs.push(bus.on('contract:accept', (p) => accept(state, bus, p)));
    offs.push(bus.on('contract:deliver', (p) => deliver(state, bus, p)));
  },

  onHour(state, bus, ctx) {
    expire(state, bus);
    if (calendar(state.time.totalMinutes).hour === 7 && ctx?.rng) generateOffers(state, bus, ctx.rng, ctx.now);
  },
};

export default ContractSystem;
