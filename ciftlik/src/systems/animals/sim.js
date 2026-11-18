// Hayvancılık simülasyonu — saf yardımcılar (state, ...) → değişiklik. Phaser/bus bağımlılığı yok.
// Denge değerleri data/animals.js ve data/buildings.js'ten gelir.
import { ANIMALS, CARE, VET, ANIMAL_PRODUCTS } from '../../data/animals.js';
import { BUILDINGS, TROUGH } from '../../data/buildings.js';
import { pickName } from './names.js';

export const BOX_MAX = 60;       // kutuda ürün başına en fazla adet (teknik sınır; dolunca üretim durur)
export const MIN_HEALTH = 5;     // sağlık bunun altına inmez (ölüm yok)
export const NEW_HAPPINESS = 70;
const EPS = 1e-6;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function lotOf(lotId) {
  for (const type in BUILDINGS) {
    const lot = BUILDINGS[type].lots.find((l) => l.id === lotId);
    if (lot) return { type, lot };
  }
  return null;
}
export const buildingId = (lotId) => `b_${lotId}`;
export const buildingOf = (state, id) => state.buildings.find((b) => b.id === id) || null;
export const animalsIn = (state, bid) => state.animals.filter((a) => a.buildingId === bid);

export function newBuilding(type, lotId, day) {
  return { id: buildingId(lotId), type, lotId, builtDay: day, dirt: 0, trough: { feed: 0, water: 0 }, box: {} };
}

export function newAnimal(state, type, bid, rng, adult) {
  const def = ANIMALS[type];
  const seq = (Number(state.flags.animalSeq) || 0) + 1;
  state.flags.animalSeq = seq;
  const taken = new Set(animalsIn(state, bid).map((a) => a.name));
  return {
    id: `a${seq}`, type, name: pickName(rng, type, taken), buildingId: bid,
    ageDays: adult ? def.adultDays : 0, hunger: 100, thirst: 100, health: 100, happiness: NEW_HAPPINESS,
    sick: false, pettedDay: -1, productTimer: 0,
  };
}

/** Günlük yem ihtiyacı (porsiyon): binadaki hayvanların perDay toplamı. */
export function feedNeedPerDay(list) {
  let n = 0;
  for (const a of list) { const f = ANIMALS[a.type]?.feed; if (f) n += f.perDay; }
  return n;
}

/** Bu bina için kabul edilen yem eşyaları → porsiyon değeri. */
export function acceptedFeed(list) {
  const out = {};
  for (const a of list) {
    const d = ANIMALS[a.type];
    if (!d?.feed) continue;
    out[d.feed.itemId] = out[d.feed.itemId] || 1;
    if (d.altFeed) for (const k in d.altFeed) out[k] = Math.max(out[k] || 0, d.altFeed[k]);
  }
  return out;
}

export const troughCap = (list) => feedNeedPerDay(list) * TROUGH.feedDaysMax;

/** Saatlik adım: yemlik/suluk tüketimi, açlık/susuzluk/sağlık. */
export function hourStep(b, list) {
  if (!list.length) return;
  const need = feedNeedPerDay(list) / 24;
  const fed = need <= 0 || b.trough.feed + EPS >= need;
  if (need > 0) b.trough.feed = Math.max(0, b.trough.feed - need);
  const watered = b.trough.water + EPS >= 1 / 24;
  b.trough.water = Math.max(0, b.trough.water - 1 / 24);
  for (const a of list) {
    const needsFood = !!ANIMALS[a.type]?.feed;
    if (needsFood) {
      a.hunger = clamp(a.hunger + (fed ? CARE.recoverPerHour : -CARE.hungerPerHourEmpty), 0, 100);
      a.thirst = clamp(a.thirst + (watered ? CARE.recoverPerHour : -CARE.thirstPerHourEmpty), 0, 100);
    }
    const low = a.hunger < CARE.lowThreshold || a.thirst < CARE.lowThreshold;
    let dh = 0;
    if (low) dh -= CARE.healthLossPerHour;
    if (a.sick) dh -= CARE.sickHealthPerHour;
    if (dh === 0) dh = CARE.healthLossPerHour * 0.5; // bakımlıyken yavaş toparlanma
    a.health = clamp(a.health + dh, MIN_HEALTH, 100);
  }
}

export const isOld = (a) => {
  const d = ANIMALS[a.type];
  return Number.isFinite(d.lifeDays) && a.ageDays > d.lifeDays * d.oldAt;
};
export const isAdult = (a) => a.ageDays >= ANIMALS[a.type].adultDays;
export const canProduce = (a) => !a.sick && a.hunger > CARE.minForProduction && a.thirst > CARE.minForProduction && a.health > CARE.minForProduction;
export const qualityFor = (happiness) => (happiness >= CARE.productQuality.A ? 'A' : happiness >= CARE.productQuality.B ? 'B' : 'C');

export function boxCount(b, itemId) {
  const arr = b.box[itemId];
  let n = 0;
  if (arr) for (const s of arr) n += s.qty;
  return n;
}
export function boxAdd(b, itemId, q, qty) {
  const arr = b.box[itemId] || (b.box[itemId] = []);
  const s = arr.find((x) => x.q === q);
  if (s) s.qty += qty; else arr.push({ q, qty });
}

/** Ayçiçeği çiçek bonusu için canlı bitki sayısı. */
export function countCrop(state, cropId) {
  let n = 0;
  for (const k in state.tiles) { const c = state.tiles[k]?.crop; if (c && c.id === cropId && !c.dead) n++; }
  return n;
}

/**
 * Günlük adım (tek bina): kir, hastalık, yaş, mutluluk, üretim, üreme.
 * @returns {{produced:Array, born:Array}}
 */
export function dayStep(state, b, list, ctx, today) {
  const out = { produced: [], born: [] };
  const kind = BUILDINGS[b.type]?.kind || b.type;
  b.dirt = clamp(b.dirt + (CARE.dirtPerDay[kind] || 0), 0, 100);
  const winter = ctx.now.season === 'winter';
  let flowers = -1;
  for (const a of list) {
    const def = ANIMALS[a.type];
    a.ageDays++;
    if (b.dirt > 60 && !a.sick && ctx.rng.chance(CARE.sickChanceDaily)) a.sick = true;
    // mutluluk: beslenme, su, temizlik, sevme, sağlık → hedef; yarıya kadar yaklaş
    const petted = a.pettedDay === today - 1 ? 1 : 0;
    const target = 25 * (a.hunger / 100) + 20 * (a.thirst / 100) + 20 * (1 - b.dirt / 100) + 15 * petted + 20 * (a.health / 100) - (a.sick ? 15 : 0);
    a.happiness = clamp(a.happiness + (target - a.happiness) * 0.5, 0, 100);
    // üretim
    if (!isAdult(a) || !canProduce(a)) continue;
    if (def.noWinter && winter) continue;
    const prod = def.product;
    if (boxCount(b, prod.itemId) >= BOX_MAX) continue;
    a.productTimer += 1;
    if (a.productTimer + EPS < prod.intervalDays) continue;
    a.productTimer = 0;
    let qty = prod.qty;
    if (def.flowerBonus) {
      if (flowers < 0) flowers = Math.max(...def.flowerBonus.crops.map((c) => countCrop(state, c)));
      if (flowers >= def.flowerBonus.minPlants) {
        const x = qty * def.flowerBonus.mult;
        qty = Math.floor(x) + (ctx.rng.chance(x - Math.floor(x)) ? 1 : 0);
      }
    }
    if (isOld(a) && qty > 0) { let k = 0; for (let i = 0; i < qty; i++) if (ctx.rng.chance(0.5)) k++; qty = k; }
    if (qty <= 0) continue;
    const q = qualityFor(a.happiness);
    boxAdd(b, prod.itemId, q, qty);
    out.produced.push({ itemId: prod.itemId, q, qty });
  }
  // üreme: tür başına günde en fazla bir yavru
  const cap = BUILDINGS[b.type]?.capacity || 0;
  let count = list.length;
  const types = new Set(list.map((a) => a.type));
  for (const t of types) {
    const def = ANIMALS[t];
    if (!(def.breedChance > 0) || count >= cap) continue;
    const parents = list.filter((a) => a.type === t && isAdult(a) && !a.sick);
    if (parents.length < 2) continue;
    const mood = parents.reduce((s, a) => s + a.happiness, 0) / parents.length;
    if (mood > 80 && ctx.rng.chance(def.breedChance)) {
      const baby = newAnimal(state, t, b.id, ctx.rng, false);
      state.animals.push(baby);
      out.born.push(baby);
      count++;
    }
  }
  return out;
}

export { VET, ANIMAL_PRODUCTS, TROUGH };
