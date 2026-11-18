// Atmosfer parçacıkları (nesne havuzlu, kare başına bellek ayırma yok):
// sabah sis bantları (05:30–09:00), gündüz ışıkta parlayan toz/polen, ilkbahar/yaz geceleri ateş böcekleri,
// ön plan çimleri (DEPTH.FOREGROUND, paralaks 1.15, ekran alt kenarı), güneş huzmeleri.
import { DEPTH, WORLD_H } from '../core/constants.js';
import { screenContainer } from './View.js';
import { mulberry32 } from './textures/noise.js';
import { clamp, smoothstep, mixRgb, rgbToInt } from './util.js';

const MAX = { fog: 16, mote: 70, fly: 44, fg: 30, shaft: 5 };
const WHITE = [1, 1, 1];
const FLY_COL = 0xd8ff78;

export default class Particles {
  constructor(scene) { this.scene = scene; this.q = 1; this.tmp = [0, 0, 0]; this.fogAmt = 0; this.flyAmt = 0; this.moteAmt = 0; this.rayAmt = 0; }

  create() {
    const s = this.scene; const r = mulberry32(4242);
    this.fog = [];
    for (let i = 0; i < MAX.fog; i++) {
      const im = s.add.image(0, 0, 'fx_fogpuff').setDepth(DEPTH.WEATHER);
      this.fog.push({ im, x: r() * 6000, y: 10 + Math.pow(r(), 0.8) * (WORLD_H + 80), sx: 6 + r() * 5, sy: 1.8 + r() * 1.4, sp: 6 + r() * 10, a: 0.5 + r() * 0.5, ph: r() * 6 });
    }
    this.motes = [];
    for (let i = 0; i < MAX.mote; i++) {
      const im = s.add.image(0, 0, 'fx_mote').setBlendMode('ADD').setDepth(DEPTH.LIGHT + 2);
      this.motes.push({ im, u: r(), v: r(), sz: 0.25 + r() * 0.45, sp: 0.4 + r(), ph: r() * 6.28 });
    }
    this.flies = [];
    for (let i = 0; i < MAX.fly; i++) {
      const glow = s.add.image(0, 0, 'fx_spark').setBlendMode('ADD').setDepth(DEPTH.LIGHT + 2).setTint(FLY_COL);
      this.flies.push({ im: glow, u: r(), v: 0.35 + r() * 0.65, rx: 30 + r() * 70, ry: 14 + r() * 30, fa: 0.2 + r() * 0.35, fb: 0.25 + r() * 0.4, ph: r() * 6.28, bl: 0.6 + r() * 1.4, sz: 0.3 + r() * 0.25 });
    }
    // ön plan çimleri
    this.cFg = screenContainer(s, DEPTH.FOREGROUND);
    this.fg = [];
    for (let i = 0; i < MAX.fg; i++) {
      const im = s.add.image(0, 0, 'env_fg_' + (i % 4)).setOrigin(0.5, 0.97); this.cFg.add(im);
      this.fg.push({ im, u: i * (2600 / MAX.fg) + r() * 60, sc: 0.7 + r() * 0.6, ph: r() * 6.28, flip: r() < 0.5 });
      im.setFlipX(this.fg[i].flip);
    }
    // güneş huzmeleri
    this.cRay = screenContainer(s, DEPTH.LIGHT + 3);
    this.rays = [];
    for (let i = 0; i < MAX.shaft; i++) {
      const im = s.add.image(0, 0, 'fx_shaft').setOrigin(0.5, 0).setBlendMode('ADD'); this.cRay.add(im);
      this.rays.push({ im, ang: (i / (MAX.shaft - 1) - 0.5) * 0.9 + (r() - 0.5) * 0.12, w: 0.7 + r() * 0.8, ph: r() * 6 });
    }
    this.setQuality('high');
  }

  setQuality(level) {
    this.q = level === 'low' ? 0.4 : level === 'medium' ? 0.6 : 1;
    this.nFog = Math.round(MAX.fog * (level === 'low' ? 0.5 : level === 'medium' ? 0.75 : 1));
    this.nMote = Math.round(MAX.mote * this.q); this.nFly = Math.round(MAX.fly * this.q); this.nFg = Math.round(MAX.fg * (level === 'low' ? 0.6 : 1));
    this.nRay = level === 'low' ? 0 : MAX.shaft;
    const hide = (arr, n) => { for (let i = n; i < arr.length; i++) arr[i].im.setVisible(false); };
    hide(this.fog, this.nFog); hide(this.motes, this.nMote); hide(this.flies, this.nFly); hide(this.fg, this.nFg); hide(this.rays, this.nRay);
  }

  update(env) {
    const h = env.day.hour, day = env.day;
    // sabah sisi penceresi
    const morning = smoothstep(5.3, 6.1, h) * (1 - smoothstep(8.2, 9.2, h));
    this.fogAmt = day.fog * (0.18 + 0.82 * morning) * (1 + env.cloud * 0.3);
    // ateş böcekleri: 20:30–04:00, ilkbahar/yaz
    const nightW = h >= 12 ? smoothstep(20.5, 21.2, h) : 1 - smoothstep(3.3, 4.0, h);
    this.flyAmt = (env.season === 'spring' || env.season === 'summer') ? nightW * (1 - env.cloud * 0.7) : 0;
    // toz: güneş alçak/orta iken daha belirgin
    this.moteAmt = env.sun.intensity * (0.35 + 0.65 * (1 - smoothstep(25, 55, env.sun.elevationDeg))) * (1 - env.cloud);
    this.rayAmt = env.sun.intensity * (1 - smoothstep(18, 50, env.sun.elevationDeg)) * (1 - env.cloud) ;
    mixRgb(WHITE, day.skyBottom, 0.3, this.tmp);
    this.fogTint = rgbToInt(this.tmp);
    this.moteTint = rgbToInt(mixRgb(day.sun, WHITE, 0.3, this.tmp));
  }

  layout(v, env) {
    const t = env.t, wind = env.wind;
    // sis bantları (dünya)
    const spanL = v.left - 1600, span = (v.right - v.left) + 3200;
    for (let i = 0; i < this.nFog; i++) {
      const f = this.fog[i];
      const on = this.fogAmt > 0.01 && f.y > v.top - 200 && f.y < v.bottom + 200;
      f.im.setVisible(on); if (!on) continue;
      const x = spanL + ((((f.x + t * f.sp * (1 + wind * 2)) - spanL) % span) + span) % span;
      f.im.setPosition(x, f.y + Math.sin(t * 0.1 + f.ph) * 8).setScale(f.sx, f.sy).setTint(this.fogTint)
        .setAlpha(clamp(this.fogAmt * f.a * 0.55, 0, 0.6));
    }
    // toz zerreleri (görünür alanda dolanır)
    const vw = v.right - v.left, vh = v.bottom - v.top;
    const mTop = Math.max(v.top, -140), mh = Math.max(1, v.bottom - mTop); // toz gökyüzünde yıldız gibi görünmesin
    for (let i = 0; i < this.nMote; i++) {
      const m = this.motes[i];
      const on = this.moteAmt > 0.02 && v.bottom > -100; m.im.setVisible(on); if (!on) continue;
      const u = (m.u + t * 0.004 * m.sp * (0.4 + wind * 2.2) + Math.sin(t * 0.3 + m.ph) * 0.01) % 1;
      const vv = (m.v + Math.sin(t * 0.21 * m.sp + m.ph) * 0.03 - t * 0.0015 * m.sp + 10) % 1;
      const tw = 0.5 + 0.5 * Math.sin(t * 1.7 * m.sp + m.ph);
      m.im.setPosition(v.left + u * vw, mTop + vv * mh).setScale(m.sz / Math.max(0.5, v.uz)).setTint(this.moteTint)
        .setAlpha(this.moteAmt * (0.2 + 0.8 * tw * tw) * 0.5);
    }
    // ateş böcekleri (zemin üstünde, görünür alanda)
    for (let i = 0; i < this.nFly; i++) {
      const f = this.flies[i];
      const on = this.flyAmt > 0.01; f.im.setVisible(on); if (!on) continue;
      const bx = v.left + ((f.u + t * 0.003) % 1) * vw;
      const by = Math.max(20, v.top + f.v * vh);
      const x = bx + Math.sin(t * f.fa + f.ph) * f.rx + Math.sin(t * f.fa * 2.7 + f.ph * 3) * f.rx * 0.3;
      const y = by + Math.sin(t * f.fb + f.ph * 1.7) * f.ry;
      const b = Math.max(0, Math.sin(t * f.bl + f.ph)); const blink = b * b * b;
      f.im.setPosition(x, y).setScale(f.sz * (0.8 + blink * 0.5)).setAlpha(this.flyAmt * (0.15 + 0.85 * blink));
    }
    // ön plan çimleri
    v.fit(this.cFg);
    const k = v.dpr * (0.75 + 0.25 * v.uz), P = 2600;
    const leftU = v.midX * 1.15 * (k / v.dpr) - v.W / 2 / k - 200;
    const amp = 0.03 + wind * 0.09, fr = 1.2 + wind * 1.8;
    const fgA = clamp(v.bottom / 160, 0, 1); // ekran altı zemin değilse (gökyüzüne bakılıyorsa) çim gösterme
    this.cFg.setAlpha(fgA); this.cFg.setVisible(fgA > 0.01);
    for (let i = 0; i < this.nFg; i++) {
      const g = this.fg[i];
      const u = leftU + ((((g.u - leftU) % P) + P) % P);
      const x = v.W / 2 + (u - v.midX * 1.15 * (k / v.dpr)) * k;
      const on = x > -200 * k && x < v.W + 200 * k; g.im.setVisible(on); if (!on) continue;
      const edge = Math.abs(x / v.W - 0.5) * 2; // kenarlarda daha uzun
      const sc = g.sc * k * (0.35 + 0.75 * edge * edge);
      g.im.setPosition(x, v.H + 8 * v.dpr).setScale(g.flip ? -sc : sc, sc);
      g.im.rotation = Math.sin(t * fr + g.ph + u * 0.003) * amp + wind * 0.05;
    }
    // güneş huzmeleri (ekran)
    v.fit(this.cRay);
    const sky = env.skyLayer;
    const rOn = this.rayAmt > 0.01 && this.nRay > 0 && sky.sunScreenVisible;
    this.cRay.setVisible(rOn);
    if (rOn) {
      const base = Math.atan2(v.W / 2 - sky.sunX, v.H * 1.2) * -1;
      for (let i = 0; i < this.nRay; i++) {
        const r = this.rays[i];
        r.im.setPosition(sky.sunX, sky.sunY).setRotation(base + r.ang + Math.sin(t * 0.05 + r.ph) * 0.04)
          .setDisplaySize(v.W * 0.12 * r.w, v.H * 1.6).setTint(this.moteTint)
          .setAlpha(this.rayAmt * (0.06 + 0.04 * Math.sin(t * 0.13 + r.ph)));
      }
    }
  }

  destroy() {
    for (const a of [this.fog, this.motes, this.flies]) for (const p of a) p.im.destroy();
    this.cFg?.destroy(); this.cRay?.destroy();
  }
}
