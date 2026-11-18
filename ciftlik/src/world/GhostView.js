// GhostView — yerleştirme hayaleti (PLAN §12). `build:ghost {type, tx, ty, valid, moving?} | null`:
// ilgili sprite'ın yarı saydam kopyası + ayak izi karoları (önceden renklendirilmiş yeşil/kırmızı doku; tint yok).
// Taşıma modunda (moving) asıl nesneyi kendi görünümü kaldırır/şeffaflaştırır. Çit/patika hayaleti komşulara göre bağlanır.
// Nesneler bir kez kurulur; olayda yalnızca doku/konum atanır (bellek ayırma yok).
import { DEPTH, TILE_W, TILE_H, depthForY } from '../core/constants.js';
import { PLACEABLES } from '../data/placeables.js';
import { BLD } from '../render/textures/buildings.js';
import { F8 } from '../render/textures/farm8.js';
import { MCH, SHED, SAILS } from '../render/textures/machines.js';
import { STALL_LAYOUT as SL } from '../render/textures/market.js';
import { genPlaced, FENCE, PATH, fenceFrame, pathFrame, ghostFpKey } from '../render/textures/placed.js';
import { footOf } from './placedUtil.js';
import FenceView from './FenceView.js';

const MAXL = 3;

export default class GhostView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.on = false; this.type = null; this.valid = true; this.t = 0; this._offs = []; this._foot = { x: 0, y: 0 };
  }

  create() {
    const s = this.scene;
    genPlaced(s);
    this.fp = s.add.image(0, 0, ghostFpKey(true, 1, 1)).setOrigin(0, 0).setDepth(DEPTH.GROUND + 1.5).setVisible(false);
    this.c = s.add.container(0, 0).setDepth(DEPTH.WEATHER - 0.5).setVisible(false);
    this.imgs = [];
    for (let i = 0; i < MAXL; i++) { const im = s.add.image(0, 0, '__DEFAULT').setVisible(false); this.imgs.push(im); this.c.add(im); }
    this.tile = s.add.image(0, 0, FENCE.key, fenceFrame(0)).setVisible(false).setDepth(DEPTH.WEATHER - 0.5);
    this._offs.push(this.bus.on('build:ghost', (p) => this.set(p), this));
  }

  _layers(type) {
    // [key, originX px, originY px, dx, dy, w, h] — ayak noktasına göre
    const s = this.scene;
    if (F8[type]) { const L = F8[type]; return L.back ? [[L.back, L.ox, L.oy, 0, 0, L.w, L.h], [L.front, L.ox, L.oy, 0, 0, L.w, L.h]] : [[L.key, L.ox, L.oy, 0, 0, L.w, L.h]]; }
    if (BLD[type]) { const L = BLD[type]; return [[L.key, L.ox, L.oy, 0, 0, L.w, L.h]]; }
    if (MCH[type]) {
      const L = MCH[type]; const r = [[L.key, L.ox, L.oy, 0, 0, L.w, L.h]];
      if (L.hub) r.push([SAILS.key, SAILS.s / 2, SAILS.s / 2, L.hub[0], L.hub[1], SAILS.s, SAILS.s]);
      return r;
    }
    if (type === 'shed') return [[SHED.key, SHED.ox, SHED.oy, 0, 0, SHED.w, SHED.h]];
    if (type === 'stall') return [[SL.body.key, SL.body.ox, SL.body.oy, 0, 0, SL.body.w, SL.body.h], [SL.awning.key, SL.awning.ox, SL.awning.oy, SL.awning.dx, SL.awning.dy, SL.awning.w, SL.awning.h]];
    if (type === 'well' && s.textures.exists('prop_well')) {
      const t = s.textures.get('prop_well'), m = t.customData || {}, src = t.getSourceImage();
      return [['prop_well', m.footX ?? src.width / 2, m.footY ?? src.height, 0, 0, src.width, src.height]];
    }
    return null;
  }

  set(p) {
    const d = p && PLACEABLES[p.type];
    if (!d) { this.on = false; this.fp.setVisible(false); this.c.setVisible(false); this.tile.setVisible(false); return; }
    this.on = true; this.valid = !!p.valid;
    this.fp.setTexture(ghostFpKey(this.valid, d.w, d.h)).setPosition(p.tx * TILE_W, p.ty * TILE_H).setVisible(true);
    if (p.type === 'fence' || p.type === 'path') {
      this.c.setVisible(false);
      const fv = this.renderer.fences; const m = fv ? fv.maskAt(p.type, p.tx, p.ty) : 0;
      if (p.type === 'fence') {
        const y = p.ty * TILE_H + FENCE.offY;
        this.tile.setTexture(FENCE.key, fenceFrame(m)).setOrigin(FENCE.footX / FENCE.fw, FENCE.footY / FENCE.fh).setPosition(p.tx * TILE_W + TILE_W / 2, y).setDepth(depthForY(y) + 0.5);
      } else {
        this.tile.setTexture(PATH.key, pathFrame(FenceView.variantOf(p.tx, p.ty), m)).setOrigin(0, 0).setPosition(p.tx * TILE_W - PATH.pad, p.ty * TILE_H - PATH.pad).setDepth(DEPTH.GROUND + 1.6);
      }
      this.tile.setVisible(true); this.type = p.type; return;
    }
    this.tile.setVisible(false);
    const f = footOf(p.type, p.tx, p.ty, this._foot);
    if (p.type !== this.type) {
      this.type = p.type;
      const L = this._layers(p.type) || [];
      for (let i = 0; i < MAXL; i++) {
        const im = this.imgs[i], l = L[i];
        if (!l) { im.setVisible(false); continue; }
        im.setTexture(l[0]).setOrigin(l[1] / l[5], l[2] / l[6]).setPosition(l[3], l[4]).setVisible(true);
      }
    }
    this.c.setPosition(f.x, f.y).setVisible(true);
  }

  update(env) {
    if (!this.on) return;
    this.t = env.t;
    const pulse = 0.5 + 0.5 * Math.sin(env.t * 5);
    this.fp.setAlpha(0.75 + 0.25 * pulse);
    const a = (this.valid ? 0.55 : 0.4) + pulse * 0.08;
    this.c.setAlpha(a); this.tile.setAlpha(a + 0.1);
  }

  setQuality() {}

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    this.fp?.destroy(); this.c?.destroy(); this.tile?.destroy();
  }
}
