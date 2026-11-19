// Savaş yardımcıları — PLAN §16. Saf: state üzerinde çalışır, Phaser yok, bus yalnızca verilirse kullanılır.
import { PLACEABLES } from '../../data/placeables.js';
import { DEFENSES, DAMAGE } from '../../data/defense.js';
import { TILE_W, TILE_H } from '../../core/constants.js';
import * as occ from '../world/occupancy.js';
import { isBreakable } from './monsterGrid.js';

/** Yapının azami canı (tuzakta: kullanım sayısı). 0 → canı yok (patika). */
export function maxHpOf(type) {
  const d = DEFENSES[type];
  if (d) return d.trap ? d.uses : d.hp;
  const def = PLACEABLES[type];
  if (!def || def.walkable) return 0;
  return Math.max(DAMAGE.minBuildingHp, Math.round(def.price * DAMAGE.buildingHpPerPrice));
}

/** Eksik hp/maxHp/ruined alanlarını doldurur. @returns {boolean} değişti mi */
export function initHp(p) {
  const m = maxHpOf(p.type);
  if (!m) return false;
  let ch = false;
  if (!Number.isFinite(p.maxHp) || p.maxHp !== m) { p.maxHp = m; ch = true; }
  if (!Number.isFinite(p.hp)) { p.hp = m; ch = true; }
  if (p.hp > m) { p.hp = m; ch = true; }
  if (typeof p.ruined !== 'boolean') { p.ruined = false; ch = true; }
  return ch;
}

/** Yapıya hasar. Tuzakta amount kullanım sayısıdır. @returns {boolean} bu darbeyle harap oldu mu */
export function hurt(state, p, amount) {
  if (p.ruined) return false;
  if (!Number.isFinite(p.hp)) initHp(p);
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp > 0) return false;
  p.ruined = true;
  if (isBreakable(p.type)) occ.invalidate(state); // harap çit/duvar geçilebilir olur
  return true;
}

/** Onarım bedeli (₺). Saf. Harap: price×repairPct; hasarlı: price×repairPct×(1−hp/maxHp); hasar yoksa 0; asgari 1 ₺. */
export function repairCost(state, p) {
  const def = p && PLACEABLES[p.type];
  if (!def || !(p.maxHp > 0)) return 0;
  const frac = p.ruined ? 1 : 1 - Math.max(0, Math.min(1, p.hp / p.maxHp));
  if (frac <= 0) return 0;
  return Math.max(1, Math.round(def.price * DAMAGE.repairPct * (p.ruined ? 1 : frac)));
}

/** Tam onarım (hp, ruined). */
export function applyRepair(state, p) {
  const was = p.ruined;
  p.hp = p.maxHp; p.ruined = false;
  if (was && isBreakable(p.type)) occ.invalidate(state);
}

/** Ev onarım bedeli. */
export const houseRepairCost = (D) => Math.max(0, Math.round((D.houseMax - D.houseHp) * DAMAGE.houseRepairPerHp));

/** Kulenin dünya-karo (u,v) merkezi. */
export const centerU = (p, def) => p.tx + def.w / 2;
export const centerV = (p, def) => p.ty + def.h / 2;

/**
 * Kuleler: her kule menzildeki en yakın canavara dmg×rate (içinde okçu varsa × mannedMult). Yalnızca hp düşürür.
 * @returns {number} ateş eden kule sayısı
 */
export function towersFire(state, bus) {
  const D = state.defense, ms = D.monsters, ps = state.placed, ss = D.soldiers;
  let shots = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const d = DEFENSES[p.type];
    if (!d || !d.range || p.ruined) continue;
    const cu = p.tx + d.w / 2, cv = p.ty + d.h / 2;
    let best = -1, bd = d.range * d.range;
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      if (m.hp <= 0) continue;
      const du = m.x / TILE_W - cu, dv = m.y / TILE_H - cv, q = du * du + dv * dv;
      if (q <= bd) { bd = q; best = k; }
    }
    if (best < 0) continue;
    let mult = 1;
    for (let k = 0; k < ss.length; k++) if (ss[k].towerId === p.id && ss[k].state !== 'down' && ss[k].duty) { mult = d.mannedMult; break; }
    const m = ms[best];
    m.hp -= d.dmg * d.rate * mult;
    shots++;
    bus.emit('defense:hit', { x: m.x, y: m.y, kind: 'arrow', from: p.id });
  }
  return shots;
}
