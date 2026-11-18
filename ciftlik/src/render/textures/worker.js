// Çırak (kullanıcının çocuğundan esinlenen karakter) ve eşek dokuları — PLAN §11 "Görsel".
// Tarif: ~11 yaşında erkek çocuk; yana taranmış koyu kahverengi saç, kalın koyu kaşlar, iri kahverengi gözler, açık buğday ten,
// pembe yanaklar, hafif yana çekik gülümseme; gri-lacivert-lila kamuflaj desenli kapüşonlu sweatshirt + göğüste kırmızı desen,
// koyu pantolon, spor ayakkabı. Kontursuz; sol-üstten kenar ışığı. 2× çözünürlükte çizilir, sahnede 0.5 ölçekle gösterilir
// (dünya boyu ≈ 52 px). Açılışta BİR KEZ üretilir (idempotent). Hepsi SAĞA bakar; sola gitmek için ayna.
import { makeCanvas, register, shade, rgba, radial } from './canvas.js';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
export const SS = 2;                       // süper örnekleme
export const KID = { w: 120, h: 120, ox: 60, oy: 112, sitOy: 80 };  // doku px; ayak noktası (ayakta) / kalça (binerken)
export const WALK_N = 6;
export const kidKey = (n) => `kid_${n}`;
export const KID_FRAMES = ['idle0', 'idle1', 'bucket0', 'bucket1', 'basket0', 'basket1', 'ride0', 'ride1', 'ride2'];
export const DK = { w: 176, h: 160, ox: 84, oy: 144 };            // eşek dokusu; ayak (orta) noktası
export const DK_FRAMES = ['stand', 'eat', 'w0', 'w1', 'w2', 'w3'];
export const dkKey = (n) => `dk_${n}`;
export const BUBBLES = ['water', 'basket', 'feed', 'gear'];
export const bubbleKey = (n) => `wk_ic_${n}`;

const SKIN = '#edc99c', SKIN_D = '#c9966a', HAIR = '#3a2216', PANTS = '#2b303d';
const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
const lg = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; };

let camoCache = null;
function camo(ctx) {
  if (!camoCache) {
    const T = 44, { canvas, ctx: c } = makeCanvas(T, T), r = mulberry32(77);
    c.fillStyle = '#7d869b'; c.fillRect(0, 0, T, T);
    const cols = ['#27325a', '#a99bd6', '#c5c9d4', '#1d2548', '#4d5a86', '#27325a', '#c5c9d4'];
    for (let i = 0; i < 30; i++) {
      const x = r() * T, y = r() * T, rx = 3 + r() * 5, ry = 2 + r() * 3.2, rot = r() * Math.PI, col = cols[i % cols.length];
      for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) { c.fillStyle = col; c.beginPath(); c.ellipse(x + ox, y + oy, rx, ry, rot, 0, TAU); c.fill(); }
    }
    camoCache = canvas;
  }
  return ctx.createPattern(camoCache, 'repeat');
}

// ------------------------------------------------------------------ ÇOCUK
function leg(ctx, hx, hy, fx, fy, shoe, back) {
  // diz: hip→ayak orta noktasından ileri doğru
  const mx = (hx + fx) / 2, my = (hy + fy) / 2, dx = fx - hx, dy = fy - hy, len = Math.hypot(dx, dy) || 1;
  let nx = dy / len, ny = -dx / len; if (nx < 0) { nx = -nx; ny = -ny; }
  const bend = Math.max(0, 22 - len) * 0.35 + 0.8;
  const kx = mx + nx * bend, ky = my + ny * bend;
  const c = back ? '#232834' : PANTS;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = c; ctx.lineWidth = 6.6; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
  ctx.lineWidth = 5.4; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy - 2.4); ctx.stroke();
  if (!back) { ctx.strokeStyle = rgba('#8a96b8', 0.28); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hx - 2.2, hy + 1); ctx.lineTo(kx - 2, ky); ctx.lineTo(fx - 1.6, fy - 3); ctx.stroke(); }
  // spor ayakkabı
  const sc = back ? '#b4b7c2' : '#e9e9ee';
  ell(ctx, fx + 1.8, fy - 1.4, 5.4, 2.9, lg(ctx, 0, fy - 4, 0, fy, [[0, sc], [1, shade(sc, -0.18)]]), shoe || 0);
  ctx.fillStyle = back ? '#8a8d99' : '#f6f4ee'; ctx.beginPath(); ctx.ellipse(fx + 1.8, fy - 0.2, 5.6, 1.5, 0, 0, TAU); ctx.fill();
  if (!back) { ell(ctx, fx + 0.2, fy - 2.2, 2.6, 1.1, '#3a4466', -0.2); ell(ctx, fx + 4.6, fy - 1.8, 1.6, 1.2, rgba('#ffffff', 0.8)); }
}

function arm(ctx, sx, sy, hx, hy, far) {
  const mx = (sx + hx) / 2, my = (sy + hy) / 2, dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1;
  let nx = dy / len, ny = -dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
  const ex = mx + nx * 1.6, ey = my + ny * 1.6;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = camo(ctx); ctx.lineWidth = 5.8; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(ex, ey, hx - dx / len * 2, hy - dy / len * 2); ctx.stroke();
  ctx.strokeStyle = far ? 'rgba(10,12,28,0.38)' : 'rgba(10,12,28,0.16)'; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(ex, ey, hx - dx / len * 2, hy - dy / len * 2); ctx.stroke();
  if (!far) { ctx.strokeStyle = rgba('#fff4dc', 0.3); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx - 2, sy + 0.5); ctx.quadraticCurveTo(ex - 2, ey, hx - 2 - dx / len * 2, hy - dy / len * 2); ctx.stroke(); }
  // manşet + el
  const a = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(hx - dx / len * 2.2, hy - dy / len * 2.2); ctx.rotate(a); ctx.fillStyle = far ? '#4a5470' : '#8a93ad'; ctx.beginPath(); ctx.ellipse(0, 0, 1.6, 3.2, 0, 0, TAU); ctx.fill(); ctx.restore();
  ell(ctx, hx, hy, 2.5, 2.4, far ? SKIN_D : SKIN);
  if (!far) ell(ctx, hx - 0.6, hy - 0.7, 1.2, 0.9, rgba('#ffffff', 0.35));
}

function torso(ctx, hy, sit) {
  // kapüşon (boyun arkasında yığılmış)
  ctx.fillStyle = camo(ctx); ctx.beginPath(); ctx.ellipse(28.6, 22.4, 9.4, 4.4, -0.12, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(10,12,28,0.34)'; ctx.beginPath(); ctx.ellipse(28.6, 22.4, 9.4, 4.4, -0.12, 0, TAU); ctx.fill();
  // gövde
  const bot = hy + (sit ? 2 : 3.2);
  ctx.beginPath(); ctx.moveTo(22.4, 25.6); ctx.quadraticCurveTo(30, 22.2, 38.4, 25.4); ctx.quadraticCurveTo(40, 33, 38.2, bot - 1); ctx.quadraticCurveTo(30.4, bot + 1.2, 22.6, bot - 1); ctx.quadraticCurveTo(20.6, 33, 22.4, 25.6); ctx.closePath();
  ctx.fillStyle = camo(ctx); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = lg(ctx, 21, 0, 40, 0, [[0, 'rgba(255,244,220,0.2)'], [0.18, 'rgba(255,244,220,0)'], [0.6, 'rgba(10,12,28,0.05)'], [1, 'rgba(10,12,28,0.28)']]); ctx.fillRect(18, 20, 26, 30);
  // kanguru cep + etek bandı
  ctx.fillStyle = 'rgba(10,12,28,0.22)'; ctx.beginPath(); ctx.moveTo(24.4, bot - 7.2); ctx.quadraticCurveTo(30.6, bot - 9.4, 37, bot - 7.2); ctx.lineTo(38.6, bot); ctx.lineTo(22.6, bot); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#566083'; ctx.fillRect(21, bot - 2.2, 20, 3.6); ctx.fillStyle = 'rgba(255,244,220,0.22)'; ctx.fillRect(21, bot - 2.2, 20, 0.9);
  ctx.restore();
  // göğüste kırmızı desen (yazı hissi: kalın harf benzeri parçalar + nokta)
  ctx.save(); ctx.translate(31.6, 28.9); ctx.rotate(0.03);
  ctx.fillStyle = '#e0323a'; ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-5.4, -2.1, 2.2, 4.4, 0.9) : ctx.rect(-5.4, -2.1, 2.2, 4.4); ctx.fill();
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-5.4, -2.1, 4.6, 1.8, 0.9) : ctx.rect(-5.4, -2.1, 4.6, 1.8); ctx.fill();
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-1.4, -2.1, 2.1, 4.4, 0.9) : ctx.rect(-1.4, -2.1, 2.1, 4.4); ctx.fill();
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-1.4, 0.5, 5.0, 1.8, 0.9) : ctx.rect(-1.4, 0.5, 5, 1.8); ctx.fill();
  ell(ctx, 5.2, 1.4, 1.1, 1.1, '#e0323a');
  ctx.fillStyle = 'rgba(255,200,190,0.5)'; ctx.fillRect(-5.2, -2, 4, 0.7);
  ctx.restore();
  // ip uçları
  ctx.strokeStyle = '#d9dce6'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(29.2, 24.6); ctx.lineTo(28.8, 33.4); ctx.moveTo(32.2, 24.8); ctx.lineTo(32.6, 32.6); ctx.stroke();
  ell(ctx, 28.8, 33.8, 0.9, 1.1, '#aab0c4'); ell(ctx, 32.6, 33.0, 0.9, 1.1, '#aab0c4');
}

function head(ctx, o) {
  const dx = o.hx || 0, dy = o.hy || 0, tilt = o.tilt || 0;
  ctx.save(); ctx.translate(31 + dx, 21 + dy); ctx.rotate(tilt); ctx.translate(-31, -21);
  // boyun
  ctx.fillStyle = SKIN_D; ctx.fillRect(28.6, 18, 5, 6);
  // kulak (yakın değil; sol kenar)
  ell(ctx, 22.6, 14.4, 2.2, 3, lg(ctx, 0, 11, 0, 18, [[0, SKIN], [1, SKIN_D]])); ell(ctx, 22.9, 14.6, 1, 1.6, rgba('#c0705a', 0.5));
  // yüz
  ctx.fillStyle = lg(ctx, 23, 4, 40, 22, [[0, '#f6d8ad'], [0.55, SKIN], [1, '#cf9c6e']]);
  ctx.beginPath(); ctx.moveTo(23, 12.6); ctx.bezierCurveTo(22.4, 5, 28, 3.2, 31.4, 3.2); ctx.bezierCurveTo(37.4, 3.2, 40.4, 7.6, 40, 13); ctx.bezierCurveTo(39.8, 18.6, 35.4, 22.2, 31, 22.2); ctx.bezierCurveTo(26, 22.2, 23.4, 18.2, 23, 12.6); ctx.closePath(); ctx.fill();
  // yanaklar
  ctx.fillStyle = radial(ctx, 27.4, 17.4, 4.6, [[0, 'rgba(240,120,120,0.5)'], [1, 'rgba(240,120,120,0)']]); ctx.fillRect(22, 12, 11, 11);
  ctx.fillStyle = radial(ctx, 36.6, 17.8, 4.4, [[0, 'rgba(240,120,120,0.46)'], [1, 'rgba(240,120,120,0)']]); ctx.fillRect(31, 12, 11, 11);
  // burun
  ell(ctx, 37.2, 15.8, 1.4, 1.1, rgba('#b9754e', 0.55)); ell(ctx, 36.8, 15.2, 0.7, 0.5, rgba('#fff4dc', 0.4));
  // gözler
  const blink = o.blink;
  for (const [ex, ey, rx, ry, far] of [[28.8, 12.4, 2.0, 2.6, true], [35.0, 12.2, 2.2, 2.8, false]]) {
    if (blink) {
      ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ex - rx, ey + 0.4); ctx.quadraticCurveTo(ex, ey + 2.3, ex + rx, ey + 0.4); ctx.stroke();
    } else {
      ell(ctx, ex, ey, rx + 0.5, ry + 0.4, '#fbf6ee');
      ctx.save(); ctx.beginPath(); ctx.ellipse(ex, ey, rx + 0.5, ry + 0.4, 0, 0, TAU); ctx.clip();
      const ix = ex + (far ? 0.7 : 0.9) + (o.gx || 0), iy = ey + 0.3 + (o.gy || 0);
      ell(ctx, ix, iy, rx - 0.2, ry - 0.1, radial(ctx, ix, iy - 0.6, ry, [[0, '#7a4a2a'], [0.7, '#4a2c1a'], [1, '#2a170e']]));
      ell(ctx, ix + 0.2, iy + 0.1, 1.15, 1.5, '#140a06');
      ctx.fillStyle = 'rgba(40,20,10,0.35)'; ctx.fillRect(ex - 4, ey - 4, 8, 2.3);   // üst kapak gölgesi
      ctx.restore();
      ell(ctx, ex - 0.2 + (o.gx || 0), ey - 1.2, 0.95, 0.95, '#fff'); ell(ctx, ex + 1.5 + (o.gx || 0), ey + 1.1, 0.5, 0.5, rgba('#ffffff', 0.8));
      ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(ex, ey, ry + 0.4, Math.PI * 1.12, Math.PI * 1.9); ctx.stroke(); // üst kirpik
    }
  }
  // kalın koyu kaşlar
  ctx.strokeStyle = '#25150d'; ctx.lineCap = 'round';
  ctx.lineWidth = 2.1; ctx.beginPath(); ctx.moveTo(25.6, 8.6); ctx.quadraticCurveTo(28.4, 7.2, 31, 8); ctx.stroke();
  ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(32.4, 7.8); ctx.quadraticCurveTo(35.6, 6.4, 38.6, 7.8); ctx.stroke();
  // gülümseme (sağa doğru hafif yukarı çekik)
  ctx.strokeStyle = '#9c4a3a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(30.8, 19); ctx.quadraticCurveTo(34, 20.9, 37.4, 18.2); ctx.stroke();
  ctx.strokeStyle = rgba('#b9754e', 0.6); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(37.8, 17.4); ctx.quadraticCurveTo(38.6, 17.6, 38.8, 18.4); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(32.6, 19.9); ctx.quadraticCurveTo(34.4, 20.9, 36, 19.4); ctx.quadraticCurveTo(34.4, 20, 32.6, 19.9); ctx.fill();
  // saç: kısa, yana (sağa) taranmış, uçları dağınık
  ctx.fillStyle = lg(ctx, 22, 2, 40, 12, [[0, '#5a3a26'], [0.5, HAIR], [1, '#24130a']]);
  ctx.beginPath();
  ctx.moveTo(21.6, 14.6); ctx.bezierCurveTo(20.2, 5.4, 26, 1.6, 32, 1.8); ctx.bezierCurveTo(38.6, 2, 42, 6.4, 41, 11.6);
  ctx.lineTo(40.2, 9.6); ctx.quadraticCurveTo(41.8, 8.6, 41.4, 7.4);               // sağ kenar saç ucu
  ctx.quadraticCurveTo(37.4, 8.4, 34, 6.6); ctx.quadraticCurveTo(30.6, 8.6, 26.2, 9.2); // alından yana sürülmüş kakül
  ctx.quadraticCurveTo(24.6, 9.8, 24.2, 12.6); ctx.lineTo(23.4, 17.2); ctx.quadraticCurveTo(21.8, 16.4, 21.6, 14.6); ctx.closePath(); ctx.fill();
  // saç tutamları ve ışık
  ctx.strokeStyle = rgba('#8a5a3a', 0.55); ctx.lineWidth = 0.9; ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1, cx, cy] of [[24, 6.4, 33, 3.4, 27, 3.6], [26.6, 8, 38, 5.2, 31, 4.6], [30, 3.8, 40, 8, 36, 3.8]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); }
  ctx.fillStyle = HAIR; ctx.beginPath(); ctx.moveTo(41, 7.6); ctx.lineTo(43.4, 8.2); ctx.lineTo(41, 10.4); ctx.fill();               // dağınık uçlar
  ctx.beginPath(); ctx.moveTo(35, 1.8); ctx.lineTo(37.4, -0.2); ctx.lineTo(38, 2.6); ctx.fill();
  ctx.beginPath(); ctx.moveTo(27.6, 2.4); ctx.lineTo(26.4, 0.4); ctx.lineTo(30, 2); ctx.fill();
  ctx.strokeStyle = rgba('#fff0d8', 0.4); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(22.6, 12); ctx.quadraticCurveTo(22.4, 6, 28, 3.6); ctx.stroke();
  ctx.restore();
}

function bucket(ctx, x, y, rot, water) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = lg(ctx, -5, 0, 5, 0, [[0, '#93abc6'], [0.5, '#6f87a3'], [1, '#42566e']]);
  ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(5, -8); ctx.lineTo(4, 0); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
  ell(ctx, 0, -8, 5, 1.6, water ? '#6fb4e8' : '#2e3e52'); ctx.fillStyle = rgba('#ffffff', 0.35); ctx.fillRect(-4, -7, 1.2, 6);
  ctx.strokeStyle = '#4a5666'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, -8, 5.6, Math.PI, 0); ctx.stroke();
  ctx.restore();
}
function basket(ctx, x, y, produce) {
  ctx.strokeStyle = '#8a6038'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y - 6, 6, Math.PI, 0); ctx.stroke();
  if (produce) { ell(ctx, x - 2.4, y - 7.2, 2.4, 2.2, '#e0453a'); ell(ctx, x + 1.2, y - 7.6, 2.4, 2.2, '#f2b84b'); ell(ctx, x + 3.2, y - 6.8, 2, 1.9, '#7ab04a'); }
  ctx.fillStyle = lg(ctx, 0, y - 7, 0, y, [[0, '#d9b27a'], [1, '#9a6a3c']]);
  ctx.beginPath(); ctx.moveTo(x - 6.4, y - 7); ctx.lineTo(x + 6.4, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgba('#5d3d22', 0.45); ctx.lineWidth = 0.7; for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 6, y - 7 + i * 2.4); ctx.lineTo(x + 6, y - 7 + i * 2.4); ctx.stroke(); }
  ctx.fillStyle = rgba('#fff0d0', 0.5); ctx.fillRect(x - 6.4, y - 7.4, 12.8, 1);
}

/** P: {hipY, lean, legs:[[fx,fy],[fx,fy]] (uzak, yakın), armF:[x,y], armN:[x,y] (lean çerçevesinde el), sit, item, head:{...}} */
function drawKid(ctx, P) {
  const hip = P.hipY, lean = P.lean || 0;
  // uzak kol arkada; bacaklar
  if (!P.sit) leg(ctx, 28.2, hip, P.legs[0][0], P.legs[0][1], 0, true);
  leg(ctx, 31.2, hip, P.legs[1][0], P.legs[1][1], P.sit ? 0.15 : 0, false);
  ctx.save(); ctx.translate(30, hip); ctx.rotate(lean); ctx.translate(-30, -hip);
  arm(ctx, 38.4, 26.4, P.armF[0], P.armF[1], true);
  if (P.item === 'bucketBack') bucket(ctx, P.armF[0], P.armF[1] + 8, 0, false);
  torso(ctx, hip, P.sit);
  head(ctx, P.head || {});
  if (P.item === 'bucket') bucket(ctx, P.itemAt[0], P.itemAt[1], P.itemRot || 0, P.water);
  if (P.item === 'basket') basket(ctx, P.itemAt[0], P.itemAt[1], P.produce);
  arm(ctx, 23.2, 26.6, P.armN[0], P.armN[1], false);
  ctx.restore();
}

function kidPoses() {
  const idleLegs = [[27.4, 56], [33, 56]];
  const poses = {
    idle0: { hipY: 40.4, legs: idleLegs, armF: [38.4, 38.8], armN: [23.6, 38.6], head: {} },
    idle1: { hipY: 40.4, legs: idleLegs, armF: [38.4, 38.8], armN: [23.6, 38.6], head: { blink: true } },
    bucket0: { hipY: 41, lean: 0.62, legs: [[26, 56], [33.4, 56]], armF: [39, 40], armN: [33.2, 44.4], item: 'bucket', itemAt: [33.2, 53.4], itemRot: 0, water: false, head: { hy: 0.4, gy: 0.6 } },
    bucket1: { hipY: 40.6, lean: 0.2, legs: [[27, 56], [33.6, 56]], armF: [38.6, 36.6], armN: [38.4, 40.4], item: 'bucket', itemAt: [38.4, 47.4], itemRot: -1.0, water: true, head: { gx: 0.6 } },
    basket0: { hipY: 41, lean: 0.66, legs: [[25.6, 56], [33, 56]], armF: [38.4, 42], armN: [34.4, 45], item: 'basket', itemAt: [38.6, 55.4], produce: true, head: { hy: 0.5, gy: 0.7 } },
    basket1: { hipY: 40.4, lean: 0.06, legs: [[27.4, 56], [33.2, 56]], armF: [37.8, 39], armN: [36.4, 40.6], item: 'basket', itemAt: [36.2, 46.6], produce: true, head: {} },
    ride0: { hipY: 40, sit: true, legs: [[29, 56], [35, 54]], armF: [40.6, 34], armN: [41.6, 35.4], head: {} },
    ride1: { hipY: 40, sit: true, legs: [[29, 56], [35, 54.4]], armF: [40.6, 34.6], armN: [41.8, 36.4], head: { blink: true } },
    ride2: { hipY: 40, sit: true, legs: [[29, 56], [34.4, 55.6]], armF: [40.2, 35], armN: [41.4, 37], head: { hy: -0.3, gx: 0.3 } },
  };
  for (let i = 0; i < WALK_N; i++) {
    const p = i / WALK_N * TAU, s = Math.sin(p), c = Math.cos(p);
    const a = s * 6.4, la = Math.max(0, c) * 3.6, b = -s * 6.4, lb = Math.max(0, -c) * 3.6;
    const hy = 40.6 - Math.abs(c) * 1.0 + 0.6;
    poses['walk' + i] = {
      hipY: hy, lean: 0.07, legs: [[30 + b, 56 - lb], [30.4 + a, 56 - la]],
      armF: [38.4 + s * 3.6 + 0.4, 38.4 - Math.abs(s) * 0.6], armN: [23.8 - s * 3.6, 38.4 - Math.abs(s) * 0.6], head: { hy: -Math.abs(c) * 0.3 },
    };
  }
  return poses;
}

// ------------------------------------------------------------------ EŞEK
const DKC = { body: '#8c7b6c', dark: '#5f5146', mane: '#3e342d', belly: '#b9ab9a', muzzle: '#e6dac6', hoof: '#33291f' };
function dLeg(ctx, x, top, dx, lift, fore, back, F) {
  const foot = F - lift, fx = x + dx;
  const jx = (x + fx) / 2 + (fore ? 1.8 : -2.4), jy = (top + foot) / 2 + (fore ? 0 : -1.5);
  const c = back ? '#6d5f53' : DKC.body;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = c; ctx.lineWidth = fore ? 6.6 : 7.4; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(jx, jy); ctx.stroke();
  ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(fx, foot - 1.5); ctx.stroke();
  if (!back) { ctx.strokeStyle = rgba('#fff0d8', 0.18); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 2, top + 2); ctx.lineTo(jx - 1.6, jy); ctx.stroke(); }
  ell(ctx, fx + 0.4, foot - 1.2, 3.2, 2.2, back ? '#2a2119' : DKC.hoof);
}

function drawDonkey(ctx, pose) {
  const F = 72;
  let dx0 = 0, dx1 = 0, dx2 = 0, dx3 = 0, l0 = 0, l1 = 0, l2 = 0, l3 = 0;
  if (pose[0] === 'w') {
    const p = Number(pose[1]) / 4 * TAU, A = 5.2, B = 3.8;
    dx0 = Math.sin(p) * A; l0 = Math.max(0, Math.cos(p)) * B;                    // yakın ön
    dx3 = Math.sin(p) * A; l3 = Math.max(0, Math.cos(p)) * B;                    // uzak arka (çapraz çift)
    dx1 = -Math.sin(p) * A; l1 = Math.max(0, -Math.cos(p)) * B;                  // yakın arka
    dx2 = -Math.sin(p) * A; l2 = Math.max(0, -Math.cos(p)) * B;                  // uzak ön
  }
  const eat = pose === 'eat';
  // uzak bacaklar (arkada)
  dLeg(ctx, 56, 46, dx2, l2, true, true, F); dLeg(ctx, 25, 46, dx3, l3, false, true, F);
  // gövde
  ctx.fillStyle = lg(ctx, 0, 27, 0, 52, [[0, '#a3917f'], [0.5, DKC.body], [1, '#6f6154']]);
  ctx.beginPath(); ctx.moveTo(17, 36); ctx.bezierCurveTo(16, 28, 28, 27, 40, 27.6); ctx.bezierCurveTo(50, 27.4, 60, 28, 62, 36); ctx.bezierCurveTo(63, 46, 56, 52, 42, 52); ctx.bezierCurveTo(26, 52.6, 18, 47, 17, 36); ctx.closePath(); ctx.fill();
  // karın açığı
  ctx.fillStyle = rgba(DKC.belly, 0.85); ctx.beginPath(); ctx.ellipse(40, 49.4, 17, 3.4, 0, 0, TAU); ctx.fill();
  // sırt çizgisi + omuz haçı
  ctx.strokeStyle = rgba(DKC.dark, 0.7); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(20, 31); ctx.quadraticCurveTo(40, 27.4, 60, 31); ctx.stroke();
  ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(52, 29.4); ctx.lineTo(53.2, 44); ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,215,0.22)'; ctx.beginPath(); ctx.ellipse(34, 31.6, 14, 2.4, -0.04, 0, TAU); ctx.fill();
  // boyun
  ctx.fillStyle = lg(ctx, 52, 14, 66, 34, [[0, '#a3917f'], [1, DKC.body]]);
  const hx = eat ? 80 : 72, hy = eat ? 46 : 17;
  ctx.beginPath();
  if (eat) { ctx.moveTo(50, 31); ctx.quadraticCurveTo(62, 28, 76, 38); ctx.lineTo(78, 48); ctx.quadraticCurveTo(66, 44, 56, 46); }
  else { ctx.moveTo(50, 32); ctx.quadraticCurveTo(58, 22, 63, 10); ctx.lineTo(72, 14); ctx.quadraticCurveTo(68, 30, 64, 44); }
  ctx.closePath(); ctx.fill();
  // yele (kısa, dik)
  ctx.fillStyle = DKC.mane;
  const mane = eat ? [[58, 28], [64, 28], [70, 31], [74, 35]] : [[61, 10], [58, 15], [55, 20], [52, 25], [50, 30]];
  for (const [x, y] of mane) { ctx.beginPath(); ctx.ellipse(x, y, 2.2, 3.8, eat ? -0.9 : -0.35, 0, TAU); ctx.fill(); }
  // baş
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(eat ? 1.25 : 0.62);
  ctx.fillStyle = lg(ctx, 0, -6, 0, 6, [[0, '#a3917f'], [1, '#76675a']]); ctx.beginPath(); ctx.ellipse(0, 0, 10.4, 6.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = DKC.muzzle; ctx.beginPath(); ctx.ellipse(7.6, 1.6, 5.4, 4.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.35); ctx.beginPath(); ctx.ellipse(6.4, -0.6, 3, 1.4, 0, 0, TAU); ctx.fill();
  ell(ctx, 10.6, 0.2, 1.1, 1.5, '#5a463a'); ell(ctx, 6.4, 4.6, 2.6, 1, rgba('#7a5a4a', 0.5));
  ctx.restore();
  // göz (başın dönük çerçevesi dışında, sahne koordinatında)
  const ex = eat ? hx - 3.4 : hx - 2.4, ey = eat ? hy - 4 : hy - 3.8;
  ell(ctx, ex, ey, 1.9, 1.9, '#2a1a12'); ell(ctx, ex - 0.5, ey - 0.6, 0.7, 0.7, '#fff');
  ctx.strokeStyle = rgba('#e6dac6', 0.8); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(ex, ey, 2.7, 0, TAU); ctx.stroke();
  // kekül
  ctx.fillStyle = DKC.mane; ctx.beginPath(); ctx.ellipse(eat ? hx - 6 : hx - 4.4, eat ? hy - 6.8 : hy - 6.4, 2, 3.2, 0.4, 0, TAU); ctx.fill();
  // heybe: örtü + sepet çantalar
  ctx.fillStyle = lg(ctx, 0, 26, 0, 36, [[0, '#d0543a'], [1, '#9a3a2a']]); ctx.beginPath(); ctx.moveTo(26, 29.4); ctx.quadraticCurveTo(40, 25.4, 52, 29.2); ctx.lineTo(53, 36); ctx.quadraticCurveTo(40, 33.4, 26, 36); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f2c94c'; ctx.fillRect(26.6, 32.4, 26, 1.4); ctx.fillStyle = '#2f6f8f'; ctx.fillRect(27, 34, 25, 1);
  ctx.fillStyle = lg(ctx, 0, 34, 0, 56, [[0, '#c4623f'], [1, '#8a3a26']]);
  ctx.beginPath(); ctx.moveTo(29, 36); ctx.lineTo(51, 36); ctx.quadraticCurveTo(53, 48, 49, 55); ctx.lineTo(31, 55); ctx.quadraticCurveTo(27, 48, 29, 36); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.moveTo(29, 36); ctx.lineTo(51, 36); ctx.quadraticCurveTo(53, 48, 49, 55); ctx.lineTo(31, 55); ctx.quadraticCurveTo(27, 48, 29, 36); ctx.clip();
  for (let y = 40; y < 56; y += 5) { ctx.fillStyle = y % 10 === 0 ? '#f2c94c' : '#2f6f8f'; ctx.fillRect(26, y, 28, 1.6); }
  ctx.fillStyle = rgba('#fff0d0', 0.2); ctx.fillRect(29, 36, 2.4, 20);
  ctx.restore();
  ctx.fillStyle = '#6a3a22'; rrect2(ctx, 31, 36, 18, 6, 2); ell(ctx, 40, 42, 1.6, 1.6, '#e8c870');
  ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(34, 29.5); ctx.lineTo(34, 36); ctx.moveTo(47, 29.5); ctx.lineTo(47, 36); ctx.stroke();
  // yakın bacaklar (önde)
  dLeg(ctx, 58, 46, dx0, l0, true, false, F); dLeg(ctx, 23, 46, dx1, l1, false, false, F);
  // sağrı üstünde kuyruk bağlantı noktası gölgesi
  ctx.fillStyle = rgba(DKC.dark, 0.4); ctx.beginPath(); ctx.ellipse(18.4, 34, 2.4, 4, 0, 0, TAU); ctx.fill();
}
function rrect2(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fill(); }

// ------------------------------------------------------------------ BALONLAR
function drawBubble(ctx, kind) {
  ctx.fillStyle = 'rgba(30,20,10,0.22)'; ctx.beginPath(); ctx.ellipse(14, 14.8, 12.4, 12.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fbf4e2'; ctx.beginPath(); ctx.moveTo(10.4, 22); ctx.lineTo(14, 29.6); ctx.lineTo(17.6, 22); ctx.fill();
  ell(ctx, 14, 13.6, 12.4, 12.4, lg(ctx, 0, 1, 0, 26, [['0', '#fffaf0'], ['1', '#efe2c4']]));
  if (kind === 'water') { ctx.fillStyle = '#4f9bd8'; ctx.beginPath(); ctx.moveTo(14, 5); ctx.bezierCurveTo(8, 12.4, 8.4, 19.8, 14, 19.8); ctx.bezierCurveTo(19.6, 19.8, 20, 12.4, 14, 5); ctx.fill(); ell(ctx, 11.8, 14, 1.4, 2.8, rgba('#ffffff', 0.7), 0.3); }
  else if (kind === 'basket') { basket(ctx, 14, 21, true); }
  else if (kind === 'feed') {
    ctx.strokeStyle = '#d9a63c'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(14 + i * 1.2, 20); ctx.lineTo(14 + i * 3, 7 + Math.abs(i) * 0.8); ctx.stroke(); }
    ctx.fillStyle = '#8a5a34'; ctx.fillRect(9.6, 14.4, 8.8, 2.4);
  } else {
    ctx.fillStyle = '#7a8594'; ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r = i % 2 ? 6 : 8; ctx.lineTo(14 + Math.cos(a) * r, 13.6 + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
    ell(ctx, 14, 13.6, 3.2, 3.2, '#fbf4e2'); ell(ctx, 12, 11, 2, 1.2, rgba('#ffffff', 0.4), -0.6);
  }
}

function genEars(scene) {
  if (scene.textures.exists('dk_ear')) return;
  const { canvas, ctx } = makeCanvas(20, 44); ctx.scale(SS, SS);
  ctx.fillStyle = lg(ctx, 0, 0, 0, 21, [[0, '#6d5f53'], [1, DKC.body]]); ctx.beginPath(); ctx.moveTo(3, 21); ctx.bezierCurveTo(0.4, 12, 3.4, 4, 5.4, 0.4); ctx.bezierCurveTo(7.8, 4, 10, 12, 8, 21); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9b3a0'; ctx.beginPath(); ctx.moveTo(4.2, 19); ctx.bezierCurveTo(2.8, 12, 4.6, 6.4, 5.5, 3.6); ctx.bezierCurveTo(6.6, 7, 7.6, 12, 6.8, 19); ctx.closePath(); ctx.fill();
  ctx.fillStyle = DKC.mane; ctx.beginPath(); ctx.moveTo(5.4, 0.4); ctx.bezierCurveTo(6.8, 1.6, 7.4, 3.4, 7.8, 5.4); ctx.lineTo(3.8, 5.4); ctx.bezierCurveTo(4, 3, 4.6, 1.6, 5.4, 0.4); ctx.fill();
  register(scene, 'dk_ear', canvas);
  const t = makeCanvas(20, 56); t.ctx.scale(SS, SS); const c = t.ctx;
  c.strokeStyle = DKC.body; c.lineWidth = 2.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(5, 1); c.quadraticCurveTo(3, 10, 4.6, 17); c.stroke();
  c.fillStyle = lg(c, 0, 14, 0, 27, [[0, '#4a3f38'], [1, '#2a211c']]); c.beginPath(); c.moveTo(4.4, 14); c.bezierCurveTo(0, 20, 2, 26.6, 4.6, 27.4); c.bezierCurveTo(8, 26.6, 9, 20, 4.4, 14); c.fill();
  register(scene, 'dk_tail', t.canvas);
}

export function genWorker(scene) {
  if (scene.textures.exists(kidKey('idle0'))) return;
  const poses = kidPoses();
  const names = Object.keys(poses);
  for (const n of names) {
    const { canvas, ctx } = makeCanvas(KID.w, KID.h); ctx.scale(SS, SS);
    drawKid(ctx, poses[n]);
    register(scene, kidKey(n), canvas, { sit: !!poses[n].sit });
  }
  for (const n of DK_FRAMES) {
    const { canvas, ctx } = makeCanvas(DK.w, DK.h); ctx.scale(SS, SS);
    drawDonkey(ctx, n);
    register(scene, dkKey(n), canvas);
  }
  genEars(scene);
  for (const b of BUBBLES) {
    const { canvas, ctx } = makeCanvas(28 * SS, 32 * SS); ctx.scale(SS, SS);
    drawBubble(ctx, b);
    register(scene, bubbleKey(b), canvas);
  }
}
