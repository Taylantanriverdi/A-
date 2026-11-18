// Tüm prosedürel dokular — açılışta BİR KEZ üretilir, scene.textures'a anahtarla kaydedilir (idempotent).
import { genBasics, genSun, genMoons, genStars, genClouds, genFog } from './sky.js';
import { genTerrain, genPath } from './terrain.js';
import { PATHS, pathBox } from '../layout.js';
import { genProps } from './props.js';
import { genSoil } from './soil.js';
import { genCrops } from './crops.js';
import { genFieldFx } from './fieldfx.js';
import { genMarket } from './market.js';

const DONE_KEY = '__ciftlik_textures_v1';

/** @param {Phaser.Scene} scene @param {(p:number)=>void} [onProgress] */
export function generateTextures(scene, onProgress) {
  const tm = scene.textures;
  if (tm.exists(DONE_KEY)) { onProgress?.(1); return; }
  const canvasMode = scene.sys.game.renderer.type === 1; // Phaser.CANVAS
  const TOTAL = 15; let n = 0;
  const step = () => { n++; try { onProgress?.(Math.min(1, n / TOTAL)); } catch { /* yok say */ } };
  genBasics(scene, canvasMode); step();
  genSun(scene); genMoons(scene); genStars(scene); step();
  genClouds(scene); step();
  genFog(scene); step();
  genTerrain(scene, canvasMode, step);   // 5 adım
  genProps(scene, step);                 // 3 adım
  genSoil(scene); genFieldFx(scene); step();
  genCrops(scene); genMarket(scene); step();
  for (const p of PATHS) { const b = pathBox(p); genPath(scene, p.key, p.pts.map(([x, y]) => [x - b.x, y - b.y]), p.width, b.w, b.h); }
  { const c = document.createElement('canvas'); c.width = c.height = 1; tm.addCanvas(DONE_KEY, c); }
  onProgress?.(1);
}
