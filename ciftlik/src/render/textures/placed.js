// Serbest yerleşim dokuları (PLAN §12): otomatik bağlanan ahşap çit atlası, taş patika atlası, hayalet ayak izi karoları.
// Açılışta BİR KEZ üretilir (idempotent). Renkler pişirilmiştir (tint yok → Canvas'ta da doğru).
// Maske biti: N=1, E=2, S=4, W=8 (komşu çit/patika var).
import { makeCanvas, register, rgba, shade } from './canvas.js';
import { mulberry32 } from './noise.js';
import { PLACEABLES } from '../../data/placeables.js';
import { TILE_W as TW, TILE_H as TH } from '../../core/constants.js';

// ---- çit: kare başına bir kare (64 x 80); direk karo merkezinde, ayak (32,70)
export const FENCE = { key: 'fence_atlas', fw: 64, fh: 80, footX: 32, footY: 70, offY: TH / 2 + 4 }; // ayak, karo üstünden TH/2+4 aşağıda
export const fenceFrame = (mask) => `f${mask}`;
// ---- patika: kare başına (80 x 60), karo bölgesi (8,8)-(72,52); 3 varyant
export const PATH = { key: 'path_atlas', fw: 80, fh: 60, pad: 8, variants: 3 };
export const pathFrame = (variant, mask) => `p${variant}_${mask}`;

export const ghostFpKey = (ok, w, h) => `ghost_fp_${ok ? 'ok' : 'bad'}_${w}x${h}`;

function woodGrad(ctx, x0, x1, light = '#b78a60', dark = '#6e4c32') { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, light); g.addColorStop(1, dark); return g; }

function drawFencePiece(ctx, mask, ox) {
  const cx = ox + 32, fy = 70, postTop = 32;
  // temas gölgesi (pişirilmiş yumuşak elips)
  const soft = (x, y, rx, ry, a) => { ctx.fillStyle = rgba('#1a2410', a); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
  soft(cx, fy, 8, 3, 0.28);
  if (mask & 2) soft(cx + 16, fy, 17, 2.6, 0.2);
  if (mask & 8) soft(cx - 16, fy, 17, 2.6, 0.2);
  if (mask & 1) soft(cx, fy - 13, 3.4, 13, 0.16);
  if (mask & 4) soft(cx, fy + 9, 3.4, 9, 0.16);
  const rails = [27, 14]; // zeminden yükseklik
  // arka: kuzey rayları
  if (mask & 1) for (const h of rails) { ctx.fillStyle = woodGrad(ctx, cx - 2, cx + 2); ctx.fillRect(cx - 2, fy - h - 26, 4, 26); ctx.fillStyle = rgba('#d8b085', 0.55); ctx.fillRect(cx - 2, fy - h - 26, 1, 26); }
  // doğu/batı rayları
  for (const [bit, x0, x1] of [[2, cx, ox + 64], [8, ox, cx]]) {
    if (!(mask & bit)) continue;
    for (const h of rails) {
      const g = ctx.createLinearGradient(0, fy - h - 5, 0, fy - h); g.addColorStop(0, '#b78a60'); g.addColorStop(1, '#6e4c32');
      ctx.fillStyle = g; ctx.fillRect(x0, fy - h - 5, x1 - x0, 5);
      ctx.fillStyle = rgba('#e0bd92', 0.5); ctx.fillRect(x0, fy - h - 5, x1 - x0, 1);
    }
  }
  // direk
  ctx.fillStyle = woodGrad(ctx, cx - 4, cx + 4, '#a77a52', '#6b4a30'); ctx.fillRect(cx - 4, postTop, 8, fy - postTop);
  ctx.fillStyle = '#c49a6c'; ctx.fillRect(cx - 4, postTop - 1, 8, 2.5);
  ctx.fillStyle = rgba('#e8c79c', 0.35); ctx.fillRect(cx - 4, postTop, 1.5, fy - postTop);
  // ön: güney rayları
  if (mask & 4) for (const h of rails) { ctx.fillStyle = woodGrad(ctx, cx - 2, cx + 2); ctx.fillRect(cx - 2, fy - h, 4, 18); ctx.fillStyle = rgba('#d8b085', 0.55); ctx.fillRect(cx - 2, fy - h, 1, 18); }
}

export function genFenceAtlas(scene) {
  if (scene.textures.exists(FENCE.key)) return;
  const { canvas, ctx } = makeCanvas(FENCE.fw * 16, FENCE.fh);
  for (let m = 0; m < 16; m++) drawFencePiece(ctx, m, m * FENCE.fw);
  const tex = register(scene, FENCE.key, canvas, { footX: FENCE.footX, footY: FENCE.footY });
  for (let m = 0; m < 16; m++) tex.add(fenceFrame(m), 0, m * FENCE.fw, 0, FENCE.fw, FENCE.fh);
}

// ---- taş patika
const STONE_COLS = ['#a39a8c', '#b2a999', '#8f8779', '#bdb3a2', '#9a9183'];
function stone(ctx, x, y, rx, ry, rot, r) {
  // gömülü: koyu toprak halkası
  ctx.fillStyle = rgba('#2c2418', 0.32); ctx.beginPath(); ctx.ellipse(x, y + 1.2, rx + 2, ry + 1.8, rot, 0, Math.PI * 2); ctx.fill();
  const base = STONE_COLS[Math.floor(r() * STONE_COLS.length)];
  const g = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry); g.addColorStop(0, shade(base, 0.16)); g.addColorStop(1, shade(base, -0.2));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.18); ctx.beginPath(); ctx.ellipse(x - rx * 0.2, y - ry * 0.35, rx * 0.6, ry * 0.4, rot, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.12); ctx.beginPath(); ctx.ellipse(x + rx * 0.1, y + ry * 0.55, rx * 0.7, ry * 0.3, rot, 0, Math.PI * 2); ctx.fill();
}

function drawPathPiece(ctx, mask, variant, ox) {
  const pad = PATH.pad, cx = ox + pad + TW / 2, cy = pad + TH / 2;
  const hash = (a) => mulberry32(a * 2654435 + 17);
  // kenar taşları: yön başına sabit şekil → komşu karolar aynı taşı üst üste çizer (dikişsiz)
  const edge = [[1, 0, -TH / 2, 11, 6, 0.1, 101], [2, TW / 2, 0, 8, 7, 0.4, 202], [4, 0, TH / 2, 11, 6, -0.1, 303], [8, -TW / 2, 0, 8, 7, -0.4, 404]];
  for (const [bit, dx, dy, rx, ry, rot, seed] of edge) if (mask & bit) stone(ctx, cx + dx, cy + dy, rx, ry, rot, hash(seed));
  // ara taşlar (varyanta bağlı), bağlantı yönünde
  const r = hash(variant * 31 + mask * 7 + 5);
  const dirs = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
  for (const [bit, dx, dy] of dirs) if (mask & bit) {
    for (let k = 0; k < 2; k++) {
      const t = 0.22 + 0.26 * k + (r() - 0.5) * 0.08;
      stone(ctx, cx + dx * TW * t * (dx ? 1 : 0) + (dy ? (r() - 0.5) * 18 : 0), cy + dy * TH * t * (dy ? 1 : 0) + (dx ? (r() - 0.5) * 10 : 0), 8 + r() * 4, 5 + r() * 2.5, (r() - 0.5) * 0.7, r);
    }
  }
  // merkez taşlar
  const n = mask === 0 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 1.2, d = mask === 0 ? 11 : 4;
    stone(ctx, cx + Math.cos(a) * d * (mask === 0 ? 1.4 : 1) + (r() - 0.5) * 4, cy + Math.sin(a) * d * 0.7 + (r() - 0.5) * 3, 9 + r() * 4, 5.5 + r() * 2.5, (r() - 0.5) * 0.8, r);
  }
}

export function genPathAtlas(scene) {
  if (scene.textures.exists(PATH.key)) return;
  const { canvas, ctx } = makeCanvas(PATH.fw * 16, PATH.fh * PATH.variants);
  for (let v = 0; v < PATH.variants; v++) for (let m = 0; m < 16; m++) {
    ctx.save(); ctx.translate(0, v * PATH.fh); drawPathPiece(ctx, m, v, m * PATH.fw); ctx.restore();
  }
  const tex = register(scene, PATH.key, canvas);
  for (let v = 0; v < PATH.variants; v++) for (let m = 0; m < 16; m++) tex.add(pathFrame(v, m), 0, m * PATH.fw, v * PATH.fh, PATH.fw, PATH.fh);
}

// ---- hayalet ayak izi (yeşil / kırmızı, önceden renklendirilmiş)
function genFootprint(scene, ok, w, h) {
  const key = ghostFpKey(ok, w, h); if (scene.textures.exists(key)) return;
  const { canvas, ctx } = makeCanvas(w * TW, h * TH);
  const fill = ok ? 'rgba(130,236,150,0.30)' : 'rgba(255,96,84,0.34)';
  const line = ok ? 'rgba(190,255,200,0.85)' : 'rgba(255,170,160,0.9)';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x * TW + 2.5, py = y * TH + 2.5, pw = TW - 5, ph = TH - 5;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 8); else ctx.rect(px, py, pw, ph);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = line; ctx.stroke();
  }
  register(scene, key, canvas);
}

export function genPlaced(scene) {
  genFenceAtlas(scene); genPathAtlas(scene);
  const sizes = new Set(['1x1']);
  for (const k in PLACEABLES) sizes.add(`${PLACEABLES[k].w}x${PLACEABLES[k].h}`);
  for (const sz of sizes) { const [w, h] = sz.split('x').map(Number); genFootprint(scene, true, w, h); genFootprint(scene, false, w, h); }
}
