// BuildingView — boş arsa işaretleri, kümes/ahır/arı kovanı ve inşa efektleri (PLAN §10 "Görsel").
// State'i YALNIZCA OKUR: state.buildings. Olaylar: building:built (pop + toz/parıltı), animals:changed, animal:result,
// save:loaded, tile:hover (boş arsa vurgusu). Tüm nesneler create'te / bina eklenince BİR KEZ kurulur; update'te bellek ayrılmaz.
import { depthForY, DEPTH, TILE_W, TILE_H } from '../core/constants.js';
import { BUILDINGS } from '../data/buildings.js';
import { genBuildings, BLD, LOT_PAD, SIGN, lotKey, lotHlKey } from '../render/textures/buildings.js';

const FX_N = 56;
const SIGN_Y = { hive: 3, coop: 4, barn: 4 };

/** Paylaşılan, havuzlanmış parçacık sprite'ları (toz, parıltı, kalp). */
export class FxPool {
  constructor(scene) {
    this.scene = scene; this.items = [];
    for (let i = 0; i < FX_N; i++) {
      const im = scene.add.image(0, 0, 'fx_dust').setVisible(false).setDepth(DEPTH.WEATHER + 2);
      this.items.push({ im, on: false, vx: 0, vy: 0, g: 0, life: 0, max: 1, s0: 1, s1: 1, a: 1, rot: 0 });
    }
    this.cursor = 0;
  }
  spawn(key, x, y, vx, vy, life, s0, s1, a, add, g = 0, rot = 0) {
    let it = null;
    for (let k = 0; k < FX_N; k++) { const c = this.items[(this.cursor + k) % FX_N]; if (!c.on) { it = c; this.cursor = (this.cursor + k + 1) % FX_N; break; } }
    if (!it) { it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % FX_N; }
    it.on = true; it.vx = vx; it.vy = vy; it.g = g; it.life = life; it.max = life; it.s0 = s0; it.s1 = s1; it.a = a; it.rot = rot;
    it.im.setTexture(key).setPosition(x, y).setScale(s0).setAlpha(a).setBlendMode(add ? 'ADD' : 'NORMAL').setVisible(true).setRotation(0);
  }
  dust(x, y, spread, n) {
    for (let i = 0; i < n; i++) {
      const d = (i / Math.max(1, n - 1)) * 2 - 1;
      this.spawn('fx_dust', x + d * spread, y - 2 - Math.random() * 6, d * 40 + (Math.random() - 0.5) * 16, -8 - Math.random() * 14, 0.9 + Math.random() * 0.5, 0.35, 0.95 + Math.random() * 0.4, 0.8, false, 0);
    }
  }
  sparkle(x, y, w, h, n) {
    for (let i = 0; i < n; i++) this.spawn('fx_spark', x + (Math.random() - 0.5) * w, y - Math.random() * h, (Math.random() - 0.5) * 14, -14 - Math.random() * 18, 0.8 + Math.random() * 0.7, 0.3 + Math.random() * 0.25, 0.05, 0.95, true, 0, (Math.random() - 0.5) * 4);
  }
  hearts(x, y, n) {
    for (let i = 0; i < n; i++) this.spawn('fx_heart', x + (i - (n - 1) / 2) * 12, y, (i - (n - 1) / 2) * 6, -26 - i * 4, 1.3 + i * 0.12, 0.45, 0.8, 1, false, 0);
    this.sparkle(x, y, 26, 14, 4);
  }
  update(dt) {
    for (let i = 0; i < FX_N; i++) {
      const it = this.items[i]; if (!it.on) continue;
      it.life -= dt;
      if (it.life <= 0) { it.on = false; it.im.setVisible(false); continue; }
      const k = 1 - it.life / it.max;
      it.vy += it.g * dt; it.vx *= 1 - Math.min(1, dt * 1.5);
      it.im.x += it.vx * dt; it.im.y += it.vy * dt;
      it.im.setScale(it.s0 + (it.s1 - it.s0) * k);
      it.im.setAlpha(it.a * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85));
      if (it.rot) it.im.rotation += it.rot * dt;
    }
  }
  destroy() { for (const it of this.items) it.im.destroy(); this.items.length = 0; }
}

const MAX_DIRT = 6;
const BEES = 5;

export default class BuildingView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.lots = []; this.byLot = new Map(); this.byId = new Map();
    this.dirty = true; this.poll = 0; this.t = 0; this.hoverLot = null; this._offs = [];
    this.pending = new Set(); this._door = { x: 0, y: 0 };
  }

  create() {
    const s = this.scene;
    genBuildings(s); // idempotent
    this.fx = new FxPool(s);
    for (const type of Object.keys(BUILDINGS)) {
      for (const lot of BUILDINGS[type].lots) {
        const wt = lot.x1 - lot.x0 + 1, ht = lot.y1 - lot.y0 + 1;
        const px = lot.x0 * TILE_W, py = lot.y0 * TILE_H, W = wt * TILE_W, H = ht * TILE_H;
        const botY = py + H;
        const lv = {
          type, lot, id: lot.id, px, py, W, H, botY, fx: px + W / 2, fy: botY - (type === 'hive' ? 6 : type === 'barn' ? 8 : 10),
          hover: 0, ph: this.lots.length * 1.7, b: null, bv: null, popT: -1, shown: false,
        };
        const dep = depthForY(botY);
        lv.patch = s.add.image(px - LOT_PAD.x, py - LOT_PAD.t, lotKey(wt, ht)).setOrigin(0, 0).setDepth(dep - 0.02);
        lv.hl = s.add.image(px - LOT_PAD.x, py - LOT_PAD.t, lotHlKey(wt, ht)).setOrigin(0, 0).setBlendMode('ADD').setAlpha(0).setVisible(false).setDepth(dep - 0.015);
        const sx = type === 'hive' ? px + W - 10 : px + W * 0.5 - (type === 'barn' ? 90 : 60);
        lv.sign = s.add.image(sx, botY + SIGN_Y[type], `bld_sign_${type}`).setOrigin(SIGN.ox / SIGN.w, SIGN.oy / SIGN.h).setDepth(depthForY(botY + SIGN_Y[type]));
        this.lots.push(lv); this.byLot.set(lot.id, lv);
      }
    }
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('animals:changed', () => { this.dirty = true; });
    on('animal:result', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    on('building:built', (p) => { if (p && p.lotId) this.pending.add(p.lotId); this.dirty = true; });
    on('tile:hover', (p) => {
      this.hoverLot = null;
      if (!p) return;
      for (const lv of this.lots) { const l = lv.lot; if (!lv.b && p.tx >= l.x0 && p.tx <= l.x1 && p.ty >= l.y0 && p.ty <= l.y1) { this.hoverLot = lv; break; } }
    });
    this.sync(true);
  }

  /** Bina için dünya koordinatında kapı noktası (hayvanlar girip çıkar). Ayırma yapmaz: ortak nesneyi yeniden kullanır. */
  doorOf(buildingId) {
    const lv = this.byId.get(buildingId); if (!lv) return null;
    const d = BLD[lv.type].door; this._door.x = lv.fx + d[0]; this._door.y = lv.fy + d[1] - 4;
    return this._door;
  }

  _build(lv) {
    const s = this.scene, L = BLD[lv.type];
    const c = s.add.container(lv.fx, lv.fy).setDepth(depthForY(lv.fy));
    const body = s.add.image(0, 0, L.key).setOrigin(L.ox / L.w, L.oy / L.h);
    c.add(body);
    const dirt = [];
    const [dx0, dx1, dy0, dy1] = L.dirt;
    for (let i = 0; i < MAX_DIRT; i++) {
      const u = ((i * 0.618 + 0.13) % 1), v = ((i * 0.37 + 0.2) % 1);
      const im = s.add.image(dx0 + u * (dx1 - dx0), dy0 + v * (dy1 - dy0), `bld_dirt${i % 3}`).setScale(lv.type === 'hive' ? 0.6 : 0.9 + (i % 2) * 0.2).setVisible(false);
      dirt.push(im); c.add(im);
    }
    const basket = s.add.image(L.basket[0], L.basket[1], `bld_basket_${lv.type}`).setOrigin(16 / 32, 27 / 30).setScale(lv.type === 'hive' ? 0.8 : 0.95).setVisible(false);
    c.add(basket);
    lv.bv = { c, body, dirt, basket, dirtN: 0, shadow: null, lights: [], glows: [], bees: null };
    const R = this.renderer;
    lv.bv.shadow = R.shadows.register(c, { footX: lv.fx, footY: lv.fy - 1, height: L.height, width: L.shw, shadowKey: L.key });
    // pencere ışıkları (gece): emisif çekirdek + yumuşak yayılım
    for (const [wx, wy] of L.win) {
      const gx = lv.fx + wx, gy = lv.fy + wy;
      const glow = s.add.image(gx, gy, 'prop_lantern_glow').setScale(lv.type === 'barn' ? 0.55 : 0.5);
      R.lighting.addEmissive(glow, 0.75); lv.bv.glows.push(glow);
      lv.bv.lights.push(R.lights.addPoint({ x: gx, y: gy + 10, radius: lv.type === 'barn' ? 70 : 56, color: 0xffd08a, intensity: 0.55, nightOnly: true, flicker: 0.05 }));
    }
    if (lv.type === 'hive') {
      lv.bv.bees = [];
      for (let i = 0; i < BEES; i++) {
        const im = s.add.image(lv.fx, lv.fy - 20, 'bld_bee').setDepth(depthForY(lv.fy) + 0.01).setVisible(false);
        lv.bv.bees.push({ im, a: i * 1.3, sp: 1.6 + (i % 3) * 0.5, rx: 18 + i * 4, ry: 10 + (i % 2) * 6, ph: i * 2.1 });
      }
    }
    return lv.bv;
  }

  _unbuild(lv) {
    const bv = lv.bv; if (!bv) return;
    bv.shadow?.remove(); for (const l of bv.lights) l.remove();
    const pts = this.renderer.lighting?.points;
    for (const g of bv.glows) { if (pts) { const i = pts.findIndex((it) => it.im === g); if (i >= 0) pts.splice(i, 1); } g.destroy(); }
    if (bv.bees) for (const b of bv.bees) b.im.destroy();
    bv.c.destroy(); lv.bv = null;
  }

  sync(initial = false) {
    this.dirty = false;
    const list = this.state?.buildings; const arr = Array.isArray(list) ? list : [];
    for (const lv of this.lots) lv.b = null;
    this.byId.clear();
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i]; const lv = b && this.byLot.get(b.lotId);
      if (lv) { lv.b = b; this.byId.set(b.id, lv); }
    }
    for (const lv of this.lots) {
      const b = lv.b;
      lv.patch.setVisible(!b); lv.sign.setVisible(!b);
      if (!b) {
        lv.hl.setVisible(false);
        if (lv.bv) { this._unbuild(lv); }
        lv.shown = false; continue;
      }
      if (!lv.bv) {
        this._build(lv);
        if (!initial && this.pending.has(lv.id)) this._pop(lv);
      }
      this.pending.delete(lv.id);
      const bv = lv.bv; bv.c.setVisible(true);
      // kir lekeleri
      const dirt = Number(b.dirt) || 0;
      const n = dirt > 60 ? Math.min(MAX_DIRT, 1 + Math.floor((dirt - 60) / 40 * MAX_DIRT)) : 0;
      if (n !== bv.dirtN) { for (let i = 0; i < MAX_DIRT; i++) bv.dirt[i].setVisible(i < n); bv.dirtN = n; }
      // ürün sepeti
      let qty = 0; const box = b.box;
      if (box) for (const k in box) { const st = box[k]; if (Array.isArray(st)) for (let i = 0; i < st.length; i++) qty += st[i] && st[i].qty > 0 ? st[i].qty : 0; }
      bv.basket.setVisible(qty > 0);
    }
  }

  _pop(lv) {
    lv.popT = 0;
    lv.bv.c.setScale(0.001).setAlpha(0);
    const w = BLD[lv.type].shw * 0.5;
    this.fx.dust(lv.fx, lv.fy + 2, w, 12);
    this.fx.sparkle(lv.fx, lv.fy - 10, w * 1.6, BLD[lv.type].height * 0.9, 12);
  }

  update(env) {
    if (!this.lots.length) return;
    const dt = env.dt, t = env.t; this.t = t;
    this.poll += dt;
    if (this.dirty || this.poll > 0.5) { this.poll = 0; this.sync(); }
    this.fx.update(dt);
    const v = this.scene.cameras.main.worldView;
    const wind = env.wind, light = env.day.light;
    const beesOut = light > 0.5 && env.cloud < 0.8;
    for (const lv of this.lots) {
      if (lv.px + lv.W + 200 < v.x || lv.px - 200 > v.right || lv.botY + 60 < v.y || lv.botY - 330 > v.bottom) continue;
      if (!lv.b) {
        const hv = this.hoverLot === lv ? 1 : 0;
        lv.hover += (hv - lv.hover) * Math.min(1, dt * 9);
        const a = lv.hover * (0.55 + 0.25 * Math.sin(t * 4.2)) * (0.8 + 0.3 * (1 - light));
        lv.hl.setVisible(a > 0.01).setAlpha(Math.min(1, a));
        lv.sign.rotation = Math.sin(t * 1.4 + lv.ph) * (0.015 + wind * 0.05) - wind * 0.03 + lv.hover * Math.sin(t * 6) * 0.03;
        continue;
      }
      const bv = lv.bv; if (!bv) continue;
      if (lv.popT >= 0) {
        lv.popT += dt; const k = lv.popT / 0.85;
        if (k >= 1) { lv.popT = -1; bv.c.setScale(1).setAlpha(1); }
        else {
          const s = 1 - Math.exp(-5.5 * k) * Math.cos(k * Math.PI * 3.1);
          const sy = Math.max(0.001, s);
          bv.c.setScale(0.9 + 0.1 * Math.min(1.1, sy), sy).setAlpha(Math.min(1, k * 6));
        }
      }
      if (bv.basket.visible) bv.basket.setScale((lv.type === 'hive' ? 0.8 : 0.95) * (1 + Math.sin(t * 3 + lv.ph) * 0.025));
      if (bv.bees) {
        for (let i = 0; i < BEES; i++) {
          const b = bv.bees[i]; const im = b.im;
          if (!beesOut) { im.setVisible(false); continue; }
          b.a += dt * b.sp;
          const x = lv.fx + Math.cos(b.a) * b.rx + Math.sin(b.a * 2.3 + b.ph) * 5;
          const y = lv.fy - 26 + Math.sin(b.a * 1.7 + b.ph) * b.ry + Math.sin(b.a * 0.5) * 6;
          im.setVisible(true).setPosition(x, y).setFlipX(Math.cos(b.a) * b.sp * -1 < 0).setScale(0.9, 0.75 + 0.35 * Math.abs(Math.sin(t * 38 + b.ph)));
        }
      }
    }
  }

  setQuality() { /* bina görselleri kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const lv of this.lots) { this._unbuild(lv); lv.patch?.destroy(); lv.hl?.destroy(); lv.sign?.destroy(); }
    this.lots.length = 0; this.fx?.destroy();
  }
}
