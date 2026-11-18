// ProgressionSystem — XP ve seviye (PLAN.md §9). Phaser import ETMEZ.
// state.player = { level, xp /* mevcut seviyedeki XP */, totalXp, reputation }
// Komut: xp:add {amount, reason} → xp:gained {amount, reason, level, xp, toNext}, level:up {level, unlocks}.
// Kaynak gerçek totalXp'dir; level ve xp ondan türetilir (levelFromTotal).
import { MAX_LEVEL, xpToNext, UNLOCKS } from '../data/progression.js';
import { isPlainObject } from '../core/GameState.js';

let offs = [];

/** Seviye 1'den `level`'e ulaşmak için gereken toplam XP. */
export function cumulativeXp(level) {
  let s = 0;
  const top = Math.min(Math.max(1, Math.floor(level)), MAX_LEVEL);
  for (let l = 1; l < top; l++) s += xpToNext(l);
  return s;
}

/**
 * Toplam XP → { level, xp, toNext }. MAX_LEVEL'de çubuk dolu gösterilir: xp = toNext = xpToNext(MAX_LEVEL).
 * @param {number} totalXp
 */
export function levelFromTotal(totalXp) {
  let rest = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (rest < need) break;
    rest -= need; level++;
  }
  const toNext = xpToNext(level);
  if (level >= MAX_LEVEL) return { level, xp: toNext, toNext };
  return { level, xp: rest, toNext };
}

/** XP miktarı normalizasyonu: tamsayıya yuvarlanır, pozitif her miktar en az 1. */
export function normalizeAmount(amount) {
  const a = Number(amount);
  if (!(a > 0) || !Number.isFinite(a)) return 0;
  const r = Math.round(a);
  return r < 1 ? 1 : r;
}

function ensurePlayer(state) {
  if (!isPlainObject(state.player)) state.player = { name: 'Çiftçi', level: 1, xp: 0, totalXp: 0, reputation: 10 };
  return state.player;
}

/**
 * XP ekler (saf; olayları `bus` varsa yayar). Çoklu seviye atlamada her seviye için ayrı level:up.
 * @returns {{amount:number, levelsGained:number[], level:number, xp:number, toNext:number}}
 */
export function addXp(state, bus, amount, reason = 'other') {
  const p = ensurePlayer(state);
  const a = normalizeAmount(amount);
  const before = Number.isInteger(p.level) ? p.level : levelFromTotal(p.totalXp).level;
  if (a <= 0) { const cur = levelFromTotal(p.totalXp); return { amount: 0, levelsGained: [], ...cur }; }
  p.totalXp = (Number(p.totalXp) || 0) + a;
  const cur = levelFromTotal(p.totalXp);
  p.level = cur.level; p.xp = cur.xp;
  const levelsGained = [];
  for (let l = before + 1; l <= cur.level; l++) levelsGained.push(l);
  if (bus) {
    bus.emit('xp:gained', { amount: a, reason, level: cur.level, xp: cur.xp, toNext: cur.toNext });
    for (const l of levelsGained) bus.emit('level:up', { level: l, unlocks: UNLOCKS[l] ?? [] });
  }
  return { amount: a, levelsGained, ...cur };
}

/** UI yardımcısı: mevcut ilerleme. */
export function progress(state) {
  const p = state?.player;
  return levelFromTotal(p?.totalXp ?? 0);
}

/**
 * Kayıt doğrulayıcı + eski kayıt göçü.
 * Aşama 2 kayıtlarında player.xp toplam XP'ydi ve seviye hiç artmıyordu. totalXp yoksa / tutarsız düşükse
 * totalXp = cumulativeXp(level) + xp (level yoksa 1) alınır; sonra level ve xp totalXp'den yeniden hesaplanır.
 * (SaveSystem fillDefaults eksik totalXp'yi 0 yaptığı için "yok" ile "0" ayırt edilmez — bu kural ikisini de kapsar.)
 */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.player)) { onFix('player'); ensurePlayer(state); }
  const p = state.player;
  let level = p.level;
  if (!(Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL)) {
    if (level !== undefined) onFix('player.level');
    level = Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(level))) : 1;
  }
  let xp = Number(p.xp);
  if (!(Number.isFinite(xp) && xp >= 0)) { if (p.xp !== undefined) onFix('player.xp'); xp = 0; }
  let total = Number(p.totalXp);
  if (!(Number.isFinite(total) && total >= 0)) { if (p.totalXp !== undefined) onFix('player.totalXp'); total = 0; }
  const implied = cumulativeXp(level) + (level >= MAX_LEVEL ? 0 : Math.floor(xp)); // MAX'ta xp yalnızca gösterim
  if (total < implied) { onFix('player.totalXp'); total = implied; }
  total = Math.floor(total);
  const cur = levelFromTotal(total);
  if (p.level !== cur.level || p.xp !== cur.xp || p.totalXp !== total) {
    if (p.level !== cur.level) onFix('player.level');
    p.level = cur.level; p.xp = cur.xp; p.totalXp = total;
  }
  return state;
}

const ProgressionSystem = {
  id: 'progression',
  addXp, levelFromTotal, cumulativeXp, progress, validate,

  init(state, bus) {
    for (const off of offs) off();
    offs = [];
    validate(state, () => {}); // yeni oyun / doğrulayıcısız yükleme için tutarlılık
    offs.push(bus.on('xp:add', (e) => {
      if (!e) return;
      addXp(state, bus, e.amount, e.reason ?? 'other');
    }));
  },
};

export default ProgressionSystem;
