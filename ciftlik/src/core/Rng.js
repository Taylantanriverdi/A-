// Tohumlu rastgele — mulberry32. İç durum state.rngState'te tutulur (kayıtla birlikte saklanır).

/**
 * @param {{rngSeed:number, rngState?:number}} state
 */
export function createRng(state) {
  if (!Number.isFinite(state.rngState)) state.rngState = (state.rngSeed | 0) || 123456;
  const rng = {
    /** [0,1) */
    next() {
      let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** [min,max) ondalık */
    range(min, max) { return min + (max - min) * rng.next(); },
    /** [min,max] tam sayı */
    int(min, max) { return min + Math.floor(rng.next() * (max - min + 1)); },
    /** olasılık p ile true */
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr.length ? arr[Math.floor(rng.next() * arr.length)] : undefined; },
  };
  return rng;
}

export default createRng;
