// Saf kurallar — UI ve FieldView import edebilir, state'e YAZMAZ (PLAN.md §8).
import { CROPS, STAGE_NAMES_TR, ROT_AFTER_DAYS } from '../../data/crops.js';
import { ITEMS } from '../../data/items.js';
import { HEALTH, SOIL } from '../../data/farming.js';
import { BLOCK_LABELS_TR, blockedKind } from '../../data/land.js';
import { DAYS_PER_SEASON, SEASONS } from '../../core/constants.js';
import { calendar } from '../../core/timeUtils.js';
import { count } from '../InventorySystem.js';
import { isOwnedTile } from './soil.js';
import { inSeason, idealRatePerHour, rotationCount } from './growth.js';
import { careScore, careSample, gradeFor } from './quality.js';

const SEASON_LOC_TR = { spring: "İlkbahar'da", summer: "Yaz'da", autumn: "Sonbahar'da", winter: "Kış'ta" };
const SEASON_TR = { spring: 'İlkbahar', summer: 'Yaz', autumn: 'Sonbahar', winter: 'Kış' };

export const REASONS = {
  notOwned: 'Burası senin arazin değil',
  notPlowed: 'Önce toprağı sürmelisin',
  alreadyPlowed: 'Burası zaten sürülmüş',
  cropPresent: 'Burada zaten ekin var',
  cropBlocksPlow: 'Ekin varken sürülemez',
  pickSeed: 'Önce bir tohum seç',
  noSeed: 'Tohumun kalmadı',
  tooWet: 'Toprak zaten ıslak',
  pickFert: 'Önce bir gübre seç',
  phHigh: 'pH zaten yüksek',
  pickChem: 'Önce bir ilaç seç',
  noCropToTreat: 'İlaçlanacak ekin yok',
  nothingToTreat: 'Ekinde zararlı ya da hastalık yok',
  noWeeds: 'Temizlenecek ot yok',
  noCrop: 'Hasat edilecek ekin yok',
  notReady: 'Henüz hasada hazır değil',
  unknown: 'Bilinmeyen eylem',
};

/** "İlkbahar'da", "İlkbahar veya Sonbahar'da" */
export function seasonListLoc(seasons) {
  if (seasons.length === 1) return SEASON_LOC_TR[seasons[0]];
  const head = seasons.slice(0, -1).map((s) => SEASON_TR[s]).join(', ');
  return `${head} veya ${SEASON_LOC_TR[seasons[seasons.length - 1]]}`;
}

/** "Kuyu burada — ekilemez" */
export function blockedReason(kind) { return `${BLOCK_LABELS_TR[kind] ?? 'Engel'} burada — ekilemez`; }

const NO = (reason) => ({ ok: false, reason });
const OK = { ok: true };

/**
 * Eylem uygulanabilir mi?
 * @param {object} state
 * @param {{type:string, tileId:string, itemId?:string}} action
 * @param {string} [season] verilmezse state.time'dan
 * @returns {{ok:boolean, reason?:string}}
 */
export function canApply(state, action, season) {
  if (!action) return NO(REASONS.unknown);
  const t = state.tiles?.[action.tileId];
  if (!t || !isOwnedTile(state, t)) return NO(REASONS.notOwned);
  const blk = blockedKind(action.tileId);
  if (blk) return NO(blockedReason(blk));
  const sea = season || calendar(state.time.totalMinutes).season;
  const crop = t.crop;
  const id = action.itemId;
  const item = id ? ITEMS[id] : null;
  switch (action.type) {
    case 'plow':
      if (crop) return NO(REASONS.cropBlocksPlow);
      if (t.state === 'plowed') return NO(REASONS.alreadyPlowed);
      return OK;
    case 'plant': {
      if (!item || item.category !== 'seed') return NO(REASONS.pickSeed);
      if (t.state !== 'plowed') return NO(REASONS.notPlowed);
      if (crop) return NO(REASONS.cropPresent);
      const def = CROPS[item.crop];
      if (!inSeason(def, sea)) return NO(`Bu tohum ${seasonListLoc(def.seasons)} ekilir`);
      if (count(state, id) < 1) return NO(REASONS.noSeed);
      return OK;
    }
    case 'water':
      if (t.state !== 'plowed') return NO(REASONS.notPlowed);
      if (t.moisture > SOIL.wetEnoughAbove) return NO(REASONS.tooWet);
      return OK;
    case 'fertilize':
      if (!item || item.category !== 'fertilizer') return NO(REASONS.pickFert);
      if (t.state !== 'plowed') return NO(REASONS.notPlowed);
      if (count(state, id) < 1) return NO(`${item.name} kalmadı`);
      if (item.effect.ph > 0 && !item.effect.n && !item.effect.p && !item.effect.k && t.ph >= SOIL.phRange[1]) return NO(REASONS.phHigh);
      return OK;
    case 'treat':
      if (!item || item.category !== 'chemical') return NO(REASONS.pickChem);
      if (!crop || crop.dead) return NO(REASONS.noCropToTreat);
      if (!(crop.pest > 0) && !(crop.disease > 0)) return NO(REASONS.nothingToTreat);
      if (count(state, id) < 1) return NO(`${item.name} kalmadı`);
      return OK;
    case 'weed':
      if (!(t.weeds > 0)) return NO(REASONS.noWeeds);
      return OK;
    case 'harvest':
      if (!crop) return NO(REASONS.noCrop);
      if (crop.dead) return OK; // ölü ekini temizler
      if (crop.stage < 4) return NO(REASONS.notReady);
      return OK;
    default:
      return NO(REASONS.unknown);
  }
}

function fmtReady(hours) {
  if (hours <= 0) return 'Hasada hazır';
  if (!Number.isFinite(hours)) return 'Büyümüyor';
  if (hours < 24) return `~${Math.max(1, Math.round(hours))} saat`;
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return h > 0 && d < 3 ? `~${d} gün ${h} saat` : `~${Math.round(hours / 24)} gün`;
}

/** Bu andan mevsim sonuna kadar kalan saat (bugünün kalanı dahil). */
function seasonHoursLeft(cal) {
  const frac = typeof cal.dayFraction === 'number' ? cal.dayFraction : (cal.hour * 60 + (cal.minute || 0)) / 1440;
  return (DAYS_PER_SEASON - cal.dayOfSeason + (1 - frac)) * 24;
}

/** Ürünün art arda uygun mevsimlerde büyüyebileceği kalan saat (mevcut mevsim uygun değilse 0). */
function growableHoursLeft(def, cal) {
  if (!inSeason(def, cal.season)) return 0;
  let h = seasonHoursLeft(cal);
  let si = SEASONS.indexOf(cal.season);
  for (let i = 0; i < 3; i++) {
    si = (si + 1) % SEASONS.length;
    if (!inSeason(def, SEASONS[si])) break;
    h += DAYS_PER_SEASON * 24;
  }
  return h;
}

const W = (code, text) => ({ code, text });

/**
 * Karo bilgi kartı verisi.
 * Dekorlu karoda: { tileId, tx, ty, blocked: kind, label } (UI kart açmaz).
 * warnings: [{ code, text }] — kodlar: dry, wet, lowN, lowP, lowK, acidic, alkaline, pest, disease,
 *   weeds, rotation, outOfSeason, wither, rotting, revertSoon.
 * crop.daysLeft / readyIn ideal sulama varsayımıyla (mevcut besin/pH/sağlık/mevsim çarpanları); kuraklık ayrıca 'dry' uyarısıdır.
 * @returns {null | {tileId, tx, ty, blocked?, label?, state, soil, crop, weeds, organic, history, pendingFert, seasonDaysLeft, warnings}}
 */
export function tileInfo(state, tileId, now) {
  const t = state.tiles?.[tileId];
  const blk = blockedKind(tileId);
  if (blk) {
    const xy = t ? [t.tx, t.ty] : tileId.split(',').map(Number);
    return { tileId, tx: xy[0], ty: xy[1], blocked: blk, label: BLOCK_LABELS_TR[blk] ?? blk };
  }
  if (!t) return null;
  const cal = now && now.season ? now : calendar(state.time.totalMinutes);
  const season = cal.season;
  const warnings = [];
  const c = t.crop;
  const alive = !!c && !c.dead;
  const seasonHours = seasonHoursLeft(cal);
  let crop = null;
  if (t.state === 'plowed') {
    if (t.moisture < SOIL.droughtBelow) warnings.push(W('dry', alive ? 'Kuraklık büyümeyi durduruyor — sula' : 'Toprak çok kuru'));
    else if (t.moisture < SOIL.droughtBelow + 10) warnings.push(W('dry', 'Toprak kuru'));
    if (t.moisture > SOIL.waterlogAbove) warnings.push(W('wet', 'Toprak su dolu — kök çürüyebilir'));
  }
  if (t.ph < SOIL.phIdeal[0]) warnings.push(W('acidic', 'pH asidik'));
  else if (t.ph > SOIL.phIdeal[1]) warnings.push(W('alkaline', 'pH bazik'));
  if (c) {
    const def = CROPS[c.id];
    if (def) {
      let hoursLeft = 0;
      if (!c.dead && c.stage < 4) {
        const rate = idealRatePerHour(t, c, def, season);
        hoursLeft = rate > 0 ? (1 - c.growth) / rate : Infinity;
      }
      const willMature = !c.dead && (c.stage >= 4 || (Number.isFinite(hoursLeft) && hoursLeft <= growableHoursLeft(def, cal)));
      const score = careScore(c, careSample(t, c, def));
      crop = {
        id: c.id,
        name: def.name,
        stage: c.stage,
        stageName: c.dead ? 'Ölü' : STAGE_NAMES_TR[c.stage],
        growthPct: Math.round(c.growth * 100),
        health: Math.round(c.health),
        dead: !!c.dead,
        daysLeft: c.dead ? null : Number.isFinite(hoursLeft) ? Math.round((hoursLeft / 24) * 10) / 10 : null,
        readyIn: c.dead ? 'Öldü' : fmtReady(hoursLeft),
        willMature,
        rotIn: !c.dead && c.stage >= 4 ? Math.max(0, ROT_AFTER_DAYS - c.readyDays) : null,
        qualityEstimate: gradeFor(score),
        careScore: Math.round(score),
        pest: c.pest,
        disease: c.disease,
        harvests: c.harvests,
      };
      if (!c.dead) {
        const nd = def.need;
        if (nd.n > 0 && t.n / nd.n < 0.7) warnings.push(W('lowN', 'Azot düşük'));
        if (nd.p > 0 && t.p / nd.p < 0.7) warnings.push(W('lowP', 'Fosfor düşük'));
        if (nd.k > 0 && t.k / nd.k < 0.7) warnings.push(W('lowK', 'Potasyum düşük'));
        if (c.pest > 0) warnings.push(W('pest', 'Zararlı var'));
        if (c.disease > 0) warnings.push(W('disease', 'Hastalık var'));
        if (c.health < HEALTH.witherBelow) warnings.push(W('wither', 'Bitki soluyor'));
        if (!inSeason(def, season)) warnings.push(W('outOfSeason', 'Mevsim dışı'));
        if (c.stage >= 4 && c.readyDays >= ROT_AFTER_DAYS - 1) warnings.push(W('rotting', 'Çürümek üzere — hasat et'));
      }
      if ((c.rot ?? 1) < 1) warnings.push(W('rotation', `Ekim nöbeti: verim -%${Math.round((1 - c.rot) * 100)}`));
    }
  }
  if (t.weeds > 0) warnings.push(W('weeds', 'Yabani ot'));
  if (t.state === 'plowed' && !c && t.idleDays >= SOIL.grassRecoverDays - 5) {
    const n = Math.max(1, SOIL.grassRecoverDays - t.idleDays);
    warnings.push(W('revertSoon', `${n} gün içinde çime döner`));
  }
  return {
    tileId, tx: t.tx, ty: t.ty, state: t.state,
    soil: { moisture: Math.round(t.moisture), n: Math.round(t.n), p: Math.round(t.p), k: Math.round(t.k), ph: Math.round(t.ph * 10) / 10 },
    crop,
    weeds: t.weeds,
    organic: t.organic,
    history: t.history.slice(),
    pendingFert: t.pendingFert.length,
    seasonDaysLeft: Math.ceil(seasonHours / 24 - 1e-9),
    warnings,
  };
}

/**
 * Tohum seçici uyarısı: şimdi ekilirse (ideal koşulda) uygun mevsim(ler) bitmeden yetişmeyecekse.
 * Mevsim dışı ürün için null (canApply zaten reddeder). cropId yerine tohum itemId de kabul edilir.
 * @returns {null | {code:'lateInSeason', text:string}}
 */
export function seedWarning(state, cropId, now) {
  const id = CROPS[cropId] ? cropId : ITEMS[cropId]?.crop;
  const def = CROPS[id];
  if (!def) return null;
  const cal = now && now.season ? now : calendar(state.time.totalMinutes);
  if (!inSeason(def, cal.season)) return null;
  const left = growableHoursLeft(def, cal);
  if (def.growDays * 24 <= left) return null;
  const d = Math.max(0, Math.floor(left / 24));
  return { code: 'lateInSeason', text: `Mevsim bitmeden yetişmez (${def.growDays} gün gerekir, ${d} gün kaldı)` };
}

/** Ekim nöbeti uyarısını ekmeden önce göstermek için (UI tohum seçici). */
export function rotationWarning(tile, cropId) {
  const c = rotationCount(tile?.history ?? [], cropId);
  if (c === 0) return null;
  const rp = SOIL.rotationPenalty;
  const m = rp[c < rp.length ? c : rp.length - 1];
  return `Ekim nöbeti: verim -%${Math.round((1 - m) * 100)}`;
}

/** Görsel durum (FieldView). Ekin yoksa null. */
export function cropVisual(tile) {
  const c = tile?.crop;
  if (!c) return null;
  return {
    cropId: c.id, stage: c.stage,
    wither: !c.dead && c.health < HEALTH.witherBelow,
    dead: !!c.dead, pest: c.pest, disease: c.disease, weeds: tile.weeds,
  };
}
