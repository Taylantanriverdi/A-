// SystemRegistry — sabit adımlı simülasyon. 1 adım = 1 oyun dakikası.
// Sistem arayüzü (PLAN.md §1): { id, init(state, bus, registry), tickMinute, onHour, onDay, onSeason }
// Phaser'a bağımlı değildir (Node'da çalışır).
import { REAL_MS_PER_GAME_MIN, MAX_STEPS_PER_FRAME, MIN_PER_DAY, DAYS_PER_SEASON } from './constants.js';
import { calendar } from './timeUtils.js';
import { createRng } from './Rng.js';

const MAX_FRAME_DELTA_MS = 250; // sekme dönüşü / takılmada aşırı adımı engeller

export class SystemRegistry {
  /**
   * @param {object} state GameState
   * @param {{emit:Function,on:Function}} bus
   * @param {object} [data] denge verileri (ctx.data)
   */
  constructor(state, bus, data = {}) {
    this.state = state;
    this.bus = bus;
    this.systems = [];
    this.acc = 0; // birikmiş oyun-ms (gerçek ms × hız)
    this.ctx = { rng: createRng(state), data, now: calendar(state.time.totalMinutes), silent: false };
  }

  register(system) {
    this.systems.push(system);
    system.init?.(this.state, this.bus, this);
    return this;
  }

  get(id) { return this.systems.find((s) => s.id === id); }

  /** Kesirli dakika ilerlemesi 0..1 (render interpolasyonu için). Hız 0 iken sabit kalır. */
  get fraction() {
    const f = this.acc / REAL_MS_PER_GAME_MIN;
    return f < 0 ? 0 : f > 0.999999 ? 0.999999 : f;
  }

  resetFraction() { this.acc = 0; }

  /**
   * Her karede çağrılır.
   * @param {number} deltaMs gerçek geçen süre
   * @returns {number} çalıştırılan adım sayısı
   */
  tick(deltaMs) {
    const speed = this.state.time.speed;
    if (!(speed > 0) || !(deltaMs > 0)) return 0;
    this.acc += Math.min(deltaMs, MAX_FRAME_DELTA_MS) * speed;
    let steps = 0;
    while (this.acc >= REAL_MS_PER_GAME_MIN && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= REAL_MS_PER_GAME_MIN;
      this.step();
      steps++;
    }
    if (this.acc >= REAL_MS_PER_GAME_MIN) this.acc %= REAL_MS_PER_GAME_MIN; // kare atlama koruması
    return steps;
  }

  /**
   * n dakikayı adım adım hemen çalıştırır (debug.skip, uyku).
   * @param {number} n
   * @param {boolean} [silent] true → TimeSystem zaman olaylarını yaymaz (toplu atlama)
   */
  advance(n, silent = false) {
    const prev = this.ctx.silent;
    this.ctx.silent = silent;
    try {
      for (let i = 0; i < n; i++) this.step();
    } finally {
      this.ctx.silent = prev;
    }
  }

  /** Tek simülasyon adımı. Zamanı TimeSystem.tickMinute ilerletir. */
  step() {
    const st = this.state;
    const ctx = this.ctx;
    const prev = st.time.totalMinutes;
    let seen = prev;
    const list = this.systems;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.tickMinute) {
        s.tickMinute(st, this.bus, ctx);
        if (st.time.totalMinutes !== seen) { seen = st.time.totalMinutes; ctx.now = calendar(seen); }
      }
    }
    const cur = st.time.totalMinutes;
    if (cur === prev) return;
    const dayPrev = Math.floor(prev / MIN_PER_DAY);
    const dayCur = Math.floor(cur / MIN_PER_DAY);
    if (dayCur !== dayPrev) {
      this.callAll('onDay');
      if (Math.floor(dayCur / DAYS_PER_SEASON) !== Math.floor(dayPrev / DAYS_PER_SEASON)) this.callAll('onSeason');
    }
    if (Math.floor(cur / 60) !== Math.floor(prev / 60)) this.callAll('onHour');
  }

  callAll(hook) {
    const list = this.systems;
    for (let i = 0; i < list.length; i++) {
      const fn = list[i][hook];
      if (fn) {
        try { fn.call(list[i], this.state, this.bus, this.ctx); } catch (e) { console.error(`[system:${list[i].id}] ${hook}`, e); }
      }
    }
  }
}

export default SystemRegistry;
