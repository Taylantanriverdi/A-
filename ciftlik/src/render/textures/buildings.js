// Bina dokuları (PLAN §10 "Görsel"): kümes, ahır, arı kovanı, boş arsa işaretleri, tabelalar, ürün sepeti, kir lekeleri, efekt sprite'ları.
// Açılışta BİR KEZ üretilir (idempotent). Tint'e dayanmaz: renkler pişirilmiştir. Kontursuz; sol-üstten kenar ışığı.
// Her bina dokusunun ayak noktası BLD[tip].ox/oy ile verilir (BuildingView konteyneri ayakta durur).
import { makeCanvas, register, shade, rgba, radial } from './canvas.js';
import { mulberry32 } from './noise.js';
import { registerShadow } from './props.js';
import { BUILDINGS } from '../../data/buildings.js';
import { TILE_W, TILE_H } from '../../core/constants.js';

// Ayak noktasına göre yerleşim (px). win: pencere ışığı merkezleri, door: hayvanların girdiği kapı, basket: ürün sepeti,
// dirt: kir lekelerinin yayılacağı kutu [x0,x1,y0,y1].
export const BLD = {
  coop: { key: 'bld_coop', w: 240, h: 192, ox: 120, oy: 178, height: 136, shw: 190,
          win: [[-39, -42]], door: [33, -2], basket: [8, 1], dirt: [-62, 58, 3, 18] },
  barn: { key: 'bld_barn', w: 364, h: 272, ox: 182, oy: 254, height: 206, shw: 300,
          win: [[0, -154], [-78, -58], [78, -58]], door: [0, -2], basket: [-104, 1], dirt: [-110, 110, 3, 20] },
  hive: { key: 'bld_hive', w: 72, h: 100, ox: 36, oy: 92, height: 76, shw: 52,
          win: [], door: [0, -14], basket: [30, 2], dirt: [-20, 20, 2, 10] },
};
export const LOT_PAD = { x: 26, t: 36, b: 16 };
export const lotKey = (wt, ht) => `bld_lot_${wt}x${ht}`;
export const lotHlKey = (wt, ht) => `bld_lothl_${wt}x${ht}`;
export const SIGN = { w: 38, h: 52, ox: 19, oy: 50 };

const TAU = Math.PI * 2;
const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };

/** Dikey/yatay ahşap tahta dolgusu (gradyan + damar) */
function planks(ctx, x, y, w, h, base, r, step = 11, vertical = true) {
  const n = Math.max(1, Math.round((vertical ? w : h) / step));
  const sz = (vertical ? w : h) / n;
  for (let i = 0; i < n; i++) {
    const c = shade(base, (r() - 0.5) * 0.14);
    const bx = vertical ? x + i * sz : x, by = vertical ? y : y + i * sz, bw = vertical ? sz : w, bh = vertical ? h : sz;
    const g = vertical ? ctx.createLinearGradient(bx, 0, bx + bw, 0) : ctx.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, shade(c, 0.16)); g.addColorStop(0.5, c); g.addColorStop(1, shade(c, -0.22));
    ctx.fillStyle = g; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rgba('#2a160c', 0.2); ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (vertical) { const xx = bx + bw * (0.3 + r() * 0.4); ctx.moveTo(xx, by + 2); ctx.lineTo(xx + (r() - 0.5) * 2, by + bh - 2); ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); }
    else { const yy = by + bh * (0.3 + r() * 0.4); ctx.moveTo(bx + 2, yy); ctx.lineTo(bx + bw - 2, yy); ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); }
    ctx.stroke();
  }
}

function groundAO(ctx, cx, cy, rx, ry, a = 0.4) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
  ctx.fillStyle = radial(ctx, 0, 0, rx, [[0, `rgba(20,12,8,${a})`], [0.7, `rgba(20,12,8,${a * 0.5})`], [1, 'rgba(20,12,8,0)']]);
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
}

function shingles(ctx, poly, base, r, rows, y0, y1, x0, x1, sw = 14) {
  ctx.save(); ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
  const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, shade(base, 0.12)); g.addColorStop(1, shade(base, -0.18));
  ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const rh = (y1 - y0) / rows;
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * rh;
    for (let x = x0 - (j % 2) * sw / 2; x < x1; x += sw) {
      const c = shade(base, (r() - 0.5) * 0.12 - 0.04 * (j / rows));
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sw, y); ctx.lineTo(x + sw, y + rh * 0.6); ctx.quadraticCurveTo(x + sw / 2, y + rh * 1.25, x, y + rh * 0.6); ctx.fill();
      ctx.fillStyle = rgba('#fff0d0', 0.12); ctx.fillRect(x + 1, y, sw - 2, 1.2);
    }
    ctx.fillStyle = rgba('#2a0c08', 0.18); ctx.fillRect(x0, y + rh * 0.95, x1 - x0, 1.6);
  }
  ctx.restore();
}

function rimLeft(ctx, x, y0, y1, a = 0.5, w = 1.6) { ctx.fillStyle = `rgba(255,236,200,${a})`; ctx.fillRect(x, y0, w, y1 - y0); }

function windowFrame(ctx, x, y, w, h, shutters) {
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#6f8fa8'); g.addColorStop(1, '#2f4258');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x, y + h * 0.7); ctx.fill();
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(x + w / 2 - 1, y, 2, h); ctx.fillRect(x, y + h / 2 - 1, w, 2);
  if (shutters) { ctx.fillStyle = '#7d3a2c'; ctx.fillRect(x - 3 - w * 0.42, y - 3, w * 0.42, h + 6); ctx.fillRect(x + w + 3, y - 3, w * 0.42, h + 6); }
}

// ------------------------------------------------------------------ KÜMES
function genCoop(scene) {
  const L = BLD.coop; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(4101); const F = L.oy;
  groundAO(ctx, 120, F, 118, 15, 0.42);
  // duvar
  planks(ctx, 45, 106, 150, F - 106, '#b98558', r, 10);
  ctx.fillStyle = rgba('#fff0d0', 0.0); rimLeft(ctx, 45, 106, F, 0.5);
  // taş temel
  for (let x = 45; x < 195; x += 15) { ell(ctx, x + 7.5, F - 3, 8, 4.5, shade('#8d8a84', (r() - 0.5) * 0.2)); }
  // çatı saçağı gölgesi
  const sg = ctx.createLinearGradient(0, 106, 0, 128); sg.addColorStop(0, 'rgba(30,14,8,0.5)'); sg.addColorStop(1, 'rgba(30,14,8,0)'); ctx.fillStyle = sg; ctx.fillRect(45, 106, 150, 22);
  // pencere (sol)
  windowFrame(ctx, 66, 124, 30, 24, true);
  ctx.fillStyle = '#a9703f'; ctx.fillRect(62, 152, 38, 7); ctx.fillStyle = '#5c8a4a'; for (let i = 0; i < 5; i++) ell(ctx, 66 + i * 7, 151, 4, 4, shade('#5c8a4a', (r() - 0.5) * 0.3)); ell(ctx, 73, 149, 2.4, 2.4, '#e8607a'); ell(ctx, 87, 150, 2.4, 2.4, '#f2d04b');
  // kapı + rampa
  ctx.fillStyle = '#4a2c1c'; ctx.beginPath(); ctx.moveTo(141, F - 3); ctx.lineTo(141, 138); ctx.quadraticCurveTo(153, 124, 165, 138); ctx.lineTo(165, F - 3); ctx.fill();
  ctx.fillStyle = '#f0e6cf'; ctx.beginPath(); ctx.moveTo(138, F - 3); ctx.lineTo(138, 137); ctx.quadraticCurveTo(153, 118, 168, 137); ctx.lineTo(168, F - 3); ctx.lineTo(165, F - 3); ctx.lineTo(165, 138); ctx.quadraticCurveTo(153, 124, 141, 138); ctx.lineTo(141, F - 3); ctx.fill();
  ell(ctx, 153, F - 14, 9, 7, rgba('#ffd9a0', 0.0));
  const rg = ctx.createLinearGradient(0, F - 12, 0, F + 12); rg.addColorStop(0, '#c89a66'); rg.addColorStop(1, '#8a5f3a');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(141, F - 8); ctx.lineTo(165, F - 8); ctx.lineTo(178, F + 11); ctx.lineTo(132, F + 11); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgba('#3a2010', 0.55); ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) { const t = i / 3; const y = F - 5 + t * 14, xa = 141 - 9 * (y - (F - 8)) / 19, xb = 165 + 13 * (y - (F - 8)) / 19; ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke(); }
  // çatı (kırmızı, yuvarlak yumuşak, saçak çıkıntılı)
  const roof = [[24, 116], [120, 40], [216, 116]];
  shingles(ctx, roof, '#b8403a', r, 6, 40, 120, 20, 220, 15);
  // çatı alt kalınlığı + kenar ışığı
  ctx.fillStyle = '#7a2924'; ctx.beginPath(); ctx.moveTo(24, 116); ctx.lineTo(216, 116); ctx.lineTo(214, 121); ctx.lineTo(26, 121); ctx.fill();
  ctx.strokeStyle = rgba('#ffd2b0', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(25, 115); ctx.lineTo(120, 41); ctx.stroke();
  ctx.strokeStyle = rgba('#5a1814', 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(120, 41); ctx.lineTo(215, 115); ctx.stroke();
  // çatı penceresi (yuvarlak havalandırma)
  ell(ctx, 120, 84, 12, 12, '#f0e6cf'); ell(ctx, 120, 84, 9, 9, '#2f241c'); ell(ctx, 120, 86, 9, 7, rgba('#ffcf80', 0.0));
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(119, 75, 2, 18); ctx.fillRect(111, 83, 18, 2);
  // sırt tepesi tahtası
  ell(ctx, 120, 41, 5, 3, '#7a2924');
  canvasFinal(scene, L, canvas);
}

// ------------------------------------------------------------------ AHIR
function genBarn(scene) {
  const L = BLD.barn; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(4207); const F = L.oy; const CX = 182;
  groundAO(ctx, CX, F, 170, 18, 0.42);
  // saman balyası (sağda)
  const bale = (x, y, w, h) => {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#e8c968'); g.addColorStop(1, '#b78f3a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 5) : ctx.rect(x, y, w, h); ctx.fill();
    ctx.strokeStyle = rgba('#7a5a1e', 0.4); ctx.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) { const yy = y + 3 + r() * (h - 6); ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + w - 2, yy + (r() - 0.5) * 2); ctx.stroke(); }
    ctx.strokeStyle = rgba('#5a3d18', 0.7); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.3, y + h); ctx.moveTo(x + w * 0.7, y); ctx.lineTo(x + w * 0.7, y + h); ctx.stroke();
    ctx.fillStyle = rgba('#fff4c0', 0.5); ctx.fillRect(x + 3, y + 1, w - 6, 1.6);
  };
  bale(318, F - 30, 40, 30); bale(324, F - 56, 34, 26);
  // ana ön yüz (gambrel silüeti)
  const face = [[46, F], [46, 142], [72, 98], [CX, 54], [292, 98], [318, 142], [318, F]];
  ctx.save(); ctx.beginPath(); face.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
  planks(ctx, 40, 50, 285, F - 50, '#a8483a', r, 12);
  // üst üçgen hafif koyu (gölge) ve alt gölge
  const tg = ctx.createLinearGradient(0, 54, 0, 150); tg.addColorStop(0, 'rgba(30,10,8,0.28)'); tg.addColorStop(1, 'rgba(30,10,8,0)'); ctx.fillStyle = tg; ctx.fillRect(40, 54, 285, 100);
  const bg = ctx.createLinearGradient(0, F - 24, 0, F); bg.addColorStop(0, 'rgba(25,12,8,0)'); bg.addColorStop(1, 'rgba(25,12,8,0.4)'); ctx.fillStyle = bg; ctx.fillRect(40, F - 24, 285, 24);
  rimLeft(ctx, 46, 142, F, 0.5, 2);
  ctx.restore();
  // beyaz süs kenarları
  ctx.strokeStyle = '#f0e6cf'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath(); face.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.5); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(46, F); ctx.lineTo(46, 142); ctx.lineTo(72, 98); ctx.lineTo(CX, 54); ctx.stroke();
  // çatı saçağı (koyu pas rengi, kalın)
  ctx.lineCap = 'round'; ctx.strokeStyle = '#6e2a26'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(38, 148); ctx.lineTo(70, 92); ctx.lineTo(CX, 46); ctx.lineTo(294, 92); ctx.lineTo(326, 148); ctx.stroke();
  ctx.strokeStyle = rgba('#ffc9a8', 0.55); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(36, 146); ctx.lineTo(69, 90); ctx.lineTo(CX, 44); ctx.stroke();
  // çatı penceresi / samanlık kapağı
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(CX - 24, 78, 48, 44);
  ctx.fillStyle = '#3a2218'; ctx.fillRect(CX - 20, 82, 40, 36);
  ctx.fillStyle = '#d9b457'; ctx.beginPath(); ctx.moveTo(CX - 20, 118); ctx.lineTo(CX - 20, 106); ctx.quadraticCurveTo(CX - 8, 98, CX + 4, 105); ctx.quadraticCurveTo(CX + 14, 99, CX + 20, 106); ctx.lineTo(CX + 20, 118); ctx.fill();
  ctx.strokeStyle = '#f0e6cf'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(CX - 20, 82); ctx.lineTo(CX + 20, 118); ctx.moveTo(CX + 20, 82); ctx.lineTo(CX - 20, 118); ctx.stroke();
  // yan pencereler
  windowFrame(ctx, 78, 176, 28, 26, false); windowFrame(ctx, 258, 176, 28, 26, false);
  // çift kapı
  const dx0 = CX - 50, dx1 = CX + 50, dy0 = 166;
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(dx0 - 5, dy0 - 5, 110, F - dy0 + 5);
  for (let k = 0; k < 2; k++) {
    const x = k ? CX + 1.5 : dx0; const w = 48.5;
    planks(ctx, x, dy0, w, F - dy0, '#9a3a2f', r, 8);
    ctx.strokeStyle = '#f0e6cf'; ctx.lineWidth = 3.6; ctx.strokeRect(x + 2, dy0 + 2, w - 4, F - dy0 - 4);
    ctx.beginPath(); ctx.moveTo(x + 2, dy0 + 2); ctx.lineTo(x + w - 2, F - 2); ctx.moveTo(x + w - 2, dy0 + 2); ctx.lineTo(x + 2, F - 2); ctx.stroke();
    ell(ctx, k ? x + 7 : x + w - 7, dy0 + 40, 2.6, 2.6, '#3a2a20');
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(CX - 1, dy0, 3, F - dy0);
  rimLeft(ctx, dx0 - 5, dy0 - 5, F, 0.5, 1.6);
  // taş temel
  for (let x = 46; x < 318; x += 17) ell(ctx, x + 8, F - 2, 9, 4.5, shade('#8d8a84', (r() - 0.5) * 0.2));
  canvasFinal(scene, L, canvas);
}

// ------------------------------------------------------------------ KOVAN
function genHive(scene) {
  const L = BLD.hive; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(4309); const F = L.oy;
  groundAO(ctx, 36, F, 30, 6, 0.4);
  // yonca/çiçek tutamları
  for (const [x, c] of [[12, '#e8607a'], [58, '#f2d04b'], [22, '#fff'], [50, '#d98cf0']]) { ell(ctx, x, F - 1, 6, 3.5, '#4f8a3c'); ell(ctx, x + (r() - 0.5) * 4, F - 6, 2.2, 2.2, c); }
  // ayaklar + çapraz
  ctx.fillStyle = '#7a5236'; ctx.fillRect(16, F - 14, 5, 14); ctx.fillRect(51, F - 14, 5, 14);
  ctx.fillStyle = '#6a4630'; ctx.fillRect(16, F - 12, 40, 3);
  // kutular
  const box = (y, h, off) => {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#f6f0e2'); g.addColorStop(1, '#cfc5ad');
    ctx.fillStyle = g; ctx.fillRect(15 + off, y, 42, h);
    const gx = ctx.createLinearGradient(15 + off, 0, 57 + off, 0); gx.addColorStop(0, 'rgba(255,255,255,0.45)'); gx.addColorStop(0.35, 'rgba(255,255,255,0)'); gx.addColorStop(1, 'rgba(60,40,20,0.22)');
    ctx.fillStyle = gx; ctx.fillRect(15 + off, y, 42, h);
    ctx.fillStyle = rgba('#8a7a58', 0.5); ctx.fillRect(15 + off, y + h - 1.4, 42, 1.4);
    ctx.fillStyle = rgba('#8a7a58', 0.45); ctx.fillRect(15 + off + 6, y + h * 0.45, 30, 1);
    ctx.fillStyle = rgba('#8a6a40', 0.5); ctx.fillRect(21 + off, y + 3, 6, 1.4); // tutamak
  };
  box(F - 30, 16, 0); box(F - 46, 16, 1); box(F - 62, 16, -0.5);
  // giriş + iniş tahtası
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(27, F - 28, 18, 3.4);
  ctx.fillStyle = '#d9c9a0'; ctx.fillRect(24, F - 24.6, 24, 3);
  // çatı kapağı
  ctx.fillStyle = '#b5885a'; ctx.beginPath(); ctx.moveTo(10, F - 62); ctx.lineTo(62, F - 62); ctx.lineTo(54, F - 74); ctx.lineTo(18, F - 74); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#fff0d0', 0.4); ctx.fillRect(10, F - 62.8, 52, 1.4); ctx.fillStyle = rgba('#3a2010', 0.35); ctx.fillRect(10, F - 61.4, 52, 2.4);
  ell(ctx, 36, F - 74, 4, 2, '#8d8a84');
  rimLeft(ctx, 15, F - 60, F - 14, 0.45, 1.3);
  canvasFinal(scene, L, canvas);
}

function canvasFinal(scene, L, canvas) {
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy, w: L.w, h: L.h });
  registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ BOŞ ARSA
function drawStake(ctx, x, y, h, w, back) {
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  const base = back ? '#8a6a48' : '#b08454';
  g.addColorStop(0, shade(base, 0.18)); g.addColorStop(1, shade(base, -0.28));
  ctx.fillStyle = g; ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = shade(base, 0.2); ctx.beginPath(); ctx.ellipse(x, y - h, w / 2, w / 4, 0, 0, TAU); ctx.fill();
  groundAO(ctx, x, y, 7, 2.2, 0.35);
}
function rope(ctx, x0, y0, x1, y1, sag) {
  ctx.strokeStyle = '#e4d3a4'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1); ctx.stroke();
  ctx.strokeStyle = rgba('#5a4220', 0.35); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x0, y0 + 1); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag + 1, x1, y1 + 1); ctx.stroke();
}

function genLot(scene, wt, ht) {
  const key = lotKey(wt, ht); if (scene.textures.exists(key)) return;
  const W = wt * TILE_W, H = ht * TILE_H, P = LOT_PAD; const CW = W + P.x * 2, CH = H + P.t + P.b;
  const small = wt === 1 && ht === 1;
  const { canvas, ctx } = makeCanvas(CW, CH); const r = mulberry32(5000 + wt * 17 + ht);
  const ix = small ? 10 : 12, iy = small ? 6 : 8;
  const px0 = P.x + ix, px1 = P.x + W - ix, py0 = P.t + iy, py1 = P.t + H - iy;
  // toprak yaması (yumuşak kenar)
  for (let k = 3; k >= 0; k--) {
    const e = k * 3.5; ctx.fillStyle = rgba('#6e4f34', k === 0 ? 1 : 0.2 + 0.1 * (3 - k));
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px0 - e, py0 - e * 0.7, px1 - px0 + e * 2, py1 - py0 + e * 1.4, 14 + e) : ctx.rect(px0 - e, py0 - e, px1 - px0 + e * 2, py1 - py0 + e * 2); ctx.fill();
  }
  ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px0, py0, px1 - px0, py1 - py0, 14) : ctx.rect(px0, py0, px1 - px0, py1 - py0); ctx.clip();
  const g = ctx.createLinearGradient(0, py0, 0, py1); g.addColorStop(0, '#6a4a30'); g.addColorStop(1, '#86613f'); ctx.fillStyle = g; ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  const n = Math.floor((px1 - px0) * (py1 - py0) / 90);
  for (let i = 0; i < n; i++) { ctx.fillStyle = rgba(r() < 0.5 ? '#3b2616' : '#b08a60', 0.16 + r() * 0.2); const s = 0.8 + r() * 2.2; ctx.fillRect(px0 + r() * (px1 - px0), py0 + r() * (py1 - py0), s, s * 0.7); }
  // sürülmüş hafif oluklar
  if (!small) { ctx.strokeStyle = rgba('#3b2616', 0.16); ctx.lineWidth = 2; for (let y = py0 + 14; y < py1 - 6; y += 14) { ctx.beginPath(); ctx.moveTo(px0 + 8, y); ctx.lineTo(px1 - 8, y + (r() - 0.5) * 2); ctx.stroke(); } }
  const vg = ctx.createRadialGradient((px0 + px1) / 2, (py0 + py1) / 2, 4, (px0 + px1) / 2, (py0 + py1) / 2, (px1 - px0) * 0.6); vg.addColorStop(0, 'rgba(255,230,180,0.08)'); vg.addColorStop(1, 'rgba(20,10,5,0.18)'); ctx.fillStyle = vg; ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  ctx.restore();
  // çim tutamları kenarda
  const tufts = Math.round((px1 - px0 + py1 - py0) / 26);
  for (let i = 0; i < tufts; i++) {
    const t = r(); let x, y; const side = i % 4;
    if (side === 0) { x = px0 + t * (px1 - px0); y = py0 - 1; } else if (side === 1) { x = px0 + t * (px1 - px0); y = py1 + 2; } else if (side === 2) { x = px0 - 2; y = py0 + t * (py1 - py0); } else { x = px1 + 2; y = py0 + t * (py1 - py0); }
    ctx.strokeStyle = shade('#5d9a45', (r() - 0.5) * 0.3); ctx.lineWidth = 1.3;
    for (let b = -1; b <= 1; b++) { ctx.beginPath(); ctx.moveTo(x + b * 2, y); ctx.quadraticCurveTo(x + b * 3, y - 4, x + b * 4.5, y - 7 - r() * 3); ctx.stroke(); }
  }
  // kazıklar: köşeler + uzun kenarlarda aralıklı
  const sh = small ? 17 : 24, sw = small ? 4 : 5;
  const xs = [px0 - 2]; const nx = small ? 1 : Math.max(1, Math.round((px1 - px0) / 128));
  for (let i = 1; i < nx; i++) xs.push(px0 + (px1 - px0) * i / nx); xs.push(px1 + 2);
  const ys = [py0, py1 + 1]; const ny = small ? 1 : Math.max(1, Math.round((py1 - py0) / 100));
  const rh = small ? 12 : 17;
  // arka sıra
  for (let i = 0; i < xs.length - 1; i++) rope(ctx, xs[i], py0 - rh + 1, xs[i + 1], py0 - rh + 1, small ? 2 : 4);
  for (const x of xs) drawStake(ctx, x, py0 + 1, sh - 3, sw - 0.5, true);
  // yan kenarlar (perspektif: ön ucu aşağıda)
  for (const x of [xs[0], xs[xs.length - 1]]) { rope(ctx, x, py0 - rh + 1, x, py1 - rh + 1, small ? 1 : 3); }
  // ön sıra
  for (let i = 0; i < xs.length - 1; i++) rope(ctx, xs[i], py1 - rh + 1, xs[i + 1], py1 - rh + 1, small ? 2 : 5);
  for (const x of xs) drawStake(ctx, x, py1 + 1, sh, sw, false);
  register(scene, key, canvas, { w: CW, h: CH });
  // hover vurgusu: aynı yamanın yumuşak sıcak halesi (ADD ile çizilir)
  const hk = lotHlKey(wt, ht);
  const { canvas: hc, ctx: h } = makeCanvas(CW, CH);
  h.fillStyle = radial(h, CW / 2, P.t + H / 2, Math.max(CW, CH) * 0.62, [[0, 'rgba(255,214,140,0.55)'], [0.7, 'rgba(255,190,110,0.28)'], [1, 'rgba(255,190,110,0)']]);
  h.save(); h.translate(CW / 2, P.t + H / 2); h.scale(1, (H + 24) / (W + 24)); h.translate(-CW / 2, -(P.t + H / 2));
  h.beginPath(); h.arc(CW / 2, P.t + H / 2, (W + 24) / 2, 0, TAU); h.fill(); h.restore();
  h.strokeStyle = 'rgba(255,230,170,0.9)'; h.lineWidth = 2.5; h.beginPath(); h.roundRect ? h.roundRect(px0 - 1, py0 - 1, px1 - px0 + 2, py1 - py0 + 2, 14) : h.rect(px0, py0, px1 - px0, py1 - py0); h.stroke();
  register(scene, hk, hc, { w: CW, h: CH });
}

// ------------------------------------------------------------------ TABELA
function genSigns(scene) {
  const base = (type) => {
    const key = `bld_sign_${type}`; if (scene.textures.exists(key)) return;
    const { canvas, ctx } = makeCanvas(SIGN.w, SIGN.h);
    groundAO(ctx, 19, 49, 9, 2.4, 0.4);
    drawStake(ctx, 19, 50, 36, 4.4, false);
    const bx = 3, by = 4, bw = 32, bh = 26;
    const g = ctx.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, '#f3e6c4'); g.addColorStop(1, '#d7c294');
    ctx.fillStyle = '#7a5236'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - 2, by - 2, bw + 4, bh + 4, 5) : ctx.rect(bx - 2, by - 2, bw + 4, bh + 4); ctx.fill();
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 4) : ctx.rect(bx, by, bw, bh); ctx.fill();
    ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(bx + 2, by + 1, bw - 4, 1.4);
    const cx = 19, cy = 17;
    if (type === 'coop') { // yumurta + minik çatı
      ell(ctx, cx, cy + 2, 7, 8.5, '#fbf3df'); ell(ctx, cx - 2, cy - 1, 2.5, 3.5, rgba('#fff', 0.7)); ell(ctx, cx + 3, cy + 6, 5, 3, rgba('#b99a6a', 0.35));
      ctx.fillStyle = '#c4523f'; ctx.beginPath(); ctx.moveTo(cx - 10, cy - 3); ctx.lineTo(cx, cy - 11); ctx.lineTo(cx + 10, cy - 3); ctx.fill();
    } else if (type === 'barn') { // ahır silüeti
      ctx.fillStyle = '#a8483a'; ctx.beginPath(); ctx.moveTo(cx - 11, cy + 9); ctx.lineTo(cx - 11, cy - 2); ctx.lineTo(cx - 6, cy - 8); ctx.lineTo(cx, cy - 11); ctx.lineTo(cx + 6, cy - 8); ctx.lineTo(cx + 11, cy - 2); ctx.lineTo(cx + 11, cy + 9); ctx.fill();
      ctx.fillStyle = '#f0e6cf'; ctx.fillRect(cx - 4, cy + 1, 8, 8); ctx.strokeStyle = '#a8483a'; ctx.lineWidth = 1; ctx.strokeRect(cx - 4, cy + 1, 8, 8);
    } else { // petek altıgeni
      ctx.fillStyle = '#e8a93a'; ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); } ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#fff2c0', 0.55); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; ctx.lineTo(cx - 2 + Math.cos(a) * 4, cy - 2 + Math.sin(a) * 4); } ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 1.6; ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); } ctx.closePath(); ctx.stroke();
    }
    register(scene, key, canvas);
  };
  base('coop'); base('barn'); base('hive');
}

// ------------------------------------------------------------------ SEPET / KİR / EFEKT
function genMisc(scene) {
  const basket = (type) => {
    const key = `bld_basket_${type}`; if (scene.textures.exists(key)) return;
    const { canvas, ctx } = makeCanvas(32, 30); groundAO(ctx, 16, 27, 12, 3, 0.4);
    if (type === 'coop') { for (const [x, y, c] of [[10, 12, '#fbf3df'], [17, 10, '#f3e3c3'], [23, 12, '#fbf3df'], [13, 14, '#f3e3c3'], [20, 14, '#fbf3df']]) { ell(ctx, x, y, 4.2, 5.2, c); ell(ctx, x - 1.2, y - 1.6, 1.3, 1.8, rgba('#fff', 0.7)); } }
    else if (type === 'barn') { ctx.fillStyle = '#f7f5ef'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(8, 4, 9, 16, 3) : ctx.rect(8, 4, 9, 16); ctx.fill(); ctx.fillStyle = '#c49a6a'; ctx.fillRect(10, 1, 5, 4); ell(ctx, 22, 12, 6, 5.5, '#f4f0e8'); ell(ctx, 19.5, 10.5, 3, 2.5, '#fff'); }
    else { ctx.fillStyle = '#e8a93a'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(9, 5, 14, 15, 4) : ctx.rect(9, 5, 14, 15); ctx.fill(); ctx.fillStyle = rgba('#fff2c0', 0.55); ctx.fillRect(11, 7, 3, 9); ctx.fillStyle = '#8a6a40'; ctx.fillRect(10, 2, 12, 4); }
    const g = ctx.createLinearGradient(0, 17, 0, 28); g.addColorStop(0, '#c9a066'); g.addColorStop(1, '#8a6038');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(3, 17); ctx.lineTo(29, 17); ctx.lineTo(25, 27); ctx.lineTo(7, 27); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba('#4a2c14', 0.45); ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(4 + i, 20 + i * 2.6); ctx.lineTo(28 - i, 20 + i * 2.6); ctx.stroke(); }
    ctx.fillStyle = rgba('#fff0d0', 0.45); ctx.fillRect(3, 16.4, 26, 1.4);
    register(scene, key, canvas);
  };
  basket('coop'); basket('barn'); basket('hive');
  // kir/saman lekeleri
  for (let v = 0; v < 3; v++) {
    const key = `bld_dirt${v}`; if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(34, 16); const r = mulberry32(6100 + v);
    ell(ctx, 17, 9, 14, 5, rgba('#3b2a1a', 0.35)); ell(ctx, 15 + v * 2, 8, 9, 3.4, rgba('#2a1c10', 0.35));
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const x = 4 + r() * 26, y = 3 + r() * 9, a = (r() - 0.5) * 1.8, l = 4 + r() * 6; ctx.strokeStyle = shade('#d9b457', (r() - 0.5) * 0.3); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); ctx.stroke(); }
    if (v === 1) { ell(ctx, 24, 9, 2.4, 1.4, rgba('#5a4020', 0.8)); ell(ctx, 9, 7, 2, 1.2, rgba('#5a4020', 0.8)); }
    register(scene, key, canvas);
  }
  // toz bulutu
  if (!scene.textures.exists('fx_dust')) { const { canvas, ctx } = makeCanvas(48, 48); ctx.fillStyle = radial(ctx, 24, 24, 24, [[0, 'rgba(214,190,150,0.85)'], [0.55, 'rgba(200,174,134,0.4)'], [1, 'rgba(200,174,134,0)']]); ctx.fillRect(0, 0, 48, 48); register(scene, 'fx_dust', canvas); }
  // parıltı (4 köşeli yıldız) ve kalp
  if (!scene.textures.exists('fx_spark')) {
    const { canvas, ctx } = makeCanvas(32, 32); ctx.fillStyle = radial(ctx, 16, 16, 16, [[0, 'rgba(255,240,190,0.95)'], [0.3, 'rgba(255,220,140,0.35)'], [1, 'rgba(255,200,100,0)']]); ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = 'rgba(255,252,230,0.95)'; ctx.beginPath(); ctx.moveTo(16, 1); ctx.quadraticCurveTo(17.5, 14.5, 31, 16); ctx.quadraticCurveTo(17.5, 17.5, 16, 31); ctx.quadraticCurveTo(14.5, 17.5, 1, 16); ctx.quadraticCurveTo(14.5, 14.5, 16, 1); ctx.fill();
    register(scene, 'fx_spark', canvas);
  }
  if (!scene.textures.exists('fx_heart')) {
    const { canvas, ctx } = makeCanvas(24, 22); const g = ctx.createLinearGradient(0, 2, 0, 20); g.addColorStop(0, '#ff9ab0'); g.addColorStop(1, '#e0405f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(12, 20); ctx.bezierCurveTo(-3, 9, 4, -2, 12, 6); ctx.bezierCurveTo(20, -2, 27, 9, 12, 20); ctx.fill();
    ctx.fillStyle = rgba('#fff', 0.55); ctx.beginPath(); ctx.ellipse(7.5, 6.5, 2.6, 1.7, -0.6, 0, TAU); ctx.fill();
    register(scene, 'fx_heart', canvas);
  }
  // arı
  if (!scene.textures.exists('bld_bee')) {
    const { canvas, ctx } = makeCanvas(16, 12);
    ell(ctx, 5, 3.5, 3.4, 2, rgba('#e8f4ff', 0.75), -0.5); ell(ctx, 9, 3.2, 3.4, 2, rgba('#e8f4ff', 0.75), 0.4);
    ell(ctx, 8, 7, 4.6, 3, '#f2b84b'); ctx.fillStyle = '#3a2814'; ctx.fillRect(7, 4.2, 1.5, 5.6); ctx.fillRect(10, 4.6, 1.5, 4.8);
    ell(ctx, 12.4, 7, 2, 1.8, '#3a2814');
    register(scene, 'bld_bee', canvas);
  }
}

export function genBuildings(scene) {
  genCoop(scene); genBarn(scene); genHive(scene);
  const seen = new Set();
  for (const def of Object.values(BUILDINGS)) for (const l of def.lots) {
    const wt = l.x1 - l.x0 + 1, ht = l.y1 - l.y0 + 1; const k = wt + 'x' + ht;
    if (!seen.has(k)) { seen.add(k); genLot(scene, wt, ht); }
  }
  genSigns(scene); genMisc(scene);
}
