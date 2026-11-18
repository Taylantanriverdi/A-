// Dekor yerleşimi (dünya koordinatı). FIELD: başlangıç sürülmüş alanı (34,8 6×4) — yalnızca süs yerleşimini engeller; karolar FieldView çizer.
import { TILE_W, TILE_H } from '../core/constants.js';

export const FIELD = { tx: 34, ty: 8, w: 6, h: 4 };
export const HOUSE = { x: 43 * TILE_W, y: 11 * TILE_H };
export const PATHS = [
  { key: 'env_path_main', width: 28, pts: [[HOUSE.x, HOUSE.y + 6], [HOUSE.x - 8, 560], [HOUSE.x - 50, 640], [HOUSE.x - 120, 720], [2600, 800], [2592, 900], [2610, 1120]] },
  { key: 'env_path_side', width: 20, pts: [[HOUSE.x - 10, 520], [2660, 506], [2575, 470]] },
];
export function pathBox(p) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of p.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const m = p.width + 16;
  return { x: x0 - m, y: y0 - m, w: Math.ceil(x1 - x0 + 2 * m), h: Math.ceil(y1 - y0 + 2 * m) };
}
export const WELL = { x: 2470, y: 660 };
export const LAMP = { x: HOUSE.x + 92, y: HOUSE.y + 22 };
// [x, y(ayak), varyant, ölçek]
export const TREES = [
  [1985, 300, 0, 1.0], [3150, 330, 1, 1.0], [3010, 452, 2, 0.95], [2020, 832, 0, 1.1], [3160, 830, 2, 1.0], [2290, 720, 2, 0.85],
  [900, 420, 0, 1.05], [1420, 900, 1, 1.1], [4200, 380, 0, 1.0], [4700, 860, 2, 1.0], [620, 170, 1, 0.9], [3880, 990, 0, 1.15],
  [3520, 160, 1, 0.8], [1700, 140, 0, 0.8],
];
export const BUSHES = [[HOUSE.x - 150, HOUSE.y + 8, 0], [HOUSE.x + 152, HOUSE.y + 6, 1], [2110, 580, 1], [3330, 610, 0], [1560, 340, 1], [2480, 760, 0], [4400, 640, 1], [1100, 700, 0]];
// Pazar tezgâhı (Aşama 3): P1 dışında, patikanın kapıdan çıktığı yolun doğusunda. Ayak noktası dünya koordinatı;
// fiziksel olarak 42–44 × 18–19 karolarını kaplar (engine-dev bu karolara dokunuşu `ui:open {panel:'market'}`'e bağlar).
export const STALL = { x: 2784, y: 862, tiles: { x0: 42, x1: 44, y0: 18, y1: 19 } };
