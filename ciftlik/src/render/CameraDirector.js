// CameraDirector — yumuşak takip, sınırlar, pan (eylemsizlikli), tekerlek/pinch/klavye zoom, sinematik çekimler.
// Kamera durumu dünya merkez noktası (cx, cy) + kullanıcı zoom'u olarak tutulur.
// Gerçek Phaser zoom'u = zoom × dpr (main.js canvas'ı aygıt pikseliyle çizer, bkz. registry 'dpr').
import Phaser from 'phaser';
import { WORLD_W, WORLD_H, SKY_H, P1, TILE_W, TILE_H } from '../core/constants.js';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const FOLLOW_LERP = 0.08;     // 60 FPS kare başına
const ZOOM_TAU_MS = 110;      // zoom yumuşatma zaman sabiti
const INERTIA_TAU_MS = 240;   // kayma sönümü
const KEY_PAN_SPEED = 900;    // ekran px/sn (zoom'dan bağımsız his)
const KEY_ZOOM_RATE = 1.6;    // log-zoom/sn
const TAP_SLOP_CSS = 7;       // tıklama/sürükleme eşiği (CSS px)
const TAP_MAX_MS = 400;
const PERSIST_MS = 1000;
const LETTERBOX_MS = 600;
const BOUNDS = { minX: 0, maxX: WORLD_W, minY: -SKY_H, maxY: WORLD_H };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = Phaser.Math.Easing.Sine.InOut;

export default class CameraDirector {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} state GameState (yalnızca state.camera yazılır)
   * @param {{on:Function, emit:Function}} bus
   */
  constructor(scene, state, bus) {
    this.scene = scene;
    this.state = state;
    this.bus = bus;
    this.cam = scene.cameras.main;

    const c = state.camera;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.zoom)) {
      this.cx = c.x; this.cy = c.y; this.zoom = clamp(c.zoom, ZOOM_MIN, ZOOM_MAX);
    } else {
      this.cx = (P1.x + P1.w / 2) * TILE_W;
      this.cy = (P1.y + P1.h / 2) * TILE_H;
      this.zoom = 1;
    }
    this.targetZoom = this.zoom;
    this.vx = 0; this.vy = 0;
    this.anchor = null;          // {sx, sy, wx, wy} — zoom sırasında sabit kalacak nokta
    this.followTarget = null;
    this.locked = false;
    this.cine = null;
    this.queue = [];
    this.drag = null;
    this.pinch = null;
    this.pointers = new Map();   // id → {x, y}
    this.keys = { up: 0, down: 0, left: 0, right: 0, zin: 0, zout: 0 };
    this._persistAcc = 0;
    this._offs = [];

    this._bindPointer();
    this._bindKeyboard();
    this._offs.push(
      bus.on('camera:cinematic', (p) => this.cinematic(p)),
      bus.on('save:before', () => this.persist()),
    );
    this._onResize = () => { this.cam.setSize(this.scene.scale.width, this.scene.scale.height); this._clamp(); this._apply(); };
    scene.scale.on('resize', this._onResize);
    scene.events.once('shutdown', () => this.destroy());

    this._clamp();
    this._apply();
    this.persist();
  }

  get dpr() { return this.scene.registry.get('dpr') || 1; }
  get isCinematic() { return !!this.cine; }

  // ---------------------------------------------------------------- dış API
  /** Takip: {x,y} taşıyan canlı nesne (sprite vb.) veya null. */
  follow(target) { this.followTarget = target || null; if (target) { this.vx = this.vy = 0; } }

  /** Ekran (oyun/aygıt pikseli) → dünya. out verilirse doldurur. */
  screenToWorld(sx, sy, out = { x: 0, y: 0 }) {
    const z = this.zoom * this.dpr;
    out.x = this.cx + (sx - this.cam.width / 2) / z;
    out.y = this.cy + (sy - this.cam.height / 2) / z;
    return out;
  }

  /** Görünür dünya dikdörtgeni */
  getView() {
    const z = this.zoom * this.dpr;
    const w = this.cam.width / z, h = this.cam.height / z;
    return { x: this.cx - w / 2, y: this.cy - h / 2, width: w, height: h, zoom: this.zoom };
  }

  setZoom(z, sx = this.cam.width / 2, sy = this.cam.height / 2) {
    this.targetZoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const w = this.screenToWorld(sx, sy);
    this.anchor = { sx, sy, wx: w.x, wy: w.y };
  }

  panTo(x, y) { this.cx = x; this.cy = y; this.vx = this.vy = 0; this._clamp(); }

  /** camera:cinematic {target:{x,y}, zoom, duration, letterbox, reason} */
  cinematic(p = {}) {
    if (this.cine) { if (this.queue.length < 3) this.queue.push(p); return; }
    const tz = clamp(Number.isFinite(p.zoom) ? p.zoom : 1.4, ZOOM_MIN, ZOOM_MAX);
    const tgt = p.target && Number.isFinite(p.target.x) && Number.isFinite(p.target.y) ? p.target : { x: this.cx, y: this.cy };
    const duration = Math.max(800, Number.isFinite(p.duration) ? p.duration : 3000);
    const travel = clamp(duration * 0.3, 500, 1400);
    const to = { x: tgt.x, y: tgt.y, z: tz };
    this._clampPoint(to);
    this.locked = true;
    this.drag = null; this.pinch = null; this.anchor = null;
    this.vx = this.vy = 0;
    this.cine = {
      phase: 'in', t: 0, travel, hold: Math.max(0, duration - travel),
      from: { x: this.cx, y: this.cy, z: this.zoom }, to, back: null,
      letterbox: !!p.letterbox, reason: p.reason || '',
    };
    if (this.cine.letterbox) this.bus.emit('cinematic:letterbox', { amount: 1, duration: LETTERBOX_MS });
    this.bus.emit('camera:cinematicStart', { reason: this.cine.reason });
  }

  // ---------------------------------------------------------------- kare güncellemesi
  update(delta) {
    const dt = delta > 250 ? 250 : delta > 0 ? delta : 0;
    if (this.cine) {
      this._updateCinematic(dt);
    } else {
      this._updateFree(dt);
    }
    this._clamp();
    this._apply();
    this._persistAcc += dt;
    if (this._persistAcc >= PERSIST_MS) { this._persistAcc = 0; this.persist(); }
  }

  _updateFree(dt) {
    const k = this.keys;
    const kx = k.right - k.left, ky = k.down - k.up;
    if (kx || ky) {
      const s = (KEY_PAN_SPEED / this.zoom) * dt / 1000;
      this.cx += kx * s; this.cy += ky * s;
      this.vx = this.vy = 0; this.followTarget = null; this.anchor = null;
    }
    const kz = k.zin - k.zout;
    if (kz) {
      this.targetZoom = clamp(this.targetZoom * Math.exp(kz * KEY_ZOOM_RATE * dt / 1000), ZOOM_MIN, ZOOM_MAX);
      this.anchor = null;
    }
    if (!this.drag && !this.pinch && (this.vx !== 0 || this.vy !== 0)) {
      this.cx += this.vx * dt; this.cy += this.vy * dt;
      const d = Math.exp(-dt / INERTIA_TAU_MS);
      this.vx *= d; this.vy *= d;
      if (Math.abs(this.vx) < 0.002 && Math.abs(this.vy) < 0.002) this.vx = this.vy = 0;
    }
    const f = this.followTarget;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) {
      const a = 1 - Math.pow(1 - FOLLOW_LERP, dt / 16.667);
      this.cx += (f.x - this.cx) * a; this.cy += (f.y - this.cy) * a;
    }
    if (this.zoom !== this.targetZoom && !this.pinch) {
      const a = 1 - Math.exp(-dt / ZOOM_TAU_MS);
      const lz = Math.log(this.zoom);
      this.zoom = Math.exp(lz + (Math.log(this.targetZoom) - lz) * a);
      if (Math.abs(this.zoom - this.targetZoom) < 0.0005) this.zoom = this.targetZoom;
      const an = this.anchor;
      if (an) {
        const z = this.zoom * this.dpr;
        this.cx = an.wx - (an.sx - this.cam.width / 2) / z;
        this.cy = an.wy - (an.sy - this.cam.height / 2) / z;
      }
    }
    if (this.zoom === this.targetZoom) this.anchor = null;
  }

  _updateCinematic(dt) {
    const c = this.cine;
    c.t += dt;
    if (c.phase === 'in') {
      const e = ease(Math.min(1, c.t / c.travel));
      this._lerpView(c.from, c.to, e);
      if (c.t >= c.travel) { c.phase = 'hold'; c.t = 0; }
    } else if (c.phase === 'hold') {
      // hafif "zoom-in" kayması
      const k = c.hold > 0 ? Math.min(1, c.t / c.hold) : 1;
      this.cx = c.to.x; this.cy = c.to.y;
      this.zoom = clamp(c.to.z * (1 + 0.035 * ease(k)), ZOOM_MIN, ZOOM_MAX);
      if (c.t >= c.hold) {
        c.phase = 'out'; c.t = 0;
        c.back = { x: this.cx, y: this.cy, z: this.zoom };
        if (c.letterbox) this.bus.emit('cinematic:letterbox', { amount: 0, duration: LETTERBOX_MS });
      }
    } else {
      const e = ease(Math.min(1, c.t / c.travel));
      this._lerpView(c.back, c.from, e);
      if (c.t >= c.travel) this._finishCinematic();
    }
  }

  _lerpView(a, b, e) {
    this.cx = a.x + (b.x - a.x) * e;
    this.cy = a.y + (b.y - a.y) * e;
    this.zoom = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * e);
  }

  _finishCinematic() {
    const c = this.cine;
    this.cx = c.from.x; this.cy = c.from.y; this.zoom = this.targetZoom = c.from.z;
    this.cine = null;
    this.locked = false;
    this.pointers.clear();
    this.bus.emit('camera:cinematicDone', { reason: c.reason });
    if (this.queue.length) this.cinematic(this.queue.shift());
  }

  // ---------------------------------------------------------------- sınırlar / uygulama
  _clampPoint(p) {
    const z = p.z * this.dpr;
    const hw = this.cam.width / (2 * z), hh = this.cam.height / (2 * z);
    const bw = BOUNDS.maxX - BOUNDS.minX, bh = BOUNDS.maxY - BOUNDS.minY;
    p.x = hw * 2 >= bw ? (BOUNDS.minX + BOUNDS.maxX) / 2 : clamp(p.x, BOUNDS.minX + hw, BOUNDS.maxX - hw);
    p.y = hh * 2 >= bh ? (BOUNDS.minY + BOUNDS.maxY) / 2 : clamp(p.y, BOUNDS.minY + hh, BOUNDS.maxY - hh);
  }

  _clamp() {
    if (!Number.isFinite(this.cx) || !Number.isFinite(this.cy)) {
      this.cx = (P1.x + P1.w / 2) * TILE_W; this.cy = (P1.y + P1.h / 2) * TILE_H;
    }
    if (!(this.zoom > 0)) this.zoom = 1;
    const z = this.zoom * this.dpr;
    const hw = this.cam.width / (2 * z), hh = this.cam.height / (2 * z);
    const bw = BOUNDS.maxX - BOUNDS.minX, bh = BOUNDS.maxY - BOUNDS.minY;
    let nx, ny;
    if (hw * 2 >= bw) nx = (BOUNDS.minX + BOUNDS.maxX) / 2; else nx = clamp(this.cx, BOUNDS.minX + hw, BOUNDS.maxX - hw);
    if (hh * 2 >= bh) ny = (BOUNDS.minY + BOUNDS.maxY) / 2; else ny = clamp(this.cy, BOUNDS.minY + hh, BOUNDS.maxY - hh);
    if (nx !== this.cx) this.vx = 0;
    if (ny !== this.cy) this.vy = 0;
    this.cx = nx; this.cy = ny;
  }

  _apply() {
    const z = this.zoom * this.dpr;
    if (this.cam.zoom !== z) this.cam.setZoom(z);
    this.cam.centerOn(this.cx, this.cy);
  }

  /** state.camera'ya yazar (saniyede en fazla bir kez update'ten; save:before'da hemen). */
  persist() {
    const src = this.cine ? this.cine.from : null;
    const x = Math.round((src ? src.x : this.cx) * 10) / 10;
    const y = Math.round((src ? src.y : this.cy) * 10) / 10;
    const zoom = Math.round((src ? src.z : this.targetZoom) * 1000) / 1000;
    const c = this.state.camera;
    if (c && typeof c === 'object') { c.x = x; c.y = y; c.zoom = zoom; } else this.state.camera = { x, y, zoom };
  }

  // ---------------------------------------------------------------- giriş: fare + dokunmatik
  _bindPointer() {
    const input = this.scene.input;
    const onDown = (p) => {
      if (this.locked) return;
      this.pointers.set(p.id, { x: p.x, y: p.y });
      this.vx = this.vy = 0;
      if (this.pointers.size === 1) {
        this._startDrag(p.id, p.x, p.y, false);
      } else if (this.pointers.size === 2) {
        this.drag = null;
        this._startPinch();
      }
    };
    const onMove = (p) => {
      const rec = this.pointers.get(p.id);
      if (!rec || this.locked) return;
      rec.x = p.x; rec.y = p.y;
      if (this.pinch) { this._updatePinch(); return; }
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      const dx = p.x - d.lastX, dy = p.y - d.lastY;
      const now = performance.now();
      if (!d.moved) {
        const slop = TAP_SLOP_CSS * this.dpr;
        if (Math.abs(p.x - d.startX) > slop || Math.abs(p.y - d.startY) > slop) d.moved = true;
        else return;
      }
      const z = this.zoom * this.dpr;
      const wdx = -dx / z, wdy = -dy / z;
      this.cx += wdx; this.cy += wdy;
      const dtm = Math.max(1, now - d.lastT);
      this.vx = this.vx * 0.55 + (wdx / dtm) * 0.45;
      this.vy = this.vy * 0.55 + (wdy / dtm) * 0.45;
      d.lastX = p.x; d.lastY = p.y; d.lastT = now;
      this.anchor = null; this.followTarget = null;
      this.targetZoom = this.zoom;
    };
    const onUp = (p) => {
      if (!this.pointers.has(p.id)) return;
      this.pointers.delete(p.id);
      if (this.locked) return;
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          this.vx = this.vy = 0;
          const it = this.pointers.entries().next();
          if (!it.done) this._startDrag(it.value[0], it.value[1].x, it.value[1].y, true);
        }
        return;
      }
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      this.drag = null;
      const now = performance.now();
      if (!d.moved && now - d.t0 < TAP_MAX_MS) {
        this.vx = this.vy = 0;
        const w = this.screenToWorld(p.x, p.y);
        this.bus.emit('input:tap', {
          x: w.x, y: w.y, screenX: p.x / this.dpr, screenY: p.y / this.dpr,
          button: p.button ?? 0, touch: !!p.wasTouch,
        });
      } else if (now - d.lastT > 90) {
        this.vx = this.vy = 0; // bırakmadan önce durmuşsa kayma yok
      } else {
        const max = 4 / this.zoom; // dünya px/ms üst sınırı
        this.vx = clamp(this.vx, -max, max); this.vy = clamp(this.vy, -max, max);
      }
    };
    const onWheel = (p, _objs, _dx, dy) => {
      if (this.locked) return;
      let d = dy;
      const mode = p.event && p.event.deltaMode;
      if (mode === 1) d *= 33; else if (mode === 2) d *= 400;
      d = clamp(d, -300, 300);
      this.setZoom(this.targetZoom * Math.exp(-d * 0.0015), p.x, p.y);
      this.followTarget = null;
    };
    input.on('pointerdown', onDown);
    input.on('pointermove', onMove);
    input.on('pointerup', onUp);
    input.on('pointerupoutside', onUp);
    input.on('wheel', onWheel);
    this._offs.push(() => {
      input.off('pointerdown', onDown); input.off('pointermove', onMove);
      input.off('pointerup', onUp); input.off('pointerupoutside', onUp); input.off('wheel', onWheel);
    });
  }

  _startDrag(id, x, y, moved) {
    const now = performance.now();
    this.drag = { id, startX: x, startY: y, lastX: x, lastY: y, t0: now, lastT: now, moved };
  }

  _startPinch() {
    const it = this.pointers.values();
    const a = it.next().value, b = it.next().value;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const w = this.screenToWorld(mx, my);
    this.pinch = { a, b, dist0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: this.zoom, wx: w.x, wy: w.y };
    this.anchor = null; this.followTarget = null;
  }

  _updatePinch() {
    const p = this.pinch;
    const { a, b } = p;
    const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const z = clamp(p.zoom0 * dist / p.dist0, ZOOM_MIN, ZOOM_MAX);
    this.zoom = this.targetZoom = z;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ez = z * this.dpr;
    this.cx = p.wx - (mx - this.cam.width / 2) / ez;
    this.cy = p.wy - (my - this.cam.height / 2) / ez;
  }

  // ---------------------------------------------------------------- giriş: klavye
  _bindKeyboard() {
    const map = (e) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': return 'up';
        case 'KeyS': case 'ArrowDown': return 'down';
        case 'KeyA': case 'ArrowLeft': return 'left';
        case 'KeyD': case 'ArrowRight': return 'right';
        case 'NumpadAdd': return 'zin';
        case 'NumpadSubtract': return 'zout';
        default: break;
      }
      if (e.key === '+' || e.key === '=') return 'zin';
      if (e.key === '-' || e.key === '_') return 'zout';
      return null;
    };
    const typing = (e) => {
      const t = e.target;
      if (!t || t === document.body) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const down = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      const k = map(e);
      if (!k) return;
      if (this.locked) { this.keys[k] = 0; return; }
      this.keys[k] = 1;
      if (k === 'up' || k === 'down' || k === 'left' || k === 'right') e.preventDefault();
    };
    const up = (e) => { const k = map(e); if (k) this.keys[k] = 0; };
    const blur = () => { for (const k in this.keys) this.keys[k] = 0; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this._offs.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  destroy() {
    for (const off of this._offs) { try { off(); } catch { /* yok say */ } }
    this._offs.length = 0;
    this.scene.scale.off('resize', this._onResize);
  }
}
