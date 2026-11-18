// Hava/olay hasarı — saf fonksiyon (PLAN §14). Rastgelelik yalnızca verilen rng.
import { CROPS } from '../../data/crops.js';

/**
 * Açık alandaki canlı ekinlere hasar verir (karo başına `chance`). onlyNonHardy: frostHardy ekinler etkilenmez.
 * @returns {number} etkilenen karo sayısı; `out`a karo kimlikleri eklenir
 */
export function damageCrops(tiles, rng, { chance = 1, damage = 0, onlyNonHardy = false }, out) {
  let n = 0;
  for (const key in tiles) {
    const c = tiles[key].crop;
    if (c === null || c === undefined || c.dead) continue;
    const def = CROPS[c.id];
    if (!def) continue;
    if (onlyNonHardy && def.frostHardy) continue;
    if (chance < 1 && rng.next() >= chance) continue;
    c.health -= damage;
    if (c.health <= 0) { c.health = 0; c.dead = true; }
    if (out) out.push(key);
    n++;
  }
  return n;
}
