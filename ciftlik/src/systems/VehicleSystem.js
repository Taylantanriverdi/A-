// VehicleSystem — traktör, biçerdöver, sağım makinesi (PLAN §15). Phaser import ETMEZ.
// Komutlar: shop:buyVehicle {vehicle}, vehicle:work {type:'tractor'|'harvester', tileId, itemId?, driverId?}.
// Olaylar: vehicles:changed, vehicle:result {ok, type, vehicle?, count?, fuel?, reason?}, vehicle:run {type, tiles, driverId?} (görsel),
//          vehicle:milked {placedId, collected}, toast. Yakıt: transact(-fuelPerTile × işlenen karo, 'fuel').
// Sağım makinesi: her sabah 07:00 ahırdaki süt/keçi sütünü envantere taşır (kalite üstü şansı); 3 kWh/gün EconomySystem'de.
import { VEHICLES, PLACEABLES } from '../data/placeables.js';
import { isPlainObject } from '../core/GameState.js';
import { transact } from './EconomySystem.js';
import { applyAction } from './FarmSystem.js';
import { canApply } from './farm/rules.js';
import { parseKey, tileKey } from './farm/soil.js';
import { canAdd, add } from './InventorySystem.js';
import { placedIdOf } from './animals/sim.js';

let offs = [];

const vehiclesOf = (state) => (Array.isArray(state.vehicles) ? state.vehicles : (state.vehicles = []));
const placedOfType = (state, type) => (Array.isArray(state.placed) ? state.placed : []).filter((p) => p.type === type);
export const hasVehicle = (state, type) => vehiclesOf(state).some((v) => v.type === type);
const UP = { C: 'B', B: 'A' };

function result(bus, p) { if (bus) bus.emit('vehicle:result', p); return p; }

/** Mağaza: satın alınabilir mi? { ok, reason? } (UI gereksinim uyarısı için de kullanılır) */
export function canBuy(state, vehicle) {
  const def = VEHICLES[vehicle];
  if (!def) return { ok: false, reason: 'Geçersiz makine' };
  if (hasVehicle(state, vehicle)) return { ok: false, reason: 'Zaten var' };
  if (def.needs && !placedOfType(state, def.needs).length) return { ok: false, reason: `Önce ${PLACEABLES[def.needs]?.name || def.needs} inşa et` };
  if ((Number(state.finance?.money) || 0) < def.price) return { ok: false, reason: 'Yeterli paran yok' };
  return { ok: true };
}

export function buyVehicle(state, bus, { vehicle } = {}) {
  const def = VEHICLES[vehicle];
  const c = canBuy(state, vehicle);
  if (!c.ok) return result(bus, { ok: false, type: 'buy', vehicle, reason: c.reason });
  if (!transact(state, bus, { amount: -def.price, category: 'vehicles', label: `Makine: ${def.name}` })) return result(bus, { ok: false, type: 'buy', vehicle, reason: 'Yeterli paran yok' });
  const list = vehiclesOf(state);
  state.flags = isPlainObject(state.flags) ? state.flags : {};
  const seq = (Number(state.flags.vehicleSeq) || 0) + 1;
  state.flags.vehicleSeq = seq;
  const home = placedOfType(state, def.needs)[0];
  const v = { id: `v${seq}`, type: vehicle, garageId: home ? home.id : null, condition: 100 };
  list.push(v);
  if (bus) { bus.emit('vehicles:changed', { ids: [v.id] }); bus.emit('toast', { text: `${def.name} satın alındı.`, kind: 'good' }); }
  return result(bus, { ok: true, type: 'buy', vehicle, id: v.id, text: `${def.name} satın alındı.` });
}

/** Garaj/ahır silinirse araç başka bir uygun yapıya bağlanır (yoksa olduğu gibi kalır; canRemove zaten engeller). */
export function reassignVehicles(state) {
  for (const v of vehiclesOf(state)) {
    const need = VEHICLES[v.type]?.needs;
    if (!need) continue;
    const homes = placedOfType(state, need);
    if (!homes.length || homes.some((p) => p.id === v.garageId)) continue;
    v.garageId = homes[0].id;
  }
}

/** Yapı kaldırma kontrolü: araçların tek barınağı kaldırılamaz. */
export function canRemove(state, placedId) {
  const p = (state.placed || []).find((q) => q.id === placedId);
  if (!p) return { ok: true };
  const held = vehiclesOf(state).filter((v) => v.garageId === placedId);
  if (held.length && placedOfType(state, p.type).length <= 1) return { ok: false, reason: `${PLACEABLES[p.type]?.name || 'Yapı'} içinde ${VEHICLES[held[0].type].name} var — kaldırılamaz` };
  return { ok: true };
}

/** Merkez karonun etrafındaki area×area karo kimlikleri (merkez dahil). */
export function areaTiles(tileId, area = 3) {
  const xy = parseKey(tileId);
  if (!xy) return [];
  const r = Math.floor(area / 2), out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push(tileKey(xy[0] + dx, xy[1] + dy));
  return out;
}

/**
 * Araçla toplu iş. tractor: alanda sür (+ itemId tohumsa ek); harvester: hazır `crops` ekinlerini ×yieldMult hasat eder.
 * @returns {object} vehicle:result yükü
 */
export function work(state, bus, { type, tileId, itemId, driverId } = {}) {
  const def = VEHICLES[type];
  const fail = (reason) => result(bus, { ok: false, type: 'work', vehicle: type, reason });
  if (!def || !def.area) return fail('Geçersiz araç');
  if (!hasVehicle(state, type)) return fail(`${def.name} yok — Mağaza → Makineler`);
  const tiles = areaTiles(tileId, def.area);
  if (!tiles.length) return fail('Geçersiz karo');
  const money = Number(state.finance?.money) || 0;
  if (money < Math.ceil(def.fuelPerTile)) return fail('Yakıt için yeterli paran yok');
  const worked = [];
  let fuel = 0, firstReason = null, actions = 0;
  const tryAct = (a) => {
    const chk = canApply(state, a);
    if (!chk.ok) { if (!firstReason) firstReason = chk.reason; return false; }
    const r = applyAction(state, bus, a);
    if (!r.ok && !firstReason) firstReason = r.reason;
    return r.ok;
  };
  for (const id of tiles) {
    if (money - fuel < def.fuelPerTile) { firstReason = firstReason || 'Yakıt parası bitti'; break; }
    let did = false;
    if (type === 'tractor') {
      if (tryAct({ type: 'plow', tileId: id })) { did = true; actions++; }
      if (itemId && tryAct({ type: 'plant', tileId: id, itemId })) { did = true; actions++; }
    } else if (type === 'harvester') {
      const c = state.tiles?.[id]?.crop;
      if (c && !c.dead && def.crops.includes(c.id) && tryAct({ type: 'harvest', tileId: id, yieldMult: def.yieldMult })) { did = true; actions++; }
    }
    if (did) { worked.push(id); fuel += def.fuelPerTile; }
  }
  if (!worked.length) return fail(firstReason || 'Burada işlenecek bir şey yok');
  const cost = Math.max(1, Math.round(fuel));
  transact(state, bus, { amount: -cost, category: 'fuel', label: `Yakıt: ${def.name} (${worked.length} karo)` });
  const v = vehiclesOf(state).find((q) => q.type === type);
  if (v) v.condition = Math.max(0, (Number(v.condition) || 100) - 0.02 * worked.length);
  if (bus) bus.emit('vehicle:run', { type, tiles: worked, driverId: driverId || null });
  return result(bus, { ok: true, type: 'work', vehicle: type, count: worked.length, actions, fuel: cost, tiles: worked, driverId: driverId || null });
}

/** Çalışan/araç işi için yakıt: tiles × fuelPerTile → transact('fuel'). Para yetmezse false (hiçbir şey düşmez). */
export function chargeFuel(state, bus, vehicleType, tiles) {
  const def = VEHICLES[vehicleType];
  const n = Array.isArray(tiles) ? tiles.length : Math.floor(Number(tiles) || 0);
  if (!def || !(def.fuelPerTile > 0) || n <= 0) return !!def;
  return transact(state, bus, { amount: -Math.max(1, Math.round(def.fuelPerTile * n)), category: 'fuel', label: `Yakıt: ${def.name} (${n} karo)` });
}

/** 07:00 sağım: her sağım makinesinin ahırındaki süt/keçi sütü → envanter. @returns {Array} toplananlar */
export function milkRun(state, bus, rng) {
  const out = [];
  const def = VEHICLES.milker;
  for (const v of vehiclesOf(state)) {
    if (v.type !== 'milker') continue;
    const b = (state.buildings || []).find((x) => placedIdOf(x) === v.garageId);
    if (!b || !isPlainObject(b.box)) continue;
    const got = {};
    for (const itemId of def.autoCollect) {
      const stacks = b.box[itemId];
      if (!Array.isArray(stacks)) continue;
      for (const s of stacks) {
        if (!(s.qty > 0)) continue;
        let q = s.q;
        if (UP[q] && rng && rng.next() < def.qualityUpChance) q = UP[q];
        const n = canAdd(state, itemId, s.qty, q, false);
        if (n <= 0) continue;
        const addedQty = add(state, itemId, n, q, false);
        s.qty -= addedQty;
        got[itemId] = (got[itemId] || 0) + addedQty;
      }
      b.box[itemId] = stacks.filter((s) => s.qty > 0);
      if (!b.box[itemId].length) delete b.box[itemId];
    }
    const total = Object.values(got).reduce((s, n) => s + n, 0);
    if (total > 0) {
      out.push({ placedId: v.garageId, collected: got });
      if (bus) { bus.emit('animals:changed', { buildingIds: [b.id] }); bus.emit('vehicle:milked', { placedId: v.garageId, collected: got }); }
    }
  }
  if (out.length && bus) bus.emit('toast', { text: 'Sağım makinesi sütü depoya taşıdı.', kind: 'info' });
  return out;
}

/** Kayıt doğrulayıcı: vehicles dizisi. */
export function validate(state, onFix = () => {}) {
  if (!Array.isArray(state.vehicles)) { onFix('vehicles'); state.vehicles = []; }
  const seen = new Set(), kept = [];
  for (const v of state.vehicles) {
    const ok = isPlainObject(v) && VEHICLES[v.type] && typeof v.id === 'string' && !seen.has(v.type);
    if (!ok) { onFix('vehicles.item'); continue; }
    seen.add(v.type);
    kept.push({ id: v.id, type: v.type, garageId: typeof v.garageId === 'string' ? v.garageId : null, condition: Number.isFinite(v.condition) ? v.condition : 100 });
  }
  state.vehicles.length = 0; state.vehicles.push(...kept);
  return state;
}

const VehicleSystem = {
  id: 'vehicles',
  validate, buyVehicle, work, chargeFuel, canBuy, milkRun, areaTiles, hasVehicle,
  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    vehiclesOf(state);
    offs.push(bus.on('shop:buyVehicle', (p) => buyVehicle(state, bus, p)));
    offs.push(bus.on('vehicle:work', (p) => work(state, bus, p)));
  },
  onHour(state, bus, ctx) {
    if (ctx?.now?.hour === 7) milkRun(state, bus, ctx.rng);
  },
};
export default VehicleSystem;
