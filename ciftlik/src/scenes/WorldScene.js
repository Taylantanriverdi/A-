// WorldScene — sabit adımlı simülasyon + değişken adımlı render.
// update: registry.tick → camera.update → renderer.update(frame)
import Phaser from 'phaser';
import Renderer from '../render/Renderer.js';
import CameraDirector from '../render/CameraDirector.js';
import Cinematics from '../core/Cinematics.js';
import { MIN_PER_DAY, DAYS_PER_SEASON, SEASONS } from '../core/constants.js';

/** timeUtils.calendar ile aynı hesap, ama tek nesneyi yeniden kullanır (kare başına ayırma yok). */
function calendarInto(out, totalMinutes) {
  const dayIndex = Math.floor(totalMinutes / MIN_PER_DAY);
  const minOfDay = totalMinutes - dayIndex * MIN_PER_DAY;
  const seasonAbs = Math.floor(dayIndex / DAYS_PER_SEASON);
  const seasonIndex = seasonAbs % 4;
  out.day = dayIndex + 1;
  out.dayOfSeason = (dayIndex % DAYS_PER_SEASON) + 1;
  out.hour = Math.floor(minOfDay / 60);
  out.minute = Math.floor(minOfDay % 60);
  out.season = SEASONS[seasonIndex];
  out.seasonIndex = seasonIndex;
  out.year = Math.floor(seasonAbs / 4) + 1;
  out.dayFraction = minOfDay / MIN_PER_DAY;
  return out;
}

const INTRO_FADE_MS = 700;
const RECOVER_WINDOW_MS = 5000; // kurulum sonrası bu süre içindeki simülasyon istisnası → kayıt kurtarma

export default class WorldScene extends Phaser.Scene {
  constructor(app) {
    super({ key: 'World' });
    this.app = app;
    this.frame = { time: 0, delta: 0, totalMinutes: 0, cal: {}, zoom: 1, dpr: 1 };
    this._renderErr = false;
    this._intro = false;
    this._introStart = 0;
    this._createdAt = 0;
    this._failed = false;
  }

  create() {
    try {
      this._create();
    } catch (e) {
      this._failed = true;
      console.error('[world] create', e);
      this.app.recover?.(e);
    }
  }

  _create() {
    const { state, bus } = this.app;
    this.cameras.main.setBackgroundColor('#05060c');

    this.renderer2 = null;
    try {
      this.renderer2 = new Renderer(this, state, bus);
      this.renderer2.create();
    } catch (e) {
      console.error('[world] Renderer.create', e);
    }
    this.camera = new CameraDirector(this, state, bus);
    this.app.camera = this.camera;
    this.cinematics = new Cinematics(bus);

    // Kalite: Renderer yaratıldıktan sonra da ilk değer ulaşsın.
    const applyQuality = ({ level }) => {
      try { this.renderer2?.setQuality(level); } catch (e) { console.error('[world] setQuality', e); }
    };
    const offQ = bus.on('settings:quality', applyQuality);
    bus.emit('settings:quality', { level: this.app.quality });

    // Açılış fade'i: bitene kadar simülasyon durur; süre gerçek zamana (performance.now) bağlıdır,
    // Phaser'ın kırpılmış kare deltası düşük FPS'te fade'i uzatmasın.
    this.cameras.main.fadeIn(INTRO_FADE_MS, 5, 6, 12);
    this._intro = true;
    this._introStart = performance.now();
    this._createdAt = this._introStart;
    this.events.once('shutdown', () => {
      offQ();
      this.cinematics?.destroy();
      try { this.renderer2?.destroy(); } catch { /* yok say */ }
    });
  }

  update(time, delta) {
    const { state, registry } = this.app;
    // Phaser'ın `delta`sı yumuşatılmış/kırpılmış olabilir (düşük FPS'te 16.6 ms'ye sabitlenir);
    // oyun zamanı gerçek süreye bağlı kalsın diye ham kare süresi kullanılır (registry 250 ms'de kırpar).
    const raw = this.game.loop.rawDelta;
    const real = raw > 0 && raw < 5000 ? raw : delta;
    if (this._failed) return;
    if (this._intro) this._updateIntro();
    try {
      if (!this._intro) registry.tick(real);
      this.camera.update(real);
    } catch (e) {
      this._failed = true;
      console.error('[world] update', e);
      if (performance.now() - this._createdAt < RECOVER_WINDOW_MS) this.app.recover?.(e);
      return;
    }
    const f = this.frame;
    f.time = time;
    f.delta = real;
    f.totalMinutes = state.time.totalMinutes + registry.fraction;
    calendarInto(f.cal, f.totalMinutes);
    f.zoom = this.camera.zoom;
    f.dpr = this.camera.dpr;
    if (!this.renderer2) return;
    try {
      this.renderer2.update(f);
    } catch (e) {
      if (!this._renderErr) { this._renderErr = true; console.error('[world] Renderer.update', e); }
    }
  }

  /** Fade ilerlemesini gerçek zamana eşitler; süre dolunca efekti bitirir ve simülasyonu açar. */
  _updateIntro() {
    const fx = this.cameras.main.fadeEffect;
    const el = performance.now() - this._introStart;
    if (fx && fx.isRunning) {
      if (el >= fx.duration) {
        fx.alpha = 0;
        fx.progress = 1;
        fx.effectComplete();
      } else if (fx._elapsed < el) {
        fx._elapsed = el;
      }
    }
    if (!fx || !fx.isRunning || el >= INTRO_FADE_MS) this._intro = false;
  }
}
