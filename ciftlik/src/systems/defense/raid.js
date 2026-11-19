// Baskın takvimi ve dalga doğurma — PLAN §16. Rastgelelik yalnızca ctx.rng.
import { RAID_SCHEDULE, WAVES, MONSTERS } from '../../data/defense.js';
import { TILE_W, TILE_H } from '../../core/constants.js';
import { spawnCells, GW } from './monsterGrid.js';

export const isBloodMoon = (day) => day >= RAID_SCHEDULE.firstDay && day % RAID_SCHEDULE.bloodMoonEvery === 0;
export const raidChance = (day) => Math.min(RAID_SCHEDULE.maxChance, RAID_SCHEDULE.baseChance + day * RAID_SCHEDULE.chancePerDay);

/** 19:00 kararı. @returns {null|{bloodMoon:boolean}} */
export function decide(day, rng) {
  if (day < RAID_SCHEDULE.firstDay) return null;
  if (isBloodMoon(day)) return { bloodMoon: true };
  return rng.chance(raidChance(day)) ? { bloodMoon: false } : null;
}

/** Dalga başına canavar sayısı. */
export function waveSize(day, bloodMoon) {
  const n = Math.min(WAVES.max, WAVES.base + day * WAVES.perDay);
  return Math.max(1, Math.round(n * (bloodMoon ? RAID_SCHEDULE.bloodMoonMult : 1)));
}

const TYPES = Object.keys(MONSTERS);
function pickType(rng, day) {
  let tot = 0;
  for (let i = 0; i < TYPES.length; i++) { const d = MONSTERS[TYPES[i]]; if (day >= d.minDay) tot += d.weight; }
  let r = rng.next() * tot;
  for (let i = 0; i < TYPES.length; i++) {
    const d = MONSTERS[TYPES[i]];
    if (day < d.minDay) continue;
    if ((r -= d.weight) < 0) return TYPES[i];
  }
  return 'zombie';
}

/** Bir dalgayı arazi dışı karolarda doğurur (bir küme noktası etrafında). @returns {number} doğan sayı */
export function spawnWave(state, bus, ctx, day) {
  const D = state.defense, cells = spawnCells(state);
  if (!cells.length) return 0;
  const n = D.waveSize;
  const base = cells[ctx.rng.int(0, cells.length - 1)];
  const bu = base % GW, bv = (base / GW) | 0;
  let near = cells.filter((c) => Math.abs((c % GW) - bu) <= 3 && Math.abs(((c / GW) | 0) - bv) <= 3);
  if (!near.length) near = cells;
  const seq = (D.monsterSeq = (D.monsterSeq || 0));
  for (let i = 0; i < n; i++) {
    const type = pickType(ctx.rng, day);
    const c = near[ctx.rng.int(0, near.length - 1)];
    const def = MONSTERS[type];
    const m = {
      id: `m${seq + i + 1}`, type, x: ((c % GW) + 0.5) * TILE_W, y: (((c / GW) | 0) + 0.5) * TILE_H,
      hp: def.hp, maxHp: def.hp, targetId: null, state: 'walk', path: null, pi: 0, tg: -1, reach: 1, wait: 0, fl: 0,
    };
    D.monsters.push(m);
    bus.emit('monster:spawned', { id: m.id, type, x: m.x, y: m.y });
  }
  D.monsterSeq = seq + n;
  return n;
}
