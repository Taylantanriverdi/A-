// GameState — PLAN.md §1 şeması. Saf JSON: sınıf örneği, fonksiyon, Phaser nesnesi YOK.
import { START_MINUTES, SAVE_VERSION } from './constants.js';

/** Arazi parselleri (sahiplik). Fiyat/kilit değerleri data/land.js'e aittir. */
const PARCEL_IDS = ['P1', 'P2', 'P3', 'P4', 'P5'];

function randomSeed() {
  // 32-bit pozitif tohum
  return (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0x7fffffff)) >>> 0 || 123456;
}

/**
 * Yeni oyun durumu üretir.
 * @param {number} [seed]
 */
export function createInitialState(seed = randomSeed()) {
  return {
    version: SAVE_VERSION,
    rngSeed: seed,
    rngState: seed | 0, // mulberry32 iç durumu (Rng.js yazar) — kayıt sonrası tekrarlanabilirlik
    time: { totalMinutes: START_MINUTES, speed: 1 },
    weather: { type: 'clear', intensity: 0, wind: 0.2, forecast: [], puddles: 0, snowCover: 0 },
    player: { name: 'Çiftçi', level: 1, xp: 0, reputation: 10 },
    finance: { money: 5000, ledger: [], loans: [], dailySummary: [] },
    inventory: { capacity: 60, items: {} },
    land: { parcels: PARCEL_IDS.map((id) => ({ id, owned: id === 'P1' })) },
    tiles: {},
    animals: [],
    buildings: [],
    machines: [],
    workers: [],
    market: { prices: {}, activeEvents: [] },
    contracts: [],
    stats: { harvested: {}, sold: {}, earned: 0, spent: 0 },
    settings: { quality: 'auto', sound: 0.8, music: 0.5 },
    camera: null, // {x, y, zoom} — CameraDirector yazar
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Eksik alanları varsayılanlarla tamamlar (yüklenen/migrate edilen kayıt için).
 * Yalnızca düz nesnelerde derine iner; dizilere ve mevcut değerlere dokunmaz.
 */
export function fillDefaults(target, defaults) {
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    if (!(k in target) || target[k] === undefined) {
      target[k] = d;
    } else if (isPlainObject(d) && isPlainObject(target[k])) {
      fillDefaults(target[k], d);
    }
  }
  return target;
}
