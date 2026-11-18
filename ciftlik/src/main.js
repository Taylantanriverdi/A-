// Giriş noktası — Phaser yapılandırması, sistem kaydı, kayıt, ayarlar, debug kancası.
import Phaser from 'phaser';
import bus from './core/EventBus.js';
import { calendar } from './core/timeUtils.js';
import { createInitialState } from './core/GameState.js';
import SaveSystem from './core/SaveSystem.js';
import SystemRegistry from './core/SystemRegistry.js';
import { SPEEDS, MIN_PER_DAY, TILE_W, TILE_H } from './core/constants.js';
import TimeSystem from './systems/TimeSystem.js';
import BootScene from './scenes/BootScene.js';
import WorldScene from './scenes/WorldScene.js';
import { mountUI } from './ui/index.js';

// ------------------------------------------------------------------ durum + sistemler
const loaded = SaveSystem.load();
const state = loaded ?? createInitialState();
if (!('camera' in state)) state.camera = null;

const registry = new SystemRegistry(state, bus);
registry.register(TimeSystem);
SaveSystem.attach(state, bus);

// ------------------------------------------------------------------ kalite + DPR
const QUALITY_LEVELS = ['high', 'medium', 'low'];
const DPR_CAP = { high: 2, medium: 1.5, low: 1 };

function resolveQuality(q) {
  if (QUALITY_LEVELS.includes(q)) return q;
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return touch && shortSide < 900 ? 'medium' : 'high';
}

const app = { state, bus, registry, quality: resolveQuality(state.settings.quality), camera: null, game: null };
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
  } else {
    state.settings[key] = value;
  }
  bus.emit('save:request', {});
});

// ------------------------------------------------------------------ Phaser
const game = new Phaser.Game({
  type: Phaser.AUTO,
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
app.game = game;

// ------------------------------------------------------------------ debug kancası
const DEBUG = import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === '1';

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
    const w = state.weather;
    w.type = String(type);
    if (w.type === 'clear') w.intensity = 0; else if (!(w.intensity > 0)) w.intensity = 0.6;
    bus.emit('weather:changed', { type: w.type, intensity: w.intensity, wind: w.wind });
  },
  addMoney(n) {
    const amount = Number(n) || 0;
    state.finance.money += amount;
    bus.emit('money:changed', { amount, balance: state.finance.money, category: 'debug' });
  },
  cinematic() {
    bus.emit('camera:cinematic', {
      target: { x: 36 * TILE_W, y: 9 * TILE_H }, zoom: 1.6, duration: 3000, letterbox: true, reason: 'debug',
    });
  },
  quality(level) { bus.emit('settings:set', { key: 'quality', value: level }); },
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

if (SaveSystem.lastLoad === 'backup') {
  bus.emit('toast', { text: 'Son kayıt okunamadı; yedek kayıttan devam ediliyor.', kind: 'bad' });
} else if (SaveSystem.lastLoad === 'corrupt') {
  bus.emit('toast', { text: 'Kayıt dosyası bozuk; yeni bir oyun başlatıldı.', kind: 'bad' });
}
