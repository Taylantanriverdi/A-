// Gece İstilası (K29) simülasyon testi — node tools/sim-defense.mjs
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import PlacementSystem from '../src/systems/PlacementSystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import AnimalSystem from '../src/systems/AnimalSystem.js';
import ProductionSystem from '../src/systems/ProductionSystem.js';
import DefenseSystem from '../src/systems/DefenseSystem.js';
import { MIN_PER_DAY } from '../src/core/constants.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
function makeBus() { const m = new Map(); return { on(n, f) { (m.get(n) || m.set(n, []).get(n)).push(f); return () => {}; }, emit(n, p) { for (const f of m.get(n) || []) f(p); } }; }
function world(seed, raids) {
  const state = createInitialState(seed); state.settings.raids = raids;
  const bus = makeBus(), log = {};
  for (const e of ['raid:warning', 'raid:start', 'raid:end', 'raid:report', 'monster:killed']) bus.on(e, (p) => (log[e] = log[e] || []).push(p));
  const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(PlacementSystem).register(FarmSystem)
    .register(AnimalSystem).register(ProductionSystem).register(DefenseSystem);
  if (raids) bus.emit('defense:mode', { on: true });
  state.finance.money = 100000;
  return { state, bus, reg, log };
}
const placeAt = (w, type, tx, ty) => { const n = w.state.placed.length; w.bus.emit('build:place', { type, tx, ty }); return w.state.placed.length > n; };

// (a) savunmasız: 12 gün
{
  const w = world(11, true);
  for (let x = 34; x < 40; x++) for (let y = 8; y < 12; y++) { w.bus.emit('farm:action', { type: 'plow', tileId: `${x},${y}` }); }
  placeAt(w, 'coop', 26, 8);
  w.reg.advance(MIN_PER_DAY * 12, true);
  const reps = w.log['raid:report'] || [];
  ok((w.log['raid:start'] || []).length >= 1, `(a) 12 günde baskın oldu (${(w.log['raid:start'] || []).length})`);
  ok(reps.length >= 1, `(a) sabah raporu üretildi`);
  const r = reps[reps.length - 1] || {};
  console.log('     son rapor:', JSON.stringify({ day: r.day, kills: r.kills, loot: r.loot, damaged: (r.damaged || []).length, houseDamage: r.houseDamage, penalty: r.penalty }));
  ok(reps.some((x) => (x.houseDamage || 0) > 0 || (x.damaged || []).length > 0), '(a) savunmasız çiftlik hasar aldı');
}
// (b) savunmalı
{
  const w = world(11, true);
  let fences = 0;
  const ring = [];
  for (let x = 31; x <= 51; x++) { ring.push([x, 6], [x, 20]); }
  for (let y = 7; y <= 19; y++) { ring.push([31, y], [51, y]); }
  const occ = await import('../src/systems/world/occupancy.js');
  let gaps = 0;
  for (const [x, y] of ring) {
    const o = occ.objectAt(w.state, x, y);
    if (o && o.decorId) w.bus.emit('build:clear', { decorId: o.decorId });
    if (placeAt(w, 'stoneWall', x, y)) fences++; else if (!(o && o.fixed && o.kind === 'house')) { gaps++; }
  }
  console.log(`     halka: ${fences} duvar, ${gaps} boşluk (ev dışı)`);
  const t1 = placeAt(w, 'tower', 36, 14) || placeAt(w, 'tower', 35, 16), t2 = placeAt(w, 'tower', 47, 13) || placeAt(w, 'tower', 47, 15), br = placeAt(w, 'brazier', 36, 16) || placeAt(w, 'brazier', 48, 10);
  w.bus.emit('soldier:hire', { type: 'archer' }); w.bus.emit('soldier:hire', { type: 'archer' }); w.bus.emit('soldier:hire', { type: 'guard' });
  ok(fences > 60 && t1 && t2 && br, `(b) savunma kuruldu (çit ${fences}, kule ${+t1 + +t2}, meşale ${+br})`);
  ok((w.state.defense.soldiers || []).length === 3, `(b) 3 asker kiralandı`);
  const m0 = w.state.finance.money;
  w.reg.advance(MIN_PER_DAY * 12, true);
  const reps = w.log['raid:report'] || [];
  const kills = reps.reduce((a, r) => a + (r.kills || 0), 0), loot = reps.reduce((a, r) => a + (r.loot || 0), 0);
  const hd = reps.reduce((a, r) => a + (r.houseDamage || 0), 0);
  console.log(`     ${reps.length} baskın, öldürülen ${kills}, ganimet ${loot} ₺, ev hasarı ${hd}, para değişimi ${w.state.finance.money - m0} ₺`);
  ok(kills > 0, '(b) canavarlar öldürüldü');
  const wages = w.state.finance.ledger.filter((e) => e.category === 'soldiers').reduce((a, e) => a + e.amount, 0);
  ok(wages < 0, `(b) asker maaşları ödendi (${wages} ₺)`);
}
// (f) mod kapalı
{
  const w = world(11, false);
  w.reg.advance(MIN_PER_DAY * 30, true);
  ok(!(w.log['raid:start'] || []).length && !(w.log['raid:warning'] || []).length, '(f) mod kapalıyken 30 günde baskın yok');
}
console.log(fails ? `\n${fails} hata` : '\nhepsi geçti');
process.exit(fails ? 1 : 0);
