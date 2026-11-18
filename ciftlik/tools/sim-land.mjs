// Aşama 8 simülasyonu (Node): arazi, sera, depolama, araçlar. node tools/sim-land.mjs
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { add, count, spoilDay, usedSlots } from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import PlacementSystem from '../src/systems/PlacementSystem.js';
import AnimalSystem from '../src/systems/AnimalSystem.js';
import LandSystem from '../src/systems/LandSystem.js';
import VehicleSystem from '../src/systems/VehicleSystem.js';
import * as occ from '../src/systems/world/occupancy.js';
import { ITEMS } from '../src/data/items.js';
import { CROPS } from '../src/data/crops.js';
import { VEHICLES } from '../src/data/placeables.js';
import { MIN_PER_DAY } from '../src/core/constants.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
function makeBus() {
  const map = new Map(); const log = [];
  return { log, on(n, f) { if (!map.has(n)) map.set(n, []); map.get(n).push(f); return () => {}; },
    emit(n, p) { log.push([n, p]); for (const f of (map.get(n) || []).slice()) f(p); } };
}
function world(day = 1) {
  const state = createInitialState(11);
  state.time.totalMinutes = (day - 1) * MIN_PER_DAY + 6 * 60;
  state.finance.money = 200000;
  const bus = makeBus(); const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(PlacementSystem).register(FarmSystem)
    .register(AnimalSystem).register(LandSystem).register(VehicleSystem);
  return { state, bus, reg };
}
const last = (bus, n) => [...bus.log].reverse().find((e) => e[0] === n)?.[1];
function freeSpot(state, type) {
  for (let y = 6; y < 20; y++) for (let x = 21; x < 66; x++) if (occ.canPlace(state, type, x, y).ok) return [x, y];
  throw new Error('yer yok ' + type);
}
function placeAt(w, type) {
  const [x, y] = freeSpot(w.state, type);
  w.bus.emit('build:place', { type, tx: x, ty: y });
  const r = last(w.bus, 'build:result');
  if (!r.ok) throw new Error(`${type}: ${r.reason}`);
  return w.state.placed.find((p) => p.id === r.placedId);
}
const ledger = (s, cat) => s.finance.ledger.filter((e) => e.category === cat);

// ---- 1) Arazi ----
{
  const w = world();
  const { state, bus, reg } = w;
  bus.emit('farm:action', { type: 'plow', tileId: '70,8' });
  ok(last(bus, 'farm:result').reason === 'Bu arazi senin değil — satın al', 'satılık parselde çapa reddi: ' + last(bus, 'farm:result').reason);
  bus.emit('build:place', { type: 'fence', tx: 70, ty: 8 });
  ok(last(bus, 'build:result').reason === 'Bu arazi senin değil — satın al', 'satılık parselde yerleştirme reddi');
  state.finance.money = 5000;
  bus.emit('land:buy', { parcelId: 'P2' });
  ok(last(bus, 'land:result').ok === false && !state.land.parcels.find((p) => p.id === 'P2').owned, 'para yetmeyince alım reddi');
  state.finance.money = 20000;
  bus.emit('land:buy', { parcelId: 'P2' });
  ok(last(bus, 'land:result').ok && state.finance.money === 8000, 'P2 alındı, para -12000');
  ok(state.land.parcels.find((p) => p.id === 'P2').owned && !!state.tiles['70,8'] && !!last(bus, 'land:changed'), 'karolar oluştu, land:changed');
  bus.emit('farm:action', { type: 'plow', tileId: '70,8' });
  ok(last(bus, 'farm:result').ok, 'P2 karosuna çapa artık çalışıyor');
  reg.advance(28 * MIN_PER_DAY); // 1. mevsim sonu (28. gün 23:00 geçti)
  const tax = ledger(state, 'tax').filter((e) => e.label === 'Emlak vergisi');
  ok(tax.length === 1 && tax[0].amount === -120, 'emlak vergisi mevsim sonu -120 ₺: ' + JSON.stringify(tax.map((t) => t.amount)));
}

// ---- 2) Sera (kış) ----
{
  const w = world(85); // kış
  const { state, bus, reg } = w;
  const gh = placeAt(w, 'greenhouse');
  const inside = `${gh.tx + 1},${gh.ty + 1}`, inside2 = `${gh.tx + 2},${gh.ty + 1}`;
  add(state, 'seed_tomato', 4, 'B');
  for (const id of [inside, inside2]) {
    bus.emit('farm:action', { type: 'plow', tileId: id });
    ok(last(bus, 'farm:result').ok, 'sera içinde çapa ' + id);
  }
  bus.emit('farm:action', { type: 'plant', tileId: inside, itemId: 'seed_tomato' });
  ok(last(bus, 'farm:result').ok, 'kışın serada domates ekildi');
  // dışarıda reddedilir
  const out = '36,9';
  bus.emit('farm:action', { type: 'plow', tileId: out });
  bus.emit('farm:action', { type: 'plant', tileId: out, itemId: 'seed_tomato' });
  ok(last(bus, 'farm:result').ok === false && /ekilir/.test(last(bus, 'farm:result').reason), 'dışarıda kış ekimi reddi: ' + last(bus, 'farm:result').reason);
  // fiziksel yapı üzerine başka yapı konmaz
  bus.emit('build:place', { type: 'fence', tx: gh.tx + 3, ty: gh.ty + 2 });
  ok(last(bus, 'build:result').ok === false, 'sera içine başka yapı konmaz');
  // dolu: sera etkilenmez
  const c = state.tiles[inside].crop;
  bus.emit('hazard:crops', { chance: 1, damage: 40 });
  ok(c.health === 100, 'dolu/fırtına seradaki ekini etkilemez (sağlık ' + c.health + ')');
  // aynı ekinin açık alandaki kopyası etkilenir
  state.tiles[out].crop = JSON.parse(JSON.stringify(c));
  bus.emit('hazard:crops', { chance: 1, damage: 40 });
  ok(state.tiles[out].crop.health === 60 && c.health === 100, 'açık alandaki ekin dolu yer');
  state.tiles[out].crop = null;
  // büyüme
  for (let d = 0; d < 14 && state.tiles[inside].crop.stage < 4; d++) {
    reg.advance(MIN_PER_DAY);
    bus.emit('farm:action', { type: 'water', tileId: inside });
    { const t0 = state.tiles[inside]; t0.weeds = 0; t0.crop.pest = 0; t0.crop.disease = 0; } // oyuncu bakımı (ot/ilaç)
    state.tiles[inside].moisture = Math.max(state.tiles[inside].moisture, 60);
    if (process.env.DBG) { const cc = state.tiles[inside].crop; console.log('gün', d, 'h', cc.health, 'g', cc.growth.toFixed(2), 'pest', cc.pest, 'dis', cc.disease, 'w', state.tiles[inside].weeds, 'm', state.tiles[inside].moisture); }
  }
  ok(state.tiles[inside].crop.stage >= 4 && !state.tiles[inside].crop.dead, `kışın domates büyüdü (aşama ${state.tiles[inside].crop.stage}, sağlık ${Math.round(state.tiles[inside].crop.health)})`);
  const kwh = ledger(state, 'electricity').slice(-1)[0];
  ok(kwh && /kWh/.test(kwh.label), 'sera kış elektriği: ' + kwh?.label);
  // mark
  bus.emit('farm:mark', { tileId: inside2, plan: 'plant', itemId: 'seed_tomato' });
  ok(state.tiles[inside2].mark?.plan === 'plant', 'farm:mark plant işareti');
  bus.emit('farm:action', { type: 'plant', tileId: inside2, itemId: 'seed_tomato' });
  if (process.env.DBG) console.log(last(bus, 'farm:result'), state.tiles[inside2]);
  ok(!state.tiles[inside2].mark, 'ekilince işaret silindi');
  state.tiles['30,12'].state = 'grass';
  bus.emit('farm:mark', { tileId: '30,12', plan: 'plow' });
  ok(state.tiles['30,12'].mark?.plan === 'plow', 'plow işareti');
  bus.emit('farm:mark', { tileId: '30,12', plan: 'plow' });
  ok(!state.tiles['30,12'].mark, 'aynı işaret tekrar → kalkar');
  state.tiles['36,9'].state = 'plowed'; state.tiles['36,9'].crop = null;
  bus.emit('farm:mark', { tileId: '36,9', plan: 'plow' });
  ok(last(bus, 'farm:markResult').ok === false, 'sürülmüş karoya plow işareti reddi');
}

// ---- 3) Depo ----
{
  const w = world();
  const { state, bus } = w;
  ok(state.inventory.capacity === 24, 'taban kapasite 24');
  const wh = placeAt(w, 'warehouse');
  ok(state.inventory.capacity === 48, 'depo +24 → 48');
  const ids = Object.keys(ITEMS).slice(0, 32);
  for (const id of ids) add(state, id, 1, 'B');
  ok(usedSlots(state) >= 30, 'envanter 30+ yuva dolu: ' + usedSlots(state));
  bus.emit('build:remove', { placedId: wh.id });
  ok(last(bus, 'build:result').ok === false && state.placed.some((p) => p.id === wh.id) && state.inventory.capacity === 48, 'dolu iken depo kaldırma reddi: ' + last(bus, 'build:result').reason);
  for (const id of ids) state.inventory.items[id] && delete state.inventory.items[id];
  bus.emit('build:remove', { placedId: wh.id });
  ok(last(bus, 'build:result').ok && state.inventory.capacity === 24, 'boşalınca kaldırıldı, kapasite 24');
  const silo = placeAt(w, 'silo');
  ok(state.inventory.capacity === 36, 'silo +12');
  add(state, 'wheat', 5, 'A'); add(state, 'lettuce', 5, 'A');
  for (let i = 0; i < 40; i++) spoilDay(state);
  ok(count(state, 'wheat', 'A') === 5, 'silo: buğday bozulmaz');
  ok(count(state, 'lettuce', 'A') === 0, 'silo: marul yine bozulur');
}

// ---- 4) Soğuk hava ----
{
  const w = world();
  const { state, bus } = w;
  add(state, 'lettuce', 3, 'A');
  for (let i = 0; i < 3; i++) spoilDay(state);
  ok(count(state, 'lettuce', 'A') === 3, 'soğuk hava yok: 3. günde hâlâ A');
  spoilDay(state);
  ok(count(state, 'lettuce', 'A') === 0 && count(state, 'lettuce', 'B') === 3, 'soğuk hava yok: 4. günde B (bozulma)');
  placeAt(w, 'coldStorage');
  const s2 = state; s2.inventory.items = {};
  add(s2, 'lettuce', 3, 'A');
  for (let i = 0; i < 19; i++) spoilDay(s2);
  ok(count(s2, 'lettuce', 'A') === 3, 'soğuk hava: 19. günde hâlâ A');
  spoilDay(s2);
  ok(count(s2, 'lettuce', 'A') === 0 && count(s2, 'lettuce', 'B') === 3, 'soğuk hava: 20. günde bozuldu (4 gün → 20 gün)');
  const before = state.finance.money;
  w.reg.advance(MIN_PER_DAY);
  ok(state.finance.ledger.some((e) => e.category === 'electricity'), 'soğuk hava elektriği (günlük): ' + (before - state.finance.money));
}

// ---- 5) Araçlar ----
{
  const w = world();
  const { state, bus, reg } = w;
  bus.emit('shop:buyVehicle', { vehicle: 'tractor' });
  ok(last(bus, 'vehicle:result').ok === false && /garaj/i.test(last(bus, 'vehicle:result').reason), 'garaj olmadan traktör reddi: ' + last(bus, 'vehicle:result').reason);
  const garage = placeAt(w, 'garage');
  const m0 = state.finance.money;
  bus.emit('shop:buyVehicle', { vehicle: 'tractor' });
  ok(last(bus, 'vehicle:result').ok && state.vehicles.length === 1 && state.vehicles[0].garageId === garage.id && state.finance.money === m0 - 28000, 'traktör alındı');
  bus.emit('build:remove', { placedId: garage.id });
  ok(last(bus, 'build:result').ok === false, 'araçlı garaj kaldırılamaz');
  // 3x3 çapa: tamamen çim bir bölge
  let cx = 0, cy = 0;
  outer: for (let y = 13; y < 20; y++) for (let x = 22; x < 38; x++) {
    let good = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = state.tiles[`${x + dx},${y + dy}`]; if (!t || t.state !== 'grass' || occ.isBlocked(state, x + dx, y + dy)) good = false; }
    if (good) { cx = x; cy = y; break outer; }
  }
  ok(cx > 0, `çim 3x3 bölge bulundu (${cx},${cy})`);
  const mm = state.finance.money;
  bus.emit('vehicle:work', { type: 'tractor', tileId: `${cx},${cy}` });
  const r = last(bus, 'vehicle:result');
  const plowed = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (state.tiles[`${cx + dx},${cy + dy}`].state === 'plowed') plowed.push(1);
  ok(r.ok && plowed.length === 9 && r.count === 9, 'traktör 9 karo sürdü');
  const fuel = ledger(state, 'fuel');
  ok(fuel.length === 1 && fuel[0].amount === -Math.round(9 * VEHICLES.tractor.fuelPerTile) && state.finance.money === mm + fuel[0].amount, 'yakıt kaydı: ' + fuel[0]?.amount);
  ok(last(bus, 'vehicle:run')?.tiles.length === 9, 'vehicle:run yayıldı');
  // traktörle ekim
  add(state, 'seed_wheat', 20, 'B');
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) state.tiles[`${cx + dx},${cy + dy}`].state = 'grass';
  bus.emit('vehicle:work', { type: 'tractor', tileId: `${cx},${cy}`, itemId: 'seed_wheat' });
  ok(last(bus, 'vehicle:result').ok && state.tiles[`${cx},${cy}`].crop?.id === 'wheat' && count(state, 'seed_wheat') === 11, 'traktör sür + ek (9 tohum)');
  // biçerdöver
  bus.emit('vehicle:work', { type: 'harvester', tileId: `${cx},${cy}` });
  ok(last(bus, 'vehicle:result').ok === false && last(bus, 'vehicle:result').reason.includes('yok'), 'biçerdöver yokken ret');
  bus.emit('shop:buyVehicle', { vehicle: 'harvester' });
  ok(last(bus, 'vehicle:result').ok, 'biçerdöver alındı');
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = state.tiles[`${cx + dx},${cy + dy}`].crop; c.growth = 1; c.stage = 4; }
  const before = count(state, 'wheat');
  bus.emit('vehicle:work', { type: 'harvester', tileId: `${cx},${cy}` });
  const got = count(state, 'wheat') - before;
  const expect = 9 * Math.round(CROPS.wheat.yield * 1.25);
  ok(last(bus, 'vehicle:result').ok && got === expect, `biçerdöver buğday ×1.25: ${got} (beklenen ${expect}, normal ${9 * CROPS.wheat.yield})`);
  // sağım makinesi
  bus.emit('shop:buyVehicle', { vehicle: 'milker' });
  ok(last(bus, 'vehicle:result').ok === false && /ahır/i.test(last(bus, 'vehicle:result').reason), 'ahır olmadan sağım makinesi reddi');
  const barn = placeAt(w, 'barn');
  bus.emit('shop:buyVehicle', { vehicle: 'milker' });
  ok(last(bus, 'vehicle:result').ok, 'sağım makinesi alındı');
  const b = state.buildings.find((x) => x.placedId === barn.id);
  ok(!!b, 'ahır bina kaydı var');
  b.box = { milk: [{ q: 'B', qty: 6 }], goat_milk: [{ q: 'A', qty: 2 }] };
  const m1 = count(state, 'milk') + count(state, 'goat_milk');
  reg.advance(MIN_PER_DAY); // 06:00 → ertesi gün 06:00 (07:00 sağımı geçti)
  const moved = count(state, 'milk') + count(state, 'goat_milk') - m1;
  ok(moved === 8 && !b.box.milk, 'sağım makinesi sabah sütünü envantere taşıdı (' + moved + ')');
}

console.log(fails ? `\n${fails} HATA` : '\nTüm kontroller geçti');
process.exit(fails ? 1 : 0);
