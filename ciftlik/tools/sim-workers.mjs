// Çalışan simülasyonu (Node, Phaser yok): node tools/sim-workers.mjs [seed]
// Gerçek Time/Inventory/Farm/Animal/Economy/Progression + WorkerSystem. 6 ekili karo + kümes; Çırak 3 gün çalışır.
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { add, count } from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import ProgressionSystem from '../src/systems/ProgressionSystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import AnimalSystem from '../src/systems/AnimalSystem.js';
import WorkerSystem, { debugSummary, validate } from '../src/systems/WorkerSystem.js';
import { isBlocked } from '../src/systems/workers/pathfinding.js';
import { WORKER_TYPES, WORKER_HOME } from '../src/data/workers.js';
import { TILE_W, TILE_H, MIN_PER_DAY } from '../src/core/constants.js';
import { calendar } from '../src/core/timeUtils.js';

const SEED = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 20261118;
function makeBus() {
  const map = new Map();
  return {
    on(n, fn) { if (!map.has(n)) map.set(n, []); map.get(n).push(fn); return () => {}; },
    emit(n, p) { const l = map.get(n); if (l) for (const fn of l.slice()) fn(p); },
  };
}
function world(money = 20000) {
  const state = createInitialState(SEED);
  state.player.level = 6; state.finance.money = money;
  const bus = makeBus();
  const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem).register(EconomySystem).register(ProgressionSystem)
    .register(FarmSystem).register(AnimalSystem).register(WorkerSystem);
  return { state, bus, reg };
}
const rows = [];
const check = (name, cond, detail = '') => rows.push([name, cond ? 'GEÇTİ' : 'KALDI', detail]);

// ------------------------------------------------------------ senaryo 1: 3 gün
{
  const { state, bus, reg } = world();
  const did = {}; const didFail = {};
  bus.on('worker:did', (e) => { const m = e.ok ? did : didFail; m[e.kind] = (m[e.kind] || 0) + 1; });
  let mounts = 0, prevMode = null, prevOn = false;
  bus.on('worker:state', (e) => { if (e.onDonkey && !prevOn) mounts++; prevOn = e.onDonkey; prevMode = e.mode; });
  // sahte atölye (ProductionSystem yok): çıktı kutusu + machine:collect komutu
  (state.placed ??= []).push({ id: 'pmill', type: 'mill', tx: 58, ty: 6 });
  state.machines = [{ id: 'm_pmill', placedId: 'pmill', type: 'mill', builtDay: 1, condition: 100, queue: [], output: {}, auto: null }];
  bus.on('machine:collect', ({ machineId }) => {
    const m = state.machines.find((x) => x.id === machineId);
    let n = 0;
    for (const id of Object.keys(m.output)) { for (const s of m.output[id]) { add(state, id, s.qty, s.q, false); n += s.qty; } delete m.output[id]; }
    bus.emit('machine:result', { ok: n > 0, reason: n ? undefined : 'Çıktı yok' });
  });
  // koşullar: 6 ekili karo, kümes + 3 tavuk
  const ids = ['34,8', '35,8', '36,8', '34,9', '35,9', '36,9'];
  add(state, 'seed_potato', 20); add(state, 'chicken_feed', 40);
  for (const id of ids) bus.emit('farm:action', { type: 'plant', tileId: id, itemId: 'seed_potato' });
  (state.placed ??= []).push({ id: 'coop1', type: 'coop', tx: 26, ty: 6 }); bus.emit('building:built', { type: 'coop', placedId: 'coop1', tx: 26, ty: 6 });
  for (let i = 0; i < 3; i++) bus.emit('shop:buyAnimal', { animal: 'chicken' });
  const moneyBefore = state.finance.money;
  bus.emit('worker:hire', {});
  check('işe alım', state.workers.length === 1 && state.workers[0].mode === 'home');
  const w = state.workers[0];
  // sabah kuruluk + olgun ekin kurulumu
  const morning = (day) => {
    for (const id of ids) state.tiles[id].moisture = 15;
    if (day === 1) for (const id of ids.slice(0, 2)) { const c = state.tiles[id].crop; c.stage = 4; c.growth = 1; }
    state.machines[0].output = { flour: [{ q: 'B', organic: false, qty: 2 }] };
  };
  morning(1);
  let badCells = 0, homeInHours = 0, notHomeAfter = 0, maxDonkeyTrip = 0;
  const wages = [];
  bus.on('money:changed', (e) => { if (e.category === 'wages') wages.push(e.amount); });
  const maxTiles = new Set();
  for (let min = 0; min < 3 * MIN_PER_DAY; min++) {
    reg.advance(1, true);
    const cal = calendar(state.time.totalMinutes);
    if (cal.hour === 6 && cal.minute === 0) morning(cal.day);
    const tx = Math.floor(w.x / TILE_W), ty = Math.floor(w.y / TILE_H);
    if (isBlocked(tx, ty)) { badCells++; maxTiles.add(`${tx},${ty}`); }
    if (cal.hour >= 7 && cal.hour < 19 && w.mode === 'home') homeInHours++;
    if (cal.hour >= 21 || cal.hour < 6) {
      const d = Math.hypot(w.x / TILE_W - (WORKER_HOME.tx + 0.5), w.y / TILE_H - (WORKER_HOME.ty + 0.5));
      if (!(w.mode === 'home' && d < 0.75 && !w.onDonkey)) notHomeAfter++;
    }
  }
  const wageDef = WORKER_TYPES.apprentice.wagePerDay;
  check('yol engelli karelerden geçmiyor', badCells === 0, `engelli örnek: ${badCells}`);
  check('çalışma saatinde eve kapanmıyor', homeInHours === 0);
  check('21:00-06:00 evde (home, eşeksiz)', notHomeAfter === 0, `ihlal dk: ${notHomeAfter}`);
  check('sulama yaptı', (did.water || 0) > 0, `water=${did.water || 0}`);
  check('hasat yaptı', (did.harvest || 0) > 0, `harvest=${did.harvest || 0}`);
  check('hayvan işi yaptı', ((did.feed || 0) + (did.waterAnimals || 0) + (did.collect || 0)) > 0,
    `feed=${did.feed || 0} su=${did.waterAnimals || 0} topla=${did.collect || 0}`);
  check('atölye işi yaptı (uzak)', (did.machineCollect || 0) > 0, `machineCollect=${did.machineCollect || 0}`);
  check('eşeğe bindi', mounts > 0, `biniş=${mounts}`);
  check('maaş 3 kez düştü', wages.length === 3 && wages.every((a) => a === -wageDef), `${wages.join(',')} (beklenen 3×-${wageDef})`);
  const wagesLedger = state.finance.ledger.filter((l) => l.category === 'wages').length;
  check('defter kaydı (wages)', wagesLedger === 3, `kayıt=${wagesLedger}`);
  console.log('başarısız işler:', JSON.stringify(didFail), ' başarılı:', JSON.stringify(did));
  console.log('debug:', JSON.stringify(debugSummary(state).workers[0]));
  console.log('para:', moneyBefore, '->', state.finance.money);
}

// ------------------------------------------------------------ senaryo 2: maaş ödenemez, çalışmaz; yetince döner
{
  const { state, bus, reg } = world(100);
  bus.emit('worker:hire', {});
  const w = state.workers[0];
  state.finance.money = 10;
  reg.advance(14 * 60 + 15, true); // gün1 06:00 -> ~20:15
  check('para yetmeyince borç', w.debt > 0, `debt=${w.debt}`);
  bus.emit('money:changed', {});
  state.finance.money = 500;
  reg.advance(60, true); // 21:15 -> ödenir
  check('para gelince maaş ödenir', w.debt === 0 && state.finance.money === 500 - WORKER_TYPES.apprentice.wagePerDay, `para=${state.finance.money}`);
}

// ------------------------------------------------------------ senaryo 3: komutlar + doğrulama
{
  const { state, bus } = world();
  let r; bus.on('worker:result', (x) => { r = x; });
  state.player.level = 1;
  bus.emit('worker:hire', {}); check('hireLevel 1 ile işe alınır', r.ok);
  bus.emit('worker:hire', {}); check('ikinci Çırak reddedilir', r.ok === false);
  const id = state.workers[0].id;
  bus.emit('worker:set', { workerId: id, name: '  Ali   Can  çok uzun bir isim ', tasks: { water: false }, enabled: false });
  const w = state.workers[0];
  check('worker:set ad/görev/izin', w.name.length <= 16 && w.tasks.water === false && w.enabled === false, w.name);
  bus.emit('worker:set', { workerId: id, order: ['animals', 'water', 'harvest', 'machines'] });
  check('sıra değişir', w.order[0] === 'animals');
  w.x = NaN; w.mode = 'zzz'; state.donkey = null;
  validate(state, () => {});
  check('validate bozuk kaydı onarır', Number.isFinite(w.x) && w.mode === 'idle' && state.donkey.mode === 'home');
  bus.emit('worker:fire', { workerId: id });
  check('işten çıkarma', state.workers.length === 0);
}

console.log('');
const wd = Math.max(...rows.map((r) => r[0].length)) + 2;
for (const r of rows) console.log(r[0].padEnd(wd) + r[1].padEnd(8) + r[2]);
const failed = rows.filter((r) => r[1] === 'KALDI').length;
console.log(`\n${rows.length - failed}/${rows.length} geçti`);
process.exit(failed ? 1 : 0);
