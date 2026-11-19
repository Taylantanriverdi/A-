// GameState — PLAN.md §1 şeması. Saf JSON: sınıf örneği, fonksiyon, Phaser nesnesi YOK.
import { START_MINUTES, SAVE_VERSION, TILE_W, TILE_H } from './constants.js';
import { START_MONEY } from '../data/economy.js';
import { INVENTORY } from '../data/progression.js';
import { DONKEY } from '../data/workers.js';
import { DAMAGE } from '../data/defense.js';

/** Arazi parselleri (sahiplik). Fiyat/kilit değerleri data/land.js'e aittir. */
import { PARCELS } from '../data/land.js';
const PARCEL_IDS = Object.keys(PARCELS); // K25: parseller data/land.js'ten

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
    // PLAN §9: xp = mevcut seviyedeki XP, totalXp = toplam
    player: { name: 'Çiftçi', level: 1, xp: 0, totalXp: 0, reputation: 10 },
    finance: { money: START_MONEY, ledger: [], loans: [], dailySummary: [], receivables: [], bankLates: 0, seasonSummary: [] },
    inventory: { capacity: INVENTORY.startSlots, items: {} }, // kapasite = yığın sayısı
    land: { parcels: PARCEL_IDS.map((id) => ({ id, owned: id === 'P1' })) },
    tiles: {},
    animals: [],
    buildings: [],
    machines: [],
    placed: [],        // PLAN §12: [{id,type,tx,ty}]
    removedDecor: [],  // temizlenen ağaç/çalı kimlikleri
    workers: [],
    vehicles: [],      // PLAN §15: [{id,type,garageId,condition}]
    donkey: { x: (DONKEY.homeTile.tx + 0.5) * TILE_W, y: (DONKEY.homeTile.ty + 0.5) * TILE_H, mode: 'home' }, // PLAN §11
    market: { prices: {}, history: {}, activeEvents: [] },
    contracts: { offers: [], active: [], history: [] }, // PLAN §13
    stats: { harvested: {}, sold: {}, earned: 0, spent: 0 },
    settings: { quality: 'auto', sound: 0.8, music: 0.5, raids: false }, // raids: Gece İstilası modu (PLAN §16)
    defense: {         // PLAN §16 (+ iç alanlar: active, endAt, pending, waveSize, reportPending, trampled, nightDamaged, nightKills, nightLoot, houseHpStart, hpInit)
      nightPlanned: false, bloodMoon: false, active: false, wave: 0, wavesLeft: 0, waveSize: 0, pending: 0, nextWaveMin: null, endAt: 0,
      reportPending: false, houseHp: DAMAGE.houseHp, houseMax: DAMAGE.houseHp, houseHpStart: DAMAGE.houseHp,
      monsters: [], monsterSeq: 0, soldiers: [], trampled: [], nightDamaged: [], nightKills: 0, nightLoot: 0, hpInit: false,
      stats: { nights: 0, kills: 0, lootTotal: 0 }, lastReport: null,
    },
    flags: {}, // tek seferlik bayraklar (ör. farmInitialized, firstHarvest:{potato:true}) — sistemler yazar
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
