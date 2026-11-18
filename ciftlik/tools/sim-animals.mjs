// Hayvancılık simülasyonu (Node, Phaser yok): node tools/sim-animals.mjs [seed]
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { add, count } from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import ProgressionSystem from '../src/systems/ProgressionSystem.js';
import AnimalSystem, { validate, canRemove } from '../src/systems/AnimalSystem.js';
import { MIN_PER_DAY } from '../src/core/constants.js';
import { calendar } from '../src/core/timeUtils.js';
import { ANIMALS, ANIMAL_PRODUCTS } from '../src/data/animals.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { ITEMS } from '../src/data/items.js';
import { QUALITY } from '../src/data/farming.js';

const SEED = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 20261118;
function makeBus() {
  const map = new Map();
  return {
    on(n, fn) { if (!map.has(n)) map.set(n, []); map.get(n).push(fn); return () => {}; },
    emit(n, p) { const l = map.get(n); if (l) for (const fn of l.slice()) fn(p); },
  };
}
function world(level = 5, money = 100000) {
  const state = createInitialState(SEED);
  state.player.level = level; state.player.totalXp = 0; state.finance.money = money;
  const bus = makeBus();
  const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(ProgressionSystem).register(AnimalSystem);
  const results = [];
  bus.on('animal:result', (r) => results.push(r));
  const w = {
    state, bus, reg, results,
    cmd(n, p) { bus.emit(n, p); return results[results.length - 1]; },
    act(type, buildingId, extra = {}) { bus.emit('animal:action', { type, buildingId, ...extra }); return results[results.length - 1]; },
    // bir sonraki günün saat:dakikasına kadar
    toHour(h) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
      const to = d * MIN_PER_DAY + h * 60;
      if (to > state.time.totalMinutes) reg.advance(to - state.time.totalMinutes, true);
    },
    nextDayAt(h) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY) + 1;
      reg.advance(d * MIN_PER_DAY + h * 60 - state.time.totalMinutes, true);
    },
    // PlacementSystem yerine: placed listesine ekle + building:built (ücret yok)
    place(type, placedId) {
      state.placed ??= []; placedId = placedId || `p${state.placed.length + 1}`;
      (state.placed ??= []).push({ id: placedId, type, tx: 10, ty: 10 });
      bus.emit('placed:changed', {});
      bus.emit('building:built', { type, placedId, tx: 10, ty: 10 });
      return placedId;
    },
    unplace(placedId) { state.placed = (state.placed || []).filter((o) => o.id !== placedId); bus.emit('placed:changed', {}); },
    fills(item, n) { add(state, item, n, 'B', false); },
  };
  return w;
}
const pad = (s, n) => String(s).padEnd(n);
const ok = (c) => (c ? 'GEÇTİ' : 'KALDI');
const rows = [];
const check = (name, cond, detail = '') => rows.push([name, ok(cond), detail]);

// ---------- 1) Kümes + 4 tavuk, 28 gün tam bakım ----------
function careRun({ type, building, n, feedItem, days = 28, care = true, setup }) {
  const w = world();
  w.place(building);
  const bid = w.state.buildings[0].id;
  for (let i = 0; i < n; i++) w.cmd('shop:buyAnimal', { animal: type });
  const money0 = w.state.finance.money;
  const spentSetup = 100000 - money0 + 0;
  const invest = 100000 - money0;
  w.toHour(6);
  const q = { A: 0, B: 0, C: 0 };
  let feedCost = 0, produced = 0, revenue = 0;
  const def = ANIMALS[type];
  const prod = def.product.itemId;
  if (setup) setup(w);
  for (let d = 0; d < days; d++) {
    if (care) {
      const fi = ITEMS[feedItem];
      // yem: yemlik 3 günlük; boşalan kadarını doldur (envantere satın alınmış gibi say)
      for (let k = 0; k < 4; k++) {
        const need = Math.max(0, 3 * n * def.feed.perDay - w.state.buildings[0].trough.feed);
        if (need < n * def.feed.perDay) break;
        const items = Math.ceil(n * def.feed.perDay);
        w.fills(feedItem, items); feedCost += items * fi.price;
        if (!w.act('feed', bid, { itemId: feedItem }).ok) { Inv_remove(w, feedItem); break; }
      }
      w.act('water', bid); w.act('clean', bid); w.act('pet', bid);
    }
    w.nextDayAt(6);
    const box = w.state.buildings[0].box[prod] || [];
    for (const s of box) { q[s.q] += s.qty; produced += s.qty; revenue += s.qty * ANIMAL_PRODUCTS[prod].basePrice * QUALITY.priceMult[s.q]; }
    if (care) w.act('collect', bid);
    else {/* bakımsız: toplama da yok */}
  }
  return { w, q, produced, revenue, feedCost, invest, bid };
}
function Inv_remove(w, item) { const st = w.state.inventory.items[item]; if (st) delete w.state.inventory.items[item]; }

const A = careRun({ type: 'chicken', building: 'coop', n: 4, feedItem: 'chicken_feed' });
const netA = A.revenue - A.feedCost;
const perDay = netA / 28;
const payback = perDay > 0 ? Math.ceil(A.invest / perDay) : Infinity;
const tot = A.q.A + A.q.B + A.q.C;
const prodDelta = (w) => w.state.animals.length;
console.log('\n=== Tavuk (kümes + 4 tavuk, tam bakım, 28 gün) ===');
console.log(`yumurta: ${A.produced} (A ${A.q.A} / B ${A.q.B} / C ${A.q.C}) | gelir ₺${Math.round(A.revenue)} | yem ₺${A.feedCost} | net ₺${Math.round(netA)} (${perDay.toFixed(1)}/gün) | yatırım ₺${A.invest} | geri ödeme ~${payback} gün`);
console.log(`hayvan sayısı: ${A.w.state.animals.length} (doğum: ${A.w.state.animals.length - 4}) | kir: ${A.w.state.buildings[0].dirt} | envanterde yumurta ${count(A.w.state, 'egg')}`);
check('Tavuk: 28 günde yumurta üretildi', A.produced >= 60, `${A.produced} adet`);
check('Tavuk: A kalite çoğunlukta', A.q.A / Math.max(1, tot) > 0.5, `${Math.round(100 * A.q.A / Math.max(1, tot))}% A`);
check('Tavuk: net kâr > 0', netA > 0, `₺${Math.round(netA)}`);

// ---------- 2) Bakımsız ----------
const N = careRun({ type: 'chicken', building: 'coop', n: 4, feedItem: 'chicken_feed', care: false, days: 28 });
const nan = N.w.state.animals;
console.log('\n=== Bakımsız (28 gün hiç yem/su/temizlik yok) ===');
console.log(`yumurta (kutuda): ${N.produced} | hayvan ${nan.length} (ölüm yok) | sağlık ${nan.map((a) => Math.round(a.health)).join('/')} | hasta ${nan.filter((a) => a.sick).length} | kir ${N.w.state.buildings[0].dirt}`);
// üretim ilk günlerden sonra durmalı: son 14 günde üretim 0
const N2 = (() => {
  const w = world(); w.place('coop'); for (let i = 0; i < 4; i++) w.cmd('shop:buyAnimal', { animal: 'chicken' });
  w.toHour(6); const log = [];
  for (let d = 0; d < 28; d++) { const before = (w.state.buildings[0].box.egg || []).reduce((s, x) => s + x.qty, 0); w.nextDayAt(6); log.push((w.state.buildings[0].box.egg || []).reduce((s, x) => s + x.qty, 0) - before); }
  return log;
})();
console.log(`günlük üretim: ${N2.join(' ')}`);
check('Bakımsız: ölüm yok, üretim durur', nan.length === 4 && N2.slice(14).every((x) => x === 0), `son 14 gün üretim ${N2.slice(14).reduce((a, b) => a + b, 0)}`);
check('Bakımsız: sağlık tabanı korunur (ölüm yok)', nan.every((a) => a.health >= 5), '');

// ---------- 3) İnek ----------
const C = careRun({ type: 'cow', building: 'barn', n: 2, feedItem: 'hay' });
const netC = C.revenue - C.feedCost;
const perDayC = netC / 28;
console.log('\n=== İnek (ahır + 2 inek, tam bakım, 28 gün) ===');
console.log(`süt: ${C.produced} (A ${C.q.A} / B ${C.q.B} / C ${C.q.C}) | gelir ₺${Math.round(C.revenue)} | yem ₺${C.feedCost} | net ₺${Math.round(netC)} (${perDayC.toFixed(1)}/gün) | yatırım ₺${C.invest} | geri ödeme ~${perDayC > 0 ? Math.ceil(C.invest / perDayC) : '∞'} gün`);
check('İnek: süt üretildi, net kâr > 0', C.produced > 0 && netC > 0, `${C.produced} süt, ₺${Math.round(netC)}`);

// ---------- 4) Ret senaryoları ----------
const R = world(5);
let r = R.cmd('shop:buyAnimal', { animal: 'cow' });
check('Ahır olmadan inek reddi', r.ok === false && /ahır/i.test(r.reason), r.reason);
const D = world(5);
D.place('coop', 'c1');
D.cmd('shop:buyAnimal', { animal: 'chicken' });
let cap = 1; while (D.cmd('shop:buyAnimal', { animal: 'chicken' }).ok) cap++;
check('Kümes kapasitesi (8)', cap === BUILDINGS.coop.capacity, `${cap} tavuk`);
// Arı: kovan yerleştirilince bina + bir arı
const B = world(5);
r = B.cmd('shop:buyAnimal', { animal: 'bee' });
check('Kovan yokken arı alımı reddi', r.ok === false, r.reason);
B.place('hive', 'h1');
check('Kovan yerleştirilince bina + arı', B.state.buildings[0]?.type === 'hive' && B.state.buildings[0].id === 'b_h1' && B.state.animals.length === 1);
// İki kümes + iki ahır, canRemove, placed kaldırma
const T = world(5);
T.place('coop', 'c1'); T.place('coop', 'c2'); T.place('barn', 'r1'); T.place('barn', 'r2');
check('İki kümes + iki ahır kaydı', T.state.buildings.length === 4 && T.state.buildings.map((b) => b.id).join() === 'b_c1,b_c2,b_r1,b_r2');
for (let i = 0; i < 9; i++) T.cmd('shop:buyAnimal', { animal: 'chicken' });
const inC = (id) => T.state.animals.filter((a) => a.buildingId === id).length;
check('Tavuklar kapasiteye göre dağılır (8 + 1)', inC('b_c1') === 8 && inC('b_c2') === 1, `${inC('b_c1')}/${inC('b_c2')}`);
r = T.cmd('shop:buyAnimal', { animal: 'cow', buildingId: 'b_r2' });
check('Belirli ahıra inek', r.ok && r.buildingId === 'b_r2');
let cr = canRemove(T.state, 'c2');
check('canRemove: hayvanlı bina reddi', !cr.ok && /hayvan/i.test(cr.reason), cr.reason);
check('canRemove: boş bina serbest', canRemove(T.state, 'r1').ok && canRemove(T.state, 'zzz').ok);
T.unplace('r1');
check('placed kaldırılınca boş bina kaydı silinir', T.state.buildings.length === 3 && !T.state.buildings.some((b) => b.id === 'b_r1'));
T.unplace('c2');
check('Kaldırılan binanın hayvanları da silinir', T.state.animals.length === 9 && T.state.animals.every((a) => a.buildingId !== 'b_c2'));
// Eski kayıt (lotId, placedId yok) silinmez
const O = world(5); O.state.buildings = [{ type: 'coop', lotId: 'coop1' }]; validate(O.state);
O.bus.emit('placed:changed', {});
check('Eski lotId kaydı tolere edilir', O.state.buildings.length === 1 && O.state.buildings[0].id === 'b_coop1');
// Yem/hasta/vet
const V = world(5);
V.place('coop'); V.cmd('shop:buyAnimal', { animal: 'chicken' });
const bid = V.state.buildings[0].id;
V.state.animals[0].sick = true;
const m0 = V.state.finance.money;
r = V.act('vet', bid);
check('Veteriner: −300 ve iyileşir', r.ok && m0 - V.state.finance.money === 300 && !V.state.animals[0].sick, `₺${m0 - V.state.finance.money}`);
r = V.act('feed', bid, { itemId: 'chicken_feed' });
check('Yem yokken reddedilir', !r.ok, r.reason);
V.fills('wheat', 5); r = V.act('feed', bid, { itemId: 'wheat' });
check('Alternatif yem (buğday) kabul', r.ok, r.text);
// Doğrulayıcı
const X = world(5);
X.state.buildings = [{ type: 'coop', placedId: 'c1' }, { type: 'x', placedId: 'zz' }];
X.state.animals = [{ type: 'chicken', buildingId: 'b_c1' }, { type: 'cow', buildingId: 'b_c1' }, null];
const fixes = []; validate(X.state, (p) => fixes.push(p));
check('Doğrulayıcı bozuk kaydı onarır', X.state.buildings.length === 1 && X.state.animals.length === 1 && X.state.animals[0].health === 100, `${fixes.length} onarım`);

console.log('\n=== Kontroller ===');
for (const row of rows) console.log(pad(row[1], 7), pad(row[0], 48), row[2]);
const failed = rows.filter((x) => x[1] !== 'GEÇTİ').length;
console.log(failed ? `\n${failed} kontrol KALDI` : '\nTüm kontroller geçti');
process.exit(failed ? 1 : 0);
