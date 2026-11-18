// WorldScene — sabit adımlı simülasyon + değişken adımlı render.
// update: registry.tick → camera.update → renderer.update(frame)
import Phaser from 'phaser';
import Renderer from '../render/Renderer.js';
import CameraDirector from '../render/CameraDirector.js';
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

export default class WorldScene extends Phaser.Scene {
  constructor(app) {
    super({ key: 'World' });
    this.app = app;
    this.frame = { time: 0, delta: 0, totalMinutes: 0, cal: {}, zoom: 1, dpr: 1 };
    this._renderErr = false;
  }

  create() {
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

    // Kalite: Renderer yaratıldıktan sonra da ilk değer ulaşsın.
    const applyQuality = ({ level }) => {
      try { this.renderer2?.setQuality(level); } catch (e) { console.error('[world] setQuality', e); }
    };
    const offQ = bus.on('settings:quality', applyQuality);
    bus.emit('settings:quality', { level: this.app.quality });

    this.cameras.main.fadeIn(700, 5, 6, 12);
    this.events.once('shutdown', () => {
      offQ();
      try { this.renderer2?.destroy(); } catch { /* yok say */ }
    });
  }

  update(time, delta) {
    const { state, registry } = this.app;
    registry.tick(delta);
    this.camera.update(delta);
    const f = this.frame;
    f.time = time;
    f.delta = delta;
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
}
