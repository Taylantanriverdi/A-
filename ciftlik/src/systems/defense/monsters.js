// Canavar yapay zekâsı — PLAN §16. Hedef seçimi, hareket (dakika tabanlı), saldırı. Rastgelelik yok (deterministik).
import { MONSTERS, DEFENSES, DAMAGE } from '../../data/defense.js';
import { PLACEABLES } from '../../data/placeables.js';
import { TILE_W, TILE_H } from '../../core/constants.js';
import { GW, GH, blocked, breakOwner, trapOwner, lights, findPath, sync, isBreakable } from './monsterGrid.js';
import { hurt, initHp } from './combat.js';
import { animalsIn } from '../animals/sim.js';

export const HOUSE_RECT = { x0: 41, x1: 44, y0: 6, y1: 11 };
export const HOUSE_U = 43, HOUSE_V = 9;
const SOLDIER_AGGRO = 1.8;
const clampi = (v, a, b) => (v < a ? a : v > b ? b : v);

function catOf(p) {
  const def = PLACEABLES[p.type];
  if (!def || p.ruined || def.walkable || def.defense || p.type === 'fence') return null;
  return def.cat === 'animals' ? 'animalBuilding' : 'building';
}
const footCell = (p, def, u, v) => clampi(Math.floor(v), p.ty, p.ty + def.h - 1) * GW + clampi(Math.floor(u), p.tx, p.tx + def.w - 1);

/** Hedef seç: targets önceliğine göre ilk dolu kategorideki en yakın. */
export function pickTarget(state, m) {
  const D = state.defense, def = MONSTERS[m.type];
  const mu = m.x / TILE_W, mv = m.y / TILE_H;
  for (let ci = 0; ci < def.targets.length; ci++) {
    const cat = def.targets[ci];
    let bd = Infinity, id = null, goal = -1, reach = 1;
    if (cat === 'crop') {
      for (const tid in state.tiles) {
        const t = state.tiles[tid];
        if (!t || !t.crop || t.crop.dead || D.trampled.includes(tid)) continue;
        const c = tid.indexOf(',');
        const tx = +tid.slice(0, c), ty = +tid.slice(c + 1);
        const d = (tx + 0.5 - mu) ** 2 + (ty + 0.5 - mv) ** 2;
        if (d < bd) { bd = d; id = tid; goal = ty * GW + tx; reach = 0; }
      }
    } else if (cat === 'house') {
      id = 'house'; reach = 1;
      goal = clampi(Math.floor(mv), HOUSE_RECT.y0, HOUSE_RECT.y1) * GW + clampi(Math.floor(mu), HOUSE_RECT.x0, HOUSE_RECT.x1);
    } else {
      for (let i = 0; i < state.placed.length; i++) {
        const p = state.placed[i];
        if (catOf(p) !== cat) continue;
        const pd = PLACEABLES[p.type];
        const d = (p.tx + pd.w / 2 - mu) ** 2 + (p.ty + pd.h / 2 - mv) ** 2;
        if (d < bd) { bd = d; id = p.id; goal = footCell(p, pd, mu, mv); reach = 1; }
      }
    }
    if (id !== null) { m.targetId = id; m.tg = goal; m.reach = reach; return true; }
  }
  m.targetId = null; m.tg = -1;
  return false;
}

function targetValid(state, m) {
  const id = m.targetId;
  if (id === null) return false;
  if (id === 'house') return true;
  if (id.charCodeAt(0) === 112 && id.indexOf(',') < 0) { // 'p…' → yapı
    const ps = state.placed;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return !ps[i].ruined;
    return false;
  }
  const t = state.tiles[id];
  return !!(t && t.crop && !t.crop.dead) && !state.defense.trampled.includes(id);
}

function route(state, m) {
  const def = MONSTERS[m.type];
  m.pi = 0;
  if (def.passFences) { m.path = null; return true; }   // hayalet: engelsiz, düz uçuş
  const s = clampi(Math.floor(m.y / TILE_H), 0, GH - 1) * GW + clampi(Math.floor(m.x / TILE_W), 0, GW - 1);
  m.path = findPath(state, s, m.tg, false) || findPath(state, s, m.tg, true);
  return m.path !== null;
}

function nearLight(u, v, scale) {
  for (let i = 0; i < lights.length; i++) {
    const L = lights[i];
    const du = u - L.u, dv = v - L.v;
    if (du * du + dv * dv <= L.r * L.r * scale) return L;
  }
  return null;
}
const lightOn = (state, L) => !state.placed[L.i].ruined;

function scareAnimals(state, p) {
  const b = state.buildings.find((x) => x.placedId === p.id);
  if (!b) return;
  const list = animalsIn(state, b.id);
  for (let i = 0; i < list.length; i++) list[i].happiness = Math.max(0, list[i].happiness + DAMAGE.animalScare);
}

/** Tüm canavarları bir dakika ilerlet. env: {bus, ctx}. Dönüş: yapı/ekin değişimi var mı bayrağı (bit1 yapı, bit2 ekin). */
export function stepMonsters(state, bus) {
  const D = state.defense, ms = D.monsters;
  sync(state);
  let flags = 0;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.hp <= 0) continue;
    const def = MONSTERS[m.type];
    const mu = m.x / TILE_W, mv = m.y / TILE_H;

    // 1) yakındaki asker → ona saldır
    let sol = null;
    for (let k = 0; k < D.soldiers.length; k++) {
      const s = D.soldiers[k];
      if (s.state === 'down' || s.state === 'sleep') continue;
      const du = s.x / TILE_W - mu, dv = s.y / TILE_H - mv;
      if (du * du + dv * dv <= SOLDIER_AGGRO * SOLDIER_AGGRO) { sol = s; break; }
    }
    if (sol) {
      m.state = 'attack';
      sol.hp -= def.dmg * def.rate;
      if (sol.hp <= 0) { sol.hp = 0; sol.state = 'down'; sol.towerId = null; bus.emit('soldiers:changed', { ids: [sol.id] }); }
      bus.emit('defense:hit', { x: sol.x, y: sol.y, kind: 'soldier' });
      continue;
    }

    // 2) hedef
    if (m.wait > 0) { m.wait--; continue; }
    if (!targetValid(state, m)) {
      if (!pickTarget(state, m) || !route(state, m)) { m.wait = 8; m.state = 'walk'; continue; }
      m.state = 'walk';
    } else if (m.path === null && !def.passFences) {
      if (!route(state, m)) { m.wait = 8; continue; }
    }
    const cx = clampi(Math.floor(mu), 0, GW - 1), cy = clampi(Math.floor(mv), 0, GH - 1);

    // 3) menzilde mi → saldır
    const gx = m.tg % GW, gy = (m.tg / GW) | 0;
    if (Math.max(Math.abs(cx - gx), Math.abs(cy - gy)) <= m.reach) {
      if (def.fleesLight && nearLight(mu, mv, 1.0)) { /* ışıktaki hayalet saldırmaz, aşağıda kaçar */ } else {
        flags |= attack(state, bus, m, def);
        continue;
      }
    }

    // 4) hareket
    let step = def.speed;
    if (m.type === 'zombie') {
      const L = nearLight(mu, mv, 1.0);
      if (L && lightOn(state, L)) step *= DEFENSES.brazier.slowZombies;
    }
    let tu, tv;
    if (def.passFences) {
      tu = gx + 0.5; tv = gy + 0.5;
      const nu = mu + (tu - mu) / Math.max(1e-6, Math.hypot(tu - mu, tv - mv)) * step;
      const nv = mv + (tv - mv) / Math.max(1e-6, Math.hypot(tu - mu, tv - mv)) * step;
      let L = null;
      for (let q = 0; q < lights.length; q++) {
        const l = lights[q];
        if (!lightOn(state, l)) continue;
        const du = nu - l.u, dv = nv - l.v;
        if (du * du + dv * dv <= l.r * l.r) { L = l; break; }
      }
      if (L) { // kaç: ışıktan uzaklaş
        const du = mu - L.u, dv = mv - L.v, d = Math.max(1e-6, Math.hypot(du, dv));
        m.x += (du / d) * step * TILE_W; m.y += (dv / d) * step * TILE_H; m.fl = 1;
      } else { m.x = nu * TILE_W; m.y = nv * TILE_H; m.fl = 0; }
      m.state = 'walk';
      continue;
    }
    // yol üzerinde yürü
    const path = m.path;
    while (step > 1e-6 && m.pi < path.length) {
      const nc = path[m.pi];
      if (blocked[nc] === 1 && nc !== m.tg) {
        const bo = breakOwner[nc];
        if (bo >= 0 && !state.placed[bo].ruined) { // kırılabilir engel → hedef olur
          m.targetId = state.placed[bo].id; m.tg = nc; m.reach = 1; m.path = null; m.state = 'attack';
          break;
        }
        m.path = null; m.wait = 0; break;           // yeni engel: yeniden yönlendir
      }
      const u = (nc % GW) + 0.5, v = ((nc / GW) | 0) + 0.5;
      const du = u - m.x / TILE_W, dv = v - m.y / TILE_H, d = Math.hypot(du, dv);
      if (d <= step) {
        m.x = u * TILE_W; m.y = v * TILE_H; step -= d; m.pi++;
        // tuzak
        const to = trapOwner[nc];
        if (to >= 0) {
          const tp = state.placed[to];
          if (!tp.ruined) {
            if (!Number.isFinite(tp.hp)) initHp(tp);
            m.hp -= DEFENSES.spikeTrap.trapDmg;
            hurt(state, tp, 1); flags |= 1;
            bus.emit('defense:hit', { x: m.x, y: m.y, kind: 'trap', from: tp.id });
            if (D.nightDamaged.indexOf(tp.id) < 0) D.nightDamaged.push(tp.id);
          }
        }
        if (m.hp <= 0) break;
      } else { m.x += (du / d) * step * TILE_W; m.y += (dv / d) * step * TILE_H; step = 0; }
    }
    if (m.state !== 'attack') m.state = 'walk';
  }
  return flags;
}

function attack(state, bus, m, def) {
  const D = state.defense, id = m.targetId;
  m.state = 'attack';
  const dmg = def.dmg * def.rate;
  if (id === 'house') {
    D.houseHp = Math.max(0, D.houseHp - dmg);
    bus.emit('defense:hit', { x: HOUSE_U * TILE_W, y: HOUSE_V * TILE_H, kind: 'house' });
    return 1;
  }
  const t = state.tiles[id];
  if (t && t.crop) { // ekin ezme: karo başına gece başına bir kez
    t.crop.health -= DAMAGE.cropTrample;
    if (t.crop.health <= 0) { t.crop.health = 0; t.crop.dead = true; }
    D.trampled.push(id);
    bus.emit('defense:hit', { x: m.x, y: m.y, kind: 'crop' });
    bus.emit('farm:changed', { tileIds: [id] });
    m.targetId = null;
    return 2;
  }
  const ps = state.placed;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.id !== id) continue;
    if (!Number.isFinite(p.hp)) initHp(p);
    const pd = PLACEABLES[p.type];
    const first = D.nightDamaged.indexOf(p.id) < 0;
    if (first) { D.nightDamaged.push(p.id); if (pd.cat === 'animals') scareAnimals(state, p); }
    const dd = DEFENSES[p.type];
    if (dd && dd.contactDmg) m.hp -= dd.contactDmg * def.rate;   // telli çit temas hasarı
    const broke = hurt(state, p, dmg);
    bus.emit('defense:hit', { x: (p.tx + pd.w / 2) * TILE_W, y: (p.ty + pd.h / 2) * TILE_H, kind: broke ? 'broken' : (dd && dd.contactDmg ? 'wire' : 'structure'), from: p.id });
    return 1;
  }
  return 0;
}
