// Çalışan görev seçimi + durum metni — PLAN.md §11. Saf yardımcılar; state'e YAZMAZ.
// Görev türleri: water, harvest (tarla) · feed, waterAnimals, collect (hayvan binaları) · machineCollect, machineLoad (atölyeler).
import { BUILDINGS } from '../../data/buildings.js';
import { MACHINES, MACHINE_RULES, RECIPES } from '../../data/recipes.js';
import { CROPS } from '../../data/crops.js';
import { freeSlots, count } from '../InventorySystem.js';
import { canApply } from '../farm/rules.js';
import { animalsIn, feedNeedPerDay, acceptedFeed } from '../animals/sim.js';
import { nearestFree, cellOf } from './pathfinding.js';

export const WATER_BELOW = 45;       // nem bunun altındaki ekili karo sulanır
export const FEED_BELOW_DAYS = 0.5;  // yemlik günlük ihtiyacın bu kadarının altına inince yem konur
export const WATER_BELOW_DAYS = 1;   // suluk < 1 gün
export const TASK_KINDS = ['water', 'harvest', 'animals', 'machines'];
export const GROUP_KINDS = {
  water: ['water'], harvest: ['harvest'], animals: ['feed', 'waterAnimals', 'collect'], machines: ['machineCollect', 'machineLoad'],
};
/** Eylem süresi anahtarı (WORKER_TYPES.*.actionMinutes). */
export const ACTION_KEY = {
  water: 'water', harvest: 'harvest', feed: 'feed', waterAnimals: 'waterAnimals', collect: 'collect',
  machineCollect: 'machineCollect', machineLoad: 'machineLoad',
};

const PLACE_DAT = { coop: 'kümese', barn: 'ahıra', hive: 'kovana' };
const MACHINE_DAT = {
  dairy: 'mandıraya', mill: 'değirmene', bakery: 'fırına', cannery: 'konserve atölyesine', spinning: 'iplikhaneye', loom: 'dokuma tezgâhına',
};
const MACHINE_ACC = {
  dairy: 'mandırayı', mill: 'değirmeni', bakery: 'fırını', cannery: 'konserve atölyesini', spinning: 'iplikhaneyi', loom: 'dokuma tezgâhını',
};

/** "Patates" → "Patatesleri" (çoğul belirtme, ünlü uyumu). */
export function pluralAcc(name) {
  const m = /[aıouAIOUeiöüEİÖÜ](?=[^aıoueiöüAIOUEİÖÜ]*$)/.exec(name);
  const back = m ? 'aıouAIOU'.includes(m[0]) : false;
  return name + (back ? 'ları' : 'leri');
}

// Aday: yeniden kullanılan tek nesne (bellek ayırma yok); kazanan çağıranda kopyalanır.
const cand = { kind: '', target: '', cx: 0, cy: 0, dist: Infinity, itemId: null, recipe: null, place: '', subject: '' };
const hasCand = () => cand.dist < Infinity;
function resetCand() { cand.dist = Infinity; }
function offer(kind, target, cx, cy, px, py, itemId, recipe, place, subject) {
  const dx = cx + 0.5 - px, dy = cy + 0.5 - py;
  const d = dx * dx + dy * dy;
  if (d >= cand.dist) return;
  cand.dist = d; cand.kind = kind; cand.target = target; cand.cx = cx; cand.cy = cy;
  cand.itemId = itemId; cand.recipe = recipe; cand.place = place; cand.subject = subject;
}

/** Bina/atölye arsasının önünde (alt kenar) durulacak yürünebilir hücre. */
export function standCell(lot) {
  const cell = nearestFree((lot.x0 + lot.x1) / 2, lot.y1 + 1);
  return cell;
}

function lotOfBuilding(b) {
  for (const type in BUILDINGS) {
    const l = BUILDINGS[type].lots.find((x) => x.id === b.lotId);
    if (l) return l;
  }
  return null;
}

/**
 * Bir görev türü grubunda en yakın uygun işi arar. Bulursa cand'i doldurup true döner.
 * @param {object} env { isTaken(kind,target):boolean }
 */
function scanGroup(state, group, px, py, env) {
  resetCand();
  const free = freeSlots(state) > 0;
  switch (group) {
    case 'water':
      for (const id in state.tiles) {
        const t = state.tiles[id];
        const c = t.crop;
        if (!c || c.dead || c.stage >= 4 || t.state !== 'plowed' || !(t.moisture < WATER_BELOW)) continue;
        if (env.isTaken('water', id) || !canApply(state, { type: 'water', tileId: id }).ok) continue;
        offer('water', id, t.tx, t.ty, px, py, null, null, 'tarlaya', CROPS[c.id] ? CROPS[c.id].name : '');
      }
      break;
    case 'harvest':
      if (!free) break;
      for (const id in state.tiles) {
        const t = state.tiles[id];
        const c = t.crop;
        if (!c || c.dead || c.stage < 4) continue;
        if (env.isTaken('harvest', id) || !canApply(state, { type: 'harvest', tileId: id }).ok) continue;
        offer('harvest', id, t.tx, t.ty, px, py, null, null, 'tarlaya', CROPS[c.id] ? CROPS[c.id].name : '');
      }
      break;
    case 'animals':
      for (const b of state.buildings) {
        const list = animalsIn(state, b.id);
        if (!list.length) continue;
        const lot = lotOfBuilding(b);
        if (!lot) continue;
        const cell = standCell(lot);
        const cx = cell % 80, cy = (cell / 80) | 0;
        const place = PLACE_DAT[b.type] || '';
        // yem
        const need = feedNeedPerDay(list);
        if (need > 0 && b.trough.feed < need * FEED_BELOW_DAYS && !env.isTaken('feed', b.id)) {
          const acc = acceptedFeed(list);
          let pick = null;
          for (const itemId in acc) if (count(state, itemId) > 0) { pick = itemId; break; }
          if (pick) offer('feed', b.id, cx, cy, px, py, pick, null, place, '');
        }
        if (need > 0 && b.trough.water < WATER_BELOW_DAYS && !env.isTaken('waterAnimals', b.id)) {
          offer('waterAnimals', b.id, cx, cy, px, py, null, null, place, '');
        }
        if (free && !env.isTaken('collect', b.id)) {
          let any = false;
          for (const itemId in b.box) { const arr = b.box[itemId]; if (arr && arr.length) { any = true; break; } }
          if (any) offer('collect', b.id, cx, cy, px, py, null, null, place, '');
        }
      }
      break;
    case 'machines':
      if (!Array.isArray(state.machines)) break;
      for (const m of state.machines) {
        const def = MACHINES[m.type];
        if (!def) continue;
        const cell = standCell(def.lot);
        const cx = cell % 80, cy = (cell / 80) | 0;
        if (free && m.output && !env.isTaken('machineCollect', m.id)) {
          let any = false;
          for (const itemId in m.output) { const arr = m.output[itemId]; if (arr && arr.length) { any = true; break; } }
          if (any) offer('machineCollect', m.id, cx, cy, px, py, null, null, MACHINE_DAT[m.type] || 'atölyeye', MACHINE_ACC[m.type] || 'atölyeyi');
        }
        const r = m.auto ? RECIPES[m.auto] : null;
        if (r && r.machine === m.type && Array.isArray(m.queue) && m.queue.length < MACHINE_RULES.queueMax
            && !(m.condition < MACHINE_RULES.stopBelow) && !env.isTaken('machineLoad', m.id)) {
          let ok = true;
          for (const k in r.in) if (count(state, k) < r.in[k]) { ok = false; break; }
          if (ok) offer('machineLoad', m.id, cx, cy, px, py, null, m.auto, MACHINE_DAT[m.type] || 'atölyeye', MACHINE_ACC[m.type] || 'atölyeyi');
        }
      }
      break;
    default: break;
  }
  return hasCand();
}

/**
 * Önceliğe (order) göre ilk dolu gruptaki en yakın işi seçer. Bulursa paylaşılan `cand` nesnesini döndürür (kopyala!).
 * @param {object} w çalışan
 * @param {number} px,py çalışanın karo birimli konumu
 */
export function pickTask(state, w, px, py, env) {
  const order = w.order;
  for (let i = 0; i < order.length; i++) {
    const g = order[i];
    if (!w.tasks[g]) continue;
    if (scanGroup(state, g, px, py, env)) return cand;
  }
  return null;
}

export const cellXY = (cell) => ({ cx: cell % 80, cy: (cell / 80) | 0 });
export { cellOf };

/** Kısa durum metni (panel + debug). Saf. */
export function statusText(state, w, hourNow) {
  if (!w.enabled) return 'İzinde';
  if (w.debt > 0) return 'Maaşını bekliyor';
  const t = w.task;
  switch (w.mode) {
    case 'home': return hourNow != null && hourNow < 7 ? 'Evde, güne hazırlanıyor' : 'Evde dinleniyor';
    case 'idle': return 'Yapacak iş arıyor';
    case 'walk':
      if (!t) return w.onDonkey ? 'Eşekle eve dönüyor' : 'Eve dönüyor';
      if (t.phase === 'toDonkey') return 'Eşeğe gidiyor';
      return `${cap(t.place || 'işe')} gidiyor`;
    case 'ride':
      if (!t) return 'Eşekle eve dönüyor';
      return `Eşekle ${t.place || 'işe'} gidiyor`;
    case 'work': return workText(t);
    default: return '';
  }
}
function cap(s) { return s ? s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) : s; }
function workText(t) {
  if (!t) return 'Çalışıyor';
  switch (t.kind) {
    case 'water': return t.subject ? `${pluralAcc(t.subject)} suluyor` : 'Ekinleri suluyor';
    case 'harvest': return t.subject ? `${pluralAcc(t.subject)} hasat ediyor` : 'Hasat yapıyor';
    case 'feed': return 'Hayvanlara yem veriyor';
    case 'waterAnimals': return 'Hayvanların suluğunu dolduruyor';
    case 'collect': return 'Hayvan ürünlerini topluyor';
    case 'machineCollect': return `${cap(t.subject || 'atölyeyi')} boşaltıyor`;
    case 'machineLoad': return `${cap(t.subject || 'makineyi')} dolduruyor`;
    default: return 'Çalışıyor';
  }
}
