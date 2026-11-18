// Güneşe bağlı yumuşak silüet gölgeleri (PLAN §2 gölge kuralı).
// Her kayıt: Container (ayak noktasında, scaleY = zemin kısaltması) içinde döndürülmüş + uzatılmış silüet.
// length = clamp(1/tan(elev), 0.3, 4); alpha = paletGölge × yoğunluk × (1 − bulut×0.6). Gece ay gölgesi zayıf.
import { DEPTH } from '../core/constants.js';
import { clamp } from './util.js';

const FORESHORTEN = 0.56; // zemin düzleminde derinlik ekseni basıklığı

export default class ShadowSystem {
  constructor(scene) {
    this.scene = scene; this.items = []; this.lo = false; this.ao = true;
    this.rot = 0; this.len = 1; this.alpha = 0; this.aoAlpha = 0.3;
  }

  /**
   * @param {Phaser.GameObjects.GameObject} obj
   * @param {{footX:number, footY:number, height?:number, width?:number, shadowKey?:string, sway?:{rotation:number}}} opts
   * @returns {{remove():void, set(p:object):void}}
   */
  register(obj, opts = {}) {
    const s = this.scene;
    const key = opts.shadowKey || obj?.texture?.key;
    let tex = null;
    if (key && s.textures.exists(key + '__sh')) tex = key + '__sh';
    const c = s.add.container(opts.footX ?? obj?.x ?? 0, opts.footY ?? obj?.y ?? 0).setDepth(DEPTH.SHADOW);
    const it = { obj, opts, c, img: null, ao: null, base: key, meta: null, removed: false };
    if (tex) {
      it.meta = s.textures.get(tex).customData;
      it.img = s.add.image(0, 0, tex).setFlipX(true);
      it.img.setOrigin(1 - it.meta.footX / it.meta.w, it.meta.footY / it.meta.h); // flipX → orijin yansıtılır
      c.add(it.img);
    }
    const w = opts.width ?? obj?.displayWidth ?? 40;
    it.ao = s.add.image(0, 0, 'fx_ao').setDisplaySize(w * 1.15, Math.max(10, w * 0.32));
    c.addAt(it.ao, 0);
    this.items.push(it);
    this._apply(it);
    const self = this;
    return {
      remove() { if (it.removed) return; it.removed = true; it.c.destroy(); const i = self.items.indexOf(it); if (i >= 0) self.items.splice(i, 1); },
      set(p) { Object.assign(it.opts, p); if (p.footX !== undefined || p.footY !== undefined) it.c.setPosition(it.opts.footX, it.opts.footY); if (p.width !== undefined) it.ao.setDisplaySize(p.width * 1.15, Math.max(10, p.width * 0.32)); },
    };
  }

  setQuality(level) {
    this.lo = level === 'low'; this.ao = level !== 'low';
    for (const it of this.items) {
      if (it.img && it.base) { const k = it.base + (this.lo ? '__shLo' : '__sh'); if (this.scene.textures.exists(k) && it.img.texture.key !== k) it.img.setTexture(k); }
      it.ao.setVisible(this.ao);
    }
  }

  /** env.sun / env.moon / env.day.shadowAlpha / env.cloud */
  update(env) {
    const sun = env.sun, moon = env.moon;
    let src = sun, k = sun.intensity;
    if (sun.elevationDeg <= 0.5 && moon.elevationDeg > 0) { src = moon; k = moon.intensity * 0.9; }
    else if (sun.elevationDeg <= 0.5) k = 0;
    const elev = Math.max(2, src.elevationDeg) * Math.PI / 180;
    this.len = clamp(1 / Math.tan(elev), 0.3, 4);
    // zemin yönü: güneşin tersine yatay, izleyiciye doğru (güneş ufkun gerisinde)
    const d = clamp(src.dir, -1, 1);
    const gx = -d * 0.95, gy = 0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - d * d));
    this.rot = Math.atan2(gx, -gy);
    this.alpha = clamp(env.day.shadowAlpha * k * (1 - env.cloud * 0.6) * 1.15, 0, 0.5);
    this.aoAlpha = 0.18 + 0.22 * env.day.light;
    for (let i = 0; i < this.items.length; i++) this._apply(this.items[i]);
  }

  _apply(it) {
    const o = it.obj;
    const vis = !o || (o.visible !== false && o.active !== false);
    it.c.setVisible(vis);
    if (!vis) return;
    it.c.scaleY = FORESHORTEN;
    it.ao.setAlpha(this.aoAlpha / FORESHORTEN * 0.5).setScale(it.ao.scaleX, it.ao.scaleY);
    if (!it.img) return;
    const m = it.meta;
    const h = it.opts.height ?? o?.displayHeight ?? m.silH / m.scale;
    const sx = (o?.scaleX ?? 1) / m.scale;
    const lengthPx = h * this.len;
    it.img.scaleY = lengthPx / m.silH;
    it.img.scaleX = sx;
    const sway = it.opts.sway ? it.opts.sway.rotation * 0.6 : 0;
    it.img.rotation = this.rot + sway;
    it.img.setAlpha(this.alpha);
    it.img.setVisible(this.alpha > 0.005);
  }

  destroy() { for (const it of this.items) it.c.destroy(); this.items.length = 0; }
}
