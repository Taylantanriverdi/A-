// STUB — economy-dev gerçek uygulamayla değiştirecek. İmzalar PLAN.md §9.
import { CROPS } from '../../data/crops.js';
export function currentPrice(state, itemId, now) { return Math.round((CROPS[itemId]?.basePrice ?? 0) * 0.85); }
export function quote(state, { itemId, q = 'B', organic = false, qty = 1, channel = 'market' }, now) {
  const unit = currentPrice(state, itemId, now);
  return { ok: true, unit, total: unit * qty, avg: unit, limitLeft: 40, minLot: channel === 'wholesale' ? 50 : 1 };
}
export function trend(state, itemId) { return { change: 0, history: [] }; }
