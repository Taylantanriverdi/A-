// Askerler — PLAN §16. Gece 20:30–05:00 devriye; en yakın canavara gider, menzildeyse vurur; okçu boş kuleye yerleşir.
import { SOLDIERS, DEFENSES } from '../../data/defense.js';
import { TILE_W, TILE_H } from '../../core/constants.js';
import { blocked, GW, GH } from './monsterGrid.js';
import { HOUSE_U } from './monsters.js';

export const PATROL_FROM = 20 * 60 + 30, PATROL_TO = 5 * 60;
const SIGHT = 12, HOME_V = 12.5;
export const inPatrolWindow = (minOfDay) => minOfDay >= PATROL_FROM || minOfDay < PATROL_TO;
export const homeU = (idx) => HOUSE_U - 1.6 + idx * 0.7;
export function placeAtHome(s, idx) { s.x = homeU(idx) * TILE_W; s.y = HOME_V * TILE_H; s.wu = 0; s.wv = 0; }

function moveTo(s, u, v, speed) {
  const du = u - s.x / TILE_W, dv = v - s.y / TILE_H, d = Math.hypot(du, dv);
  if (d <= speed) { s.x = u * TILE_W; s.y = v * TILE_H; return true; }
  s.x += (du / d) * speed * TILE_W; s.y += (dv / d) * speed * TILE_H;
  return false;
}

function freeTower(state, s) {
  const ps = state.placed;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.type !== 'tower' || p.ruined) continue;
    let taken = false;
    for (let k = 0; k < state.defense.soldiers.length; k++) if (state.defense.soldiers[k].towerId === p.id) { taken = true; break; }
    if (!taken) return p;
  }
  return null;
}

/** Bir dakika. @returns {boolean} asker durumu (state/towerId) değişti mi */
export function stepSoldiers(state, bus, ctx, minOfDay) {
  const D = state.defense, ss = D.soldiers, ms = D.monsters;
  const night = inPatrolWindow(minOfDay);
  let changed = false;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i], def = SOLDIERS[s.type];
    if (!def || s.state === 'down') continue;
    const active = night && s.duty;
    if (!active) {
      if (s.state === 'sleep') continue;
      if (s.towerId) s.towerId = null;
      if (moveTo(s, homeU(i), HOME_V, def.speed)) { s.state = 'sleep'; changed = true; }
      continue;
    }
    if (s.state === 'sleep') { s.state = 'patrol'; changed = true; }
    // okçu → boş kule
    if (def.towerBonus) {
      if (s.towerId) {
        const t = state.placed.find((p) => p.id === s.towerId);
        if (!t || t.ruined) { s.towerId = null; changed = true; }
      }
      if (!s.towerId) { const t = freeTower(state, s); if (t) { s.towerId = t.id; changed = true; } }
      if (s.towerId) {
        const t = state.placed.find((p) => p.id === s.towerId);
        const arrived = moveTo(s, t.tx + DEFENSES.tower.w / 2, t.ty + DEFENSES.tower.h / 2, def.speed);
        let busy = false;
        if (arrived) for (let k = 0; k < ms.length; k++) {
          const du = ms[k].x / TILE_W - s.x / TILE_W, dv = ms[k].y / TILE_H - s.y / TILE_H;
          if (ms[k].hp > 0 && du * du + dv * dv <= DEFENSES.tower.range ** 2) { busy = true; break; }
        }
        const ns = busy ? 'fight' : 'patrol';
        if (s.state !== ns) { s.state = ns; changed = true; }
        continue;
      }
    }
    // en yakın canavar
    let best = -1, bd = SIGHT * SIGHT;
    for (let k = 0; k < ms.length; k++) {
      if (ms[k].hp <= 0) continue;
      const du = ms[k].x / TILE_W - s.x / TILE_W, dv = ms[k].y / TILE_H - s.y / TILE_H, q = du * du + dv * dv;
      if (q < bd) { bd = q; best = k; }
    }
    if (best >= 0) {
      const m = ms[best], mu = m.x / TILE_W, mv = m.y / TILE_H;
      const d = Math.sqrt(bd);
      if (d <= def.range) {
        m.hp -= def.dmg * def.rate;
        if (s.state !== 'fight') { s.state = 'fight'; changed = true; }
        bus.emit('defense:hit', { x: m.x, y: m.y, kind: def.look === 'bow' ? 'arrow' : 'melee', from: s.id });
      } else {
        moveTo(s, mu, mv, def.speed);
        if (s.state !== 'fight') { s.state = 'fight'; changed = true; }
      }
      continue;
    }
    // devriye: evin çevresinde rastgele noktalar
    if (s.state !== 'patrol') { s.state = 'patrol'; changed = true; }
    if (!s.wu || moveTo(s, s.wu, s.wv, def.speed * 0.6)) {
      for (let tries = 0; tries < 6; tries++) {
        const u = HOUSE_U + ctx.rng.range(-8, 8), v = 9 + ctx.rng.range(-5, 7);
        const cx = Math.floor(u), cy = Math.floor(v);
        if (cx < 0 || cy < 0 || cx >= GW || cy >= GH || blocked[cy * GW + cx]) continue;
        s.wu = u; s.wv = v; break;
      }
    }
  }
  return changed;
}
