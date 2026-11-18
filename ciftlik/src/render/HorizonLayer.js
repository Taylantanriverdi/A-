// Ufuk geçişi (sanat yönetmeni düzeltmesi): uzak tarla şeritleri (derinlik ipucu), ufuk dibinde düzensiz
// çalı/gövde şeridi ve ufkun iki yanına yayılan atmosferik pus bandı. Pus/treeline ambient çarpma katmanının
// ÜSTÜNDE (LIGHT+0.5..) son renkleriyle çizilir; böylece gök tarafı (çarpılmayan) ile zemin tarafı tek renkte birleşir.
import { DEPTH, WORLD_W } from '../core/constants.js';
import { mixRgb, mulRgb, scaleRgb, hexToRgb, rgbToInt, clamp } from './util.js';
import { SEASON_FOREST, SEASON_HILL } from './ParallaxLayer.js';

const EXT = 1024;
const HAZE_UP = 90;     // ufkun üstüne (orman tabanı) taşan pus yüksekliği (dünya px)
const HAZE_DOWN = 240;  // zeminde ufka doğru solma bandı
const SEASON_TINT = { spring: 0xffffff, summer: 0xf4f0d6, autumn: 0xffdca0, winter: 0xd2d8d6 };

export default class HorizonLayer {
  constructor(scene) { this.scene = scene; this.fields = []; this.trees = []; this.fog = [0, 0, 0]; this.tl = [0, 0, 0]; this.gF = [0, 0, 0]; this.gH = [0, 0, 0]; this.season = null; }

  create() {
    const s = this.scene;
    this.canvasMode = s.sys.game.renderer.type === 1;
    const fw = s.textures.get('env_farfields').getSourceImage().width;
    for (let x = -EXT; x < WORLD_W + EXT; x += fw) {
      this.fields.push(s.add.image(x, 0, 'env_farfields').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.15).setAlpha(0.85));
    }
    const tex = s.textures.get('env_treeline'); const src = tex.getSourceImage();
    const gy = tex.customData?.groundY ?? src.height;
    for (let x = -EXT; x < WORLD_W + EXT; x += src.width) {
      this.trees.push(s.add.image(x, 6, 'env_treeline').setOrigin(0, gy / src.height).setDepth(DEPTH.LIGHT + 0.55));
    }
    const W = WORLD_W + EXT * 2;
    this.hazeUp = s.add.image(-EXT, -HAZE_UP, 'fx_ramp_up').setOrigin(0, 0).setDisplaySize(W, HAZE_UP).setDepth(DEPTH.LIGHT + 0.5);
    this.hazeDown = s.add.image(-EXT, 0, 'fx_ramp_down').setOrigin(0, 0).setDisplaySize(W, HAZE_DOWN).setDepth(DEPTH.LIGHT + 0.5);
  }

  /** forestBottom: paralaks orman tabanı rengi (son renk, ambient dahil) */
  update(env, forestBottom) {
    const day = env.day;
    if (env.season !== this.season) {
      this.season = env.season; const st = SEASON_TINT[env.season] ?? 0xffffff;
      hexToRgb(SEASON_FOREST[env.season] || SEASON_FOREST.spring, this.gF); hexToRgb(SEASON_HILL[env.season] || SEASON_HILL.spring, this.gH);
      for (const im of this.fields) im.setTint(st);
    }
    // pus rengi = o saatin ufuk göğü + ambient karışımı
    mixRgb(day.skyBottom, env.ambient, 0.45, this.fog);
    const f = rgbToInt(this.fog);
    const a = this.canvasMode ? 0.25 : clamp(0.62 + day.fog * 0.3 + env.cloud * 0.1, 0, 0.9);
    this.hazeUp.setTint(f).setAlpha(a);
    this.hazeDown.setTint(f).setAlpha(a);
    // ağaç şeridi: mevsim yeşili (orman + tepe karışımı) ambient ile aydınlatılır, sonra açık-mavimsi
    // atmosfer rengine karışır (atmosferik perspektif açıklaştırır, griye/koyuya çekmez). Doku açık gri, tepeden ışıklı.
    mixRgb(this.gF, this.gH, 0.38, this.tl); mulRgb(this.tl, env.ambient, this.tl); scaleRgb(this.tl, 1.2, this.tl);
    mixRgb(this.tl, this.fog, clamp(0.3 + day.fog * 0.25, 0, 0.6), this.tl);
    const t = rgbToInt(this.tl);
    for (const im of this.trees) im.setTint(t);
  }

  destroy() { for (const im of [...this.fields, ...this.trees, this.hazeUp, this.hazeDown]) im?.destroy(); }
}
