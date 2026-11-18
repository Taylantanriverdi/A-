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
 * Eksik ve tipi bozuk alanları varsayılanlarla onarır (yüklenen/migrate edilen kayıt için).
 * Kurallar (varsayılanın tipine göre):
 *  - düz nesne → hedef düz nesne değilse varsayılanla değiştirilir, değilse derine inilir;
 *  - dizi → hedef dizi değilse varsayılan;
 *  - sayı → sonlu sayı değilse varsayılan; string/boolean → aynı tip değilse varsayılan;
 *  - null varsayılan (ör. camera) → olduğu gibi bırakılır (özel doğrulama çağıranın işi).
 * Varsayılanda olmayan ek anahtarlara dokunulmaz.
 * @param {object} target
 * @param {object} defaults
 * @param {(path:string)=>void} [onFix] onarılan her alan için çağrılır
 * @param {string} [path]
 */
export function fillDefaults(target, defaults, onFix, path = '') {
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    const v = target[k];
    const p = path ? `${path}.${k}` : k;
    let ok;
    if (d === null) ok = true;
    else if (isPlainObject(d)) ok = isPlainObject(v);
    else if (Array.isArray(d)) ok = Array.isArray(v);
    else if (typeof d === 'number') ok = typeof v === 'number' && Number.isFinite(v);
    else ok = typeof v === typeof d;
    if (!ok) {
      if (k in target && onFix) onFix(p);
      target[k] = d;
    } else if (isPlainObject(d)) {
      fillDefaults(v, d, onFix, p);
    }
  }
  return target;
}

export { isPlainObject };
