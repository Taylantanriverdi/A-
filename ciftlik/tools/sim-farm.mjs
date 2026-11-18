// Tarım simülasyonu (Node, Phaser yok): node tools/sim-farm.mjs [seed]
// FarmSystem + InventorySystem SystemRegistry ile sürülür; senaryo sonuçları tablo olarak yazdırılır.
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import InventorySystem, { add, count } from '../src/systems/InventorySystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import { tileInfo, canApply } from '../src/systems/farm/rules.js';
import { MIN_PER_DAY } from '../src/core/constants.js';
import { calendar } from '../src/core/timeUtils.js';
import { SOIL } from '../src/data/farming.js';
import { CROPS } from '../src/data/crops.js';

const SEED = Number(process.argv[2]) || 20261118;

function makeBus() {
  const map = new Map();
  return {
    on(n, fn) { if (!map.has(n)) map.set(n, []); map.get(n).push(fn); return () => { const l = map.get(n); l.splice(l.indexOf(fn), 1); }; },
    emit(n, p) { const l = map.get(n); if (l) for (const fn of l.slice()) fn(p); },
  };
}

/** extra: FarmSystem'den önce/sonra çalışan gözlemci sistemler */
function makeWorld(seed = SEED, { pre, post } = {}) {
  const state = createInitialState(seed);
  if (!state.flags) state.flags = {};
  const bus = makeBus();
  const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(InventorySystem);
  if (pre) reg.register(pre);
  reg.register(FarmSystem);
  if (post) reg.register(post);
  const results = [];
  bus.on('farm:result', (r) => results.push(r));
  const harvests = [];
  bus.on('farm:harvested', (h) => harvests.push({ ...h, day: calendar(state.time.totalMinutes).day }));
  const w = {
    state, bus, reg, results, harvests,
    act(type, tileId, itemId) { bus.emit('farm:action', { type, tileId, itemId }); return results[results.length - 1]; },
    now() { return calendar(state.time.totalMinutes); },
    /** bir sonraki günün belirtilen saatine kadar ilerle */
    nextDayAt(hour) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY) + 1;
      reg.advance(d * MIN_PER_DAY + hour * 60 - state.time.totalMinutes, true);
    },
    toHour(hour) {
      const d = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
      const to = d * MIN_PER_DAY + hour * 60;
      if (to > state.time.totalMinutes) reg.advance(to - state.time.totalMinutes, true);
    },
  };
  return w;
}

const PLOT = [];
for (let y = 8; y <= 11; y++) for (let x = 34; x <= 39; x++) PLOT.push(`${x},${y}`);

const pad = (s, n) => String(s).padEnd(n);
function table(title, cols, rows) {
  console.log(`\n=== ${title} ===`);
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)) + 2);
  console.log(cols.map((c, i) => pad(c, w[i])).join(''));
  console.log(w.map((n) => '-'.repeat(n - 1)).join(' '));
  for (const r of rows) console.log(r.map((v, i) => pad(v, w[i])).join(''));
}
const qdist = (hs) => { const d = { A: 0, B: 0, C: 0 }; for (const h of hs) d[h.quality] += h.qty; return `A${d.A}/B${d.B}/C${d.C}`; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** Bakım: mode 'daily' | 'need' | 'none'; weed/treat bayrakları */
function care(w, tiles, { watering = 'need', weed = true, treat = true } = {}) {
  for (const id of tiles) {
    const t = w.state.tiles[id];
    if (t.crop && t.crop.dead) { w.act('harvest', id); continue; }
    if (t.crop && t.crop.stage >= 4) w.act('harvest', id);
    if (watering === 'daily') w.act('water', id);
    else if (watering === 'need' && t.moisture < 45) w.act('water', id);
    if (weed && t.weeds > 0) w.act('weed', id);
    if (treat && t.crop && !t.crop.dead && (t.crop.pest > 0 || t.crop.disease > 0)) w.act('treat', id, 'organic_spray');
  }
}

// ---------- (a) ideal bakım ----------
function scenarioA(watering) {
  const w = makeWorld();
  add(w.state, 'seed_potato', 30); add(w.state, 'compost', 30); add(w.state, 'organic_spray', 50);
  w.toHour(7);
  for (const id of PLOT) { w.act('fertilize', id, 'compost'); w.act('plant', id, 'seed_potato'); }
  const healths = [];
  for (let d = 0; d < 14 && w.harvests.length < 24; d++) {
    care(w, PLOT, { watering });
    w.toHour(19); if (watering === 'need') care(w, PLOT, { watering });
    for (const id of PLOT) { const c = w.state.tiles[id].crop; if (c) healths.push(c.health); }
    w.nextDayAt(7);
    // hazır olanları sabah 07:00'de değil, hazır olduğu anda say: gün içinde de kontrol
  }
  const days = w.harvests.map((h) => h.day);
  return {
    label: `(a) ${watering === 'daily' ? 'her gün sula' : 'nem<45 ise sula'} + kompost`,
    readyDay: `${Math.min(...days)}–${Math.max(...days)}`,
    yield: w.harvests.reduce((s, h) => s + h.qty, 0),
    q: qdist(w.harvests),
    health: f1(Math.min(...healths)),
    dead: 0,
    w,
  };
}

// Hazır olduğu saati ölçmek için: saatlik takip (a2 ile aynı bakım)
function readyHourProbe() {
  const w = makeWorld();
  add(w.state, 'seed_potato', 30); add(w.state, 'compost', 30); add(w.state, 'organic_spray', 30);
  w.toHour(7);
  const id = PLOT[0];
  w.act('fertilize', id, 'compost'); w.act('plant', id, 'seed_potato');
  const start = w.state.tiles[id].crop.plantedDay;
  while (w.state.tiles[id].crop.stage < 4) {
    const t = w.state.tiles[id];
    if (t.moisture < 45) w.act('water', id);
    if (t.weeds > 0) w.act('weed', id);
    if (t.crop.pest > 0 || t.crop.disease > 0) w.act('treat', id, 'organic_spray');
    w.reg.advance(60, true);
  }
  const n = w.now();
  return `ekim gün ${start} 07:00 → hazır gün ${n.day} ${String(n.hour).padStart(2, '0')}:00`;
}

// ---------- (b) hiç sulamama ----------
function scenarioB() {
  const w = makeWorld();
  add(w.state, 'seed_potato', 30);
  w.toHour(7);
  for (const id of PLOT) w.act('plant', id, 'seed_potato');
  const trace = [];
  for (let d = 0; d < 14; d++) {
    for (const id of PLOT) { const c = w.state.tiles[id].crop; if (c && !c.dead && c.stage >= 4) w.act('harvest', id); }
    const cs = PLOT.map((id) => w.state.tiles[id].crop).filter((c) => c);
    trace.push(`g${w.now().day}:nem ${Math.round(w.state.tiles[PLOT[0]].moisture)} sağ ${Math.round(avg(cs.map((c) => c.health)))}`);
    w.nextDayAt(7);
  }
  const dead = PLOT.filter((id) => w.state.tiles[id].crop?.dead).length;
  return { label: '(b) hiç sulama yok', readyDay: w.harvests.length ? Math.min(...w.harvests.map((h) => h.day)) : '—', yield: w.harvests.reduce((s, h) => s + h.qty, 0), q: qdist(w.harvests), health: '—', dead, trace };
}

// ---------- (c) aynı ürün 3 kez ----------
function scenarioC() {
  const w = makeWorld();
  add(w.state, 'seed_potato', 100); add(w.state, 'organic_spray', 50);
  w.toHour(7);
  const rows = [];
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const id of PLOT) w.act('plant', id, 'seed_potato');
    const startDay = w.now().day;
    const h0 = w.harvests.length;
    const rot = w.state.tiles[PLOT[0]].crop.rot;
    while (w.harvests.length - h0 < 24 && w.now().day < startDay + 15) {
      care(w, PLOT, { watering: 'need' });
      w.reg.advance(60 * 6, true);
    }
    // ölüleri temizle
    for (const id of PLOT) if (w.state.tiles[id].crop?.dead) w.act('harvest', id);
    const hs = w.harvests.slice(h0);
    const t = w.state.tiles[PLOT[0]];
    rows.push([cycle, `×${rot}`, f1(avg(hs.map((h) => h.day)) - startDay), hs.reduce((s, h) => s + h.qty, 0), qdist(hs), `${Math.round(t.n)}/${Math.round(t.p)}/${Math.round(t.k)}`]);
    w.nextDayAt(7);
  }
  return rows;
}

// ---------- (d) mevsim sonu ----------
function scenarioD() {
  const w = makeWorld();
  add(w.state, 'seed_potato', 10); add(w.state, 'seed_wheat', 10); add(w.state, 'seed_lettuce', 10);
  // 25. gün 07:00
  w.reg.advance(24 * MIN_PER_DAY + 7 * 60 - w.state.time.totalMinutes, true);
  const plan = { [PLOT[0]]: 'seed_potato', [PLOT[1]]: 'seed_wheat', [PLOT[2]]: 'seed_lettuce' };
  for (const [id, s] of Object.entries(plan)) { w.act('plow', id); w.act('plant', id, s); }
  const rows = [];
  for (let d = 0; d < 8; d++) {
    for (const id of Object.keys(plan)) if (w.state.tiles[id].moisture < 45) w.act('water', id);
    const n = w.now();
    rows.push([`${n.day} (${n.season})`, ...Object.keys(plan).map((id) => { const c = w.state.tiles[id].crop; return c ? `${c.dead ? 'ÖLÜ' : Math.round(c.health)} g%${Math.round(c.growth * 100)}${c.pest > 0 ? ' z' + c.pest.toFixed(1) : ''}${c.disease > 0 ? ' h' + c.disease.toFixed(1) : ''}` : '—'; })]);
    w.nextDayAt(7);
  }
  w.act('plow', PLOT[3]);
  const summerPlant = w.act('plant', PLOT[3], 'seed_potato');
  return { rows, summerPlant };
}

// ---------- (e) tehdit sıklığı ----------
function scenarioE(managed) {
  const snap = new Map();
  const onset = { weeds: 0, pest: 0, disease: 0 };
  const pre = { id: 'obs-pre', onDay(s) { for (const id of PLOT) { const t = s.tiles[id]; snap.set(id, [t.weeds, t.crop?.pest ?? 0, t.crop?.disease ?? 0]); } } };
  const post = { id: 'obs-post', onDay(s) {
    for (const id of PLOT) {
      const t = s.tiles[id]; const p = snap.get(id); if (!p) continue;
      if (p[0] === 0 && t.weeds > 0) onset.weeds++;
      if (t.crop && !t.crop.dead) { if (p[1] === 0 && t.crop.pest > 0) onset.pest++; if (p[2] === 0 && t.crop.disease > 0) onset.disease++; }
    }
  } };
  const w = makeWorld(SEED, { pre, post });
  add(w.state, 'seed_potato', 200); add(w.state, 'organic_spray', 200);
  w.toHour(7);
  let dead = 0, threatHours = 0;
  for (let d = 0; d < 27; d++) {
    for (const id of PLOT) {
      const t = w.state.tiles[id];
      if (t.crop?.dead) { dead++; w.act('harvest', id); }
      if (t.crop?.stage >= 4) w.act('harvest', id);
      if (!t.crop && t.state === 'plowed') w.act('plant', id, 'seed_potato');
      if (t.moisture < 45) w.act('water', id);
      if (managed) { if (t.weeds > 0) w.act('weed', id); if (t.crop && (t.crop.pest > 0 || t.crop.disease > 0)) w.act('treat', id, 'organic_spray'); }
      if (t.weeds > 0 || (t.crop && (t.crop.pest > 0 || t.crop.disease > 0))) threatHours++;
    }
    w.nextDayAt(7);
  }
  return [managed ? 'bakımlı' : 'bakımsız', onset.weeds, onset.pest, onset.disease, dead, w.harvests.reduce((s, h) => s + h.qty, 0), qdist(w.harvests), threatHours];
}

// ---------- performans ----------
function perf() {
  const w = makeWorld();
  const st = w.state;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 25; x++) {
    const id = `${100 + x},${y}`;
    st.tiles[id] = { tx: 100 + x, ty: y, state: 'plowed', moisture: 60, n: 55, p: 50, k: 50, ph: 6.5, weeds: 0.2, organic: true, history: [], pendingFert: [], idleDays: 0,
      crop: { id: 'potato', plantedDay: 1, growth: 0.1, stage: 0, health: 90, pest: 0.25, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 } };
  }
  FarmSystem.invalidate();
  const ctx = w.reg.ctx;
  FarmSystem.onHour(st, w.bus, ctx);
  const N = 2000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) FarmSystem.onHour(st, w.bus, ctx);
  const t1 = process.hrtime.bigint();
  const d0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) FarmSystem.onDay(st, w.bus, ctx);
  const d1 = process.hrtime.bigint();
  return { tiles: Object.keys(st.tiles).length, hourMs: Number(t1 - t0) / 1e6 / N, dayMs: Number(d1 - d0) / 1e6 / 200 };
}

// ---------- determinizm + kayıt ----------
function determinism() {
  const run = () => { const r = scenarioA('need'); return JSON.stringify(r.w.state); };
  const a = run(), b = run();
  return a === b;
}

function saveRoundTrip() {
  const { w } = scenarioA('need');
  const s = JSON.parse(JSON.stringify(w.state));
  const fixes = [];
  FarmSystem.validate(s, (p) => fixes.push(p));
  InventorySystem.validate(s, (p) => fixes.push(p));
  const bad = JSON.parse(JSON.stringify(w.state));
  bad.tiles['34,8'].moisture = 'x'; bad.tiles['35,8'].crop = { id: 'nope' }; bad.tiles['foo'] = 3;
  bad.tiles['36,8'].state = 'planted'; bad.inventory.items.compost = [{ q: 'Z', qty: 2 }, { q: 'B', qty: 3.5 }];
  bad.inventory.items.unknown = [{ q: 'A', qty: 1, age: 0 }];
  const bf = [];
  FarmSystem.validate(bad, (p) => bf.push(p));
  InventorySystem.validate(bad, (p) => bf.push(p));
  return { cleanFixes: fixes.length, badFixes: bf };
}

// ---------- yeni oyun ----------
function newGame() {
  const w = makeWorld();
  const tiles = Object.values(w.state.tiles);
  const r1 = w.act('plant', '34,8', 'seed_strawberry');
  const r2 = w.act('plant', '33,8', 'seed_potato');
  const r3 = w.act('plant', '10,10', 'seed_potato');
  const r4 = w.act('harvest', '34,8');
  w.act('plant', '34,8', 'seed_potato');
  const r5 = w.act('harvest', '34,8');
  const ms = [];
  w.bus.on('farm:milestone', (m) => ms.push(m.kind));
  return {
    tiles: tiles.length, plowed: tiles.filter((t) => t.state === 'plowed').length,
    inv: `marul ${count(w.state, 'seed_lettuce')}, patates ${count(w.state, 'seed_potato')}, kompost ${count(w.state, 'compost')}`,
    reasons: [r1, r2, r3, r4, r5].map((r) => r.reason ?? 'ok'),
    info: tileInfo(w.state, '34,8', w.now()),
    canWet: canApply(w.state, { type: 'water', tileId: '34,8' }),
  };
}

// ================= ÇIKTI =================
console.log(`sim-farm — tohum ${SEED}`);
const ng = newGame();
console.log(`\nYeni oyun: ${ng.tiles} karo, ${ng.plowed} sürülmüş; envanter: ${ng.inv}`);
console.log('Ret mesajları:', ng.reasons.join(' | '));
console.log('tileInfo(34,8):', JSON.stringify({ crop: ng.info.crop && { name: ng.info.crop.name, readyIn: ng.info.crop.readyIn, q: ng.info.crop.qualityEstimate }, warnings: ng.info.warnings }));

const a1 = scenarioA('daily');
const a2 = scenarioA('need');
const b = scenarioB();
table('Patates, 24 karo (a, b)', ['senaryo', 'hasat günü', 'verim', 'kalite (adet)', 'min sağlık', 'ölü'],
  [a1, a2, b].map((r) => [r.label, r.readyDay, r.yield, r.q, r.health, r.dead]));
console.log('Hazır olma (tek karo, nem<45 sulama):', readyHourProbe());
console.log('(b) iz:', b.trace.slice(0, 9).join(' · '));

table('(c) Aynı karoda patates ×3 (gübresiz, nem<45 sulama)', ['döngü', 'rotasyon', 'ort. süre (gün)', 'verim', 'kalite', 'N/P/K sonra'], scenarioC());

const d = scenarioD();
table('(d) 25. günde ekim → mevsim geçişi (sağlık, büyüme%)', ['gün', 'patates', 'buğday (frostHardy)', 'marul'], d.rows);
console.log('Yazın patates ekme:', d.summerPlant.reason);

table('(e) 27 gün, 24 karo, sürekli patates — tehdit başlangıçları', ['bakım', 'ot', 'zararlı', 'hastalık', 'ölü', 'verim', 'kalite', 'tehditli karo-gün'], [scenarioE(false), scenarioE(true)]);

const p = perf();
console.log(`\nPerformans: ${p.tiles} karo — onHour ${p.hourMs.toFixed(3)} ms, onDay ${p.dayMs.toFixed(3)} ms`);
console.log(`Determinizm (aynı tohum iki koşu, state JSON eşit): ${determinism() ? 'EVET' : 'HAYIR'}`);
const sr = saveRoundTrip();
console.log(`Kayıt gidiş-dönüş: temiz kayıtta onarım ${sr.cleanFixes}; bozuk kayıtta onarılan: ${sr.badFixes.join(', ')}`);
console.log(`\nNot: SOIL.waterAmount=${SOIL.waterAmount}, ilkbahar kaybı ${SOIL.moistureLossPerHour.spring}/saat (${(SOIL.moistureLossPerHour.spring * 24).toFixed(1)}/gün), patates bandı ${CROPS.potato.water}.`);
