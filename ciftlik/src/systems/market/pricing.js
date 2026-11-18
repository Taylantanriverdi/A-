// Fiyat hesabı — PLAN.md §4 "Pazar ve dinamik fiyat", §9 "Fiyat formülü". SAF: state'e YAZMAZ.
// UI (pazar paneli) ve MarketSystem birlikte kullanır.
//
// birim = crops.basePrice × seasonMult(crop, season) × olay × doygunluk × gürültü
//         × QUALITY.priceMult[q] × (organic ? 1 + QUALITY.organicBonus : 1) × CHANNELS[kanal].mult
// Bir satışta her birim doygunluğu ×(1 − perUnit[kanal]) düşürür (alt sınır SATURATION.min);
// toplam = birimlerin sırayla toplamı (ilk birim en pahalı), tam ₺'ye yuvarlanır.
import { CROPS } from '../../data/crops.js';
import { ITEMS } from '../../data/items.js';
import { QUALITY } from '../../data/farming.js';
import { CHANNELS, SATURATION, seasonMult } from '../../data/economy.js';
import { calendar } from '../../core/timeUtils.js';
import { count } from '../InventorySystem.js';

const LOC_DIGIT = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'];
const LOC_TENS = ['', 'da', 'de', 'da', 'ta', 'de', 'ta', 'te', 'de', 'da'];
/** Sayıya Türkçe bulunma eki: 1'de, 3'te, 6'da, 10'da, 20'de. */
export function numLoc(n) {
  const v = Math.abs(Math.floor(n));
  const d = v % 10;
  const suf = d ? LOC_DIGIT[d] : v % 100 ? LOC_TENS[(v % 100) / 10] : v ? 'de' : 'da';
  return `${v}'${suf}`;
}

export const REASONS = {
  notSellable: 'Bu ürün satılamaz',
  badQty: 'Geçersiz adet',
  badChannel: 'Geçersiz satış kanalı',
  notEnough: 'Envanterde yeterli yok',
  limitReached: (lim) => `Bugünkü pazar limiti doldu (${lim})`,
  limitLeft: (left) => `Bugün bu üründen en fazla ${left} birim daha satabilirsin`,
  minLot: (n) => `Toptancı en az ${n} birim alır`,
  channelLocked: (name, lvl) => `${name} Seviye ${numLoc(lvl)} açılır`,
};

const DEFAULT_ENTRY = Object.freeze({ saturation: 1, noise: 1, soldToday: 0 });

/** Satılabilir mi? (Aşama 3: yalnızca category 'crop') */
export function isSellable(itemId) {
  const it = ITEMS[itemId];
  return !!it && ((it.category === 'crop' && !!CROPS[it.crop]) || it.category === 'animal'); // Aşama 4: hayvan ürünleri
}

/** Ürünün pazar durumu (yoksa varsayılan, salt okunur). */
export function priceEntry(state, itemId) {
  const e = state?.market?.prices?.[itemId];
  return e && typeof e === 'object' ? e : DEFAULT_ENTRY;
}

/** Aktif olay çarpanı (Aşama 7: activeEvents [{ itemId, mult }]); şimdilik çoğunlukla 1. */
export function eventMult(state, itemId) {
  const evs = state?.market?.activeEvents;
  if (!Array.isArray(evs) || evs.length === 0) return 1;
  let m = 1;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e && e.itemId === itemId && typeof e.mult === 'number' && Number.isFinite(e.mult) && e.mult > 0) m *= e.mult;
  }
  return m;
}

function nowOf(state, now) {
  return now && typeof now.season === 'string' ? now : calendar(state?.time?.totalMinutes ?? 0);
}

/**
 * Doygunluk HARİÇ birim fiyat (ondalık). Doygunluk çarpanı ayrıca uygulanır.
 */
export function unitBeforeSaturation(state, itemId, q = 'B', organic = false, channel = 'market', now) {
  const it = ITEMS[itemId];
  const crop = it && CROPS[it.crop];
  const ch = CHANNELS[channel];
  if (!ch || !isSellable(itemId)) return 0;
  const base = crop ? crop.basePrice : it.basePrice;              // hayvan ürünleri: ITEMS basePrice
  const sm = crop ? seasonMult(it.crop, nowOf(state, now).season) : 1; // hayvan ürünlerinde mevsim çarpanı yok
  const n = nowOf(state, now);
  const e = priceEntry(state, itemId);
  const qm = QUALITY.priceMult[q] ?? QUALITY.priceMult.B;
  const om = organic === true ? 1 + QUALITY.organicBonus : 1;
  return base * sm * eventMult(state, itemId) * e.noise * qm * om * ch.mult;
}

/** Şu anki B kalite, organik olmayan, pazar yeri birim fiyatı (tam ₺). */
export function currentPrice(state, itemId, now) {
  if (!isSellable(itemId)) return 0;
  const e = priceEntry(state, itemId);
  return Math.round(unitBeforeSaturation(state, itemId, 'B', false, 'market', now) * e.saturation);
}

/** Bir satışın birim birim toplamı (ondalık) ve son doygunluk. */
export function saleSum(base, saturation, perUnit, qty) {
  let sat = saturation;
  let sum = 0;
  const k = 1 - perUnit;
  for (let i = 0; i < qty; i++) {
    sum += base * sat;
    sat *= k;
    if (sat < SATURATION.min) sat = SATURATION.min;
  }
  return { sum, saturation: sat };
}

/** qty birim satıldıktan sonraki doygunluk. */
export function saturationAfter(saturation, channel, qty) {
  const p = SATURATION.perUnit[channel] ?? SATURATION.perUnit.market;
  const s = saturation * Math.pow(1 - p, Math.max(0, qty));
  return s < SATURATION.min ? SATURATION.min : s;
}

/**
 * Satış teklifi. Ret olsa da unit/total/avg hesaplanır (UI gösterir).
 * @returns {{ok:boolean, reason?:string, unit:number, total:number, avg:number, limitLeft:number, minLot:number}}
 */
export function quote(state, { itemId, q = 'B', organic = false, qty = 1, channel = 'market' } = {}, now) {
  const ch = CHANNELS[channel];
  const minLot = ch ? ch.minLot : 1;
  const e = priceEntry(state, itemId);
  const limitLeft = ch
    ? (Number.isFinite(ch.dailyLimitPerItem) ? Math.max(0, ch.dailyLimitPerItem - (e.soldToday || 0)) : Infinity)
    : 0;
  const out = { ok: false, unit: 0, total: 0, avg: 0, limitLeft, minLot };
  if (!isSellable(itemId)) return { ...out, reason: REASONS.notSellable };
  if (!ch) return { ...out, reason: REASONS.badChannel };
  const n = Math.floor(Number(qty));
  const base = unitBeforeSaturation(state, itemId, q, organic, channel, now);
  out.unit = Math.round(base * e.saturation);
  if (!(n > 0) || n !== Number(qty)) return { ...out, reason: REASONS.badQty };
  const { sum } = saleSum(base, e.saturation, SATURATION.perUnit[channel] ?? SATURATION.perUnit.market, n);
  out.total = Math.round(sum);
  out.avg = Math.round((sum / n) * 100) / 100;

  const level = Number(state?.player?.level) || 1;
  if (level < (ch.level || 1)) return { ...out, reason: REASONS.channelLocked(ch.name, ch.level) };
  if (count(state, itemId, q, organic === true) < n) return { ...out, reason: REASONS.notEnough };
  if (n < ch.minLot) return { ...out, reason: REASONS.minLot(ch.minLot) };
  if (n > limitLeft) {
    return { ...out, reason: limitLeft <= 0 ? REASONS.limitReached(ch.dailyLimitPerItem) : REASONS.limitLeft(limitLeft) };
  }
  out.ok = true;
  return out;
}

/**
 * Fiyat eğilimi: geçmiş (son PRICE_HISTORY_DAYS gün, B pazar yeri) ve ilk günden son güne değişim oranı.
 * @returns {{change:number, history:number[]}}
 */
export function trend(state, itemId) {
  const h = state?.market?.history?.[itemId];
  const history = Array.isArray(h) ? h.slice() : [];
  if (history.length < 2 || !(history[0] > 0)) return { change: 0, history };
  const change = Math.round(((history[history.length - 1] - history[0]) / history[0]) * 1000) / 1000;
  return { change, history };
}
