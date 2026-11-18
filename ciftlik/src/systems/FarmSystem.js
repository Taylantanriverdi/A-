// FarmSystem — tarım ve toprak simülasyonu (PLAN.md §3, §8). Phaser import ETMEZ.
// Komut: farm:action → farm:result, farm:changed, farm:harvested, farm:milestone, xp:add (ProgressionSystem işler).
// onHour: nem, sağlık, büyüme, bakım örneği. onDay: kompost, ot/zararlı/hastalık, çürüme, boş karo.
// onSeason: mevsim dışı hasar. Rastgelelik yalnızca ctx.rng (tohumlu).
import { CROPS, ROT_AFTER_DAYS, REGROW_STAGE } from '../data/crops.js';
import { HEALTH, SOIL } from '../data/farming.js';
import { XP_RULES } from '../data/progression.js';
import { ITEMS, STARTING_INVENTORY } from '../data/items.js';
import { PARCELS, blockedKind } from '../data/land.js';
import { calendar } from '../core/timeUtils.js';
import { createRng } from '../core/Rng.js';
import { isPlainObject } from '../core/GameState.js';
import { add, remove, canAdd } from './InventorySystem.js';
import {
  TILE_STATES, clamp, tileKey, parseKey, createTile, ownedParcelIds, moistureHour, water, applyFertilizer, releasePending, harvestSoil, weedSteal,
} from './farm/soil.js';
import { REGROW_GROWTH, inSeason, growthRatePerHour, stageFor, rotationMult } from './farm/growth.js';
import { healthDeltaHour, dailyWeeds, dailyPestDisease, spreadTo, applyTreatment } from './farm/threats.js';
import { careSample, careScore, gradeFor, harvestYield, harvestXp } from './farm/quality.js';
import { canApply } from './farm/rules.js';

/** Başlangıçta sürülmüş 24 karo (PLAN §8). */
const START_PLOWED = { x0: 34, x1: 39, y0: 8, y1: 11 };
const WITHER = HEALTH.witherBelow;

// ---- Karo önbelleği (state dışı; onHour/onDay bellek ayırmasın diye) ----
let tilesRef = null;
let list = [];          // tile nesneleri
let ids = [];           // 'tx,ty' anahtarları (string birleştirme yapılmasın)
let nbr = new Int32Array(0); // 4 komşu indeksi / -1
let mark = new Uint8Array(0);
let changed = new Int32Array(0);
let dirty = true;

let busRef = null;
let regRef = null;
let fallbackRng = null;
let offs = [];

function rebuildCache(state) {
  tilesRef = state.tiles;
  ids = Object.keys(tilesRef);
  list = ids.map((k) => tilesRef[k]);
  const n = list.length;
  const index = new Map();
  for (let i = 0; i < n; i++) index.set(ids[i], i);
  nbr = new Int32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = list[i];
    const ks = [tileKey(t.tx + 1, t.ty), tileKey(t.tx - 1, t.ty), tileKey(t.tx, t.ty + 1), tileKey(t.tx, t.ty - 1)];
    for (let j = 0; j < 4; j++) nbr[i * 4 + j] = index.has(ks[j]) ? index.get(ks[j]) : -1;
  }
  mark = new Uint8Array(n);
  changed = new Int32Array(n);
  dirty = false;
}

function ensureCache(state) {
  if (dirty || state.tiles !== tilesRef) rebuildCache(state);
}

/** İşaretli karolar için toplu farm:changed (saatte/günde en fazla bir küçük dizi). */
function flushChanged(bus, cnt) {
  if (cnt === 0) return;
  const out = new Array(cnt);
  for (let i = 0; i < cnt; i++) { out[i] = ids[changed[i]]; mark[changed[i]] = 0; }
  bus.emit('farm:changed', { tileIds: out });
}

function rngOf(state) {
  const r = regRef?.ctx?.rng;
  if (r) return r;
  if (!fallbackRng) fallbackRng = createRng(state);
  return fallbackRng;
}

function ensureFlags(state) {
  if (!isPlainObject(state.flags)) state.flags = {};
  if (!isPlainObject(state.flags.firstHarvest)) state.flags.firstHarvest = {};
  return state.flags;
}

/** XP isteği: seviye/XP state'ini ProgressionSystem yazar (PLAN §9). */
function gainXp(bus, amount, reason) {
  if (!(amount > 0)) return;
  bus.emit('xp:add', { amount, reason });
}

function isStartPlowed(tx, ty) {
  return tx >= START_PLOWED.x0 && tx <= START_PLOWED.x1 && ty >= START_PLOWED.y0 && ty <= START_PLOWED.y1;
}

/**
 * Sahip olunan parsellerin eksik karolarını varsayılan çim (SOIL.start) ile tamamlar; mevcutlara dokunmaz.
 * Bozuk kayıt / validator silmesi sonrası kalıcı delik kalmasın diye her init'te çalışır.
 * @param {object} state
 * @param {boolean} [startPlowed] yalnızca yeni oyunda: başlangıç 24 karosu sürülmüş
 * @returns {string[]} eklenen karo kimlikleri
 */
export function ensureParcelTiles(state, startPlowed = false) {
  if (!isPlainObject(state.tiles)) state.tiles = {};
  const added = [];
  for (const pid of ownedParcelIds(state)) {
    const r = PARCELS[pid];
    for (let ty = r.ty; ty < r.ty + r.h; ty++) {
      for (let tx = r.tx; tx < r.tx + r.w; tx++) {
        const key = tileKey(tx, ty);
        if (isPlainObject(state.tiles[key])) continue;
        const plowed = startPlowed && !blockedKind(key) && isStartPlowed(tx, ty);
        state.tiles[key] = createTile(tx, ty, plowed ? 'plowed' : 'grass');
        added.push(key);
      }
    }
  }
  if (added.length) dirty = true;
  return added;
}

/**
 * Dekor altındaki karoları çime döndürür (eski kayıtlarda ekin/sürülmüş toprak). Ekin envantere gitmez.
 * @returns {string[]} temizlenen karo kimlikleri
 */
export function clearBlockedTiles(state, onFix = () => {}) {
  const out = [];
  if (!isPlainObject(state.tiles)) return out;
  for (const key of Object.keys(state.tiles)) {
    if (!blockedKind(key)) continue;
    const t = state.tiles[key];
    if (!isPlainObject(t)) continue;
    if (t.crop == null && t.state === 'grass' && !(t.weeds > 0) && !(t.idleDays > 0)) continue;
    onFix(`tiles.${key}.blocked`);
    t.crop = null; t.state = 'grass'; t.weeds = 0; t.idleDays = 0;
    out.push(key);
  }
  if (out.length) dirty = true;
  return out;
}

/** Yeni oyun kurulumu: sahip olunan parseller çim + 24 sürülmüş karo + başlangıç envanteri. */
export function setupNewFarm(state) {
  const flags = ensureFlags(state);
  if (flags.farmInitialized) return false;
  ensureParcelTiles(state, true);
  for (const it of STARTING_INVENTORY) add(state, it.itemId, it.qty, it.quality, it.organic === true);
  flags.farmInitialized = true;
  dirty = true;
  return true;
}

// ---------------- Eylemler ----------------

function newCrop(cropId, tile, day) {
  return {
    id: cropId, plantedDay: day, growth: 0, stage: 0, health: 100,
    pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false,
    rot: rotationMult(tile.history, cropId),
  };
}

/**
 * farm:action işleyicisi. Node simülasyonu doğrudan çağırabilir.
 * @returns {object} farm:result yükü
 */
export function applyAction(state, bus, p) {
  const type = p?.type;
  let tileId = p?.tileId;
  if (typeof tileId !== 'string' && Number.isInteger(p?.tx) && Number.isInteger(p?.ty)) tileId = tileKey(p.tx, p.ty);
  const itemId = p?.itemId;
  const now = calendar(state.time.totalMinutes);
  const action = { type, tileId, itemId };
  const chk = canApply(state, action, now.season);
  if (!chk.ok) {
    const res = { ok: false, type, tileId, reason: chk.reason };
    if (itemId) res.itemId = itemId;
    bus.emit('farm:result', res);
    return res;
  }
  const t = state.tiles[tileId];
  const rng = rngOf(state);
  const res = { ok: true, type, tileId };
  const flags = ensureFlags(state);
  switch (type) {
    case 'plow':
      t.state = 'plowed'; t.weeds = 0; t.idleDays = 0;
      gainXp(bus, XP_RULES.plow, 'plow');
      break;
    case 'plant': {
      const cropId = ITEMS[itemId].crop;
      remove(state, itemId, 1);
      t.crop = newCrop(cropId, t, now.day);
      t.idleDays = 0;
      res.itemId = itemId;
      gainXp(bus, XP_RULES.plant, 'plant');
      if (!flags.firstPlant) {
        flags.firstPlant = true;
        bus.emit('farm:milestone', { kind: 'firstPlant', cropId, tileId, tx: t.tx, ty: t.ty });
      }
      break;
    }
    case 'water':
      water(t);
      break;
    case 'fertilize':
      remove(state, itemId, 1);
      applyFertilizer(t, ITEMS[itemId]);
      res.itemId = itemId;
      break;
    case 'treat': {
      remove(state, itemId, 1);
      const item = ITEMS[itemId];
      const r = applyTreatment(t.crop, item, rng);
      if (item.organic === false) t.organic = false;
      res.itemId = itemId;
      res.cured = r.cured === r.tried;
      break;
    }
    case 'weed':
      t.weeds = 0;
      break;
    case 'harvest': {
      const c = t.crop;
      if (c.dead) {
        t.crop = null; t.idleDays = 0; t.organic = true;
        res.cleared = true;
        break;
      }
      const def = CROPS[c.id];
      const qty = harvestYield(def, c, rng);
      const quality = gradeFor(careScore(c, careSample(t, c, def)));
      const organic = t.organic;
      // Yer kontrolü: ekinin tamamı sığmıyorsa hasat yapılmaz (kayıp olmasın).
      if (canAdd(state, c.id, qty, quality, organic) < qty) {
        const fail = { ok: false, type, tileId, reason: 'Envanter dolu', itemId: c.id };
        bus.emit('farm:result', fail);
        return fail;
      }
      const first = c.harvests === 0;
      add(state, c.id, qty, quality, organic);
      harvestSoil(t, c.id, def, first);
      if (def.regrowDays) {
        c.harvests += 1;
        c.growth = REGROW_GROWTH; c.stage = REGROW_STAGE; c.readyDays = 0;
        c.careSum = 0; c.careCount = 0;
      } else {
        t.crop = null; t.idleDays = 0;
      }
      if (isPlainObject(state.stats)) {
        if (!isPlainObject(state.stats.harvested)) state.stats.harvested = {};
        state.stats.harvested[c.id] = (state.stats.harvested[c.id] || 0) + qty;
      }
      Object.assign(res, { itemId: c.id, qty, quality, organic });
      bus.emit('farm:harvested', { tileId, tx: t.tx, ty: t.ty, cropId: c.id, itemId: c.id, qty, quality, organic });
      gainXp(bus, harvestXp(c.id, qty), 'harvest');
      if (!flags.firstHarvest[c.id]) {
        flags.firstHarvest[c.id] = true;
        bus.emit('farm:milestone', { kind: 'firstHarvest', cropId: c.id, tileId, tx: t.tx, ty: t.ty });
      }
      break;
    }
    default:
      break;
  }
  bus.emit('farm:result', res);
  bus.emit('farm:changed', { tileIds: [tileId] });
  return res;
}

// ---------------- Simülasyon ----------------

function onHour(state, bus, ctx) {
  ensureCache(state);
  const season = ctx.now.season;
  const wt = state.weather ? state.weather.type : 'clear';
  const n = list.length;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const t = list[i];
    const wasWet = t.moisture >= 50;
    moistureHour(t, season, wt);
    let vis = t.state === 'plowed' && wasWet !== (t.moisture >= 50);
    const c = t.crop;
    if (c !== null && !c.dead) {
      const def = CROPS[c.id];
      if (def !== undefined) {
        const wasWither = c.health < WITHER;
        const h = c.health + healthDeltaHour(t, c, def, season);
        c.health = h > 100 ? 100 : h;
        if (c.health <= 0) {
          c.health = 0; c.dead = true; vis = true;
        } else {
          if (c.stage < 4) {
            const g = c.growth + growthRatePerHour(t, c, def, season);
            c.growth = g > 1 ? 1 : g;
            const st = stageFor(c.growth);
            if (st !== c.stage) { c.stage = st; vis = true; }
          }
          c.careSum += careSample(t, c, def);
          c.careCount += 1;
          if (wasWither !== (c.health < WITHER)) vis = true;
        }
      }
    }
    if (vis) { mark[i] = 1; changed[cnt++] = i; }
  }
  flushChanged(bus, cnt);
}

function onDay(state, bus, ctx) {
  ensureCache(state);
  const rng = ctx.rng;
  const season = ctx.now.season;
  const seasonStart = ctx.now.dayOfSeason === 1; // o gün onSeason hasarı uygular
  const n = list.length;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const t = list[i];
    let ch = false;
    releasePending(t);
    weedSteal(t);
    if (t.state === 'plowed' && t.crop === null) {
      t.idleDays += 1;
      if (t.idleDays >= SOIL.grassRecoverDays) {
        t.state = 'grass'; t.weeds = 0; t.idleDays = 0; ch = true;
      }
    }
    if (dailyWeeds(t, rng)) ch = true;
    const c = t.crop;
    if (c !== null && !c.dead) {
      const def = CROPS[c.id];
      if (def !== undefined) {
        if (!seasonStart && !def.frostHardy && !inSeason(def, season)) {
          c.health -= HEALTH.outOfSeasonPerDay;
          ch = true;
        }
        if (c.health <= 0) { c.health = 0; c.dead = true; ch = true; } else {
          if (dailyPestDisease(t, c, season, rng) !== 0) ch = true;
          if (c.stage >= 4) {
            c.readyDays += 1;
            if (c.readyDays >= ROT_AFTER_DAYS) { c.dead = true; ch = true; }
          }
        }
      }
    }
    if (ch && mark[i] === 0) { mark[i] = 1; changed[cnt++] = i; }
  }
  // Yayılma (şiddet > 0.5) — 4 komşu
  for (let i = 0; i < n; i++) {
    const c = list[i].crop;
    if (c === null || c.dead || (c.pest <= 0.5 && c.disease <= 0.5)) continue;
    for (let j = 0; j < 4; j++) {
      const k = nbr[i * 4 + j];
      if (k < 0) continue;
      const d = list[k].crop;
      if (d === null || d.dead) continue;
      if (spreadTo(list[i], list[k], rng) !== 0 && mark[k] === 0) { mark[k] = 1; changed[cnt++] = k; }
    }
  }
  flushChanged(bus, cnt);
}

function onSeason(state, bus, ctx) {
  ensureCache(state);
  const season = ctx.now.season;
  const n = list.length;
  let cnt = 0, hurt = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i].crop;
    if (c === null || c.dead) continue;
    const def = CROPS[c.id];
    if (!def || def.frostHardy || inSeason(def, season)) continue;
    c.health -= HEALTH.outOfSeasonOnChange;
    if (c.health <= 0) { c.health = 0; c.dead = true; }
    hurt++;
    if (mark[i] === 0) { mark[i] = 1; changed[cnt++] = i; }
  }
  flushChanged(bus, cnt);
  if (hurt > 0) bus.emit('toast', { text: `Mevsim değişti: ${hurt} ekin mevsim dışı kaldı ve zarar görüyor.`, kind: 'bad' });
}

// ---------------- Doğrulama ----------------

function fixNum(o, key, def, min, max, path, onFix, int = false) {
  let v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) { if (key in o) onFix(path); v = def; }
  const c = clamp(int ? Math.floor(v) : v, min, max);
  if (c !== o[key] && (key in o) && typeof o[key] === 'number' && Number.isFinite(o[key])) onFix(path);
  o[key] = c;
}

function validateCrop(t, path, onFix) {
  const c = t.crop;
  if (c === null) return;
  if (!isPlainObject(c) || !CROPS[c.id]) { onFix(path); t.crop = null; return; }
  fixNum(c, 'plantedDay', 1, 1, 1e7, `${path}.plantedDay`, onFix, true);
  fixNum(c, 'growth', 0, 0, 1, `${path}.growth`, onFix);
  fixNum(c, 'health', 100, 0, 100, `${path}.health`, onFix);
  fixNum(c, 'pest', 0, 0, 1, `${path}.pest`, onFix);
  fixNum(c, 'disease', 0, 0, 1, `${path}.disease`, onFix);
  fixNum(c, 'careSum', 0, 0, 1e9, `${path}.careSum`, onFix);
  fixNum(c, 'careCount', 0, 0, 1e9, `${path}.careCount`, onFix, true);
  fixNum(c, 'readyDays', 0, 0, 1e4, `${path}.readyDays`, onFix, true);
  fixNum(c, 'harvests', 0, 0, 1e6, `${path}.harvests`, onFix, true);
  fixNum(c, 'rot', 1, 0.01, 1, `${path}.rot`, onFix);
  if (typeof c.dead !== 'boolean') { onFix(`${path}.dead`); c.dead = false; }
  const st = stageFor(c.growth);
  if (c.stage !== st) { if ('stage' in c) onFix(`${path}.stage`); c.stage = st; }
  if (c.health <= 0 && !c.dead) c.dead = true;
}

/**
 * Kayıt doğrulayıcı (SaveSystem.registerValidator). tiles/crop/flags alanlarını yerinde onarır.
 * @param {object} state
 * @param {(path:string)=>void} [onFix]
 */
export function validate(state, onFix = () => {}) {
  if (state.flags !== undefined && !isPlainObject(state.flags)) onFix('flags');
  ensureFlags(state);
  if (!isPlainObject(state.tiles)) { onFix('tiles'); state.tiles = {}; dirty = true; return state; }
  const tiles = state.tiles;
  const s0 = SOIL.start;
  for (const key of Object.keys(tiles)) {
    const path = `tiles.${key}`;
    const t = tiles[key];
    const xy = parseKey(key);
    if (!xy || !isPlainObject(t)) { onFix(path); delete tiles[key]; continue; }
    if (t.tx !== xy[0] || t.ty !== xy[1]) { onFix(`${path}.tx`); t.tx = xy[0]; t.ty = xy[1]; }
    if (!TILE_STATES.includes(t.state)) { onFix(`${path}.state`); t.state = t.state === 'planted' ? 'plowed' : 'grass'; }
    fixNum(t, 'moisture', s0.moisture, 0, 100, `${path}.moisture`, onFix);
    fixNum(t, 'n', s0.n, 0, 100, `${path}.n`, onFix);
    fixNum(t, 'p', s0.p, 0, 100, `${path}.p`, onFix);
    fixNum(t, 'k', s0.k, 0, 100, `${path}.k`, onFix);
    fixNum(t, 'ph', s0.ph, SOIL.phRange[0], SOIL.phRange[1], `${path}.ph`, onFix);
    fixNum(t, 'weeds', 0, 0, 1, `${path}.weeds`, onFix);
    fixNum(t, 'idleDays', 0, 0, 1e4, `${path}.idleDays`, onFix, true);
    if (typeof t.organic !== 'boolean') { if ('organic' in t) onFix(`${path}.organic`); t.organic = true; }
    if (!Array.isArray(t.history)) { if ('history' in t) onFix(`${path}.history`); t.history = []; }
    else {
      const h = t.history.filter((id) => typeof id === 'string' && CROPS[id]).slice(-3);
      if (h.length !== t.history.length) onFix(`${path}.history`);
      t.history = h;
    }
    if (!Array.isArray(t.pendingFert)) { if ('pendingFert' in t) onFix(`${path}.pendingFert`); t.pendingFert = []; }
    else {
      const pf = t.pendingFert.filter((f) => isPlainObject(f)
        && [f.n, f.p, f.k].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
        && Number.isInteger(f.daysLeft) && f.daysLeft > 0);
      if (pf.length !== t.pendingFert.length) onFix(`${path}.pendingFert`);
      t.pendingFert = pf;
    }
    if (t.crop === undefined) t.crop = null;
    validateCrop(t, `${path}.crop`, onFix);
    if (t.crop && t.state !== 'plowed') { onFix(`${path}.state`); t.state = 'plowed'; }
  }
  clearBlockedTiles(state, onFix);
  dirty = true;
  return state;
}

const FarmSystem = {
  id: 'farm',
  validate,
  applyAction,
  setupNewFarm,
  ensureParcelTiles,
  clearBlockedTiles,
  /** Karo eklendiğinde (arazi genişletme) çağrılır. */
  invalidate() { dirty = true; },

  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    busRef = bus;
    regRef = registry || null;
    fallbackRng = null;
    ensureFlags(state);
    if (!isPlainObject(state.tiles)) state.tiles = {};
    if (!setupNewFarm(state)) {
      // Yükleme sonrası onarım: eksik parsel karoları + dekor altı karolar.
      const fixed = ensureParcelTiles(state).concat(clearBlockedTiles(state));
      if (fixed.length) {
        this.invalidate();
        bus.emit('farm:changed', { tileIds: fixed });
      }
    }
    rebuildCache(state);
    offs.push(bus.on('farm:action', (p) => applyAction(state, busRef, p)));
  },

  onHour,
  onDay,
  onSeason,
};

export default FarmSystem;
