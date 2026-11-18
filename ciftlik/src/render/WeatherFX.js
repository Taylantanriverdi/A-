// Hava ve mevsim görselleri (PLAN §14 Görsel). State'i YALNIZCA OKUR: state.weather {type,intensity,wind,puddles,snowCover,wetness},
// state.events.active [{kind}], takvim mevsimi (env.season). Yağmur/kar/dolu/yaprak ekran uzayında (zoom'dan bağımsız yoğunluk),
// sıçrama/birikinti/bulut gölgesi/kar örtüsü dünya uzayında. Tüm nesneler havuzlu; update/layout içinde bellek ayrılmaz.
// Kar örtüsü (zemin + çatı/ağaç/çit başlıkları) tint'e dayanmayan doku katmanlarıdır: Canvas renderer'da da çalışır.
import { DEPTH, WORLD_W, WORLD_H, TILE_W } from '../core/constants.js';
import { screenContainer } from './View.js';
import { mulberry32 } from './textures/noise.js';
import { genWeather, BOLT_W, BOLT_H, BOLT_VARIANTS, LEAF_COLORS } from './textures/weather.js';
import { TREE_VARIANTS } from './textures/props.js';
import { FENCE } from './textures/placed.js';
import { HOUSE } from './layout.js';
import { clamp, smoothstep, mixRgb, rgbToInt } from './util.js';

const EXT = 1024;
const MAX = { rain: 260, snow: 170, hail: 44, leaf: 30, ring: 40, puddle: 28, shade: 7, cap: 170, drip: 10 };
const QMUL = { high: 1, medium: 0.62, low: 0.34 };
const GREY_TOP = [0.5, 0.56, 0.66], WHITE = [1, 1, 1];
const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * Math.min(1, rate * dt);
const fract = (x) => x - Math.floor(x);

export default class WeatherFX {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.qm = 1; this.nQ = {};
    // yumuşatılmış hava büyüklükleri (0..1)
    this.rain = 0; this.snow = 0; this.hail = 0; this.fogA = 0; this.leaf = 0; this.drought = 0; this.frost = 0;
    this.snowCover = 0; this.puddles = 0; this.wet = 0; this._localWet = 0;
    this.stormK = 0; this.tmp = [0, 0, 0]; this.tmp2 = [0, 0, 0];
    this.vb = { left: 0, right: 1, top: 0, bottom: 1 };
    // şimşek durumu
    this.nextStrike = 0; this.flashAt = -99; this.thunderAt = -1; this.boltK = 0; this.boltX = 0.5; this.flash = 0; this.boltA = 0;
    this.capN = 0; this.eaveN = 0; this.capT = 0; this.capCover = -1; this.eave = new Float32Array(MAX.drip * 2);
    this.ringCur = 0; this.spawnAcc = 0; this._ready = false;
  }

  create() {
    const s = this.scene; const r = mulberry32(9090);
    genWeather(s); // idempotent
    // ---- ekran uzayı katmanları
    this.cVeil = screenContainer(s, DEPTH.CLOUDS + 0.2);
    this.veil = s.add.rectangle(0, 0, 10, 10, 0x8a94a6).setOrigin(0, 0); this.cVeil.add(this.veil);
    this.cBolt = screenContainer(s, DEPTH.FOREST - 3);
    this.bolt = s.add.image(0, 0, 'fx_bolt_0').setOrigin(0.5, 0).setVisible(false).setBlendMode('ADD'); this.cBolt.add(this.bolt);
    this.cHaze = screenContainer(s, DEPTH.WEATHER - 1);
    this.haze = s.add.rectangle(0, 0, 10, 10, 0xc8d0da).setOrigin(0, 0); this.cHaze.add(this.haze);
    this.cWx = screenContainer(s, DEPTH.WEATHER);
    this.cFlash = screenContainer(s, DEPTH.LIGHT + 6);
    this.flashRect = s.add.rectangle(0, 0, 10, 10, 0xeaf0ff).setOrigin(0, 0).setAlpha(0).setVisible(false); this.cFlash.add(this.flashRect);
    const mk = (n, key, fn) => { const a = []; for (let i = 0; i < n; i++) { const im = s.add.image(0, 0, typeof key === 'function' ? key(i) : key).setVisible(false); this.cWx.add(im); a.push(fn(im, i)); } return a; };
    this.rainP = mk(MAX.rain, 'fx_rain', (im) => { const z = r(); im.setOrigin(0.5, 1); return { im, u: r(), v: r(), z, spd: 780 + z * 760 }; });
    this.snowP = mk(MAX.snow, 'fx_flake', (im) => { const z = r(); return { im, u: r(), v: r(), z, spd: 42 + z * 70, ph: r() * 6.28, f: 0.5 + r() * 0.9, amp: 10 + r() * 26 }; });
    this.hailP = mk(MAX.hail, 'fx_hail', (im) => ({ im, u: r(), ph: r(), per: 1.05 + r() * 0.35 }));
    this.leafP = mk(MAX.leaf, (i) => 'fx_leaf_' + (i % LEAF_COLORS.length), (im) => { const z = r(); return { im, u: r(), v: r(), z, spd: 34 + z * 40, ph: r() * 6.28, f: 0.6 + r() * 1.1, amp: 24 + r() * 40, spin: 1 + r() * 3 }; });
    // ---- dünya uzayı
    const SPAN_W = WORLD_W + EXT * 2, SPAN_H = WORLD_H + EXT;
    this.wetRect = s.add.rectangle(-EXT, 0, SPAN_W, SPAN_H, 0x1b2a48).setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.4).setAlpha(0).setVisible(false);
    this.dryRect = s.add.rectangle(-EXT, 0, SPAN_W, SPAN_H, 0xd6b640).setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.42).setAlpha(0).setVisible(false);
    this.snowGround = s.add.tileSprite(-EXT, 0, SPAN_W, SPAN_H, 'fx_snowground').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.45).setAlpha(0).setVisible(false);
    this.frostGround = s.add.tileSprite(-EXT, 0, SPAN_W, SPAN_H, 'fx_snowground').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.46).setAlpha(0).setVisible(false);
    this.puddleP = [];
    for (let i = 0; i < MAX.puddle; i++) {
      const im = s.add.image(0, 0, 'fx_puddle').setDepth(DEPTH.GROUND + 0.38).setVisible(false);
      const x = 1500 + r() * 2600, y = 70 + Math.pow(r(), 0.8) * (WORLD_H - 90);
      const sc = 0.45 + r() * 0.9; im.setPosition(x, y).setScale(sc, sc * (0.8 + r() * 0.3));
      this.puddleP.push({ im, x, y, th: i / MAX.puddle * 0.85 + r() * 0.1, sc });
    }
    this.ringP = [];
    for (let i = 0; i < MAX.ring; i++) this.ringP.push({ im: s.add.image(0, 0, 'fx_ring').setDepth(DEPTH.SHADOW + 0.6).setVisible(false), life: 0, max: 0.45 });
    this.shadeP = [];
    for (let i = 0; i < MAX.shade; i++) this.shadeP.push({ im: s.add.image(0, 0, 'fx_cloudshade').setDepth(DEPTH.SHADOW + 0.2).setVisible(false).setTint(0x182444), x: r() * 9000, y: 60 + r() * (WORLD_H - 40), sx: 5.5 + r() * 4, sy: 3.2 + r() * 2, sp: 0.7 + r() * 0.6, a: 0.7 + r() * 0.3 });
    this.capP = [];
    for (let i = 0; i < MAX.cap; i++) this.capP.push({ im: s.add.image(0, 0, 'fx_snowcap').setOrigin(0.5, 0.75).setVisible(false), x: 0, y: 0, w: 0, h: 0, d: 0 });
    this.dripP = [];
    for (let i = 0; i < MAX.drip; i++) this.dripP.push({ im: s.add.image(0, 0, 'fx_flake').setDepth(DEPTH.OBJECTS + 11).setVisible(false).setTint(0xcfe0f8), ph: r(), sp: 1.3 + r() * 0.9 });
    this._ready = true;
    this.setQuality(this.renderer.quality || 'high');
  }

  setQuality(level) {
    const q = QMUL[level] ?? 1; this.qm = q; const n = this.nQ;
    n.rain = Math.round(MAX.rain * q); n.snow = Math.round(MAX.snow * q); n.hail = Math.round(MAX.hail * q); n.leaf = Math.round(MAX.leaf * q);
    n.ring = Math.round(MAX.ring * q); n.puddle = level === 'low' ? 14 : MAX.puddle; n.shade = level === 'low' ? 3 : MAX.shade; n.drip = level === 'low' ? 0 : MAX.drip;
    this.frostOn = true;
  }

  /** Kamera/sinema dışında elle şimşek (test/hata ayıklama). */
  strike(t) {
    const env = this.renderer.env; const now = t ?? env.t;
    this.flashAt = now; this.boltK = Math.floor(Math.random() * BOLT_VARIANTS); this.boltX = 0.18 + Math.random() * 0.64;
    this.bolt.setTexture('fx_bolt_' + this.boltK);
    this.thunderAt = now + 0.5 + Math.random() * 1.5;
    try { this.bus.emit('weather:lightning', { t: now }); } catch { /* yok say */ }
  }

  _hasEvent(kind) {
    const a = this.state?.events?.active; if (!Array.isArray(a)) return false;
    for (let i = 0; i < a.length; i++) if (a[i] && a[i].kind === kind) return true;
    return false;
  }

  /** Hava hedefleri + yumuşatma + şimşek zamanlayıcısı; env'e hava alanlarını yazar (ışık/sis/yağış diğer katmanlarca okunur). */
  update(env) {
    if (!this._ready) return;
    const dt = env.dt, t = env.t, w = this.state?.weather || {};
    const type = w.type || 'clear', inten = clamp(Number.isFinite(w.intensity) ? w.intensity : 0.6, 0, 1);
    const hailEv = this._hasEvent('hail'), droughtEv = this._hasEvent('drought'), frostEv = this._hasEvent('frost');
    let rainT = type === 'rain' ? 0.25 + 0.75 * inten : type === 'storm' ? 0.8 + 0.2 * inten : 0;
    if (hailEv) rainT = Math.max(rainT, 0.55);
    const snowT = type === 'snow' ? 0.3 + 0.7 * inten : 0;
    const fogT = type === 'fog' ? 0.35 + 0.65 * inten : 0;
    const k = 0.7;
    this.rain = approach(this.rain, rainT, k, dt); this.snow = approach(this.snow, snowT, k, dt);
    this.fogA = approach(this.fogA, fogT, 0.5, dt); this.hail = approach(this.hail, hailEv ? 1 : 0, 1.2, dt);
    this.stormK = approach(this.stormK, type === 'storm' || hailEv ? 1 : 0, 0.5, dt);
    this.drought = approach(this.drought, droughtEv ? 1 : 0, 0.4, dt);
    const hour = env.day.hour;
    this.frost = approach(this.frost, frostEv ? 1 - smoothstep(7.5, 10.5, hour) : 0, 0.3, dt);
    const leafT = env.season === 'autumn' && type !== 'snow' ? (0.45 + 0.55 * env.wind) * (1 - 0.5 * this.rain) : 0;
    this.leaf = approach(this.leaf, leafT, 0.5, dt);
    // ıslaklık: WeatherSystem değeri varsa o; yoksa yerel yedek (yağmurda dolar, açıkta kurur)
    this._localWet = clamp(this._localWet + (this.rain > 0.1 ? this.rain * 0.05 : -0.012) * dt, 0, 1);
    const wetS = Number.isFinite(w.wetness) ? w.wetness : this._localWet;
    const sc = Number.isFinite(w.snowCover) ? w.snowCover : 0;
    const pdl = Number.isFinite(w.puddles) ? w.puddles : this._localWet * 0.8;
    this.wet = approach(this.wet, clamp(wetS, 0, 1), 0.8, dt);
    this.snowCover = approach(this.snowCover, clamp(sc, 0, 1), 0.8, dt);
    this.puddles = approach(this.puddles, clamp(pdl, 0, 1), 0.8, dt);
    // env'e yaz
    env.rain = this.rain; env.snow = this.snow; env.hail = this.hail; env.wetness = this.wet; env.snowCover = this.snowCover;
    env.puddles = this.puddles; env.stormK = this.stormK;
    env.fogBoost = clamp(this.fogA * 0.95 + this.rain * 0.12 + this.snow * 0.1, 0, 1);
    if (env.day.fog < env.fogBoost) env.day.fog = env.fogBoost;
    // ---- şimşek: fırtınada rastgele aralık (>= 3.5 sn); flaş en fazla 2 kısa darbe
    if (this.stormK > 0.6) {
      if (this.nextStrike <= 0) this.nextStrike = t + 1.2 + Math.random() * 2;
      if (t >= this.nextStrike) { this.strike(t); this.nextStrike = t + 3.5 + Math.random() * (9 - 4 * inten); }
    } else this.nextStrike = 0;
    const s = t - this.flashAt;
    let f = 0, ba = 0;
    if (s >= 0 && s < 0.6) {
      f = s < 0.05 ? 0.32 : s < 0.11 ? 0.07 : s < 0.17 ? 0.24 : 0.1 * Math.exp(-(s - 0.17) * 9);
      ba = s < 0.5 ? (s < 0.11 ? 1 : s < 0.17 ? 0.5 + 0.5 * (s - 0.11) / 0.06 : 1 - (s - 0.17) / 0.33) : 0;
    }
    this.flash = clamp(f, 0, 0.34); this.boltA = clamp(ba, 0, 1);
    env.flash = this.flash;
    if (this.thunderAt > 0 && t >= this.thunderAt) {
      this.thunderAt = -1;
      try { this.scene.cameras.main.shake(320, 0.0016); this.bus.emit('weather:thunder', { t }); } catch { /* yok say */ }
    }
    // ---- sıçrama halkaları (dünya uzayı; görünür alana rastgele)
    const nR = this.nQ.ring, vb = this.vb;
    if (this.rain > 0.05 && nR > 0 && vb.bottom > 40) {
      this.spawnAcc += dt * (8 + 70 * this.rain) * this.qm;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const rg = this.ringP[this.ringCur]; this.ringCur = (this.ringCur + 1) % nR;
        const y0 = Math.max(vb.top, 30);
        rg.life = rg.max = 0.35 + Math.random() * 0.2;
        rg.im.setPosition(vb.left + Math.random() * (vb.right - vb.left), y0 + Math.random() * Math.max(10, vb.bottom - y0));
      }
    } else this.spawnAcc = 0;
    for (let i = 0; i < MAX.ring; i++) {
      const rg = this.ringP[i];
      if (rg.life > 0 && i < nR) {
        rg.life -= dt; const u = 1 - rg.life / rg.max;
        if (rg.life <= 0) rg.im.setVisible(false);
        else rg.im.setVisible(true).setScale(0.18 + u * 0.55).setAlpha((1 - u) * (1 - u) * 0.55 * clamp(this.rain * 1.4, 0, 1));
      } else if (rg.im.visible) rg.im.setVisible(false);
    }
    // ---- kar başlıkları: örtü başladığında/yaklaşık 3 sn'de bir kaynak nesne konumlarını topla
    this.capT -= dt;
    if (this.snowCover > 0.03 && (this.capT <= 0 || this.capCover <= 0.03)) { this.capT = 0.4; this._collect(); }
    this.capCover = this.snowCover;
  }

  _cap(x, y, w, h, d) {
    if (this.capN >= MAX.cap) return;
    const c = this.capP[this.capN++]; c.x = x; c.y = y; c.w = w; c.h = h; c.d = d;
  }
  _eave(x, y) { if (this.eaveN < MAX.drip) { this.eave[this.eaveN * 2] = x; this.eave[this.eaveN * 2 + 1] = y; this.eaveN++; } }

  /** Çatı/ağaç/çalı/çit üstü başlık konumları (dünya). Ayırma yok: önceden ayrılmış yuvalar yeniden yazılır. */
  _collect() {
    const R = this.renderer; this.capN = 0; this.eaveN = 0;
    const dec = R.decor;
    if (dec && dec.objs[0] && dec.objs[0].visible) {
      const h = dec.objs[0]; this._cap(HOUSE.x, HOUSE.y - 176, 196, 0.5, h.depth + 0.003); this._eave(HOUSE.x - 112, HOUSE.y - 118); this._eave(HOUSE.x + 112, HOUSE.y - 118);
    }
    if (dec) {
      for (const o of dec.trees) {
        if (o.hidden || !o.c.visible) continue; const v = TREE_VARIANTS[o.k], sc = o.sc0;
        const top = (-v.trunkH + 8 - (v.ch + 2)) * sc;
        this._cap(o.c.x, o.c.y + top + v.ch * 0.2 * sc, v.cw * sc * (o.k === 1 ? 0.75 : 0.62), 0.55, o.c.depth + 0.003);
      }
      for (const o of dec.bushes) { if (o.hidden || !o.im.visible) continue; const im = o.im; this._cap(im.x, im.y - im.displayHeight * 0.78, im.displayWidth * 0.62, 0.4, im.depth + 0.003); }
    }
    for (const mod of [R.buildings, R.machines]) {
      if (!mod || !mod.lots) continue;
      for (const lv of mod.lots) {
        const bv = lv.bv; if (!bv || !bv.body || !bv.c.visible) continue; const b = bv.body;
        const top = bv.c.y + b.y - b.originY * b.displayHeight; const w = b.displayWidth * 0.74;
        this._cap(bv.c.x, top + b.displayHeight * 0.2, w, 0.42, bv.c.depth + 0.003); this._eave(bv.c.x - w * 0.5, top + b.displayHeight * 0.42);
      }
    }
    const fc = R.fences?.cells;
    if (fc) for (const c of fc.values()) {
      if (c.type !== 'fence' || !c.im || !c.im.visible) continue;
      this._cap(c.im.x, c.im.y - FENCE.footY + 42, TILE_W * 0.95, 0.16, c.im.depth + 0.003);
    }
    for (let i = this.capN; i < MAX.cap; i++) this.capP[i].im.setVisible(false);
  }

  layout(v, env) {
    if (!this._ready) return;
    const W = v.W, H = v.H, d = v.dpr, t = env.t, wind = env.wind, hY = v.hY;
    const vb = this.vb; vb.left = v.left; vb.right = v.right; vb.top = v.top; vb.bottom = v.bottom;
    const slant = 0.1 + wind * 0.6 + this.stormK * 0.12, ang = -Math.atan(slant);
    for (const c of [this.cVeil, this.cBolt, this.cHaze, this.cWx, this.cFlash]) v.fit(c);
    // ---- gök gri-mavisi örtüsü (bulutlu/yağışlı)
    const vk = env.cloud * 0.5;
    this.cVeil.setVisible(vk > 0.01 && hY > 0);
    if (vk > 0.01 && hY > 0) {
      const lum = 0.28 + 0.72 * env.day.light;
      this.tmp[0] = GREY_TOP[0] * lum; this.tmp[1] = GREY_TOP[1] * lum; this.tmp[2] = GREY_TOP[2] * lum;
      this.veil.setSize(W, hY + 2).setFillStyle(rgbToInt(this.tmp), vk);
    }
    // ---- sis örtüsü
    const hz = clamp(this.fogA * 0.34 + this.rain * 0.07 + this.snow * 0.1, 0, 0.5);
    this.cHaze.setVisible(hz > 0.01);
    if (hz > 0.01) {
      mixRgb(WHITE, env.day.skyBottom, 0.35, this.tmp2); const a = env.ambient;
      this.tmp[0] = this.tmp2[0] * (0.75 + 0.25 * a[0]); this.tmp[1] = this.tmp2[1] * (0.75 + 0.25 * a[1]); this.tmp[2] = this.tmp2[2] * (0.75 + 0.25 * a[2]);
      this.haze.setSize(W, H).setFillStyle(rgbToInt(this.tmp), hz);
    }
    // ---- yağmur
    const nr = this.nQ.rain, nRain = Math.ceil(nr * this.rain * (0.45 + 0.55 * this.rain)), pad = 80 * d, span = H + pad;
    const rainA = clamp(this.rain * 1.3, 0, 1) * (0.6 + 0.4 * (1 - this.snow));
    for (let i = 0; i < MAX.rain; i++) {
      const p = this.rainP[i], im = p.im;
      if (i >= nRain) { if (im.visible) im.setVisible(false); continue; }
      const y = (((p.v + t * p.spd * d / span) % 1) * span) - pad * 0.5;
      let x = p.u * (W + 160 * d) + y * slant - 80 * d; x = ((x % (W + 160 * d)) + W + 160 * d) % (W + 160 * d) - 80 * d;
      im.setVisible(true).setPosition(x, y).setRotation(ang).setScale(d * (0.55 + p.z * 0.6), d * (0.8 + p.z * 0.9) * (1 + wind * 0.4)).setAlpha(rainA * (0.16 + p.z * 0.34));
    }
    // ---- kar
    const nSnow = Math.ceil(this.nQ.snow * this.snow), spanS = H + 40 * d;
    for (let i = 0; i < MAX.snow; i++) {
      const p = this.snowP[i], im = p.im;
      if (i >= nSnow) { if (im.visible) im.setVisible(false); continue; }
      const y = (((p.v + t * p.spd * d / spanS) % 1) * spanS) - 20 * d;
      let x = p.u * W + Math.sin(t * p.f + p.ph) * p.amp * d + t * wind * (20 + 60 * p.z) * d; x = ((x % (W + 60 * d)) + W + 60 * d) % (W + 60 * d) - 30 * d;
      im.setVisible(true).setPosition(x, y).setScale(d * (0.42 + p.z * 0.75)).setAlpha(clamp(this.snow * 1.3, 0, 1) * (0.6 + 0.4 * p.z));
    }
    // ---- dolu: düşer, yere çarpıp iki kez sekir
    const nHail = Math.ceil(this.nQ.hail * this.hail);
    for (let i = 0; i < MAX.hail; i++) {
      const p = this.hailP[i], im = p.im;
      if (i >= nHail) { if (im.visible) im.setVisible(false); continue; }
      const cyc = t / p.per + p.ph, c = Math.floor(cyc), s = (cyc - c) * p.per;
      const xr = fract(Math.sin((i + 1) * 12.9898 + c * 78.233) * 43758.5453), yr = fract(Math.sin((i + 3) * 39.346 + c * 11.135) * 24634.6345);
      const yg = H * (0.5 + 0.48 * yr), FT = 0.36;
      let y, a = 0.95;
      if (s < FT) { const u = s / FT; y = -16 * d + (yg + 16 * d) * u * u; }
      else { const b = s - FT; if (b < 0.22) { const u = b / 0.22; y = yg - 30 * d * 4 * u * (1 - u); } else if (b < 0.38) { const u = (b - 0.22) / 0.16; y = yg - 11 * d * 4 * u * (1 - u); } else { y = yg; a = Math.max(0, 1 - (b - 0.38) / 0.12); } }
      let x = xr * (W + 100 * d) + (s < FT ? y : yg) * slant - 50 * d; x = ((x % (W + 100 * d)) + W + 100 * d) % (W + 100 * d) - 50 * d;
      im.setVisible(a > 0.01).setPosition(x, y).setScale(d * 0.75).setAlpha(a * clamp(this.hail * 1.5, 0, 1));
    }
    // ---- düşen yapraklar
    const nLeaf = Math.ceil(this.nQ.leaf * this.leaf), spanL = H + 50 * d;
    for (let i = 0; i < MAX.leaf; i++) {
      const p = this.leafP[i], im = p.im;
      if (i >= nLeaf) { if (im.visible) im.setVisible(false); continue; }
      const y = (((p.v + t * p.spd * (1 + wind) * d / spanL) % 1) * spanL) - 25 * d;
      let x = p.u * W + Math.sin(t * p.f + p.ph) * p.amp * d + t * (14 + wind * 90) * (0.5 + p.z) * d; x = ((x % (W + 80 * d)) + W + 80 * d) % (W + 80 * d) - 40 * d;
      const sq = 0.35 + 0.65 * Math.abs(Math.cos(t * p.spin + p.ph));
      im.setVisible(true).setPosition(x, y).setRotation(t * p.spin * 0.8 + p.ph).setScale(d * (0.55 + p.z * 0.55), d * (0.55 + p.z * 0.55) * sq).setAlpha(clamp(this.leaf * 1.6, 0, 1) * 0.9);
    }
    // ---- şimşek ve flaş
    // ufuk kadrajdaysa şimşek gökte (tepelerin arkasında); kamera yere bakıyorsa uzak bir çarpma olarak ekranın üstüne biner
    const sky = hY > 160 * d;
    const bOn = this.boltA > 0.01;
    this.bolt.setVisible(bOn); this.cBolt.setDepth(sky ? DEPTH.FOREST - 3 : DEPTH.WEATHER + 1);
    if (bOn) { const bh = sky ? hY * 0.98 : H * 0.78, sc = bh / BOLT_H; this.bolt.setPosition(this.boltX * W, 0).setScale(sc).setAlpha(this.boltA * (sky ? 1 : 0.6)).setTint(0xdce6ff); }
    this.flashRect.setVisible(this.flash > 0.004).setSize(W, H).setAlpha(this.flash);
    this._world(v, env);
  }

  _world(v, env) {
    const t = env.t, vb = this.vb, wind = env.wind;
    // ıslak zemin koyulaşması / kuraklık sararması / kar / kırağı
    const snowK = this.snowCover, wetA = 0.3 * this.wet * (1 - snowK * 0.8);
    this.wetRect.setVisible(wetA > 0.005).setAlpha(wetA);
    this.dryRect.setVisible(this.drought > 0.01).setAlpha(0.14 * this.drought * (1 - snowK));
    const sa = 0.8 * smoothstep(0, 0.35, snowK);
    this.snowGround.setVisible(sa > 0.01).setAlpha(sa);
    const fa = 0.4 * this.frost * (1 - snowK);
    this.frostGround.setVisible(fa > 0.01).setAlpha(fa);
    // birikintiler (kışın yok): eşiği geçenler yumuşakça belirir
    const pud = this.puddles * (1 - smoothstep(0.1, 0.5, snowK));
    const sky = env.day.skyBottom, amb = env.ambient;
    const pt = rgbToInt(mixRgb(WHITE, sky, 0.5, this.tmp));
    for (let i = 0; i < MAX.puddle; i++) {
      const p = this.puddleP[i], im = p.im;
      const a = i < this.nQ.puddle ? clamp((pud - p.th) * 3.5, 0, 1) : 0;
      const on = a > 0.02 && p.x > vb.left - 160 && p.x < vb.right + 160 && p.y > vb.top - 60 && p.y < vb.bottom + 60;
      if (!on) { if (im.visible) im.setVisible(false); continue; }
      im.setVisible(true).setTint(pt).setAlpha(a * 0.62 * (0.8 + 0.2 * Math.sin(t * 0.7 + i)));
    }
    // kayan bulut gölgeleri (yalnızca güneşliyken anlamlı)
    const bell = smoothstep(0.08, 0.3, env.cloud) * (1 - smoothstep(0.7, 0.95, env.cloud));
    const sa2 = (0.06 + 0.2 * bell) * env.sun.intensity * (1 - this.snowCover * 0.3);
    const spanL = vb.left - 1400, spanW = (vb.right - vb.left) + 2800;
    for (let i = 0; i < MAX.shade; i++) {
      const p = this.shadeP[i], im = p.im;
      if (i >= this.nQ.shade || sa2 < 0.01 || vb.bottom < 40) { if (im.visible) im.setVisible(false); continue; }
      const x = spanL + ((((p.x + t * (12 + wind * 70) * p.sp) - spanL) % spanW) + spanW) % spanW;
      im.setVisible(true).setPosition(x, p.y).setScale(p.sx, p.sy).setAlpha(sa2 * p.a);
    }
    // kar başlıkları
    const cA = smoothstep(0.08, 0.6, snowK);
    for (let i = 0; i < MAX.cap; i++) {
      const c = this.capP[i], im = c.im;
      if (i >= this.capN || cA < 0.01) { if (im.visible) im.setVisible(false); continue; }
      const sx = c.w / 128 * (0.55 + 0.45 * cA);
      im.setVisible(true).setPosition(c.x, c.y).setDepth(c.d).setScale(sx, sx * (c.h / 0.3) * 0.62 * (0.6 + 0.4 * cA)).setAlpha(cA);
    }
    // çatı damlaları
    const dr = this.rain * (1 - snowK);
    for (let i = 0; i < MAX.drip; i++) {
      const p = this.dripP[i], im = p.im;
      if (i >= this.eaveN || i >= this.nQ.drip || dr < 0.1) { if (im.visible) im.setVisible(false); continue; }
      const ph = fract(t * p.sp + p.ph), x = this.eave[i * 2], y = this.eave[i * 2 + 1];
      im.setVisible(true).setPosition(x + (i % 3 - 1) * 14, y + ph * ph * 26).setScale(0.2, 0.34).setAlpha(dr * 0.85 * (1 - ph * 0.6));
    }
  }

  destroy() {
    for (const c of [this.cVeil, this.cBolt, this.cHaze, this.cWx, this.cFlash]) c?.destroy();
    for (const a of [this.puddleP, this.ringP, this.shadeP, this.capP, this.dripP]) if (a) for (const p of a) p.im.destroy();
    for (const o of [this.wetRect, this.dryRect, this.snowGround, this.frostGround]) o?.destroy();
    this._ready = false;
  }
}
