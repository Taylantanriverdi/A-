// Ekin dokuları (PLAN §2, §8): 13 ürün × `shape` tipine göre 5 aşama + solgun (1–4) + ölü (1–4) + ürün ikonu
// + hastalıklı (1–4; tint'siz → Canvas renderer'da da sarı lekeli görünür).
// Tek atlas ('crop_atlas'), hücre 88×124, ayak (taban orta) = (44, 114). Animasyon filmi dili: kontur yok;
// gradyanla yumuşak hacim, sol-üstten kenar ışığı (rim), tabanda pişmiş temas gölgesi.
// Solgun/hastalıklı varyantlar sağlıklı hücreden türetilir; ölü varyant her aşamada ayrı, okunur bir silüet olarak çizilir.
import { makeCanvas, register, shade, mixHex, rgba } from './canvas.js';
import { mulberry32 } from './noise.js';
import { CROPS } from '../../data/crops.js';

export const CROP_ATLAS = 'crop_atlas';
export const CROP_CELL = { w: 88, h: 124, footX: 44, footY: 114 };
export const CROP_IDS = Object.keys(CROPS);
const COLS = 18;
export const CROP_SCALE = 1.18; // çizim ölçeği (SHAPE_META değerleri ölçeksizdir; FieldView çarpar) // 0–4 sağlıklı, 5–8 solgun 1–4, 9–12 ölü 1–4, 13 ikon, 14–17 hastalıklı 1–4
const RIM = '#fff0c4';

// FieldView için yaklaşık bitki yüksekliği/genişliği (gölge) ve esneklik (rüzgâr salınımı)
export const SHAPE_META = {
  leafy: { h: [3, 9, 15, 20, 24], w: [10, 16, 26, 34, 40], flex: 0.45 },
  bush: { h: [3, 10, 18, 28, 30], w: [10, 16, 28, 40, 44], flex: 0.5 },
  berry: { h: [3, 9, 14, 18, 20], w: [10, 16, 26, 34, 40], flex: 0.45 },
  grain: { h: [3, 10, 24, 44, 52], w: [8, 10, 20, 34, 40], flex: 1.25 },
  vine: { h: [3, 10, 32, 54, 64], w: [10, 14, 22, 30, 34], flex: 0.3 },
  tall: { h: [3, 14, 38, 66, 84], w: [10, 14, 24, 36, 40], flex: 0.75 },
  melon: { h: [3, 7, 11, 16, 22], w: [10, 18, 36, 52, 58], flex: 0.22 },
  root: { h: [3, 9, 16, 24, 28], w: [10, 14, 24, 32, 36], flex: 0.9 },
};

export const cropFrame = (id, stage, wither, dead, sick) => {
  const s = stage < 0 ? 0 : stage > 4 ? 4 : stage | 0;
  if (dead) return `${id}_d${s < 1 ? 1 : s}`;
  if (wither && s > 0) return `${id}_w${s}`;
  if (sick && s > 0) return `${id}_s${s}`;
  return `${id}_${s}`;
};

// ------------------------------------------------------------------ çizim ilkelleri
const pt = (x, y, ang, u, v) => [x + Math.sin(ang) * u + Math.cos(ang) * v, y - Math.cos(ang) * u + Math.sin(ang) * v];

function leafPath(ctx, x, y, ang, len, wid, bend) {
  const a = pt(x, y, ang, len * 0.28, wid + bend * 0.3), b = pt(x, y, ang, len * 0.78, wid * 0.72 + bend), t = pt(x, y, ang, len, bend * 1.6);
  const c = pt(x, y, ang, len * 0.78, -wid * 0.72 + bend), d = pt(x, y, ang, len * 0.28, -wid + bend * 0.3);
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.bezierCurveTo(a[0], a[1], b[0], b[1], t[0], t[1]);
  ctx.bezierCurveTo(c[0], c[1], d[0], d[1], x, y);
  ctx.closePath();
  return t;
}

/** Yaprak: önce kenar ışığı rengiyle, sonra gövde sağ-alta kaydırılarak → sol-üstte ince rim kalır. */
function leaf(ctx, x, y, ang, len, wid, col, bend = 0, rim = 0.7, rib = true) {
  if (len < 0.5) return;
  leafPath(ctx, x, y, ang, len, wid, bend);
  ctx.globalAlpha = rim; ctx.fillStyle = mixHex(col, RIM, 0.55); ctx.fill(); ctx.globalAlpha = 1;
  const t = leafPath(ctx, x + 0.7, y + 0.9, ang, len * 0.98, wid * 0.96, bend);
  const g = ctx.createLinearGradient(x, y, t[0], t[1]);
  g.addColorStop(0, shade(col, -0.3)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, 0.26));
  ctx.fillStyle = g; ctx.fill();
  if (rib && len > 9) {
    const m = pt(x, y, ang, len * 0.5, bend * 0.7);
    ctx.strokeStyle = rgba(mixHex(col, RIM, 0.5), 0.35); ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x + 0.7, y + 0.6); ctx.quadraticCurveTo(m[0] + 0.7, m[1] + 0.6, t[0] - (t[0] - x) * 0.12, t[1] - (t[1] - y) * 0.12); ctx.stroke();
  }
}

/** Yuvarlak hacim (meyve): rim + radyal gölgeleme + speküler nokta. */
function fruit(ctx, x, y, rx, ry, col, spec = 0.55, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = mixHex(col, RIM, 0.5); ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  const R = Math.max(rx, ry);
  const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.35, 0, 0.5, 0.6, R * 1.15);
  g.addColorStop(0, shade(col, 0.3)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.45));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(rx * 0.06, ry * 0.08, rx * 0.95, ry * 0.94, 0, 0, Math.PI * 2); ctx.fill();
  // alttan sıcak sekme ışığı
  ctx.fillStyle = rgba('#ffcf8a', 0.12); ctx.beginPath(); ctx.ellipse(rx * 0.1, ry * 0.62, rx * 0.6, ry * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  if (spec > 0) { ctx.fillStyle = `rgba(255,255,255,${spec})`; ctx.beginPath(); ctx.ellipse(-rx * 0.38, -ry * 0.42, Math.max(0.8, rx * 0.22), Math.max(0.6, ry * 0.14), -0.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function stem(ctx, x0, y0, x1, y1, w, col, bend = 0) {
  const mx = (x0 + x1) / 2 + bend, my = (y0 + y1) / 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  ctx.strokeStyle = rgba(mixHex(col, RIM, 0.45), 0.55); ctx.lineWidth = Math.max(0.6, w * 0.35);
  ctx.beginPath(); ctx.moveTo(x0 - w * 0.25, y0); ctx.quadraticCurveTo(mx - w * 0.25, my, x1 - w * 0.2, y1); ctx.stroke();
}

/** Taban: pişmiş temas gölgesi + küçük toprak tümseği. */
function mound(ctx, cx, fy, w, soil = true) {
  ctx.save(); ctx.translate(cx, fy + 1); ctx.scale(1, 0.32);
  const R = Math.min(w * 0.8, 32); // hücre kenarında kesilmesin
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(26,18,12,0.5)'); g.addColorStop(0.6, 'rgba(26,18,12,0.22)'); g.addColorStop(1, 'rgba(26,18,12,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  if (!soil) return;
  const mg = ctx.createLinearGradient(0, fy - w * 0.22, 0, fy + 2);
  mg.addColorStop(0, '#a77a50'); mg.addColorStop(0.5, '#7b5536'); mg.addColorStop(1, '#4f3522');
  ctx.fillStyle = mg; ctx.beginPath(); ctx.ellipse(cx, fy - 0.5, w * 0.42, w * 0.17 + 1, 0, Math.PI, 0); ctx.lineTo(cx + w * 0.42, fy + 0.8); ctx.ellipse(cx, fy + 0.8, w * 0.42, 1.6, 0, 0, Math.PI); ctx.fill();
}

function sprout(ctx, cx, fy, col, s = 1) {
  stem(ctx, cx, fy - 1, cx, fy - 3 * s, 1, col);
  leaf(ctx, cx, fy - 3 * s, -0.9, 3.2 * s, 1.6 * s, mixHex(col, '#c9ec8a', 0.35), -0.3, 0.7, false);
  leaf(ctx, cx, fy - 3 * s, 0.9, 3.2 * s, 1.6 * s, mixHex(col, '#c9ec8a', 0.35), 0.3, 0.7, false);
}

function flower(ctx, x, y, r, col, center = '#f2c84b', petals = 5) {
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    fruit(ctx, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.4, col, 0, a);
  }
  ctx.fillStyle = center; ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
}

function spread(n, i) { return n <= 1 ? 0 : i / (n - 1) - 0.5; }

// ------------------------------------------------------------------ şekiller
const K = [0, 0.38, 0.62, 0.86, 1];

function drawLeafy(ctx, cx, fy, s, c, id, r) {
  const spin = id === 'spinach';
  mound(ctx, cx, fy, [11, 13, 18, 24, 28][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.8); return; }
  const n = [0, 3, 6, 8, 10][s];
  const len = [0, 8, 13, 17, 20][s], wid = len * (spin ? 0.5 : 0.62);
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const t = spread(n, i);
    leaves.push({ ang: t * (spin ? 2.4 : 2.9) + (r() - 0.5) * 0.25, l: len * (0.8 + r() * 0.3), col: mixHex(c.color, c.accent, r() * (spin ? 0.25 : 0.45)) });
  }
  leaves.sort((a, b) => Math.abs(a.ang) - Math.abs(b.ang)); // dik (arka) önce, yana yatanlar sonra
  for (const L of leaves) leaf(ctx, cx + Math.sin(L.ang) * 1.5, fy - 2, L.ang, L.l * (1 - Math.abs(L.ang) * 0.12), wid, L.col, L.ang * (spin ? 1 : 2.2));
  if (!spin && s >= 3) {
    // marul başı: iç içe kıvrık yapraklar
    const R = s === 4 ? 10.5 : 7;
    fruit(ctx, cx, fy - R * 0.85, R, R * 0.86, mixHex(c.accent, c.color, 0.25), 0.25);
    for (let i = 0; i < 3; i++) leaf(ctx, cx + (i - 1) * R * 0.55, fy - 2, (i - 1) * 0.55, R * 1.55, R * 0.62, mixHex(c.accent, '#eaf7b0', 0.15 + i * 0.1), (i - 1) * 1.5, 0.8, false);
  }
  if (spin && s >= 2) for (let i = 0; i < [0, 0, 2, 3, 4][s]; i++) { const a = (i - 1.5) * 0.4; leaf(ctx, cx, fy - 1, a + Math.PI * (a < 0 ? -0.82 : 0.82), len * 0.5, wid * 0.8, shade(c.color, 0.08), 0, 0.7); }
  // ön (izleyiciye bakan) kısa yapraklar
  if (s >= 2) { leaf(ctx, cx - 3, fy - 1, -2.1, len * 0.45, wid * 0.85, shade(c.color, -0.05), -1.5); leaf(ctx, cx + 3, fy - 1, 2.1, len * 0.45, wid * 0.85, shade(c.color, -0.08), 1.5); }
}

function drawBush(ctx, cx, fy, s, c, id, r) {
  mound(ctx, cx, fy, [11, 14, 22, 32, 36][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.8); return; }
  const R = [0, 6, 11, 16, 18][s], n = [0, 5, 14, 24, 28][s];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI, rr = Math.sqrt(r());
    pts.push({ x: cx + Math.cos(a) * R * 1.05 * rr, y: fy - 3 - Math.sin(a) * R * 1.1 * rr - R * 0.15, depth: Math.sin(a) * rr });
  }
  pts.sort((a, b) => b.depth - a.depth); // arka (yukarı) önce
  const old = s === 4 ? '#b9b04a' : null;
  for (const p of pts) {
    const ang = (p.x - cx) / Math.max(1, R) * 1.1 + (r() - 0.5) * 0.9;
    let col = mixHex(c.color, shade(c.color, -0.25), p.depth * 0.5);
    if (old && r() < 0.35) col = mixHex(col, old, 0.45);
    leaf(ctx, p.x, p.y + 2, ang, (5 + r() * 3) * (0.7 + K[s] * 0.35), 2.6 + r() * 1.2, col, (r() - 0.5) * 2);
  }
  if (s >= 3) for (let i = 0; i < (s === 3 ? 5 : 3); i++) flower(ctx, cx + (r() - 0.5) * R * 1.3, fy - R * 1.05 - r() * R * 0.4, 2.4, i % 2 ? '#f4eefa' : '#d6c2ee', '#f2d24b');
  if (s === 4) { fruit(ctx, cx - 9, fy - 0.5, 5.2, 3.6, c.accent, 0.3, -0.2); fruit(ctx, cx + 7, fy + 0.5, 4.4, 3.1, shade(c.accent, -0.05), 0.3, 0.3); fruit(ctx, cx - 1, fy + 1.5, 3.6, 2.6, shade(c.accent, 0.08), 0.3); }
}

function trifoliate(ctx, x, y, ang, len, col, r) {
  const t = pt(x, y, ang, len * 0.55, 0);
  stem(ctx, x, y, t[0], t[1], 1, shade(col, 0.1));
  for (let k = -1; k <= 1; k++) leaf(ctx, t[0], t[1], ang + k * 0.75, len * 0.48, len * 0.24, mixHex(col, shade(col, 0.15), r()), k * 0.8, 0.7, len > 12);
}

function strawberry(ctx, x, y, s, col) {
  // kalp biçimli meyve + çanak + tohum noktaları
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = mixHex(col, RIM, 0.45);
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 1.3, -s * 1.1, s * 0.9, s * 0.6, 0, s * 1.15); ctx.bezierCurveTo(-s * 0.9, s * 0.6, -s * 1.3, -s * 1.1, 0, -s); ctx.fill();
  const g = ctx.createRadialGradient(-s * 0.35, -s * 0.4, 0, 0, 0, s * 1.4); g.addColorStop(0, shade(col, 0.3)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.45));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0.5, -s * 0.92); ctx.bezierCurveTo(s * 1.25, -s, s * 0.9, s * 0.62, 0.4, s * 1.12); ctx.bezierCurveTo(-s * 0.8, s * 0.6, -s * 1.15, -s, 0.5, -s * 0.92); ctx.fill();
  ctx.fillStyle = 'rgba(255,236,150,0.85)';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(((i % 3) - 1) * s * 0.45, -s * 0.2 + Math.floor(i / 3) * s * 0.55, Math.max(0.4, s * 0.09), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-s * 0.4, -s * 0.45, s * 0.2, s * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (let k = -1; k <= 1; k++) leaf(ctx, x, y - s * 0.95, k * 1.1, s * 0.8, s * 0.3, '#4f8f3e', 0, 0.6, false);
}

function drawBerry(ctx, cx, fy, s, c, id, r) {
  mound(ctx, cx, fy, [11, 14, 22, 30, 34][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.8); return; }
  const n = [0, 2, 4, 6, 7][s], len = [0, 9, 13, 16, 17][s];
  const order = [];
  for (let i = 0; i < n; i++) order.push(spread(n, i) * 2.6 + (r() - 0.5) * 0.25);
  order.sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const a of order) trifoliate(ctx, cx, fy - 1, a, len * (1 - Math.abs(a) * 0.12), c.color, r);
  if (s === 3) { flower(ctx, cx - 7, fy - 9, 2.6, '#fbfaf2'); flower(ctx, cx + 8, fy - 7, 2.4, '#fbfaf2'); strawberry(ctx, cx + 2, fy - 2, 2.2, '#a9c95a'); }
  if (s === 4) {
    flower(ctx, cx + 1, fy - 13, 2.3, '#fbfaf2');
    const B = [[-12, -2, 3.6], [-5, 1, 4], [5, 0, 3.8], [12, -3, 3.3], [0, -6, 3.2]];
    for (const [dx, dy, sz] of B) strawberry(ctx, cx + dx, fy + dy, sz, c.accent);
  }
}

function grainHead(ctx, x, y, ang, len, col, golden) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const u = len * (i / n) + 1.5;
    for (const side of [-1, 1]) {
      const p = pt(x, y, ang, u + (side > 0 ? 0.8 : 0), side * 1.3);
      fruit(ctx, p[0], p[1], 1.6, 2.4, i % 2 ? col : shade(col, -0.08), golden ? 0.3 : 0.15, ang + side * 0.35);
    }
  }
  if (golden) { // kılçıklar
    ctx.strokeStyle = rgba(shade(col, 0.25), 0.7); ctx.lineWidth = 0.5;
    for (let i = 1; i < n; i++) for (const side of [-1, 1]) {
      const p = pt(x, y, ang, len * (i / n) + 2, side * 1.5), q = pt(x, y, ang + side * 0.45, len * (i / n) + 9, side * 2.5);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
  }
}

function drawGrain(ctx, cx, fy, s, c, id, r) {
  mound(ctx, cx, fy, [9, 12, 20, 34, 40][s], s < 2);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.7); return; }
  const n = [0, 4, 7, 11, 13][s], H = [0, 10, 24, 42, 48][s], span = [0, 5, 14, 28, 32][s];
  const gold = s === 4;
  const stalkCol = gold ? mixHex(c.color, c.accent, 0.85) : s === 3 ? mixHex(c.color, c.accent, 0.25) : c.color;
  const items = [];
  for (let i = 0; i < n; i++) items.push({ x: cx + spread(n, i) * span + (r() - 0.5) * 3, h: H * (0.82 + r() * 0.3), back: r() });
  items.sort((a, b) => b.back - a.back);
  for (const it of items) {
    const ang = (it.x - cx) * 0.014 + (r() - 0.5) * 0.12;
    if (s <= 2) { leaf(ctx, it.x, fy - 1, ang, it.h, 1.6 + r() * 0.7, mixHex(c.color, '#c2dc78', r() * 0.3), ang * 6 + (r() - 0.5) * 3, 0.7, false); continue; }
    const top = pt(it.x, fy - 1, ang, it.h, 0);
    stem(ctx, it.x, fy - 1, top[0], top[1], 1.3, stalkCol, ang * 4);
    leaf(ctx, it.x, fy - 3, ang + (r() < 0.5 ? -0.5 : 0.5), it.h * 0.45, 1.5, gold ? mixHex(stalkCol, '#c8a548', 0.3) : c.color, (r() - 0.5) * 4, 0.6, false);
    const droop = gold ? 0.25 * Math.sign(ang || 0.1) : 0;
    grainHead(ctx, top[0], top[1] + 1, ang + droop, gold ? 10 : 8, gold ? c.accent : mixHex(c.color, c.accent, 0.35), gold);
  }
}

function pod(ctx, x, y, len, col, ang) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = mixHex(col, RIM, 0.45);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(2.6, len * 0.3, 2.2, len * 0.8, -0.5, len); ctx.bezierCurveTo(0.6, len * 0.7, -1.8, len * 0.3, 0, 0); ctx.fill();
  const g = ctx.createLinearGradient(-2, 0, 2.5, 0); g.addColorStop(0, shade(col, 0.15)); g.addColorStop(1, shade(col, -0.35));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0.4, 0.5); ctx.bezierCurveTo(3, len * 0.3, 2.6, len * 0.8, -0.3, len); ctx.bezierCurveTo(0.8, len * 0.7, -1.2, len * 0.3, 0.4, 0.5); ctx.fill();
  ctx.fillStyle = rgba('#e8ffb0', 0.35); for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(0.9, len * i / 4.2, 0.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function grapeCluster(ctx, x, y, sz, col) {
  stem(ctx, x, y - 2, x + 1, y + 1, 0.8, '#6a5a2a');
  const rows = [4, 3, 3, 2, 1];
  for (let ri = 0; ri < rows.length; ri++) for (let k = 0; k < rows[ri]; k++) {
    const bx = x + (k - (rows[ri] - 1) / 2) * sz * 1.55 + (ri % 2) * 0.4, by = y + 2 + ri * sz * 1.35;
    fruit(ctx, bx, by, sz, sz * 1.05, k % 2 ? col : shade(col, -0.1), 0.35);
  }
  // pus (bloom) — tozlu mat parlama
  ctx.fillStyle = 'rgba(210,200,255,0.12)'; ctx.beginPath(); ctx.ellipse(x - sz, y + 4 + sz, sz * 2.4, sz * 3, -0.3, 0, Math.PI * 2); ctx.fill();
}

function drawVine(ctx, cx, fy, s, c, id, r) {
  mound(ctx, cx, fy, [11, 14, 20, 26, 30][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.8); return; }
  if (s === 1) { stem(ctx, cx, fy - 1, cx, fy - 7, 1.2, c.color); leaf(ctx, cx, fy - 7, -0.9, 7, 3.6, c.color, -1); leaf(ctx, cx, fy - 7, 0.8, 7.5, 3.8, shade(c.color, 0.1), 1); return; }
  const H = [0, 0, 30, 52, 62][s];
  const sx = cx + 3;
  // destek çubuğu (ahşap)
  const wg = ctx.createLinearGradient(sx - 1.5, 0, sx + 1.5, 0); wg.addColorStop(0, '#caa271'); wg.addColorStop(1, '#7a5432');
  ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(sx - 1.5, fy - H - 2, 3, H + 3, 1.5); ctx.fill();
  if (id === 'grape') { ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(sx - 14, fy - H - 1, 28, 2.4, 1.2); ctx.fill(); }
  // sarılan gövde
  const pts = [];
  const nz = Math.round(H / 9);
  for (let i = 0; i <= nz; i++) pts.push([sx + (i % 2 ? 4.5 : -4) * (i ? 1 : 0.3), fy - 1 - (H * 0.95) * i / nz]);
  ctx.lineCap = 'round'; ctx.strokeStyle = shade(c.color, -0.3); ctx.lineWidth = id === 'grape' ? 2 : 1.3;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i]; ctx.quadraticCurveTo(p[0] + (q[0] - p[0]) * 1.2, (p[1] + q[1]) / 2, q[0], q[1]); }
  ctx.stroke();
  const nL = [0, 0, 5, 9, 10][s];
  const leafLen = id === 'grape' ? 11 : id === 'tomato' ? 9 : 9.5;
  for (let i = 0; i < nL; i++) {
    const p = pts[Math.min(pts.length - 1, 1 + Math.floor(i * (pts.length - 1) / nL))];
    const side = i % 2 ? 1 : -1;
    const ang = side * (0.9 + r() * 0.5);
    const col = mixHex(mixHex(c.color, '#8cc35a', 0.18), shade(c.color, 0.22), r());
    const L = leafLen * (0.8 + r() * 0.35) * (0.75 + K[s] * 0.3);
    if (id === 'tomato') { // bileşik, dilimli yaprak
      const t = pt(p[0], p[1], ang, L * 0.6, 0); stem(ctx, p[0], p[1], t[0], t[1], 0.8, col);
      for (let k = -1; k <= 1; k++) leaf(ctx, t[0], t[1], ang + k * 0.7, L * 0.5, L * 0.22, col, k, 0.7, false);
    } else if (id === 'grape') { // geniş, loblu
      leaf(ctx, p[0], p[1], ang, L, L * 0.55, col, side * 1.5);
      leaf(ctx, p[0], p[1], ang - 0.55, L * 0.7, L * 0.35, shade(col, -0.06), side);
      leaf(ctx, p[0], p[1], ang + 0.55, L * 0.7, L * 0.35, shade(col, -0.06), side);
    } else leaf(ctx, p[0], p[1], ang, L, L * 0.5, col, side * 1.2); // fasulye: kalp
  }
  if (s === 3) {
    for (let i = 0; i < 4; i++) {
      const p = pts[1 + (i * 2) % (pts.length - 1)];
      if (id === 'tomato') { flower(ctx, p[0] + (i % 2 ? 6 : -6), p[1] + 2, 2.2, '#f6d54a', '#e0a020'); if (i < 2) fruit(ctx, p[0] + (i ? -5 : 5), p[1] + 5, 2.6, 2.5, '#9cc85a', 0.4); }
      else if (id === 'bean') flower(ctx, p[0] + (i % 2 ? 6 : -6), p[1] + 1, 2.2, i % 2 ? '#fbf3f6' : '#f2b7c8', '#f8e4a0');
      else if (i < 2) grapeCluster(ctx, p[0] + (i ? 7 : -7), p[1] + 2, 1.4, '#9cc160');
    }
  }
  if (s === 4) {
    if (id === 'tomato') {
      const F = [[-7, 0.25], [6, 0.38], [-6, 0.55], [7, 0.7], [-4, 0.82], [5, 0.15]];
      for (const [dx, h] of F) { const y = fy - H * h; fruit(ctx, sx + dx, y, 4.6, 4.3, c.accent, 0.6); for (let k = -2; k <= 2; k++) leaf(ctx, sx + dx, y - 3.6, k * 0.8, 2.6, 0.9, '#3f7a32', 0, 0.5, false); }
    } else if (id === 'bean') {
      const F = [[-6, 0.3, 0.15], [6, 0.42, -0.2], [-5, 0.6, 0.25], [7, 0.72, -0.1], [-3, 0.85, 0.1]];
      for (const [dx, h, a] of F) pod(ctx, sx + dx, fy - H * h, 13, c.accent, a);
    } else {
      grapeCluster(ctx, sx - 8, fy - H * 0.88, 2.4, c.accent);
      grapeCluster(ctx, sx + 8, fy - H * 0.72, 2.3, shade(c.accent, 0.08));
      grapeCluster(ctx, sx - 5, fy - H * 0.45, 2.1, shade(c.accent, -0.05));
    }
  }
}

function drawTall(ctx, cx, fy, s, c, id, r) {
  const corn = id === 'corn';
  mound(ctx, cx, fy, [11, 13, 20, 26, 30][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.85); return; }
  const H = corn ? [0, 14, 38, 68, 86][s] : [0, 12, 34, 62, 78][s];
  const sw = corn ? [0, 1.6, 2.4, 3.2, 3.4][s] : [0, 1.5, 2.2, 3, 3.2][s];
  const lean = 0.6;
  const stalkTop = [cx + lean, fy - H];
  if (s === 1) {
    for (let i = -1; i <= 1; i += 2) leaf(ctx, cx, fy - 2, i * 0.55, corn ? 13 : 8, corn ? 2.2 : 4, c.color, i * (corn ? 3 : 1));
    if (!corn) stem(ctx, cx, fy - 1, cx, fy - 8, 1.2, c.color);
    return;
  }
  const nL = corn ? [0, 0, 4, 7, 8][s] : [0, 0, 4, 6, 7][s];
  const stalkCol = s === 4 && corn ? mixHex(c.color, '#c8b45a', 0.25) : c.color;
  // arka yapraklar (gövdenin arkası)
  const leaves = [];
  for (let i = 0; i < nL; i++) {
    const h = 0.12 + (i / nL) * 0.75;
    const side = i % 2 ? 1 : -1;
    leaves.push({ h, side, back: i % 3 === 0 });
  }
  const drawL = (L) => {
    const y = fy - H * L.h, x = cx + lean * L.h;
    if (corn) { const len = (21 + r() * 8) * (0.7 + K[s] * 0.35); leaf(ctx, x, y, L.side * (0.75 + r() * 0.4), len, 2.6, mixHex(stalkCol, '#8cc35a', r() * 0.3), L.side * 7, 0.75, true); }
    else { const len = (11 + r() * 4) * (0.75 + K[s] * 0.3) * (1.15 - L.h * 0.4); const t = pt(x, y, L.side * 1.2, 4, 0); stem(ctx, x, y, t[0], t[1], 0.9, c.color); leaf(ctx, t[0], t[1], L.side * (1.3 + r() * 0.3), len, len * 0.6, mixHex(c.color, shade(c.color, 0.12), r()), L.side * 2.5); }
  };
  for (const L of leaves) if (L.back) drawL(L);
  stem(ctx, cx, fy - 1, stalkTop[0], stalkTop[1] + (corn ? 4 : 0), sw, stalkCol, -0.6);
  for (const L of leaves) if (!L.back) drawL(L);
  if (corn) {
    if (s >= 3) { // püskül
      const tc = s === 4 ? '#c9a24f' : '#c9d26a';
      ctx.strokeStyle = tc; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
      for (let k = -3; k <= 3; k++) { const a = k * 0.28; const p = pt(stalkTop[0], stalkTop[1] + 4, a, 9 + (3 - Math.abs(k)), a * 3); ctx.beginPath(); ctx.moveTo(stalkTop[0], stalkTop[1] + 4); ctx.quadraticCurveTo(stalkTop[0] + Math.sin(a) * 6, stalkTop[1] - 2, p[0], p[1] + 3); ctx.stroke(); }
    }
    const cobs = s === 4 ? [[0.42, 1], [0.6, -1]] : s === 3 ? [[0.5, 1]] : [];
    for (const [h, side] of cobs) {
      const y = fy - H * h, x = cx + lean * h;
      const ang = side * 0.38, len = s === 4 ? 17 : 11;
      if (s === 4) { // taneler kabuk arasından görünür
        const tip = pt(x, y, ang, len * 0.92, 0);
        ctx.save(); ctx.translate((x + tip[0]) / 2, (y + tip[1]) / 2); ctx.rotate(ang);
        fruit(ctx, 0, 0, 3.4, len * 0.42, c.accent, 0.4);
        ctx.fillStyle = rgba(shade(c.accent, -0.3), 0.5); for (let k = -3; k <= 3; k++) ctx.fillRect(-2.6, k * 2.2, 5.2, 0.6);
        ctx.restore();
        ctx.strokeStyle = '#a8743c'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.quadraticCurveTo(tip[0] + side * 3, tip[1] - 3, tip[0] + side * 4, tip[1] + 1); ctx.stroke();
      }
      leaf(ctx, x, y, ang - side * 0.15, len * 0.8, 3.4, mixHex(c.color, '#cfe08a', 0.35), -side * 1.5, 0.8, false);
      leaf(ctx, x, y, ang + side * 0.12, len * 0.7, 2.6, mixHex(c.color, '#b9d070', 0.25), side * 1.2, 0.7, false);
    }
  } else {
    const [hx, hy] = stalkTop;
    if (s === 2) { leaf(ctx, hx, hy + 1, -0.4, 6, 3, c.color, 0); leaf(ctx, hx, hy + 1, 0.4, 6, 3, c.color, 0); }
    if (s === 3) { // tomurcuk, hafif eğik
      for (let k = 0; k < 8; k++) leaf(ctx, hx, hy, k / 8 * Math.PI * 2, 6, 2, shade(c.color, 0.1), 0, 0.6, false);
      fruit(ctx, hx, hy, 5, 4.6, mixHex(c.color, '#cfe08a', 0.3), 0.3);
      ctx.fillStyle = rgba(c.accent, 0.8); ctx.beginPath(); ctx.arc(hx - 1, hy - 3, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    if (s === 4) { // çiçek başı: arka taç yaprak katmanı + ön katman + disk
      ctx.save(); ctx.translate(hx, hy - 2); ctx.scale(1, 0.92);
      for (let k = 0; k < 16; k++) leaf(ctx, 0, 0, (k + 0.5) / 16 * Math.PI * 2, 13.5, 3.2, shade(c.accent, -0.18), 0, 0.5, false);
      for (let k = 0; k < 16; k++) leaf(ctx, 0, 0, k / 16 * Math.PI * 2, 12.5, 3.4, mixHex(c.accent, '#ffe27a', (k % 3) * 0.12), 0, 0.85, false);
      const dg = ctx.createRadialGradient(-2, -2, 0, 0, 0, 7.5); dg.addColorStop(0, '#8a5a2a'); dg.addColorStop(0.6, '#5a3a1e'); dg.addColorStop(1, '#2e1c0e');
      ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(0, 0, 7.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,120,0.28)'; for (let k = 0; k < 14; k++) { const a = k * 2.4, rr = Math.sqrt(k / 14) * 6; ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.7, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
}

function pumpkinShape(ctx, x, y, rx, ry, col) {
  const lobes = [[-0.62, 0.5], [0.62, 0.5], [-0.32, 0.62], [0.32, 0.62], [0, 0.6]];
  for (const [dx, w] of lobes) fruit(ctx, x + dx * rx, y, rx * w, ry, dx === 0 ? shade(col, 0.06) : shade(col, -Math.abs(dx) * 0.2), dx === 0 ? 0.35 : 0.15);
  const sg = ctx.createLinearGradient(x - 2, 0, x + 2, 0); sg.addColorStop(0, '#8a8a4a'); sg.addColorStop(1, '#4a4a22');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(x - 1.6, y - ry + 1); ctx.quadraticCurveTo(x - 1, y - ry - 4, x + 2.5, y - ry - 5); ctx.lineTo(x + 2.8, y - ry - 3); ctx.quadraticCurveTo(x + 1.2, y - ry - 2, x + 1.6, y - ry + 1); ctx.fill();
}

function watermelonShape(ctx, x, y, rx, ry, col, stripe) {
  fruit(ctx, x, y, rx, ry, col, 0);
  ctx.save(); ctx.beginPath(); ctx.ellipse(x + rx * 0.06, y + ry * 0.08, rx * 0.95, ry * 0.94, 0, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = rgba(stripe, 0.85); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (let i = -3; i <= 3; i++) {
    const bx = x + i * rx * 0.3;
    ctx.beginPath(); ctx.moveTo(bx - i * 2, y - ry);
    for (let k = 1; k <= 6; k++) { const t = k / 6; ctx.lineTo(bx + Math.sin(t * 9 + i) * 1.2 + i * 2 * (t - 0.5) * 1.4, y - ry + t * ry * 2); }
    ctx.stroke();
  }
  // hacim gölgesi yeniden
  const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.35, 0, x, y, rx * 1.15);
  g.addColorStop(0, 'rgba(255,255,230,0.22)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,30,10,0.5)');
  ctx.fillStyle = g; ctx.fillRect(x - rx - 2, y - ry - 2, rx * 2 + 4, ry * 2 + 4);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(x - rx * 0.4, y - ry * 0.45, rx * 0.2, ry * 0.12, -0.4, 0, Math.PI * 2); ctx.fill();
}

function drawMelon(ctx, cx, fy, s, c, id, r) {
  const pump = id === 'pumpkin';
  mound(ctx, cx, fy, [11, 16, 30, 46, 54][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.85); return; }
  const n = [0, 2, 5, 8, 9][s], L = [0, 7, 11, 13.5, 14][s];
  // yere yayılan iri yapraklar (zemin düzlemine basık)
  const lv = [];
  for (let i = 0; i < n; i++) { const a = spread(n, i) * 3.4 + (r() - 0.5) * 0.3; lv.push({ a, d: Math.cos(a) }); }
  lv.sort((p, q) => q.d - p.d);
  // kıvrık sülükler
  ctx.strokeStyle = rgba(shade(c.color, 0.15), 0.8); ctx.lineWidth = 0.8;
  for (let i = 0; i < Math.min(3, s); i++) { const x = cx + (i - 1) * 16, y = fy - 4 - (i % 2) * 4; ctx.beginPath(); for (let k = 0; k < 16; k++) { const t = k / 15, a = t * 9, rr = 3.2 * (1 - t); ctx.lineTo(x + Math.cos(a) * rr + t * 4, y + Math.sin(a) * rr * 0.7); } ctx.stroke(); }
  for (const v of lv) {
    const reach = L * (s >= 3 ? 1.2 : 0.9);
    const bx = cx + Math.sin(v.a) * reach * 0.55, by = fy - 2 - Math.cos(v.a) * reach * 0.25;
    ctx.save(); ctx.translate(bx, by); ctx.scale(1, 0.72);
    const col = mixHex(mixHex(c.color, '#8cc35a', 0.22), shade(c.color, 0.2), r());
    leaf(ctx, 0, 0, v.a * 0.6, L, L * 0.62, col, 0, 0.8);
    leaf(ctx, 0, 0, v.a * 0.6 - 0.6, L * 0.7, L * 0.38, shade(col, -0.08), -1, 0.6, false);
    leaf(ctx, 0, 0, v.a * 0.6 + 0.6, L * 0.7, L * 0.38, shade(col, -0.08), 1, 0.6, false);
    ctx.restore();
  }
  if (s === 3) {
    flower(ctx, cx - 10, fy - 12, 2.8, '#f6d04a', '#e8a020');
    if (pump) pumpkinShape(ctx, cx + 3, fy - 3, 7, 5, mixHex('#9cc85a', c.accent, 0.35)); else watermelonShape(ctx, cx + 3, fy - 3, 8, 5.5, '#8cc062', '#4f8a3a');
  }
  if (s === 4) {
    if (pump) pumpkinShape(ctx, cx + 1, fy - 9, 17, 12.5, c.accent); else watermelonShape(ctx, cx + 1, fy - 8, 18, 12, '#74ab52', c.accent);
    // önde birkaç yaprak meyvenin önüne düşer
    leaf(ctx, cx - 15, fy + 1, -2.2, 9, 5, shade(c.color, 0.05), -2);
    leaf(ctx, cx + 17, fy + 1, 2.1, 8, 4.6, c.color, 2);
  }
}

function drawRoot(ctx, cx, fy, s, c, id, r) {
  mound(ctx, cx, fy, [11, 13, 18, 24, 28][s]);
  if (s === 0) { sprout(ctx, cx, fy - 1, c.color, 0.8); return; }
  const n = [0, 3, 6, 9, 11][s], L = [0, 9, 15, 22, 26][s];
  if (s >= 3) { // turuncu omuz toprak yüzeyinde
    const rx = s === 4 ? 6.2 : 4.2, ry = s === 4 ? 3.8 : 2.8;
    fruit(ctx, cx, fy - ry * 0.5, rx, ry, c.accent, 0.35);
    ctx.strokeStyle = rgba(shade(c.accent, -0.35), 0.5); ctx.lineWidth = 0.6;
    for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(cx, fy - ry * 0.2 + k * 1.4, rx * 0.8, ry * 0.4, 0, 0.2, Math.PI - 0.2); ctx.stroke(); }
  }
  const order = [];
  for (let i = 0; i < n; i++) order.push(spread(n, i) * 2 + (r() - 0.5) * 0.25);
  order.sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const a of order) {
    const len = L * (0.8 + r() * 0.3) * (1 - Math.abs(a) * 0.15);
    const tip = pt(cx, fy - 3, a, len, a * 4);
    const col = mixHex(c.color, '#9ed06a', r() * 0.35);
    stem(ctx, cx + a, fy - 3, tip[0], tip[1], 0.8, col, a * 3);
    // tüylü yaprakçıklar (saçak)
    const m = Math.max(2, Math.round(len / 3.4));
    for (let k = 1; k <= m; k++) {
      const t = k / (m + 0.5);
      const bx = cx + a + (tip[0] - cx - a) * t + a * 3 * Math.sin(t * Math.PI) * 0.5, by = fy - 3 + (tip[1] - fy + 3) * t;
      const ll = 3.2 * (1 - t * 0.4) * (L > 12 ? 1 : 0.8);
      leaf(ctx, bx, by, a - 0.9, ll, 1.1, col, 0, 0.6, false);
      leaf(ctx, bx, by, a + 0.9, ll, 1.1, shade(col, -0.06), 0, 0.6, false);
    }
    leaf(ctx, tip[0], tip[1], a, 3, 1.2, col, 0, 0.6, false);
  }
}

const SHAPES = { leafy: drawLeafy, bush: drawBush, berry: drawBerry, grain: drawGrain, vine: drawVine, tall: drawTall, melon: drawMelon, root: drawRoot };

// ------------------------------------------------------------------ ikonlar (hasat: ürün yukarı süzülür)
function drawIcon(ctx, cx, cy, id, c, r) {
  const a = c.accent;
  switch (id) {
    case 'lettuce': fruit(ctx, cx, cy + 2, 10, 9, c.accent, 0.3); for (let i = -1; i <= 1; i++) leaf(ctx, cx + i * 5, cy + 9, i * 0.8, 12, 6, mixHex(c.color, c.accent, 0.3), i * 2); break;
    case 'spinach': leaf(ctx, cx - 3, cy + 10, -0.35, 20, 8, c.color, -1); leaf(ctx, cx + 3, cy + 10, 0.4, 18, 7, shade(c.color, 0.15), 1); break;
    case 'potato': fruit(ctx, cx, cy, 11, 8, a, 0.35, -0.3); ctx.fillStyle = rgba(shade(a, -0.4), 0.6); for (const [x, y] of [[-4, -2], [3, 1], [-1, 4], [6, -3]]) { ctx.beginPath(); ctx.arc(cx + x, cy + y, 0.9, 0, Math.PI * 2); ctx.fill(); } break;
    case 'strawberry': strawberry(ctx, cx, cy + 1, 8, a); break;
    case 'wheat': for (let i = -1; i <= 1; i++) { const x0 = cx + i * 3, y0 = cy + 13; const t = pt(x0, y0, i * 0.3, 16, 0); stem(ctx, x0, y0, t[0], t[1], 1.2, '#c8a548'); grainHead(ctx, t[0], t[1], i * 0.3, 10, a, true); } break;
    case 'bean': pod(ctx, cx - 5, cy - 9, 20, a, -0.4); pod(ctx, cx + 1, cy - 8, 18, shade(a, -0.1), 0.15); break;
    case 'tomato': fruit(ctx, cx, cy + 1, 10, 9, a, 0.6); for (let k = -2; k <= 2; k++) leaf(ctx, cx, cy - 7, k * 0.75, 6, 1.8, '#3f7a32', 0, 0.5, false); break;
    case 'corn': { ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.5); fruit(ctx, 0, 0, 6, 12, a, 0.45); ctx.fillStyle = rgba(shade(a, -0.3), 0.45); for (let k = -4; k <= 4; k++) ctx.fillRect(-5, k * 2.4, 10, 0.7); ctx.restore(); leaf(ctx, cx - 6, cy + 11, -0.2, 16, 4, '#8cc35a', -2); leaf(ctx, cx - 4, cy + 12, 0.5, 13, 3.4, '#6aa84f', 2); break; }
    case 'watermelon': watermelonShape(ctx, cx, cy + 1, 13, 10, '#74ab52', a); break;
    case 'pumpkin': pumpkinShape(ctx, cx, cy + 2, 13, 10, a); break;
    case 'sunflower': { for (let k = 0; k < 14; k++) leaf(ctx, cx, cy, k / 14 * Math.PI * 2, 12, 3.4, mixHex(a, '#ffe27a', (k % 3) * 0.12), 0, 0.85, false); const dg = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, 7); dg.addColorStop(0, '#8a5a2a'); dg.addColorStop(1, '#2e1c0e'); ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.fill(); break; }
    case 'carrot': { ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5);
      ctx.fillStyle = mixHex(a, RIM, 0.4); ctx.beginPath(); ctx.moveTo(-5.5, -7); ctx.quadraticCurveTo(0, -10, 5.5, -7); ctx.quadraticCurveTo(2, 6, 0, 14); ctx.quadraticCurveTo(-2, 6, -5.5, -7); ctx.fill();
      const g = ctx.createLinearGradient(-5, 0, 5, 0); g.addColorStop(0, shade(a, 0.2)); g.addColorStop(0.6, a); g.addColorStop(1, shade(a, -0.4));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-4.8, -6.4); ctx.quadraticCurveTo(0.5, -9.4, 5.8, -6.6); ctx.quadraticCurveTo(2.3, 6, 0.3, 13.6); ctx.quadraticCurveTo(-1.6, 6, -4.8, -6.4); ctx.fill();
      ctx.strokeStyle = rgba(shade(a, -0.4), 0.5); ctx.lineWidth = 0.6; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-3 + k * 0.6, -3 + k * 4); ctx.lineTo(1 - k * 0.3, -2.5 + k * 4); ctx.stroke(); }
      for (let k = -1; k <= 1; k++) leaf(ctx, 0, -8, k * 0.45, 9, 1.8, c.color, k, 0.6, false);
      ctx.restore(); break; }
    case 'grape': leaf(ctx, cx + 2, cy - 7, 0.9, 10, 5, c.color, 1); grapeCluster(ctx, cx, cy - 8, 2.6, a); break;
    default: fruit(ctx, cx, cy, 9, 9, a, 0.5);
  }
}

// ------------------------------------------------------------------ türetilmiş varyantlar
let _tmp = null;
function tmpCell() {
  const { w, h } = CROP_CELL;
  if (!_tmp) { const c = document.createElement('canvas'); c.width = w; c.height = h; _tmp = { canvas: c, ctx: c.getContext('2d') }; }
  _tmp.ctx.setTransform(1, 0, 0, 1, 0, 0); _tmp.ctx.globalCompositeOperation = 'source-over'; _tmp.ctx.globalAlpha = 1;
  _tmp.ctx.clearRect(0, 0, w, h);
  return _tmp;
}

/** Solgun: belirgin sarkma (ezme + yana yatma), soldurulmuş doygunluk, sarı-kahve renk, kahverengi uç lekeleri. */
function deriveWither(ctx, src, sx, sy, dx, dy, r) {
  const { w, h, footX, footY } = CROP_CELL;
  const { canvas: tc, ctx: t } = tmpCell();
  const squash = () => { t.save(); t.translate(footX, footY); t.transform(1.08, 0, -0.16, 0.72, 0, 0); t.drawImage(src, sx, sy, w, h, -footX, -footY, w, h); t.restore(); };
  squash();
  // doygunluğu düşür (ışıklılık korunur), sonra özgün alfaya geri kırp
  t.globalCompositeOperation = 'saturation'; t.fillStyle = 'rgba(128,128,128,0.7)'; t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'destination-in'; squash();
  t.globalCompositeOperation = 'source-atop';
  const g = t.createLinearGradient(0, 20, 0, footY);
  g.addColorStop(0, 'rgba(196,140,52,0.72)'); g.addColorStop(0.65, 'rgba(204,170,64,0.6)'); g.addColorStop(1, 'rgba(150,118,52,0.5)');
  t.fillStyle = g; t.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { // kurumuş kahverengi uçlar
    const x = 10 + r() * (w - 20), y = 8 + r() * (footY - 14), rr = 1.5 + r() * 2.5;
    const rg = t.createRadialGradient(x, y, 0, x, y, rr); rg.addColorStop(0, 'rgba(112,72,34,0.75)'); rg.addColorStop(1, 'rgba(112,72,34,0)');
    t.fillStyle = rg; t.beginPath(); t.arc(x, y, rr, 0, Math.PI * 2); t.fill();
  }
  ctx.drawImage(tc, dx, dy);
}

/** Hastalıklı (tint'siz, iki renderer'da da aynı): sarı yaprak lekeleri + kahverengi benekler. */
function deriveSick(ctx, src, sx, sy, dx, dy, r) {
  const { w, h, footY } = CROP_CELL;
  const { canvas: tc, ctx: t } = tmpCell();
  t.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  t.globalCompositeOperation = 'source-atop';
  t.fillStyle = 'rgba(214,196,84,0.22)'; t.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    const x = 8 + r() * (w - 16), y = 6 + r() * (footY - 10), rr = 4 + r() * 6;
    const rg = t.createRadialGradient(x, y, 0, x, y, rr); rg.addColorStop(0, 'rgba(236,214,78,0.85)'); rg.addColorStop(0.6, 'rgba(222,196,72,0.5)'); rg.addColorStop(1, 'rgba(222,196,72,0)');
    t.fillStyle = rg; t.beginPath(); t.arc(x, y, rr, 0, Math.PI * 2); t.fill();
  }
  for (let i = 0; i < 30; i++) {
    const x = 8 + r() * (w - 16), y = 6 + r() * (footY - 10), rr = 0.9 + r() * 1.3;
    t.fillStyle = r() < 0.6 ? 'rgba(98,62,26,0.85)' : 'rgba(70,50,22,0.75)'; t.beginPath(); t.arc(x, y, rr, 0, Math.PI * 2); t.fill();
  }
  ctx.drawImage(tc, dx, dy);
}

const DRY = ['#a58e6c', '#b49d7a', '#8d775b', '#c2ad89', '#9a7f5e'];
const DRY_STALK = '#7d6a52';
/** Ölü: her aşamada okunur silüet — koyu kuru toprak halkası, sarkık/devrilmiş saman-gri saplar, kıvrık kuru yapraklar. */
function drawDead(ctx, cx, fy, s, shape, r) {
  const meta = SHAPE_META[shape] || SHAPE_META.bush;
  const H = Math.max(14, Math.min(46, meta.h[s] * 0.62 + 6));
  const W = Math.max(20, Math.min(40, meta.w[s] * 0.7 + 6));
  const dcol = () => DRY[(r() * DRY.length) | 0];
  // kuru, çatlak toprak halkası
  ctx.save(); ctx.translate(cx, fy + 1); ctx.scale(1, 0.36);
  const R = W * 0.62 + 5;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(34,22,14,0.78)'); g.addColorStop(0.62, 'rgba(40,27,17,0.6)'); g.addColorStop(0.85, 'rgba(58,40,26,0.3)'); g.addColorStop(1, 'rgba(58,40,26,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(160,136,104,0.5)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, r0 = R * (0.25 + r() * 0.2), r1 = R * (0.55 + r() * 0.25);
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a + 0.25) * (r0 + r1) / 2, Math.sin(a + 0.25) * (r0 + r1) / 2); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
  }
  ctx.restore();
  // yere düşmüş kuru yapraklar
  for (let i = 0; i < 2 + (s > 2 ? 1 : 0); i++) {
    const x = cx + (r() - 0.5) * W * 0.9, y = fy + (r() - 0.3) * 3;
    leaf(ctx, x, y, (r() < 0.5 ? -1 : 1) * (1.35 + r() * 0.3), 4.5 + r() * 2, 1.8, dcol(), (r() - 0.5) * 2, 0.6, false);
  }
  const low = shape === 'melon' || shape === 'leafy' || shape === 'berry';
  const upright = shape === 'grain' || shape === 'tall' || shape === 'vine';
  if (shape === 'vine' && s >= 2) { // eğilmiş destek çubuğu
    const wg = ctx.createLinearGradient(cx, 0, cx + 3, 0); wg.addColorStop(0, '#a88a64'); wg.addColorStop(1, '#5e4630');
    ctx.save(); ctx.translate(cx + 3, fy); ctx.rotate(0.28); ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(-1.5, -H * 1.05, 3, H * 1.05 + 1, 1.5); ctx.fill(); ctx.restore();
  }
  if (low) {
    // çökmüş rozet: yere yatmış, kıvrık yapraklar + kısa sarkık saplar
    const n = 4 + s;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, ang = side * (1.25 + r() * 0.55);
      const L = W * (0.32 + r() * 0.18);
      const bx = cx + side * r() * 3;
      stem(ctx, bx, fy - 1, bx + side * L * 0.5, fy - 3 - r() * 3, 1.3, DRY_STALK, -side * 2);
      leaf(ctx, bx + side * L * 0.4, fy - 3, ang + side * 0.3, L * 0.8, L * 0.26, dcol(), side * 2.5, 0.7, false);
    }
    // ortada sarkık birkaç sap
    for (let i = 0; i < 2; i++) { const side = i ? 1 : -1; const top = [cx + side * 3, fy - H * 0.55]; stem(ctx, cx, fy - 1, top[0], top[1], 1.4, DRY_STALK, side); leaf(ctx, top[0], top[1], side * 2.5, H * 0.38, 2, dcol(), side * 2, 0.7, false); }
    if (shape === 'melon' && s >= 3) {
      const x = cx + 6, y = fy - 2.5; fruit(ctx, x, y, 6.5 + s, 3.6 + s * 0.4, '#8e7652', 0.12);
      ctx.strokeStyle = 'rgba(60,44,28,0.55)'; ctx.lineWidth = 0.8;
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x + k * 3 - 2, y - 2); ctx.quadraticCurveTo(x + k * 3, y, x + k * 3 - 1, y + 2.5); ctx.stroke(); }
    }
    if (shape === 'berry' && s >= 3) for (let k = 0; k < 4; k++) fruit(ctx, cx + (r() - 0.5) * W * 0.6, fy - 1 - r() * 3, 1.8, 1.6, '#5a3a2a', 0.15);
    return;
  }
  // dik/çalı: yükselip devrilen saplar
  const n = shape === 'grain' ? 3 + s : upright ? 2 + (s > 2 ? 1 : 0) : 3 + (s > 2 ? 1 : 0);
  const wid = shape === 'tall' ? 2.2 + s * 0.25 : 1.5 + s * 0.2;
  for (let i = 0; i < n; i++) {
    const t = spread(n, i), dir = t === 0 ? (r() < 0.5 ? -1 : 1) : Math.sign(t);
    const bx = cx + t * W * (upright ? 0.35 : 0.5);
    const hh = H * (0.7 + r() * 0.35) * (upright ? 1 : 0.8);
    const knee = [bx + dir * hh * 0.12, fy - hh];                  // kırılma/bükülme noktası
    const tip = [knee[0] + dir * hh * (0.38 + r() * 0.15), fy - hh * (0.35 + r() * 0.2)]; // sarkan uç
    stem(ctx, bx, fy - 1, knee[0], knee[1], wid, DRY_STALK, dir * 1.5);
    stem(ctx, knee[0], knee[1], tip[0], tip[1], wid * 0.85, DRY_STALK, -dir * hh * 0.08);
    // sapa asılı kıvrık kuru yapraklar (aşağı bakar)
    const nl = 1 + (s > 1 ? 1 : 0) + (s > 3 ? 1 : 0);
    for (let k = 0; k < nl; k++) {
      const u = 0.35 + k * 0.25 + r() * 0.08;
      const lx = bx + (knee[0] - bx) * u, ly = fy - 1 + (knee[1] - fy + 1) * u;
      const side = k % 2 ? dir : -dir;
      leaf(ctx, lx, ly, side * (2.25 + r() * 0.4), 5 + s * 1.6 + r() * 2, 1.9 + s * 0.2, dcol(), side * 2.5, 0.7, false);
    }
    if (shape === 'grain' && s >= 3) grainHead(ctx, tip[0], tip[1], dir * 2.3, 8, '#b8a37c', false);
    else if (shape === 'tall' && s >= 3 && i === 0) fruit(ctx, knee[0] + dir * 2, knee[1] + hh * 0.3, 2.6, 6, '#8a7452', 0.1, dir * 0.4);
    else leaf(ctx, tip[0], tip[1], dir * 2.6, 4 + s, 1.7, dcol(), dir * 2, 0.7, false);
  }
}

export function genCrops(scene) {
  if (scene.textures.exists(CROP_ATLAS)) return;
  const t0 = performance.now();
  const { w, h, footX, footY } = CROP_CELL;
  const rows = CROP_IDS.length;
  // Hızlandırılmış (GPU) 2B canvas: willReadFrequently yok — piksel okumuyoruz, yalnızca yol çizimi.
  const canvas = document.createElement('canvas'); canvas.width = w * COLS; canvas.height = h * rows;
  const ctx = canvas.getContext('2d');
  // 1) sağlıklı aşamalar (CROP_SCALE ile ayak çevresinde büyütülmüş)
  CROP_IDS.forEach((id, row) => {
    const c = CROPS[id]; const fn = SHAPES[c.shape] || drawBush;
    const oy = row * h;
    for (let s = 0; s < 5; s++) {
      const r = mulberry32(1000 + row * 31 + s * 7);
      const fx = s * w + footX, fy = oy + footY;
      ctx.save(); ctx.beginPath(); ctx.rect(s * w, oy, w, h); ctx.clip();
      ctx.translate(fx, fy); ctx.scale(CROP_SCALE, CROP_SCALE); ctx.translate(-fx, -fy);
      fn(ctx, fx, fy, s, c, id, r);
      ctx.restore();
    }
  });
  // 2) solgun/ölü: sağlıklı bölgenin TEK kopyasından türetilir (aynı canvas'a kendinden çizim pahalı kopya yaratır)
  const snap = document.createElement('canvas'); snap.width = w * 5; snap.height = h * rows;
  snap.getContext('2d').drawImage(canvas, 0, 0, w * 5, h * rows, 0, 0, w * 5, h * rows);
  CROP_IDS.forEach((id, row) => {
    const c = CROPS[id]; const oy = row * h;
    const r2 = mulberry32(5000 + row), r3 = mulberry32(6000 + row), r4 = mulberry32(7000 + row);
    for (let s = 1; s <= 4; s++) {
      deriveWither(ctx, snap, s * w, oy, (4 + s) * w, oy, r3);
      deriveSick(ctx, snap, s * w, oy, (13 + s) * w, oy, r4);
      const fx = (8 + s) * w + footX, fy = oy + footY;
      ctx.save(); ctx.beginPath(); ctx.rect((8 + s) * w, oy, w, h); ctx.clip();
      ctx.translate(fx, fy); ctx.scale(CROP_SCALE, CROP_SCALE); ctx.translate(-fx, -fy);
      drawDead(ctx, fx, fy, s, c.shape, r2);
      ctx.restore();
    }
    // 3) ürün ikonu
    ctx.save(); ctx.beginPath(); ctx.rect(13 * w, oy, w, h); ctx.clip();
    drawIcon(ctx, 13 * w + w / 2, oy + h / 2, id, c, mulberry32(9000 + row));
    ctx.restore();
  });
  const tex = register(scene, CROP_ATLAS, canvas, { cell: CROP_CELL });
  CROP_IDS.forEach((id, row) => {
    const oy = row * h;
    for (let s = 0; s < 5; s++) tex.add(`${id}_${s}`, 0, s * w, oy, w, h);
    for (let s = 1; s <= 4; s++) { tex.add(`${id}_w${s}`, 0, (4 + s) * w, oy, w, h); tex.add(`${id}_d${s}`, 0, (8 + s) * w, oy, w, h); tex.add(`${id}_s${s}`, 0, (13 + s) * w, oy, w, h); }
    tex.add(`${id}_icon`, 0, 13 * w, oy, w, h);
  });
  // ekin gölgesi: ayakta keskin, uca doğru yumuşayan dikey leke (orijin taban orta)
  if (!scene.textures.exists('crop_sh')) {
    const sw = 32, sh = 64; const { canvas: c2, ctx: g2 } = makeCanvas(sw, sh);
    const img = g2.createImageData(sw, sh); const d = img.data;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const v = 1 - (y + 0.5) / sh; // 0 ayak .. 1 uç
      const u = ((x + 0.5) / sw * 2 - 1) / (0.55 + 0.45 * Math.sin(Math.min(1, v * 1.3 + 0.15) * Math.PI * 0.9));
      const a = Math.max(0, 1 - u * u) * Math.pow(Math.max(0, 1 - v), 0.8) * Math.min(1, (1 - v) * 6);
      const i = (y * sw + x) * 4; d[i] = 26; d[i + 1] = 22; d[i + 2] = 48; d[i + 3] = Math.min(255, Math.pow(a, 1.3) * 255);
    }
    g2.putImageData(img, 0, 0); register(scene, 'crop_sh', c2);
  }
  // zararlı böcekler (3 kare) ve hastalık lekeleri
  if (!scene.textures.exists('crop_bugs')) {
    // zoom 1'de seçilebilir böcekler: ~6 px gövde, bacaklar, parlak kabuk
    const bw = 34, bh = 26; const { canvas: c3, ctx: g3 } = makeCanvas(bw * 4, bh);
    const rb = mulberry32(77);
    const POS = [[9, 9], [24, 15], [15, 19], [26, 6], [7, 18], [18, 9], [29, 20]];
    for (let f = 0; f < 3; f++) {
      const n = [3, 5, 7][f];
      for (let i = 0; i < n; i++) {
        const x = f * bw + POS[i][0] + (rb() - 0.5) * 2, y = POS[i][1] + (rb() - 0.5) * 2, rot = rb() * Math.PI * 2;
        const col = i % 3 === 0 ? '#2e2216' : i % 3 === 1 ? '#2c3a16' : '#6a2416';
        g3.save(); g3.translate(x, y); g3.rotate(rot);
        g3.strokeStyle = 'rgba(18,12,6,0.85)'; g3.lineWidth = 0.8; g3.lineCap = 'round';
        for (let k = -1; k <= 1; k++) { g3.beginPath(); g3.moveTo(k * 1.4, -1); g3.lineTo(k * 2.2, -3.4); g3.moveTo(k * 1.4, 1); g3.lineTo(k * 2.2, 3.4); g3.stroke(); }
        g3.fillStyle = 'rgba(16,10,6,0.35)'; g3.beginPath(); g3.ellipse(0.6, 0.9, 3.4, 2.4, 0, 0, Math.PI * 2); g3.fill(); // temas gölgesi
        fruit(g3, 0, 0, 3.2, 2.3, col, 0.75);
        g3.fillStyle = '#140c06'; g3.beginPath(); g3.arc(3.3, 0, 1.25, 0, Math.PI * 2); g3.fill(); // baş
        g3.strokeStyle = 'rgba(0,0,0,0.35)'; g3.lineWidth = 0.5; g3.beginPath(); g3.moveTo(-2.8, 0); g3.lineTo(2.2, 0); g3.stroke(); // kanat çizgisi
        g3.restore();
      }
    }
    for (let i = 0; i < 11; i++) { // lekeler
      const x = 3 * bw + 4 + rb() * (bw - 8), y = 4 + rb() * (bh - 8), rr = 1.4 + rb() * 2;
      const g = g3.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(92,60,24,0.85)'); g.addColorStop(0.7, 'rgba(150,120,40,0.6)'); g.addColorStop(1, 'rgba(180,160,60,0)');
      g3.fillStyle = g; g3.beginPath(); g3.arc(x, y, rr, 0, Math.PI * 2); g3.fill();
    }
    const t3 = register(scene, 'crop_bugs', c3);
    for (let f = 0; f < 3; f++) t3.add(`bugs${f}`, 0, f * bw, 0, bw, bh);
    t3.add('spots', 0, 3 * bw, 0, bw, bh);
  }
  const ms = performance.now() - t0;
  if (typeof window !== 'undefined') window.__cropTexMs = ms;
}
