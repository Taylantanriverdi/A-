// Ekonomi simülasyonu (Node, Phaser yok): node tools/sim-economy.mjs [seed] [--tiles=N] [--days=N]
// Gerçek Time + Inventory + Farm + Market + Economy (+ Progression) sistemleri SystemRegistry ile sürülür.
// Oyuncu stratejisi: her sabah 07:00 hasat → pazarda/toptancıda satış → tohum/gübre alımı → ekim → sulama/ot/ilaç;
// 19:00'da hazır olanları hasat. 24 başlangıç karosu, para yettikçe P1'de yeni karo sürülür (--tiles üst sınır).
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { count, freeSlots } from '../src/systems/InventorySystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import MarketSystem, { SELLABLE_IDS } from '../src/systems/MarketSystem.js';
import EconomySystem, { transact } from '../src/systems/EconomySystem.js';
import { quote, currentPrice, priceEntry, saturationAfter } from '../src/systems/market/pricing.js';
import { rotationMult, inSeason } from '../src/systems/farm/growth.js';
import { canApply } from '../src/systems/farm/rules.js';
import { CROPS } from '../src/data/crops.js';
import { ITEMS } from '../src/data/items.js';
import { SHOP } from '../src/data/shop.js';
import { QUALITY } from '../src/data/farming.js';
import { CHANNELS, SATURATION, START_MONEY } from '../src/data/economy.js';
import { P1_BLOCKED } from '../src/data/land.js';
import { MIN_PER_DAY, DAYS_PER_SEASON, P1 } from '../src/core/constants.js';
import { calendar } from '../src/core/timeUtils.js';

let ProgressionSystem = null;
try { ProgressionSystem = (await import('../src/systems/ProgressionSystem.js')).default; } catch { /* yok */ }

const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const SEED = Number(ARGS.find((a) => /^\d+$/.test(a))) || 20261118;
const DAYS = arg('days', DAYS_PER_SEASON);
// Öneri denemeleri (yalnızca bu süreçte; veri dosyası değişmez): --marketMult=0.8 --price.strawberry=15
const TRIALS = [];
{
  const qa = arg('priceA', null);
  if (qa !== null) { QUALITY.priceMult.A = qa; TRIALS.push(`priceMult.A=${qa}`); }
  const mm = arg('marketMult', null);
  if (mm !== null) { CHANNELS.market.mult = mm; TRIALS.push(`market.mult=${mm}`); }
  for (const a of ARGS) {
    const m = /^--price\.(\w+)=([\d.]+)$/.exec(a);
    if (m && CROPS[m[1]]) { CROPS[m[1]].basePrice = Number(m[2]); TRIALS.push(`${m[1]}.basePrice=${m[2]}`); }
  }
}

function makeBus() {
  const map = new Map();
  return {
    on(n, fn) { if (!map.has(n)) map.set(n, []); map.get(n).push(fn); return () => { const l = map.get(n); l.splice(l.indexOf(fn), 1); }; },
    emit(n, p) { const l = map.get(n); if (l) for (const fn of l.slice()) fn(p); },
  };
}

/** Yerel seviye izleyici: ProgressionSystem yoksa (geçici) xp:add → player.level. */
function makeLevelShim() {
  const xpToNext = (l) => Math.floor(100 * Math.pow(l, 1.6));
  return {
    id: 'progression-shim',
    init(state, bus) {
      bus.on('xp:add', (e) => {
        const p = state.player; p.totalXp = (p.totalXp || 0) + Math.max(1, Math.round(e.amount));
        let l = 1, rest = p.totalXp; while (rest >= xpToNext(l)) { rest -= xpToNext(l); l++; }
        p.level = l; p.xp = rest;
      });
    },
  };
}

function makeWorld(seed = SEED) {
  const state = createInitialState(seed);
  const bus = makeBus();
  const reg = new SystemRegistry(state, bus);
  // Kayıt sırası PLAN §9: Time → Inventory → Farm → Market → Economy → Progression
  reg.register(TimeSystem).register(InventorySystem).register(FarmSystem).register(MarketSystem).register(EconomySystem);
  reg.register(ProgressionSystem ?? makeLevelShim());
  const log = { farm: [], market: [], shop: [], levelUps: [], full: 0, spoiled: [] };
  bus.on('farm:result', (r) => log.farm.push(r));
  bus.on('market:result', (r) => log.market.push(r));
  bus.on('shop:result', (r) => log.shop.push(r));
  bus.on('level:up', (e) => log.levelUps.push({ day: calendar(state.time.totalMinutes).day, level: e.level }));
  bus.on('inventory:full', () => log.full++);
  bus.on('inventory:spoiled', (e) => log.spoiled.push({ day: calendar(state.time.totalMinutes).day, ...e }));
  return {
    state, bus, reg, log,
    now() { return calendar(state.time.totalMinutes); },
    act(type, tileId, itemId) { bus.emit('farm:action', { type, tileId, itemId }); return log.farm[log.farm.length - 1]; },
    sell(itemId, q, organic, qty, channel = 'market') { bus.emit('market:sell', { itemId, q, organic, qty, channel }); return log.market[log.market.length - 1]; },
    buy(itemId, qty) { bus.emit('shop:buy', { itemId, qty }); return log.shop[log.shop.length - 1]; },
    toHour(hour) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
      const to = d * MIN_PER_DAY + hour * 60;
      if (to > state.time.totalMinutes) reg.advance(to - state.time.totalMinutes, true);
    },
    nextDayAt(hour) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY) + 1;
      reg.advance(d * MIN_PER_DAY + hour * 60 - state.time.totalMinutes, true);
    },
  };
}

// ------------------------------------------------------------------ strateji
const START_PLOT = [];
for (let y = 8; y <= 11; y++) for (let x = 34; x <= 39; x++) START_PLOT.push(`${x},${y}`);
/** Genişleme sırası: başlangıç alanına yakın, engelsiz P1 karoları. */
const EXPAND = [];
for (let y = P1.y; y < P1.y + P1.h; y++) for (let x = P1.x; x < P1.x + P1.w; x++) {
  const id = `${x},${y}`;
  if (!START_PLOT.includes(id) && !P1_BLOCKED[id]) EXPAND.push(id);
}
EXPAND.sort((a, b) => {
  const d = (id) => { const [x, y] = id.split(',').map(Number); return Math.abs(x - 36.5) + Math.abs(y - 9.5) * 1.3; };
  return d(a) - d(b);
});

const SEED_LEVEL = Object.fromEntries(SHOP.map((s) => [s.itemId, s.level]));
const fmt = (n) => Math.round(n).toLocaleString('tr-TR');

/** Ürünün beklenen satış birim fiyatı (B, pazar), sahadaki/stoktaki bekleyen birimlerle doygunluk tahmini. */
function expectedUnit(state, cropId, pending) {
  const e = priceEntry(state, cropId);
  const base = currentPrice(state, cropId) / Math.max(e.saturation, 1e-6);
  // Bekleyen birimler birkaç güne yayılarak satılır: yarısı kadar doygunluk etkisi varsay.
  return base * saturationAfter(1, 'market', pending / 2);
}

function pendingUnits(state, tiles) {
  const p = {};
  for (const id of SELLABLE_IDS) p[id] = count(state, id);
  for (const id of tiles) { const c = state.tiles[id]?.crop; if (c && !c.dead) p[c.id] += CROPS[c.id].yield; }
  return p;
}

function chooseCrop(state, tile, daysLeft, pending, level) {
  let best = null;
  for (const [cid, c] of Object.entries(CROPS)) {
    if (!inSeason(c, 'spring')) continue;
    if ((SEED_LEVEL[`seed_${cid}`] ?? 99) > level) continue;
    if (c.growDays > daysLeft) continue;
    const rot = rotationMult(tile.history, cid);
    const unit = expectedUnit(state, cid, pending[cid]);
    const harvests = c.regrowDays ? 1 + Math.floor((daysLeft - c.growDays) / c.regrowDays) : 1;
    const occ = c.regrowDays ? daysLeft : c.growDays;
    const seedCost = count(state, `seed_${cid}`) > (pending[`__seed_${cid}`] || 0) ? 0 : c.seedPrice; // eldeki tohum batık maliyet
    const net = c.yield * rot * unit * harvests - seedCost;
    const score = net / occ;
    if (net > 0 && (!best || score > best.score)) best = { cid, score };
  }
  return best?.cid ?? null;
}

const needsCompost = (t, c) => t.n < c.need.n - 5 || t.p < c.need.p - 5 || t.k < c.need.k - 5;

function ensureItem(w, itemId, n) {
  const have = count(w.state, itemId);
  if (have >= n) return true;
  const r = w.buy(itemId, Math.min(99, n - have));
  return r.ok;
}

/** Sabah satışı: her yığın için kanal seçimi + uzun ömürlü ürünlerde doygunluk eşiği. */
function sellAll(w, stats) {
  const st = w.state;
  const level = st.player.level || 1;
  for (const id of SELLABLE_IDS) {
    const stacks = st.inventory.items[id];
    if (!Array.isArray(stacks)) continue;
    const fresh = CROPS[id].freshDays;
    for (const s of stacks.slice().sort((a, b) => b.age - a.age)) {
      const { q, organic } = s;
      const qty = count(st, id, q, organic);
      if (qty <= 0) continue;
      // Toptancı: seviye ≥ 3, ≥ 50 birim ve ortalaması pazardan iyiyse
      if (level >= CHANNELS.wholesale.level && qty >= CHANNELS.wholesale.minLot) {
        const wq = quote(st, { itemId: id, q, organic, qty, channel: 'wholesale' });
        const mLeft = quote(st, { itemId: id, q, organic, qty: 1, channel: 'market' }).limitLeft;
        const mq = quote(st, { itemId: id, q, organic, qty: Math.max(1, Math.min(qty, mLeft)), channel: 'market' });
        if (wq.ok && wq.avg > mq.avg) { const r = w.sell(id, q, organic, qty, 'wholesale'); if (r.ok) { stats.wholesale += r.total; continue; } }
      }
      const left = quote(st, { itemId: id, q, organic, qty: 1, channel: 'market' }).limitLeft;
      let n = Math.min(qty, left);
      if (fresh >= 10 && s.age < fresh - 2) {
        // uzun ömürlü: doygunluk 0.88'in altına inmeden sat, kalanı yarına
        const sat = priceEntry(st, id).saturation;
        const cap = Math.max(0, Math.floor(Math.log(0.88 / sat) / Math.log(1 - SATURATION.perUnit.market)));
        n = Math.min(n, cap);
      }
      if (n > 0) { const r = w.sell(id, q, organic, n, 'market'); if (r.ok) stats.market += r.total; }
    }
  }
}

function runStrategy({ maxTiles = 24, seed = SEED, days = DAYS } = {}) {
  const w = makeWorld(seed);
  const st = w.state;
  const tiles = START_PLOT.slice();
  const rows = [];
  const stats = { market: 0, wholesale: 0 };
  let cum = 0;
  w.toHour(7);
  for (let d = 1; d <= days; d++) {
    const now = w.now();
    const daysLeft = DAYS_PER_SEASON - now.dayOfSeason; // bugün ekilen, ≤ daysLeft günde hazır olmalı
    const s0 = stats.market + stats.wholesale;
    // 1) hasat / ölü temizliği
    for (const id of tiles) { const c = st.tiles[id].crop; if (c && (c.dead || c.stage >= 4)) w.act('harvest', id); }
    // 2) satış
    sellAll(w, stats);
    // 3) genişleme: para yettikçe günde en fazla 8 karo sür
    if (tiles.length < maxTiles && st.finance.money > 800 && d < DAYS_PER_SEASON - 4) {
      for (let k = 0; k < 8 && tiles.length < maxTiles; k++) {
        const id = EXPAND.find((x) => !tiles.includes(x) && st.tiles[x] && canApply(st, { type: 'plow', tileId: x }).ok);
        if (!id) break;
        if (w.act('plow', id).ok) tiles.push(id);
      }
    }
    // 4) ekim planı
    const pending = pendingUnits(st, tiles);
    const plan = [];
    for (const id of tiles) {
      const t = st.tiles[id];
      if (t.crop || t.state !== 'plowed') continue;
      const cid = chooseCrop(st, t, daysLeft, pending, st.player.level || 1);
      if (!cid) continue;
      plan.push({ id, cid });
      pending[cid] += CROPS[cid].yield;
      pending[`__seed_${cid}`] = (pending[`__seed_${cid}`] || 0) + 1;
    }
    const seedNeed = {}; let compostNeed = 0;
    for (const p of plan) { seedNeed[`seed_${p.cid}`] = (seedNeed[`seed_${p.cid}`] || 0) + 1; if (needsCompost(st.tiles[p.id], CROPS[p.cid])) compostNeed++; }
    for (const [sid, n] of Object.entries(seedNeed)) ensureItem(w, sid, n);
    if (compostNeed) ensureItem(w, 'compost', compostNeed);
    for (const p of plan) {
      const t = st.tiles[p.id];
      if (needsCompost(t, CROPS[p.cid]) && count(st, 'compost') > 0) w.act('fertilize', p.id, 'compost');
      if (count(st, `seed_${p.cid}`) > 0) w.act('plant', p.id, `seed_${p.cid}`);
    }
    // 5) bakım
    for (const id of tiles) {
      const t = st.tiles[id];
      if (t.crop && !t.crop.dead) w.act('water', id);
      if (t.weeds > 0) w.act('weed', id);
      if (t.crop && !t.crop.dead && (t.crop.pest > 0 || t.crop.disease > 0)) {
        if (ensureItem(w, 'organic_spray', 1)) w.act('treat', id, 'organic_spray');
      }
    }
    // 6) akşam hasadı
    w.toHour(19);
    for (const id of tiles) { const c = st.tiles[id].crop; if (c && !c.dead && c.stage >= 4) w.act('harvest', id); }
    // gün sonu (23:59'a kadar ilerle; ödemeler onHour)
    w.toHour(23);
    w.reg.advance(59, true);
    const sales = stats.market + stats.wholesale - s0;
    cum += sales;
    rows.push({ day: d, money: st.finance.money, net: netWorth(st), sales, cum, level: st.player.level || 1, tiles: tiles.length, planted: tiles.filter((id) => st.tiles[id].crop && !st.tiles[id].crop.dead).length });
    w.nextDayAt(7);
  }
  return { w, rows, stats };
}

/** Net varlık = kasa + alacak + envanter (ürünler B-eşdeğeri pazar fiyatı × kalite, girdiler alış fiyatı). Tarladaki ekin hariç. */
function netWorth(st) {
  let v = st.finance.money;
  for (const r of st.finance.receivables || []) v += r.amount;
  for (const [id, stacks] of Object.entries(st.inventory.items)) {
    const it = ITEMS[id];
    for (const s of stacks) {
      if (it.category === 'crop') v += currentPrice(st, id) * (QUALITY.priceMult[s.q] ?? 1) * (s.organic ? 1 + QUALITY.organicBonus : 1) * s.qty;
      else v += (it.price || 0) * s.qty;
    }
  }
  return v;
}

// ------------------------------------------------------------------ yardımcı tablolar
const pad = (s, n) => String(s).padEnd(n);
function table(title, cols, rows) {
  console.log(`\n=== ${title} ===`);
  const wd = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)) + 2);
  console.log(cols.map((c, i) => pad(c, wd[i])).join(''));
  console.log(wd.map((n) => '-'.repeat(n - 1)).join(' '));
  for (const r of rows) console.log(r.map((v, i) => pad(v, wd[i])).join(''));
}

function categorySums(st) {
  const s = {};
  for (const d of st.finance.dailySummary) for (const [k, v] of Object.entries(d.byCategory)) s[k] = (s[k] || 0) + v;
  return s;
}

// ------------------------------------------------------------------ doygunluk ve kanal karşılaştırması
function saturationDemo() {
  const w = makeWorld();
  const st = w.state;
  w.toHour(7);
  InventorySystem.add(st, 'potato', 99, 'B', false);
  const one = quote(st, { itemId: 'potato', q: 'B', qty: 1 });
  const q39 = quote(st, { itemId: 'potato', q: 'B', qty: 39 });
  const q40 = quote(st, { itemId: 'potato', q: 'B', qty: 40 });
  const q41 = quote(st, { itemId: 'potato', q: 'B', qty: 41 });
  const r = w.sell('potato', 'B', false, 40);
  const after = currentPrice(st, 'potato');
  const lim = w.sell('potato', 'B', false, 1);
  const recov = [];
  for (let i = 0; i < 4; i++) { w.nextDayAt(7); recov.push(`g${w.now().day}: ${currentPrice(st, 'potato')} ₺ (doy. ${priceEntry(st, 'potato').saturation.toFixed(3)})`); }
  return { one, q40, last: q40.total - q39.total, q41, r, after, lim, recov };
}

function channelCompare() {
  const rows = [];
  for (const qty of [50, 100, 200]) {
    const w = makeWorld();
    const st = w.state;
    w.toHour(7);
    st.player.level = 3; // karşılaştırma için
    InventorySystem.add(st, 'potato', qty, 'B', false);
    const wq = quote(st, { itemId: 'potato', q: 'B', qty, channel: 'wholesale' });
    // pazar yeri: günde en fazla 40, kalanı sonraki günler (gürültü dahil gerçek satış)
    let mk = 0, days = 0, left = qty;
    while (left > 0) { const n = Math.min(40, left); const r = w.sell('potato', 'B', false, n); mk += r.total; left -= n; days++; if (left > 0) w.nextDayAt(7); }
    rows.push([qty, `${fmt(wq.total)} ₺ (ort. ${wq.avg})`, 'ertesi gün 08:00', `${fmt(mk)} ₺ (ort. ${(mk / qty).toFixed(2)})`, `${days} gün`, `${((wq.total / mk - 1) * 100).toFixed(1)}%`]);
  }
  return rows;
}

function wholesaleFlow() {
  const w = makeWorld();
  const st = w.state;
  w.toHour(7);
  InventorySystem.add(st, 'potato', 60, 'B', false);
  const lock = w.sell('potato', 'B', false, 60, 'wholesale');
  st.player.level = 3;
  const lot = w.sell('potato', 'B', false, 20, 'wholesale');
  const m0 = st.finance.money;
  const ok = w.sell('potato', 'B', false, 60, 'wholesale');
  const rec = st.finance.receivables.slice();
  const m1 = st.finance.money;
  w.nextDayAt(7); const m2 = st.finance.money;
  w.toHour(8); w.reg.advance(1, true); const m3 = st.finance.money;
  const notEnough = w.sell('potato', 'B', false, 5);
  return { lock: lock.reason, lot: lot.reason, ok, due: rec[0] && calendar(rec[0].dueMinute), m0, m1, m2, m3, notEnough: notEnough.reason, ledger: st.finance.ledger.slice(-1)[0] };
}

function shopChecks() {
  const w = makeWorld();
  const st = w.state;
  const out = [];
  out.push(`çilek tohumu (sv.1): ${w.buy('seed_strawberry', 1).reason}`);
  out.push(`kabak tohumu (sv.1): ${w.buy('seed_pumpkin', 1).reason}`);
  out.push(`patates tohumu ×99 = ${w.buy('seed_potato', 99).total} ₺ → ok`);
  const m = st.finance.money;
  transact(st, w.bus, { amount: -m + 10, category: 'other', label: 'test' });
  out.push(`bakiye 10 ₺, NPK: ${w.buy('npk', 1).reason}`);
  out.push(`transact(−50) bakiye 10: ${transact(st, w.bus, { amount: -50, category: 'other', label: 'x' })} (para ${st.finance.money})`);
  transact(st, w.bus, { amount: 100000, category: 'other', label: 'test' });
  // envanter dolu: tüm yuvaları farklı eşyalarla doldur
  const fillers = Object.keys(ITEMS).filter((id) => ITEMS[id].category === 'crop');
  let qn = 0;
  while (freeSlots(st) > 0) { InventorySystem.add(st, fillers[qn % fillers.length], 99, ['A', 'B', 'C'][Math.floor(qn / fillers.length) % 3], qn >= fillers.length * 3); qn++; if (qn > 200) break; }
  out.push(`envanter dolu, kireç: ${w.buy('lime', 1).reason}`);
  out.push(`geçersiz adet 0: ${w.buy('lime', 0).reason}; 100: ${w.buy('lime', 100).reason}; mağazada yok: ${w.buy('potato', 1).reason}`);
  out.push(`organik sprey yığını organik mi: ${JSON.stringify(st.inventory.items.organic_spray?.map((s) => s.organic))}`);
  return out;
}

function validateChecks() {
  const { w } = runStrategy({ maxTiles: 24, days: 6 });
  const clean = JSON.parse(JSON.stringify(w.state));
  const f1 = [];
  EconomySystem.validate(clean, (p) => f1.push(p)); MarketSystem.validate(clean, (p) => f1.push(p));
  const bad = JSON.parse(JSON.stringify(w.state));
  bad.finance.ledger.push({ day: 'x' }, null, { day: 1, min: 2, amount: NaN, category: 'sales', label: 'a' });
  bad.finance.dailySummary.push({ day: 3, income: 'q' });
  bad.finance.receivables = [{ dueMinute: 10, amount: -5, label: 'x' }, { dueMinute: 100, amount: 50, label: 'ok' }];
  bad.market.prices.potato = { saturation: 7, noise: 'x', soldToday: -3 };
  bad.market.prices.unknown = { saturation: 1 };
  delete bad.market.prices.lettuce;
  bad.market.history.wheat = 'bozuk';
  const f2 = [];
  EconomySystem.validate(bad, (p) => f2.push(p)); MarketSystem.validate(bad, (p) => f2.push(p));
  const nf = {}; const nb = createInitialState(1); delete nb.market; nb.finance = 3;
  EconomySystem.validate(nb, (p) => (nf[p] = 1)); MarketSystem.validate(nb, (p) => (nf[p] = 1));
  return { clean: f1.length, bad: f2, fixedPotato: bad.market.prices.potato, rec: bad.finance.receivables.length, lettuce: !!bad.market.prices.lettuce, wheatHist: bad.market.history.wheat, nb: Object.keys(nf), nbOk: Array.isArray(nb.finance.ledger) && Object.keys(nb.market.prices).length === SELLABLE_IDS.length };
}

// ================================================================== ÇIKTI
console.log(`sim-economy — tohum ${SEED}, ${DAYS} gün${TRIALS.length ? ` (DENEME: ${TRIALS.join(', ')})` : ''}, ${ProgressionSystem ? 'ProgressionSystem' : 'yerel seviye izleyici (ProgressionSystem yok)'}`);
{
  const w = makeWorld();
  const st = w.state;
  console.log(`Yeni oyun: para ${st.finance.money} (START_MONEY ${START_MONEY}), market.prices ${Object.keys(st.market.prices).length} ürün, history[potato] = ${JSON.stringify(st.market.history.potato)}, patates ${currentPrice(st, 'potato')} ₺, marul ${currentPrice(st, 'lettuce')} ₺`);
}

const runs = [24, 48].map((t) => ({ t, ...runStrategy({ maxTiles: t }) }));
for (const r of runs) {
  table(`Strateji — en fazla ${r.t} karo (gün sonu)`, ['gün', 'kasa ₺', 'net varlık ₺', 'satış ₺', 'kümülatif ₺', 'seviye', 'karo', 'ekili'],
    r.rows.map((x) => [x.day, fmt(x.money), fmt(x.net), fmt(x.sales), fmt(x.cum), x.level, x.tiles, x.planted]));
  const st = r.w.state;
  const cs = categorySums(st);
  console.log(`Kategori toplamları: ${Object.entries(cs).map(([k, v]) => `${k} ${fmt(v)}`).join(', ')}`);
  console.log(`Satış: pazar ${fmt(r.stats.market)} ₺, toptancı ${fmt(r.stats.wholesale)} ₺; satılan: ${JSON.stringify(st.stats.sold)}; hasat: ${JSON.stringify(st.stats.harvested)}`);
  console.log(`Seviye atlamaları: ${r.w.log.levelUps.map((l) => `g${l.day}→${l.level}`).join(', ') || '—'}; envanter dolu: ${r.w.log.full}; bozulma olayı: ${r.w.log.spoiled.length}; defter ${st.finance.ledger.length} kayıt, özet ${st.finance.dailySummary.length} gün`);
  const fails = r.w.log.shop.filter((x) => !x.ok).map((x) => x.reason); const mf = r.w.log.market.filter((x) => !x.ok).map((x) => x.reason);
  console.log(`Ret: mağaza ${fails.length} (${[...new Set(fails)].join(' | ') || '—'}), pazar ${mf.length} (${[...new Set(mf)].join(' | ') || '—'})`);
}
const end = runs[0].rows[runs[0].rows.length - 1];
console.log(`\nHEDEF (PLAN §4): ilk mevsim sonu kasa ≈ 7.000–9.000 ₺ → 24 karo: ${fmt(end.money)} ₺ ${end.money >= 7000 && end.money <= 9000 ? '(TUTUYOR)' : '(TUTMUYOR)'}; 48 karo: ${fmt(runs[1].rows[runs[1].rows.length - 1].money)} ₺`);

const sd = saturationDemo();
console.log('\n=== Doygunluk: aynı gün 40 patates (B, pazar yeri, 1. gün) ===');
console.log(`1 birim: ${sd.one.total} ₺ | 40 birim toplam ${sd.q40.total} ₺ (ort. ${sd.q40.avg}) | 40. birim ≈ ${sd.last} ₺ (−${((1 - sd.last / sd.one.total) * 100).toFixed(1)}%)`);
console.log(`41 birim teklifi: "${sd.q41.reason}" | satış sonrası liste fiyatı ${sd.after} ₺ | aynı gün 1 birim daha: "${sd.lim.reason}"`);
console.log(`Toparlanma: ${sd.recov.join(' · ')}`);

table('Toptancı vs pazar yeri (patates B, seviye 3)', ['adet', 'toptancı', 'ödeme', 'pazar yeri (günde ≤40)', 'süre', 'toptancı farkı'], channelCompare());

const wf = wholesaleFlow();
console.log('\n=== Toptancı akışı ===');
console.log(`seviye 1: "${wf.lock}" | 20 birim: "${wf.lot}" | 60 birim: ok=${wf.ok.ok} toplam ${wf.ok.total} paidNow=${wf.ok.paidNow}, vade gün ${wf.due?.day} ${String(wf.due?.hour).padStart(2, '0')}:00`);
console.log(`kasa: satış öncesi ${wf.m0}, satış sonrası ${wf.m1}, ertesi 07:00 ${wf.m2}, 08:00 sonrası ${wf.m3} | defter: ${JSON.stringify(wf.ledger)} | stok yok: "${wf.notEnough}"`);

console.log('\n=== Mağaza kuralları ===');
for (const l of shopChecks()) console.log(' -', l);

const vc = validateChecks();
console.log('\n=== Kayıt doğrulama ===');
console.log(`temiz kayıtta onarım: ${vc.clean}; bozuk kayıtta: ${vc.bad.join(', ')}`);
console.log(`→ potato ${JSON.stringify(vc.fixedPotato)}, alacak ${vc.rec}, marul girdisi geri: ${vc.lettuce}, buğday geçmişi ${JSON.stringify(vc.wheatHist)}`);
console.log(`finance=3, market yok: onarılan ${vc.nb.join(', ')}; yapı tamam: ${vc.nbOk}`);

const a = JSON.stringify(runStrategy({ maxTiles: 24, days: 10 }).w.state);
const b = JSON.stringify(runStrategy({ maxTiles: 24, days: 10 }).w.state);
console.log(`\nDeterminizm (aynı tohum, 10 gün, state JSON eşit): ${a === b ? 'EVET' : 'HAYIR'}`);

// Performans: onDay (tüm ürünler) ve teklif hesabı
{
  const w = makeWorld(); const st = w.state; const ctx = w.reg.ctx;
  const N = 2000; let t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) MarketSystem.onDay(st, w.bus, ctx);
  const dayMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  InventorySystem.add(st, 'potato', 99);
  t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) quote(st, { itemId: 'potato', qty: 40 });
  const qMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`Performans: MarketSystem.onDay ${dayMs.toFixed(4)} ms, quote(40) ${qMs.toFixed(4)} ms`);
}
