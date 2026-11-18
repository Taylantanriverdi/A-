// Üretim zinciri simülasyonu (Node, Phaser yok): node tools/sim-production.mjs
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { add, count } from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import ProgressionSystem from '../src/systems/ProgressionSystem.js';
import ProductionSystem, { validate } from '../src/systems/ProductionSystem.js';
import { MACHINES, MACHINE_RULES, RECIPES } from '../src/data/recipes.js';
import { recipeEconomics } from '../src/systems/production/sim.js';
import { calendar } from '../src/core/timeUtils.js';

function makeBus() {
  const map = new Map();
  return {
    on(n, fn) { if (!map.has(n)) map.set(n, []); map.get(n).push(fn); return () => {}; },
    emit(n, p) { const l = map.get(n); if (l) for (const fn of l.slice()) fn(p); },
  };
}
const state = createInitialState(777);
state.player.level = 12; state.finance.money = 200000;
const bus = makeBus();
const reg = new SystemRegistry(state, bus);
reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(ProgressionSystem).register(ProductionSystem);
const results = []; const events = [];
bus.on('machine:result', (r) => results.push(r));
for (const n of ['machine:done', 'building:built', 'xp:add']) bus.on(n, (p) => events.push([n, p]));
const cmd = (n, p) => { bus.emit(n, p); return results[results.length - 1]; };
const ledger = (cat) => state.finance.ledger.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0);
const rows = [];
const check = (name, cond, detail = '') => rows.push([name, cond ? 'GEÇTİ' : 'KALDI', detail]);
const run = (min) => reg.advance(min, true);

// 1) inşa
const money0 = state.finance.money;
let r = cmd('shop:buildMachine', { machine: 'dairy' });
check('Mandıra inşa + building:built + defter buildings', r.ok && ledger('buildings') === -MACHINES.dairy.price && events.some((e) => e[0] === 'building:built' && e[1].lotId === 'dairy'), `₺${money0 - state.finance.money}`);
check('İkinci inşa reddedilir', !cmd('shop:buildMachine', { machine: 'dairy' }).ok);
state.player.level = 1; check('Seviye kilidi', !cmd('shop:buildMachine', { machine: 'loom' }).ok); state.player.level = 12;

// 2) 6 süt -> 2 peynir (kalite en düşük, organik)
add(state, 'milk', 4, 'A', true); add(state, 'milk', 2, 'C', true);
const e0 = state.finance.money;
cmd('machine:queue', { machineId: 'm_dairy', recipe: 'cheese' });
cmd('machine:queue', { machineId: 'm_dairy', recipe: 'cheese' });
check('Süt tüketildi, elektrik düştü', count(state, 'milk') === 0 && ledger('electricity') === -2 * RECIPES.cheese.kwh * MACHINE_RULES.kwhPrice, `elektrik ${ledger('electricity')}`);
check('Kuyruk 2 iş, ikincisi bekler', state.machines[0].queue.length === 2 && state.machines[0].queue[1].endMin === null);
run(6 * 60 - 1); check('5:59 sonra çıktı yok', Object.keys(state.machines[0].output).length === 0);
run(1); const m = state.machines[0];
check('1. iş 6 saatte bitti', m.output.cheese?.[0]?.qty === 1 && m.queue.length === 1);
run(6 * 60);
const ch = m.output.cheese || [];
check('2 peynir, kalite = en düşük girdi', ch.reduce((s, x) => s + x.qty, 0) === 2 && ch.every((x) => x.q === 'A' || x.q === 'C'), JSON.stringify(ch));
// kalite/organik: 1. iş 3 süt (4A'dan 3A organik?) -> sıralama C önce
check('Organik tüm girdi organikse', ch.every((x) => x.organic === true));
check('Aşınma −2/iş', m.condition === 100 - 2 * MACHINE_RULES.wearPerJob, `${m.condition}`);
const xpBefore = events.filter((e) => e[0] === 'xp:add').length;
r = cmd('machine:collect', { machineId: 'm_dairy' });
check('Topla -> envanter + XP', r.ok && count(state, 'cheese') === 2 && events.filter((e) => e[0] === 'xp:add').length === xpBefore + 1, `xp ${r.xp}`);
check('Kutu boşken toplama reddi', !cmd('machine:collect', { machineId: 'm_dairy' }).ok);

// karışık organik
add(state, 'milk', 2, 'B', true); add(state, 'milk', 1, 'B', false);
cmd('machine:queue', { machineId: 'm_dairy', recipe: 'cheese' }); run(6 * 60);
check('Karışık organik -> organik değil', m.output.cheese?.[0]?.organic === false);
cmd('machine:collect', { machineId: 'm_dairy' });

// 3) un -> ekmek
cmd('shop:buildMachine', { machine: 'mill' }); cmd('shop:buildMachine', { machine: 'bakery' });
add(state, 'wheat', 8, 'B', false);
cmd('machine:queue', { machineId: 'm_mill', recipe: 'flour' }); cmd('machine:queue', { machineId: 'm_mill', recipe: 'flour' });
run(4 * 60); cmd('machine:collect', { machineId: 'm_mill' });
check('Buğday -> 2 un', count(state, 'flour') === 2);
cmd('machine:queue', { machineId: 'm_bakery', recipe: 'bread' }); cmd('machine:queue', { machineId: 'm_bakery', recipe: 'bread' });
run(6 * 60); cmd('machine:collect', { machineId: 'm_bakery' });
check('Un -> 4 ekmek', count(state, 'bread') === 4);
// 4) reçel
cmd('shop:buildMachine', { machine: 'cannery' }); add(state, 'strawberry', 3, 'B', false);
cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' }); run(4 * 60);
cmd('machine:collect', { machineId: 'm_cannery' });
check('3 çilek -> reçel', count(state, 'strawberry_jam') === 1);
check('Yanlış tarif reddi', !cmd('machine:queue', { machineId: 'm_cannery', recipe: 'cheese' }).ok);
check('Girdi yok reddi', !cmd('machine:queue', { machineId: 'm_cannery', recipe: 'grape_jam' }).ok);

// 5) kuyruk sınırı
add(state, 'strawberry', 30, 'B', false);
for (let i = 0; i < 3; i++) cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' });
r = cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' });
check('Kuyruk sınırı 3', !r.ok && state.machines.find((x) => x.type === 'cannery').queue.length === 3, r.reason);
run(12 * 60); cmd('machine:collect', { machineId: 'm_cannery' });

// 6) condition: yavaşlama, durma, bakım
const can = state.machines.find((x) => x.type === 'cannery');
can.condition = 45; add(state, 'strawberry', 3, 'B', false);
cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' });
const j = can.queue[0];
check('condition<50 -> süre x1.3', j.endMin - j.startMin === Math.round(4 * 60 * 1.3), `${j.endMin - j.startMin} dk`);
run(400); cmd('machine:collect', { machineId: 'm_cannery' });
can.condition = 19; add(state, 'strawberry', 3, 'B', false);
r = cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' });
check('condition<20 durur', !r.ok && /bakım/i.test(r.reason));
const mt0 = state.finance.money;
r = cmd('machine:repair', { machineId: 'm_cannery' });
check('Bakım: ücret = fiyat×%4, condition 100, defter maintenance', r.ok && can.condition === 100 && mt0 - state.finance.money === Math.round(MACHINES.cannery.price * 0.04) && ledger('maintenance') < 0, `₺${r.cost}`);
check('Bakımlıyken tekrar bakım reddi', !cmd('machine:repair', { machineId: 'm_cannery' }).ok);
// durma sırasında kuyruk bekler, bakımla sürer
can.condition = 21; add(state, 'strawberry', 6, 'B', false);
cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' }); cmd('machine:queue', { machineId: 'm_cannery', recipe: 'strawberry_jam' });
run(400);
check('İş sonrası condition<20 -> sıradaki iş bekler', can.queue.length === 1 && can.queue[0].endMin === null, `cond ${can.condition}`);
cmd('machine:repair', { machineId: 'm_cannery' });
check('Bakımla bekleyen iş başladı', can.queue[0].endMin != null);
run(300);

// 7) otomatik
add(state, 'wheat', 8, 'B', false);
cmd('machine:auto', { machineId: 'm_mill', recipe: 'flour' }); run(2);
check('Otomatik tarif kuyruğa ekler', state.machines.find((x) => x.type === 'mill').queue.length === 1);
run(4 * 60 + 5);
const mill = state.machines.find((x) => x.type === 'mill');
check('Otomatik 2 iş (8 buğday) sonra durur', (mill.output.flour || []).reduce((a, x) => a + x.qty, 0) === 2 && mill.queue.length === 0, JSON.stringify(mill.output));
cmd('machine:auto', { machineId: 'm_mill', recipe: null });

// 8) validate / kayıt
const copy = JSON.parse(JSON.stringify(state));
copy.machines.push({ type: 'dairy' }, { type: 'xx' }); copy.machines[0].queue.push({ recipe: 'bogus' }); copy.machines[0].condition = 'a';
const fixes = []; validate(copy, (p) => fixes.push(p));
check('validate bozuk veriyi onarır', copy.machines.length === state.machines.length && copy.machines[0].condition === 100 && fixes.length >= 3, fixes.join(','));

// kâr tablosu
const now = calendar(state.time.totalMinutes);
console.log('\n=== Tarif kâr tablosu (B kalite, pazar fiyatı, elektrik ₺2,5/kWh) ===');
console.log('tarif'.padEnd(16), 'girdi₺'.padStart(7), 'çıktı₺'.padStart(7), 'elek₺'.padStart(6), 'kâr₺'.padStart(7), 'saat'.padStart(5), '₺/saat'.padStart(7));
for (const id of Object.keys(RECIPES)) {
  const e = recipeEconomics(state, id, now);
  console.log(id.padEnd(16), String(e.inValue).padStart(7), String(e.outValue).padStart(7), String(e.power).padStart(6), String(e.profit).padStart(7), String(RECIPES[id].hours).padStart(5), (e.profit / RECIPES[id].hours).toFixed(0).padStart(7));
}
console.log('\n=== Sonuçlar ===');
for (const [n, s, d] of rows) console.log(`${s}  ${n}${d ? '  — ' + d : ''}`);
const failed = rows.filter((x) => x[1] === 'KALDI').length;
console.log(`\n${rows.length - failed}/${rows.length} geçti`);
process.exit(failed ? 1 : 0);
