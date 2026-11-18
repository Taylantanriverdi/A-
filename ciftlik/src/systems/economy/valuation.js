// Varlık değerleme — SAF (state'e yazmaz). PLAN §13.
// net varlık = para (+alacaklar) + yapılar×0.6 + hayvanlar×0.7 + envanter×0.8 − kalan borç
import { VALUATION } from '../../data/economy.js';
import { PLACEABLES } from '../../data/placeables.js';
import { ANIMALS } from '../../data/animals.js';
import { ITEMS } from '../../data/items.js';
import { QUALITY } from '../../data/farming.js';
import { currentPrice, isSellable } from '../market/pricing.js';

/** @returns {{money:number, buildings:number, animals:number, inventory:number, debt:number}} (tam ₺) */
export function assetBreakdown(state) {
  let money = Number(state?.finance?.money) || 0;
  for (const r of state?.finance?.receivables || []) money += Number(r.amount) || 0;
  let buildings = 0;
  for (const p of state?.placed || []) buildings += (PLACEABLES[p?.type]?.price || 0) * VALUATION.buildingPct;
  let animals = 0;
  for (const a of state?.animals || []) {
    if (a?.type === 'bee') continue; // kovan fiyatına dahil (yapı olarak sayılır)
    animals += (ANIMALS[a?.type]?.price || 0) * VALUATION.animalPct;
  }
  let inventory = 0;
  for (const [id, stacks] of Object.entries(state?.inventory?.items || {})) {
    const it = ITEMS[id];
    if (!it || !Array.isArray(stacks)) continue;
    const sellable = isSellable(id);
    const unit = sellable ? currentPrice(state, id) : (it.price || 0);
    for (const s of stacks) {
      const qm = sellable ? (QUALITY.priceMult[s.q] ?? 1) * (s.organic ? 1 + QUALITY.organicBonus : 1) : 1;
      inventory += unit * qm * (Number(s.qty) || 0) * VALUATION.inventoryAtMarket;
    }
  }
  let debt = 0;
  for (const l of state?.finance?.loans || []) debt += (Number(l.remaining) || 0) + (Number(l.arrears) || 0);
  return { money, buildings: Math.round(buildings), animals: Math.round(animals), inventory: Math.round(inventory), debt: Math.round(debt) };
}

export function netWorth(state) {
  const b = assetBreakdown(state);
  return b.money + b.buildings + b.animals + b.inventory - b.debt;
}
