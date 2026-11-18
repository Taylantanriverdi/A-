// SaveSystem — localStorage, versiyonlu şema, migrasyon, otomatik kayıt, bozuk kayda karşı güvenli yükleme.
import { SAVE_KEY, SAVE_VERSION, SPEEDS, START_MINUTES, MIN_PER_DAY, DAYS_PER_SEASON } from './constants.js';
import { createInitialState, fillDefaults, isPlainObject } from './GameState.js';

export const BACKUP_KEY = `${SAVE_KEY}:backup`;
export const CORRUPT_KEY = `${SAVE_KEY}:corrupt`;
/** Ayarlar oyun kaydından ayrı tutulur: "Yeni oyun" kalite/ses tercihlerini silmez. */
export const SETTINGS_KEY = 'altin-saat-ciftligi:settings';
export const QUALITY_VALUES = ['auto', 'high', 'medium', 'low'];
const MAX_TOTAL_MINUTES = 100 * 4 * DAYS_PER_SEASON * MIN_PER_DAY; // 100 oyun yılı
const MIN_AUTOSAVE_GAP_MS = 1000; // time:hour yüksek hızda/skip'te kayıt fırtınası yapmasın

/**
 * migrations[v](state) → v sürümlü kaydı v+1'e çevirir (yerinde veya yeni nesne döndürerek).
 * Örnek (ileride): 1: (s) => { s.newField = ...; s.version = 2; return s; }
 */
export const migrations = {};

/**
 * Sistem doğrulayıcıları: fn(state, onFix). sanitize() şema temizlemesinden SONRA sırayla çağırır.
 * Her sistem kendi alanının dizi/sözlük elemanlarını doğrular (PLAN §1 "Kayıt sistemi" kuralı).
 */
const validators = [];

/** @param {(state:object, onFix:(path:string)=>void)=>void} fn */
export function registerValidator(fn) {
  if (typeof fn === 'function' && !validators.includes(fn)) validators.push(fn);
}

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function clamp01(v, d) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Ayar nesnesini yerinde doğrular (quality/sound/music). Düzeltilen alan adlarını onFix'e bildirir.
 * @param {object} st settings nesnesi (düz nesne olmalı)
 */
export function sanitizeSettings(st, onFix = () => {}) {
  const d = createInitialState(1).settings;
  if (!QUALITY_VALUES.includes(st.quality)) { onFix('settings.quality'); st.quality = d.quality; }
  for (const k of ['sound', 'music']) {
    const v = clamp01(st[k], d[k]);
    if (v !== st[k]) { onFix(`settings.${k}`); st[k] = v; }
  }
  return st;
}

/**
 * Şema doğrulama/temizleme: createInitialState() referans alınarak tip onarımı (fillDefaults) +
 * değer doğrulaması. Yerinde çalışır.
 * @param {object} s
 * @returns {{state:object, repairs:string[]}}
 */
export function sanitize(s) {
  const repairs = [];
  const fix = (p) => repairs.push(p);
  const seedOk = typeof s.rngSeed === 'number' && Number.isFinite(s.rngSeed);
  const defaults = createInitialState(seedOk ? s.rngSeed >>> 0 || 123456 : undefined);
  fillDefaults(s, defaults, fix);
  s.version = SAVE_VERSION;

  // zaman
  const t = s.time;
  if (!SPEEDS.includes(t.speed)) { fix('time.speed'); t.speed = 1; }
  if (!(t.totalMinutes >= 0 && t.totalMinutes <= MAX_TOTAL_MINUTES)) {
    fix('time.totalMinutes'); t.totalMinutes = START_MINUTES;
  } else if (!Number.isInteger(t.totalMinutes)) {
    t.totalMinutes = Math.floor(t.totalMinutes);
  }

  // hava
  const w = s.weather;
  if (w.type.length === 0) { fix('weather.type'); w.type = defaults.weather.type; }
  const wi = clamp01(w.intensity, 0);
  if (wi !== w.intensity) { fix('weather.intensity'); w.intensity = wi; }

  // ayarlar
  sanitizeSettings(s.settings, fix);

  // arazi: parsel girdileri {id:string, owned:boolean}
  const parcels = s.land.parcels.filter((p) => isPlainObject(p) && typeof p.id === 'string');
  if (parcels.length !== s.land.parcels.length) fix('land.parcels');
  s.land.parcels = parcels.length ? parcels : defaults.land.parcels;
  for (const p of s.land.parcels) if (typeof p.owned !== 'boolean') { p.owned = p.id === 'P1'; }

  // kamera
  const c = s.camera;
  if (c !== null && !(isPlainObject(c) && Number.isFinite(c.x) && Number.isFinite(c.y)
    && Number.isFinite(c.zoom) && c.zoom > 0)) {
    if (c !== undefined) fix('camera');
    s.camera = null;
  }

  // rastgele üretici durumu (fillDefaults sayı olmayanları yeniden üretti); 32-bit aralığa çek
  s.rngSeed = s.rngSeed >>> 0;
  s.rngState |= 0;

  // sistem doğrulayıcıları (biri istisna atarsa diğerleri yine çalışır)
  for (let i = 0; i < validators.length; i++) {
    try {
      validators[i](s, fix);
    } catch (e) {
      console.error('[save] doğrulayıcı hatası', validators[i].name || i, e);
    }
  }
  return { state: s, repairs };
}

/** Ham JSON → geçerli, güncel sürümlü state veya null. Onarılan alanlar out.repairs'e eklenir. */
function parseSave(raw, out) {
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
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  try {
    const { repairs } = sanitize(s);
    if (out) out.repairs = repairs;
  } catch (e) {
    console.warn('[save] doğrulama hatası', e);
    return null;
  }
  return s;
}

const SaveSystem = {
  /** Son yüklemenin sonucu: 'ok' | 'backup' | 'none' | 'corrupt' */
  lastLoad: 'none',
  /** Son yüklemede onarılan alanlar (boş değilse UI uyarısı gösterilir). */
  lastRepairs: [],
  _bus: null,
  _state: null,
  _lastSaveAt: 0,
  _pending: 0,
  _disabled: false,
  _quotaWarned: false,

  /** Sistem doğrulayıcısı kaydı — load()'dan ÖNCE çağrılmalı. */
  registerValidator(fn) { registerValidator(fn); },

  /** @returns {object|null} */
  load() {
    const ls = storage();
    if (!ls) { this.lastLoad = 'none'; return null; }
    let raw = null, rawB = null;
    try { raw = ls.getItem(SAVE_KEY); rawB = ls.getItem(BACKUP_KEY); } catch { /* erişim yok */ }
    if (raw == null && rawB == null) { this.lastLoad = 'none'; return null; }
    const info = { repairs: [] };
    const main = parseSave(raw, info);
    if (main) {
      this.lastLoad = 'ok';
      this.lastRepairs = info.repairs;
      if (info.repairs.length) console.warn('[save] onarılan alanlar:', info.repairs.join(', '));
      return main;
    }
    // Okunamayan ana kaydı incelenebilsin diye karantinaya al (sonraki kayıt üstüne yazmadan önce).
    if (raw != null) { try { ls.setItem(CORRUPT_KEY, raw); } catch { /* kota */ } }
    const backup = parseSave(rawB, info);
    if (backup) {
      console.warn('[save] ana kayıt okunamadı, yedekten yüklendi');
      this.lastLoad = 'backup';
      this.lastRepairs = info.repairs;
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
      ls.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
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

  /**
   * Ayrı ayar anahtarını okur; geçerliyse state.settings'e uygular (ayarlar kayıttan önceliklidir).
   * Anahtar yoksa mevcut state.settings ile oluşturur.
   */
  applyStoredSettings(state) {
    const ls = storage();
    if (!ls) return;
    let raw = null;
    try { raw = ls.getItem(SETTINGS_KEY); } catch { /* yok say */ }
    let st = null;
    if (raw) { try { st = JSON.parse(raw); } catch { st = null; } }
    if (isPlainObject(st)) {
      sanitizeSettings(st);
      for (const k of Object.keys(state.settings)) if (k in st) state.settings[k] = st[k];
    }
    this.saveSettings(state.settings);
  },

  /** Ayarları ayrı anahtara yazar. */
  saveSettings(settings = this._state?.settings) {
    if (!settings) return;
    try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* yok say */ }
  },

  /**
   * Kurulumda istisna atan kaydı karantinaya alır: ham veri CORRUPT_KEY'e taşınır, ana kayıt ve
   * yedek silinir, otomatik kayıt kapatılır (pagehide bozuk state'i geri yazmasın).
   */
  quarantine() {
    this._disabled = true;
    const ls = storage();
    if (!ls) return;
    try {
      const raw = ls.getItem(SAVE_KEY) ?? ls.getItem(BACKUP_KEY);
      if (raw != null) ls.setItem(CORRUPT_KEY, raw);
    } catch { /* kota vb. — yine de sil */ }
    try { ls.removeItem(SAVE_KEY); ls.removeItem(BACKUP_KEY); } catch { /* yok say */ }
  },

  /** Kayıtları siler (ayarlar anahtarı korunur). */
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
      this.saveSettings(state.settings);
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
