// WorkerSystem — çiftlik çalışanları (PLAN.md §11). Phaser import ETMEZ.
// Komutlar: worker:hire {candidateId | type:'apprentice'}, worker:fire {workerId}, worker:set {workerId, name?, tasks?, order?, enabled?}.
// Aşama 8: iş ilanı panosu state.hiring = {candidates, refreshedDay}; çalışan başına type/skills/wage/look; plow/plant görevleri (farm:mark işaretleri);
// makine yeteneği >= 3 ve garajda boş traktör varsa 3x3 iş için traktör (vehicle:run, yakıt 'fuel').
// Olaylar: workers:changed, worker:result {ok, type, workerId?, reason?}, worker:state {workerId, mode, x, y, onDonkey, kind},
//          worker:did {workerId, kind, ok, target}, toast. Eylemler gerçek komutlarla: farm:action, animal:action, machine:collect, machine:queue.
// State: state.workers[] ve state.donkey (x,y dünya px; tickMinute her oyun dakikasında yazar, prevX/prevY önceki dakika → görsel lerp).
// Para yalnızca EconomySystem.transact (kategori 'wages').
import { WORKER_TYPES, DONKEY, WORKER_HOME, MAX_WORKERS, WORKER_NAMES, HIRING } from '../data/workers.js';
import { VEHICLES } from '../data/placeables.js';
import { PLACEABLES } from '../data/placeables.js';
import { TILE_W as TW, TILE_H as TH, MIN_PER_DAY } from '../core/constants.js';
import { isPlainObject } from '../core/GameState.js';
import { calendar } from '../core/timeUtils.js';
import { transact } from './EconomySystem.js';
import { count } from './InventorySystem.js';
import { createRng } from '../core/Rng.js';
import { findPath, cellOf, GW, bindState } from './workers/pathfinding.js';
import { pickTask, TASK_KINDS, ACTION_KEY, statusText, actionMinutes, jobOk, standCell } from './workers/tasks.js';

// Opsiyonel: VehicleSystem.chargeFuel(state, bus, vehicleType, tiles) (gameplay-dev). Node'da / dosya yoksa geçici transact.
let VEHICLE_MOD = null;
try { VEHICLE_MOD = Object.values(import.meta.glob('./VehicleSystem.js', { eager: true }))[0] || null; } catch (_) { VEHICLE_MOD = null; }
const VEHICLE_SPEED_MULT = 2;     // araçla yürüyüş hızı çarpanı
const VEHICLE_MIN_TILES = 3;      // 3x3 bölgede en az bu kadar uygun karo varsa araç alınır
const VEHICLE_MIN_SKILL = 3;      // makine yeteneği eşiği
const vehTaken = new Map();       // vehicleId → workerId

export { statusText };
export const REASONS = {
  badType: 'Bilinmeyen çalışan türü.',
  locked: (lv) => `Seviye ${lv} gerekir.`,
  already: 'Bu çalışan zaten işe alındı.',
  noMoney: 'Yeterli paran yok.',
  noWorker: 'Çalışan bulunamadı.',
  noCand: 'Bu aday artık ilanda yok.',
  full: (n) => `En fazla ${n} çalışan çalıştırabilirsin.`,
  needBoard: 'İş ilanı panosundan bir aday seç.',
};
const MODES = ['idle', 'walk', 'ride', 'work', 'home'];
const BAN_MIN = 120;          // başarısız hedef bu kadar dakika yeniden seçilmez
const DECIDE_EVERY = 5;       // boştayken karar aralığı (oyun dakikası)
const NAME_MAX = 16;

const HOME_X = (WORKER_HOME.tx + 0.5) * TW, HOME_Y = (WORKER_HOME.ty + 0.5) * TH;
// Eşek evi konumu state.placed'teki 'shed'den okunur (PLAN §12); yoksa DONKEY.homeTile.
let SHED_X = (DONKEY.homeTile.tx + 0.5) * TW, SHED_Y = (DONKEY.homeTile.ty + 0.5) * TH;
const HOME_CELL = cellOf(WORKER_HOME.tx, WORKER_HOME.ty);
let SHED_CELL = cellOf(DONKEY.homeTile.tx, DONKEY.homeTile.ty);
function refreshShed(state) {
  const sh = Array.isArray(state.placed) ? state.placed.find((p) => p.type === 'shed') : null;
  const tx = sh ? sh.tx + PLACEABLES.shed.w - 1 : DONKEY.homeTile.tx;
  const ty = sh ? sh.ty + PLACEABLES.shed.h - 1 : DONKEY.homeTile.ty;
  SHED_X = (tx + 0.5) * TW; SHED_Y = (ty + 0.5) * TH; SHED_CELL = cellOf(tx, ty);
}

let busRef = null;
let regRef = null;
let offs = [];
let lastResult = null;
const rts = new Map();   // workerId → çalışma zamanı (yol, faz) — kayda yazılmaz
const taken = {};        // kind → Set(target)
const bans = {};         // kind → Map(target → bitiş dakikası)
const env = {
  now: 0,
  isTaken(kind, target) {
    const s = taken[kind];
    if (s && s.has(target)) return true;
    const b = bans[kind] && bans[kind].get(target);
    return b !== undefined && b > env.now;
  },
};
const KINDS = ['water', 'harvest', 'feed', 'waterAnimals', 'collect', 'machineCollect', 'machineLoad', 'plow', 'plant'];
function resetRuntime() {
  rts.clear(); vehTaken.clear();
  for (const k of KINDS) { taken[k] = new Set(); bans[k] = new Map(); }
}
resetRuntime();

const hourOf = (state) => calendar(state.time.totalMinutes).hour;
const modDay = (mins) => ((mins % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;

function rtOf(w) {
  let rt = rts.get(w.id);
  if (!rt) {
    rt = { phase: 'idle', path: null, plen: 0, pi: 0, nextDecide: 0, cur: null };
    rts.set(w.id, rt);
  }
  return rt;
}

// ---------------------------------------------------------------- yardımcılar
function emitState(w) {
  if (busRef) busRef.emit('worker:state', { workerId: w.id, mode: w.mode, x: w.x, y: w.y, onDonkey: w.onDonkey, kind: w.task ? w.task.kind : null, vehicle: w.vehicle || null });
}
function setMode(w, mode) {
  if (w.mode === mode) return;
  w.mode = mode;
  emitState(w);
}
const distTo = (w, x, y) => { const dx = w.x / TW - x / TW, dy = w.y / TH - y / TH; return Math.sqrt(dx * dx + dy * dy); };
const atHome = (w) => distTo(w, HOME_X, HOME_Y) < 0.75;

function mount(state, w) {
  w.onDonkey = true;
  state.donkey.mode = 'carrying';
  state.donkey.x = w.x; state.donkey.y = w.y;
  emitState(w);
}
function dismount(state, w) {
  w.onDonkey = false;
  state.donkey.mode = 'home';
  state.donkey.x = w.x + 0.3 * TW; state.donkey.y = w.y; // eşek yanında bekler
  emitState(w);
}
function release(rt) {
  const c = rt.cur;
  if (c) {
    taken[c.kind].delete(c.target);
    if (c.tiles) for (const id of c.tiles) taken[c.kind].delete(id);
    rt.cur = null;
  }
}
function releaseVehicle(w) {
  for (const [vid, wid] of vehTaken) if (wid === w.id) vehTaken.delete(vid);
  w.vehicle = null;
}
const speedOf = (w, def) => (w.vehicle ? def.walkTilesPerMin * VEHICLE_SPEED_MULT : w.onDonkey ? def.donkeyTilesPerMin : def.walkTilesPerMin);

/** Traktörle 3x3 iş planı: {vehicle, vtype, garageCell, tiles, cx, cy} ya da null. */
function planVehicle(state, w, c) {
  if (!(w.skills && w.skills.machine >= VEHICLE_MIN_SKILL) || !Array.isArray(state.vehicles)) return null;
  const vd = VEHICLES.tractor;
  const veh = state.vehicles.find((v) => v.type === 'tractor' && !vehTaken.has(v.id));
  if (!veh || !vd) return null;
  const garageCell = standCell(state, veh.garageId);
  if (garageCell < 0) return null;
  const t0 = state.tiles[c.target];
  let best = null;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const list = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const id = `${t0.tx + ox + dx},${t0.ty + oy + dy}`;
      if (state.tiles[id] && jobOk(state, id, c.kind, env, c.itemId)) list.push(id);
    }
    if (list.includes(c.target) && (!best || list.length > best.tiles.length)) best = { tiles: list, cx: t0.tx + ox, cy: t0.ty + oy };
  }
  if (!best || best.tiles.length < VEHICLE_MIN_TILES) return null;
  if (c.kind === 'plant') best.tiles.length = Math.min(best.tiles.length, count(state, c.itemId));
  if (state.finance.money < best.tiles.length * vd.fuelPerTile) return null;
  return { vehicle: veh.id, vtype: 'tractor', garageCell, ...best };
}
function payFuel(state, bus, vtype, tiles) {
  if (VEHICLE_MOD && typeof VEHICLE_MOD.chargeFuel === 'function') return VEHICLE_MOD.chargeFuel(state, bus, vtype, tiles) !== false;
  return transact(state, bus, { amount: -tiles.length * VEHICLES[vtype].fuelPerTile, category: 'fuel', label: 'Yakıt' });
}
function ban(kind, target, until) { bans[kind].set(target, until); }

/** Mevcut konumdan hedef hücreye yol kur. Başarısızsa false. */
function setPath(w, rt, goalCell) {
  const path = findPath(cellOf(w.x / TW, w.y / TH), goalCell);
  if (!path) return false;
  rt.path = path; rt.plen = path.length; rt.pi = path.length > 1 ? 1 : 0;
  return true;
}

/** Yolda bir dakikalık ilerleme (tile/dk hız). Vardıysa true. Bellek ayırmaz. */
function moveAlong(state, w, rt, speed) {
  let fx = w.x / TW, fy = w.y / TH;
  let budget = speed;
  const path = rt.path;
  while (budget > 1e-9 && rt.pi < rt.plen) {
    const c = path[rt.pi];
    const tx = (c % GW) + 0.5, ty = ((c / GW) | 0) + 0.5;
    const dx = tx - fx, dy = ty - fy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) { fx = tx; fy = ty; budget -= d; rt.pi++; } else { fx += (dx / d) * budget; fy += (dy / d) * budget; budget = 0; }
  }
  w.x = Math.round(fx * TW * 100) / 100; w.y = Math.round(fy * TH * 100) / 100;
  if (w.onDonkey) { state.donkey.x = w.x; state.donkey.y = w.y; }
  return rt.pi >= rt.plen;
}

// ---------------------------------------------------------------- görev akışı
/**
 * Görev için yolculuk başlat (yürü / eşek). task.phase ve mod ayarlanır. Başarısızsa false.
 */
function startTravel(state, w, rt, goalCell, def) {
  const gx = (goalCell % GW) + 0.5, gy = ((goalCell / GW) | 0) + 0.5;
  const fx = w.x / TW, fy = w.y / TH;
  const dist = Math.sqrt((gx - fx) ** 2 + (gy - fy) ** 2);
  if (w.onDonkey && dist <= def.donkeyAbove) dismount(state, w);
  if (w.onDonkey) {
    if (!setPath(w, rt, goalCell)) return false;
    rt.phase = 'move'; setMode(w, 'ride');
  } else if (dist > def.donkeyAbove) {
    if (distTo(w, state.donkey.x, state.donkey.y) < 0.8) {
      mount(state, w);
      if (!setPath(w, rt, goalCell)) return false;
      rt.phase = 'move'; setMode(w, 'ride');
    } else {
      if (!setPath(w, rt, cellOf(state.donkey.x / TW, state.donkey.y / TH))) return false;
      rt.phase = 'toDonkey'; setMode(w, 'walk');
    }
  } else {
    if (!setPath(w, rt, goalCell)) return false;
    rt.phase = 'move'; setMode(w, 'walk');
  }
  if (w.task) w.task.phase = rt.phase;
  return true;
}

function decide(state, w, rt, def, mins) {
  const px = w.x / TW, py = w.y / TH;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = pickTask(state, w, px, py, env);
    if (!c) return false;
    const goal = cellOf(c.cx, c.cy);
    const task = { kind: c.kind, target: c.target, itemId: c.itemId, recipe: c.recipe };
    const vp = (c.kind === 'plow' || c.kind === 'plant') ? planVehicle(state, w, c) : null;
    if (vp) {
      w.task = { kind: c.kind, target: c.target, endMin: 0, phase: 'toGarage', place: 'tarlaya', subject: '' };
      if (setPath(w, rt, vp.garageCell)) {
        task.tiles = vp.tiles; task.vehicle = vp.vehicle; task.vtype = vp.vtype;
        rt.cur = task; rt.goal = cellOf(vp.cx, vp.cy); rt.garage = vp.garageCell; rt.phase = 'toGarage';
        vehTaken.set(vp.vehicle, w.id);
        for (const id of vp.tiles) taken[task.kind].add(id);
        taken[task.kind].add(task.target);
        setMode(w, 'walk');
        return true;
      }
      w.task = null; ban(c.kind, c.target, mins + BAN_MIN);
      continue;
    }
    w.task = { kind: c.kind, target: c.target, endMin: 0, phase: '', place: c.place, subject: c.subject };
    if (startTravel(state, w, rt, goal, def)) {
      rt.cur = task; rt.goal = goal;
      taken[task.kind].add(task.target);
      return true;
    }
    w.task = null;
    ban(c.kind, c.target, mins + BAN_MIN);
  }
  return false;
}

function abortTask(w, rt) {
  release(rt);
  w.task = null;
  rt.phase = 'idle';
  if (w.vehicle) startRetVehicle(w, rt);
  else releaseVehicle(w);
}
function startRetVehicle(w, rt) {
  if (rt.garage != null && setPath(w, rt, rt.garage)) { rt.phase = 'retVehicle'; setMode(w, 'walk'); } else { releaseVehicle(w); rt.phase = 'idle'; emitState(w); }
}

function startReturn(state, w, rt, def) {
  if (w.onDonkey) {
    if (distTo(w, SHED_X, SHED_Y) < 1.2) { dismount(state, w); retWalk(w, rt); return; }
    if (setPath(w, rt, SHED_CELL)) { rt.phase = 'retRide'; setMode(w, 'ride'); return; }
    dismount(state, w);
  } else if (distTo(w, HOME_X, HOME_Y) > def.donkeyAbove && distTo(w, state.donkey.x, state.donkey.y) < 0.8) {
    mount(state, w);
    if (setPath(w, rt, SHED_CELL)) { rt.phase = 'retRide'; setMode(w, 'ride'); return; }
    dismount(state, w);
  }
  retWalk(w, rt);
}
function retWalk(w, rt) {
  if (setPath(w, rt, HOME_CELL)) { rt.phase = 'retWalk'; setMode(w, 'walk'); } else { rt.phase = 'idle'; setMode(w, 'idle'); }
}

function tileJobDo(state, bus, kind, id, itemId) {
  lastResult = null;
  bus.emit('farm:action', { type: kind, tileId: id, itemId });
  const ok = !!(lastResult && lastResult.ok);
  const t = state.tiles[id];
  if (ok && t && t.mark && t.mark.plan === kind) delete t.mark;
  return ok;
}
function execute(state, bus, task, def) {
  lastResult = null;
  const bonus = def && def.qualityBonus > 0 ? { bonusCare: def.qualityBonus } : null;
  if (task.tiles) {
    let n = 0;
    for (const id of task.tiles) if (tileJobDo(state, bus, task.kind, id, task.kind === 'plant' ? (state.tiles[id].mark?.itemId || task.itemId) : undefined)) n++;
    lastResult = { ok: n > 0 };
    return n > 0;
  }
  switch (task.kind) {
    case 'plow': case 'plant': return tileJobDo(state, bus, task.kind, task.target, task.itemId || undefined);
    case 'water': bus.emit('farm:action', { type: 'water', tileId: task.target, ...bonus }); break;
    case 'harvest': bus.emit('farm:action', { type: 'harvest', tileId: task.target, ...bonus }); break;
    case 'feed': bus.emit('animal:action', { type: 'feed', buildingId: task.target, itemId: task.itemId }); break;
    case 'waterAnimals': bus.emit('animal:action', { type: 'water', buildingId: task.target }); break;
    case 'collect': bus.emit('animal:action', { type: 'collect', buildingId: task.target }); break;
    case 'machineCollect': bus.emit('machine:collect', { machineId: task.target }); break;
    case 'machineLoad': bus.emit('machine:queue', { machineId: task.target, recipe: task.recipe }); break;
    default: break;
  }
  return !!(lastResult && lastResult.ok);
}

function finish(state, bus, w, rt, mins, def) {
  const task = rt.cur;
  const ok = task ? execute(state, bus, task, def) : false;
  if (task) {
    if (!ok) { ban(task.kind, task.target, mins + BAN_MIN); if (task.tiles) for (const id of task.tiles) ban(task.kind, id, mins + BAN_MIN); }
    bus.emit('worker:did', { workerId: w.id, kind: task.kind, ok, target: task.target });
  }
  release(rt);
  w.task = null;
  rt.phase = 'idle';
  rt.nextDecide = mins;
  setMode(w, 'idle');
}

function tickWorker(state, bus, w, mins, mod) {
  const def = WORKER_TYPES[w.type];
  if (!def) return;
  const rt = rtOf(w);
  w.prevX = w.x; w.prevY = w.y;
  const working = w.enabled && !(w.debt > 0) && mod >= def.workHours[0] * 60 && mod < def.workHours[1] * 60;
  if (!working) {
    if (rt.phase === 'work' || rt.phase === 'move' || rt.phase === 'toDonkey' || rt.phase === 'toGarage') abortTask(w, rt);
    if (rt.phase !== 'retRide' && rt.phase !== 'retWalk' && rt.phase !== 'retVehicle') {
      if (atHome(w) && !w.onDonkey) { setMode(w, 'home'); rt.phase = 'idle'; return; }
      startReturn(state, w, rt, def);
    }
  } else if (w.mode === 'home') {
    setMode(w, 'idle'); rt.phase = 'idle'; rt.nextDecide = mins;
  }
  if (working && (rt.phase === 'retRide' || rt.phase === 'retWalk') && mins >= rt.nextDecide) {
    if (!decide(state, w, rt, def, mins)) rt.nextDecide = mins + DECIDE_EVERY;
  }
  switch (rt.phase) {
    case 'idle':
      if (working && mins >= rt.nextDecide) {
        if (!decide(state, w, rt, def, mins)) {
          rt.nextDecide = mins + DECIDE_EVERY;
          if (w.onDonkey) dismount(state, w);
          if (!atHome(w)) retWalk(w, rt); else setMode(w, 'idle');
        }
      }
      break;
    case 'toDonkey':
      if (moveAlong(state, w, rt, def.walkTilesPerMin)) {
        mount(state, w);
        if (setPath(w, rt, rt.goal)) { rt.phase = 'move'; setMode(w, 'ride'); if (w.task) w.task.phase = 'move'; } else { ban(rt.cur.kind, rt.cur.target, mins + BAN_MIN); abortTask(w, rt); }
      }
      break;
    case 'move':
      if (moveAlong(state, w, rt, speedOf(w, def))) {
        if (w.onDonkey) dismount(state, w);
        const cur = rt.cur;
        let am;
        if (cur.tiles) {
          if (!payFuel(state, bus, cur.vtype, cur.tiles)) {
            for (const id of cur.tiles) ban(cur.kind, id, mins + BAN_MIN);
            bus.emit('toast', { text: 'Yakıt parası yetmedi.', kind: 'bad' });
            abortTask(w, rt);
            break;
          }
          bus.emit('vehicle:run', { type: cur.vtype, tiles: cur.tiles.slice(), driverId: w.id });
          am = cur.tiles.length * VEHICLES[cur.vtype].minutesPerTile;
        } else am = actionMinutes(def, w, cur.kind);
        rt.phase = 'work'; setMode(w, 'work');
        w.task.endMin = mins + am; w.task.phase = 'work';
      }
      break;
    case 'toGarage':
      if (moveAlong(state, w, rt, def.walkTilesPerMin)) {
        w.vehicle = rt.cur.vtype;
        if (setPath(w, rt, rt.goal)) { rt.phase = 'move'; w.task.phase = 'move'; emitState(w); } else { ban(rt.cur.kind, rt.cur.target, mins + BAN_MIN); abortTask(w, rt); }
      }
      break;
    case 'retVehicle':
      if (moveAlong(state, w, rt, speedOf(w, def))) {
        releaseVehicle(w); emitState(w);
        rt.phase = 'idle'; rt.nextDecide = mins; setMode(w, 'idle');
      }
      break;
    case 'work':
      if (mins >= w.task.endMin) {
        const usedVehicle = !!w.vehicle;
        finish(state, bus, w, rt, mins, def);
        if (usedVehicle) { startRetVehicle(w, rt); if (rt.phase === 'retVehicle') moveAlong(state, w, rt, speedOf(w, def)); } else if (working && decide(state, w, rt, def, mins)) moveAlong(state, w, rt, speedOf(w, def));
      }
      break;
    case 'retRide':
      if (moveAlong(state, w, rt, def.donkeyTilesPerMin)) {
        dismount(state, w);
        state.donkey.x = SHED_X; state.donkey.y = SHED_Y;
        retWalk(w, rt);
      }
      break;
    case 'retWalk':
      if (moveAlong(state, w, rt, def.walkTilesPerMin)) {
        rt.phase = 'idle'; rt.nextDecide = mins;
        setMode(w, working ? 'idle' : 'home');
      }
      break;
    default: break;
  }
}

function tickMinute(state, bus) {
  const ws = state.workers;
  if (!ws.length) return;
  const mins = state.time.totalMinutes;
  const mod = modDay(mins);
  env.now = mins;
  for (let i = 0; i < ws.length; i++) tickWorker(state, bus, ws[i], mins, mod);
  // gece: boşta kalan eşek sundurmaya döner
  const d = state.donkey;
  if (mod === 21 * 60 && d.mode !== 'carrying' && (d.x !== SHED_X || d.y !== SHED_Y)) { d.x = SHED_X; d.y = SHED_Y; d.mode = 'home'; }
}

// ---------------------------------------------------------------- maaş
function onHour(state, bus) {
  const ws = state.workers;
  if (!ws.length) return;
  const hour = hourOf(state);
  for (const w of ws) {
    const def = WORKER_TYPES[w.type];
    if (!def) continue;
    if (w.debt > 0) {
      if (transact(state, bus, { amount: -w.debt, category: 'wages', label: `Maaş: ${w.name}` })) {
        w.debt = 0;
        bus.emit('toast', { text: `${w.name}'in maaşı ödendi, işe döndü.`, kind: 'good' });
        bus.emit('workers:changed', { ids: [w.id] });
      }
      continue;
    }
    if (hour !== def.payHour || !w.enabled) continue;
    const wage = wageOf(w, def);
    if (transact(state, bus, { amount: -wage, category: 'wages', label: `Maaş: ${w.name}` })) {
      bus.emit('workers:changed', { ids: [w.id] });
    } else {
      w.debt = wage;
      bus.emit('toast', { text: `${w.name}'in maaşı ödenemedi; ödenene kadar çalışmayacak.`, kind: 'bad' });
      bus.emit('workers:changed', { ids: [w.id] });
    }
  }
}
function onDay(state, bus) {
  for (const k of KINDS) bans[k].clear();
  const day = calendar(state.time.totalMinutes).day;
  if (day - state.hiring.refreshedDay >= HIRING.refreshEveryDays) {
    refreshHiring(state, bus);
    bus.emit('toast', { text: 'İş ilanı panosu yenilendi: yeni adaylar var.', kind: 'info' });
  }
}
const wageOf = (w, def) => (finite(w.wage) && w.wage > 0 ? w.wage : def.wagePerDay);

// ---------------------------------------------------------------- komutlar
function res(bus, p) { bus.emit('worker:result', p); return p; }
const levelOf = (state) => Number(state.player?.level) || 1;

let rngRef = null;
const rngOf = (state) => rngRef || (rngRef = createRng(state));
const clampSkill = (v) => Math.max(1, Math.min(5, Math.round(Number(v)) || 1));

/** Aday üretir (ctx.rng): tür ağırlıkları experienced 5, master 3, çırak 2 (yalnızca alınmamışsa). */
function makeCandidate(state, rng, usedTypes) {
  const flags = state.flags;
  const pool = [['experienced', 5], ['master', 3]];
  if (!state.workers.some((w) => w.type === 'apprentice') && !usedTypes.has('apprentice')) pool.push(['apprentice', 2]);
  let r = rng.next() * pool.reduce((a, q) => a + q[1], 0);
  let type = pool[0][0];
  for (const q of pool) { if (r < q[1]) { type = q[0]; break; } r -= q[1]; }
  const def = WORKER_TYPES[type];
  const sr = def.skillRange || [1, 1];
  const seq = (Number(flags.candSeq) || 0) + 1;
  flags.candSeq = seq;
  const jit = def.wageJitter || 0;
  return {
    id: `c${seq}`, type, name: rng.pick(WORKER_NAMES) || def.defaultName || def.title,
    skills: { farm: rng.int(sr[0], sr[1]), animal: rng.int(sr[0], sr[1]), machine: rng.int(sr[0], sr[1]) },
    wage: Math.max(1, Math.round(def.wagePerDay * (1 + (jit ? rng.range(-jit, jit) : 0)))),
    look: type === 'apprentice' ? null : rng.int(0, 3),
    hireCost: def.hireCost || 0,
  };
}
export function refreshHiring(state, bus) {
  const rng = rngOf(state);
  const list = [];
  const used = new Set();
  for (let i = 0; i < HIRING.candidates; i++) { const c = makeCandidate(state, rng, used); used.add(c.type); list.push(c); }
  state.hiring.candidates = list;
  state.hiring.refreshedDay = calendar(state.time.totalMinutes).day;
  if (bus) { bus.emit('hiring:changed', { day: state.hiring.refreshedDay }); bus.emit('workers:changed', { ids: [] }); }
}

function newWorker(state, type, cand) {
  const def = WORKER_TYPES[type];
  const seq = (Number(state.flags.workerSeq) || 0) + 1;
  state.flags.workerSeq = seq;
  const skills = cand ? { ...cand.skills } : { farm: 1, animal: 1, machine: 1 };
  return {
    id: `w${seq}`, type, name: (cand && cand.name) || def.defaultName, hiredDay: calendar(state.time.totalMinutes).day, enabled: true,
    tasks: Object.fromEntries(TASK_KINDS.map((k) => [k, true])), order: def.tasks.slice(),
    skills, wage: cand ? cand.wage : def.wagePerDay, look: type === 'apprentice' ? null : (cand ? cand.look : 0), vehicle: null,
    x: HOME_X, y: HOME_Y, prevX: HOME_X, prevY: HOME_Y, mode: 'home', task: null, onDonkey: false, debt: 0,
  };
}

function hire(state, bus, p = {}) {
  let cand = null;
  let type = p.type;
  if (p.candidateId) {
    cand = state.hiring.candidates.find((c) => c.id === p.candidateId);
    if (!cand) return res(bus, { ok: false, type: 'hire', reason: REASONS.noCand });
    type = cand.type;
  } else {
    type = type || 'apprentice';
    if (type !== 'apprentice') return res(bus, { ok: false, type: 'hire', reason: REASONS.needBoard });
  }
  const def = WORKER_TYPES[type];
  if (!def) return res(bus, { ok: false, type: 'hire', reason: REASONS.badType });
  if (levelOf(state) < (def.hireLevel || 0)) return res(bus, { ok: false, type: 'hire', reason: REASONS.locked(def.hireLevel) });
  if (state.workers.length >= MAX_WORKERS) return res(bus, { ok: false, type: 'hire', reason: REASONS.full(MAX_WORKERS) });
  if (def.unique && state.workers.some((w) => w.type === type)) return res(bus, { ok: false, type: 'hire', reason: REASONS.already });
  const cost = def.hireCost || 0;
  if (cost > 0 && !transact(state, bus, { amount: -cost, category: 'wages', label: `İşe alım: ${cand ? cand.name : def.title}` })) {
    return res(bus, { ok: false, type: 'hire', reason: REASONS.noMoney });
  }
  const w = newWorker(state, type, cand);
  state.workers.push(w);
  if (cand) {
    state.hiring.candidates = state.hiring.candidates.filter((c) => c.id !== cand.id);
    if (type === 'apprentice') state.hiring.candidates = state.hiring.candidates.filter((c) => c.type !== 'apprentice');
  } else if (type === 'apprentice') state.hiring.candidates = state.hiring.candidates.filter((c) => c.type !== 'apprentice');
  if (type === 'apprentice') { state.donkey.x = SHED_X; state.donkey.y = SHED_Y; state.donkey.mode = 'home'; }
  emitState(w);
  bus.emit('workers:changed', { ids: [w.id] });
  bus.emit('hiring:changed', {});
  bus.emit('toast', { text: `${w.name} işe başladı!`, kind: 'good' });
  return res(bus, { ok: true, type: 'hire', workerId: w.id });
}

function fire(state, bus, p = {}) {
  const i = state.workers.findIndex((w) => w.id === p.workerId);
  if (i < 0) return res(bus, { ok: false, type: 'fire', reason: REASONS.noWorker });
  const w = state.workers[i];
  const rt = rts.get(w.id);
  if (rt) release(rt);
  releaseVehicle(w);
  rts.delete(w.id);
  state.workers.splice(i, 1);
  if (w.onDonkey || w.type === 'apprentice') { state.donkey.x = SHED_X; state.donkey.y = SHED_Y; state.donkey.mode = 'home'; }
  bus.emit('worker:state', { workerId: w.id, mode: 'gone', x: w.x, y: w.y, onDonkey: false, kind: null });
  bus.emit('workers:changed', { ids: [w.id] });
  return res(bus, { ok: true, type: 'fire', workerId: w.id });
}

export function cleanName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function set(state, bus, p = {}) {
  const w = state.workers.find((x) => x.id === p.workerId);
  if (!w) return res(bus, { ok: false, type: 'set', reason: REASONS.noWorker });
  if (p.name !== undefined) { const n = cleanName(p.name); if (n) w.name = n; }
  if (isPlainObject(p.tasks)) for (const k of TASK_KINDS) if (typeof p.tasks[k] === 'boolean') w.tasks[k] = p.tasks[k];
  const kinds = WORKER_TYPES[w.type].tasks;
  if (Array.isArray(p.order) && p.order.length === kinds.length && kinds.every((k) => p.order.includes(k))) w.order = p.order.slice();
  if (typeof p.enabled === 'boolean') w.enabled = p.enabled;
  bus.emit('workers:changed', { ids: [w.id] });
  return res(bus, { ok: true, type: 'set', workerId: w.id });
}

// ---------------------------------------------------------------- doğrulama
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export function validate(state, onFix = () => {}) {
  if (!Array.isArray(state.workers)) { onFix('workers'); state.workers = []; }
  if (!isPlainObject(state.flags)) state.flags = {};
  if (!isPlainObject(state.donkey)) { onFix('donkey'); state.donkey = { x: SHED_X, y: SHED_Y, mode: 'home' }; }
  const d = state.donkey;
  if (!finite(d.x) || !finite(d.y)) { onFix('donkey.pos'); d.x = SHED_X; d.y = SHED_Y; }
  if (d.mode !== 'home' && d.mode !== 'carrying') { onFix('donkey.mode'); d.mode = 'home'; }
  if (!isPlainObject(state.hiring)) { onFix('hiring'); state.hiring = { candidates: [], refreshedDay: 0 }; }
  if (!Array.isArray(state.hiring.candidates)) state.hiring.candidates = [];
  state.hiring.candidates = state.hiring.candidates.filter((c) => isPlainObject(c) && typeof c.id === 'string' && WORKER_TYPES[c.type] && isPlainObject(c.skills) && finite(c.wage));
  if (!finite(state.hiring.refreshedDay)) state.hiring.refreshedDay = 0;
  const ids = new Set();
  const kept = [];
  state.workers.forEach((w, i) => {
    const path = `workers.${i}`;
    const def = isPlainObject(w) ? WORKER_TYPES[w.type] : null;
    if (!def) { onFix(path); return; }
    if (typeof w.id !== 'string' || ids.has(w.id)) {
      onFix(`${path}.id`);
      let n = (Number(state.flags.workerSeq) || 0) + 1; while (ids.has(`w${n}`)) n++;
      state.flags.workerSeq = n; w.id = `w${n}`;
    }
    ids.add(w.id);
    const nm = cleanName(w.name);
    if (!nm) onFix(`${path}.name`);
    w.name = nm || def.defaultName;
    if (!finite(w.hiredDay)) { onFix(`${path}.hiredDay`); w.hiredDay = 1; }
    if (typeof w.enabled !== 'boolean') { onFix(`${path}.enabled`); w.enabled = true; }
    if (!isPlainObject(w.tasks)) { onFix(`${path}.tasks`); w.tasks = {}; }
    for (const k of TASK_KINDS) if (typeof w.tasks[k] !== 'boolean') w.tasks[k] = true;
    if (!Array.isArray(w.order) || w.order.length !== def.tasks.length || !def.tasks.every((k) => w.order.includes(k))) {
      // eski kayıt (4 görev): eksik görevleri sona ekle, fazlaları at
      const old = Array.isArray(w.order) ? w.order.filter((k) => def.tasks.includes(k)) : [];
      w.order = old.concat(def.tasks.filter((k) => !old.includes(k)));
    }
    if (!isPlainObject(w.skills)) w.skills = {};
    const sr = def.skillRange || [1, 1];
    for (const k of ['farm', 'animal', 'machine']) w.skills[k] = finite(w.skills[k]) ? clampSkill(w.skills[k]) : clampSkill((sr[0] + sr[1]) / 2);
    if (!(finite(w.wage) && w.wage > 0)) w.wage = def.wagePerDay;
    if (w.type === 'apprentice') w.look = null;
    else if (!(Number.isInteger(w.look) && w.look >= 0 && w.look <= 3)) w.look = 0;
    w.vehicle = null;
    if (!finite(w.x) || !finite(w.y)) { onFix(`${path}.pos`); w.x = HOME_X; w.y = HOME_Y; }
    if (!finite(w.prevX) || !finite(w.prevY)) { w.prevX = w.x; w.prevY = w.y; }
    if (!MODES.includes(w.mode)) { onFix(`${path}.mode`); w.mode = 'idle'; }
    if (w.task) onFix(`${path}.task`);
    w.task = null; // yol bilgisi kayda yazılmaz; yük sonrası yeniden karar verilir
    if (w.mode === 'walk' || w.mode === 'ride' || w.mode === 'work') w.mode = 'idle';
    if (typeof w.onDonkey !== 'boolean') w.onDonkey = false;
    w.debt = finite(w.debt) && w.debt > 0 ? w.debt : 0;
    kept.push(w);
  });
  state.workers.length = 0; state.workers.push(...kept);
  const riders = kept.filter((w) => w.onDonkey);
  if (riders.length > 1) for (let i = 1; i < riders.length; i++) riders[i].onDonkey = false;
  if (riders.length) { d.mode = 'carrying'; d.x = riders[0].x; d.y = riders[0].y; } else d.mode = 'home';
  const seq = kept.reduce((m, w) => Math.max(m, Number(String(w.id).slice(1)) || 0), 0);
  if (!(Number(state.flags.workerSeq) >= seq)) state.flags.workerSeq = seq;
  return state;
}

// ---------------------------------------------------------------- dış API (kamera takibi, debug)
const followCache = new Map();
/** Kamera takibi için canlı {x,y}: oyun dakikası arası interpolasyonlu dünya konumu. */
export function followTarget(state, workerId) {
  const w = state.workers.find((x) => x.id === workerId);
  if (!w) return null;
  let t = followCache.get(workerId);
  if (!t) {
    t = {
      get x() { const f = regRef ? regRef.fraction : 1; return w.prevX + (w.x - w.prevX) * f; },
      get y() { const f = regRef ? regRef.fraction : 1; return w.prevY + (w.y - w.prevY) * f; },
    };
    followCache.set(workerId, t);
  }
  return t;
}

export function debugSummary(state) {
  const cal = calendar(state.time.totalMinutes);
  return {
    time: `${cal.day}. gün ${String(cal.hour).padStart(2, '0')}:${String(cal.minute).padStart(2, '0')}`,
    donkey: { ...state.donkey },
    workers: state.workers.map((w) => {
      const rt = rts.get(w.id);
      return {
        id: w.id, name: w.name, type: w.type, vehicle: w.vehicle, mode: w.mode, phase: rt ? rt.phase : null, onDonkey: w.onDonkey, debt: w.debt,
        tile: [Math.floor(w.x / TW), Math.floor(w.y / TH)], task: w.task ? { ...w.task } : null,
        status: statusText(state, w, cal.hour),
      };
    }),
  };
}

const WorkerSystem = {
  id: 'workers',
  validate,
  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    busRef = bus;
    regRef = registry || null;
    resetRuntime();
    rngRef = registry && registry.ctx && registry.ctx.rng ? registry.ctx.rng : null;
    followCache.clear();
    bindState(state);
    refreshShed(state);
    offs.push(bus.on('placed:changed', () => {
      const ox = SHED_X, oy = SHED_Y;
      refreshShed(state);
      // Sundurma taşındıysa evde bekleyen eşek yeni yere gelir.
      if (state.donkey.mode === 'home' && (ox !== SHED_X || oy !== SHED_Y)) { state.donkey.x = SHED_X; state.donkey.y = SHED_Y; }
    }));
    validate(state, () => {});
    if (!state.hiring.refreshedDay) refreshHiring(state, null);
    const keep = (p) => { lastResult = p; };
    offs.push(bus.on('farm:result', keep));
    offs.push(bus.on('animal:result', keep));
    offs.push(bus.on('machine:result', keep));
    offs.push(bus.on('worker:hire', (p) => hire(state, bus, p)));
    offs.push(bus.on('worker:fire', (p) => fire(state, bus, p)));
    offs.push(bus.on('worker:set', (p) => set(state, bus, p)));
  },
  tickMinute,
  onHour,
  onDay,
};

export default WorkerSystem;
