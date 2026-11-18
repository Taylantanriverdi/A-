// Hayvan dokuları (PLAN §10 "Görsel"): tavuk, inek, koyun, keçi. Açılışta BİR KEZ, poz başına ayrı doku:
// stand / w1 / w2 (yürüyüş adımları) / graze (otlama-gagalama). Hasta varyantı (`_s`) soluk tonla PİŞİRİLİR (tint yok,
// Canvas renderer'da da aynı). Sağa bakar; sola gitmek için flipX. Kuyruk ayrı dokudur (inek/keçi) ve sallanır.
import { makeCanvas, register, shade, rgba } from './canvas.js';
import { ANIMALS } from '../../data/animals.js';

const TAU = Math.PI * 2;
export const POSES = ['stand', 'w1', 'w2', 'graze'];
export const animKey = (type, pose, sick) => `an_${type}_${pose}${sick ? '_s' : ''}`;
// w,h doku boyutu; (ox,oy) ayak noktası; tail: kuyruğun ayağa göre bağlantı noktası ve dokusu; gölge genişliği shw
export const AN = {
  chicken: { w: 56, h: 56, ox: 28, oy: 52, shw: 26, tail: null },
  sheep: { w: 96, h: 80, ox: 48, oy: 72, shw: 56, tail: null },
  goat: { w: 84, h: 84, ox: 42, oy: 76, shw: 46, tail: { key: 'an_goat_tail', x: -23, y: -38, w: 12, h: 16 } },
  cow: { w: 128, h: 100, ox: 64, oy: 92, shw: 84, tail: { key: 'an_cow_tail', x: -41, y: -48, w: 14, h: 44 } },
};

const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
function blob(ctx, x, y, rx, ry, c, rot = 0) {
  const g = ctx.createLinearGradient(x, y - ry, x, y + ry);
  g.addColorStop(0, shade(c, 0.16)); g.addColorStop(0.55, c); g.addColorStop(1, shade(c, -0.26));
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.translate(-x, -y);
  ell(ctx, x, y, rx, ry, g); ctx.restore();
}
function rim(ctx, x, y, rx, ry, rot = 0, a = 0.5) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = rgba('#fff4dc', a); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(0, 0, rx - 0.8, ry - 0.8, 0, Math.PI * 1.05, Math.PI * 1.62); ctx.stroke(); ctx.restore();
}
function leg(ctx, x, y0, foot, dx, lift, w, c, hoof) {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + dx, foot - lift); ctx.stroke();
  ctx.fillStyle = hoof; ctx.beginPath(); ctx.ellipse(x + dx, foot - lift - 0.5, w * 0.52, w * 0.4, 0, 0, TAU); ctx.fill();
}
// yürüyüş: poz w1 → (A bacakları ileri+yerde, B geride+hafif havada); w2 tersi
const step = (pose, grp) => (pose === 'w1' ? (grp ? [-4, 0] : [4, 3]) : pose === 'w2' ? (grp ? [4, 3] : [-4, 0]) : [0, 0]);

function drawChicken(ctx, pose, A) {
  const F = 52, c = A.color, graze = pose === 'graze';
  const lc = '#d98a2e';
  for (const [x, g] of [[24, 0], [30, 1]]) { const [dx, lf] = step(pose, g); ctx.strokeStyle = lc; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, 44); ctx.lineTo(x + dx * 0.6, F - lf * 0.6); ctx.lineTo(x + dx * 0.6 + 3, F - lf * 0.6); ctx.stroke(); }
  const tilt = graze ? 0.32 : 0;
  ctx.save(); ctx.translate(28, 40); ctx.rotate(tilt); ctx.translate(-28, -40);
  // kuyruk tüyleri
  for (const [a, col] of [[-0.9, '#c9b9a0'], [-0.55, A.color], [-0.2, '#e8dcc6']]) { ctx.save(); ctx.translate(15, 36); ctx.rotate(a); blob(ctx, -6, 0, 11, 4, shade(col, -0.05)); ctx.restore(); }
  blob(ctx, 27, 37, 14, 10.5, c, 0.1); rim(ctx, 27, 37, 14, 10.5, 0.1, 0.7);
  blob(ctx, 25, 38, 8, 5.5, shade(c, -0.12), 0.25); // kanat
  ctx.restore();
  const hx = graze ? 41 : 39, hy = graze ? 41 : 26;
  ctx.strokeStyle = c; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(35, 34); ctx.lineTo(hx, hy + 2); ctx.stroke();
  blob(ctx, hx, hy, 6.4, 6, c);
  // ibik
  ctx.fillStyle = A.accent; for (const [dx, dy, r] of [[-2.6, -5.4, 2.4], [0.4, -6.4, 2.8], [3, -5, 2.2]]) { ctx.beginPath(); ctx.arc(hx + dx, hy + dy, r, 0, TAU); ctx.fill(); }
  // gaga + sakal + göz
  ctx.fillStyle = '#e8a030'; ctx.beginPath(); if (graze) { ctx.moveTo(hx + 2, hy + 3); ctx.lineTo(hx + 4, hy + 10); ctx.lineTo(hx + 7, hy + 3); } else { ctx.moveTo(hx + 5, hy - 1.6); ctx.lineTo(hx + 11, hy + 1); ctx.lineTo(hx + 5, hy + 3); } ctx.fill();
  ell(ctx, graze ? hx - 1 : hx + 3, hy + 5.4, 1.8, 2.6, A.accent);
  ell(ctx, hx + 1.6, hy - 1, 1.2, 1.2, '#1a1410'); ell(ctx, hx + 1.9, hy - 1.4, 0.4, 0.4, '#fff');
}

function drawCow(ctx, pose, A) {
  const F = 92, c = A.color, spot = A.accent, graze = pose === 'graze';
  // uzak bacaklar (koyu)
  const dark = shade(c, -0.3);
  for (const [x, g] of [[36, 1], [86, 0]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 62, F, dx, lf, 8, dark, '#2a2018'); }
  // gövde
  blob(ctx, 62, 52, 40, 22, c);
  // benekler (gövde içine kırpılı)
  ctx.save(); ctx.beginPath(); ctx.ellipse(62, 52, 40, 22, 0, 0, TAU); ctx.clip();
  ctx.fillStyle = spot;
  ctx.beginPath(); ctx.moveTo(34, 36); ctx.bezierCurveTo(44, 28, 54, 34, 52, 46); ctx.bezierCurveTo(46, 54, 34, 50, 34, 36); ctx.fill();
  ctx.beginPath(); ctx.moveTo(66, 58); ctx.bezierCurveTo(74, 48, 90, 54, 86, 66); ctx.bezierCurveTo(78, 74, 66, 70, 66, 58); ctx.fill();
  ctx.beginPath(); ctx.moveTo(60, 30); ctx.bezierCurveTo(68, 26, 76, 32, 70, 38); ctx.bezierCurveTo(64, 40, 58, 36, 60, 30); ctx.fill();
  const sh = ctx.createLinearGradient(0, 36, 0, 74); sh.addColorStop(0, 'rgba(255,255,255,0.14)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(30,20,20,0.3)'); ctx.fillStyle = sh; ctx.fillRect(20, 30, 90, 46);
  ctx.restore();
  rim(ctx, 62, 52, 40, 22, 0, 0.7);
  // meme
  ell(ctx, 48, 71, 7, 4.6, '#e7a3a0'); ell(ctx, 46, 74, 1.6, 2.2, '#cf8582'); ell(ctx, 52, 74, 1.6, 2.2, '#cf8582');
  // yakın bacaklar
  for (const [x, g] of [[44, 0], [78, 1]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 64, F, dx, lf, 9, c, '#2a2018'); ctx.fillStyle = rgba('#fff4dc', 0.3); ctx.fillRect(x - 4.4 + dx, 70, 1.4, 12); }
  // boyun + baş
  const hx = graze ? 109 : 106, hy = graze ? 78 : 50;
  ctx.strokeStyle = shade(c, -0.05); ctx.lineWidth = 17; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(90, 46); ctx.lineTo(hx - 6, hy - 2); ctx.stroke();
  blob(ctx, hx, hy, 13.5, 11.5, c, graze ? 0.9 : 0.15);
  ell(ctx, graze ? hx + 6 : hx + 8, graze ? hy + 8 : hy + 5, 8, 6.6, '#e9aaa4', graze ? 0.9 : 0.15);
  ell(ctx, graze ? hx + 8 : hx + 10.5, graze ? hy + 9 : hy + 5, 1.2, 1.5, '#a85f5c');
  ell(ctx, hx - 1, hy - 4, 5, 3, spot, 0.3); // göz çevresi beneği
  ell(ctx, hx + 2.2, hy - 3, 1.6, 1.6, '#1a1410');
  // kulak ve boynuz
  ell(ctx, hx - 9, hy - 6, 6, 3, shade(c, -0.1), -0.5); ell(ctx, hx - 9, hy - 5, 3.4, 1.6, '#e9aaa4', -0.5);
  ctx.strokeStyle = '#f0e6cf'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx - 3, hy - 9); ctx.quadraticCurveTo(hx - 4, hy - 16, hx + 1, hy - 16); ctx.stroke();
}

function drawSheep(ctx, pose, A) {
  const F = 72, wool = A.color, dark = A.accent, graze = pose === 'graze';
  for (const [x, g] of [[34, 1], [62, 0]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 54, F, dx * 0.8, lf, 5, shade(dark, -0.1), '#16110f'); }
  // baş (yünün önünde değil, arkasında kalacak şekilde önce çiz) — otlarken aşağıda
  const hx = graze ? 79 : 77, hy = graze ? 62 : 46;
  // yün bulutu
  const puffs = [[30, 46, 17], [46, 38, 19], [62, 44, 17], [40, 54, 17], [56, 54, 16], [24, 54, 11], [68, 52, 11], [46, 48, 18]];
  for (const [x, y, r] of puffs) { const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 1, x, y, r); g.addColorStop(0, shade(wool, 0.08)); g.addColorStop(0.7, wool); g.addColorStop(1, shade(wool, -0.2)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  for (const [x, y] of [[30, 38], [46, 28], [60, 34]]) { ctx.fillStyle = rgba('#fff', 0.5); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill(); }
  rim(ctx, 46, 44, 26, 18, 0, 0.5);
  for (const [x, g] of [[40, 0], [68, 1]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 58, F, dx * 0.8, lf, 5.4, dark, '#16110f'); }
  // kafa
  ctx.strokeStyle = dark; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(66, 48); ctx.lineTo(hx - 4, hy); ctx.stroke();
  blob(ctx, hx, hy, 9.5, 8.4, dark, graze ? 0.8 : 0.1);
  ell(ctx, hx - 5, hy - 5, 6, 2.8, shade(dark, 0.05), -0.5); // kulak
  ell(ctx, hx + 2, hy - 2, 1.5, 1.5, '#e8e0d0'); ell(ctx, graze ? hx + 7 : hx + 8, graze ? hy + 5 : hy + 3, 1.4, 1, '#0e0a08');
  ell(ctx, hx - 3, hy - 8, 7, 5, wool); ell(ctx, hx - 4, hy - 9, 4, 2.6, shade(wool, 0.1)); // alın yünü
}

function drawGoat(ctx, pose, A) {
  const F = 76, c = A.color, acc = A.accent, graze = pose === 'graze';
  const dark = shade(c, -0.25);
  for (const [x, g] of [[24, 1], [52, 0]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 54, F, dx, lf, 4.6, dark, '#241a14'); }
  blob(ctx, 38, 48, 25, 14.5, c, 0.03); rim(ctx, 38, 48, 25, 14.5, 0.03, 0.6);
  ctx.save(); ctx.beginPath(); ctx.ellipse(38, 48, 25, 14.5, 0.03, 0, TAU); ctx.clip(); ctx.fillStyle = rgba(acc, 0.28); ctx.fillRect(10, 52, 56, 14); ctx.fillStyle = rgba(acc, 0.3); ctx.beginPath(); ctx.ellipse(26, 46, 8, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
  for (const [x, g] of [[30, 0], [58, 1]]) { const [dx, lf] = step(pose, g); leg(ctx, x, 56, F, dx, lf, 5, c, '#241a14'); }
  const hx = graze ? 66 : 63, hy = graze ? 60 : 34;
  ctx.strokeStyle = shade(c, -0.04); ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(54, 42); ctx.lineTo(hx - 3, hy + 2); ctx.stroke();
  blob(ctx, hx, hy, 8.6, 6.8, c, graze ? 0.9 : 0.35);
  ell(ctx, graze ? hx + 5 : hx + 6.5, graze ? hy + 5 : hy + 3.8, 4.4, 3.4, shade(c, 0.1), graze ? 0.9 : 0.35);
  ell(ctx, hx + 1.6, hy - 2, 1.4, 1.4, '#1a1410');
  // sakal
  ctx.fillStyle = shade(c, -0.1); ctx.beginPath(); ctx.moveTo(hx + 4, hy + 6); ctx.lineTo(hx + 7, hy + 14); ctx.lineTo(hx + 1, hy + 8); ctx.fill();
  // kulak + boynuz
  ell(ctx, hx - 7, hy - 2, 6.4, 2.6, shade(c, -0.08), 0.55);
  ctx.strokeStyle = acc; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(hx - 2, hy - 6); ctx.quadraticCurveTo(hx - 6, hy - 14, hx - 12, hy - 11); ctx.stroke();
}

const DRAW = { chicken: drawChicken, cow: drawCow, sheep: drawSheep, goat: drawGoat };

/** Hasta tonu: doygunluğu düşür, açıklaştır, hafif yeşilimsi (piksel işlemi, yalnızca açılışta). */
function sicken(canvas) {
  const ctx = canvas.getContext('2d'); const im = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = Math.min(255, (d[i] * 0.35 + l * 0.65) * 0.96 + 26); d[i + 1] = Math.min(255, (d[i + 1] * 0.35 + l * 0.65) + 34); d[i + 2] = Math.min(255, (d[i + 2] * 0.35 + l * 0.65) * 0.9 + 22);
  }
  ctx.putImageData(im, 0, 0);
}

export function genAnimals(scene) {
  for (const type of Object.keys(AN)) {
    const L = AN[type], A = ANIMALS[type]; if (!A) continue;
    for (const sick of [false, true]) for (const pose of POSES) {
      const key = animKey(type, pose, sick); if (scene.textures.exists(key)) continue;
      const { canvas, ctx } = makeCanvas(L.w, L.h);
      DRAW[type](ctx, pose, A);
      if (sick) sicken(canvas);
      register(scene, key, canvas);
    }
  }
  // kuyruklar (pivot: üst uç)
  if (!scene.textures.exists('an_cow_tail')) {
    const T = AN.cow.tail; const { canvas, ctx } = makeCanvas(T.w, T.h); const A = ANIMALS.cow;
    ctx.strokeStyle = shade(A.color, -0.15); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(5, 2); ctx.quadraticCurveTo(3, 18, 6, 34); ctx.stroke();
    ell(ctx, 6, 38, 3.8, 6, A.accent);
    register(scene, 'an_cow_tail', canvas);
  }
  if (!scene.textures.exists('an_goat_tail')) {
    const T = AN.goat.tail; const { canvas, ctx } = makeCanvas(T.w, T.h); const A = ANIMALS.goat;
    ctx.fillStyle = shade(A.color, -0.1); ctx.beginPath(); ctx.moveTo(2, 2); ctx.quadraticCurveTo(10, 4, 8, 14); ctx.quadraticCurveTo(4, 8, 2, 2); ctx.fill();
    register(scene, 'an_goat_tail', canvas);
  }
}
