// SaveSystem — localStorage, versiyonlu şema, migrasyon, otomatik kayıt, bozuk kayda karşı güvenli yükleme.
import { SAVE_KEY, SAVE_VERSION } from './constants.js';
import { createInitialState, fillDefaults } from './GameState.js';

export const BACKUP_KEY = `${SAVE_KEY}:backup`;
const MIN_AUTOSAVE_GAP_MS = 1000; // time:hour yüksek hızda/skip'te kayıt fırtınası yapmasın

/**
 * migrations[v](state) → v sürümlü kaydı v+1'e çevirir (yerinde veya yeni nesne döndürerek).
 * Örnek (ileride): 1: (s) => { s.newField = ...; s.version = 2; return s; }
 */
export const migrations = {};

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/** Ham JSON → geçerli, güncel sürümlü state veya null. */
function parseSave(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  let v = Number(s.version);
  if (!Number.isInteger(v) || v < 1 || v > SAVE_VERSION) return null;
  try {
    while (v < SAVE_VERSION) {
      const m = migrations[v];
      if (!m) return null;
      s = m(s) || s;
      v += 1;
      s.version = v;
    }
  } catch (e) {
    console.warn('[save] migrasyon hatası', e);
    return null;
  }
  if (!s.time || !Number.isFinite(s.time.totalMinutes) || s.time.totalMinutes < 0) return null;
  fillDefaults(s, createInitialState(Number.isFinite(s.rngSeed) ? s.rngSeed : undefined));
  if (!Number.isFinite(s.time.speed)) s.time.speed = 1;
  const c = s.camera;
  if (c && !(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.zoom))) s.camera = null;
  return s;
}

const SaveSystem = {
  /** Son yüklemenin sonucu: 'ok' | 'backup' | 'none' | 'corrupt' */
  lastLoad: 'none',
  _bus: null,
  _state: null,
  _lastSaveAt: 0,
  _pending: 0,
  _disabled: false,
  _quotaWarned: false,

  /** @returns {object|null} */
  load() {
    const ls = storage();
    if (!ls) { this.lastLoad = 'none'; return null; }
    let raw = null, rawB = null;
    try { raw = ls.getItem(SAVE_KEY); rawB = ls.getItem(BACKUP_KEY); } catch { /* erişim yok */ }
    if (raw == null && rawB == null) { this.lastLoad = 'none'; return null; }
    const main = parseSave(raw);
    if (main) { this.lastLoad = 'ok'; return main; }
    const backup = parseSave(rawB);
    if (backup) {
      console.warn('[save] ana kayıt okunamadı, yedekten yüklendi');
      this.lastLoad = 'backup';
      return backup;
    }
    console.warn('[save] kayıt ve yedek okunamadı, yeni oyun');
    this.lastLoad = 'corrupt';
    return null;
  },

  /** @returns {boolean} başarılı mı */
  save(state = this._state) {
    if (this._disabled || !state) return false;
    const ls = storage();
    if (!ls) return false;
    this._bus?.emit('save:before', {}); // ör. CameraDirector state.camera'yı tazeler
    try {
      const json = JSON.stringify(state);
      const prev = ls.getItem(SAVE_KEY);
      if (prev && prev !== json && parseSave(prev)) ls.setItem(BACKUP_KEY, prev);
      ls.setItem(SAVE_KEY, json);
      this._lastSaveAt = Date.now();
      this._bus?.emit('save:done', {});
      return true;
    } catch (e) {
      console.warn('[save] yazılamadı', e);
      if (!this._quotaWarned) {
        this._quotaWarned = true;
        this._bus?.emit('toast', { text: 'Oyun kaydedilemedi (depolama dolu veya kapalı).', kind: 'bad' });
      }
      return false;
    }
  },

  /** Kayıtları siler. */
  reset() {
    this._disabled = true; // pagehide'da eski state'i geri yazmasın
    const ls = storage();
    try { ls?.removeItem(SAVE_KEY); ls?.removeItem(BACKUP_KEY); } catch { /* yok say */ }
  },

  /** Otomatik kaydı bağlar. */
  attach(state, bus) {
    this._state = state;
    this._bus = bus;
    bus.on('time:hour', () => this._autosave());
    bus.on('save:request', () => this.save());
    bus.on('save:reset', () => {
      this.reset();
      try { window.location.reload(); } catch { /* yok say */ }
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.save();
      });
      window.addEventListener('pagehide', () => this.save());
    }
  },

  _autosave() {
    const gap = Date.now() - this._lastSaveAt;
    if (gap >= MIN_AUTOSAVE_GAP_MS) { this.save(); return; }
    if (this._pending) return;
    this._pending = setTimeout(() => { this._pending = 0; this.save(); }, MIN_AUTOSAVE_GAP_MS - gap);
  },
};

export default SaveSystem;
