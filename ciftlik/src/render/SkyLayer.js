// Gökyüzü: dikey gradyan (düşük çözünürlüklü canvas, yalnızca renk değişince yeniden boyanır),
// güneş (disk + hale, ufukta büyür/kızarır), ay (evreli), yıldızlar (titreşimli), ufuk parlaması.
import { DEPTH, WORLD_W } from '../core/constants.js';
import { SUN, MOON } from '../data/palette.js';
import { screenContainer } from './View.js';
import { clamp, smoothstep, mixRgb, rgbToInt, hexToRgb, copyRgb } from './util.js';

const SUN_HOT = hexToRgb('#fff6e0'), SUN_LOW = hexToRgb('#ff6a3a'), MOON_COL = hexToRgb('#cfdcff');
const tmpA = [0, 0, 0], tmpB = [0, 0, 0];

export default class SkyLayer {
  constructor(scene) {
    this.scene = scene;
    this.lastTop = [-1, -1, -1]; this.lastBot = [-1, -1, -1]; this.lastSun = [-1, -1, -1]; this.lastGlow = -1;
    this.sunX = 0; this.sunY = 0; this.sunScreenVisible = false;
  }

  create() {
    const s = this.scene;
    this.cSky = screenContainer(s, DEPTH.SKY);
    this.cCel = screenContainer(s, DEPTH.CELESTIAL);
    this.top = s.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0, 0);
    this.grad = s.add.image(0, 0, 'sky_grad').setOrigin(0, 0);
    this.cSky.add([this.top, this.grad]);
    this.gradTex = s.textures.get('sky_grad');
    // yıldızlar: 3×3 döşeme, iki katman çapraz titreşim
    this.stars = [];
    for (const key of ['sky_stars_a', 'sky_stars_b']) for (let i = 0; i < 9; i++) {
      const im = s.add.image(0, 0, key).setOrigin(0, 0).setBlendMode('ADD'); im.layerKey = key; this.stars.push(im);
    }
    this.horizonGlow = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD');
    this.horizonWide = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD');
    this.moonHalo = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD');
    this.moon = s.add.image(0, 0, 'sky_moon_4');
    this.sunHaloWide = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD');
    this.sunHalo = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD');
    this.sun = s.add.image(0, 0, 'sky_sun'); // normal karışım: parlak gökte de disk okunur
    this.cSun = screenContainer(s, DEPTH.MOUNTAINS + 0.3); // uzak (puslu) sıranın önünde, yakın sıranın arkasında
    this.cLeak = screenContainer(s, DEPTH.LIGHT + 3);
    this.sunLeak = s.add.image(0, 0, 'fx_glow').setBlendMode('ADD'); this.cLeak.add(this.sunLeak);
    this.cCel.add([...this.stars, this.horizonWide, this.horizonGlow, this.moonHalo, this.moon]);
    this.cSun.add([this.sunHaloWide, this.sunHalo, this.sun]);
  }

  _paintGradient(top, bot, sunCol, glow) {
    const ctx = this.gradTex.getSourceImage().getContext('2d', { willReadFrequently: true });
    const img = this.gradImg || (this.gradImg = ctx.createImageData(3, 250)); const d = img.data;
    for (let y = 0; y < 250; y++) {
      const a = y / 249; // 0 tepe .. 1 ufuk
      const t = Math.pow(a, 1.9);
      mixRgb(top, bot, t, tmpA);
      // ufka yakın ışık rengiyle sıcak bant
      const band = Math.pow(a, 7) * glow * 0.35;
      mixRgb(tmpA, sunCol, band, tmpA);
      for (let x = 0; x < 3; x++) { const i = (y * 3 + x) * 4; d[i] = tmpA[0] * 255; d[i + 1] = tmpA[1] * 255; d[i + 2] = tmpA[2] * 255; d[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
    this.gradTex.refresh();
  }

  static _diff(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }

  update(env) {
    const day = env.day;
    const glow = env.twilight;
    if (SkyLayer._diff(day.skyTop, this.lastTop) > 0.004 || SkyLayer._diff(day.skyBottom, this.lastBot) > 0.004 || SkyLayer._diff(day.sun, this.lastSun) > 0.01 || Math.abs(glow - this.lastGlow) > 0.01) {
      this._paintGradient(day.skyTop, day.skyBottom, day.sun, glow);
      copyRgb(day.skyTop, this.lastTop); copyRgb(day.skyBottom, this.lastBot); copyRgb(day.sun, this.lastSun); this.lastGlow = glow;
      this.top.setFillStyle(rgbToInt(day.skyTop));
    }
    // ay evresi (28 günlük döngü)
    const phase = ((env.cal.day + 3) % 28) / 28; // 1. gün: büyüyen hilal
    const pk = 'sky_moon_' + (Math.round(phase * 8) % 8);
    if (this.moon.texture.key !== pk) this.moon.setTexture(pk);
  }

  layout(v, env) {
    const W = v.W, H = v.H, d = v.dpr, hY = v.hY;
    const visible = hY > -40 * d;
    this.cSky.setVisible(visible); this.cCel.setVisible(visible); this.cSun.setVisible(visible);
    this._leak(v, env);
    if (!visible) { this.sunScreenVisible = false; return; }
    v.fit(this.cSky); v.fit(this.cCel); v.fit(this.cSun);
    const gradH = Math.max(H * 0.95, 500 * d);
    this.top.setSize(W, Math.max(1, hY - gradH + 4)); this.top.setPosition(0, 0);
    this.top.setVisible(hY - gradH > 0);
    this.grad.setPosition(0, hY - gradH); this.grad.setDisplaySize(W, gradH + 30 * d);

    const px = -(v.midX - WORLD_W / 2) * 0.02 * v.zoom; // gök cisimleri paralaksı 0.02
    const skyH = Math.max(hY, H * 0.55);
    // yıldızlar
    const starA = env.stars;
    const t = env.t;
    const tw = 1024 * d, th = 512 * d;
    const ox = ((px % tw) + tw) % tw - tw;
    for (let i = 0; i < this.stars.length; i++) {
      const im = this.stars[i]; const k = i % 9; const gx = k % 3, gy = (k / 3) | 0;
      const x = ox + gx * tw, y = gy * th - (i >= 9 ? th * 0.37 : 0);
      const on = starA > 0.01 && x < W && y < hY && y + th > 0;
      im.setVisible(on);
      if (!on) continue;
      im.setPosition(i >= 9 ? x + tw * 0.41 : x, y); im.setScale(d);
      const tw2 = i >= 9 ? 0.5 + 0.5 * Math.sin(t * 1.7) : 0.5 + 0.5 * Math.sin(t * 1.3 + 2);
      im.setAlpha(starA * (0.55 + 0.45 * tw2));
    }
    // güneş
    const sun = env.sun;
    const elevN = Math.sin(sun.elevationDeg * Math.PI / 180) / Math.sin(SUN.maxElevationDeg * Math.PI / 180);
    const sx = W / 2 + sun.dir * W * 0.3 + px;
    // Alçak güneş ufka yakın, görünür kalsın (altın saat / doğuş); yükseldikçe hızla tepeye çıkar.
    const en = Math.max(0, elevN);
    const sy = hY - (0.18 * clamp((sun.elevationDeg + 4) / 4, 0, 1) + 0.82 * Math.pow(en, 6)) * skyH;
    const low = 1 - smoothstep(2, 22, sun.elevationDeg);
    this.sunX = sx; this.sunY = sy; this.sunScreenVisible = sun.visible && sy > -60 * d;
    mixRgb(SUN_HOT, env.day.sun, 0.45, tmpA); mixRgb(tmpA, SUN_LOW, low * 0.8, tmpA);
    const sunOn = sun.elevationDeg > -4;
    this.sun.setVisible(sunOn); this.sunHalo.setVisible(sunOn); this.sunHaloWide.setVisible(sunOn);
    if (sunOn) {
      const size = (64 + 34 * low) * d;
      this.sun.setPosition(sx, sy).setDisplaySize(size, size).setTint(rgbToInt(tmpA)).setAlpha(clamp((sun.elevationDeg + 4) / 4, 0, 1));
      mixRgb(env.day.sun, tmpA, 0.4, tmpB);
      const hs = size * (5.5 + low * 2);
      this.sunHalo.setPosition(sx, sy).setDisplaySize(hs, hs).setTint(rgbToInt(tmpB)).setAlpha(0.32 + low * 0.4);
      const ws = size * 16;
      this.sunHaloWide.setPosition(sx, sy).setDisplaySize(ws, ws * 0.8).setTint(rgbToInt(env.day.sun)).setAlpha(0.05 + low * 0.3);
    }
    // ufuk parlaması (doğuş/batış tarafında)
    const g = env.twilight;
    this.horizonGlow.setVisible(g > 0.01); this.horizonWide.setVisible(g > 0.01);
    if (g > 0.01) {
      const gx = W / 2 + sun.dir * W * 0.3 + px;
      this.horizonGlow.setPosition(gx, hY).setDisplaySize(W * 1.1, H * 0.55).setTint(rgbToInt(env.day.sun)).setAlpha(g * 0.75);
      mixRgb(env.day.sun, env.day.skyBottom, 0.5, tmpB);
      this.horizonWide.setPosition(W / 2, hY + 10 * d).setDisplaySize(W * 2.6, H * 0.35).setTint(rgbToInt(tmpB)).setAlpha(g * 0.4);
    }
    // ay
    const moon = env.moon;
    const mOn = moon.elevationDeg > -3;
    this.moon.setVisible(mOn); this.moonHalo.setVisible(mOn);
    if (mOn) {
      const mN = Math.sin(moon.elevationDeg * Math.PI / 180) / Math.sin(MOON.maxElevationDeg * Math.PI / 180);
      const mx = W / 2 + moon.dir * W * 0.36 + px, my = hY - (0.1 + mN * 0.6) * skyH;
      const vis = clamp(1 - env.day.light * 1.1, 0.15, 1) * clamp((moon.elevationDeg + 3) / 4, 0, 1);
      const ms = 62 * d;
      this.moon.setPosition(mx, my).setDisplaySize(ms, ms).setAlpha(vis);
      const full = 1 - Math.abs(((env.cal.day + 3) % 28) / 28 - 0.5) * 2;
      this.moonHalo.setPosition(mx, my).setDisplaySize(ms * 7, ms * 7).setTint(rgbToInt(MOON_COL)).setAlpha(vis * (0.12 + 0.28 * full));
    }
  }

  /** Alçak güneşin sıcak ışık sızması: güneş kadrajda olmasa bile doğu/batı kenarından ekrana taşar. */
  _leak(v, env) {
    const sun = env.sun, W = v.W, H = v.H;
    const k = sun.intensity * (1 - smoothstep(14, 42, sun.elevationDeg)) * (1 - env.cloud * 0.8);
    this.cLeak.setVisible(k > 0.01);
    if (k <= 0.01) return;
    v.fit(this.cLeak);
    const sx = W / 2 + sun.dir * W * 0.3 - (v.midX - WORLD_W / 2) * 0.02 * v.zoom;
    const lx = clamp(this.sunScreenVisible ? this.sunX : sx + sun.dir * W * 0.25, -0.05 * W, 1.05 * W);
    const ly = clamp(this.sunScreenVisible ? this.sunY : v.hY - H * 0.2, -0.1 * H, H * 0.6);
    this.sunLeak.setPosition(lx, ly).setDisplaySize(W * 1.2, H * 1.0).setTint(rgbToInt(env.day.sun)).setAlpha(k * 0.3);
  }

  destroy() { this.cSky?.destroy(); this.cCel?.destroy(); this.cLeak?.destroy(); this.cSun?.destroy(); }
}
