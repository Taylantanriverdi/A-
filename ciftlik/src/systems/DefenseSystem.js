// DefenseSystem — Gece İstilası modu (PLAN §16, K29). Phaser import ETMEZ. Mod kapalıyken (settings.raids !== true) hiçbir şey yapmaz.
// Komutlar: defense:repair {placedId}, defense:repairHouse {}, soldier:hire {type}, soldier:fire {id}. Sonuç: defense:result / soldier:result {ok, type, reason?, cost?} + toast.
// Olaylar: raid:warning {bloodMoon,day}, raid:start {day,bloodMoon,total}, raid:wave {wave,total}, raid:end {day,kills,reason}, raid:report {...},
//   monster:spawned {id,type,x,y}, monster:killed {x,y,reward}, monster:left {id,x,y}, defense:changed {ids}, soldiers:changed {ids}, defense:hit {x,y,kind,from?}.
import { RAID_SCHEDULE, WAVES, MONSTERS, SOLDIERS, MAX_SOLDIERS, SOLDIER_NAMES, DAMAGE } from '../data/defense.js';
import { PLACEABLES } from '../data/placeables.js';
import { MIN_PER_DAY } from '../core/constants.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import * as occ from './world/occupancy.js';
import { decide, waveSize, spawnWave, isBloodMoon } from './defense/raid.js';
import { stepMonsters } from './defense/monsters.js';
import { initHp, repairCost, applyRepair, houseRepairCost, towersFire } from './defense/combat.js';
import { stepSoldiers, placeAtHome } from './defense/soldiers.js';
import { sync as syncGrid } from './defense/monsterGrid.js';

let offs = [];
let ctxRef = null;
const on = (state) => state.settings && state.settings.raids === true;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const toast = (bus, text, kind = 'info') => bus.emit('toast', { text, kind });

function ensureHp(state, bus) {
  let ch = false;
  for (const p of state.placed) if (initHp(p)) ch = true;
  state.defense.hpInit = true;
  if (ch && bus) bus.emit('defense:changed', { ids: [] });
}

// ------------------------------------------------------------------ komutlar
function repair(state, bus, { placedId } = {}) {
  const res = (r) => { bus.emit('defense:result', { type: 'repair', placedId, ...r }); if (!r.ok) toast(bus, r.reason, 'bad'); else toast(bus, r.text, 'good'); return r; };
  if (!on(state)) return res({ ok: false, reason: 'Gece İstilası modu kapalı.' });
  const p = state.placed.find((q) => q.id === placedId);
  if (!p) return res({ ok: false, reason: 'Yapı bulunamadı.' });
  initHp(p);
  const cost = repairCost(state, p);
  if (cost <= 0) return res({ ok: false, reason: 'Onarım gerekmiyor.' });
  const name = PLACEABLES[p.type]?.name || p.type;
  if (!transact(state, bus, { amount: -cost, category: 'repairs', label: `Onarım: ${name}` })) return res({ ok: false, reason: 'Yeterli paran yok', cost });
  applyRepair(state, p);
  bus.emit('defense:changed', { ids: [p.id] });
  return res({ ok: true, cost, text: `${name} onarıldı.` });
}

function repairHouse(state, bus) {
  const D = state.defense;
  const res = (r) => { bus.emit('defense:result', { type: 'repairHouse', ...r }); toast(bus, r.ok ? r.text : r.reason, r.ok ? 'good' : 'bad'); return r; };
  if (!on(state)) return res({ ok: false, reason: 'Gece İstilası modu kapalı.' });
  const cost = houseRepairCost(D);
  if (cost <= 0) return res({ ok: false, reason: 'Ev sağlam.' });
  if (!transact(state, bus, { amount: -cost, category: 'repairs', label: 'Onarım: Çiftlik evi' })) return res({ ok: false, reason: 'Yeterli paran yok', cost });
  D.houseHp = D.houseMax;
  bus.emit('defense:changed', { ids: ['house'] });
  return res({ ok: true, cost, text: 'Çiftlik evi onarıldı.' });
}

function hire(state, bus, { type } = {}) {
  const D = state.defense, def = SOLDIERS[type];
  const res = (r) => { bus.emit('soldier:result', { type: 'hire', ...r }); toast(bus, r.ok ? r.text : r.reason, r.ok ? 'good' : 'bad'); return r; };
  if (!on(state)) return res({ ok: false, reason: 'Gece İstilası modu kapalı.' });
  if (!def) return res({ ok: false, reason: 'Geçersiz asker türü.' });
  if (D.soldiers.length >= MAX_SOLDIERS) return res({ ok: false, reason: `En fazla ${MAX_SOLDIERS} asker tutulabilir.` });
  if (!transact(state, bus, { amount: -def.hireCost, category: 'soldiers', label: `Asker kiralama: ${def.title}` })) return res({ ok: false, reason: 'Yeterli paran yok' });
  const used = new Set(D.soldiers.map((s) => s.name));
  const pool = SOLDIER_NAMES.filter((n) => !used.has(n));
  const name = ctxRef.rng.pick(pool.length ? pool : SOLDIER_NAMES);
  state.flags.soldierSeq = (Number(state.flags.soldierSeq) || 0) + 1;
  const s = { id: `s${state.flags.soldierSeq}`, type, name, hp: def.hp, maxHp: def.hp, x: 0, y: 0, state: 'sleep', towerId: null, duty: true, wu: 0, wv: 0 };
  D.soldiers.push(s);
  placeAtHome(s, D.soldiers.length - 1);
  bus.emit('soldiers:changed', { ids: [s.id] });
  return res({ ok: true, soldierId: s.id, text: `${name} (${def.title}) göreve başladı.` });
}

function fire(state, bus, { id } = {}) {
  const D = state.defense;
  const i = D.soldiers.findIndex((s) => s.id === id);
  const res = (r) => { bus.emit('soldier:result', { type: 'fire', soldierId: id, ...r }); return r; };
  if (i < 0) return res({ ok: false, reason: 'Asker bulunamadı.' });
  const [s] = D.soldiers.splice(i, 1);
  D.soldiers.forEach((q, k) => { if (q.state === 'sleep') placeAtHome(q, k); });
  bus.emit('soldiers:changed', { ids: [id], removed: true });
  toast(bus, `${s.name} görevden alındı.`);
  return res({ ok: true });
}

// ------------------------------------------------------------------ baskın akışı
function startRaid(state, bus, ctx) {
  const D = state.defense, day = ctx.now.day;
  D.nightPlanned = false; D.active = true; D.wave = 0; D.wavesLeft = WAVES.perNight;
  D.waveSize = waveSize(day, D.bloodMoon);
  D.pending = D.wavesLeft * D.waveSize;
  D.nextWaveMin = state.time.totalMinutes;
  D.endAt = (Math.floor(state.time.totalMinutes / MIN_PER_DAY) + 1) * MIN_PER_DAY + RAID_SCHEDULE.endMin;
  D.nightKills = 0; D.nightLoot = 0; D.houseHpStart = D.houseHp; D.trampled.length = 0; D.nightDamaged.length = 0;
  bus.emit('raid:start', { day, bloodMoon: D.bloodMoon, total: D.pending });
}

function nextWave(state, bus, ctx) {
  const D = state.defense;
  D.wave++; D.wavesLeft--;
  spawnWave(state, bus, ctx, ctx.now.day);
  D.pending = D.wavesLeft * D.waveSize;
  D.nextWaveMin = D.wavesLeft > 0 ? state.time.totalMinutes + WAVES.gapMinutes : null;
  bus.emit('raid:wave', { wave: D.wave, total: WAVES.perNight });
}

function endRaid(state, bus, ctx, reason) {
  const D = state.defense;
  for (const m of D.monsters) bus.emit('monster:left', { id: m.id, x: m.x, y: m.y });
  D.monsters.length = 0;
  D.active = false; D.pending = 0; D.wavesLeft = 0; D.nextWaveMin = null; D.reportPending = true;
  D.stats.nights++;
  bus.emit('raid:end', { day: ctx.now.day, kills: D.nightKills, reason });
  bus.emit('defense:changed', { ids: [] });
}

function report(state, bus, ctx) {
  const D = state.defense;
  let penalty = 0;
  if (D.houseHp <= 0) {
    const money = Math.max(0, Math.floor(Number(state.finance.money) || 0));
    penalty = Math.min(DAMAGE.houseDownPenaltyMax ?? Infinity, Math.floor(money * DAMAGE.houseDownPenaltyPct));
    if (penalty > 0) transact(state, bus, { amount: -penalty, category: 'penalty', label: 'Yağma: çiftlik evi düştü' });
  }
  const damaged = [];
  for (const id of D.nightDamaged) { const p = state.placed.find((q) => q.id === id); if (p) damaged.push({ placedId: id, type: p.type, ruined: p.ruined === true }); }
  D.lastReport = { day: ctx.now.day, kills: D.nightKills, loot: D.nightLoot, damaged, houseDamage: Math.max(0, Math.round(D.houseHpStart - D.houseHp)), penalty, trampled: D.trampled.length, bloodMoon: D.bloodMoon };
  D.reportPending = false; D.bloodMoon = false;
  bus.emit('raid:report', D.lastReport);
}

function payWages(state, bus) {
  const D = state.defense;
  let ch = false;
  for (const s of D.soldiers) {
    const def = SOLDIERS[s.type];
    const paid = transact(state, bus, { amount: -def.wagePerDay, category: 'soldiers', label: `Maaş: ${s.name}` });
    if (s.duty !== paid) ch = true;
    s.duty = paid;
    if (!paid) toast(bus, `${s.name}'in maaşı ödenemedi; bu gece nöbet tutmayacak.`, 'bad');
  }
  if (ch || D.soldiers.length) bus.emit('soldiers:changed', { ids: [] });
}

function morning(state, bus, ctx) {
  const D = state.defense;
  for (let i = 0; i < D.soldiers.length; i++) {
    const s = D.soldiers[i];
    if (s.state === 'down' || s.hp < s.maxHp) { s.hp = s.maxHp; if (s.state === 'down') { s.state = 'sleep'; placeAtHome(s, i); } }
  }
  if (D.reportPending) report(state, bus, ctx);
  D.nightPlanned = false;
  bus.emit('soldiers:changed', { ids: [] });
}

function sweep(state, bus, ctx) {
  const D = state.defense, ms = D.monsters;
  let n = 0;
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.hp > 0) continue;
    const def = MONSTERS[m.type];
    const reward = def ? ctx.rng.int(def.reward[0], def.reward[1]) : 0;
    if (reward > 0) transact(state, bus, { amount: reward, category: 'loot', label: `Ganimet: ${def.name}` });
    D.nightKills++; D.nightLoot += reward; D.stats.kills++; D.stats.lootTotal += reward;
    bus.emit('monster:killed', { x: m.x, y: m.y, reward, id: m.id, type: m.type });
    ms[i] = ms[ms.length - 1]; ms.pop();
    n++;
  }
  if (n > 1) ms.sort((a, b) => (a.id < b.id ? -1 : 1)); // sıra deterministik kalsın (nadir yol)
}

// ------------------------------------------------------------------ döngü
function tickMinute(state, bus, ctx) {
  if (!on(state)) return;
  const D = state.defense, t = state.time.totalMinutes, mod = t % MIN_PER_DAY;
  if (D.active) {
    if (D.wavesLeft > 0 && D.nextWaveMin !== null && t >= D.nextWaveMin) nextWave(state, bus, ctx);
    if (D.monsters.length) {
      const fl = stepMonsters(state, bus);
      towersFire(state, bus);
      if (fl) bus.emit('defense:changed', { ids: D.nightDamaged });
    }
  }
  if (D.soldiers.length) {
    const sc = stepSoldiers(state, bus, ctx, mod);
    if (sc) bus.emit('soldiers:changed', { ids: [] });
  }
  if (D.active) {
    if (D.monsters.length) sweep(state, bus, ctx);
    if (D.wavesLeft === 0 && D.monsters.length === 0) endRaid(state, bus, ctx, 'cleared');
    else if (t >= D.endAt) endRaid(state, bus, ctx, 'dawn');
  }
}

function onHour(state, bus, ctx) {
  if (!on(state)) return;
  const D = state.defense, h = ctx.now.hour;
  if (!D.hpInit) ensureHp(state, bus);
  if (h === RAID_SCHEDULE.warnHour) {
    const d = decide(ctx.now.day, ctx.rng);
    if (d) { D.nightPlanned = true; D.bloodMoon = d.bloodMoon; bus.emit('raid:warning', { bloodMoon: d.bloodMoon, day: ctx.now.day }); }
  } else if (h === 20) payWages(state, bus);
  else if (h === RAID_SCHEDULE.startHour && D.nightPlanned) { startRaid(state, bus, ctx); nextWave(state, bus, ctx); }
  else if (h === 6) morning(state, bus, ctx);
}

/** Debug: bu geceye baskın kurar (uyarı yayar); askerler maaşsız nöbette sayılır. */
function forceRaid(state, bus, bloodMoon = false) {
  const D = state.defense;
  D.nightPlanned = true; D.bloodMoon = !!bloodMoon;
  for (const s of D.soldiers) s.duty = true;
  const day = Math.floor(state.time.totalMinutes / MIN_PER_DAY) + 1;
  bus.emit('raid:warning', { bloodMoon: D.bloodMoon, day });
}

function validate(state, onFix = () => {}) {
  const dflt = { nightPlanned: false, bloodMoon: false, active: false, reportPending: false, hpInit: false };
  if (typeof state.settings.raids !== 'boolean') { onFix('settings.raids'); state.settings.raids = false; }
  if (!isPlainObject(state.defense)) { onFix('defense'); state.defense = {}; }
  const D = state.defense;
  for (const k of Object.keys(dflt)) if (typeof D[k] !== 'boolean') D[k] = dflt[k];
  for (const k of ['wave', 'wavesLeft', 'waveSize', 'pending', 'endAt', 'nightKills', 'nightLoot', 'monsterSeq']) D[k] = num(D[k], 0);
  D.houseMax = num(D.houseMax, DAMAGE.houseHp); if (D.houseMax <= 0) D.houseMax = DAMAGE.houseHp;
  D.houseHp = Math.max(0, Math.min(D.houseMax, num(D.houseHp, D.houseMax)));
  D.houseHpStart = num(D.houseHpStart, D.houseHp);
  if (!(D.nextWaveMin === null || Number.isFinite(D.nextWaveMin))) D.nextWaveMin = null;
  for (const k of ['monsters', 'soldiers', 'trampled', 'nightDamaged']) if (!Array.isArray(D[k])) D[k] = [];
  if (!isPlainObject(D.stats)) D.stats = {};
  for (const k of ['nights', 'kills', 'lootTotal']) D.stats[k] = num(D.stats[k], 0);
  if (D.lastReport !== null && !isPlainObject(D.lastReport)) D.lastReport = null;
  D.monsters = D.monsters.filter((m) => isPlainObject(m) && MONSTERS[m.type] && Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.hp) && typeof m.id === 'string');
  for (const m of D.monsters) { m.path = null; m.pi = 0; m.tg = -1; m.reach = 1; m.wait = 0; m.fl = 0; m.targetId = null; m.state = 'walk'; m.maxHp = num(m.maxHp, MONSTERS[m.type].hp); }
  D.soldiers = D.soldiers.filter((s) => isPlainObject(s) && SOLDIERS[s.type] && typeof s.id === 'string').slice(0, MAX_SOLDIERS);
  D.soldiers.forEach((s, i) => {
    const def = SOLDIERS[s.type];
    s.maxHp = def.hp; s.hp = Math.max(0, Math.min(def.hp, num(s.hp, def.hp)));
    if (!['sleep', 'patrol', 'fight', 'down'].includes(s.state)) s.state = 'sleep';
    if (typeof s.duty !== 'boolean') s.duty = true;
    if (typeof s.name !== 'string') s.name = SOLDIER_NAMES[i % SOLDIER_NAMES.length];
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) placeAtHome(s, i);
    s.wu = num(s.wu, 0); s.wv = num(s.wv, 0);
    if (typeof s.towerId !== 'string') s.towerId = null;
  });
  if (state.settings.raids === true) for (const p of state.placed || []) initHp(p);
  return state;
}

const DefenseSystem = {
  id: 'defense',
  validate, tickMinute, onHour, forceRaid,
  repairCost, houseRepairCost, isBloodMoon,
  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    ctxRef = registry.ctx;
    validate(state, () => {});
    syncGrid(state);
    offs.push(bus.on('defense:repair', (p) => repair(state, bus, p)));
    offs.push(bus.on('defense:repairHouse', () => repairHouse(state, bus)));
    offs.push(bus.on('soldier:hire', (p) => hire(state, bus, p)));
    offs.push(bus.on('soldier:fire', (p) => fire(state, bus, p)));
    offs.push(bus.on('placed:changed', () => { if (on(state)) ensureHp(state, bus); }));
    offs.push(bus.on('defense:mode', ({ on: v }) => {
      const D = state.defense;
      if (v) ensureHp(state, bus);
      else { D.monsters.length = 0; D.active = false; D.nightPlanned = false; D.pending = 0; D.wavesLeft = 0; D.nextWaveMin = null; }
      bus.emit('defense:changed', { ids: [] });
      bus.emit('soldiers:changed', { ids: [] });
    }));
  },
};
export default DefenseSystem;
export { repairCost, houseRepairCost };
