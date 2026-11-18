// Dekor dokuları: çiftlik evi (+gece pencere ışığı), ağaçlar (gövde + mevsimlik tepe), çalılar, çit, kuyu, fener.
// Her gölge düşüren doku için `${key}__sh` (yumuşak) ve `${key}__shLo` (düşük kalite) silüet gölgesi üretilir.
import { makeCanvas, register, makeShadowCanvas, shade, rgba, radial, softenCanvas } from './canvas.js';
import { mulberry32, TileNoise } from './noise.js';
import { SEASON_GRADE, WORLD } from '../../data/palette.js';
import { SEASONS } from '../../core/constants.js';

/** Gölge varyantlarını üretir. foot: kaynak dokuda ayak (taban orta) noktası. */
export function registerShadow(scene, key, src, footX, footY) {
  for (const [suffix, blur] of [['__sh', 5], ['__shLo', 2]]) {
    const k = key + suffix; if (scene.textures.exists(k)) continue;
    const c = makeShadowCanvas(src, footX, footY, 0.5, blur);
    register(scene, k, c, c.__meta);
  }
}

function withShadow(scene, key, canvas, footX, footY) {
  register(scene, key, canvas, { footX, footY, w: canvas.width, h: canvas.height });
  registerShadow(scene, key, canvas, footX, footY);
}

// ------------------------------------------------------------------ ev
function house(scene) {
  const key = 'prop_house'; if (scene.textures.exists(key)) return;
  const W = 300, H = 270; const { canvas, ctx } = makeCanvas(W, H); const n = new TileNoise(3, 32, 32); const r = mulberry32(9);
  const foot = 262;
  // temel taşları
  ctx.fillStyle = '#8c8378'; ctx.beginPath(); ctx.roundRect(38, 236, 224, 28, 6); ctx.fill();
  for (let i = 0; i < 26; i++) { ctx.fillStyle = rgba(i % 2 ? '#b4ab9e' : '#6f675e', 0.55); ctx.beginPath(); ctx.ellipse(44 + (i % 13) * 17 + (i > 12 ? 8 : 0), 244 + (i > 12 ? 10 : 0), 8, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  // duvar
  const wg = ctx.createLinearGradient(44, 140, 256, 244); wg.addColorStop(0, '#f4e7cc'); wg.addColorStop(1, '#d9c39c');
  ctx.fillStyle = wg; ctx.fillRect(44, 138, 212, 104);
  const img = ctx.getImageData(44, 138, 212, 104); const d = img.data;
  for (let y = 0; y < 104; y++) for (let x = 0; x < 212; x++) { const k = (y * 212 + x) * 4; const v = 0.94 + n.fbm(x / 212, y / 104, 3) * 0.12; d[k] *= v; d[k + 1] *= v; d[k + 2] *= v; }
  ctx.putImageData(img, 44, 138);
  // ahşap kirişler
  const beam = (x, y, w, h) => { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#9c6a45'); g.addColorStop(1, '#6e4529'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); };
  beam(44, 138, 10, 104); beam(246, 138, 10, 104); beam(44, 196, 212, 6); beam(146, 138, 8, 58);
  // saçak gölgesi
  const eg = ctx.createLinearGradient(0, 138, 0, 170); eg.addColorStop(0, 'rgba(40,24,30,0.55)'); eg.addColorStop(1, 'rgba(40,24,30,0)');
  ctx.fillStyle = eg; ctx.fillRect(44, 138, 212, 32);
  // pencereler
  const win = (x, y, w, h) => {
    ctx.fillStyle = '#f3ead8'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    const gg = ctx.createLinearGradient(x, y, x + w, y + h); gg.addColorStop(0, '#41577e'); gg.addColorStop(0.55, '#24324f'); gg.addColorStop(1, '#1b2338');
    ctx.fillStyle = gg; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.moveTo(x + 4, y + h); ctx.lineTo(x + w * 0.45, y); ctx.lineTo(x + w * 0.62, y); ctx.lineTo(x + 12, y + h); ctx.fill();
    ctx.fillStyle = '#f3ead8'; ctx.fillRect(x + w / 2 - 1.5, y, 3, h); ctx.fillRect(x, y + h / 2 - 1.5, w, 3);
    // çiçek kutusu
    ctx.fillStyle = '#7a4b2e'; ctx.fillRect(x - 6, y + h + 4, w + 12, 9);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = ['#ff6f7d', '#ffd166', '#ff9fb2'][i % 3]; ctx.beginPath(); ctx.arc(x - 2 + i * (w + 4) / 6, y + h + 2, 3.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#4f8a3a'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 2 + i * w / 5, y + h + 5, 3, 0, Math.PI * 2); ctx.fill(); }
  };
  win(72, 160, 44, 30); win(184, 160, 44, 30);
  // kapı
  ctx.fillStyle = '#5c3a24'; ctx.beginPath(); ctx.roundRect(130, 196, 40, 48, [14, 14, 0, 0]); ctx.fill();
  const dg = ctx.createLinearGradient(134, 0, 166, 0); dg.addColorStop(0, '#9a6440'); dg.addColorStop(1, '#6e4329');
  ctx.fillStyle = dg; ctx.beginPath(); ctx.roundRect(134, 200, 32, 44, [12, 12, 0, 0]); ctx.fill();
  ctx.fillStyle = '#2a3550'; ctx.beginPath(); ctx.roundRect(142, 206, 16, 10, [6, 6, 0, 0]); ctx.fill();
  ctx.fillStyle = '#e8c26a'; ctx.beginPath(); ctx.arc(160, 224, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9a9086'; ctx.fillRect(126, 244, 48, 6);
  // çatı (yukarıdan-önden görünen eğik yüzey)
  ctx.save();
  ctx.beginPath(); ctx.moveTo(24, 154); ctx.lineTo(60, 58); ctx.lineTo(240, 58); ctx.lineTo(276, 154); ctx.closePath(); ctx.clip();
  const rg = ctx.createLinearGradient(0, 58, 0, 154); rg.addColorStop(0, '#c4614b'); rg.addColorStop(0.6, '#a8463a'); rg.addColorStop(1, '#86352d');
  ctx.fillStyle = rg; ctx.fillRect(0, 50, W, 110);
  for (let row = 0; row < 9; row++) {
    const y = 64 + row * 10.5; ctx.fillStyle = 'rgba(70,20,20,0.35)'; ctx.fillRect(0, y + 7, W, 2.5);
    for (let x = (row % 2) * 9; x < W; x += 18) { ctx.fillStyle = rgba('#ffd2b0', 0.06 + r() * 0.08); ctx.fillRect(x, y, 2, 8); ctx.fillStyle = 'rgba(60,15,15,0.18)'; ctx.fillRect(x + 15, y, 2, 8); }
  }
  // sol yüzde güneş vurgusu
  const sg = ctx.createLinearGradient(24, 0, 276, 0); sg.addColorStop(0, 'rgba(255,220,180,0.18)'); sg.addColorStop(0.5, 'rgba(255,220,180,0)'); sg.addColorStop(1, 'rgba(30,10,20,0.15)');
  ctx.fillStyle = sg; ctx.fillRect(0, 50, W, 110);
  ctx.restore();
  // mahya ve saçak kenarı
  ctx.fillStyle = '#7a2f28'; ctx.beginPath(); ctx.roundRect(56, 52, 188, 9, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,170,0.35)'; ctx.fillRect(60, 53, 180, 2);
  ctx.fillStyle = '#6a2924'; ctx.fillRect(22, 152, 256, 6);
  // baca
  const cg = ctx.createLinearGradient(196, 0, 224, 0); cg.addColorStop(0, '#b0624a'); cg.addColorStop(1, '#7c3b2c');
  ctx.fillStyle = cg; ctx.fillRect(196, 26, 26, 52);
  ctx.fillStyle = '#5e2c22'; ctx.fillRect(192, 22, 34, 8);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(60,20,15,0.35)'; ctx.fillRect(196, 36 + i * 9, 26, 1.5); }
  withShadow(scene, key, canvas, 150, foot);

  // gece pencere ışığı (ADD katmanı için) — aynı boyut, sadece camlar
  const { canvas: gc, ctx: g } = makeCanvas(W, H);
  const glowWin = (x, y, w, h) => {
    const gg = g.createLinearGradient(x, y, x, y + h); gg.addColorStop(0, '#ffe2a0'); gg.addColorStop(1, '#ffb45a');
    g.fillStyle = gg; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(80,40,10,0.6)'; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillRect(x, y + h / 2 - 1.5, w, 3);
  };
  glowWin(72, 160, 44, 30); glowWin(184, 160, 44, 30);
  g.fillStyle = '#ffc870'; g.beginPath(); g.roundRect(142, 206, 16, 10, [6, 6, 0, 0]); g.fill();
  const { canvas: bc, ctx: b } = makeCanvas(W, H); b.drawImage(gc, 0, 0); softenCanvas(bc, 7);
  g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 0.55; g.drawImage(bc, 0, 0);
  register(scene, 'prop_house_glow', gc);
}

// ------------------------------------------------------------------ ağaçlar
export const TREE_VARIANTS = [
  { cw: 200, ch: 176, trunkH: 92, trunkW: 26, shape: 'round' },   // meşe
  { cw: 84, ch: 214, trunkH: 46, trunkW: 14, shape: 'tall' },     // kavak
  { cw: 146, ch: 124, trunkH: 62, trunkW: 18, shape: 'fruit' },   // meyve ağacı
];

function canopyClusters(v, seed) {
  const r = mulberry32(seed); const out = [];
  const { cw, ch, shape } = v; const cx = cw / 2;
  const count = shape === 'tall' ? 26 : shape === 'round' ? 34 : 24;
  for (let i = 0; i < count; i++) {
    let x, y, rad;
    if (shape === 'tall') { const t = r(); y = ch - 18 - t * (ch - 40); const half = Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08)) * (cw * 0.34); x = cx + (r() - 0.5) * 2 * half; rad = 12 + r() * 10; }
    else { const a = r() * Math.PI * 2, rr = Math.sqrt(r()); x = cx + Math.cos(a) * rr * cw * 0.34; y = ch * 0.5 + Math.sin(a) * rr * ch * 0.3 - 4; rad = (shape === 'round' ? 24 : 18) + r() * 16; }
    out.push([x, y, rad]);
  }
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

function drawCanopy(ctx, v, clusters, pal, seed, fruit) {
  const [c0, c1, c2] = pal; const r = mulberry32(seed + 1); const dark = shade(c0, -0.42), deep = shade(c0, -0.6);
  for (const [x, y, rad] of clusters) { ctx.fillStyle = deep; ctx.beginPath(); ctx.arc(x + 2, y + 6, rad, 0, Math.PI * 2); ctx.fill(); }
  for (const [x, y, rad] of clusters) {
    const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.45, rad * 0.1, x, y, rad * 1.05);
    g.addColorStop(0, c2); g.addColorStop(0.45, c1); g.addColorStop(0.85, c0); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  // yaprak dokusu
  for (let i = 0; i < 520; i++) {
    const [x, y, rad] = clusters[Math.floor(r() * clusters.length)]; const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad * 0.95;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; const up = Math.sin(a) < 0 && Math.cos(a) < 0.3;
    ctx.fillStyle = up ? rgba(c2, 0.4) : rgba(c0, 0.35);
    ctx.beginPath(); ctx.ellipse(px, py, 3.2, 2.0, r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // alt kısma ortam kapanması
  const g = ctx.createLinearGradient(0, v.ch * 0.45, 0, v.ch); g.addColorStop(0, 'rgba(10,20,10,0)'); g.addColorStop(1, 'rgba(10,20,10,0.35)');
  ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, v.cw, v.ch); ctx.globalCompositeOperation = 'source-over';
  if (fruit) for (let i = 0; i < 16; i++) { const [x, y, rad] = clusters[Math.floor(r() * clusters.length)]; const px = x + (r() - 0.5) * rad, py = y + (r() - 0.3) * rad * 0.8; ctx.fillStyle = fruit; ctx.beginPath(); ctx.arc(px, py, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(px - 1, py - 1, 1.1, 0, Math.PI * 2); ctx.fill(); }
}

function drawTrunk(ctx, v, w, h) {
  const cx = w / 2, bot = h - 4, top = 6; const tw = v.trunkW;
  const g = ctx.createLinearGradient(cx - tw, 0, cx + tw, 0); g.addColorStop(0, '#8c6a4c'); g.addColorStop(0.45, '#6b4c34'); g.addColorStop(1, '#3f2b1d');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(cx - tw * 0.85, bot); ctx.quadraticCurveTo(cx - tw * 0.4, bot - 10, cx - tw * 0.38, bot - 24);
  ctx.lineTo(cx - tw * 0.3, top); ctx.lineTo(cx + tw * 0.3, top); ctx.lineTo(cx + tw * 0.38, bot - 24); ctx.quadraticCurveTo(cx + tw * 0.45, bot - 10, cx + tw * 0.9, bot); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#5a3f2a'; ctx.lineWidth = Math.max(3, tw * 0.22); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, top + 30); ctx.quadraticCurveTo(cx - tw, top + 14, cx - tw * 1.5, top); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, top + 22); ctx.quadraticCurveTo(cx + tw * 0.8, top + 10, cx + tw * 1.3, top - 2); ctx.stroke();
  ctx.fillStyle = 'rgba(30,20,10,0.25)'; for (let i = 0; i < 8; i++) ctx.fillRect(cx - tw * 0.2 + (i % 3) * 3, top + 10 + i * (bot - top - 20) / 8, 1.5, 7);
}

function trees(scene) {
  TREE_VARIANTS.forEach((v, k) => {
    const tk = `prop_tree${k}_trunk`;
    const tw = Math.max(60, v.trunkW * 4), th = v.trunkH + 26;
    if (!scene.textures.exists(tk)) { const { canvas, ctx } = makeCanvas(tw, th); drawTrunk(ctx, v, tw, th); register(scene, tk, canvas, { footX: tw / 2, footY: th - 4 }); }
    const clusters = canopyClusters(v, 900 + k * 13);
    let any = null;
    for (const season of SEASONS) {
      const ck = `prop_tree${k}_canopy_${season}`; if (scene.textures.exists(ck)) continue;
      const { canvas, ctx } = makeCanvas(v.cw, v.ch + 8);
      const fruit = k === 2 ? (season === 'summer' ? '#e8453a' : season === 'autumn' ? '#f0a53a' : season === 'spring' ? '#fff1f4' : null) : null;
      drawCanopy(ctx, v, clusters, SEASON_GRADE[season].foliage, 900 + k * 13, fruit);
      register(scene, ck, canvas); if (!any) any = canvas;
    }
    // birleşik silüet → gölge
    const sk = `prop_tree${k}`;
    if (!scene.textures.exists(sk + '__sh')) {
      const W = Math.max(v.cw, tw), H = v.ch + v.trunkH + 10;
      const { canvas, ctx } = makeCanvas(W, H);
      const tc = scene.textures.get(tk).getSourceImage(); const cc = scene.textures.get(`prop_tree${k}_canopy_spring`).getSourceImage();
      ctx.drawImage(tc, (W - tw) / 2, H - th);
      ctx.drawImage(cc, (W - v.cw) / 2, H - 4 - v.trunkH - v.ch + 6);
      registerShadow(scene, sk, canvas, W / 2, H - 4);
    }
  });
  // çalılar
  for (let k = 0; k < 2; k++) {
    const v = { cw: 96, ch: 62, shape: 'bush' }; const r = mulberry32(950 + k); const clusters = [];
    for (let i = 0; i < 12; i++) clusters.push([20 + r() * 56, 26 + r() * 18, 12 + r() * 10]);
    clusters.sort((a, b) => a[1] - b[1]);
    for (const season of SEASONS) {
      const ck = `prop_bush${k}_${season}`; if (scene.textures.exists(ck)) continue;
      const { canvas, ctx } = makeCanvas(96, 66); drawCanopy(ctx, v, clusters, SEASON_GRADE[season].foliage, 950 + k, k === 1 && season === 'spring' ? '#ffb7d0' : null);
      register(scene, ck, canvas, { footX: 48, footY: 62 });
      if (season === 'spring') registerShadow(scene, `prop_bush${k}`, canvas, 48, 62);
    }
  }
}

// ------------------------------------------------------------------ çit, kuyu, fener
function wood(ctx, x, y, w, h) { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#a77a52'); g.addColorStop(1, '#6b4a30'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }

function fences(scene) {
  if (!scene.textures.exists('prop_fence_h')) {
    const { canvas, ctx } = makeCanvas(64, 46);
    for (const ry of [14, 27]) { const g = ctx.createLinearGradient(0, ry, 0, ry + 5); g.addColorStop(0, '#b78a60'); g.addColorStop(1, '#6e4c32'); ctx.fillStyle = g; ctx.fillRect(0, ry, 64, 5); }
    wood(ctx, 1, 6, 7, 38); ctx.fillStyle = '#c49a6c'; ctx.fillRect(1, 5, 7, 2);
    withShadow(scene, 'prop_fence_h', canvas, 32, 44);
  }
  if (!scene.textures.exists('prop_fence_post')) {
    const { canvas, ctx } = makeCanvas(12, 46); wood(ctx, 2, 6, 7, 38); ctx.fillStyle = '#c49a6c'; ctx.fillRect(2, 5, 7, 2);
    withShadow(scene, 'prop_fence_post', canvas, 6, 44);
  }
  if (!scene.textures.exists('prop_fence_v')) {
    const { canvas, ctx } = makeCanvas(16, 86);
    for (const [rx, a] of [[6, 1], [9, 0.85]]) { ctx.globalAlpha = a; const g = ctx.createLinearGradient(rx, 0, rx + 3, 0); g.addColorStop(0, '#b78a60'); g.addColorStop(1, '#6e4c32'); ctx.fillStyle = g; ctx.fillRect(rx, 8 + (rx - 6) * 3, 3, 62); }
    ctx.globalAlpha = 1; wood(ctx, 4, 46, 8, 38); ctx.fillStyle = '#c49a6c'; ctx.fillRect(4, 45, 8, 2);
    withShadow(scene, 'prop_fence_v', canvas, 8, 84);
  }
}

function well(scene) {
  const key = 'prop_well'; if (scene.textures.exists(key)) return;
  const W = 120, H = 140; const { canvas, ctx } = makeCanvas(W, H); const r = mulberry32(5);
  const cx = 60, top = 78, bot = 128, rx = 40, ry = 14;
  // gövde
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0); g.addColorStop(0, '#b9b2a6'); g.addColorStop(0.5, '#9a9286'); g.addColorStop(1, '#5f5950');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - rx, top); ctx.lineTo(cx - rx, bot); ctx.ellipse(cx, bot, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, top); ctx.closePath(); ctx.fill();
  for (let row = 0; row < 4; row++) for (let i = 0; i < 7; i++) {
    const a = (i + (row % 2) * 0.5) / 7 * Math.PI; const x = cx - Math.cos(a) * rx * 0.92; const y = top + 8 + row * 12 + Math.sin(a) * ry * 0.9;
    ctx.fillStyle = rgba(r() < 0.5 ? '#d6cfc2' : '#6a645a', 0.45); ctx.beginPath(); ctx.ellipse(x, y, 5.5 * Math.sin(a) + 1.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#c8c1b4'; ctx.beginPath(); ctx.ellipse(cx, top, rx + 2, ry + 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1d2733'; ctx.beginPath(); ctx.ellipse(cx, top + 1, rx - 7, ry - 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(120,170,220,0.35)'; ctx.beginPath(); ctx.ellipse(cx + 4, top + 3, rx - 18, ry - 9, 0, 0, Math.PI * 2); ctx.fill();
  // çatı çerçevesi
  wood(ctx, cx - rx + 2, 22, 6, top - 18); wood(ctx, cx + rx - 8, 22, 6, top - 18);
  ctx.fillStyle = '#5e3e28'; ctx.fillRect(cx - rx + 4, 36, rx * 2 - 8, 4);
  ctx.fillStyle = '#8f3d33'; ctx.beginPath(); ctx.moveTo(cx - rx - 10, 30); ctx.lineTo(cx, 6); ctx.lineTo(cx + rx + 10, 30); ctx.lineTo(cx + rx + 4, 34); ctx.lineTo(cx, 14); ctx.lineTo(cx - rx - 4, 34); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,170,0.3)'; ctx.beginPath(); ctx.moveTo(cx - rx - 10, 30); ctx.lineTo(cx, 6); ctx.lineTo(cx, 10); ctx.lineTo(cx - rx - 6, 31); ctx.fill();
  // ip ve kova
  ctx.strokeStyle = '#d9c7a0'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx + 6, 40); ctx.lineTo(cx + 6, 60); ctx.stroke();
  ctx.fillStyle = '#7a5536'; ctx.beginPath(); ctx.moveTo(cx - 1, 60); ctx.lineTo(cx + 13, 60); ctx.lineTo(cx + 11, 72); ctx.lineTo(cx + 1, 72); ctx.fill();
  withShadow(scene, key, canvas, cx, bot + 6);
}

function lamp(scene) {
  const key = 'prop_lamp'; if (scene.textures.exists(key)) return;
  const { canvas, ctx } = makeCanvas(34, 118);
  wood(ctx, 14, 26, 6, 88); ctx.fillStyle = '#4a3322'; ctx.fillRect(10, 110, 14, 6);
  ctx.fillStyle = '#2d2a28'; ctx.fillRect(8, 6, 18, 4); ctx.fillRect(9, 26, 16, 3);
  ctx.fillStyle = '#ffe3a6'; ctx.fillRect(10, 10, 14, 16); ctx.fillStyle = 'rgba(255,170,80,0.7)'; ctx.fillRect(12, 16, 10, 8);
  ctx.strokeStyle = '#2d2a28'; ctx.lineWidth = 1.5; ctx.strokeRect(10, 10, 14, 16); ctx.beginPath(); ctx.moveTo(17, 10); ctx.lineTo(17, 26); ctx.stroke();
  withShadow(scene, key, canvas, 17, 114);
}

export function genProps(scene, step) {
  house(scene); step();
  trees(scene); step();
  fences(scene); well(scene); lamp(scene); step();
}

export { WORLD, radial };
