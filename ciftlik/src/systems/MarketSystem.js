// MarketSystem — pazar yeri / toptancı satışları, mağaza alışları, dinamik fiyat (PLAN.md §4, §9). Phaser import ETMEZ.
// Komutlar: market:sell → market:result ; shop:buy → shop:result. Günlük: market:pricesUpdated.
// Para yalnızca EconomySystem.transact ile; envanter yalnızca InventorySystem dışa açık fonksiyonlarıyla.
// Rastgelelik yalnızca onDay içinde ctx.rng (komut işleyicileri deterministik).
import * as Inventory from './InventorySystem.js';
import { transact } from './EconomySystem.js';
import { ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { CHANNELS, SATURATION, NOISE, PRICE_HISTORY_DAYS } from '../data/economy.js';
import { SHOP, MAX_BUY_QTY } from '../data/shop.js';
import { XP_RULES, INVENTORY } from '../data/progression.js';
import { MIN_PER_DAY } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';
import { isPlainObject } from '../core/GameState.js';
import { quote, currentPrice, saturationAfter, isSellable } from './market/pricing.js';

const { add, count } = Inventory;

/** Satılabilir ürün kimlikleri, sabit sırada (determinizm: rng çekiliş sırası). */
export const SELLABLE_IDS = Object.keys(ITEMS).filter((id) => isSellable(id));

const SHOP_BY_ID = Object.fromEntries(SHOP.map((s) => [s.itemId, s]));
const BUY_CATEGORY = { seed: 'seeds', fertilizer: 'fertilizer', chemical: 'chemicals' };

export const SHOP_REASONS = {
  notInShop: 'Bu ürün mağazada yok',
  badQty: 'Geçersiz adet',
  locked: (lvl) => `Seviye ${lvl}'de açılır`,
  noMoney: 'Yeterli paran yok',
  full: 'Envanter dolu',
  partial: (n) => `Envanterde yalnızca ${n} birimlik yer var`,
};

let offs = [];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function newEntry() { return { saturation: 1, noise: 1, soldToday: 0 }; }

/** state.market alanlarını tamamlar; yeni ürünler için girdi ve 1. gün geçmiş değeri açar. */
export function ensureMarket(state) {
  if (!isPlainObject(state.market)) state.market = {};
  const m = state.market;
  if (!isPlainObject(m.prices)) m.prices = {};
  if (!isPlainObject(m.history)) m.history = {};
  if (!Array.isArray(m.activeEvents)) m.activeEvents = [];
  const now = calendar(state.time?.totalMinutes ?? 0);
  for (const id of SELLABLE_IDS) {
    if (!isPlainObject(m.prices[id])) m.prices[id] = newEntry();
    if (!Array.isArray(m.history[id])) m.history[id] = [];
    if (m.history[id].length === 0) m.history[id].push(currentPrice(state, id, now));
  }
  return m;
}

/** Envantere bu kadar sığar mı? gameplay-dev canAdd'i varsa onu kullanır; yoksa yığın sayısıyla kaba tahmin. */
function addable(state, itemId, qty, q, organic) {
  if (typeof Inventory.canAdd === 'function') return Inventory.canAdd(state, itemId, qty, q, organic);
  const inv = state.inventory || {};
  const items = inv.items || {};
  const stackMax = INVENTORY.stackMax;
  const cap = Number.isFinite(inv.capacity) ? inv.capacity : INVENTORY.startSlots;
  let used = 0;
  for (const k of Object.keys(items)) used += Array.isArray(items[k]) ? items[k].length : 0;
  const stack = (items[itemId] || []).find((s) => s.q === q && s.organic === organic);
  const roomInStack = stack ? Math.max(0, stackMax - stack.qty) : 0;
  const newStacks = Math.max(0, cap - used);
  return Math.min(qty, roomInStack + newStacks * stackMax);
}

function itemName(id) { return ITEMS[id]?.name ?? id; }

/**
 * market:sell işleyicisi. Node simülasyonu doğrudan çağırabilir.
 * @param {{itemId:string, q?:string, organic?:boolean, qty:number, channel?:'market'|'wholesale'}} p
 * @returns {object} market:result yükü
 */
export function sell(state, bus, p = {}) {
  const itemId = p?.itemId;
  const q = p?.q ?? p?.quality ?? 'B';
  const organic = p?.organic === true;
  const channel = p?.channel ?? 'market';
  const qty = Math.floor(Number(p?.qty));
  const now = calendar(state.time.totalMinutes);
  ensureMarket(state);
  const qt = quote(state, { itemId, q, organic, qty, channel }, now);
  const res = { ok: false, itemId, qty: Number.isFinite(qty) ? qty : 0, total: 0, channel, paidNow: false, q, organic };
  if (!qt.ok) {
    res.reason = qt.reason;
    if (bus) bus.emit('market:result', res);
    return res;
  }
  const removed = Inventory.remove(state, itemId, qty, q, organic);
  if (removed !== qty) {
    // olmamalı (quote kontrol etti); tutarlılık için geri koy
    if (removed > 0) add(state, itemId, removed, q, organic);
    res.reason = 'Envanterde yeterli yok';
    if (bus) bus.emit('market:result', res);
    return res;
  }
  const ch = CHANNELS[channel];
  const entry = state.market.prices[itemId];
  entry.saturation = saturationAfter(entry.saturation, channel, qty);
  const label = `${qty} ${itemName(itemId)} (${q}${organic ? ', organik' : ''}) — ${ch.name}`;
  if (channel === 'market') {
    entry.soldToday += qty;
    transact(state, bus, { amount: qt.total, category: 'sales', label, itemId, qty });
    res.paidNow = true;
  } else {
    const dayIndex = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
    const dueMinute = (dayIndex + (ch.payDelayDays || 1)) * MIN_PER_DAY + (ch.payHour ?? 8) * 60;
    state.finance.receivables.push({ dueMinute, amount: qt.total, label, itemId, qty });
  }
  if (isPlainObject(state.stats)) {
    if (!isPlainObject(state.stats.sold)) state.stats.sold = {};
    state.stats.sold[itemId] = (state.stats.sold[itemId] || 0) + qty;
  }
  res.ok = true;
  res.total = qt.total;
  if (bus) {
    bus.emit('market:result', res);
    const xp = qt.total * XP_RULES.salePerValue; // ProgressionSystem yuvarlar
    if (xp > 0) bus.emit('xp:add', { amount: xp, reason: 'sale' });
  }
  return res;
}

/**
 * shop:buy işleyicisi.
 * @param {{itemId:string, qty:number}} p
 * @returns {object} shop:result yükü
 */
export function buy(state, bus, p = {}) {
  const itemId = p?.itemId;
  const qty = Math.floor(Number(p?.qty ?? 1));
  const res = { ok: false, itemId, qty: Number.isFinite(qty) ? qty : 0, total: 0 };
  const fail = (reason) => { res.reason = reason; if (bus) bus.emit('shop:result', res); return res; };
  const entry = SHOP_BY_ID[itemId];
  const item = ITEMS[itemId];
  if (!entry || !item || !(item.price > 0)) return fail(SHOP_REASONS.notInShop);
  if (!(qty > 0) || qty > MAX_BUY_QTY || qty !== Number(p?.qty ?? 1)) return fail(SHOP_REASONS.badQty);
  const level = Number(state?.player?.level) || 1;
  if (level < entry.level) return fail(SHOP_REASONS.locked(entry.level));
  const total = item.price * qty;
  res.total = total;
  const organic = item.organic === true;
  if ((state.finance?.money ?? 0) < total) return fail(SHOP_REASONS.noMoney);
  const room = addable(state, itemId, qty, 'B', organic);
  if (room < qty) return fail(room > 0 ? SHOP_REASONS.partial(room) : SHOP_REASONS.full);
  const cat = BUY_CATEGORY[item.category] || 'other';
  if (!transact(state, bus, { amount: -total, category: cat, label: `${qty} ${item.name}`, itemId, qty })) {
    return fail(SHOP_REASONS.noMoney);
  }
  const got = add(state, itemId, qty, 'B', organic);
  if (got < qty) {
    // envanter beklenenden az aldı → farkı iade et
    const back = item.price * (qty - got);
    transact(state, bus, { amount: back, category: cat, label: `İade: ${qty - got} ${item.name}`, itemId, qty: qty - got });
    res.qty = got; res.total = total - back;
    if (got === 0) return fail(SHOP_REASONS.full);
  }
  res.ok = true;
  if (bus) bus.emit('shop:result', res);
  return res;
}

/** Vadesi gelen toptancı alacaklarını öder. */
export function payReceivables(state, bus) {
  const rc = state.finance?.receivables;
  if (!Array.isArray(rc) || rc.length === 0) return 0;
  const t = state.time.totalMinutes;
  let paid = 0;
  for (let i = 0; i < rc.length; i++) {
    const r = rc[i];
    if (r.dueMinute > t) continue;
    transact(state, bus, { amount: r.amount, category: 'wholesale', label: `Toptancı ödemesi: ${r.label}`, itemId: r.itemId, qty: r.qty });
    paid += r.amount;
    rc.splice(i, 1); i--;
  }
  if (paid > 0 && bus) bus.emit('toast', { text: `Toptancı ödemesi geldi: +${paid} ₺`, kind: 'good' });
  return paid;
}

/** Gün dönümü: doygunluk toparlanır, gürültü yürür (ctx.rng), soldToday sıfırlanır, geçmişe günün fiyatı eklenir. */
export function dailyUpdate(state, rng, now) {
  const m = ensureMarket(state);
  for (let i = 0; i < SELLABLE_IDS.length; i++) {
    const id = SELLABLE_IDS[i];
    const e = m.prices[id];
    e.saturation = clamp(e.saturation + (1 - e.saturation) * SATURATION.recoverPerDay, SATURATION.min, 1);
    const step = rng ? (rng.next() * 2 - 1) * NOISE.dailyStep : 0;
    e.noise = clamp(e.noise + step, NOISE.min, NOISE.max);
    e.soldToday = 0;
    const h = m.history[id];
    h.push(currentPrice(state, id, now));
    if (h.length > PRICE_HISTORY_DAYS) h.splice(0, h.length - PRICE_HISTORY_DAYS);
  }
}

/** Kayıt doğrulayıcı: market alanları. */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.market)) { onFix('market'); state.market = {}; }
  const m = state.market;
  if (!isPlainObject(m.prices)) { if ('prices' in m) onFix('market.prices'); m.prices = {}; }
  if (!isPlainObject(m.history)) { if ('history' in m) onFix('market.history'); m.history = {}; }
  if (!Array.isArray(m.activeEvents)) { if ('activeEvents' in m) onFix('market.activeEvents'); m.activeEvents = []; }
  for (const id of Object.keys(m.prices)) {
    const e = m.prices[id];
    if (!isSellable(id) || !isPlainObject(e)) { onFix(`market.prices.${id}`); delete m.prices[id]; continue; }
    let bad = false;
    if (!isNum(e.saturation) || e.saturation < SATURATION.min || e.saturation > 1) { bad = true; e.saturation = isNum(e.saturation) ? clamp(e.saturation, SATURATION.min, 1) : 1; }
    if (!isNum(e.noise) || e.noise < NOISE.min || e.noise > NOISE.max) { bad = true; e.noise = isNum(e.noise) ? clamp(e.noise, NOISE.min, NOISE.max) : 1; }
    if (!Number.isInteger(e.soldToday) || e.soldToday < 0) { bad = true; e.soldToday = isNum(e.soldToday) && e.soldToday > 0 ? Math.floor(e.soldToday) : 0; }
    for (const k of Object.keys(e)) if (!['saturation', 'noise', 'soldToday'].includes(k)) { bad = true; delete e[k]; }
    if (bad) onFix(`market.prices.${id}`);
  }
  for (const id of Object.keys(m.history)) {
    const h = m.history[id];
    if (!isSellable(id) || !Array.isArray(h)) { onFix(`market.history.${id}`); delete m.history[id]; continue; }
    const ok = h.filter((v) => isNum(v) && v >= 0);
    if (ok.length !== h.length) onFix(`market.history.${id}`);
    if (ok.length > PRICE_HISTORY_DAYS) ok.splice(0, ok.length - PRICE_HISTORY_DAYS);
    m.history[id] = ok;
  }
  ensureMarket(state);
  return state;
}

const MarketSystem = {
  id: 'market',
  sell, buy, validate, ensureMarket, payReceivables, dailyUpdate,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    ensureMarket(state);
    if (isPlainObject(state.finance) && !Array.isArray(state.finance.receivables)) state.finance.receivables = [];
    offs.push(bus.on('market:sell', (p) => sell(state, bus, p)));
    offs.push(bus.on('shop:buy', (p) => buy(state, bus, p)));
  },

  onHour(state, bus) { payReceivables(state, bus); },

  onDay(state, bus, ctx) {
    dailyUpdate(state, ctx?.rng, ctx?.now);
    bus.emit('market:pricesUpdated', {});
  },
};

export default MarketSystem;
