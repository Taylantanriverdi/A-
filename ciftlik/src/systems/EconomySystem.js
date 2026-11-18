// EconomySystem — tüm para hareketlerinin TEK giriş noktası (PLAN.md §9 "Para"). Phaser import ETMEZ.
// transact → state.finance.money, ledger (en fazla LEDGER_MAX_ENTRIES), dailySummary (son 112 gün),
// stats.earned/spent, `money:changed {amount, balance, category}`.
import { LEDGER_CATEGORIES, LEDGER_MAX_ENTRIES, TAX, UPKEEP_KWH } from '../data/economy.js';
import { MACHINE_RULES } from '../data/recipes.js';
import { MIN_PER_DAY, DAYS_PER_SEASON } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';
import { isPlainObject } from '../core/GameState.js';
import { netWorth } from './economy/valuation.js';

export const SUMMARY_DAYS = 112;
export const SEASON_SUMMARY_MAX = 8;
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function ensureFinance(state) {
  if (!isPlainObject(state.finance)) state.finance = { money: 0, ledger: [], loans: [], dailySummary: [], receivables: [] };
  const f = state.finance;
  if (!isNum(f.money)) f.money = 0;
  if (!Array.isArray(f.ledger)) f.ledger = [];
  if (!Array.isArray(f.dailySummary)) f.dailySummary = [];
  if (!Array.isArray(f.receivables)) f.receivables = [];
  if (!Array.isArray(f.loans)) f.loans = [];
  if (!Array.isArray(f.seasonSummary)) f.seasonSummary = [];
  return f;
}

function dayOf(state) {
  const t = Number(state?.time?.totalMinutes) || 0;
  return { day: Math.floor(t / MIN_PER_DAY) + 1, min: Math.floor(t % MIN_PER_DAY) };
}

function summaryFor(f, day) {
  const ds = f.dailySummary;
  const last = ds[ds.length - 1];
  if (last && last.day === day) return last;
  const s = { day, income: 0, expense: 0, byCategory: {} };
  ds.push(s);
  if (ds.length > SUMMARY_DAYS) ds.splice(0, ds.length - SUMMARY_DAYS);
  return s;
}

/**
 * Para hareketi. Negatif tutar bakiye yetmezse false döner ve hiçbir şey değişmez.
 * Tutar tam ₺'ye yuvarlanır; 0 tutar defter kaydı üretmez (true döner).
 * Bilinmeyen kategori 'other' olarak kaydedilir (yeni kategori data/economy.js LEDGER_CATEGORIES'e eklenmeli).
 * @param {object} state
 * @param {{emit:Function}|null} bus
 * @param {{amount:number, category:string, label:string, itemId?:string, qty?:number}} tx
 * @returns {boolean}
 */
export function transact(state, bus, { amount, category, label, itemId, qty } = {}) {
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a)) return false;
  const f = ensureFinance(state);
  if (a === 0) return true;
  if (a < 0 && f.money + a < 0) return false;
  const cat = typeof category === 'string' && category in LEDGER_CATEGORIES ? category : 'other';
  f.money += a;
  const { day, min } = dayOf(state);
  const entry = { day, min, amount: a, category: cat, label: typeof label === 'string' && label ? label : (LEDGER_CATEGORIES[cat] || cat) };
  if (typeof itemId === 'string') entry.itemId = itemId;
  if (isNum(qty)) entry.qty = qty;
  f.ledger.push(entry);
  if (f.ledger.length > LEDGER_MAX_ENTRIES) f.ledger.splice(0, f.ledger.length - LEDGER_MAX_ENTRIES);
  const s = summaryFor(f, day);
  if (a > 0) s.income += a; else s.expense += -a;
  s.byCategory[cat] = (s.byCategory[cat] || 0) + a;
  if (isPlainObject(state.stats)) {
    if (a > 0) state.stats.earned = (Number(state.stats.earned) || 0) + a;
    else state.stats.spent = (Number(state.stats.spent) || 0) - a;
  }
  if (bus) bus.emit('money:changed', { amount: a, balance: f.money, category: cat });
  return true;
}

/**
 * Kayıt doğrulayıcı: finance alanları. Bozuk defter/özet/alacak elemanları atılır, uzunluklar kırpılır.
 */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.finance)) { onFix('finance'); state.finance = {}; }
  const f = state.finance;
  if (!isNum(f.money)) { onFix('finance.money'); f.money = 0; }
  else if (!Number.isInteger(f.money)) f.money = Math.round(f.money);
  for (const k of ['ledger', 'dailySummary', 'receivables', 'loans']) {
    if (!Array.isArray(f[k])) { if (k in f) onFix(`finance.${k}`); f[k] = []; }
  }
  // ledger
  const led = f.ledger.filter((e) => isPlainObject(e) && isNum(e.day) && isNum(e.min) && isNum(e.amount)
    && typeof e.category === 'string' && typeof e.label === 'string'
    && (e.itemId === undefined || typeof e.itemId === 'string') && (e.qty === undefined || isNum(e.qty)));
  if (led.length !== f.ledger.length) onFix('finance.ledger');
  if (led.length > LEDGER_MAX_ENTRIES) led.splice(0, led.length - LEDGER_MAX_ENTRIES);
  f.ledger = led;
  // dailySummary
  const ds = [];
  let badDs = false;
  for (const s of f.dailySummary) {
    if (!(isPlainObject(s) && isNum(s.day) && isNum(s.income) && isNum(s.expense))) { badDs = true; continue; }
    if (!isPlainObject(s.byCategory)) { badDs = true; s.byCategory = {}; }
    for (const k of Object.keys(s.byCategory)) if (!isNum(s.byCategory[k])) { badDs = true; delete s.byCategory[k]; }
    const e = { day: s.day, income: s.income, expense: s.expense, byCategory: s.byCategory };
    if (isNum(s.netWorth)) e.netWorth = s.netWorth;
    ds.push(e);
  }
  if (badDs) onFix('finance.dailySummary');
  if (ds.length > SUMMARY_DAYS) ds.splice(0, ds.length - SUMMARY_DAYS);
  f.dailySummary = ds;
  // receivables (toptancı alacakları)
  const rc = f.receivables.filter((r) => isPlainObject(r) && isNum(r.dueMinute) && r.dueMinute >= 0
    && isNum(r.amount) && r.amount > 0 && typeof r.label === 'string');
  if (rc.length !== f.receivables.length) onFix('finance.receivables');
  f.receivables = rc;
  // seasonSummary
  if (!Array.isArray(f.seasonSummary)) { if ('seasonSummary' in f) onFix('finance.seasonSummary'); f.seasonSummary = []; }
  const ss = f.seasonSummary.filter((x) => isPlainObject(x) && isNum(x.year) && typeof x.season === 'string' && isNum(x.income)
    && isNum(x.expense) && isNum(x.profit) && isNum(x.tax) && isPlainObject(x.byCategory));
  if (ss.length !== f.seasonSummary.length) onFix('finance.seasonSummary');
  if (ss.length > SEASON_SUMMARY_MAX) ss.splice(0, ss.length - SEASON_SUMMARY_MAX);
  f.seasonSummary = ss;
  return state;
}

/** Günlük sabit elektrik (20:00): ev her zaman, ahır/kümes yerleştirilmiş sayıya göre mevsim kurallarıyla. */
export function dailyUpkeep(state, bus) {
  const season = calendar(state.time.totalMinutes).season;
  const per = (type) => { const u = UPKEEP_KWH[type]; return u ? (u[season] ?? u.all ?? 0) : 0; };
  let kwh = per('house');
  for (const p of state.placed || []) if (p && (p.type === 'barn' || p.type === 'coop')) kwh += per(p.type);
  const cost = Math.round(kwh * MACHINE_RULES.kwhPrice);
  if (cost > 0) transact(state, bus, { amount: -cost, category: 'electricity', label: `Sabit elektrik (${kwh} kWh)` });
  return cost;
}

/** Mevsim sonu (28. gün 23:00): özet, vergi (ilk mevsim muaf), olay + toast. Para yetmezse eldeki kadar tahsil edilir. */
export function closeSeason(state, bus) {
  const f = ensureFinance(state);
  const cal = calendar(state.time.totalMinutes);
  const seasonAbs = Math.floor((cal.day - 1) / DAYS_PER_SEASON);
  const d0 = seasonAbs * DAYS_PER_SEASON + 1;
  let income = 0, expense = 0;
  const byCategory = {};
  for (const d of f.dailySummary) {
    if (d.day < d0 || d.day >= d0 + DAYS_PER_SEASON) continue;
    for (const [k, v] of Object.entries(d.byCategory)) {
      byCategory[k] = (byCategory[k] || 0) + v;
      if (k === 'loan') continue; // kredi anaparası kâr/zarar değildir
      if (v > 0) income += v; else expense += -v;
    }
  }
  const profit = income - expense;
  let tax = 0;
  if (seasonAbs >= TAX.graceSeasons && profit > 0) tax = Math.min(Math.round(profit * TAX.incomeRate), Math.max(0, f.money));
  if (tax > 0) transact(state, bus, { amount: -tax, category: 'tax', label: 'Gelir vergisi' });
  const entry = { year: cal.year, season: cal.season, income, expense, profit, tax, byCategory };
  f.seasonSummary.push(entry);
  if (f.seasonSummary.length > SEASON_SUMMARY_MAX) f.seasonSummary.splice(0, f.seasonSummary.length - SEASON_SUMMARY_MAX);
  bus.emit('finance:seasonClosed', entry);
  bus.emit('toast', { text: `Mevsim kapandı: kâr ${fmt(profit)} ₺, vergi ${fmt(tax)} ₺`, kind: profit >= 0 ? 'info' : 'bad' });
  return entry;
}

function stampNetWorth(state) {
  const f = ensureFinance(state);
  summaryFor(f, dayOf(state).day).netWorth = Math.round(netWorth(state));
}

const EconomySystem = {
  id: 'economy',
  transact,
  validate,

  init(state) {
    ensureFinance(state);
  },

  /** Hareketsiz günler de grafikte görünsün diye her gün boş özet açılır. */
  onDay(state) {
    const f = ensureFinance(state);
    summaryFor(f, dayOf(state).day);
    stampNetWorth(state);
  },

  onHour(state, bus) {
    const cal = calendar(state.time.totalMinutes);
    if (cal.hour === 20) dailyUpkeep(state, bus);
    if (cal.hour === 23) {
      if (cal.dayOfSeason === DAYS_PER_SEASON) closeSeason(state, bus);
      stampNetWorth(state);
    }
  },
};

export default EconomySystem;
