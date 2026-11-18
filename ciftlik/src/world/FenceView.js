// FenceView — otomatik bağlanan ahşap çit ve taş patika (PLAN §12). State'i YALNIZCA OKUR: state.placed (type 'fence' | 'path').
// Karo başına havuzlu bir Image (atlas karesi = komşu maskesi N1 E2 S4 W8); değişimde yalnızca etkilenen karolar yeniden hesaplanır.
// Çit y-sıralı (depthForY), patika zemine gömülü (GROUND). Olaylar: placed:changed, save:loaded. update'te bellek ayrılmaz.
import { DEPTH, TILE_W, TILE_H, depthForY } from '../core/constants.js';
import { genPlaced, FENCE, PATH, fenceFrame, pathFrame } from '../render/textures/placed.js';

const STRIDE = 4096;
const key = (tx, ty) => tx + ty * STRIDE;
const POP_T = 0.32;

export default class FenceView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.cells = new Map(); this.free = []; this.dirty = true; this.epoch = 0; this._offs = [];
    this.pops = []; this.dset = new Set(); this._initial = true;
  }

  create() {
    genPlaced(this.scene); // idempotent
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('placed:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; this._initial = true; });
    this.sync(true);
  }

  /** Komşu maskesi (aynı türden). Hayalet önizleme de kullanır. */
  maskAt(type, tx, ty) {
    const c = this.cells; let m = 0, n;
    n = c.get(key(tx, ty - 1)); if (n && n.type === type) m |= 1;
    n = c.get(key(tx + 1, ty)); if (n && n.type === type) m |= 2;
    n = c.get(key(tx, ty + 1)); if (n && n.type === type) m |= 4;
    n = c.get(key(tx - 1, ty)); if (n && n.type === type) m |= 8;
    return m;
  }
  static variantOf(tx, ty) { return (((tx * 73856093) ^ (ty * 19349663)) >>> 0) % PATH.variants; }

  _acquire(type) {
    let im = this.free.pop();
    if (!im) im = this.scene.add.image(0, 0, FENCE.key, fenceFrame(0));
    if (type === 'fence') im.setOrigin(FENCE.footX / FENCE.fw, FENCE.footY / FENCE.fh);
    else im.setOrigin(0, 0);
    im.setVisible(true).setScale(1).setAlpha(1);
    return im;
  }
  _release(c) { c.im.setVisible(false); this.free.push(c.im); c.im = null; }

  _apply(c) {
    const m = this.maskAt(c.type, c.tx, c.ty);
    if (m === c.mask && c.im.visible && c.placedOk) return;
    c.mask = m; c.placedOk = true;
    const im = c.im;
    if (c.type === 'fence') {
      const y = c.ty * TILE_H + FENCE.offY;
      im.setTexture(FENCE.key, fenceFrame(m)).setPosition(c.tx * TILE_W + TILE_W / 2, y).setDepth(depthForY(y));
    } else {
      im.setTexture(PATH.key, pathFrame(FenceView.variantOf(c.tx, c.ty), m)).setPosition(c.tx * TILE_W - PATH.pad, c.ty * TILE_H - PATH.pad).setDepth(DEPTH.GROUND + 0.3);
    }
  }

  _mark(tx, ty) { this.dset.add(key(tx, ty)); }

  sync(initial = false) {
    this.dirty = false;
    if (this._initial) { initial = true; this._initial = false; }
    const pl = this.state && this.state.placed; const arr = Array.isArray(pl) ? pl : [];
    this.epoch++;
    const ep = this.epoch; let added = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p || (p.type !== 'fence' && p.type !== 'path')) continue;
      const k = key(p.tx, p.ty); let c = this.cells.get(k);
      if (c && c.type !== p.type) { this._release(c); this.cells.delete(k); c = null; }
      if (!c) {
        c = { type: p.type, tx: p.tx, ty: p.ty, im: this._acquire(p.type), mask: -1, popT: -1, placedOk: false, ep, id: p.id };
        this.cells.set(k, c); added++;
        this._mark(p.tx, p.ty);
        c.isNew = true;
      }
      c.ep = ep;
    }
    // kaldırılanlar
    for (const [k, c] of this.cells) {
      if (c.ep === ep) continue;
      this._release(c); this.cells.delete(k); this._mark(c.tx, c.ty);
    }
    // etkilenen karolar + komşuları
    if (this.dset.size) {
      const ds = this.dset;
      for (const k of Array.from(ds)) { const tx = k % STRIDE, ty = (k - tx) / STRIDE; ds.add(key(tx, ty - 1)); ds.add(key(tx + 1, ty)); ds.add(key(tx, ty + 1)); ds.add(key(tx - 1, ty)); }
      const fx = this.renderer.buildings?.fx; let dust = 0;
      for (const k of ds) {
        const c = this.cells.get(k); if (!c) continue;
        this._apply(c);
        if (c.isNew) {
          c.isNew = false;
          if (!initial && added <= 12) { c.popT = 0; this.pops.push(c); c.im.setScale(c.type === 'fence' ? 1 : 1, c.type === 'fence' ? 0.01 : 1); if (c.type === 'path') c.im.setAlpha(0); if (fx && dust++ < 4) fx.dust(c.tx * TILE_W + TILE_W / 2, c.ty * TILE_H + TILE_H * 0.7, 14, 3); }
        }
      }
      ds.clear();
    }
  }

  update(env) {
    if (this.dirty) this.sync();
    const L = this.pops; if (!L.length) return;
    const dt = env.dt;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (!c.im) { L.splice(i, 1); continue; }
      c.popT += dt / POP_T; const k = Math.min(1, c.popT);
      const s = k >= 1 ? 1 : Math.max(0.01, 1 - Math.exp(-6 * k) * Math.cos(k * Math.PI * 2.4));
      if (c.type === 'fence') c.im.setScale(1, s);
      else c.im.setAlpha(Math.min(1, k * 3));
      if (k >= 1) { c.popT = -1; c.im.setScale(1).setAlpha(1); L.splice(i, 1); }
    }
  }

  setQuality() { /* kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const c of this.cells.values()) c.im?.destroy();
    for (const im of this.free) im.destroy();
    this.cells.clear(); this.free.length = 0; this.pops.length = 0;
  }
}
