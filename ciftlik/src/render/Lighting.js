// Işık katmanı (DEPTH.LIGHT): ambient tint (MULTIPLY; ufukta yumuşak rampa ile başlar) + nokta ışıklar (ADD).
// Işık yayan nesneler (pencere, ateş böceği) çarpma katmanının ÜSTÜNDE (LIGHT+1..) çizilir ki gece sönmesinler.
import { DEPTH } from '../core/constants.js';
import { rgbToInt, hexToRgb, clamp } from './util.js';

export const RAMP_H = 170; // ufuk puslanma bandı yüksekliği (dünya px)

export default class Lighting {
  constructor(scene) { this.scene = scene; this.points = []; this.night = 0; this.t = 0; this.enabled = true; }

  create() {
    const s = this.scene;
    // Ambient yalnızca zemin düzlemini (y ≥ 0) çarpar; gök ve paralaks katmanları rengini tint ile kendisi hesaplar.
    this.canvasMode = s.sys.game.renderer.type === 1;
    this.amb = s.add.rectangle(0, 0, 10, 10, 0xffffff).setOrigin(0, 0).setDepth(DEPTH.LIGHT);
    // Canvas renderer şekillerde MULTIPLY uygulamıyor → orada yarı saydam koyu örtü ile yaklaşık karartma
    if (!this.canvasMode) this.amb.setBlendMode('MULTIPLY');
  }

  /**
   * @param {{x:number,y:number,radius?:number,color?:number|string,intensity?:number,nightOnly?:boolean, flicker?:number}} p
   * @returns {{remove():void, set(p:object):void}}
   */
  addPoint(p = {}) {
    const s = this.scene;
    const im = s.add.image(p.x || 0, p.y || 0, 'fx_light').setBlendMode('ADD').setDepth(DEPTH.LIGHT + 1);
    const it = { im, p: { radius: 120, color: 0xffc878, intensity: 1, nightOnly: true, flicker: 0.04, ...p }, ph: Math.random() * 10 };
    const apply = () => {
      const c = typeof it.p.color === 'string' ? rgbToInt(hexToRgb(it.p.color)) : it.p.color;
      im.setTint(c); im.setPosition(it.p.x, it.p.y); im.setDisplaySize(it.p.radius * 2, it.p.radius * 2 * 0.75);
    };
    apply();
    this.points.push(it);
    const self = this;
    return {
      remove() { const i = self.points.indexOf(it); if (i >= 0) { self.points.splice(i, 1); im.destroy(); } },
      set(q) { Object.assign(it.p, q); apply(); },
    };
  }

  /** Gece yanan emisif görüntü (ör. pencere ışığı dokusu) kaydı; alfa gece faktörüyle güncellenir. */
  addEmissive(img, intensity = 1) {
    img.setBlendMode('ADD').setDepth(DEPTH.LIGHT + 1);
    const it = { im: img, p: { emissive: true, intensity, nightOnly: true, flicker: 0.03 }, ph: Math.random() * 10 };
    this.points.push(it); return it;
  }

  update(env) {
    this.t = env.t;
    // gece faktörü: palet ışığı düştükçe lambalar yanar
    this.night = clamp((0.78 - env.day.light) / 0.4, 0, 1);
    const c = rgbToInt(env.ambient);
    if (this.canvasMode) {
      const a = env.ambient; const l = a[0] * 0.3 + a[1] * 0.5 + a[2] * 0.2;
      const k = 0.35; this.amb.setFillStyle(rgbToInt([a[0] * k, a[1] * k, a[2] * k]), clamp((1 - l) * 0.85, 0, 0.8));
    } else this.amb.setFillStyle(c);
    for (const it of this.points) {
      const p = it.p;
      const f = 1 + Math.sin(this.t * 7.3 + it.ph) * p.flicker + Math.sin(this.t * 13.1 + it.ph * 2) * p.flicker * 0.5;
      const a = clamp((p.nightOnly ? this.night : 1) * p.intensity * f, 0, 1);
      it.im.setAlpha(a); it.im.setVisible(a > 0.004);
    }
  }

  layout(v) {
    const x = v.left - 20, w = v.right - v.left + 40;
    const top = Math.max(0, v.top - 10);
    this.amb.setPosition(x, top); this.amb.setSize(w, Math.max(1, v.bottom - top + 20));
    this.amb.setVisible(v.bottom > 0);
  }

  destroy() { this.amb?.destroy(); for (const it of this.points) it.im.destroy(); this.points.length = 0; }
}
