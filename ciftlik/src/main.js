// Giriş noktası — Phaser yapılandırması, sistem kaydı, kayıt, ayarlar, debug kancası.
import Phaser from 'phaser';
import bus from './core/EventBus.js';
import { calendar } from './core/timeUtils.js';
import { createInitialState } from './core/GameState.js';
import SaveSystem from './core/SaveSystem.js';
import SystemRegistry from './core/SystemRegistry.js';
import { SPEEDS, MIN_PER_DAY, TILE_W, TILE_H } from './core/constants.js';
import TimeSystem from './systems/TimeSystem.js';
import WeatherSystem from './systems/WeatherSystem.js';
import EventSystem from './systems/EventSystem.js';
import PlacementSystem from './systems/PlacementSystem.js';
import FarmSystem from './systems/FarmSystem.js';
import InventorySystem from './systems/InventorySystem.js';
import AnimalSystem from './systems/AnimalSystem.js';
import ProductionSystem from './systems/ProductionSystem.js';
import BankSystem from './systems/BankSystem.js';
import ContractSystem from './systems/ContractSystem.js';
import LandSystem from './systems/LandSystem.js';
import VehicleSystem from './systems/VehicleSystem.js';
import DefenseSystem from './systems/DefenseSystem.js';
import WorkerSystem, { followTarget, debugSummary } from './systems/WorkerSystem.js';
import { QUALITY } from './data/farming.js';
import BootScene from './scenes/BootScene.js';
import WorldScene from './scenes/WorldScene.js';
import { mountUI } from './ui/index.js';

// Aşama 3 sistemleri (PLAN §9): MarketSystem ('market'), EconomySystem ('economy'), ProgressionSystem ('progression').
// Paralel geliştirme sırasında dosya henüz yoksa derleme kırılmasın diye eager glob ile alınır:
// var olan dosya statik import gibi pakete girer; olmayan atlanır (konsola uyarı).
const OPTIONAL_SYSTEMS = import.meta.glob(
  ['./systems/MarketSystem.js', './systems/EconomySystem.js', './systems/ProgressionSystem.js'],
  { eager: true, import: 'default' },
);
function optionalSystem(file, id) {
  const sys = OPTIONAL_SYSTEMS[`./systems/${file}`];
  if (!sys) { console.warn(`[main] ${file} bulunamadı; '${id}' sistemi kayıtsız`); return null; }
  return sys;
}
const MarketSystem = optionalSystem('MarketSystem.js', 'market');
const EconomySystem = optionalSystem('EconomySystem.js', 'economy');
const ProgressionSystem = optionalSystem('ProgressionSystem.js', 'progression');
// Kayıt sırası (PLAN §9): Time → Inventory → Farm → Market → Economy → Progression
const SYSTEMS = [TimeSystem, WeatherSystem, EventSystem, InventorySystem, PlacementSystem, FarmSystem, AnimalSystem, ProductionSystem, MarketSystem, EconomySystem, BankSystem, ContractSystem, /* ProgressionSystem — K20: seviye sistemi kaldırıldı */ LandSystem, VehicleSystem, DefenseSystem, WorkerSystem].filter(Boolean);

const RECOVER_FLAG = 'altin-saat-ciftligi:recovered';
const params = new URLSearchParams(window.location.search);

// ------------------------------------------------------------------ kurtarma
// Yüklenen kayıtla kurulum istisna atarsa: kayıt :corrupt anahtarına taşınır, sayfa yeni oyunla
// yeniden açılır ve toast gösterilir. Yeni oyunla da başarısız olursa DOM'da hata mesajı gösterilir.
let loadedFromSave = false;
let recovering = false;
function showFatal(err) {
  console.error('[main] kurulum hatası', err);
  try {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'background:#05060c;color:#f5ecd9;font:16px Georgia,serif;text-align:center;padding:24px;z-index:9999';
    el.textContent = 'Oyun başlatılamadı. Sayfayı yenilemeyi deneyin.';
    document.body.appendChild(el);
  } catch { /* yok say */ }
}
function recover(err) {
  if (recovering) return;
  recovering = true;
  if (!loadedFromSave) { showFatal(err); return; }
  console.error('[main] kayıtla kurulum başarısız; kayıt karantinaya alınıp yeni oyun açılıyor', err);
  SaveSystem.quarantine();
  try { window.sessionStorage.setItem(RECOVER_FLAG, '1'); } catch { /* yok say */ }
  try { window.location.reload(); } catch { showFatal(err); }
}

let recoveredNow = false;
try {
  recoveredNow = window.sessionStorage.getItem(RECOVER_FLAG) === '1';
  if (recoveredNow) window.sessionStorage.removeItem(RECOVER_FLAG);
} catch { /* yok say */ }

// ------------------------------------------------------------------ durum + sistemler
let state, registry;

// Sistem doğrulayıcıları load()'dan ÖNCE kaydedilir (sanitize şema temizlemesinden sonra çağırır).
for (const sys of SYSTEMS) {
  if (sys && typeof sys.validate === 'function') {
    const v = (st, onFix) => sys.validate(st, onFix);
    Object.defineProperty(v, 'name', { value: `${sys.id || 'system'}.validate` });
    SaveSystem.registerValidator(v);
  }
}

try {
  const loaded = SaveSystem.load();
  loadedFromSave = !!loaded;
  state = loaded ?? createInitialState();
  SaveSystem.applyStoredSettings(state);
  registry = new SystemRegistry(state, bus);
  for (const sys of SYSTEMS) registry.register(sys);
  SaveSystem.attach(state, bus);
} catch (e) {
  recover(e);
  throw e;
}

// ------------------------------------------------------------------ kalite + DPR
const QUALITY_LEVELS = ['high', 'medium', 'low'];
const DPR_CAP = { high: 2, medium: 1.5, low: 1 };

function resolveQuality(q) {
  if (QUALITY_LEVELS.includes(q)) return q;
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return touch && shortSide < 900 ? 'medium' : 'high';
}

const app = { state, bus, registry, quality: 'high', camera: null, game: null, recover };
try { app.quality = resolveQuality(state.settings.quality); } catch (e) { recover(e); throw e; }
let renderDpr = 1;
function computeDpr(level) {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, DPR_CAP[level] || 1));
}
renderDpr = computeDpr(app.quality);

// Phaser 3.80'de `resolution` yok; Scale.RESIZE canvas'ı CSS pikseliyle boyutlar.
// Ebeveyn boyutunu DPR ile ölçekleyerek canvas'ı aygıt pikseliyle (en fazla 2x) çizdiriyoruz;
// CSS boyutu %100 kalır, Phaser displayScale ile girişi doğru dönüştürür. Kamera zoom'u × dpr.
Phaser.Scale.ScaleManager.prototype.getParentBounds = function getParentBoundsDpr() {
  if (!this.parent) return false;
  const rect = this.parent.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * renderDpr));
  const h = Math.max(1, Math.floor(rect.height * renderDpr));
  const ps = this.parentSize;
  if (ps.width !== w || ps.height !== h) { ps.setSize(w, h); return true; }
  if (this.canvas) {
    const cb = this.canvasBounds;
    const cr = this.canvas.getBoundingClientRect();
    if (cr.x !== cb.x || cr.y !== cb.y) return true;
  }
  return false;
};

function setRenderDpr(dpr) {
  if (dpr === renderDpr) return;
  renderDpr = dpr;
  const g = app.game;
  if (!g) return;
  g.registry.set('dpr', dpr);
  g.scale.getParentBounds();
  g.scale.refresh();
}

function setQuality(level) {
  app.quality = level;
  setRenderDpr(computeDpr(level));
  bus.emit('settings:quality', { level });
}

bus.on('settings:set', (p) => {
  if (!p || typeof p.key !== 'string') return;
  const { key, value } = p;
  if (!(key in state.settings)) return;
  if (key === 'quality') {
    if (value !== 'auto' && !QUALITY_LEVELS.includes(value)) return;
    state.settings.quality = value;
    setQuality(resolveQuality(value));
  } else if (key === 'sound' || key === 'music') {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    state.settings[key] = Math.max(0, Math.min(1, v));
  } else if (key === 'raids') {
    if (typeof value !== 'boolean') return;
    state.settings.raids = value;
    bus.emit('defense:mode', { on: value });   // K29: DefenseSystem yapı canlarını kurar / gece durumunu sıfırlar
  } else {
    state.settings[key] = value;
  }
  SaveSystem.saveSettings(state.settings);
  bus.emit('save:request', {});
});

// ------------------------------------------------------------------ Phaser
// ?renderer=canvas → Canvas renderer (test / zayıf cihaz yedeği). Varsayılan AUTO.
const RENDER_TYPE = params.get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO;
let game;
try {
  game = new Phaser.Game({
    type: RENDER_TYPE,
    parent: 'game',
    backgroundColor: '#05060c',
    antialias: true,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.floor(window.innerWidth * renderDpr),
      height: Math.floor(window.innerHeight * renderDpr),
    },
    render: { antialias: true, powerPreference: 'high-performance' },
    input: { touch: true, mouse: { preventDefaultWheel: true }, activePointers: 3 },
    fps: { target: 60, smoothStep: true },
    callbacks: {
      preBoot: (g) => { g.registry.set('dpr', renderDpr); },
      postBoot: (g) => {
        const c = g.canvas;
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
        g.scale.refresh();
      },
    },
    scene: [new BootScene(app), new WorldScene(app)],
  });
} catch (e) {
  recover(e);
  throw e;
}
app.game = game;

// Aşama 5: çalışan takibi — panel `camera:follow {workerId|null}` yayar; kamera canlı (interpolasyonlu) konumu izler.
bus.on('camera:follow', (p) => {
  const cam = app.camera;
  if (!cam) return;
  cam.follow(p && p.workerId ? followTarget(state, p.workerId) : null);
});

// ------------------------------------------------------------------ debug kancası
const DEBUG = import.meta.env.DEV || params.get('debug') === '1';

const debug = {
  setTime(h) {
    const hour = Math.max(0, Math.min(23, Math.floor(Number(h) || 0)));
    const dayIndex = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
    state.time.totalMinutes = dayIndex * MIN_PER_DAY + hour * 60;
    registry.resetFraction();
    const now = calendar(state.time.totalMinutes);
    registry.ctx.now = now;
    bus.emit('time:hour', now);
    bus.emit('time:minute', now);
  },
  skip(minutes) {
    const n = Math.max(0, Math.floor(Number(minutes) || 0));
    registry.advance(n, false);
  },
  setSpeed(x) { bus.emit('time:speed', { speed: Number(x) }); },
  setWeather(type) {
    bus.emit('weather:set', { type: String(type) }); // WeatherSystem işler (PLAN §14)
  },
  /** Olay zorla: 'drought' | 'hail' | 'frost' | 'outbreak' | 'priceCrash' | 'subsidy' | 'pestWave' | 'festival' */
  event(kind) { bus.emit('event:force', { kind: String(kind) }); },
  /** EconomySystem varsa transact (kategori 'other', defter + özet); yoksa eski doğrudan yazım. */
  addMoney(n) {
    const amount = Math.round(Number(n) || 0);
    if (!amount) return false;
    if (EconomySystem && typeof EconomySystem.transact === 'function') {
      return EconomySystem.transact(state, bus, { amount, category: 'other', label: 'Debug' });
    }
    state.finance.money += amount;
    bus.emit('money:changed', { amount, balance: state.finance.money, category: 'other' });
    return true;
  },
  /** En değerli (kalite × organik) yığından market:sell; adet o (q, organic) toplamıyla sınırlanır. */
  sell(itemId, qty = 1, channel = 'market') {
    const stacks = state.inventory.items[itemId];
    if (!Array.isArray(stacks) || !stacks.length) { console.warn('[debug] envanterde yok:', itemId); return null; }
    const value = (st) => (QUALITY.priceMult[st.q] || 0) * (st.organic ? 1 + QUALITY.organicBonus : 1);
    let best = stacks[0];
    for (const st of stacks) if (value(st) > value(best)) best = st;
    let have = 0;
    for (const st of stacks) if (st.q === best.q && !!st.organic === !!best.organic) have += st.qty;
    const n = Math.max(1, Math.min(have, Math.floor(Number(qty) || 1)));
    const p = { itemId, q: best.q, organic: !!best.organic, qty: n, channel };
    bus.emit('market:sell', p);
    return p;
  },
  buy(itemId, qty = 1) { bus.emit('shop:buy', { itemId, qty: Math.max(1, Math.floor(Number(qty) || 1)) }); },
  xp(n) { bus.emit('xp:add', { amount: Number(n) || 0, reason: 'debug' }); },
  open(panel) { bus.emit('ui:open', { panel }); },
  /** Çalışan durum özeti (konum, mod, görev, eşek). */
  worker() { const r = debugSummary(state); console.log(r); return r; },
  cinematic() {
    bus.emit('camera:cinematic', {
      target: { x: 36 * TILE_W, y: 9 * TILE_H }, zoom: 1.6, duration: 3000, letterbox: true, reason: 'debug',
    });
  },
  quality(level) { bus.emit('settings:set', { key: 'quality', value: level }); },
  addItem(id, qty = 10, q = 'B') { bus.emit('inventory:add', { itemId: id, qty: Number(qty) || 0, quality: q }); },
  grow(days) { debug.skip(Math.max(0, Number(days) || 0) * MIN_PER_DAY); },
  tool(t) { bus.emit('tool:select', { tool: t }); },
  /** K29: Gece İstilası modunu aç/kapat. */
  raidsOn(on = true) { bus.emit('settings:set', { key: 'raids', value: !!on }); return state.settings.raids; },
  /** K29: modu açar, saati 20:55'e alır ve bu gece baskın kurar (kızıl ay isteğe bağlı). */
  raid(bloodMoon = false) {
    debug.raidsOn(true);
    const dayIndex = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
    state.time.totalMinutes = dayIndex * MIN_PER_DAY + 20 * 60 + 55;
    registry.resetFraction();
    const now = calendar(state.time.totalMinutes);
    registry.ctx.now = now;
    registry.get('defense').forceRaid(state, bus, !!bloodMoon);
    bus.emit('time:hour', now);
    bus.emit('time:minute', now);
  },
  speeds: SPEEDS,
};

if (DEBUG) {
  window.__game = { state, bus, registry, app, game, debug };
}

// ------------------------------------------------------------------ UI
try {
  mountUI({ state, bus, calendar, debug: DEBUG });
} catch (e) {
  console.error('[main] mountUI', e);
}
bus.emit('settings:quality', { level: app.quality });
bus.emit('time:speedChanged', { speed: state.time.speed });

if (recoveredNow) {
  bus.emit('toast', { text: 'Kayıt yüklenemedi; bozuk kayıt ayrıldı ve yeni bir oyun başlatıldı.', kind: 'bad' });
} else if (SaveSystem.lastLoad === 'backup') {
  bus.emit('toast', { text: 'Son kayıt okunamadı; yedek kayıttan devam ediliyor.', kind: 'bad' });
} else if (SaveSystem.lastLoad === 'corrupt') {
  bus.emit('toast', { text: 'Kayıt dosyası bozuk; yeni bir oyun başlatıldı.', kind: 'bad' });
}
if (SaveSystem.lastRepairs.length && SaveSystem.lastLoad !== 'corrupt') {
  bus.emit('toast', { kind: 'bad', text: 'Kayıttaki bazı bozuk veriler onarıldı.' });
}
