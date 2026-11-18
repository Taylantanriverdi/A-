// Atölye dokuları (PLAN §11 "Görsel"): mandıra, değirmen (+dönen kanatlar), fırın, konserve, iplikhane, dokuma tezgâhı,
// boş arsa yaması + hover halesi, tabelalar, çıktı sandığı, is lekeleri, duman, iplik çarkı ve eşek sundurması.
// Açılışta BİR KEZ üretilir (idempotent). Kontursuz; sol-üstten kenar ışığı; renkler pişirilmiştir (tint'e dayanmaz).
import { makeCanvas, register, shade, rgba, radial } from './canvas.js';
import { mulberry32 } from './noise.js';
import { registerShadow } from './props.js';
import { MACHINES } from '../../data/recipes.js';
import { TILE_W, TILE_H } from '../../core/constants.js';

// Ayak noktasına göre yerleşim (px). win: pencere ışığı merkezleri; crate: çıktı sandığı; smoke: baca/buhar çıkışı;
// hub: yel değirmeni kanat göbeği; wheel: iplik çarkı merkezi (hepsi ayağa göre).
export const MCH = {
  dairy:    { key: 'mch_dairy',    w: 260, h: 250, ox: 130, oy: 232, height: 150, shw: 208, win: [[-48, -56], [52, -56]], crate: [78, 3], smoke: null },
  mill:     { key: 'mch_mill',     w: 260, h: 250, ox: 130, oy: 232, height: 196, shw: 130, win: [[0, -78]], crate: [64, 3], smoke: null, hub: [0, -136] },
  bakery:   { key: 'mch_bakery',   w: 260, h: 250, ox: 130, oy: 232, height: 200, shw: 176, win: [[-46, -26], [54, -48]], crate: [92, 3], smoke: [50, -203] },
  cannery:  { key: 'mch_cannery',  w: 260, h: 250, ox: 130, oy: 232, height: 172, shw: 176, win: [[-46, -52], [50, -52]], crate: [86, 3], smoke: [-52, -176] },
  spinning: { key: 'mch_spinning', w: 260, h: 250, ox: 130, oy: 232, height: 142, shw: 190, win: [[-6, -88], [-50, -48]], crate: [92, 3], smoke: null, wheel: [58, -28] },
  loom:     { key: 'mch_loom',     w: 260, h: 250, ox: 130, oy: 232, height: 160, shw: 196, win: [[-62, -52], [0, -122]], crate: [-92, 3], smoke: null },
};
export const MLOT = { x: 26, t: 36, b: 16 };
export const MLOT_KEY = 'mch_lot', MLOT_HL = 'mch_lothl';
export const mSignKey = (t) => `mch_sign_${t}`;
export const SHED = { key: 'mch_shed', w: 190, h: 150, ox: 95, oy: 134, height: 98, shw: 150 };
export const WHEEL = { key: 'mch_wheel', s: 48 };
export const SAILS = { key: 'mch_mill_sails', s: 180 };

const TAU = Math.PI * 2;
const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
const lg = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
const rimLeft = (ctx, x, y0, y1, a = 0.5, w = 1.6) => { ctx.fillStyle = `rgba(255,236,200,${a})`; ctx.fillRect(x, y0, w, y1 - y0); };

function groundAO(ctx, cx, cy, rx, ry, a = 0.4) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
  ctx.fillStyle = radial(ctx, 0, 0, rx, [[0, `rgba(20,12,8,${a})`], [0.7, `rgba(20,12,8,${a * 0.5})`], [1, 'rgba(20,12,8,0)']]);
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
}

/** Dikey tahta duvar */
function planks(ctx, x, y, w, h, base, r, step = 10) {
  const n = Math.max(1, Math.round(w / step)), sz = w / n;
  for (let i = 0; i < n; i++) {
    const c = shade(base, (r() - 0.5) * 0.12), bx = x + i * sz;
    ctx.fillStyle = lg(ctx, bx, 0, bx + sz, 0, [[0, shade(c, 0.14)], [0.5, c], [1, shade(c, -0.2)]]); ctx.fillRect(bx, y, sz, h);
    ctx.strokeStyle = rgba('#2a160c', 0.18); ctx.lineWidth = 0.7; ctx.beginPath();
    const xx = bx + sz * (0.3 + r() * 0.4); ctx.moveTo(xx, y + 2); ctx.lineTo(xx + (r() - 0.5) * 2, y + h - 2); ctx.moveTo(bx + sz, y); ctx.lineTo(bx + sz, y + h); ctx.stroke();
  }
}
/** Yatay bindirme (kaplama) duvar */
function siding(ctx, x, y, w, h, base, r, step = 9) {
  const n = Math.max(1, Math.round(h / step)), sz = h / n;
  for (let i = 0; i < n; i++) {
    const c = shade(base, (r() - 0.5) * 0.06), by = y + i * sz;
    ctx.fillStyle = lg(ctx, 0, by, 0, by + sz, [[0, shade(c, 0.1)], [0.8, c], [1, shade(c, -0.16)]]); ctx.fillRect(x, by, w, sz);
    ctx.fillStyle = rgba('#2a160c', 0.2); ctx.fillRect(x, by + sz - 1.2, w, 1.2);
  }
}
function bricks(ctx, x, y, w, h, base, r) {
  ctx.fillStyle = shade(base, -0.3); ctx.fillRect(x, y, w, h);
  const bh = 7, bw = 15;
  for (let j = 0, yy = y; yy < y + h; j++, yy += bh) {
    for (let xx = x - (j % 2) * bw / 2; xx < x + w; xx += bw) {
      const c = shade(base, (r() - 0.5) * 0.22), x0 = Math.max(x, xx + 0.6), x1 = Math.min(x + w, xx + bw - 0.6);
      if (x1 <= x0) continue;
      ctx.fillStyle = lg(ctx, 0, yy, 0, yy + bh, [[0, shade(c, 0.12)], [1, shade(c, -0.14)]]); ctx.fillRect(x0, yy + 0.6, x1 - x0, bh - 1.2);
    }
  }
  const g = lg(ctx, 0, y, 0, y + h, [[0, 'rgba(255,230,190,0.0)'], [1, 'rgba(20,8,4,0.22)']]); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
/** Taş blok dolgusu — çokgen içine kırpılır */
function stoneFill(ctx, pts, base, r, x0, x1, y0, y1) {
  ctx.save(); poly(ctx, pts); ctx.clip();
  ctx.fillStyle = lg(ctx, x0, 0, x1, 0, [[0, shade(base, 0.2)], [0.45, base], [1, shade(base, -0.32)]]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let j = 0, y = y0; y < y1; j++, y += 13) {
    for (let x = x0 - (j % 2) * 11; x < x1; x += 22) {
      ctx.fillStyle = rgba(r() > 0.5 ? '#fff4dc' : '#3a2e22', 0.08 + r() * 0.1); rrect(ctx, x + 1, y + 1, 20, 11, 4); ctx.fill();
    }
    ctx.fillStyle = rgba('#2a2018', 0.2); ctx.fillRect(x0, y + 12, x1 - x0, 1);
  }
  ctx.restore();
}
function shingleRows(ctx, pts, base, r, y0, y1, x0, x1, rows, sw = 14) {
  ctx.save(); poly(ctx, pts); ctx.clip();
  ctx.fillStyle = lg(ctx, 0, y0, 0, y1, [[0, shade(base, 0.14)], [1, shade(base, -0.2)]]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const rh = (y1 - y0) / rows;
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * rh;
    for (let x = x0 - (j % 2) * sw / 2; x < x1; x += sw) {
      ctx.fillStyle = shade(base, (r() - 0.5) * 0.12 - 0.04 * (j / rows));
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sw, y); ctx.lineTo(x + sw, y + rh * 0.62); ctx.quadraticCurveTo(x + sw / 2, y + rh * 1.2, x, y + rh * 0.62); ctx.fill();
      ctx.fillStyle = rgba('#fff0d0', 0.12); ctx.fillRect(x + 1, y, sw - 2, 1.2);
    }
    ctx.fillStyle = rgba('#1a0c08', 0.2); ctx.fillRect(x0, y + rh * 0.95, x1 - x0, 1.6);
  }
  ctx.restore();
}
/** Kırma çatı: alt kenar (xb0..xb1, yb), üst sırt (xt0..xt1, yt) */
function hipRoof(ctx, xb0, xb1, yb, xt0, xt1, yt, base, r, rows = 5, sw = 14) {
  const pts = [[xb0, yb], [xt0, yt], [xt1, yt], [xb1, yb]];
  shingleRows(ctx, pts, base, r, yt, yb, xb0, xb1, rows, sw);
  // saçak kalınlığı + sırt çizgisi + sol kenar ışığı
  ctx.fillStyle = rgba('#1a0c08', 0.5); ctx.fillRect(xb0, yb - 1, xb1 - xb0, 5);
  ctx.fillStyle = lg(ctx, 0, yb + 4, 0, yb + 9, [[0, rgba('#1a0c08', 0.32)], [1, rgba('#1a0c08', 0)]]); ctx.fillRect(xb0 + 2, yb + 4, xb1 - xb0 - 4, 5);
  ctx.strokeStyle = shade(base, 0.38); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(xt0, yt + 1); ctx.lineTo(xt1, yt + 1); ctx.stroke();
  ctx.strokeStyle = rgba('#fff0d0', 0.5); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(xb0 + 1, yb - 1); ctx.lineTo(xt0 + 1, yt + 2); ctx.stroke();
}
function windowBox(ctx, x, y, w, h, o = {}) {
  ctx.fillStyle = o.frame || '#f0e6cf'; rrect(ctx, x - 3, y - 3, w + 6, h + 6, 3); ctx.fill();
  ctx.fillStyle = lg(ctx, 0, y, 0, y + h, [[0, o.top || '#7fa0b8'], [1, o.bot || '#2f4258']]); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; poly(ctx, [[x, y], [x + w * 0.62, y], [x, y + h * 0.72]]); ctx.fill();
  ctx.fillStyle = o.frame || '#f0e6cf'; ctx.fillRect(x + w / 2 - 1, y, 2, h); ctx.fillRect(x, y + h / 2 - 1, w, 2);
  if (o.shutter) { ctx.fillStyle = o.shutter; ctx.fillRect(x - 3 - w * 0.4, y - 3, w * 0.4, h + 6); ctx.fillRect(x + w + 3, y - 3, w * 0.4, h + 6); }
  if (o.box) {
    ctx.fillStyle = '#7a5236'; rrect(ctx, x - 4, y + h + 2, w + 8, 7, 2); ctx.fill();
    const cols = o.box === true ? ['#e86a5a', '#f2c94c', '#f08fb0'] : o.box;
    for (let i = 0; i < 5; i++) ell(ctx, x - 1 + i * (w + 2) / 4, y + h + 1, 3.2, 3, cols[i % cols.length]);
    ctx.fillStyle = '#4f8a3a'; for (let i = 0; i < 4; i++) ell(ctx, x + 2 + i * (w - 2) / 3.2, y + h + 3.6, 3, 1.8, '#4f8a3a');
  }
}
function archDoor(ctx, x, y, w, h, col, r, o = {}) {
  ctx.fillStyle = shade(col, -0.5); ctx.beginPath(); ctx.moveTo(x - 3, y + h); ctx.lineTo(x - 3, y + w / 2); ctx.arc(x + w / 2, y + w / 2, w / 2 + 3, Math.PI, 0); ctx.lineTo(x + w + 3, y + h); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2); ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.clip();
  planks(ctx, x, y, w, h, col, r, 8);
  if (o.double) { ctx.fillStyle = rgba('#1a0c08', 0.45); ctx.fillRect(x + w / 2 - 0.8, y, 1.6, h); }
  ctx.fillStyle = rgba('#1a0c08', 0.2); ctx.fillRect(x, y + h * 0.5, w, 2); ctx.fillRect(x, y + h * 0.82, w, 2);
  ctx.restore();
  ell(ctx, x + w * (o.double ? 0.38 : 0.78), y + h * 0.58, 1.6, 1.6, '#e8c870');
  rimLeft(ctx, x, y + w / 2, y + h, 0.35, 1.2);
}
function plaque(ctx, cx, cy, r0, fill) {
  ell(ctx, cx, cy + 1.5, r0 + 2, r0 + 2, rgba('#1a0c08', 0.25)); ell(ctx, cx, cy, r0 + 2, r0 + 2, '#7a5236'); ell(ctx, cx, cy, r0, r0, fill);
  ell(ctx, cx - r0 * 0.3, cy - r0 * 0.35, r0 * 0.4, r0 * 0.28, rgba('#fff', 0.35), -0.5);
}
function foundation(ctx, x0, x1, F, r) {
  for (let x = x0; x < x1; x += 15) ell(ctx, x + 7.5, F - 3, 8.4, 4.6, shade('#8d8a84', (r() - 0.5) * 0.22));
}
function barrel(ctx, x, y, s = 1) {
  ctx.fillStyle = lg(ctx, x - 9 * s, 0, x + 9 * s, 0, [[0, '#b98a58'], [0.5, '#9a6a3c'], [1, '#6a4524']]);
  ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 20 * s); ctx.quadraticCurveTo(x - 11 * s, y - 10 * s, x - 7 * s, y); ctx.lineTo(x + 7 * s, y); ctx.quadraticCurveTo(x + 11 * s, y - 10 * s, x + 7 * s, y - 20 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4a4a50'; ctx.fillRect(x - 9 * s, y - 15 * s, 18 * s, 2); ctx.fillRect(x - 9 * s, y - 5 * s, 18 * s, 2);
  ell(ctx, x, y - 20 * s, 7 * s, 2.4 * s, '#c79a64');
}
function crateBox(ctx, x, y, w, h, col = '#b98558') {
  ctx.fillStyle = lg(ctx, 0, y - h, 0, y, [[0, shade(col, 0.1)], [1, shade(col, -0.25)]]); rrect(ctx, x, y - h, w, h, 2); ctx.fill();
  ctx.strokeStyle = rgba('#2a160c', 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 1, y - h * 0.5); ctx.lineTo(x + w - 1, y - h * 0.5); ctx.stroke();
  ctx.fillStyle = rgba('#fff0d0', 0.3); ctx.fillRect(x + 1, y - h, w - 2, 1.4);
}

// ------------------------------------------------------------------ MANDIRA
function genDairy(scene) {
  const L = MCH.dairy; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5101), F = L.oy;
  groundAO(ctx, 130, F, 124, 15, 0.42);
  siding(ctx, 48, 138, 164, F - 138, '#f3f0e8', r, 9);
  planks(ctx, 48, 200, 164, F - 200, '#86aed0', r, 9);
  rimLeft(ctx, 48, 138, F, 0.55); foundation(ctx, 46, 212, F, r);
  ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(48, 199, 164, 1.6);
  // çatı + kubbe/pencere
  hipRoof(ctx, 34, 226, 148, 66, 194, 82, '#4d7cab', r, 5, 14);
  ctx.fillStyle = '#f3f0e8'; poly(ctx, [[112, 100], [148, 100], [152, 84], [108, 84]]); ctx.fill();
  windowBox(ctx, 119, 88, 22, 12, { top: '#a9cfe6', bot: '#5d84a6' });
  hipRoof(ctx, 104, 156, 86, 118, 142, 70, '#3f6a96', r, 2, 12);
  // kapı + levha
  archDoor(ctx, 111, 172, 38, 60, '#3f6f9e', r, { double: true });
  plaque(ctx, 130, 160, 10, '#f6f8fa');
  ctx.fillStyle = '#4f8fcf'; ctx.beginPath(); ctx.moveTo(130, 153); ctx.bezierCurveTo(124, 161, 125, 167, 130, 167); ctx.bezierCurveTo(135, 167, 136, 161, 130, 153); ctx.fill();
  ell(ctx, 128, 160, 1.4, 2.4, rgba('#fff', 0.7), 0.3);
  windowBox(ctx, 66, 164, 30, 28, { shutter: '#5a86b0', box: true });
  windowBox(ctx, 164, 164, 30, 28, { shutter: '#5a86b0', box: ['#f5f0e0', '#f08fb0', '#f2c94c'] });
  // süt bidonları
  for (const [x, s] of [[224, 1], [240, 0.9]]) {
    const y = F - 2; ctx.fillStyle = lg(ctx, x - 8, 0, x + 8, 0, [[0, '#f4f6f8'], [0.5, '#c4ccd4'], [1, '#7d8794']]);
    rrect(ctx, x - 7 * s, y - 28 * s, 14 * s, 26 * s, 4 * s); ctx.fill(); ell(ctx, x, y - 29 * s, 5 * s, 3 * s, '#9aa4b0'); ell(ctx, x, y - 32 * s, 3 * s, 2 * s, '#5d6672');
    ctx.fillStyle = '#3f6f9e'; ctx.fillRect(x - 7 * s, y - 16 * s, 14 * s, 3 * s); ell(ctx, x + 2 * s, y - 22 * s, 4 * s, 1.6 * s, rgba('#fff', 0.55), -0.5);
  }
  ctx.fillStyle = rgba('#fff0d0', 0.4); ctx.fillRect(34, 146, 100, 1.4);
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ DEĞİRMEN
function genMill(scene) {
  const L = MCH.mill; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5202), F = L.oy;
  groundAO(ctx, 130, F, 96, 13, 0.42);
  // un çuvalları + el arabası tarafı
  for (const [x, y, rot] of [[176, F - 2, -0.1], [190, F - 2, 0.12], [183, F - 14, 0.05]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = lg(ctx, -8, 0, 8, 0, [[0, '#f6efe0'], [1, '#c9bda4']]);
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(-10, -9, -6, -13); ctx.lineTo(6, -13); ctx.quadraticCurveTo(10, -9, 8, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8a888'; ctx.fillRect(-6, -14, 12, 2.6); ctx.restore();
  }
  // kule gövdesi (hafif konik)
  const tower = [[74, F], [90, 116], [170, 116], [186, F]];
  stoneFill(ctx, tower, '#cdc2b0', r, 70, 190, 110, F);
  rimLeft(ctx, 78, 130, F - 6, 0.3, 2);
  // üst balkon halkası
  ctx.fillStyle = lg(ctx, 0, 112, 0, 124, [[0, '#9a6e44'], [1, '#5d3d22']]); rrect(ctx, 84, 112, 92, 9, 3); ctx.fill();
  ctx.fillStyle = rgba('#fff0d0', 0.4); ctx.fillRect(86, 112, 88, 1.4);
  // çan çatı (ahşap)
  ctx.fillStyle = lg(ctx, 80, 0, 180, 0, [[0, '#b0603f'], [0.5, '#8a4b32'], [1, '#52291a']]);
  ctx.beginPath(); ctx.moveTo(80, 113); ctx.quadraticCurveTo(84, 88, 130, 62); ctx.quadraticCurveTo(176, 88, 180, 113); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); for (let y = 66; y < 112; y += 7) { ctx.fillStyle = rgba('#1a0c08', 0.22); ctx.fillRect(70, y, 120, 1.4); ctx.fillStyle = rgba('#fff0d0', 0.08); ctx.fillRect(70, y + 1.4, 120, 1); } ctx.restore();
  ctx.strokeStyle = rgba('#fff0d0', 0.5); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(86, 108); ctx.quadraticCurveTo(92, 86, 128, 64); ctx.stroke();
  ell(ctx, 130, 62, 3, 3, '#e8c870');
  // kapı + pencere
  archDoor(ctx, 114, 188, 32, 44, '#6b4a30', r);
  windowBox(ctx, 120, 146, 20, 22, { frame: '#e8dcc0', shutter: '#8a4b32' });
  // temel taşları
  foundation(ctx, 70, 190, F, r);
  // göbek (kanatlar ayrı sprite)
  ell(ctx, 130, 96, 11, 11, '#6b4a30'); ell(ctx, 128, 94, 6, 6, '#9a7048');
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
  // ---- kanatlar (göbek merkezde)
  const S = SAILS.s, { canvas: sc, ctx: c2 } = makeCanvas(S, S); const rr = mulberry32(5203);
  c2.translate(S / 2, S / 2);
  for (let k = 0; k < 4; k++) {
    c2.save(); c2.rotate(k * Math.PI / 2 + Math.PI / 4);
    c2.fillStyle = '#5d3d22'; c2.fillRect(8, -2.6, 76, 5.2);                       // ana kiriş
    c2.fillStyle = lg(c2, 0, -2.6, 0, 2.6, [[0, '#9a7048'], [1, '#4a2e1a']]); c2.fillRect(8, -2.6, 76, 5.2);
    c2.fillStyle = lg(c2, 0, 2, 0, 19, [[0, '#efe3c6'], [1, '#c8b890']]); c2.fillRect(18, 2.6, 62, 17); // bez
    c2.strokeStyle = '#6b4a30'; c2.lineWidth = 1.8; c2.strokeRect(18, 2.6, 62, 17);
    for (let x = 28; x < 80; x += 10) { c2.beginPath(); c2.moveTo(x, 2.6); c2.lineTo(x, 19.6); c2.stroke(); }
    c2.beginPath(); c2.moveTo(18, 11); c2.lineTo(80, 11); c2.stroke();
    c2.fillStyle = rgba('#fff', 0.35); c2.fillRect(19, 3.6, 60, 1.4);
    c2.restore();
  }
  c2.fillStyle = lg(c2, -9, -9, 9, 9, [[0, '#a07850'], [1, '#4a2e1a']]); c2.beginPath(); c2.arc(0, 0, 9, 0, TAU); c2.fill();
  ell(c2, -2, -3, 4, 3, rgba('#fff0d0', 0.4)); ell(c2, 0, 0, 2.6, 2.6, '#2a1a0e');
  void rr;
  register(scene, SAILS.key, sc);
}

// ------------------------------------------------------------------ FIRIN
function genBakery(scene) {
  const L = MCH.bakery; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5303), F = L.oy;
  groundAO(ctx, 130, F, 112, 14, 0.42);
  // baca (çatının arkasında)
  bricks(ctx, 168, 40, 26, 90, '#a8523a', r); rimLeft(ctx, 168, 40, 130, 0.4, 1.6);
  ctx.fillStyle = '#5a2a1c'; rrect(ctx, 164, 30, 34, 12, 3); ctx.fill(); ctx.fillStyle = '#1a0c08'; ctx.fillRect(170, 31, 22, 5); ctx.fillStyle = rgba('#fff0d0', 0.35); ctx.fillRect(165, 30, 32, 1.4);
  // duvar
  bricks(ctx, 52, 138, 156, F - 138, '#b9603f', r); rimLeft(ctx, 52, 138, F, 0.5); foundation(ctx, 50, 208, F, r);
  // çatı
  hipRoof(ctx, 38, 222, 146, 62, 198, 92, '#5b4a44', r, 4, 15);
  // fırın ağzı (kemer) + parıltı
  ctx.fillStyle = '#4a4440'; ctx.beginPath(); ctx.moveTo(62, F); ctx.lineTo(62, 196); ctx.arc(85, 196, 23, Math.PI, 0); ctx.lineTo(108, F); ctx.fill();
  ctx.fillStyle = radial(ctx, 85, 216, 26, [[0, '#fff0a8'], [0.35, '#ffb347'], [0.8, '#e8541e'], [1, '#6a1e10']]);
  ctx.beginPath(); ctx.moveTo(67, F); ctx.lineTo(67, 197); ctx.arc(85, 197, 18, Math.PI, 0); ctx.lineTo(103, F); ctx.fill();
  ctx.fillStyle = rgba('#1a0c08', 0.55); for (const x of [74, 85, 96]) ctx.fillRect(x - 0.8, 198, 1.6, 34);
  // kapı + tente
  archDoor(ctx, 128, 178, 28, 54, '#6b4a30', r);
  const aw = [[120, 164], [166, 164], [172, 180], [114, 180]];
  ctx.save(); poly(ctx, aw); ctx.clip(); for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f6ecd4' : '#d9733a'; ctx.fillRect(114 + i * 7.2, 160, 7.2, 24); } ctx.restore();
  ctx.fillStyle = rgba('#1a0c08', 0.25); ctx.fillRect(114, 180, 58, 2.4);
  // pencere (sıcak) + ekmek levhası
  windowBox(ctx, 170, 158, 26, 26, { top: '#ffd486', bot: '#d98a3a', shutter: '#6b3a28' });
  plaque(ctx, 88, 156, 9, '#f3e6c4');
  ell(ctx, 88, 157, 6.5, 3.8, '#c98a4a'); ell(ctx, 86.5, 155.8, 3.4, 1.4, '#e8b574'); ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 1; for (const x of [84, 88, 92]) { ctx.beginPath(); ctx.moveTo(x - 1, 154.6); ctx.lineTo(x + 1, 158.6); ctx.stroke(); }
  // odun yığını
  for (let i = 0; i < 6; i++) { const x = 212 + (i % 3) * 9, y = F - 3 - Math.floor(i / 3) * 8; ell(ctx, x, y, 5.2, 4.4, '#8a5a34'); ell(ctx, x, y, 3.2, 2.6, '#d9b27a'); }
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ KONSERVE
function genCannery(scene) {
  const L = MCH.cannery; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5404), F = L.oy;
  groundAO(ctx, 130, F, 114, 14, 0.42);
  // teneke baca (çatının arkasında)
  ctx.fillStyle = lg(ctx, 66, 0, 88, 0, [[0, '#c4ccd0'], [0.5, '#8d979c'], [1, '#515a60']]); ctx.fillRect(68, 74, 20, 56);
  ell(ctx, 78, 74, 12, 4.4, '#6a747a'); ell(ctx, 78, 73.5, 8.6, 2.6, '#1c2226'); ctx.fillStyle = rgba('#fff', 0.35); ctx.fillRect(69, 76, 2, 50);
  siding(ctx, 56, 148, 148, F - 148, '#ead9a4', r, 9); rimLeft(ctx, 56, 148, F, 0.55); foundation(ctx, 54, 204, F, r);
  // oluklu teneke çatı
  hipRoof(ctx, 42, 218, 156, 70, 190, 104, '#5f8f7a', r, 4, 12);
  ctx.save(); poly(ctx, [[42, 156], [70, 104], [190, 104], [218, 156]]); ctx.clip();
  for (let x = 40; x < 220; x += 7) { ctx.fillStyle = rgba('#e8fff2', 0.12); ctx.fillRect(x, 100, 1.6, 60); ctx.fillStyle = rgba('#0c2018', 0.16); ctx.fillRect(x + 3.5, 100, 1.4, 60); }
  ctx.restore();
  // kırmızı kapı
  archDoor(ctx, 112, 176, 36, 56, '#c93a3f', r, { double: true });
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(108, 174, 44, 3);
  // pencereler + kavanoz silüetleri
  for (const x of [66, 168]) {
    windowBox(ctx, x, 168, 26, 24, { shutter: '#c93a3f', top: '#d8c79a', bot: '#8a7448' });
    ctx.fillStyle = rgba('#3a2814', 0.5); ctx.fillRect(x, 186, 26, 2);
    for (const [j, c] of [[3, '#c8303a'], [10, '#7a3d8f'], [17, '#e8902a']]) { ctx.fillStyle = c; rrect(ctx, x + j, 174, 6, 12, 2); ctx.fill(); ctx.fillStyle = '#c9ced2'; ctx.fillRect(x + j, 172.4, 6, 2.6); }
  }
  plaque(ctx, 130, 160, 9, '#f6f2e6');
  ctx.fillStyle = '#c93a3f'; rrect(ctx, 125, 156, 10, 11, 2); ctx.fill(); ctx.fillStyle = '#c9ced2'; ctx.fillRect(125, 154.4, 10, 3); ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(127, 158, 1.8, 7);
  barrel(ctx, 218, F - 1, 0.95); crateBox(ctx, 226, F - 1, 22, 15); crateBox(ctx, 229, F - 16, 18, 13, '#a87648');
  for (const [x, c] of [[231, '#c8303a'], [238, '#7a3d8f'], [244, '#e8902a']]) { ctx.fillStyle = c; rrect(ctx, x - 3, F - 34, 6, 10, 2); ctx.fill(); ctx.fillStyle = '#c9ced2'; ctx.fillRect(x - 3, F - 35.5, 6, 2.4); }
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ İPLİKHANE
function genSpinning(scene) {
  const L = MCH.spinning; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5505), F = L.oy;
  groundAO(ctx, 130, F, 120, 14, 0.42);
  planks(ctx, 50, 144, 160, F - 144, '#d4b88c', r, 10); rimLeft(ctx, 50, 144, F, 0.55); foundation(ctx, 48, 210, F, r);
  // üst kiriş + çapraz destek
  ctx.fillStyle = '#7a5236'; ctx.fillRect(50, 144, 160, 5); ctx.fillRect(50, 222, 160, 4);
  hipRoof(ctx, 36, 224, 150, 62, 198, 90, '#a8764a', r, 5, 15);
  // yuvarlak çark penceresi
  const cx = 124, cy = 124;
  ell(ctx, cx, cy, 15, 15, '#7a5236'); ell(ctx, cx, cy, 12.5, 12.5, lg(ctx, 0, cy - 12, 0, cy + 12, [['0', '#e8dcc0'], ['1', '#b8a37c']]));
  ctx.strokeStyle = '#7a5236'; ctx.lineWidth = 1.6; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12); ctx.stroke(); }
  ell(ctx, cx, cy, 2.6, 2.6, '#7a5236');
  // kapı + pencere
  archDoor(ctx, 74, 180, 32, 52, '#8a5a34', r);
  windowBox(ctx, 120, 166, 28, 28, { shutter: '#8a5a34', box: ['#f5f0e0', '#e8dccb', '#c9a9d9'] });
  // yün çile askılığı (sağ duvar)
  ctx.fillStyle = '#7a5236'; ctx.fillRect(160, 164, 40, 4);
  for (const [x, c] of [[166, '#f4efe4'], [178, '#e8dccb'], [190, '#cfc0f0']]) {
    ctx.strokeStyle = shade(c, -0.1); ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 3, 168); ctx.quadraticCurveTo(x - 7, 188, x - 1, 194); ctx.moveTo(x + 3, 168); ctx.quadraticCurveTo(x + 7, 188, x + 1, 194); ctx.stroke();
    ctx.strokeStyle = shade(c, 0.35); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 4, 172); ctx.quadraticCurveTo(x - 7, 186, x - 2, 191); ctx.stroke();
  }
  // yün balyası
  ell(ctx, 50, F - 7, 14, 9, '#f2ecdf'); ell(ctx, 46, F - 10, 8, 4.6, rgba('#fff', 0.7)); ell(ctx, 56, F - 4, 9, 4, rgba('#b8a888', 0.5));
  // çark sehpası (çark ayrı sprite)
  ctx.fillStyle = '#6b4a30'; poly(ctx, [[176, F - 1], [180, F - 24], [184, F - 24], [182, F - 1]]); ctx.fill(); poly(ctx, [[196, F - 1], [192, F - 24], [188, F - 24], [192, F - 1]]); ctx.fill();
  ctx.fillRect(172, F - 3, 28, 3);
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
  // iplik çarkı
  const S = WHEEL.s, { canvas: wc, ctx: w } = makeCanvas(S, S); w.translate(S / 2, S / 2);
  w.strokeStyle = '#8a5a34'; w.lineWidth = 3.4; w.beginPath(); w.arc(0, 0, 19, 0, TAU); w.stroke();
  w.strokeStyle = '#c9a066'; w.lineWidth = 1.2; w.beginPath(); w.arc(-0.8, -0.8, 19, Math.PI * 1.05, Math.PI * 1.6); w.stroke();
  w.strokeStyle = '#6b4a30'; w.lineWidth = 2; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; w.beginPath(); w.moveTo(0, 0); w.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); w.stroke(); }
  w.strokeStyle = '#efe6d2'; w.lineWidth = 1; w.beginPath(); w.arc(0, 0, 11, 0, TAU); w.stroke();
  ell(w, 0, 0, 3.4, 3.4, '#3a2410');
  register(scene, WHEEL.key, wc);
}

// ------------------------------------------------------------------ DOKUMA
function genLoom(scene) {
  const L = MCH.loom; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5606), F = L.oy;
  groundAO(ctx, 130, F, 122, 14, 0.42);
  // yarı ahşap iskelet: sıvalı paneller + koyu kirişler
  ctx.fillStyle = lg(ctx, 48, 0, 212, 0, [[0, '#efe3ca'], [1, '#d3c3a2']]); ctx.fillRect(48, 140, 164, F - 140);
  for (let i = 0; i < 80; i++) { ell(ctx, 48 + r() * 164, 142 + r() * (F - 146), 1.2, 0.8, rgba('#8a7a5a', 0.14)); }
  ctx.fillStyle = '#6b4a30';
  for (const x of [48, 88, 172, 208]) ctx.fillRect(x - 2, 140, 5, F - 140);
  ctx.fillRect(48, 140, 164, 5); ctx.fillRect(48, 186, 164, 4); ctx.fillRect(48, F - 6, 164, 6);
  ctx.strokeStyle = '#6b4a30'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(50, 188); ctx.lineTo(88, 146); ctx.moveTo(210, 188); ctx.lineTo(172, 146); ctx.stroke();
  rimLeft(ctx, 46, 140, F, 0.55); foundation(ctx, 46, 212, F, r);
  // mor çatı + çatı penceresi
  hipRoof(ctx, 34, 226, 148, 62, 198, 88, '#5a4682', r, 5, 14);
  ctx.fillStyle = '#efe3ca'; poly(ctx, [[104, 112], [156, 112], [160, 92], [100, 92]]); ctx.fill();
  hipRoof(ctx, 96, 164, 94, 112, 148, 74, '#4a3870', r, 2, 12);
  windowBox(ctx, 116, 98, 28, 12, { frame: '#6b4a30', top: '#caa8ee', bot: '#7a5aa8' });
  // geniş kapı + çizgili tente
  archDoor(ctx, 108, 184, 44, 48, '#8a5a34', r, { double: true });
  ctx.save(); poly(ctx, [[98, 168], [162, 168], [170, 186], [90, 186]]); ctx.clip(); for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#f6ecd4' : '#7a5aa8'; ctx.fillRect(90 + i * 8, 164, 8, 26); } ctx.restore();
  ctx.fillStyle = rgba('#1a0c08', 0.25); ctx.fillRect(90, 186, 80, 2.4);
  windowBox(ctx, 56, 164, 26, 26, { frame: '#6b4a30', shutter: '#7a5aa8' });
  // renkli kumaş uçları (asılı)
  ctx.fillStyle = '#6b4a30'; ctx.fillRect(176, 160, 38, 4);
  const cols = ['#7a5aa8', '#2fa39a', '#e8902a', '#d9507a'];
  cols.forEach((c, i) => {
    const x = 178 + i * 9.4, len = 38 + (i % 2) * 8;
    ctx.fillStyle = lg(ctx, x, 0, x + 8, 0, [[0, shade(c, 0.22)], [1, shade(c, -0.2)]]); poly(ctx, [[x, 164], [x + 8.6, 164], [x + 8.6, 164 + len], [x + 4.3, 164 + len - 5], [x, 164 + len]]); ctx.fill();
    ctx.fillStyle = rgba('#fff', 0.28); for (let y = 172; y < 164 + len - 6; y += 8) ctx.fillRect(x, y, 8.6, 1.6);
  });
  plaque(ctx, 130, 160, 9, '#f4eaff');
  ctx.strokeStyle = '#7a5aa8'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(123, 160); for (let i = 1; i <= 5; i++) ctx.lineTo(123 + i * 2.8, 160 + (i % 2 ? -4 : 4)); ctx.stroke();
  // kumaş balyası (sol, yerde)
  for (let i = 0; i < 3; i++) { const c = cols[i], y = F - 4 - i * 9; ctx.fillStyle = lg(ctx, 0, y - 6, 0, y + 6, [[0, shade(c, 0.2)], [1, shade(c, -0.22)]]); rrect(ctx, 14 + (i % 2) * 4, y - 6, 28, 12, 6); ctx.fill(); ell(ctx, 18 + (i % 2) * 4, y, 4.6, 6, shade(c, 0.28)); }
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ EŞEK SUNDURMASI
function genShed(scene) {
  const L = SHED; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(5707), F = L.oy;
  groundAO(ctx, 95, F, 82, 11, 0.4);
  // arka duvar (tahta) + saman zemin
  planks(ctx, 22, 62, 146, F - 70, '#a77a50', r, 11);
  ctx.fillStyle = lg(ctx, 0, 62, 0, F, [[0, 'rgba(20,10,5,0.3)'], [1, 'rgba(20,10,5,0.0)']]); ctx.fillRect(22, 62, 146, F - 70);
  ell(ctx, 95, F - 4, 76, 8, '#c9a45a'); ell(ctx, 90, F - 6, 60, 5, '#e2c274');
  ctx.lineCap = 'round'; for (let i = 0; i < 70; i++) { const x = 28 + r() * 134, y = F - 11 + r() * 12, a = (r() - 0.5) * 2; ctx.strokeStyle = shade('#e8cc7e', (r() - 0.5) * 0.3); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 2.6); ctx.stroke(); }
  // yem yalağı + su kovası (sağ)
  ctx.fillStyle = lg(ctx, 0, F - 24, 0, F - 4, [[0, '#9a6a3c'], [1, '#5d3d22']]); poly(ctx, [[128, F - 22], [164, F - 22], [160, F - 4], [132, F - 4]]); ctx.fill();
  ell(ctx, 146, F - 22, 18, 3.6, '#d9b457'); for (let i = 0; i < 16; i++) { const x = 131 + r() * 30; ctx.strokeStyle = shade('#e8cc7e', (r() - 0.5) * 0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, F - 21); ctx.lineTo(x + (r() - 0.5) * 8, F - 28 - r() * 3); ctx.stroke(); }
  // saman balyası (sol)
  ctx.fillStyle = lg(ctx, 0, F - 30, 0, F - 6, [[0, '#e8cc7e'], [1, '#b38c44']]); rrect(ctx, 26, F - 30, 34, 26, 4); ctx.fill();
  for (let y = F - 28; y < F - 8; y += 4) { ctx.strokeStyle = rgba('#7a5a24', 0.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(58, y + (r() - 0.5) * 2); ctx.stroke(); }
  ctx.fillStyle = '#6b4a30'; ctx.fillRect(34, F - 30, 2, 26); ctx.fillRect(50, F - 30, 2, 26);
  // direkler
  for (const x of [18, 164]) { ctx.fillStyle = lg(ctx, x, 0, x + 9, 0, [[0, '#c9a066'], [1, '#6b4a30']]); rrect(ctx, x, 44, 9, F - 44, 2); ctx.fill(); rimLeft(ctx, x, 46, F - 4, 0.4, 1.3); }
  // çatı: tek yönlü eğimli, küçük ahşap
  hipRoof(ctx, 6, 184, 66, 22, 168, 28, '#8a5a38', r, 4, 14);
  ctx.fillStyle = rgba('#fff0d0', 0.18); ctx.fillRect(10, 64, 170, 1.4);
  ctx.fillStyle = lg(ctx, 0, 66, 0, 80, [[0, rgba('#1a0c08', 0.38)], [1, rgba('#1a0c08', 0)]]); ctx.fillRect(20, 68, 150, 12);
  register(scene, L.key, canvas, { w: L.w, h: L.h }); registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ ARSA / TABELA / SANDIK / IS / DUMAN
function drawStake(ctx, x, y, h, w, back) {
  ctx.fillStyle = lg(ctx, x - w / 2, 0, x + w / 2, 0, [[0, back ? '#b08a5a' : '#c9a066'], [1, '#5d3d22']]);
  ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2 + 0.6, y - h + 3); ctx.lineTo(x, y - h); ctx.lineTo(x + w / 2 - 0.6, y - h + 3); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
  ell(ctx, x, y, w * 0.9, 1.8, rgba('#1a0c08', 0.4));
}
function rope(ctx, x0, y0, x1, y1, sag) {
  ctx.strokeStyle = '#d9c28a'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1); ctx.stroke();
  ctx.strokeStyle = rgba('#6b5428', 0.5); ctx.lineWidth = 0.8; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x0, y0 + 0.5); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag + 0.5, x1, y1 + 0.5); ctx.stroke(); ctx.setLineDash([]);
}
function genLot(scene) {
  if (scene.textures.exists(MLOT_KEY)) return;
  const W = 4 * TILE_W, H = 3 * TILE_H, CW = W + MLOT.x * 2, CH = H + MLOT.t + MLOT.b, r = mulberry32(5801);
  const { canvas, ctx } = makeCanvas(CW, CH); const px0 = MLOT.x, py0 = MLOT.t, px1 = px0 + W, py1 = py0 + H;
  ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px0, py0, W, H, 18) : ctx.rect(px0, py0, W, H); ctx.clip();
  ctx.fillStyle = lg(ctx, 0, py0, 0, py1, [[0, '#8a6a46'], [1, '#6e5236']]); ctx.fillRect(px0, py0, W, H);
  for (let i = 0; i < 420; i++) ell(ctx, px0 + r() * W, py0 + r() * H, 1 + r() * 2.4, 0.8 + r() * 1.2, rgba(r() > 0.5 ? '#c9a878' : '#3a2616', 0.16 + r() * 0.12));
  const vg = ctx.createRadialGradient(CW / 2, py0 + H / 2, 20, CW / 2, py0 + H / 2, W * 0.55); vg.addColorStop(0, 'rgba(255,230,180,0.1)'); vg.addColorStop(1, 'rgba(20,10,5,0.22)'); ctx.fillStyle = vg; ctx.fillRect(px0, py0, W, H);
  ctx.restore();
  for (let i = 0; i < 40; i++) {
    const t = r(), side = i % 4; let x, y;
    if (side === 0) { x = px0 + t * W; y = py0 - 1; } else if (side === 1) { x = px0 + t * W; y = py1 + 2; } else if (side === 2) { x = px0 - 2; y = py0 + t * H; } else { x = px1 + 2; y = py0 + t * H; }
    ctx.strokeStyle = shade('#5d9a45', (r() - 0.5) * 0.3); ctx.lineWidth = 1.3;
    for (let b = -1; b <= 1; b++) { ctx.beginPath(); ctx.moveTo(x + b * 2, y); ctx.quadraticCurveTo(x + b * 3, y - 4, x + b * 4.5, y - 7 - r() * 3); ctx.stroke(); }
  }
  const xs = [px0 - 2, px0 + W / 2, px1 + 2], rh = 17;
  for (let i = 0; i < 2; i++) rope(ctx, xs[i], py0 - rh + 1, xs[i + 1], py0 - rh + 1, 4);
  for (const x of xs) drawStake(ctx, x, py0 + 1, 21, 4.6, true);
  for (const x of [xs[0], xs[2]]) rope(ctx, x, py0 - rh + 1, x, py1 - rh + 1, 3);
  for (let i = 0; i < 2; i++) rope(ctx, xs[i], py1 - rh + 1, xs[i + 1], py1 - rh + 1, 5);
  for (const x of xs) drawStake(ctx, x, py1 + 1, 24, 5, false);
  register(scene, MLOT_KEY, canvas, { w: CW, h: CH });
  const { canvas: hc, ctx: h } = makeCanvas(CW, CH);
  h.fillStyle = radial(h, CW / 2, py0 + H / 2, Math.max(CW, CH) * 0.62, [[0, 'rgba(255,214,140,0.55)'], [0.7, 'rgba(255,190,110,0.28)'], [1, 'rgba(255,190,110,0)']]);
  h.save(); h.translate(CW / 2, py0 + H / 2); h.scale(1, (H + 24) / (W + 24)); h.translate(-CW / 2, -(py0 + H / 2)); h.beginPath(); h.arc(CW / 2, py0 + H / 2, (W + 24) / 2, 0, TAU); h.fill(); h.restore();
  h.strokeStyle = 'rgba(255,230,170,0.9)'; h.lineWidth = 2.5; rrect(h, px0 - 1, py0 - 1, W + 2, H + 2, 14); h.stroke();
  register(scene, MLOT_HL, hc, { w: CW, h: CH });
}

function genSigns(scene) {
  const SW = 38, SH = 52;
  for (const type of Object.keys(MACHINES)) {
    const key = mSignKey(type); if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(SW, SH);
    groundAO(ctx, 19, 49, 9, 2.4, 0.4); drawStake(ctx, 19, 50, 36, 4.4, false);
    const bx = 3, by = 4, bw = 32, bh = 26, cx = 19, cy = 17;
    ctx.fillStyle = '#7a5236'; rrect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 5); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, by, 0, by + bh, [[0, '#f3e6c4'], [1, '#d7c294']]); rrect(ctx, bx, by, bw, bh, 4); ctx.fill();
    ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(bx + 2, by + 1, bw - 4, 1.4);
    if (type === 'dairy') { ctx.fillStyle = '#4f8fcf'; ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.bezierCurveTo(cx - 9, cy + 1, cx - 8, cy + 9, cx, cy + 9); ctx.bezierCurveTo(cx + 8, cy + 9, cx + 9, cy + 1, cx, cy - 10); ctx.fill(); ell(ctx, cx - 3, cy + 1, 1.8, 3.4, rgba('#fff', 0.7), 0.3); }
    else if (type === 'mill') { ctx.strokeStyle = '#8a4b32'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); ctx.stroke(); } ell(ctx, cx, cy, 2.6, 2.6, '#5d3d22'); }
    else if (type === 'bakery') { ell(ctx, cx, cy + 1, 11, 7, '#c98a4a'); ell(ctx, cx - 2, cy - 1, 6, 2.6, '#e8b574'); ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 1.4; for (const x of [-4, 1, 6]) { ctx.beginPath(); ctx.moveTo(cx + x - 1.5, cy - 3); ctx.lineTo(cx + x + 1.5, cy + 3); ctx.stroke(); } }
    else if (type === 'cannery') { ctx.fillStyle = '#c8303a'; rrect(ctx, cx - 6, cy - 6, 12, 15, 3); ctx.fill(); ctx.fillStyle = '#c9ced2'; ctx.fillRect(cx - 6, cy - 9, 12, 4); ctx.fillStyle = rgba('#fff', 0.55); ctx.fillRect(cx - 3.5, cy - 4, 2, 11); ell(ctx, cx + 1, cy + 2, 3, 3.6, '#f6e8c0'); }
    else if (type === 'spinning') { ell(ctx, cx, cy, 9, 9, '#efe6d2'); ctx.strokeStyle = '#b9a98a'; ctx.lineWidth = 1.2; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, 9, 4 + k * 1.5, k * 0.7, 0, TAU); ctx.stroke(); } ctx.strokeStyle = '#efe6d2'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(cx + 7, cy + 6); ctx.quadraticCurveTo(cx + 13, cy + 8, cx + 11, cy + 4); ctx.stroke(); }
    else { ctx.fillStyle = '#7a5aa8'; ctx.fillRect(cx - 10, cy - 8, 20, 16); ctx.strokeStyle = '#2fa39a'; ctx.lineWidth = 2; ctx.beginPath(); for (let x = -10; x <= 10; x += 4) { ctx.lineTo(cx + x, cy + ((x / 4) % 2 ? -3 : 3)); } ctx.stroke(); ctx.strokeStyle = '#e8902a'; ctx.beginPath(); for (let x = -10; x <= 10; x += 4) { ctx.lineTo(cx + x, cy + 5 + ((x / 4) % 2 ? -2 : 2)); } ctx.stroke(); }
    register(scene, key, canvas);
  }
}

function genMisc(scene) {
  if (!scene.textures.exists('mch_crate')) {
    const { canvas, ctx } = makeCanvas(40, 38); groundAO(ctx, 20, 33, 15, 3.4, 0.45);
    ctx.fillStyle = lg(ctx, 0, 14, 0, 33, [[0, '#d9b27a'], [1, '#8a5a34']]); rrect(ctx, 6, 14, 28, 19, 3); ctx.fill();
    ctx.fillStyle = rgba('#2a160c', 0.35); ctx.fillRect(6, 21, 28, 1.6); ctx.fillRect(6, 27, 28, 1.6);
    ctx.fillStyle = '#6b4a30'; ctx.fillRect(7, 14, 3, 19); ctx.fillRect(30, 14, 3, 19);
    ctx.fillStyle = rgba('#fff0d0', 0.45); ctx.fillRect(6, 13.4, 28, 1.6);
    ell(ctx, 14, 12, 5, 4, '#f3d27a'); ell(ctx, 22, 11, 5.4, 4.4, '#f6e8c0'); ell(ctx, 28, 13, 4, 3.4, '#e8902a');
    // altın yıldız rozeti
    ctx.fillStyle = '#f2b84b'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 2.8 : 6; ctx.lineTo(31 + Math.cos(a) * rr, 8 + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    register(scene, 'mch_crate', canvas);
  }
  for (let v = 0; v < 3; v++) {
    const key = `mch_soot${v}`; if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(46, 34); const r = mulberry32(5900 + v);
    for (let i = 0; i < 5; i++) { const x = 6 + r() * 34, y = 4 + r() * 8; ctx.fillStyle = lg(ctx, 0, y, 0, y + 24, [[0, rgba('#1c140e', 0.34)], [1, rgba('#1c140e', 0)]]); rrect(ctx, x - 2.5, y, 5 + r() * 3, 14 + r() * 14, 3); ctx.fill(); }
    ell(ctx, 23, 6, 18, 5, rgba('#1c140e', 0.22));
    if (v === 1) ell(ctx, 30, 24, 7, 4, rgba('#6a8a3a', 0.28));
    register(scene, key, canvas);
  }
  if (!scene.textures.exists('mch_smoke')) {
    const { canvas, ctx } = makeCanvas(48, 48); ctx.fillStyle = radial(ctx, 24, 24, 24, [[0, 'rgba(236,232,226,0.9)'], [0.5, 'rgba(214,208,200,0.5)'], [1, 'rgba(200,194,188,0)']]); ctx.fillRect(0, 0, 48, 48);
    register(scene, 'mch_smoke', canvas);
  }
}

export function genMachines(scene) {
  genDairy(scene); genMill(scene); genBakery(scene); genCannery(scene); genSpinning(scene); genLoom(scene); genShed(scene);
  genLot(scene); genSigns(scene); genMisc(scene);
}
