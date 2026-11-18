// Faz 1 dekor ve gölge demosu: çiftlik evi (gece pencereleri yanar), ağaçlar (rüzgârda salınan tepe),
// çalılar, P1 çiti, kuyu, fener. Tümü y-sıralı (depthForY).
import { TILE_W, TILE_H } from '../core/constants.js';
import { TREE_VARIANTS } from './textures/props.js';
import { HOUSE, LAMP, TREES, BUSHES } from './layout.js';
import { firstPlacedOfType, footOf, SLIDE_TIME } from '../world/placedUtil.js';
import { depthForY } from './util.js';

export default class Decor {
  constructor(scene, shadows, lights, state, bus, renderer) {
    this.scene = scene; this.shadows = shadows; this.lights = lights; this.state = state; this.bus = bus; this.renderer = renderer;
    this.trees = []; this.bushes = []; this.objs = []; this.season = null; this._offs = []; this.removing = [];
    this.well = null; this.wellShadow = null; this.wellPlaced = null; this._foot = { x: 0, y: 0 }; this.liftId = null; this.dirty = false; this._init = true;
  }

  _img(x, y, key) {
    const tex = this.scene.textures.get(key); const m = tex.customData || {};
    const src = tex.getSourceImage();
    const im = this.scene.add.image(x, y, key).setOrigin((m.footX ?? src.width / 2) / src.width, (m.footY ?? src.height) / src.height).setDepth(depthForY(y));
    this.objs.push(im); return im;
  }

  create() {
    const s = this.scene;
    // ev
    const house = this._img(HOUSE.x, HOUSE.y, 'prop_house');
    this.shadows.register(house, { footX: HOUSE.x, footY: HOUSE.y - 4, height: 215, width: 230 });
    const glow = s.add.image(house.x, house.y, 'prop_house_glow').setOrigin(house.originX, house.originY);
    this.lights.addEmissive(glow, 0.95); this.objs.push(glow);
    this.lights.addPoint({ x: HOUSE.x - 70, y: HOUSE.y - 60, radius: 140, color: 0xff9e48, intensity: 0.38, nightOnly: true });
    this.lights.addPoint({ x: HOUSE.x + 60, y: HOUSE.y - 60, radius: 140, color: 0xff9e48, intensity: 0.38, nightOnly: true });
    this.lights.addPoint({ x: HOUSE.x, y: HOUSE.y + 30, radius: 200, color: 0xff9a40, intensity: 0.34, nightOnly: true });
    // fener
    const lamp = this._img(LAMP.x, LAMP.y, 'prop_lamp');
    this.shadows.register(lamp, { footX: LAMP.x, footY: LAMP.y, height: 104, width: 18 });
    this.lights.addPoint({ x: LAMP.x, y: LAMP.y - 92, radius: 46, color: 0xffe0a0, intensity: 0.95, nightOnly: true, flicker: 0.08 });
    this.lights.addPoint({ x: LAMP.x, y: LAMP.y - 30, radius: 170, color: 0xffb060, intensity: 0.5, nightOnly: true, flicker: 0.06 });
    // kuyu: state.placed'ten (sync)
    this.well = this._img(0, 0, 'prop_well').setVisible(false);
    this.well.sl = { t: -1, sx: 0, sy: 0, tx: 0, ty: 0, lift: 0 };
    this.wellShadow = this.shadows.register(this.well, { footX: 0, footY: 0, height: 118, width: 90 });
    // ağaçlar: Container(gövde + salınan tepe)
    TREES.forEach(([x, y, k, sc], i) => {
      const v = TREE_VARIANTS[k];
      const c = s.add.container(x, y).setDepth(depthForY(y));
      const trunkKey = `prop_tree${k}_trunk`; const tsrc = s.textures.get(trunkKey).getSourceImage();
      const trunk = s.add.image(0, 0, trunkKey).setOrigin(0.5, (tsrc.height - 4) / tsrc.height);
      const canopy = s.add.image(0, -v.trunkH + 8, `prop_tree${k}_canopy_spring`).setOrigin(0.5, (v.ch + 2) / (v.ch + 8));
      c.add([trunk, canopy]); c.setScale(sc);
      const h = (v.trunkH + v.ch) * sc;
      this.shadows.register(c, { footX: x, footY: y, height: h, width: v.cw * sc * 0.55, shadowKey: `prop_tree${k}`, sway: canopy });
      c.scaleX = sc;
      this.trees.push({ c, sc0: sc, canopy, k, ph: i * 1.7 + x * 0.001, amp: k === 1 ? 1.4 : 1 });
    });
    BUSHES.forEach(([x, y, k]) => {
      const im = this._img(x, y, `prop_bush${k}_spring`);
      this.shadows.register(im, { footX: x, footY: y, height: 50, width: 80, shadowKey: `prop_bush${k}` });
      this.bushes.push({ im, c: im, sc0: 1, k });
    });
    if (this.bus) {
      this._offs.push(this.bus.on('placed:changed', () => { this.dirty = true; }, this));
      this._offs.push(this.bus.on('decor:changed', () => { this.dirty = true; }, this));
      this._offs.push(this.bus.on('save:loaded', () => { this.dirty = true; this._init = true; }, this));
      this._offs.push(this.bus.on('build:ghost', (p) => { this.liftId = p && p.moving != null ? p.moving : null; }, this));
    }
    this.sync();
  }

  _setVis(o, vis, id, now) {
    if (o.hidden === !vis) return;
    o.hidden = !vis;
    if (vis) { o.c.setVisible(true).setAlpha(1).setScale(o.sc0 ?? 1); return; }
    if (now) { o.c.setVisible(false); return; }
    o.rm = 0; this.removing.push(o); // küçülerek kaybol
  }

  /** removedDecor + kuyu (state.placed). */
  sync() {
    this.dirty = false;
    const init = this._init; this._init = false;
    const rd = this.state && Array.isArray(this.state.removedDecor) ? this.state.removedDecor : [];
    for (let i = 0; i < this.trees.length; i++) { const o = this.trees[i]; this._setVis(o, !rd.includes('tree_' + i), i, init); }
    for (let i = 0; i < this.bushes.length; i++) { const o = this.bushes[i]; this._setVis(o, !rd.includes('bush_' + i), i, init); }
    const w = this.well; if (!w) return;
    const pl = this.state && this.state.placed;
    if (!Array.isArray(pl)) { w.setVisible(false); return; }
    const p = firstPlacedOfType(this.state, 'well');
    if (!p) { w.setVisible(false); this.wellPlaced = null; return; }
    const f = footOf('well', p.tx, p.ty, this._foot); this.wellPlaced = p.id;
    const sl = w.sl;
    if (!w.visible) { w.setVisible(true); sl.tx = f.x; sl.ty = f.y; this._wellPos(f.x, f.y); if (!init) { const fx = this.renderer?.buildings?.fx; if (fx) fx.dust(f.x, f.y, 40, 8); } }
    else if (f.x !== sl.tx || f.y !== sl.ty) { sl.sx = w.x; sl.sy = w.y + sl.lift * 6; sl.tx = f.x; sl.ty = f.y; sl.t = 0; }
  }

  _wellPos(x, y) {
    const w = this.well; w.setPosition(x, y - w.sl.lift * 6).setDepth(depthForY(y));
    this.wellShadow?.set({ footX: x, footY: y - 4 });
  }

  update(env) {
    if (this.dirty) this.sync();
    const dt = env.dt;
    for (let i = this.removing.length - 1; i >= 0; i--) {
      const o = this.removing[i];
      if (!o.hidden) { this.removing.splice(i, 1); continue; }
      o.rm += dt / 0.3;
      if (o.rm >= 1) { o.c.setVisible(false).setScale(o.sc0 ?? 1); this.removing.splice(i, 1); }
      else o.c.setScale((o.sc0 ?? 1) * (1 - o.rm * o.rm)).setAlpha(1 - o.rm);
    }
    const wl = this.well;
    if (wl && wl.visible) {
      const sl = wl.sl; let mv = false;
      if (sl.t >= 0) { sl.t += dt / SLIDE_TIME; const k = Math.min(1, sl.t), e = k * k * (3 - 2 * k); wl.x = sl.sx + (sl.tx - sl.sx) * e; wl.y = sl.sy + (sl.ty - sl.sy) * e; if (k >= 1) sl.t = -1; mv = true; }
      const lt = this.liftId != null && this.liftId === this.wellPlaced ? 1 : 0;
      if (lt !== sl.lift) { sl.lift += (lt - sl.lift) * Math.min(1, dt * 12); if (Math.abs(lt - sl.lift) < 0.01) sl.lift = lt; mv = true; wl.setAlpha(1 - 0.45 * sl.lift); }
      if (mv) this._wellPos(sl.t >= 0 ? wl.x : sl.tx, sl.t >= 0 ? wl.y : sl.ty);
    }
    if (env.season !== this.season) {
      this.season = env.season;
      for (const t of this.trees) t.canopy.setTexture(`prop_tree${t.k}_canopy_${env.season}`);
      for (const b of this.bushes) b.im.setTexture(`prop_bush${b.k}_${env.season}`);
    }
    const w = env.wind, t = env.t;
    const amp = 0.008 + w * 0.045, f = 0.9 + w * 1.4;
    for (const tr of this.trees) {
      tr.canopy.rotation = (Math.sin(t * f + tr.ph) * 0.7 + Math.sin(t * f * 2.3 + tr.ph * 1.3) * 0.3) * amp * tr.amp + w * 0.02 * tr.amp;
    }
  }

  destroy() { for (const off of this._offs) off(); this._offs.length = 0; for (const o of this.objs) o.destroy(); for (const t of this.trees) t.c.destroy(); }
}
