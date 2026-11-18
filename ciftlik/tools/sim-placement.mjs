// Serbest yerleşim simülasyonu (Node): node tools/sim-placement.mjs
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import PlacementSystem from '../src/systems/PlacementSystem.js';
import * as occ from '../src/systems/world/occupancy.js';
import { bindState, findPath, cellOf, GW } from '../src/systems/workers/pathfinding.js';
import WorldLinks from '../src/core/WorldLinks.js';
import { canApply } from '../src/systems/farm/rules.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
function makeBus() {
  const map = new Map(); const log = [];
  return { log, on(n, f) { if (!map.has(n)) map.set(n, []); map.get(n).push(f); return () => {}; },
    emit(n, p) { log.push([n, p]); for (const f of (map.get(n) || []).slice()) f(p); } };
}
function world(mut) {
  const state = createInitialState(7);
  if (mut) mut(state);
  const bus = makeBus(); const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(PlacementSystem).register(FarmSystem);
  return { state, bus, reg };
}
const last = (bus, n) => [...bus.log].reverse().find((e) => e[0] === n)?.[1];

// 1) yeni oyun
let { state, bus } = world();
ok(['stall', 'well', 'shed'].every((t) => state.placed.some((p) => p.type === t)), 'yeni oyun: tezgah/kuyu/sundurma var');
const fences = state.placed.filter((p) => p.type === 'fence').length;
ok(fences > 30, `yeni oyun: çit yazıldı (${fences})`);
ok(!state.placed.some((p) => p.type === 'fence' && p.tx === 40 && p.ty === 17), 'çit geçidi açık');
state.finance.money = 20000;
// 2) kümes yerleştir
bus.emit('build:place', { type: 'coop', tx: 26, ty: 6 });
ok(last(bus, 'build:result').ok && state.finance.money === 18500, 'kümes yerleşti, para düştü');
const coop = state.placed.find((p) => p.type === 'coop');
ok(last(bus, 'building:built')?.placedId === coop.id, 'building:built yayıldı');
bus.emit('build:place', { type: 'coop', tx: 27, ty: 7 });
ok(last(bus, 'build:result').reason === 'Burası dolu', 'dolu yere ret');
bus.emit('build:place', { type: 'barn', tx: 5, ty: 5 });
ok(last(bus, 'build:result').reason === 'Arazinin dışında', 'arazi dışı ret');
const nB = bus.log.filter((e) => e[0] === 'building:built').length;
bus.emit('build:place', { type: 'fence', tx: 30, ty: 18 });
ok(last(bus, 'build:result').ok && bus.log.filter((e) => e[0] === 'building:built').length === nB, 'çit yerleşti, building:built yok');
// 3) sürülmüş karo
state.tiles['36,9'] ??= { tx: 36, ty: 9, state: 'plowed', crop: null };
state.tiles['36,9'].state = 'plowed';
bus.emit('build:place', { type: 'fence', tx: 36, ty: 9 });
ok(last(bus, 'build:result').reason === 'Ekili/sürülmüş toprağa çit konmaz', 'sürülmüş karoya çit reddi');
// 4) taşı
bus.emit('build:move', { placedId: coop.id, tx: 27, ty: 8 });
ok(last(bus, 'build:result').ok && coop.tx === 27 && state.finance.money === 18500 - 5, 'taşıma ücretsiz (üst üste binmeye izin)');
// 5) kaldır
const m0 = state.finance.money;
bus.emit('build:remove', { placedId: coop.id });
ok(last(bus, 'build:result').ok && state.finance.money === m0 + 750, 'kaldırma iadesi 750');
const stall = state.placed.find((p) => p.type === 'stall');
bus.emit('build:remove', { placedId: stall.id });
ok(!last(bus, 'build:result').ok, 'unique kaldırılamaz');
// hayvanlı bina reddi
bus.emit('build:place', { type: 'coop', tx: 26, ty: 6 });
const c2 = state.placed.find((p) => p.type === 'coop');
state.buildings.push({ id: 'b_x', type: 'coop', placedId: c2.id, trough:{feed:0,water:0}, box:{} }); state.animals.push({ id: 'a1', type: 'chicken', buildingId: 'b_x' });
bus.emit('build:remove', { placedId: c2.id });
ok(!last(bus, 'build:result').ok && /hayvan/i.test(last(bus, 'build:result').reason), 'hayvanlı bina kaldırılamaz');
// 6) ağaç temizleme
const tree = occ.DECOR.find((d) => d.kind === 'tree' && d.tx >= 20 && d.tx <= 68 && d.ty >= 5 && d.ty <= 21);
ok(!!tree, `P1 içinde ağaç var (${tree?.id} ${tree?.tx},${tree?.ty})`);
bus.emit('build:place', { type: 'fence', tx: tree.tx, ty: tree.ty });
ok(last(bus, 'build:result').reason === 'Burası dolu', 'ağaç karosuna yerleştirme reddi');
const m1 = state.finance.money;
bus.emit('build:clear', { decorId: tree.id });
ok(last(bus, 'build:result').ok && state.finance.money === m1 - 40 && !occ.isBlocked(state, tree.tx, tree.ty), 'ağaç temizlendi (-40), karo boş');
bus.emit('build:place', { type: 'fence', tx: tree.tx, ty: tree.ty });
ok(last(bus, 'build:result').ok, 'temizlenen karoya yerleştirme');
// farm kuralı
state.tiles['30,18'] ??= { tx: 30, ty: 18, state: 'grass', crop: null };
const r = canApply(state, { type: 'plow', tileId: '30,18' });
ok(!r.ok && /Ahşap çit/.test(r.reason), `farm engeli: ${r.reason}`);
// pen
const pen = occ.penOf(state, c2.id);
ok(pen && pen.y0 === c2.ty + 3, `penOf ${JSON.stringify(pen)}`);
// WorldLinks
const wl = new WorldLinks(bus, state);
const lk = wl.linkAt(c2.tx + 1, c2.ty + 1);
ok(lk && lk.payload.panel === 'building' && lk.payload.placedId === c2.id, 'WorldLinks: placed -> panel + placedId');
ok(wl.linkAt(stall.tx, stall.ty).payload.panel === 'market', 'WorldLinks: tezgâh -> market');

// 7) eski kayıt göçü
({ state, bus } = world((s) => {
  s.flags.farmInitialized = true;
  s.buildings.push({ id: 'b_coop1', type: 'coop', lotId: 'coop1' }, { id: 'b_hive2', type: 'hive', lotId: 'hive2' });
  s.machines.push({ type: 'dairy', id: 'm_dairy', queue: [] });
}));
const bc = state.buildings[0], mm = state.machines[0];
const pc = state.placed.find((p) => p.id === bc.placedId), pm = state.placed.find((p) => p.id === mm.placedId);
ok(pc && pc.type === 'coop' && pc.tx === 26 && pc.ty === 6, 'göç: kümes lot konumunda');
ok(pm && pm.type === 'dairy' && pm.tx === 53 && pm.ty === 6, 'göç: mandıra lot konumunda');
ok(state.placed.find((p) => p.id === state.buildings[1].placedId)?.tx === 51, 'göç: kovan');
const cnt = state.placed.length; PlacementSystem.ensureStart(state);
ok(state.placed.length === cnt, 'göç idempotent');

// 8) yol bulma yeni ahırın etrafından dolaşır
({ state, bus } = world());
bindState(state);
const s0 = cellOf(36, 14), g0 = cellOf(60, 14);
const before = findPath(s0, g0);
state.finance.money = 99999;
// duvar gibi: 6x4 ahırlar 30..? engel zinciri: y=12..15 boyunca x=48 civarı iki ahır
bus.emit('build:place', { type: 'barn', tx: 52, ty: 10 });
bus.emit('build:place', { type: 'barn', tx: 52, ty: 14 });
ok(state.placed.filter((p) => p.type === 'barn').length === 2, 'iki ahır yerleşti');
const after = findPath(s0, g0);
const crosses = [...after].some((c) => { const x = c % GW, y = (c / GW) | 0; return occ.isBlocked(state, x, y, { walk: true }); });
ok(after && !crosses && after.length >= before.length, `yol ahırların etrafından dolaşıyor (${before.length} -> ${after.length})`);

console.log(fails ? `${fails} BAŞARISIZ` : 'TÜMÜ GEÇTİ');
process.exit(fails ? 1 : 0);
