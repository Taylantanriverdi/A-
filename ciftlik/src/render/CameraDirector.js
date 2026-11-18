// CameraDirector — yumuşak takip, sınırlar, pan (eylemsizlikli), tekerlek/pinch/klavye zoom, sinematik çekimler.
// Kamera durumu dünya merkez noktası (cx, cy) + kullanıcı zoom'u olarak tutulur.
// Gerçek Phaser zoom'u = zoom × dpr (main.js canvas'ı aygıt pikseliyle çizer, bkz. registry 'dpr').
import Phaser from 'phaser';
import { WORLD_W, WORLD_H, SKY_H, P1, TILE_W, TILE_H, WORLD_TILES_X, WORLD_TILES_Y } from '../core/constants.js';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const FOLLOW_LERP = 0.08;     // 60 FPS kare başına
const ZOOM_TAU_MS = 110;      // zoom yumuşatma zaman sabiti
const INERTIA_TAU_MS = 240;   // kayma sönümü
const KEY_PAN_SPEED = 900;    // ekran px/sn (zoom'dan bağımsız his)
const KEY_ZOOM_RATE = 1.6;    // log-zoom/sn
const TAP_SLOP_CSS = 8;       // tıklama/sürükleme eşiği (CSS px; × dpr ile oyun pikseline)
const PAINT_HOLD_MS = 110;    // dokunmatik boyamada ilk karo gecikmesi (iki parmak pan'ı ayırt etmek için)
const TOUCH_HOVER_MUTE_MS = 800; // dokunuştan sonra taklit fare olaylarıyla hover yayma
const TAP_MAX_MS = 400;
const PERSIST_MS = 1000;
const LETTERBOX_MS = 600;
const CINE_DEFER_MS = 250;     // basılı işaretçi bırakıldıktan sonra ertelenen sinematiğin gecikmesi (K16)
const CINE_DEFER_MAX_MS = 60000; // takılı kalmış işaretçiye karşı emniyet
const GLIDE_MS = 400;          // camera:ensureVisible kayması
const VIS_MARGIN_CSS = 40;     // ensureVisible kenar payı
const SLACK_TAU_MS = 140;      // aşma payının (inset) normal sınıra yumuşak dönüşü
// Yeni oyunda ilk kadraj: başlangıç tarlası + ev (karo, kapsayıcı)
const START_FRAME = { x0: 34, x1: 45, y0: 7, y1: 12 };
const START_FIT_PAD_CSS = { x: 16, y: 140 }; // HUD/araç çubuğu için toplam pay
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
    this._autoFit = false;       // yeni oyun: kullanıcı kamerayı ellenene kadar resize'da yeniden sığdır
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.zoom)) {
      this.cx = c.x; this.cy = c.y; this.zoom = clamp(c.zoom, ZOOM_MIN, ZOOM_MAX);
    } else {
      this._autoFit = true;
      this._fitStartFrame();
    }
    this.targetZoom = this.zoom;
    this.vx = 0; this.vy = 0;
    this.anchor = null;          // {sx, sy, wx, wy} — zoom sırasında sabit kalacak nokta
    this.followTarget = null;
    this.locked = false;
    this.cine = null;
    this.queue = [];
    this.deferred = [];          // basılı işaretçi varken gelen sinematikler (K16)
    this._deferAt = 0;           // >0: işaretçiler bırakıldı, bu zamanda oynat
    this._deferSince = 0;
    this.glide = null;           // {fx, fy, tx, ty, t, dur} ensureVisible kayması
    // Sınır aşma payı (CSS px): açık kart karoyu örtmesin diye kamera dünya sınırını bu kadar aşabilir.
    this.insetTarget = { top: 0, bottom: 0, left: 0, right: 0 };
    this.slack = { top: 0, bottom: 0, left: 0, right: 0 };
    this._b = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.drag = null;
    this.pinch = null;
    this.pointers = new Map();   // id → {x, y}
    this.keys = { up: 0, down: 0, left: 0, right: 0, zin: 0, zout: 0 };
    // karo girdisi
    this.tool = 'hand';
    this.paint = null;           // {id, tx, ty, sx, sy, t0, pending, touch, moved}
    this._visited = new Set();   // bu fırçada yayılan karolar (tekrar yok)
    this.mouse = { x: 0, y: 0, inside: false };
    this.hoverTx = -1; this.hoverTy = -1; this.hoverOn = false;
    this._lastTouchAt = -1e9;
    this._tmp = { x: 0, y: 0 };
    this._persistAcc = 0;
    this._offs = [];

    this._bindPointer();
    this._bindKeyboard();
    this._offs.push(
      bus.on('camera:cinematic', (p) => this.requestCinematic(p)),
      bus.on('camera:ensureVisible', (p) => this.ensureVisible(p)),
      bus.on('camera:releaseInsets', () => this.releaseInsets()),
      bus.on('save:before', () => this.persist()),
      bus.on('tool:select', (p) => this.setTool(p && p.tool)),
    );
    this._onResize = () => {
      this.cam.setSize(this.scene.scale.width, this.scene.scale.height);
      if (this._autoFit && !this.cine) this._fitStartFrame();
      this._clamp(); this._apply();
    };
    scene.scale.on('resize', this._onResize);
    scene.events.once('shutdown', () => this.destroy());

    this._clamp();
    this._apply();
    this.persist();
  }

  get dpr() { return this.scene.registry.get('dpr') || 1; }
  get isCinematic() { return !!this.cine; }
  /** Boyama modu: 'hand' dışı bir alet seçiliyken tek parmak / sol tık sürükleme karo boyar. */
  get painting() { return this.tool !== 'hand'; }

  setTool(tool) {
    const t = typeof tool === 'string' && tool ? tool : 'hand';
    if (t === this.tool) return;
    this.tool = t;
    this._endPaint();
  }

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

  panTo(x, y) { this.cx = x; this.cy = y; this.vx = this.vy = 0; this.glide = null; this._clamp(); }

  /** Yeni oyun kadrajı: START_FRAME dikdörtgenini ortalar, dar ekranda sığdıran zoom (0.5–1). */
  _fitStartFrame() {
    const x0 = START_FRAME.x0 * TILE_W, x1 = (START_FRAME.x1 + 1) * TILE_W;
    const y0 = START_FRAME.y0 * TILE_H, y1 = (START_FRAME.y1 + 1) * TILE_H;
    const dpr = this.dpr;
    const vw = Math.max(1, this.cam.width / dpr - START_FIT_PAD_CSS.x);
    const vh = Math.max(1, this.cam.height / dpr - START_FIT_PAD_CSS.y);
    this.zoom = this.targetZoom = clamp(Math.min(1, vw / (x1 - x0), vh / (y1 - y0)), ZOOM_MIN, 1);
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    this.vx = this.vy = 0; this.anchor = null;
  }

  /** Kullanıcı kamerayı elledi: otomatik kadraj ve ensureVisible kayması biter. */
  _userCam() { this._autoFit = false; this.glide = null; }

  /**
   * camera:ensureVisible {x, y, insetBottom, insetTop, insetLeft?, insetRight?} — inset'ler CSS px.
   * Dünya noktası serbest alanın (kenar payıyla) dışındaysa GLIDE_MS içinde yumuşakça kayar.
   * Inset'ler, kart açık kaldığı sürece dünya sınırını o kadar aşma payı verir; hepsi 0 → releaseInsets.
   */
  ensureVisible(p) {
    if (this.cine || this.locked || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const num = (v) => { const n = Number(v); return n > 0 && Number.isFinite(n) ? n : 0; };
    const insT = num(p.insetTop), insB = num(p.insetBottom), insL = num(p.insetLeft), insR = num(p.insetRight);
    this._setInsets(insT, insB, insL, insR);
    const dpr = this.dpr, z = this.zoom;
    const W = this.cam.width / dpr, H = this.cam.height / dpr;
    const m = VIS_MARGIN_CSS;
    let top = insT + m, bot = H - insB - m;
    if (bot < top) { const mid = (insT + H - insB) / 2; top = bot = mid; }
    let left = insL + m, right = W - insR - m;
    if (right < left) { const mid = (insL + W - insR) / 2; left = right = mid; }
    // noktanın şimdiki ekran konumu (CSS px)
    const sx = (p.x - this.cx) * z + W / 2, sy = (p.y - this.cy) * z + H / 2;
    let dx = 0, dy = 0;
    if (sx < left || sx > right) {
      if (insL || insR) dx = sx - (left + right) / 2; // yan kart: serbest alanın ortasına
      else dx = sx < left ? sx - left : sx - right;
    }
    if (sy < top || sy > bot) dy = sy - (top + bot) / 2; // dikeyde serbest alanın ortasına
    if (!dx && !dy) return;
    const to = { x: this.cx + dx / z, y: this.cy + dy / z, z };
    this._clampPoint(to);
    if (Math.abs(to.x - this.cx) < 0.5 && Math.abs(to.y - this.cy) < 0.5) return;
    this.vx = this.vy = 0; this.followTarget = null; this._autoFit = false;
    this.glide = { fx: this.cx, fy: this.cy, tx: to.x, ty: to.y, t: 0, dur: GLIDE_MS };
  }

  /** camera:releaseInsets — aşma payı kalkar; kamera yumuşakça normal sınırlara döner. */
  releaseInsets() { this._setInsets(0, 0, 0, 0); }

  /** Hedef payı ayarla: artış hemen uygulanır (kayma hedefi kesilmesin), azalış update'te yumuşar. */
  _setInsets(top, bottom, left, right) {
    const t = this.insetTarget, s = this.slack;
    t.top = top; t.bottom = bottom; t.left = left; t.right = right;
    if (top > s.top) s.top = top;
    if (bottom > s.bottom) s.bottom = bottom;
    if (left > s.left) s.left = left;
    if (right > s.right) s.right = right;
  }

  _updateSlack(dt) {
    const t = this.insetTarget, s = this.slack;
    if (s.top === t.top && s.bottom === t.bottom && s.left === t.left && s.right === t.right) return;
    const a = 1 - Math.exp(-dt / SLACK_TAU_MS);
    for (const k of ['top', 'bottom', 'left', 'right']) {
      const v = s[k] + (t[k] - s[k]) * a;
      s[k] = Math.abs(v - t[k]) < 0.5 ? t[k] : v;
    }
  }

  /** Aşma payıyla genişletilmiş dünya sınırları (zoom: kullanıcı zoom'u; CSS px → dünya = /zoom). */
  _bounds(zoom) {
    const b = this._b, s = this.slack;
    b.minX = BOUNDS.minX - s.left / zoom; b.maxX = BOUNDS.maxX + s.right / zoom;
    b.minY = BOUNDS.minY - s.top / zoom; b.maxY = BOUNDS.maxY + s.bottom / zoom;
    return b;
  }

  /** Bus girişi: basılı işaretçi (boyama darbesi, sürükleme, pinch) varken sinematik ertelenir (K16). */
  requestCinematic(p = {}) {
    if (this.cine && !this.deferred.length) { this.cinematic(p); return; } // oynayan çekimin kuyruğu
    if (this.pointers.size > 0 || this.deferred.length) {
      if (this.deferred.length < 3) this.deferred.push(p);
      if (this.deferred.length === 1) this._deferSince = performance.now();
      if (this.pointers.size === 0 && !this._deferAt) this._deferAt = performance.now() + CINE_DEFER_MS;
      return;
    }
    this.cinematic(p);
  }

  _pumpDeferred(now) {
    if (!this.deferred.length || this.cine) return;
    const stuck = now - this._deferSince > CINE_DEFER_MAX_MS;
    if (this.pointers.size > 0 && !stuck) { this._deferAt = 0; return; }
    if (!this._deferAt) { this._deferAt = now + CINE_DEFER_MS; return; }
    if (now < this._deferAt && !stuck) return;
    this._deferAt = 0;
    const list = this.deferred.splice(0);
    this.pointers.clear();
    this.cinematic(list[0]);
    for (let i = 1; i < list.length; i++) if (this.queue.length < 3) this.queue.push(list[i]);
  }

  /** camera:cinematic {target:{x,y}, zoom, duration, letterbox, reason} */
  cinematic(p = {}) {
    if (this.cine) { if (this.queue.length < 3) this.queue.push(p); return; }
    const tz = clamp(Number.isFinite(p.zoom) ? p.zoom : 1.4, ZOOM_MIN, ZOOM_MAX);
    const tgt = p.target && Number.isFinite(p.target.x) && Number.isFinite(p.target.y) ? p.target : { x: this.cx, y: this.cy };
    const duration = Math.max(800, Number.isFinite(p.duration) ? p.duration : 3000);
    const travel = clamp(duration * 0.3, 500, 1400);
    const to = { x: tgt.x, y: tgt.y, z: tz };
    this._clampPoint(to);
    this._setHover(false);
    this.locked = true;
    this.glide = null; this._autoFit = false;
    this.drag = null; this.pinch = null; this.anchor = null;
    this._endPaint();
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
    if (this.deferred.length) this._pumpDeferred(performance.now());
    this._updateSlack(dt);
    if (this.cine) {
      this._updateCinematic(dt);
    } else {
      this._updateFree(dt);
    }
    this._clamp();
    this._apply();
    if (!this.locked) {
      const pt = this.paint;
      if (pt && pt.pending && performance.now() - pt.t0 >= PAINT_HOLD_MS) this._commitPaint();
      if (this.mouse.inside && !pt && !this.drag && !this.pinch
        && performance.now() - this._lastTouchAt > TOUCH_HOVER_MUTE_MS) {
        this._hoverAt(this.mouse.x, this.mouse.y); // zoom/klavye pan'da imleç altındaki karo değişebilir
      }
    }
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
      this._userCam();
    }
    const g = this.glide;
    if (g) {
      if (this.drag?.moved || this.pinch) this.glide = null;
      else {
        g.t += dt;
        const e = ease(Math.min(1, g.t / g.dur));
        this.cx = g.fx + (g.tx - g.fx) * e; this.cy = g.fy + (g.ty - g.fy) * e;
        if (g.t >= g.dur) this.glide = null;
      }
    }
    const kz = k.zin - k.zout;
    if (kz) {
      this._userCam();
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
    const B = this._bounds(p.z);
    const hw = this.cam.width / (2 * z), hh = this.cam.height / (2 * z);
    const bw = B.maxX - B.minX, bh = B.maxY - B.minY;
    p.x = hw * 2 >= bw ? (B.minX + B.maxX) / 2 : clamp(p.x, B.minX + hw, B.maxX - hw);
    p.y = hh * 2 >= bh ? (B.minY + B.maxY) / 2 : clamp(p.y, B.minY + hh, B.maxY - hh);
  }

  _clamp() {
    if (!Number.isFinite(this.cx) || !Number.isFinite(this.cy)) {
      this.cx = (P1.x + P1.w / 2) * TILE_W; this.cy = (P1.y + P1.h / 2) * TILE_H;
    }
    if (!(this.zoom > 0)) this.zoom = 1;
    const z = this.zoom * this.dpr;
    const B = this._bounds(this.zoom);
    const hw = this.cam.width / (2 * z), hh = this.cam.height / (2 * z);
    const bw = B.maxX - B.minX, bh = B.maxY - B.minY;
    let nx, ny;
    if (hw * 2 >= bw) nx = (B.minX + B.maxX) / 2; else nx = clamp(this.cx, B.minX + hw, B.maxX - hw);
    if (hh * 2 >= bh) ny = (B.minY + B.maxY) / 2; else ny = clamp(this.cy, B.minY + hh, B.maxY - hh);
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

  // ---------------------------------------------------------------- karo girdisi
  /** Ekran (oyun pikseli) → karo; zemin düzlemindeyse true ve out.x/out.y = tx/ty. */
  _tileAt(sx, sy, out) {
    const w = this.screenToWorld(sx, sy, this._tmp);
    if (!(w.x >= 0 && w.x < WORLD_W && w.y >= 0 && w.y < WORLD_H)) return false;
    out.x = Math.floor(w.x / TILE_W);
    out.y = Math.floor(w.y / TILE_H);
    return true;
  }

  /** x, y: dokunulan dünya noktası (boyamada doldurulan karolar için karo merkezi). */
  _emitTileTap(tx, ty, x = (tx + 0.5) * TILE_W, y = (ty + 0.5) * TILE_H) {
    if (this.locked || tx < 0 || ty < 0 || tx >= WORLD_TILES_X || ty >= WORLD_TILES_Y) return;
    this.bus.emit('tile:tap', { tx, ty, tileId: `${tx},${ty}`, x, y });
  }

  /** Hover: yalnızca karo değişince (veya zemin dışına çıkınca null) yayar. */
  _hoverAt(sx, sy) {
    const t = this._tmpT || (this._tmpT = { x: 0, y: 0 });
    if (!this._tileAt(sx, sy, t)) { this._setHover(false); return; }
    if (this.hoverOn && t.x === this.hoverTx && t.y === this.hoverTy) return;
    this.hoverOn = true; this.hoverTx = t.x; this.hoverTy = t.y;
    this.bus.emit('tile:hover', { tx: t.x, ty: t.y, tileId: `${t.x},${t.y}` });
  }

  _setHover(on) {
    if (on || !this.hoverOn) return;
    this.hoverOn = false; this.hoverTx = this.hoverTy = -1;
    this.bus.emit('tile:hover', null);
  }

  /** Boyama fırçası: basılan karo + sonra geçilen her yeni karo (Bresenham ile boşluksuz). */
  _beginPaint(p, touch) {
    const t = { x: 0, y: 0 };
    const on = this._tileAt(p.x, p.y, t);
    const w = this.screenToWorld(p.x, p.y, this._tmp);
    this._visited.clear();
    this.paint = {
      id: p.id, sx: p.x, sy: p.y, t0: performance.now(), touch, moved: false,
      // zemin dışında başlayan fırça için ham (sınırsız) karo koordinatı tutulur
      tx: on ? t.x : Math.floor(w.x / TILE_W), ty: on ? t.y : Math.floor(w.y / TILE_H),
      pending: touch, // dokunmatikte ikinci parmak gelebilir: kısa süre bekle
    };
    if (!touch) this._paintTile(this.paint.tx, this.paint.ty);
  }

  _commitPaint() {
    const pt = this.paint;
    if (!pt || !pt.pending) return;
    pt.pending = false;
    this._paintTile(pt.tx, pt.ty);
  }

  _paintTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= WORLD_TILES_X || ty >= WORLD_TILES_Y) return;
    const key = ty * WORLD_TILES_X + tx;
    if (this._visited.has(key)) return;
    this._visited.add(key);
    this._emitTileTap(tx, ty);
  }

  _paintMove(sx, sy) {
    const pt = this.paint;
    const w = this.screenToWorld(sx, sy, this._tmp);
    const nx = Math.floor(w.x / TILE_W), ny = Math.floor(w.y / TILE_H);
    if (nx === pt.tx && ny === pt.ty) return;
    // Bresenham: (pt.tx, pt.ty) hariç → (nx, ny) dahil
    let x = pt.tx, y = pt.ty;
    const dx = Math.abs(nx - x), dy = -Math.abs(ny - y);
    const stx = x < nx ? 1 : -1, sty = y < ny ? 1 : -1;
    let err = dx + dy;
    let guard = 4096;
    while ((x !== nx || y !== ny) && guard-- > 0) {
      const e2 = 2 * err;
      // çapraz adımda köşe karosunu da doldur (4-bağlantılı çizgi: köşeden atlama yok)
      if (e2 >= dy && e2 <= dx) {
        err += dy; x += stx;
        this._paintTile(x, y);
        err += dx; y += sty;
      } else if (e2 >= dy) {
        err += dy; x += stx;
      } else {
        err += dx; y += sty;
      }
      this._paintTile(x, y);
    }
    pt.tx = nx; pt.ty = ny;
  }

  _endPaint() {
    this.paint = null;
    this._visited.clear();
  }

  // ---------------------------------------------------------------- giriş: fare + dokunmatik
  _bindPointer() {
    const input = this.scene.input;
    const isTouch = (p) => !!p.wasTouch;
    const onDown = (p) => {
      if (this.locked) return;
      if (this.pointers.has(p.id)) return; // aynı farede ikinci tuş
      const touch = isTouch(p);
      if (touch) { this._lastTouchAt = performance.now(); this._setHover(false); }
      this.pointers.set(p.id, { x: p.x, y: p.y, button: p.button ?? 0 });
      this.vx = this.vy = 0;
      if (this.pointers.size === 1) {
        if (this.painting && (p.button ?? 0) === 0) {
          this.drag = null;
          this._beginPaint(p, touch);
        } else {
          this._startDrag(p.id, p.x, p.y, false);
        }
      } else if (this.pointers.size === 2) {
        this.drag = null;
        this._endPaint(); // iki parmak → pan/pinch; boyama biter (bekleyen ilk karo yayılmaz)
        this._startPinch();
      }
    };
    const onMove = (p) => {
      const touch = isTouch(p);
      if (touch) this._lastTouchAt = performance.now();
      else {
        this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.inside = true;
      }
      const rec = this.pointers.get(p.id);
      if (this.locked) return;
      if (!touch && !this.drag && !this.pinch
        && performance.now() - this._lastTouchAt > TOUCH_HOVER_MUTE_MS) this._hoverAt(p.x, p.y);
      if (!rec) return;
      rec.x = p.x; rec.y = p.y;
      if (this.pinch) { this._updatePinch(); return; }
      const pt = this.paint;
      if (pt && pt.id === p.id) {
        if (!pt.moved) {
          const slop = TAP_SLOP_CSS * this.dpr;
          if (Math.abs(p.x - pt.sx) > slop || Math.abs(p.y - pt.sy) > slop) pt.moved = true;
        }
        if (pt.pending) {
          if (!pt.moved) return;
          this._commitPaint();
        }
        this._paintMove(p.x, p.y);
        return;
      }
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
      this.anchor = null; this.followTarget = null; this._userCam();
      this.targetZoom = this.zoom;
    };
    const onUp = (p) => {
      if (!this.pointers.has(p.id)) return;
      const rec = this.pointers.get(p.id);
      this.pointers.delete(p.id);
      if (isTouch(p)) this._lastTouchAt = performance.now();
      if (this.pointers.size === 0 && this.deferred.length) this._deferAt = performance.now() + CINE_DEFER_MS;
      if (this.locked) return;
      if (this.pinch) {
        if (this.pointers.size < 2) {
          this.pinch = null;
          this.releaseInsets();
          this.vx = this.vy = 0;
          // Boyama modunda kalan parmak ne kaydırır ne boyar (iki parmak hareketinin artığı).
          const it = this.pointers.entries().next();
          if (!it.done && !this.painting) this._startDrag(it.value[0], it.value[1].x, it.value[1].y, true);
        }
        return;
      }
      const pt = this.paint;
      if (pt && pt.id === p.id) {
        if (pt.pending) this._commitPaint(); // kısa dokunuş → tek karo
        const tapLike = !pt.moved && performance.now() - pt.t0 < TAP_MAX_MS;
        this._endPaint();
        if (tapLike) this._emitInputTap(p, false);
        return;
      }
      const d = this.drag;
      if (!d || d.id !== p.id) return;
      this.drag = null;
      if (d.moved) this.releaseInsets(); // kullanıcı sürükleyip bıraktı → normal sınırlar
      const now = performance.now();
      if (!d.moved && now - d.t0 < TAP_MAX_MS) {
        this.vx = this.vy = 0;
        // Karo seçimi yalnızca birincil tuşla (sağ/orta tık boyama modunda pan içindir).
        this._emitInputTap(p, (rec?.button ?? 0) === 0);
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
      this.followTarget = null; this._userCam();
    };
    const onOut = () => { this.mouse.inside = false; if (!this.locked) this._setHover(false); };
    const onOver = () => { this.mouse.inside = performance.now() - this._lastTouchAt > TOUCH_HOVER_MUTE_MS; };
    input.on('pointerdown', onDown);
    input.on('pointermove', onMove);
    input.on('pointerup', onUp);
    input.on('pointerupoutside', onUp);
    input.on('wheel', onWheel);
    input.on('gameout', onOut);
    input.on('gameover', onOver);
    this._offs.push(() => {
      input.off('pointerdown', onDown); input.off('pointermove', onMove);
      input.off('pointerup', onUp); input.off('pointerupoutside', onUp); input.off('wheel', onWheel);
      input.off('gameout', onOut); input.off('gameover', onOver);
    });
  }

  /** input:tap (dünya koordinatı) + zemin düzlemindeyse ve withTile ise tile:tap. */
  _emitInputTap(p, withTile) {
    const w = this.screenToWorld(p.x, p.y, this._tmp);
    const wx = w.x, wy = w.y;
    this.bus.emit('input:tap', {
      x: wx, y: wy, screenX: p.x / this.dpr, screenY: p.y / this.dpr,
      button: p.button ?? 0, touch: !!p.wasTouch,
    });
    if (withTile && wx >= 0 && wx < WORLD_W && wy >= 0 && wy < WORLD_H) {
      this._emitTileTap(Math.floor(wx / TILE_W), Math.floor(wy / TILE_H), wx, wy);
    }
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
    this.anchor = null; this.followTarget = null; this._userCam();
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
