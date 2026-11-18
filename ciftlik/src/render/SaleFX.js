// Satış / alış / seviye efektleri (PLAN §9 "Görsel"). Nesne havuzlu; update'te bellek ayırma yok.
// • market:result {ok}   → tezgâhtan yukarı saçılan dönen altın sikkeler + parıltı + kısa ışık; total ≥ BIG_SALE daha gösterişli.
// • shop:result {ok}     → evin kapı eşiğinde düşüp zıplayan küçük koli, toz + parıltı, sonra küçülüp kaybolur (teslimat).
// • level:up             → ekran ortasından yayılan ince altın ışık halkası (tek seferlik, 3 sprite; PostFX'e yük yok).
// Dokular pişirilmiş renkli (tint yalnızca WebGL'de gece sikke tonu için); Canvas renderer'da da çalışır.
import { DEPTH, depthForY } from '../core/constants.js';
import { HOUSE, STALL } from './layout.js';
import { screenContainer } from './View.js';
import { clamp, rgbToInt, mixRgb } from './util.js';

const BIG_SALE = 500; // görsel eşik (PLAN §9 görev kartı: "büyük satış total ≥ 500")
const MAX = 140;
const MUL = { high: 1, medium: 0.7, low: 0.4 };
const K_COIN = 1, K_SPARK = 2, K_GLOW = 3, K_GRING = 4, K_PARCEL = 5, K_PUFF = 6;
const COIN_DEPTH = DEPTH.LIGHT + 2;      // ışık katmanının üstünde; gece tonu tint ile (WebGL)
const SPARK_DEPTH = DEPTH.LIGHT + 3;
const DOOR = { x: HOUSE.x, y: HOUSE.y - 12 }; // kapı eşiği (prop_house: kapı ortası footX'te)
const WHITE = [1, 1, 1];

export default class SaleFX {
  constructor(scene, bus, webgl) {
    this.scene = scene; this.bus = bus; this.webgl = webgl;
    this.q = 'high'; this.mul = 1; this.t = 0; this.parcels = 0;
    this.tmp = [1, 1, 1]; this.coinTint = 0xffffff;
    this._offs = [];
  }

  create() {
    const s = this.scene;
    this.pool = []; this.free = []; this.active = [];
    for (let i = 0; i < MAX; i++) {
      const im = s.add.image(0, 0, 'fx_coin').setVisible(false);
      const p = { im, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, age: 0, life: 1, s0: 1, s1: 1, a0: 1, spin: 0, ph: 0, bounce: 0, landed: 0, sy: 1 };
      this.pool.push(p); this.free.push(p);
    }
    // seviye halkası (ekran uzayı)
    this.cScr = screenContainer(s, DEPTH.LIGHT + 6);
    this.ring = [s.add.image(0, 0, 'fx_ring_gold').setBlendMode('ADD').setVisible(false), s.add.image(0, 0, 'fx_ring_gold').setBlendMode('ADD').setVisible(false)];
    this.flash = s.add.image(0, 0, 'fx_glow_gold').setBlendMode('ADD').setVisible(false);
    this.cScr.add([this.flash, ...this.ring]);
    this.lvl = { on: false, t0: 0 };
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('market:result', (p) => { if (p && p.ok) this.sale(Number(p.total) || 0); });
    on('shop:result', (p) => { if (p && p.ok) this.delivery(); });
    on('level:up', () => this.levelUp());
  }

  setQuality(level) { if (MUL[level]) { this.q = level; this.mul = MUL[level]; } }
  _n(n) { return Math.max(1, Math.round(n * this.mul)); }

  _p(key, x, y, life, kind, depth, add) {
    const p = this.free.pop(); if (!p) return null;
    p.kind = kind; p.x = x; p.y = y; p.z = 0; p.vx = p.vy = p.vz = 0; p.g = 0; p.drag = 0; p.age = 0; p.life = life;
    p.s0 = p.s1 = 1; p.a0 = 1; p.spin = 0; p.ph = Math.random() * 6.28; p.bounce = 0; p.landed = 0; p.sy = 1;
    p.im.setTexture(key).setDepth(depth).setBlendMode(add ? 1 : 0).setRotation(0).setScale(1).setAlpha(0).setVisible(true);
    if (this.webgl) p.im.clearTint();
    this.active.push(p);
    return p;
  }

  // ------------------------------------------------------------------ satış
  sale(total) {
    const big = total >= BIG_SALE;
    const R = Math.random;
    const cx = STALL.x, cy = STALL.y - 66; // tezgâh üstü
    const nCoin = this._n(big ? 34 : 13);
    for (let i = 0; i < nCoin; i++) {
      const p = this._p('fx_coin', cx + (R() - 0.5) * (big ? 120 : 80), cy + (R() - 0.5) * 10, 1.25 + R() * 0.6, K_COIN, COIN_DEPTH, false); if (!p) break;
      p.vx = (R() - 0.5) * (big ? 190 : 130); p.vy = -(200 + R() * (big ? 220 : 130)); p.g = 330; p.drag = 0.9;
      p.s0 = p.s1 = 0.75 + R() * 0.45; p.spin = 7 + R() * 9; p.a0 = 1;
      if (big && i % 2) p.age = -0.22 - R() * 0.25; // ikinci dalga
    }
    const nSp = this._n(big ? 24 : 9);
    for (let i = 0; i < nSp; i++) {
      const p = this._p('fx_sparkle_gold', cx + (R() - 0.5) * (big ? 170 : 110), cy - R() * (big ? 120 : 70), 0.5 + R() * 0.6, K_SPARK, SPARK_DEPTH, true); if (!p) break;
      p.vy = -14 - R() * 20; p.s0 = 0.35 + R() * 0.5; p.s1 = 0.05; p.age = -R() * (big ? 0.9 : 0.45); p.spin = (R() - 0.5) * 3;
    }
    const gl = this._p('fx_glow_gold', cx, cy + 6, big ? 0.9 : 0.6, K_GLOW, SPARK_DEPTH, true);
    if (gl) { gl.s0 = big ? 1.2 : 0.8; gl.s1 = big ? 3.4 : 2.0; gl.a0 = big ? 0.85 : 0.6; gl.sy = 0.7; }
    if (big) {
      const r = this._p('fx_ring_gold', cx, STALL.y + 4, 1.1, K_GRING, DEPTH.SHADOW + 1, true);
      if (r) { r.s0 = 0.2; r.s1 = 1.5; r.a0 = 0.8; r.sy = 0.36; }
    }
  }

  // ------------------------------------------------------------------ teslimat
  delivery() {
    const R = Math.random;
    const k = this.parcels++ % 3;
    const x = DOOR.x + (k - 1) * 16 + (R() - 0.5) * 4, y = DOOR.y + (k === 1 ? 2 : 0);
    const p = this._p('fx_parcel', x, y, 2.1, K_PARCEL, depthForY(HOUSE.y) + 0.01, false); if (!p) return;
    p.im.setOrigin(0.5, 0.9);
    p.z = 46; p.vz = 0; p.ph = -1; p.g = 760; p.bounce = 0.32; p.s0 = p.s1 = 1; p.a0 = 1;
  }

  _land(p, hard) {
    const R = Math.random;
    for (let i = 0, n = this._n(hard ? 3 : 1); i < n; i++) {
      const q = this._p('fx_puff', p.x + (R() - 0.5) * 18, p.y + 1, 0.6 + R() * 0.3, K_PUFF, depthForY(HOUSE.y) + 0.02, false); if (!q) break;
      q.vx = (R() - 0.5) * 50; q.vz = 6 + R() * 8; q.drag = 2; q.s0 = 0.18; q.s1 = 0.5; q.a0 = 0.5; q.sy = 0.7;
    }
    if (!hard) return;
    for (let i = 0, n = this._n(4); i < n; i++) {
      const q = this._p('fx_sparkle_gold', p.x + (R() - 0.5) * 26, p.y - 10 - R() * 18, 0.45 + R() * 0.3, K_SPARK, SPARK_DEPTH, true); if (!q) break;
      q.vy = -12; q.s0 = 0.3 + R() * 0.3; q.s1 = 0.05; q.age = -R() * 0.2;
    }
  }

  // ------------------------------------------------------------------ seviye
  levelUp() { this.lvl.on = true; this.lvl.t0 = this.t; }

  update(env) {
    const dt = env.dt; this.t = env.t;
    if (this.webgl) { mixRgb(env.ambient, WHITE, 0.55, this.tmp); this.coinTint = rgbToInt(this.tmp); }
    const A = this.active;
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i];
      p.age += dt;
      if (p.age < 0) { p.im.setAlpha(0); continue; }
      const k = p.age / p.life;
      if (k >= 1) { p.im.setVisible(false); if (p.kind === K_PARCEL) p.im.setOrigin(0.5, 0.5); A[i] = A[A.length - 1]; A.pop(); this.free.push(p); continue; }
      const im = p.im;
      switch (p.kind) {
        case K_COIN: {
          const dr = Math.max(0, 1 - p.drag * dt);
          p.vx *= dr; p.vy = p.vy * dr + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          const sc = p.s0 * Math.abs(Math.cos(p.age * p.spin + p.ph));
          const fade = k < 0.08 ? k / 0.08 : k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
          im.setPosition(p.x, p.y).setScale(Math.max(0.08, sc), p.s0).setAlpha(fade * p.a0);
          if (this.webgl) im.setTint(this.coinTint);
          break;
        }
        case K_SPARK: {
          p.y += p.vy * dt;
          const tw = Math.sin(k * Math.PI);
          im.setPosition(p.x, p.y).setScale(p.s0 * (0.4 + 0.6 * tw) + p.s1).setRotation(p.age * p.spin + p.ph * 0.2).setAlpha(tw);
          break;
        }
        case K_GLOW: case K_GRING: {
          const e = 1 - (1 - k) * (1 - k);
          const sc = p.s0 + (p.s1 - p.s0) * e;
          im.setPosition(p.x, p.y).setScale(sc, sc * p.sy).setAlpha(p.a0 * (1 - k) * (k < 0.1 ? k / 0.1 : 1));
          break;
        }
        case K_PUFF: {
          const dr = Math.max(0, 1 - p.drag * dt); p.vx *= dr; p.x += p.vx * dt; p.z += p.vz * dt;
          const sc = p.s0 + (p.s1 - p.s0) * k;
          im.setPosition(p.x, p.y - p.z).setScale(sc, sc * p.sy).setAlpha(p.a0 * (1 - k));
          break;
        }
        case K_PARCEL: {
          // düş → zıpla (ezilme) → bekle → kalkıp küçülerek kaybol
          let sx = 1, sy = 1, a = 1;
          if (p.landed < 3) {
            p.vz -= p.g * dt; p.z += p.vz * dt;
            if (p.z <= 0) {
              p.z = 0;
              const hard = p.landed === 0;
              this._land(p, hard);
              p.landed++; p.vz = -p.vz * p.bounce; if (p.vz < 40) { p.vz = 0; p.landed = 3; }
              p.ph = p.age; // ezilme başlangıcı
            }
            if (p.z > 0) { sx = 0.94; sy = 1.08; }
          }
          const sq = p.age - p.ph;
          if (sq < 0.22 && p.ph >= 0) { const e = Math.sin(sq / 0.22 * Math.PI) * (1 - sq / 0.22); sx += e * 0.22; sy -= e * 0.2; }
          if (k > 0.72) { const e = (k - 0.72) / 0.28; p.z = e * e * 10; sx *= 1 - e * 0.75; sy *= 1 - e * 0.75; a = 1 - e * e; }
          else a = Math.min(1, p.age / 0.06);
          im.setPosition(p.x, p.y - p.z).setScale(sx * 1.3, sy * 1.3).setAlpha(a);
          break;
        }
        default: break;
      }
    }
  }

  layout(v) {
    const L = this.lvl;
    if (!L.on) { this.cScr.setVisible(false); return; }
    const t = this.t - L.t0, dur = 1.7;
    if (t > dur + 0.25) { L.on = false; this.cScr.setVisible(false); return; }
    v.fit(this.cScr); this.cScr.setVisible(true);
    const cx = v.W / 2, cy = v.H / 2, diag = Math.sqrt(v.W * v.W + v.H * v.H);
    for (let i = 0; i < 2; i++) {
      const k = clamp((t - i * 0.2) / dur, 0, 1); const im = this.ring[i];
      const e = 1 - Math.pow(1 - k, 3);
      const sc = (0.04 + e * 0.62) * diag / 256 * (i ? 0.9 : 1);
      const a = (i ? 0.6 : 1) * Math.pow(1 - k, 1.1) * clamp(k / 0.04, 0, 1);
      im.setVisible(a > 0.005).setPosition(cx, cy).setScale(sc).setAlpha(a);
    }
    const fk = clamp(t / 0.9, 0, 1);
    this.flash.setVisible(fk < 1).setPosition(cx, cy).setScale((0.6 + fk * 3.2) * v.dpr).setAlpha(0.32 * (1 - fk) * clamp(fk / 0.08, 0, 1));
  }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const p of this.pool || []) p.im.destroy();
    this.cScr?.destroy();
  }
}
