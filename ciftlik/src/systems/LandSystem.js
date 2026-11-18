// LandSystem — arazi alımı (PLAN §15). Phaser import ETMEZ.
// Komut: land:buy {parcelId}. Olaylar: land:changed {parcelId}, land:result {ok, parcelId?, reason?, text?}, farm:changed (yeni karolar), toast.
// Emlak vergisi EconomySystem.closeSeason'da (TAX.propertyRate × price); burada yalnızca saf yardımcılar (propertyTaxOf).
import { PARCELS } from '../data/land.js';
import { TAX } from '../data/economy.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { ensureParcelTiles } from './FarmSystem.js';
import FarmSystem from './FarmSystem.js';
import * as occ from './world/occupancy.js';

let offs = [];

const parcelsOf = (state) => {
  if (!isPlainObject(state.land)) state.land = { parcels: [] };
  if (!Array.isArray(state.land.parcels)) state.land.parcels = [];
  return state.land.parcels;
};

export const isOwned = (state, id) => id === 'P1' || parcelsOf(state).some((p) => p && p.id === id && p.owned === true);

/** Mevsimlik emlak vergisi (₺): sahip olunan P2+ parsellerin fiyatı × TAX.propertyRate. */
export function propertyTaxOf(state) {
  let t = 0;
  for (const id in PARCELS) if (id !== 'P1' && isOwned(state, id)) t += Math.round((PARCELS[id].price || 0) * TAX.propertyRate);
  return t;
}

/** UI listesi: satın alınabilir parseller. */
export function listParcels(state) {
  const out = [];
  for (const id in PARCELS) {
    if (id === 'P1') continue;
    const r = PARCELS[id];
    out.push({ id, name: r.name || id, w: r.w, h: r.h, area: r.w * r.h, price: r.price, tax: Math.round(r.price * TAX.propertyRate), owned: isOwned(state, id) });
  }
  return out;
}

export function buy(state, bus, { parcelId } = {}) {
  const res = (p) => { if (bus) bus.emit('land:result', { parcelId, ...p }); return { parcelId, ...p }; };
  const def = PARCELS[parcelId];
  if (!def || parcelId === 'P1') return res({ ok: false, reason: 'Geçersiz arazi' });
  if (isOwned(state, parcelId)) return res({ ok: false, reason: 'Bu arazi zaten senin' });
  if (!(def.price >= 0)) return res({ ok: false, reason: 'Bu arazi satılık değil' });
  if (!transact(state, bus, { amount: -def.price, category: 'land', label: `Arazi: ${def.name || parcelId}` })) return res({ ok: false, reason: 'Yeterli paran yok' });
  const parcels = parcelsOf(state);
  const rec = parcels.find((p) => p && p.id === parcelId);
  if (rec) rec.owned = true; else parcels.push({ id: parcelId, owned: true });
  const added = ensureParcelTiles(state);
  FarmSystem.invalidate();
  occ.invalidate(state);
  if (bus) {
    bus.emit('land:changed', { parcelId });
    if (added.length) bus.emit('farm:changed', { tileIds: added });
    bus.emit('placed:changed', { ids: [] }); // yerleştirme ızgarası/görseller yenilensin
    bus.emit('toast', { text: `${def.name || parcelId} satın alındı.`, kind: 'good' });
  }
  return res({ ok: true, text: `${def.name || parcelId} satın alındı.`, price: def.price, tiles: added.length });
}

const LandSystem = {
  id: 'land',
  buy, propertyTaxOf, listParcels,
  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    parcelsOf(state);
    offs.push(bus.on('land:buy', (p) => buy(state, bus, p)));
  },
};
export default LandSystem;
