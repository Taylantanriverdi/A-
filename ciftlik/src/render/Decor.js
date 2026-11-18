// Faz 1 dekor ve gölge demosu: çiftlik evi (gece pencereleri yanar), ağaçlar (rüzgârda salınan tepe),
// çalılar, P1 çiti, kuyu, fener. Tümü y-sıralı (depthForY).
import { TILE_W, TILE_H, P1 } from '../core/constants.js';
import { TREE_VARIANTS } from './textures/props.js';
import { HOUSE, WELL, LAMP, TREES, BUSHES } from './layout.js';
import { depthForY } from './util.js';

export default class Decor {
  constructor(scene, shadows, lights) { this.scene = scene; this.shadows = shadows; this.lights = lights; this.trees = []; this.bushes = []; this.objs = []; this.season = null; }

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
    // kuyu
    const well = this._img(WELL.x, WELL.y, 'prop_well');
    this.shadows.register(well, { footX: WELL.x, footY: WELL.y - 4, height: 118, width: 90 });
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
      this.trees.push({ c, canopy, k, ph: i * 1.7 + x * 0.001, amp: k === 1 ? 1.4 : 1 });
    });
    BUSHES.forEach(([x, y, k]) => {
      const im = this._img(x, y, `prop_bush${k}_spring`);
      this.shadows.register(im, { footX: x, footY: y, height: 50, width: 80, shadowKey: `prop_bush${k}` });
      this.bushes.push({ im, k });
    });
    // P1 çiti (kapı boşluğu yol üzerinde)
    const x0 = P1.x * TILE_W, y0 = P1.y * TILE_H, x1 = (P1.x + P1.w) * TILE_W, y1 = (P1.y + P1.h) * TILE_H;
    const fence = (x, y, key) => { const im = this._img(x, y, key); this.shadows.register(im, { footX: x, footY: y, height: 40, width: key === 'prop_fence_h' ? 64 : 12 }); };
    for (let x = x0; x < x1; x += TILE_W) {
      fence(x + 32, y0, 'prop_fence_h');
      if (x >= 2560 && x < 2624) continue; // kapı
      fence(x + 32, y1, 'prop_fence_h');
    }
    fence(x1 + 2, y0, 'prop_fence_post'); fence(x1 + 2, y1, 'prop_fence_post'); fence(2624 + 2, y1, 'prop_fence_post');
    for (let y = y0 + TILE_H; y <= y1; y += TILE_H) { fence(x0 + 2, y, 'prop_fence_v'); fence(x1 + 2, y, 'prop_fence_v'); }
  }

  update(env) {
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

  destroy() { for (const o of this.objs) o.destroy(); for (const t of this.trees) t.c.destroy(); }
}
