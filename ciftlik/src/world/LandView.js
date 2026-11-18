// LandView — satılık parseller (PLAN §15). state.land.parcels [{id, owned}] YALNIZCA okunur; olay: land:changed, save:loaded.
// Sahip olunmayan parsel: soluk/doygunluğu düşük örtü + çevresinde kazık+ip + ortada "SATILIK" tabelası (ikon: ev + altın; yazı/fiyat yok).
// Satın alınınca (land:changed) örtü ve tabela yumuşakça solar, kazıklar kalkar. Tabela tıklanınca `land:signClick {parcelId}` yayılır.
// Nesneler parsel başına bir kez kurulur; update'te yalnızca solma/sallanma (bellek ayırmaz).
import { DEPTH, TILE_W, TILE_H, WORLD_TILES_X, depthForY } from '../core/constants.js';
import { PARCELS } from '../data/land.js';
import { genFarm8 } from '../render/textures/farm8.js';

const ROPE_Y = 17;     // ip yüksekliği (kazık tepesine yakın)
const STEP_H = 128, STEP_V = 88;

export default class LandView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.groups = new Map(); this.fading = []; this.dirty = true; this.poll = 0; this._offs = [];
  }

  create() {
    genFarm8(this.scene);
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('land:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    this.sync(true);
  }

  _owned(id) {
    const p = this.state?.land?.parcels; if (!p) return id === 'P1';
    if (Array.isArray(p)) { for (let i = 0; i < p.length; i++) if (p[i] && p[i].id === id) return !!p[i].owned; return false; }
    return !!(p[id] && p[id].owned);
  }

  _build(id) {
    const s = this.scene, P = PARCELS[id];
    const x0 = P.tx * TILE_W, x1 = (P.tx + P.w) * TILE_W, y0 = P.ty * TILE_H, y1 = (P.ty + P.h) * TILE_H;
    const g = { id, a: 0, items: [], sign: null, veil: null, ph: id.charCodeAt(1) * 1.3, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    // soluk örtü (doygunluk düşürür): zeminin üstünde, ekin/nesnelerin altında
    g.veil = s.add.rectangle(x0, y0, x1 - x0, y1 - y0, 0xb9bcae, 0.24).setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.9);
    g.items.push(g.veil);
    const wEdge = (x) => x <= 0 || x >= WORLD_TILES_X * TILE_W; // dünya kenarında kazık yok
    const stake = (x, y) => { const im = s.add.image(x, y, 'f8_stake').setOrigin(7 / 14, 31 / 34).setDepth(depthForY(y)); g.items.push(im); };
    const ropeH = (xa, xb, y) => { const im = s.add.image(xa, y - ROPE_Y, 'f8_rope_h').setOrigin(0, 0).setScale((xb - xa) / 128, 1).setDepth(depthForY(y) + 0.01); g.items.push(im); };
    const ropeV = (x, ya, yb) => { const im = s.add.image(x - 6, ya - ROPE_Y + 3, 'f8_rope_v').setOrigin(0, 0).setScale(1, (yb - ya) / 88).setDepth(depthForY(yb) - 0.01); g.items.push(im); };
    // yatay kenarlar (üst/alt)
    for (const y of [y0, y1]) {
      const n = Math.max(1, Math.round((x1 - x0) / STEP_H));
      for (let i = 0; i <= n; i++) { const xa = x0 + (x1 - x0) * i / n; if (!(wEdge(xa) && (i === 0 || i === n) && false)) stake(xa, y); if (i < n) ropeH(xa, x0 + (x1 - x0) * (i + 1) / n, y); }
    }
    // dikey kenarlar (dünya kenarı hariç)
    for (const x of [x0, x1]) {
      if (wEdge(x)) continue;
      const n = Math.max(1, Math.round((y1 - y0) / STEP_V));
      for (let i = 1; i < n; i++) stake(x, y0 + (y1 - y0) * i / n);
      for (let i = 0; i < n; i++) ropeV(x, y0 + (y1 - y0) * i / n, y0 + (y1 - y0) * (i + 1) / n);
    }
    // tabela: P1'e bakan kenarın ortasında, parselin içine biraz girintili
    const left = P.tx >= 20 ? true : false;           // P1'in sağındaki parsel → sol kenar; solundakiler → sağ kenar
    const sx = left ? x0 + 40 : x1 - 40, sy = y0 + (y1 - y0) * 0.5 + 6;
    const sign = s.add.image(sx, sy, 'f8_sign').setOrigin(32 / 64, 80 / 84).setDepth(depthForY(sy) + 0.02);
    sign.setInteractive({ useHandCursor: true });
    sign.on('pointerdown', () => this.bus.emit('land:signClick', { parcelId: id }));
    g.sign = sign; g.items.push(sign);
    // sign gölgesi (yumuşak zemin teması)
    const sh = s.add.image(sx, sy - 1, 'fx_ao').setDisplaySize(36, 11).setAlpha(0.28).setDepth(DEPTH.SHADOW + 0.01); g.items.push(sh);
    return g;
  }

  sync(initial = false) {
    this.dirty = false;
    for (const id in PARCELS) {
      if (id === 'P1') continue;
      const owned = this._owned(id), g = this.groups.get(id);
      if (!owned && !g) { const ng = this._build(id); this.groups.set(id, ng); if (initial) ng.a = 1; this._apply(ng); }
      else if (!owned && g) { g.leaving = false; }
      else if (owned && g && !g.leaving) { g.leaving = true; this.fading.push(g); }
    }
  }

  _apply(g) {
    for (const it of g.items) {
      if (it === g.veil) it.setAlpha(0.24 * g.a); else it.setAlpha(g.a * (it.texture && it.texture.key === 'fx_ao' ? 0.28 : 1));
    }
  }

  update(env) {
    const dt = env.dt;
    this.poll += dt; if (this.dirty || this.poll > 1) { this.poll = 0; this.sync(); }
    for (const g of this.groups.values()) {
      if (g.a < 1 && !g.leaving) { g.a = Math.min(1, g.a + dt * 1.2); this._apply(g); }
      if (g.sign && g.a > 0) g.sign.setRotation(Math.sin(env.t * 1.3 + g.ph) * 0.015 * (0.4 + env.wind));
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const g = this.fading[i]; g.a -= dt * 0.7; // ~1.4 sn yumuşak geçiş
      if (g.a <= 0) { for (const it of g.items) it.destroy(); this.groups.delete(g.id); this.fading.splice(i, 1); }
      else this._apply(g);
    }
  }

  setQuality() {}

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const g of this.groups.values()) for (const it of g.items) it.destroy();
    this.groups.clear(); this.fading.length = 0;
  }
}
