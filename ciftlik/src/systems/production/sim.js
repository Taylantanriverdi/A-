// Üretim simülasyonu yardımcıları — saf/küçük fonksiyonlar (PLAN §11). Phaser import ETMEZ.
import { MACHINES, MACHINE_RULES, RECIPES } from '../../data/recipes.js';
import { ITEMS } from '../../data/items.js';
import { currentPrice } from '../market/pricing.js';

export const QRANK = { C: 0, B: 1, A: 2 };
const QLIST = ['C', 'B', 'A'];

export const machineIdOf = (type) => `m_${type}`;

/** id ('m_dairy') veya tür ('dairy') ile makine bul. */
export function machineOf(state, idOrType) {
  if (typeof idOrType !== 'string') return null;
  const type = idOrType.startsWith('m_') ? idOrType.slice(2) : idOrType;
  return state.machines.find((m) => m.type === type) || null;
}

export function newMachine(type, day) {
  return { id: machineIdOf(type), type, builtDay: day, condition: 100, queue: [], output: {}, auto: null };
}

export const recipesOf = (type) => Object.keys(RECIPES).filter((id) => RECIPES[id].machine === type);

/** İş süresi (oyun dakikası), condition etkisiyle. */
export function durationMin(recipeId, condition) {
  const r = RECIPES[recipeId];
  const slow = condition < MACHINE_RULES.slowBelow ? MACHINE_RULES.slowMult : 1;
  return Math.max(1, Math.round(r.hours * 60 * slow));
}

export const isStopped = (m) => m.condition < MACHINE_RULES.stopBelow;
export const repairCost = (type) => Math.round(MACHINES[type].price * MACHINE_RULES.maintenancePct);
export const powerCost = (recipeId) => Math.round(RECIPES[recipeId].kwh * MACHINE_RULES.kwhPrice);

/** Girdi için envanterde yeterli var mı (adet olarak eksik olan ilk madde). */
export function missingInput(state, recipeId, count) {
  const r = RECIPES[recipeId];
  for (const id of Object.keys(r.in)) if (count(state, id) < r.in[id]) return id;
  return null;
}

/** Çıktı kutusundan toplam adet. */
export function outputCount(m) {
  let n = 0;
  for (const id in m.output) for (const s of m.output[id]) n += s.qty;
  return n;
}

export function addOutput(m, itemId, qty, q, organic) {
  const arr = m.output[itemId] || (m.output[itemId] = []);
  const hit = arr.find((s) => s.q === q && !!s.organic === !!organic);
  if (hit) hit.qty += qty; else arr.push({ q, organic: !!organic, qty });
}

/** Tarif ekonomisi (birim ₺; pazar fiyatı, B kalite): girdi değeri, çıktı değeri, elektrik, kâr. */
export function recipeEconomics(state, recipeId, now) {
  const r = RECIPES[recipeId];
  const val = (id) => currentPrice(state, id, now) || Math.round(ITEMS[id]?.basePrice || 0);
  let inValue = 0, outValue = 0;
  for (const id in r.in) inValue += val(id) * r.in[id];
  for (const id in r.out) outValue += val(id) * r.out[id];
  const power = powerCost(recipeId);
  return { inValue, outValue, power, profit: outValue - inValue - power };
}
