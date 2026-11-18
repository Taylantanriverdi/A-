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
import { WORKER_TYPES, WORKER_HOME, HIRING, MAX_WORKERS } from '../src/data/workers.js';
import { actionMinutes } from '../src/systems/workers/tasks.js';
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

// ------------------------------------------------------------ senaryo 4 (Aşama 8): ilan panosu + 3 çalışan + işaretli 12 karo
const cand = (id, type, skills, wage, look = 1) => ({ id, type, name: id, skills, wage, look: type === 'apprentice' ? null : look, hireCost: WORKER_TYPES[type].hireCost });
{
  const { state, bus, reg } = world(30000);
  const day = () => calendar(state.time.totalMinutes).day;
  const c0 = state.hiring.candidates;
  check('ilan panosu başlangıçta dolu', c0.length === HIRING.candidates && state.hiring.refreshedDay === 1, `n=${c0.length}`);
  const okCand = (c) => ['farm', 'animal', 'machine'].every((k) => { const sr = WORKER_TYPES[c.type].skillRange || [1, 1]; return c.skills[k] >= sr[0] && c.skills[k] <= sr[1]; })
    && Math.abs(c.wage / WORKER_TYPES[c.type].wagePerDay - 1) <= (WORKER_TYPES[c.type].wageJitter || 0) + 0.01
    && (c.type === 'apprentice' ? c.look === null : c.look >= 0 && c.look <= 3) && typeof c.name === 'string';
  check('aday yetenek/maaş/look aralıkta', c0.every(okCand), c0.map((c) => `${c.type}:${c.wage}`).join(' '));
  const ids0 = c0.map((c) => c.id).join();
  reg.advance(7 * MIN_PER_DAY, true);
  check('ilan panosu 7 günde yenilenir', state.hiring.candidates.map((c) => c.id).join() !== ids0 && state.hiring.refreshedDay >= 8, `gün=${state.hiring.refreshedDay}`);
  // elle kurulmuş adaylarla işe al
  state.hiring.candidates = [cand('cA', 'experienced', { farm: 3, animal: 3, machine: 3 }, 180), cand('cB', 'master', { farm: 5, animal: 5, machine: 5 }, 310, 2)];
  const m0 = state.finance.money;
  bus.emit('worker:hire', { type: 'apprentice' });
  bus.emit('worker:hire', { candidateId: 'cA' });
  bus.emit('worker:hire', { candidateId: 'cB' });
  check('3 çalışan işe alındı', state.workers.length === 3 && state.hiring.candidates.length === 0);
  const [wa, we, wm] = state.workers;
  check('hireCost wages olarak düştü', m0 - state.finance.money === 500 + 1500 && state.finance.ledger.filter((l) => l.category === 'wages').length === 2, `düşen=${m0 - state.finance.money}`);
  check('çalışan alanları (type/skills/wage/look)', we.skills.farm === 3 && we.wage === 180 && wm.look === 2 && wa.look === null && wm.type === 'master');
  const t = (w, k) => actionMinutes(WORKER_TYPES[w.type], w, k);
  check('usta eylem süresi daha kısa', t(wm, 'harvest') < t(we, 'harvest') && t(we, 'harvest') < t(wa, 'harvest'), `usta=${t(wm, 'harvest').toFixed(2)} der=${t(we, 'harvest').toFixed(2)} çırak=${t(wa, 'harvest').toFixed(2)}`);
  bus.emit('worker:hire', { candidateId: 'zzz' });
  const full = []; bus.on('worker:result', (r) => full.push(r));
  for (let i = 0; i < MAX_WORKERS; i++) { state.hiring.candidates = [cand(`x${i}`, 'experienced', { farm: 2, animal: 2, machine: 2 }, 170)]; bus.emit('worker:hire', { candidateId: `x${i}` }); }
  check('MAX_WORKERS aşılmaz', state.workers.length === MAX_WORKERS && full.some((r) => r.ok === false && /En fazla/.test(r.reason)), `n=${state.workers.length}`);
  for (const w of state.workers.slice(3)) bus.emit('worker:fire', { workerId: w.id });
  check('işten çıkarma (3 kaldı)', state.workers.length === 3);
  // 12 işaretli karo: 4x3 alan (bağımsız bölge), plant işareti → önce sürülür sonra ekilir
  const marked = [];
  for (let y = 13; y <= 15; y++) for (let x = 33; x <= 36; x++) marked.push(`${x},${y}`);
  add(state, 'seed_potato', 30);
  let missing = 0;
  for (const id of marked) { if (!state.tiles[id]) { missing++; continue; } state.tiles[id].mark = { plan: 'plant', itemId: 'seed_potato' }; }
  check('işaretli karolar mevcut', missing === 0, `eksik=${missing}`);
  const did = {}; let failed = 0;
  const doers = new Set();
  bus.on('worker:did', (e) => { if (e.ok) { did[e.kind] = (did[e.kind] || 0) + 1; doers.add(e.workerId); } else failed++; });
  let dup = 0, runs = 0;
  bus.on('vehicle:run', () => { runs++; });
  const wages = [];
  bus.on('money:changed', (e) => { if (e.category === 'wages') wages.push(e.amount); });
  for (let m = 0; m < 2 * MIN_PER_DAY; m++) {
    reg.advance(1, true);
    const seen = new Set();
    for (const w of state.workers) if (w.task && (w.task.phase === 'work')) { const k = `${w.task.kind}:${w.task.target}`; if (seen.has(k)) dup++; seen.add(k); }
  }
  const planted = marked.filter((id) => state.tiles[id].crop && state.tiles[id].state === 'plowed').length;
  const left = marked.filter((id) => state.tiles[id].mark).length;
  check('12 karo sürüldü ve ekildi', planted === 12 && left === 0, `ekili=${planted} kalan işaret=${left} plow=${did.plow || 0} plant=${did.plant || 0}`);
  check('rezervasyon çakışması yok', dup === 0 && failed === 0, `çift=${dup} başarısız=${failed}`);
  check('iş dağılımı: ≥2 çalışan', doers.size >= 2 && (did.plow || 0) + (did.plant || 0) >= 12, `${doers.size} çalışan ${JSON.stringify(did)}`);
  const wageLedger = state.finance.ledger.filter((l) => l.category === 'wages' && /Maaş/.test(l.label));
  const expectPer = we.wage + wm.wage + wa.wage;
  check('maaş kayıtları (3 çalışan × 2 gün)', wageLedger.length === 6 && wageLedger.slice(0, 3).reduce((a, l) => a - l.amount, 0) === expectPer, `kayıt=${wageLedger.length} günlük=${expectPer}`);
  check('traktörsüz araç olayı yok', runs === 0);
}

// ------------------------------------------------------------ senaryo 5 (Aşama 8): traktör 3x3
{
  const { state, bus, reg } = world(30000);
  state.hiring.candidates = [cand('cA', 'experienced', { farm: 3, animal: 3, machine: 4 }, 180), cand('cB', 'experienced', { farm: 3, animal: 3, machine: 4 }, 180), cand('cC', 'experienced', { farm: 3, animal: 3, machine: 2 }, 170)];
  for (const id of ['cA', 'cB', 'cC']) bus.emit('worker:hire', { candidateId: id });
  (state.placed ??= []).push({ id: 'garage1', type: 'garage', tx: 20, ty: 22 });
  state.vehicles = [{ id: 'v1', type: 'tractor', garageId: 'garage1', condition: 100 }];
  bus.emit('placed:changed', {});
  add(state, 'seed_potato', 40);
  const regionA = [], regionB = [];
  for (let y = 13; y <= 15; y++) for (let x = 33; x <= 35; x++) regionA.push(`${x},${y}`);
  for (let y = 13; y <= 15; y++) for (let x = 38; x <= 40; x++) regionB.push(`${x},${y}`);
  for (const id of [...regionA, ...regionB]) state.tiles[id].mark = { plan: 'plant', itemId: 'seed_potato' };
  const runs = []; let overlap = 0, fuel = 0, failed = 0;
  bus.on('vehicle:run', (e) => runs.push(e));
  bus.on('worker:did', (e) => { if (!e.ok) failed++; });
  bus.on('money:changed', (e) => { if (e.category === 'fuel') fuel += e.amount; });
  for (let m = 0; m < MIN_PER_DAY; m++) {
    reg.advance(1, true);
    if (state.workers.filter((w) => w.vehicle).length > 1) overlap++;
  }
  const all = [...regionA, ...regionB];
  const planted = all.filter((id) => state.tiles[id].crop).length;
  check('traktör 3x3 kullanıldı (vehicle:run)', runs.length >= 1 && runs[0].type === 'tractor' && runs[0].tiles.length >= 3 && runs[0].driverId, `koşu=${runs.length} karo=${runs.map((r) => r.tiles.length).join('+')}`);
  check('traktör aynı anda tek çalışanda', overlap === 0, `çakışma dk=${overlap}`);
  check('yakıt "fuel" defterinde', fuel < 0 && state.finance.ledger.some((l) => l.category === 'fuel'), `yakıt=${fuel}`);
  check('araç işiyle 18 karo ekildi, araç iade', planted === 18 && failed === 0 && state.workers.every((w) => !w.vehicle), `ekili=${planted} başarısız=${failed}`);
  const drivers = new Set(runs.map((r) => r.driverId));
  check('makine yeteneği <3 olan sürmez', !runs.some((r) => state.workers.find((w) => w.id === r.driverId)?.skills.machine < 3) && drivers.size >= 1);
}

console.log('');
const wd = Math.max(...rows.map((r) => r[0].length)) + 2;
for (const r of rows) console.log(r[0].padEnd(wd) + r[1].padEnd(8) + r[2]);
const failed = rows.filter((r) => r[1] === 'KALDI').length;
console.log(`\n${rows.length - failed}/${rows.length} geçti`);
process.exit(failed ? 1 : 0);
