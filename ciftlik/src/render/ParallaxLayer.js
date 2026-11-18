// Paralaks katmanları (PLAN §2): uzak/yakın dağlar 0.10, bulutlar 0.18, tepeler 0.30, orman 0.55, sis bandı 0.70.
// Ekran uzayında (aygıt pikseli) yerleşir; yatayda döşenir, taban ufuk çizgisine bağlıdır ve
// kamera aşağı baktıkça hafifçe zeminin arkasına "batar" (dikey paralaks). Taban altı dolu → boşluk yok.
import { DEPTH } from '../core/constants.js';
import { WORLD } from '../data/palette.js';
import { screenContainer } from './View.js';
import { hexToRgb, mixRgb, mulRgb, scaleRgb, rgbToInt, clamp } from './util.js';
import { mulberry32 } from './textures/noise.js';

const REF_Y = -700;      // kamera tavanı (dünya)
const SINK = 0.12;       // dikey paralaks gücü
const WHITE = [1, 1, 1];

/** Katman ölçeği: uzak katmanlar zoom'a daha az tepki verir. */
export function layerScale(v, s) { return v.dpr * Math.pow(v.uz, 0.35 + 0.65 * s); }
export function layerBase(v, s) { return v.hY + Math.max(0, v.midY - REF_Y) * v.zoom * (1 - s) * SINK; }

class Strip {
  constructor(scene, container, key, s, copies = 4) {
    this.scene = scene; this.c = container; this.key = key; this.s = s; this.imgs = [];
    const tex = scene.textures.get(key); const src = tex.getSourceImage();
    this.tw = src.width; this.th = src.height; this.baseY = tex.customData?.baseY ?? this.th;
    for (let i = 0; i < copies; i++) this._add();
    this.drift = 0;
  }
  _add() { const im = this.scene.add.image(0, 0, this.key).setOrigin(0, this.baseY / this.th); this.c.add(im); this.imgs.push(im); return im; }
  layout(v, yOff = 0) {
    const k = layerScale(v, this.s), base = layerBase(v, this.s) + yOff * k;
    const tw = this.tw * k;
    const leftU = v.midX * this.s + this.drift - (v.W / 2) / k;
    const i0 = Math.floor(leftU / this.tw);
    const need = Math.ceil(v.W / tw) + 1;
    while (this.imgs.length < need) this._add();
    for (let j = 0; j < this.imgs.length; j++) {
      const im = this.imgs[j];
      if (j >= need) { im.setVisible(false); continue; }
      im.setVisible(true);
      im.setPosition(v.W / 2 + ((i0 + j) * this.tw - v.midX * this.s - this.drift) * k, base);
      im.setScale(k);
    }
    return base;
  }
  tint(top, bottom, alpha = 1) {
    const a = rgbToInt(top), b = rgbToInt(bottom);
    for (const im of this.imgs) { im.setTint(a, a, b, b); im.setAlpha(alpha); }
  }
}

/** Tek tek nesnelerden oluşan döngüsel katman (bulutlar, ağaç tepeleri). */
class Scatter {
  constructor(scene, container, s, period) { this.scene = scene; this.c = container; this.s = s; this.P = period; this.items = []; }
  add(key, u, y, scale, extra) {
    const im = this.scene.add.image(0, 0, key); this.c.add(im);
    const it = { im, u, y, scale, ...extra }; this.items.push(it); return it;
  }
  /** her öğe için ekran konumu; drift: katman birimi kayma */
  layout(v, drift, cb) {
    const k = layerScale(v, this.s), base = layerBase(v, this.s);
    const leftU = v.midX * this.s - (v.W / 2) / k - 300;
    const P = this.P;
    for (const it of this.items) {
      let u = it.u + drift * (it.speed || 0);
      u = leftU + ((((u - leftU) % P) + P) % P);
      const x = v.W / 2 + (u - v.midX * this.s) * k;
      const on = x > -400 * k && x < v.W + 400 * k;
      it.im.setVisible(on);
      if (!on) continue;
      it.im.setPosition(x, base + it.y * k);
      it.im.setScale(it.scale * k);
      if (cb) cb(it, k);
    }
  }
}

const SEASON_HILL = { spring: '#76a85a', summer: '#6d9a4e', autumn: '#a39a55', winter: '#8b9b97' };
const SEASON_FOREST = { spring: '#33603c', summer: '#2c5434', autumn: '#6a4a26', winter: '#3c4c4a' };

export default class ParallaxLayer {
  constructor(scene) {
    this.scene = scene;
    this.cols = {
      far: hexToRgb(WORLD.mountainFar), near: hexToRgb(WORLD.mountainNear),
      hill: hexToRgb(WORLD.hill), forest: hexToRgb(WORLD.forest),
    };
    this.t1 = [0, 0, 0]; this.t2 = [0, 0, 0]; this.t3 = [0, 0, 0]; this.t4 = [0, 0, 0];
    this.hazeColor = [0.5, 0.5, 0.5];
    this.forestBottom = [0.3, 0.4, 0.3]; // HorizonLayer ufuk dibi şeridi için
    this.season = null; this.cloudDrift = 0; this.fogDrift = 0;
  }

  create() {
    const s = this.scene;
    this.cMtn = screenContainer(s, DEPTH.MOUNTAINS);
    this.cCloud = screenContainer(s, DEPTH.CLOUDS);
    this.cHill = screenContainer(s, DEPTH.HILLS);
    this.cForest = screenContainer(s, DEPTH.FOREST);
    this.cFog = screenContainer(s, DEPTH.FOG);
    this.far = new Strip(s, this.cMtn, 'env_mtn_far', 0.08);
    this.cMtnNear = screenContainer(s, DEPTH.MOUNTAINS + 0.6);
    this.near = new Strip(s, this.cMtnNear, 'env_mtn_near', 0.12);
    this.hills = new Strip(s, this.cHill, 'env_hills', 0.30);
    this.forest = new Strip(s, this.cForest, 'env_forest', 0.55);
    this.fog = new Strip(s, this.cFog, 'fx_fogband', 0.70, 5);
    for (const im of this.fog.imgs) im.setOrigin(0, 0.72);
    // bulutlar
    const r = mulberry32(1234);
    this.clouds = new Scatter(s, this.cCloud, 0.18, 4600);
    for (let i = 0; i < 13; i++) {
      const flat = r() < 0.3; const key = 'sky_cloud_' + (flat ? 4 + (i % 2) : i % 4);
      this.clouds.add(key, i * 4600 / 13 + r() * 200, -(flat ? 330 + r() * 170 : 150 + r() * 230), (flat ? 1.5 : 1.0) + r() * 0.9, { speed: 0.6 + r() * 0.8, a: 0.75 + r() * 0.25 });
    }
    // orman ön sırası: tek tek salınan ağaç tepeleri
    this.crowns = new Scatter(s, this.cForest, 0.55, 3200);
    for (let i = 0; i < 125; i++) {
      const it = this.crowns.add('env_ftree_' + Math.floor(r() * 4), i * 3200 / 125 + r() * 14, -(10 + r() * 22), 0.42 + r() * 0.4, { ph: r() * 6.28, v: 0.8 + r() * 0.25 });
      it.im.setOrigin(0.5, 0.97);
    }
    this.crowns.items.sort((a, b) => a.y - b.y);
    for (const it of this.crowns.items) this.cForest.bringToTop(it.im);
  }

  /** env: Renderer ortam örneği (renkler, rüzgâr, zaman) */
  update(env) {
    const day = env.day, amb = env.ambient, sky = day.skyBottom;
    const lit = (base, out) => { mulRgb(base, amb, out); return scaleRgb(out, 1.08, out); };
    // uzak dağ: güçlü atmosferik perspektif
    lit(this.cols.far, this.t1); mixRgb(this.t1, day.skyTop, 0.25, this.t1);
    mixRgb(this.t1, sky, 0.55, this.t2); mixRgb(this.t1, sky, 0.78, this.t3);
    this.far.tint(this.t2, this.t3);
    lit(this.cols.near, this.t1); mixRgb(this.t1, sky, 0.32, this.t2); mixRgb(this.t1, sky, 0.55, this.t3);
    this.near.tint(this.t2, this.t3);
    if (env.season !== this.season) {
      this.season = env.season;
      hexToRgb(SEASON_HILL[env.season] || WORLD.hill, this.cols.hill);
      hexToRgb(SEASON_FOREST[env.season] || WORLD.forest, this.cols.forest);
    }
    lit(this.cols.hill, this.t1); mixRgb(this.t1, sky, 0.22, this.t2); mixRgb(this.t1, sky, 0.38, this.t3);
    this.hills.tint(this.t2, this.t3);
    lit(this.cols.forest, this.t1); mixRgb(this.t1, sky, 0.16, this.t2); mixRgb(this.t1, sky, 0.38 + day.fog * 0.3, this.t3);
    this.forest.tint(this.t2, this.t3);
    this.forestBottom[0] = this.t3[0]; this.forestBottom[1] = this.t3[1]; this.forestBottom[2] = this.t3[2];
    const ft = rgbToInt(this.t2), fb = rgbToInt(this.t3);
    for (const it of this.crowns.items) it.im.setTint(ft, ft, fb, fb);
    // sis bandı rengi: ışık + gök karışımı
    mixRgb(sky, WHITE, 0.25, this.t4); mulRgb(this.t4, amb, this.t1); mixRgb(this.t1, sky, 0.45, this.t1);
    this.fog.tint(this.t1, this.t1, clamp(0.12 + day.fog * 0.95, 0, 0.85));
    // zemin ufuk puslanması rengi = orman tabanı ile sis karışımı
    mixRgb(this.t3, this.t1, clamp(0.25 + day.fog * 0.8, 0, 0.85), this.hazeColor);
    // bulut renkleri: üst ışık rengi, alt gök gölgesi
    mixRgb(WHITE, day.sun, 0.5, this.t1); scaleRgb(this.t1, 0.3 + 0.7 * day.light, this.t1); mixRgb(this.t1, sky, 0.12, this.t1);
    mixRgb(day.skyTop, sky, 0.6, this.t2); mixRgb(this.t1, this.t2, 0.32, this.t2);
    const ct = rgbToInt(this.t1), cb = rgbToInt(this.t2);
    const ca = 0.4 + 0.45 * day.light;
    for (const it of this.clouds.items) { it.im.setTint(ct, ct, cb, cb); it.baseA = ca * it.a; }
    // rüzgâr: bulut kayması ve sis bandı akışı
    const dt = env.dt;
    this.cloudDrift += dt * (4 + env.wind * 26);
    this.fogDrift += dt * (3 + env.wind * 10);
    this.fog.drift = this.fogDrift;
  }

  layout(v, env) {
    const vis = v.hY > -40 * v.dpr;
    for (const c of [this.cMtn, this.cMtnNear, this.cCloud, this.cHill, this.cForest, this.cFog]) { c.setVisible(vis); if (vis) v.fit(c); }
    if (!vis) return;
    this.far.layout(v, -10); this.near.layout(v, 0); this.hills.layout(v, 0);
    this.forest.layout(v, 0); this.fog.layout(v, 18);
    // güneşin önündeki bulut incelir (disk ve hale okunur kalsın, "bulutun içinden yanan güneş")
    const sky = env.skyLayer, sunOn = sky && sky.sunScreenVisible, R = 300 * v.dpr;
    this.clouds.layout(v, this.cloudDrift, (it) => {
      let a = it.baseA ?? 0.8;
      if (sunOn) { const dx = it.im.x - sky.sunX, dy = (it.im.y - sky.sunY) * 1.6; a *= clamp(Math.sqrt(dx * dx + dy * dy) / R, 0.25, 1); }
      it.im.setAlpha(a);
    });
    const t = env.t, w = env.wind;
    const amp = 0.012 + w * 0.06, f = 1.1 + w * 1.6;
    this.crowns.layout(v, 0, (it) => { it.im.rotation = Math.sin(t * f + it.ph + it.u * 0.004) * amp + Math.sin(t * 0.37 + it.ph) * amp * 0.4; });
  }

  destroy() { for (const c of [this.cMtn, this.cMtnNear, this.cCloud, this.cHill, this.cForest, this.cFog]) c?.destroy(); }
}
