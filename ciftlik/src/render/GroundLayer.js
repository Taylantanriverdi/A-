// Zemin (DEPTH.GROUND): büyük döşemeli çim dokusu (statik görüntüler, her karede çizim yok), makro ton
// varyasyonu, ufuk puslanması, P1 sürülmüş tarla, toprak yol, çiçek/taş/çim tutamları.
import { DEPTH, TILE_W, TILE_H, WORLD_W, WORLD_H } from '../core/constants.js';
import { genPath } from './textures/terrain.js';
import { mulberry32 } from './textures/noise.js';
import { rgbToInt } from './util.js';

const EXT = 1024; // dünya dışına taşma (zoom 0.5'te boşluk görünmesin)
const SEASON_TINT = { spring: 0xffffff, summer: 0xf4f0d6, autumn: 0xffdca0, winter: 0xd2d8d6 };

import { FIELD, HOUSE, PATHS, pathBox } from './layout.js';
const MAIN_PATH = PATHS[0].pts;

export default class GroundLayer {
  constructor(scene) { this.scene = scene; this.tiles = []; this.smalls = []; this.season = null; }

  create() {
    const s = this.scene;
    this.canvasMode = s.sys.game.renderer.type === 1;
    const T = 512;
    for (let y = 0; y < WORLD_H + EXT; y += T) for (let x = -EXT; x < WORLD_W + EXT; x += T) {
      this.tiles.push(s.add.image(x, y, 'env_grass').setOrigin(0, 0).setDepth(DEPTH.GROUND));
    }
    this.macro = s.add.image(-EXT, 0, 'env_macro').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.05)
      .setDisplaySize(WORLD_W + EXT * 2, WORLD_H + EXT);
    // yollar
    const mk = (p) => {
      const b = pathBox(p);
      genPath(s, p.key, p.pts.map(([x, y]) => [x - b.x, y - b.y]), p.width, b.w, b.h); // açılışta üretildiyse dokunmaz
      return s.add.image(b.x, b.y, p.key).setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.1);
    };
    this.path = mk(PATHS[0]);
    this.path2 = mk(PATHS[1]);
    // tarla
    const fm = s.textures.get('env_field').customData?.margin ?? 10;
    this.field = s.add.image(FIELD.tx * TILE_W - fm, FIELD.ty * TILE_H - fm, 'env_field').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.12);
    // küçük süsler
    const r = mulberry32(777);
    const blocked = (x, y) => {
      if (x > FIELD.tx * TILE_W - 30 && x < (FIELD.tx + FIELD.w) * TILE_W + 30 && y > FIELD.ty * TILE_H - 20 && y < (FIELD.ty + FIELD.h) * TILE_H + 30) return true;
      if (x > HOUSE.x - 170 && x < HOUSE.x + 170 && y > HOUSE.y - 60 && y < HOUSE.y + 40) return true;
      for (const [px, py] of MAIN_PATH) if (Math.abs(x - px) < 60 && Math.abs(y - py) < 60) return true;
      return false;
    };
    const persp = (y) => Math.min(1, Math.max(0, (y - 20) / 380)); // 0 ufuk .. 1 yakın
    const place = (keyFn, n, depth, yMin = 30) => {
      for (let i = 0; i < n; i++) {
        let x, y, tries = 0;
        do { x = r() * WORLD_W; y = yMin + r() * (WORLD_H + 200 - yMin); tries++; } while (blocked(x, y) && tries < 10);
        if (blocked(x, y)) continue;
        const far = persp(y); if (r() > 0.25 + 0.75 * far) continue; // ufka doğru seyrek
        const im = s.add.image(x, y, keyFn(r)).setOrigin(0.5, 1).setDepth(depth);
        const sc = 0.8 + r() * 0.5; im.setScale(sc * (0.4 + 0.6 * far)); // ufka doğru küçük
        this.smalls.push(im);
      }
    };
    place((rr) => 'env_tuft_' + Math.floor(rr() * 3), 260, DEPTH.GROUND + 0.2);
    place((rr) => 'env_stone_' + Math.floor(rr() * 3), 70, DEPTH.GROUND + 0.2);
    // çiçek öbekleri
    for (let c = 0; c < 46; c++) {
      const cx = r() * WORLD_W, cy = 60 + r() * (WORLD_H + 100); const col = Math.floor(r() * 5);
      for (let i = 0; i < 6 + r() * 8; i++) {
        const x = cx + (r() - 0.5) * 120, y = cy + (r() - 0.5) * 60; if (blocked(x, y)) continue;
        const far = persp(y); if (r() > 0.2 + 0.8 * far) continue;
        this.smalls.push(s.add.image(x, y, 'env_flower_' + (r() < 0.8 ? col : Math.floor(r() * 5))).setOrigin(0.5, 1).setDepth(DEPTH.GROUND + 0.25).setScale((0.8 + r() * 0.4) * (0.35 + 0.65 * far)));
      }
    }
  }

  update(env) {
    if (env.season !== this.season) {
      this.season = env.season;
      const t = SEASON_TINT[env.season] ?? 0xffffff;
      for (const im of this.tiles) im.setTint(t);
      this.macro.setTint(t);
      for (const im of this.smalls) if (im.texture.key.startsWith('env_tuft')) im.setTint(t);
      const showFlowers = env.season !== 'winter';
      for (const im of this.smalls) if (im.texture.key.startsWith('env_flower')) im.setVisible(showFlowers && !(env.season === 'autumn' && Math.random() < 0.5));
    }
  }

  destroy() { for (const im of [...this.tiles, ...this.smalls, this.macro, this.path, this.path2, this.field]) im?.destroy(); }
}

