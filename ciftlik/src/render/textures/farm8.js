// Aşama 8 dokuları (PLAN §15): sera, soğuk hava deposu, depo, silo, garaj; traktör, biçerdöver; yetişkin çalışanlar;
// satılık parsel kazık/ip/tabela; alan vurgusu. Açılışta BİR KEZ üretilir (idempotent). Kontursuz; sol-üstten kenar ışığı.
// Ayak noktası her tablo için ox/oy ile verilir (görünüm konteyneri ayakta durur). Gölge: registerShadow(key + '__sh').
import { makeCanvas, register, shade, rgba, radial } from './canvas.js';
import { mulberry32 } from './noise.js';
import { registerShadow } from './props.js';

const TAU = Math.PI * 2;
const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); };
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
const lg = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
const poly = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
function ao(ctx, cx, cy, rx, ry, a = 0.4) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
  ctx.fillStyle = radial(ctx, 0, 0, rx, [[0, `rgba(20,14,10,${a})`], [0.7, `rgba(20,14,10,${a * 0.5})`], [1, 'rgba(20,14,10,0)']]);
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
}
const rim = (ctx, x, y0, y1, a = 0.5, w = 1.6) => { ctx.fillStyle = `rgba(255,240,210,${a})`; ctx.fillRect(x, y0, w, y1 - y0); };

// win: [x, y, renk, yarıçap, şiddet, parıltı ölçeği] — ayak noktasına göre
export const F8 = {
  greenhouse: { back: 'f8_gh_back', front: 'f8_gh_front', shadowKey: 'f8_gh', w: 440, h: 240, ox: 220, oy: 218, height: 150, shw: 380,
    win: [[-120, -150, 0xf0b8ff, 90, 0.5, 0.7], [0, -150, 0xf0b8ff, 90, 0.5, 0.7], [120, -150, 0xf0b8ff, 90, 0.5, 0.7]],
    glass: { x0: -198, x1: 198, y0: -170, y1: -30 }, dropY: [-168, -34] },
  coldStorage: { key: 'f8_cold', w: 300, h: 220, ox: 150, oy: 204, height: 128, shw: 230, win: [[-59, -82, 0xcfe8ff, 56, 0.5, 0.45]], fan: [83, -55] },
  warehouse: { key: 'f8_ware', w: 320, h: 250, ox: 160, oy: 232, height: 178, shw: 250, win: [[-81, -72, 0xffd08a, 56, 0.5, 0.5], [81, -72, 0xffd08a, 56, 0.5, 0.5]] },
  silo: { key: 'f8_silo', w: 130, h: 260, ox: 65, oy: 244, height: 214, shw: 84, win: [[0, -208, 0xff5040, 34, 0.35, 0.3]] },
  garage: { back: 'f8_gar_back', front: 'f8_gar_front', shadowKey: 'f8_gar', w: 300, h: 230, ox: 150, oy: 216, height: 140, shw: 250, win: [[0, -80, 0xffd08a, 72, 0.55, 0.55]],
    slot: { tractor: [-62, -26], harvester: [50, -26] } },
};
export const F8_TYPES = ['greenhouse', 'coldStorage', 'warehouse', 'silo', 'garage'];

// ------------------------------------------------------------------ SERA
function genGreenhouse(scene) {
  const L = F8.greenhouse; if (scene.textures.exists(L.front)) return;
  const X = L.ox, Y = L.oy, r = mulberry32(8101);
  const frameCol = '#e2e9e8';
  const bar = (ctx, x, y0, y1, w = 3) => {
    ctx.fillStyle = frameCol; ctx.fillRect(x - w / 2, y0, w, y1 - y0);
    ctx.fillStyle = rgba('#5a6a6a', 0.35); ctx.fillRect(x + w / 2 - 0.8, y0, 0.8, y1 - y0);
    ctx.fillStyle = rgba('#ffffff', 0.7); ctx.fillRect(x - w / 2, y0, 0.9, y1 - y0);
  };
  const pane = (ctx, x0, y0, x1, y1, a) => {
    ctx.fillStyle = lg(ctx, 0, y0, 0, y1, [[0, `rgba(205,236,240,${a * 0.8})`], [1, `rgba(150,200,214,${a})`]]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // çapraz yansıma
    ctx.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.08})`; ctx.beginPath(); ctx.moveTo(x0 + 5, y0); ctx.lineTo(x0 + 22 + r() * 8, y0); ctx.lineTo(x0 + 2, y0 + (y1 - y0) * 0.7); ctx.lineTo(x0, y0 + (y1 - y0) * 0.45); ctx.closePath(); ctx.fill();
  };
  // ---- ARKA katman (ekinlerin altında): arka duvar + arka çatı eğimi
  const B = makeCanvas(L.w, L.h), bc = B.ctx;
  pane(bc, X - 198, Y - 206, X + 198, Y - 160, 0.4);
  bc.fillStyle = lg(bc, 0, Y - 206, 0, Y - 150, [[0, 'rgba(20,50,36,0.34)'], [1, 'rgba(40,80,50,0)']]); bc.fillRect(X - 198, Y - 206, 396, 56);
  for (let k = 0; k <= 6; k++) bar(bc, X - 198 + k * 66, Y - 206, Y - 160, 2.6);
  bc.fillStyle = frameCol; bc.fillRect(X - 200, Y - 208, 400, 4); bc.fillStyle = rgba('#fff', 0.7); bc.fillRect(X - 200, Y - 208, 400, 1);
  pane(bc, X - 198, Y - 206, X + 198, Y - 170, 0.22);
  // içeride toprak gölgesi (arka duvar dibi)
  bc.fillStyle = lg(bc, 0, Y - 168, 0, Y - 140, [[0, 'rgba(10,20,10,0.22)'], [1, 'rgba(10,20,10,0)']]); bc.fillRect(X - 196, Y - 168, 392, 28);
  register(scene, L.back, B.canvas, { footX: X, footY: Y });
  // ---- ÖN katman (ekinlerin üstünde): ön çatı eğimi + ön duvar + çerçeve
  const F = makeCanvas(L.w, L.h), fc = F.ctx;
  // ön eğim camı (yatay şeritler halinde hafif varyasyon)
  for (let k = 0; k < 6; k++) pane(fc, X - 198 + k * 66, Y - 170, X - 198 + (k + 1) * 66, Y - 100, 0.2 + r() * 0.05);
  for (let k = 0; k < 6; k++) pane(fc, X - 198 + k * 66, Y - 100, X - 198 + (k + 1) * 66, Y - 30, 0.22 + r() * 0.05);
  // ön duvar camı + kaide
  for (let k = 0; k < 6; k++) pane(fc, X - 198 + k * 66, Y - 30, X - 198 + (k + 1) * 66, Y - 6, 0.26);
  for (let k = 0; k <= 6; k++) { const x = X - 198 + k * 66; bar(fc, x, Y - 170, Y - 6, 3.2); }
  // yatay aşıklar
  fc.fillStyle = rgba(frameCol, 0.85); fc.fillRect(X - 198, Y - 101, 396, 2.4); fc.fillStyle = rgba('#fff', 0.5); fc.fillRect(X - 198, Y - 101, 396, 0.8);
  // oluk (saçak) ve sırt kapağı
  fc.fillStyle = lg(fc, 0, Y - 33, 0, Y - 27, [[0, '#f2f6f5'], [1, '#aebbb8']]); fc.fillRect(X - 201, Y - 33, 402, 5);
  fc.fillStyle = lg(fc, 0, Y - 174, 0, Y - 166, [[0, '#ffffff'], [1, '#b9c6c4']]); rr(fc, X - 202, Y - 174, 404, 7, 3); fc.fill();
  // havalandırma kanatları (sırtta iki açık kapak)
  for (const vx of [-110, 70]) { fc.fillStyle = rgba('#dfe8e7', 0.9); poly(fc, [[X + vx, Y - 170], [X + vx + 44, Y - 170], [X + vx + 40, Y - 182], [X + vx + 4, Y - 182]]); fc.fill(); fc.fillStyle = rgba('#fff', 0.5); fc.fillRect(X + vx + 4, Y - 182, 36, 1); }
  // beton kaide
  fc.fillStyle = lg(fc, 0, Y - 8, 0, Y + 12, [[0, '#cdc8bb'], [1, '#8f8a7e']]); fc.fillRect(X - 202, Y - 8, 404, 20);
  fc.fillStyle = rgba('#ffffff', 0.45); fc.fillRect(X - 202, Y - 8, 404, 1.4);
  fc.fillStyle = rgba('#4a4438', 0.18); for (let k = 0; k < 6; k++) fc.fillRect(X - 198 + k * 66 + 33, Y - 6, 1.2, 16);
  // yan direkler (sağ-sol uç çerçeve)
  bar(fc, X - 200, Y - 208, Y + 10, 5); bar(fc, X + 200, Y - 208, Y + 10, 5);
  // sol kenar ışığı
  rim(fc, X - 202, Y - 170, Y + 10, 0.55, 2);
  register(scene, L.front, F.canvas, { footX: X, footY: Y });
  // gölge silüeti (cam hafif, çerçeve belirgin)
  const S = makeCanvas(L.w, L.h); S.ctx.globalAlpha = 0.55; S.ctx.drawImage(B.canvas, 0, 0); S.ctx.globalAlpha = 0.9; S.ctx.drawImage(F.canvas, 0, 0);
  registerShadow(scene, L.shadowKey, S.canvas, X, Y);
}

// ------------------------------------------------------------------ SOĞUK HAVA DEPOSU
function genCold(scene) {
  const L = F8.coldStorage; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(8203); const F = L.oy;
  ao(ctx, 150, F, 150, 16, 0.4);
  // çatı üst yüzü
  ctx.fillStyle = lg(ctx, 0, 78, 0, 106, [[0, '#e9f2f7'], [1, '#c5d6e0']]); poly(ctx, [[48, 80], [252, 80], [262, 108], [38, 108]]); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.5); ctx.fillRect(48, 80, 204, 1.4);
  // çatı üstü kondenser kutuları
  for (const bx of [78, 168]) {
    ctx.fillStyle = lg(ctx, bx, 0, bx + 44, 0, [[0, '#cfd8de'], [1, '#8e9ba5']]); rr(ctx, bx, 78, 44, 22, 3); ctx.fill();
    ctx.fillStyle = '#2f3b46'; ell(ctx, bx + 22, 90, 13, 6, '#2f3b46'); ctx.strokeStyle = rgba('#aab6c0', 0.8); ctx.lineWidth = 1; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(bx + 22 - 12, 90 + i * 1.8); ctx.lineTo(bx + 22 + 12, 90 + i * 1.8); ctx.stroke(); }
    ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(bx, 78, 44, 1.2);
  }
  // ön duvar (beyaz-mavi panel)
  ctx.fillStyle = lg(ctx, 40, 0, 260, 0, [[0, '#f6fafc'], [0.7, '#dbe7ee'], [1, '#b6c8d4']]); ctx.fillRect(40, 106, 220, F - 4 - 106);
  const wg = ctx.createLinearGradient(0, 106, 0, F); wg.addColorStop(0, 'rgba(60,100,140,0.16)'); wg.addColorStop(1, 'rgba(255,255,255,0.05)'); ctx.fillStyle = wg; ctx.fillRect(40, 106, 220, F - 110);
  ctx.strokeStyle = rgba('#7f9ab0', 0.45); ctx.lineWidth = 1.2;
  for (let x = 62; x < 260; x += 22) { ctx.beginPath(); ctx.moveTo(x, 108); ctx.lineTo(x, F - 6); ctx.stroke(); ctx.strokeStyle = rgba('#ffffff', 0.7); ctx.beginPath(); ctx.moveTo(x + 1.2, 108); ctx.lineTo(x + 1.2, F - 6); ctx.stroke(); ctx.strokeStyle = rgba('#7f9ab0', 0.45); }
  // parapet dudağı
  ctx.fillStyle = lg(ctx, 0, 100, 0, 112, [[0, '#f1f7fa'], [1, '#b9ccd8']]); rr(ctx, 36, 100, 228, 10, 3); ctx.fill();
  ctx.fillStyle = rgba('#2a4a6a', 0.3); ctx.fillRect(40, 110, 220, 4);
  // alt süpürgelik
  ctx.fillStyle = lg(ctx, 0, F - 14, 0, F - 3, [[0, '#8fa4b4'], [1, '#5f7686']]); ctx.fillRect(40, F - 14, 220, 11);
  // kapı (yalıtımlı, çelik)
  ctx.fillStyle = '#4c6272'; rr(ctx, 56, 128, 70, F - 4 - 128, 4); ctx.fill();
  ctx.fillStyle = lg(ctx, 60, 0, 122, 0, [[0, '#c2d2dd'], [1, '#8da3b3']]); rr(ctx, 60, 132, 62, F - 8 - 132, 3); ctx.fill();
  ctx.fillStyle = '#1c242c'; rr(ctx, 70, 142, 22, 18, 5); ctx.fill(); ctx.fillStyle = lg(ctx, 0, 144, 0, 158, [[0, '#9ed4ee'], [1, '#3b6a8a']]); rr(ctx, 72, 144, 18, 14, 4); ctx.fill();
  ctx.fillStyle = '#e8eef2'; rr(ctx, 108, 160, 4, 22, 2); ctx.fill(); ctx.fillStyle = rgba('#fff', 0.8); ctx.fillRect(108, 160, 1.2, 22);
  ctx.fillStyle = '#1c242c'; ctx.fillRect(60, F - 8 - 3, 62, 3);
  // kapı kenarında kırağı
  for (const [x, y, rx, ry] of [[62, F - 12, 12, 8], [118, F - 12, 10, 7], [90, F - 8, 26, 5], [66, 140, 5, 8]]) ell(ctx, x, y, rx, ry, rgba('#ffffff', 0.55));
  const fg = ctx.createLinearGradient(0, F - 34, 0, F); fg.addColorStop(0, 'rgba(235,248,255,0)'); fg.addColorStop(1, 'rgba(235,248,255,0.5)'); ctx.fillStyle = fg; ctx.fillRect(56, F - 34, 74, 30);
  // buz kristali tabela
  const sx = 158, sy = 140;
  ell(ctx, sx, sy, 21, 21, rgba('#9fd8ff', 0.35)); ell(ctx, sx, sy, 17, 17, lg(ctx, 0, sy - 17, 0, sy + 17, [[0, '#3b79b4'], [1, '#1f4a78']]));
  ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const ex = sx + Math.cos(a) * 11, ey = sy + Math.sin(a) * 11; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); const bx = sx + Math.cos(a) * 6.6, by = sy + Math.sin(a) * 6.6; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(bx + Math.cos(a + 1.1) * 3.6, by + Math.sin(a + 1.1) * 3.6); ctx.lineTo(bx, by); ctx.lineTo(bx + Math.cos(a - 1.1) * 3.6, by + Math.sin(a - 1.1) * 3.6); ctx.stroke(); ctx.lineWidth = 2; }
  ctx.fillStyle = rgba('#fff', 0.35); ctx.beginPath(); ctx.ellipse(sx - 6, sy - 8, 6, 3, -0.6, 0, TAU); ctx.fill();
  // fan yuvası (pervane ayrı sprite)
  const fx = L.ox + L.fan[0], fy = L.oy + L.fan[1];
  ctx.fillStyle = '#9eb0bd'; rr(ctx, fx - 22, fy - 22, 44, 44, 6); ctx.fill();
  ell(ctx, fx, fy, 18, 18, '#26323c'); ell(ctx, fx, fy, 18, 18, rgba('#0a0f14', 0.4));
  ctx.strokeStyle = rgba('#b7c4ce', 0.9); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(fx, fy, 17, 0, TAU); ctx.stroke();
  ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(fx - 22, fy - 22, 44, 1.2);
  // lamba (kapı üstü)
  ctx.fillStyle = '#d6dee4'; rr(ctx, 86, 116, 14, 6, 2); ctx.fill(); ell(ctx, 93, 123, 5, 3, '#fff6dc');
  // yan boru
  ctx.strokeStyle = '#8a98a4'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(250, 106); ctx.lineTo(250, 70); ctx.lineTo(236, 70); ctx.stroke();
  rim(ctx, 40, 106, F - 4, 0.55, 2);
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  registerShadow(scene, L.key, canvas, L.ox, L.oy);
  // fan pervanesi
  const P = makeCanvas(36, 36), pc = P.ctx;
  for (let i = 0; i < 4; i++) { pc.save(); pc.translate(18, 18); pc.rotate(i * TAU / 4); pc.fillStyle = lg(pc, 0, 0, 14, 0, [[0, '#cdd8e0'], [1, '#8a9aa6']]); pc.beginPath(); pc.moveTo(0, -1); pc.bezierCurveTo(6, -9, 14, -8, 15, -2); pc.bezierCurveTo(12, 3, 5, 3, 0, 2); pc.closePath(); pc.fill(); pc.restore(); }
  ell(pc, 18, 18, 4, 4, '#e8eef2'); ell(pc, 17, 17, 1.5, 1.5, '#fff');
  register(scene, 'f8_fan', P.canvas);
}

// ------------------------------------------------------------------ DEPO
function genWare(scene) {
  const L = F8.warehouse; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(8305); const F = L.oy;
  ao(ctx, 160, F, 150, 16, 0.42);
  // ahşap duvar
  const face = [[46, F], [46, 128], [160, 70], [274, 128], [274, F]];
  ctx.save(); poly(ctx, face); ctx.clip();
  for (let x = 46; x < 274; x += 11) {
    const c = shade('#b98a58', (r() - 0.5) * 0.16);
    ctx.fillStyle = lg(ctx, x, 0, x + 11, 0, [[0, shade(c, 0.14)], [0.5, c], [1, shade(c, -0.22)]]); ctx.fillRect(x, 60, 11, F - 60);
    ctx.fillStyle = rgba('#2a160c', 0.2); ctx.fillRect(x + 10, 60, 1, F - 60);
  }
  ctx.fillStyle = lg(ctx, 0, 70, 0, 140, [[0, 'rgba(30,14,8,0.3)'], [1, 'rgba(30,14,8,0)']]); ctx.fillRect(40, 70, 240, 70);
  ctx.fillStyle = lg(ctx, 0, F - 22, 0, F, [[0, 'rgba(25,12,8,0)'], [1, 'rgba(25,12,8,0.4)']]); ctx.fillRect(40, F - 22, 240, 22);
  ctx.restore();
  rim(ctx, 46, 128, F, 0.5, 2);
  // taş temel
  for (let x = 46; x < 274; x += 16) ell(ctx, x + 8, F - 3, 9, 5, shade('#8d8a84', (r() - 0.5) * 0.2));
  // büyük çift kapı
  const dx0 = 116, dx1 = 204, dy0 = 138;
  ctx.fillStyle = '#f0e6cf'; rr(ctx, dx0 - 5, dy0 - 5, dx1 - dx0 + 10, F - 4 - dy0 + 5, 3); ctx.fill();
  ctx.fillStyle = '#2f1e14'; ctx.fillRect(dx0, dy0, dx1 - dx0, F - 4 - dy0);
  for (const [a, b] of [[dx0, 160], [160, dx1]]) {
    ctx.fillStyle = lg(ctx, a, 0, b, 0, [[0, '#9a6a3e'], [1, '#7a4e2c']]); ctx.fillRect(a + 1, dy0 + 1, b - a - 2, F - 6 - dy0);
    ctx.strokeStyle = '#efe3c8'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a + 4, dy0 + 5); ctx.lineTo(b - 4, F - 10); ctx.moveTo(b - 4, dy0 + 5); ctx.lineTo(a + 4, F - 10); ctx.stroke();
    ctx.strokeStyle = rgba('#2a160c', 0.35); ctx.lineWidth = 0.8; for (let x = a + 8; x < b - 4; x += 9) { ctx.beginPath(); ctx.moveTo(x, dy0 + 3); ctx.lineTo(x, F - 8); ctx.stroke(); }
  }
  ctx.fillStyle = '#d8c9a0'; ctx.fillRect(157, dy0, 6, F - 4 - dy0);
  ctx.fillStyle = '#2f2a26'; rr(ctx, 148, 186, 7, 18, 2); ctx.fill(); rr(ctx, 165, 186, 7, 18, 2); ctx.fill();
  // ray
  ctx.fillStyle = '#5a5a60'; ctx.fillRect(dx0 - 10, dy0 - 9, dx1 - dx0 + 20, 4); ctx.fillStyle = rgba('#fff', 0.4); ctx.fillRect(dx0 - 10, dy0 - 9, dx1 - dx0 + 20, 1);
  // samanlık kapağı
  ctx.fillStyle = '#f0e6cf'; ctx.fillRect(148, 88, 24, 30); ctx.fillStyle = '#3a2218'; ctx.fillRect(151, 91, 18, 24);
  ctx.fillStyle = '#7a5230'; ctx.fillRect(151, 91, 9, 24); ctx.fillStyle = rgba('#e8c968', 0.8); for (let i = 0; i < 4; i++) ctx.fillRect(152 + i, 112 - i, 12, 2);
  // pencereler
  for (const wx of [66, 228]) { ctx.fillStyle = '#f0e6cf'; ctx.fillRect(wx - 3, 148 - 3, 32, 30); ctx.fillStyle = lg(ctx, 0, 148, 0, 172, [[0, '#6f8fa8'], [1, '#2f4258']]); ctx.fillRect(wx, 148, 26, 24); ctx.fillStyle = rgba('#fff', 0.28); poly(ctx, [[wx, 148], [wx + 16, 148], [wx, 164]]); ctx.fill(); ctx.fillStyle = '#f0e6cf'; ctx.fillRect(wx + 12, 148, 2, 24); }
  // çatı (koyu kahve gambrel-sade) + saçak
  const roof = [[24, 134], [160, 52], [296, 134]];
  ctx.save(); poly(ctx, roof); ctx.clip();
  ctx.fillStyle = lg(ctx, 0, 52, 0, 134, [[0, '#9a5a44'], [1, '#6a3a2e']]); ctx.fillRect(20, 50, 280, 90);
  for (let j = 0; j < 6; j++) { const y = 56 + j * 14; for (let x = 20 - (j % 2) * 8; x < 300; x += 16) { ctx.fillStyle = shade('#8a4a3a', (r() - 0.5) * 0.14 - j * 0.02); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.lineTo(x + 16, y + 9); ctx.quadraticCurveTo(x + 8, y + 17, x, y + 9); ctx.fill(); } ctx.fillStyle = rgba('#2a0c08', 0.18); ctx.fillRect(20, y + 13, 280, 1.6); }
  ctx.restore();
  ctx.fillStyle = '#4a2418'; poly(ctx, [[24, 134], [296, 134], [294, 140], [26, 140]]); ctx.fill();
  ctx.strokeStyle = rgba('#ffd2b0', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(25, 133); ctx.lineTo(160, 53); ctx.stroke();
  ctx.strokeStyle = rgba('#3a140c', 0.5); ctx.beginPath(); ctx.moveTo(160, 53); ctx.lineTo(295, 133); ctx.stroke();
  // yan: sandık yığını + varil + çuval
  const crate = (x, y, w, h) => { ctx.fillStyle = lg(ctx, x, 0, x + w, 0, [[0, '#c9a066'], [1, '#8a6038']]); ctx.fillRect(x, y, w, h); ctx.strokeStyle = rgba('#3a2010', 0.55); ctx.lineWidth = 1.2; ctx.strokeRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2); ctx.beginPath(); ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + w - 2, y + h - 3); ctx.stroke(); ctx.fillStyle = rgba('#fff0d0', 0.4); ctx.fillRect(x, y, w, 1.4); };
  crate(214, F - 24, 26, 24); crate(242, F - 24, 26, 24); crate(228, F - 48, 26, 24);
  ctx.fillStyle = lg(ctx, 66, 0, 90, 0, [[0, '#8a6a4a'], [0.5, '#6a4a30'], [1, '#4a3220']]); rr(ctx, 70, F - 32, 22, 32, 6); ctx.fill(); ctx.fillStyle = '#3a3a40'; ctx.fillRect(70, F - 24, 22, 2.4); ctx.fillRect(70, F - 10, 22, 2.4); ell(ctx, 81, F - 32, 11, 3.4, '#7a5a3a');
  ell(ctx, 100, F - 7, 11, 8, '#d8c79a'); ell(ctx, 97, F - 10, 4, 3, rgba('#fff', 0.4)); ctx.fillStyle = '#9a8a5a'; ctx.fillRect(95, F - 15, 10, 2);
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ SİLO
function genSilo(scene) {
  const L = F8.silo; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(8407);
  const CX = 65, R = 36, TOP = 72, BOT = 232;
  ao(ctx, CX, BOT + 2, 52, 12, 0.45);
  // beton kaide
  ctx.fillStyle = lg(ctx, CX - 40, 0, CX + 40, 0, [[0, '#c8c2b6'], [1, '#8a8478']]); ctx.beginPath(); ctx.moveTo(CX - 40, BOT - 14); ctx.lineTo(CX - 40, BOT); ctx.ellipse(CX, BOT, 40, 11, 0, Math.PI, 0, true); ctx.lineTo(CX + 40, BOT - 14); ctx.closePath(); ctx.fill();
  // gövde
  const body = () => { ctx.beginPath(); ctx.moveTo(CX - R, TOP); ctx.lineTo(CX - R, BOT - 8); ctx.ellipse(CX, BOT - 8, R, 10, 0, Math.PI, 0, true); ctx.lineTo(CX + R, TOP); ctx.closePath(); };
  body(); ctx.fillStyle = lg(ctx, CX - R, 0, CX + R, 0, [[0, '#f08a70'], [0.22, '#d9503f'], [0.62, '#b03630'], [1, '#6e1f1c']]); ctx.fill();
  ctx.save(); body(); ctx.clip();
  for (let x = CX - R; x < CX + R; x += 5) { ctx.fillStyle = rgba('#2a0806', 0.13); ctx.fillRect(x + 3.4, TOP, 1.3, BOT - TOP); ctx.fillStyle = rgba('#ffd9c8', 0.1); ctx.fillRect(x, TOP, 1, BOT - TOP); }
  for (const by of [112, 152, 192]) {
    ctx.fillStyle = lg(ctx, 0, by - 3, 0, by + 4, [[0, 'rgba(255,230,215,0.35)'], [1, 'rgba(40,8,6,0.4)']]);
    ctx.beginPath(); ctx.moveTo(CX - R, by - 3); ctx.ellipse(CX, by - 3, R, 8, 0, Math.PI, 0, true); ctx.lineTo(CX + R, by + 3); ctx.ellipse(CX, by + 3, R, 8, 0, 0, Math.PI, false); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 9; i++) { const a = Math.PI * (0.1 + i * 0.1); ell(ctx, CX + Math.cos(a) * R * 0.96, by + Math.sin(a) * 8 + 0.5, 0.9, 0.9, rgba('#ffe0d0', 0.45)); }
  }
  ctx.fillStyle = lg(ctx, 0, BOT - 40, 0, BOT, [[0, 'rgba(30,8,6,0)'], [1, 'rgba(30,8,6,0.4)']]); ctx.fillRect(CX - R, BOT - 40, 2 * R, 40);
  ctx.restore();
  rim(ctx, CX - R, TOP, BOT - 8, 0.5, 2.2);
  // kubbe
  ctx.beginPath(); ctx.moveTo(CX - R - 2, TOP + 1); ctx.bezierCurveTo(CX - R, TOP - 32, CX + R, TOP - 32, CX + R + 2, TOP + 1); ctx.ellipse(CX, TOP + 1, R + 2, 9, 0, 0, Math.PI, false); ctx.closePath();
  ctx.fillStyle = lg(ctx, CX - R, TOP - 30, CX + R, TOP + 8, [[0, '#f2f4f6'], [0.4, '#c9d0d6'], [1, '#7f8a94']]); ctx.fill();
  ctx.strokeStyle = rgba('#5a6670', 0.35); ctx.lineWidth = 1; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(CX + i * 10, TOP + 8); ctx.quadraticCurveTo(CX + i * 6, TOP - 14, CX + i * 1.2, TOP - 25); ctx.stroke(); }
  ctx.fillStyle = rgba('#fff', 0.6); ctx.beginPath(); ctx.ellipse(CX - 14, TOP - 12, 10, 4, -0.7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a848e'; rr(ctx, CX - 6, TOP - 34, 12, 7, 2); ctx.fill(); ell(ctx, CX, TOP - 35, 6, 2.2, '#c5ced6');
  ell(ctx, CX, TOP - 38, 2.4, 2.4, '#ff6a58'); ell(ctx, CX, TOP - 38, 5, 5, rgba('#ff6a58', 0.25));
  // merdiven
  ctx.fillStyle = '#7a848e'; ctx.fillRect(CX + 20, TOP + 12, 2, BOT - TOP - 26); ctx.fillRect(CX + 28, TOP + 12, 2, BOT - TOP - 26);
  ctx.fillStyle = '#9aa4ae'; for (let y = TOP + 18; y < BOT - 18; y += 11) ctx.fillRect(CX + 20, y, 10, 1.8);
  // kapak + tahliye borusu
  ctx.fillStyle = '#2f2420'; rr(ctx, CX - 9, BOT - 36, 18, 26, 2); ctx.fill(); ctx.fillStyle = '#6a4a30'; ctx.fillRect(CX - 9, BOT - 36, 9, 26);
  ctx.fillStyle = lg(ctx, 0, BOT - 12, 0, BOT, [[0, '#9aa4ae'], [1, '#5a646e']]); ctx.beginPath(); ctx.moveTo(CX - 26, BOT - 22); ctx.lineTo(CX - 40, BOT - 6); ctx.lineTo(CX - 32, BOT - 2); ctx.lineTo(CX - 18, BOT - 18); ctx.closePath(); ctx.fill();
  // küçük buğday yığını
  for (let i = 0; i < 26; i++) ell(ctx, CX - 46 + r() * 20, BOT + 1 + r() * 4, 2.4, 1.3, shade('#e0b94a', (r() - 0.5) * 0.3));
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  registerShadow(scene, L.key, canvas, L.ox, L.oy);
}

// ------------------------------------------------------------------ GARAJ
function genGarage(scene) {
  const L = F8.garage; if (scene.textures.exists(L.front)) return;
  const X = 0, F = L.oy, r = mulberry32(8509);
  // ---- ARKA: iç mekan
  const B = makeCanvas(L.w, L.h), bc = B.ctx;
  const ix0 = 48, ix1 = 252, iy0 = F - 80, iy1 = F - 4;
  bc.fillStyle = lg(bc, 0, iy0, 0, iy1, [[0, '#3b2c24'], [1, '#54402f']]); bc.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
  bc.strokeStyle = rgba('#1a0f0a', 0.45); bc.lineWidth = 1; for (let x = ix0 + 9; x < ix1; x += 11) { bc.beginPath(); bc.moveTo(x, iy0); bc.lineTo(x, F - 30); bc.stroke(); }
  // pano + aletler
  bc.fillStyle = '#6a5440'; bc.fillRect(ix0 + 16, iy0 + 14, 56, 26); bc.fillStyle = rgba('#d8d0c0', 0.8);
  for (const [x, y, w, h] of [[ix0 + 22, iy0 + 18, 3, 16], [ix0 + 32, iy0 + 20, 12, 3], [ix0 + 50, iy0 + 18, 4, 18], [ix0 + 60, iy0 + 22, 8, 8]]) bc.fillRect(x, y, w, h);
  bc.fillStyle = '#b8402f'; bc.fillRect(ix1 - 52, iy0 + 22, 34, 14); bc.fillStyle = rgba('#fff', 0.35); bc.fillRect(ix1 - 52, iy0 + 22, 34, 1.4);
  // zemin
  bc.fillStyle = lg(bc, 0, F - 32, 0, iy1, [[0, '#68645c'], [1, '#8a867c']]); poly(bc, [[ix0, F - 30], [ix1, F - 30], [ix1, iy1], [ix0, iy1]]); bc.fill();
  ell(bc, 120, F - 18, 16, 3.4, rgba('#1a1a1a', 0.3)); ell(bc, 190, F - 14, 10, 2.6, rgba('#1a1a1a', 0.25));
  bc.fillStyle = lg(bc, 0, iy0, 0, iy0 + 30, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]); bc.fillRect(ix0, iy0, ix1 - ix0, 30);
  // kalkık rulo kapı
  bc.fillStyle = lg(bc, 0, iy0, 0, iy0 + 12, [[0, '#cdd2d8'], [1, '#8a929a']]); bc.fillRect(ix0, iy0, ix1 - ix0, 12);
  bc.strokeStyle = rgba('#5a626a', 0.7); bc.lineWidth = 1; for (let y = iy0 + 3; y < iy0 + 12; y += 3) { bc.beginPath(); bc.moveTo(ix0, y); bc.lineTo(ix1, y); bc.stroke(); }
  register(scene, L.back, B.canvas, { footX: L.ox, footY: L.oy });
  // ---- ÖN: cephe çerçevesi + çatı
  const Fc = makeCanvas(L.w, L.h), fc = Fc.ctx;
  // çatı üst yüzü
  fc.fillStyle = lg(fc, 0, 74, 0, 124, [[0, '#6c7c86'], [1, '#4a5964']]); poly(fc, [[44, 76], [256, 76], [278, 124], [22, 124]]); fc.fill();
  fc.strokeStyle = rgba('#2f3a42', 0.45); fc.lineWidth = 1.2; for (let i = 0; i <= 8; i++) { const t = i / 8; fc.beginPath(); fc.moveTo(44 + (22 - 44) * t + (256 - 44 - (278 - 22) * 0) * 0 + t * 0, 76 + t * 48); fc.moveTo(44 + 212 * (i / 8) * 0 + 0, 0); } // (boş)
  for (let i = 1; i < 12; i++) { const t = i / 12; fc.strokeStyle = rgba('#2f3a42', 0.4); fc.lineWidth = 1.2; fc.beginPath(); fc.moveTo(44 + 212 * t, 76); fc.lineTo(22 + 256 * t, 124); fc.stroke(); fc.strokeStyle = rgba('#b7c5ce', 0.28); fc.beginPath(); fc.moveTo(45 + 212 * t, 76); fc.lineTo(23 + 256 * t, 124); fc.stroke(); }
  fc.fillStyle = rgba('#fff', 0.35); fc.fillRect(46, 76, 208, 1.4);
  fc.fillStyle = lg(fc, 0, 118, 0, 130, [[0, '#3b4650'], [1, '#232c33']]); rr(fc, 20, 118, 260, 12, 3); fc.fill();
  fc.fillStyle = rgba('#d8e4ea', 0.5); fc.fillRect(20, 118, 260, 1.4);
  // üst kiriş (alın)
  fc.fillStyle = lg(fc, 0, 130, 0, F - 78, [[0, '#a8483a'], [1, '#8a3a2e']]); fc.fillRect(28, 130, 244, F - 78 - 130);
  fc.fillStyle = rgba('#f0e6cf', 0.9); fc.fillRect(28, F - 82, 244, 4); fc.fillStyle = rgba('#fff', 0.5); fc.fillRect(28, 130, 244, 1);
  // dişli ikon
  ell(fc, 150, 144, 9, 9, '#f0e6cf'); fc.fillStyle = '#7a8594'; fc.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, rad = i % 2 ? 5.2 : 7; fc.lineTo(150 + Math.cos(a) * rad, 144 + Math.sin(a) * rad); } fc.closePath(); fc.fill(); ell(fc, 150, 144, 2.4, 2.4, '#f0e6cf');
  // yan duvar/ direkler
  for (const px of [28, 252]) {
    fc.fillStyle = lg(fc, px, 0, px + 20, 0, [[0, '#e6dcc6'], [1, '#a8987c']]); fc.fillRect(px, 130, 20, F - 130);
    fc.fillStyle = rgba('#2a1c10', 0.16); for (let y = 142; y < F - 4; y += 12) fc.fillRect(px, y, 20, 1.2);
  }
  rim(fc, 28, 130, F, 0.6, 2);
  fc.fillStyle = lg(fc, 0, F - 6, 0, F + 12, [[0, '#d2cec4'], [1, '#98938a']]); poly(fc, [[36, F - 4], [264, F - 4], [276, F + 12], [24, F + 12]]); fc.fill();
  fc.fillStyle = rgba('#fff', 0.45); fc.fillRect(36, F - 4, 228, 1.4); fc.strokeStyle = rgba('#4a463c', 0.25); fc.lineWidth = 1; for (const x of [100, 150, 200]) { fc.beginPath(); fc.moveTo(x, F - 4); fc.lineTo(x + (x - 150) * 0.24, F + 12); fc.stroke(); }
  register(scene, L.front, Fc.canvas, { footX: L.ox, footY: L.oy });
  ao(bc, 150, F, 150, 14, 0.0);
  const S = makeCanvas(L.w, L.h); S.ctx.drawImage(B.canvas, 0, 0); S.ctx.drawImage(Fc.canvas, 0, 0); ao(S.ctx, 150, F, 135, 12, 0.0);
  registerShadow(scene, L.shadowKey, S.canvas, L.ox, L.oy);
  void X;
}

// ------------------------------------------------------------------ ARAÇLAR
export const VEH = {
  tractor: { body: 'f8_tr_body', over: 'f8_tr_over', w: 120, h: 96, ox: 52, oy: 88, rw: [30, 62, 22], fw: [92, 74, 13], driver: [40, 30], height: 80, shw: 100 },
  harvester: { body: 'f8_hv_body', over: 'f8_hv_over', w: 170, h: 110, ox: 66, oy: 100, rw: [102, 80, 20], fw: [28, 87, 13], driver: [84, 40], reel: [152, 62, 19], height: 96, shw: 150 },
};
export const WHEEL_KEYS = { 22: 'f8_wh22', 13: 'f8_wh13', 20: 'f8_wh20' };
const SSV = 2;

function genWheel(scene, R) {
  const key = WHEEL_KEYS[R]; if (scene.textures.exists(key)) return;
  const s = R * 2 + 4; const { canvas, ctx } = makeCanvas(s * SSV, s * SSV); ctx.scale(SSV, SSV);
  const c = s / 2;
  ell(ctx, c, c, R, R, '#1d1d22');
  ctx.fillStyle = '#2c2c33'; for (let i = 0; i < 16; i++) { ctx.save(); ctx.translate(c, c); ctx.rotate(i * TAU / 16); ctx.fillRect(R - 3.4, -2.2, 3.6, 4.4); ctx.restore(); }
  ell(ctx, c, c, R - 3.6, R - 3.6, lg(ctx, c - R, c - R, c + R, c + R, [[0, '#3a3a42'], [1, '#18181c']]));
  ell(ctx, c, c, R * 0.58, R * 0.58, lg(ctx, c - R, c - R, c + R, c + R, [[0, '#f0c050'], [1, '#c4862a']]));
  for (let i = 0; i < 5; i++) { ctx.save(); ctx.translate(c, c); ctx.rotate(i * TAU / 5); ell(ctx, R * 0.36, 0, 1.4, 1.4, '#6a4a18'); ctx.restore(); }
  ell(ctx, c, c, R * 0.2, R * 0.2, '#5a3e14'); ell(ctx, c - R * 0.06, c - R * 0.08, R * 0.08, R * 0.08, rgba('#fff', 0.5));
  ctx.strokeStyle = rgba('#fff', 0.14); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(c, c, R - 1, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
  register(scene, key, canvas);
}

function genTractor(scene) {
  const V = VEH.tractor; if (scene.textures.exists(V.body)) return;
  // gövde (tekerlekler hariç)
  const B = makeCanvas(V.w * SSV, V.h * SSV), c = B.ctx; c.scale(SSV, SSV);
  // şasi / motor kaputu
  c.fillStyle = '#2a2a30'; rr(c, 26, 56, 62, 14, 3); c.fill();
  c.fillStyle = lg(c, 0, 40, 0, 66, [[0, '#e24a3c'], [0.6, '#c42f26'], [1, '#8a1d18']]); c.beginPath(); c.moveTo(54, 44); c.lineTo(94, 44); c.quadraticCurveTo(102, 46, 102, 54); c.lineTo(102, 64); c.lineTo(50, 64); c.lineTo(50, 52); c.closePath(); c.fill();
  c.fillStyle = rgba('#ffe0d0', 0.45); c.fillRect(54, 44.4, 40, 1.8);
  c.fillStyle = '#1e1e24'; rr(c, 96, 47, 7, 15, 2); c.fill(); c.strokeStyle = rgba('#aab', 0.5); c.lineWidth = 0.8; for (let y = 50; y < 62; y += 3) { c.beginPath(); c.moveTo(97, y); c.lineTo(102, y); c.stroke(); }
  ell(c, 101, 66, 2.6, 2.6, '#fff4c0');
  // egzoz borusu
  c.fillStyle = '#3a3a42'; c.fillRect(82, 28, 3.6, 18); ell(c, 83.8, 28, 2.6, 1.4, '#222');
  // arka gövde / koltuk bölgesi
  c.fillStyle = lg(c, 0, 48, 0, 66, [[0, '#d23a2e'], [1, '#8a1d18']]); c.beginPath(); c.moveTo(22, 52); c.lineTo(54, 46); c.lineTo(54, 66); c.lineTo(22, 66); c.closePath(); c.fill();
  c.fillStyle = '#2f2f36'; rr(c, 30, 44, 18, 6, 2); c.fill(); c.fillStyle = '#4a4a54'; c.fillRect(32, 36, 4, 10);
  // direksiyon
  c.strokeStyle = '#222'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(50, 44); c.lineTo(56, 36); c.stroke(); c.lineWidth = 2; c.beginPath(); c.ellipse(57, 34.6, 4, 1.4, -0.3, 0, TAU); c.stroke();
  // ön ağırlık / çekme demiri
  c.fillStyle = '#6a6a72'; c.fillRect(103, 58, 5, 8); c.fillRect(14, 64, 10, 4);
  register(scene, V.body, B.canvas);
  // üst: çamurluk + ROPS tavan
  const O = makeCanvas(V.w * SSV, V.h * SSV), o = O.ctx; o.scale(SSV, SSV);
  o.fillStyle = lg(o, 0, 36, 0, 46, [[0, '#ee5a4a'], [1, '#a82820']]); o.beginPath(); o.moveTo(6, 56); o.bezierCurveTo(8, 36, 28, 32, 50, 38); o.lineTo(54, 46); o.lineTo(52, 50); o.bezierCurveTo(40, 44, 20, 44, 10, 56); o.closePath(); o.fill();
  o.fillStyle = rgba('#ffe8dc', 0.45); o.beginPath(); o.moveTo(12, 46); o.bezierCurveTo(18, 36, 30, 34, 44, 37); o.lineTo(44, 38.6); o.bezierCurveTo(30, 36.4, 20, 38, 14, 48); o.closePath(); o.fill();
  o.fillStyle = '#34343c'; o.fillRect(25, 8, 2.8, 34); o.fillRect(54, 8, 2.8, 34);
  o.fillStyle = lg(o, 0, 4, 0, 12, [[0, '#4a4a54'], [1, '#26262c']]); rr(o, 18, 4, 46, 8, 3); o.fill(); o.fillStyle = rgba('#fff', 0.35); o.fillRect(20, 4, 42, 1.4);
  register(scene, V.over, O.canvas);
  genWheel(scene, 22); genWheel(scene, 13);
  // gölge silüeti
  const S = makeCanvas(V.w * SSV, V.h * SSV); S.ctx.drawImage(B.canvas, 0, 0); S.ctx.drawImage(O.canvas, 0, 0);
  for (const [x, y, rad] of [V.rw, V.fw]) { S.ctx.fillStyle = '#000'; S.ctx.beginPath(); S.ctx.arc(x * SSV, y * SSV, rad * SSV, 0, TAU); S.ctx.fill(); }
  registerShadow(scene, V.body, S.canvas, V.ox * SSV, V.oy * SSV);
}

function genHarvester(scene) {
  const V = VEH.harvester; if (scene.textures.exists(V.body)) return;
  const B = makeCanvas(V.w * SSV, V.h * SSV), c = B.ctx; c.scale(SSV, SSV);
  // şasi
  c.fillStyle = '#2f3a2a'; rr(c, 18, 66, 100, 12, 3); c.fill();
  // tahıl deposu (sarı)
  c.fillStyle = lg(c, 0, 30, 0, 70, [[0, '#f0cc3c'], [0.7, '#d4a82a'], [1, '#a07a1c']]); c.beginPath(); c.moveTo(8, 36); c.lineTo(66, 34); c.lineTo(70, 70); c.lineTo(10, 70); c.closePath(); c.fill();
  c.fillStyle = '#4a8a38'; c.fillRect(9, 54, 61, 6); c.fillStyle = rgba('#d8f0b0', 0.5); c.fillRect(9, 54, 61, 1.2);
  c.fillStyle = rgba('#fff6c0', 0.5); c.fillRect(8, 36, 58, 1.6);
  c.strokeStyle = rgba('#6a4e10', 0.35); c.lineWidth = 1; for (let x = 18; x < 66; x += 10) { c.beginPath(); c.moveTo(x, 38); c.lineTo(x + 1, 52); c.stroke(); }
  // boşaltma borusu
  c.strokeStyle = '#7a9a58'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(60, 34); c.lineTo(34, 18); c.lineTo(16, 20); c.stroke(); c.strokeStyle = rgba('#e0f0c0', 0.5); c.lineWidth = 1.4; c.beginPath(); c.moveTo(60, 32.4); c.lineTo(34, 16.4); c.stroke();
  // motor kapağı (arka)
  c.fillStyle = lg(c, 0, 56, 0, 72, [[0, '#4f9a3c'], [1, '#2f6a28']]); rr(c, 6, 60, 22, 14, 3); c.fill();
  // kabin altı + besleme ağzı
  c.fillStyle = lg(c, 0, 56, 0, 80, [[0, '#e8c434'], [1, '#a68420']]); c.beginPath(); c.moveTo(70, 58); c.lineTo(104, 58); c.lineTo(120, 64); c.lineTo(122, 76); c.lineTo(70, 76); c.closePath(); c.fill();
  // taşıyıcı kanal (header'a)
  c.fillStyle = lg(c, 0, 62, 0, 80, [[0, '#6a7a5a'], [1, '#3a4a30']]); c.beginPath(); c.moveTo(118, 62); c.lineTo(134, 70); c.lineTo(138, 82); c.lineTo(120, 80); c.closePath(); c.fill();
  // ön tırmık platformu (header)
  c.fillStyle = lg(c, 0, 68, 0, 92, [[0, '#f0d040'], [1, '#b08a20']]); c.beginPath(); c.moveTo(126, 68); c.lineTo(166, 72); c.lineTo(168, 88); c.lineTo(132, 92); c.lineTo(124, 84); c.closePath(); c.fill();
  c.fillStyle = '#4a8a38'; c.fillRect(130, 80, 36, 4); c.fillStyle = rgba('#fff6c0', 0.55); c.fillRect(127, 68.6, 38, 1.4);
  c.fillStyle = '#c8d0d6'; c.fillRect(132, 90, 36, 3); for (let x = 133; x < 167; x += 4) { c.beginPath(); c.moveTo(x, 90); c.lineTo(x + 2, 95); c.lineTo(x + 4, 90); c.fillStyle = '#d8dee4'; c.fill(); }
  register(scene, V.body, B.canvas);
  // üst: kabin camı + tavan
  const O = makeCanvas(V.w * SSV, V.h * SSV), o = O.ctx; o.scale(SSV, SSV);
  o.fillStyle = lg(o, 0, 20, 0, 60, [[0, 'rgba(190,225,236,0.42)'], [1, 'rgba(120,170,190,0.3)']]); o.beginPath(); o.moveTo(72, 58); o.lineTo(72, 24); o.quadraticCurveTo(72, 20, 78, 20); o.lineTo(102, 20); o.lineTo(110, 38); o.lineTo(112, 58); o.closePath(); o.fill();
  o.fillStyle = rgba('#fff', 0.2); o.beginPath(); o.moveTo(76, 24); o.lineTo(90, 24); o.lineTo(80, 54); o.lineTo(76, 54); o.closePath(); o.fill();
  o.strokeStyle = '#3a4a30'; o.lineWidth = 2.4; o.lineJoin = 'round'; o.beginPath(); o.moveTo(72, 58); o.lineTo(72, 24); o.quadraticCurveTo(72, 20, 78, 20); o.lineTo(102, 20); o.lineTo(110, 38); o.lineTo(112, 58); o.stroke();
  o.fillStyle = lg(o, 0, 14, 0, 22, [[0, '#6aa650'], [1, '#2f6a28']]); rr(o, 68, 14, 40, 8, 3); o.fill(); o.fillStyle = rgba('#fff', 0.4); o.fillRect(70, 14, 36, 1.4);
  o.fillStyle = '#e8c434'; o.fillRect(66, 58, 48, 3);
  register(scene, V.over, O.canvas);
  genWheel(scene, 20); genWheel(scene, 13);
  // tırmık makarası (döner)
  const R = makeCanvas(46 * SSV, 46 * SSV), rc = R.ctx; rc.scale(SSV, SSV);
  for (let i = 0; i < 6; i++) { rc.save(); rc.translate(23, 23); rc.rotate(i * TAU / 6); rc.fillStyle = '#d8a82c'; rc.fillRect(2, -1.6, 19, 3.2); rc.fillStyle = '#e8e0c0'; rc.fillRect(14, -2.6, 9, 1.6); rc.fillStyle = rgba('#fff', 0.4); rc.fillRect(2, -1.6, 17, 0.9); rc.restore(); }
  ell(rc, 23, 23, 5, 5, '#4a8a38'); ell(rc, 23, 23, 2, 2, '#c0d8a0');
  register(scene, 'f8_reel', R.canvas);
  const S = makeCanvas(V.w * SSV, V.h * SSV); S.ctx.drawImage(B.canvas, 0, 0); S.ctx.drawImage(O.canvas, 0, 0);
  for (const [x, y, rad] of [V.rw, V.fw]) { S.ctx.fillStyle = '#000'; S.ctx.beginPath(); S.ctx.arc(x * SSV, y * SSV, rad * SSV, 0, TAU); S.ctx.fill(); }
  registerShadow(scene, V.body, S.canvas, V.ox * SSV, V.oy * SSV);
}

// ------------------------------------------------------------------ YETİŞKİN ÇALIŞANLAR
export const ADL = { w: 120, h: 120, ox: 60, oy: 112, scale: 0.56 };
export const LOOKS = [
  { skin: '#e8c19a', skinD: '#c08e66', hair: '#3b2a1c', over: '#3f6fa8', shirt: '#c9503a', hat: 'straw', hatC: '#e2c06a' },
  { skin: '#9a6a46', skinD: '#74482c', hair: '#1b1410', over: '#6b7a3a', shirt: '#e8dcc0', hat: 'cap', hatC: '#6a4a2a' },
  { skin: '#f2d2b4', skinD: '#d0a484', hair: '#b8742a', over: '#a8895a', shirt: '#3d7a6a', hat: 'wide', hatC: '#ddd4bc' },
  { skin: '#d9a47c', skinD: '#b07c54', hair: '#74747a', over: '#8a3a3a', shirt: '#3a3f4a', hat: 'flat', hatC: '#4a4a52' },
];
export const adlKey = (look, f) => `adl_${look}_${f}`;
export const ADL_FRAMES = ['idle0', 'idle1', 'work0', 'work1', 'walk0', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5'];

function adultPoses() {
  const P = {
    idle0: { hipY: 36, lean: 0, legs: [[28, 56], [33, 56]], armF: [36.4, 38], armN: [26, 38], hy: 0 },
    idle1: { hipY: 36, lean: 0, legs: [[28, 56], [33, 56]], armF: [36.4, 38], armN: [26, 38], hy: 0.3, blink: true },
    work0: { hipY: 37, lean: 0.55, legs: [[26.6, 56], [34, 56]], armF: [43, 47], armN: [39, 50], hy: 0.6, tool: true },
    work1: { hipY: 36.6, lean: 0.28, legs: [[27.4, 56], [33.6, 56]], armF: [40, 42], armN: [37, 44], hy: 0.2, tool: true },
  };
  for (let i = 0; i < 6; i++) {
    const p = i / 6 * TAU, s = Math.sin(p), c = Math.cos(p);
    P['walk' + i] = { hipY: 36 + 0.5 - Math.abs(c) * 0.9, lean: 0.06, legs: [[30 - s * 7, 56 - Math.max(0, -c) * 4], [30.4 + s * 7, 56 - Math.max(0, c) * 4]], armF: [35.4 + s * 3.6, 38], armN: [25.8 - s * 3.6, 38], hy: -Math.abs(c) * 0.3 };
  }
  return P;
}

function adLeg(ctx, hx, hy, fx, fy, L, back) {
  const mx = (hx + fx) / 2, my = (hy + fy) / 2, dx = fx - hx, dy = fy - hy, len = Math.hypot(dx, dy) || 1;
  let nx = dy / len, ny = -dx / len; if (nx < 0) { nx = -nx; ny = -ny; }
  const bend = Math.max(0, 24 - len) * 0.3 + 0.8, kx = mx + nx * bend, ky = my + ny * bend;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = back ? shade(L.over, -0.28) : L.over; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy - 3); ctx.stroke();
  if (!back) { ctx.strokeStyle = rgba('#ffffff', 0.18); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(hx - 2.4, hy + 1); ctx.lineTo(kx - 2.2, ky); ctx.lineTo(fx - 2, fy - 4); ctx.stroke(); }
  // bot
  ell(ctx, fx + 1.8, fy - 1.8, 5.8, 3.2, back ? '#2a1f16' : '#4a3626'); ctx.fillStyle = back ? '#1a130d' : '#2a1d14'; ctx.fillRect(fx - 3.8, fy - 0.6, 11, 1.4);
}
function adArm(ctx, sx, sy, hx, hy, L, far) {
  const mx = (sx + hx) / 2, my = (sy + hy) / 2, dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1;
  let nx = dy / len, ny = -dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
  const ex = mx + nx * 1.4, ey = my + ny * 1.4 + 0.8;
  ctx.lineCap = 'round'; ctx.strokeStyle = far ? shade(L.shirt, -0.3) : L.shirt; ctx.lineWidth = 5.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(ex, ey, hx - dx / len * 2, hy - dy / len * 2); ctx.stroke();
  if (!far) { ctx.strokeStyle = rgba('#fff', 0.22); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx - 2, sy + 0.5); ctx.quadraticCurveTo(ex - 2, ey, hx - 2 - dx / len * 2, hy - dy / len * 2); ctx.stroke(); }
  ell(ctx, hx, hy, 2.7, 2.6, far ? L.skinD : L.skin);
}

function drawAdult(ctx, L, P) {
  const hipX = 30, hipY = P.hipY, ls = Math.sin(P.lean), lc = Math.cos(P.lean);
  const sx = hipX + ls * 17, sy = hipY - lc * 17;
  adLeg(ctx, hipX - 1, hipY, P.legs[0][0], P.legs[0][1], L, true);
  adArm(ctx, sx - 1.5, sy + 1.6, P.armN[0], P.armN[1], L, true);
  // gövde (gömlek) + tulum önlüğü
  ctx.lineCap = 'round'; ctx.strokeStyle = L.shirt; ctx.lineWidth = 12.4; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(sx, sy); ctx.stroke();
  ctx.strokeStyle = rgba('#fff', 0.2); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hipX - 5.4, hipY - 1); ctx.lineTo(sx - 5.4, sy + 1); ctx.stroke();
  // tulum üstlüğü (belden göğse)
  const bx = hipX + ls * 11, by = hipY - lc * 11;
  ctx.strokeStyle = L.over; ctx.lineWidth = 12.6; ctx.beginPath(); ctx.moveTo(hipX, hipY + 1); ctx.lineTo(bx, by); ctx.stroke();
  ctx.strokeStyle = rgba('#000', 0.14); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hipX + 4.6, hipY); ctx.lineTo(bx + 4.6 * lc, by + 4.6 * ls * 0); ctx.stroke();
  ctx.strokeStyle = L.over; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(bx - 3.4 * lc, by - 3.4 * ls); ctx.lineTo(sx - 3.6 * lc, sy - 1); ctx.moveTo(bx + 3 * lc, by + 3 * ls * 0); ctx.lineTo(sx + 3.4 * lc, sy - 1); ctx.stroke();
  // cep + düğme
  ctx.fillStyle = shade(L.over, -0.2); ctx.save(); ctx.translate(bx + 0.4 * lc, by - 1.5); ctx.rotate(P.lean); rr(ctx, -3.2, -2, 6.4, 4.4, 1); ctx.fill(); ctx.restore();
  ell(ctx, sx - 3 * lc, sy + 1.8, 1, 1, '#e8c860'); ell(ctx, sx + 3 * lc, sy + 1.8, 1, 1, '#e8c860');
  adLeg(ctx, hipX + 1, hipY, P.legs[1][0], P.legs[1][1], L, false);
  // alet (kısa saplı çapa)
  if (P.tool) {
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P.armF[0] - 1, P.armF[1] - 9); ctx.lineTo(P.armF[0] + 5, P.armF[1] + 8); ctx.stroke();
    ctx.fillStyle = '#9aa4ae'; ctx.beginPath(); ctx.moveTo(P.armF[0] + 3.4, P.armF[1] + 7); ctx.lineTo(P.armF[0] + 10, P.armF[1] + 9); ctx.lineTo(P.armF[0] + 6.6, P.armF[1] + 12); ctx.closePath(); ctx.fill();
  }
  adArm(ctx, sx + 1.2, sy + 1.4, P.armF[0], P.armF[1], L, false);
  // boyun + baş
  const hx = sx + ls * 7 + 1.4, hy = sy - lc * 7 + (P.hy || 0);
  ctx.fillStyle = L.skinD; ctx.fillRect(sx - 2 + ls * 3, sy - 6, 4.4, 6);
  ell(ctx, hx - 5, hy + 0.6, 1.9, 2.6, L.skinD);
  ctx.fillStyle = lg(ctx, hx - 6, hy - 7, hx + 6, hy + 8, [[0, shade(L.skin, 0.12)], [0.6, L.skin], [1, L.skinD]]);
  ctx.beginPath(); ctx.ellipse(hx, hy, 6.2, 7, 0, 0, TAU); ctx.fill();
  // saç (kulak üstü-arka)
  ctx.fillStyle = L.hair; ctx.beginPath(); ctx.ellipse(hx - 3.4, hy - 2.2, 3.6, 5.4, 0.2, 0, TAU); ctx.fill();
  // göz, burun, ağız, yanak
  if (P.blink) { ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + 1.6, hy - 0.6); ctx.lineTo(hx + 4.6, hy - 0.6); ctx.stroke(); }
  else { ell(ctx, hx + 3.2, hy - 0.8, 1.2, 1.5, '#2a1a12'); ell(ctx, hx + 2.8, hy - 1.4, 0.45, 0.45, '#fff'); }
  ell(ctx, hx + 6, hy + 1.2, 1.3, 1.1, rgba(L.skinD, 0.9));
  ctx.strokeStyle = rgba('#7a3a2a', 0.8); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(hx + 3, hy + 3.4, 2, 0.2, 1.2); ctx.stroke();
  ell(ctx, hx + 0.6, hy + 3, 2.2, 1.4, rgba('#e8806a', 0.28));
  // şapka
  const ty = hy - 5.2;
  if (L.hat === 'straw' || L.hat === 'wide') {
    ctx.fillStyle = shade(L.hatC, -0.14); ctx.beginPath(); ctx.ellipse(hx + 0.6, ty + 1.4, 11.4, 2.8, -0.06, 0, TAU); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, ty - 5, 0, ty + 2, [[0, shade(L.hatC, 0.12)], [1, L.hatC]]); ctx.beginPath(); ctx.moveTo(hx - 6, ty + 1.4); ctx.quadraticCurveTo(hx - 5, ty - 7, hx + 0.6, ty - 7); ctx.quadraticCurveTo(hx + 6, ty - 7, hx + 6.6, ty + 1.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = L.hat === 'straw' ? '#b8402f' : '#3d7a6a'; ctx.fillRect(hx - 6, ty - 1.2, 12.6, 2);
    ctx.strokeStyle = rgba('#8a6a2a', 0.35); ctx.lineWidth = 0.6; for (let i = -9; i < 10; i += 3) { ctx.beginPath(); ctx.moveTo(hx + i, ty + 1.6); ctx.lineTo(hx + i * 0.8, ty + 2.6); ctx.stroke(); }
  } else if (L.hat === 'cap') {
    ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.moveTo(hx - 6.4, ty + 2); ctx.quadraticCurveTo(hx - 6, ty - 7, hx + 0.6, ty - 6.4); ctx.quadraticCurveTo(hx + 6.6, ty - 6, hx + 6.8, ty + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(L.hatC, -0.2); ctx.beginPath(); ctx.ellipse(hx + 8, ty + 2.2, 5.4, 1.6, 0.1, 0, TAU); ctx.fill();
    ell(ctx, hx - 1, ty - 4.6, 3.4, 1.4, rgba('#fff', 0.25), -0.3);
  } else {
    ctx.fillStyle = L.hatC; ctx.beginPath(); ctx.moveTo(hx - 6.6, ty + 2.4); ctx.quadraticCurveTo(hx - 6, ty - 4.8, hx + 0.8, ty - 4.6); ctx.quadraticCurveTo(hx + 7.4, ty - 4, hx + 8.4, ty + 2.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(L.hatC, -0.22); ctx.beginPath(); ctx.ellipse(hx + 7.4, ty + 2.6, 3.6, 1.2, 0, 0, TAU); ctx.fill(); ell(ctx, hx, ty - 3.4, 3.6, 1.2, rgba('#fff', 0.2), -0.2);
  }
  // sol kenar ışığı (baş)
  ctx.strokeStyle = rgba('#fff4dc', 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hy, 6.4, Math.PI * 0.82, Math.PI * 1.2); ctx.stroke();
}

function genAdults(scene) {
  if (scene.textures.exists(adlKey(0, 'idle0'))) return;
  const poses = adultPoses();
  for (let l = 0; l < LOOKS.length; l++) {
    for (const f of ADL_FRAMES) {
      const { canvas, ctx } = makeCanvas(ADL.w, ADL.h); ctx.scale(2, 2);
      drawAdult(ctx, LOOKS[l], poses[f]);
      register(scene, adlKey(l, f), canvas);
    }
    // sürücü büstü (kabin)
    const { canvas, ctx } = makeCanvas(36 * 2, 40 * 2); ctx.scale(2, 2);
    const L = LOOKS[l];
    ctx.save(); ctx.translate(-12, -10); drawAdult(ctx, L, { hipY: 44, lean: 0, legs: [[28, 62], [33, 62]], armF: [38, 41], armN: [27, 41], hy: 0 }); ctx.restore();
    register(scene, `f8_drv_${l}`, canvas);
  }
}

// ------------------------------------------------------------------ KÜÇÜK PARÇALAR
function genMisc(scene) {
  const mk = (key, w, h, fn) => { if (scene.textures.exists(key)) return; const { canvas, ctx } = makeCanvas(w, h); fn(ctx, w, h); register(scene, key, canvas); };
  mk('f8_drop', 8, 20, (ctx) => { ctx.fillStyle = lg(ctx, 0, 0, 0, 20, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(225,245,255,0.55)'], [1, 'rgba(255,255,255,0.85)']]); ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(5.4, 14); ctx.quadraticCurveTo(4, 20, 2.6, 14); ctx.closePath(); ctx.fill(); ell(ctx, 3.6, 16.4, 1.4, 1.8, 'rgba(255,255,255,0.95)'); });
  mk('f8_glare', 80, 150, (ctx) => { ctx.fillStyle = lg(ctx, 0, 0, 80, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,250,235,0.55)'], [1, 'rgba(255,255,255,0)']]); poly(ctx, [[30, 0], [80, 0], [50, 150], [0, 150]]); ctx.fill(); });
  mk('f8_straw', 10, 4, (ctx) => { ctx.fillStyle = '#e8c860'; ctx.fillRect(0, 0.6, 10, 1.8); ctx.fillStyle = '#c49a30'; ctx.fillRect(2, 2.4, 7, 1); });
  mk('f8_ah', 64, 44, (ctx) => {
    ctx.fillStyle = 'rgba(255,214,120,0.32)'; rr(ctx, 3, 3, 58, 38, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(255,236,170,0.9)'; ctx.lineWidth = 2; rr(ctx, 3, 3, 58, 38, 9); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(ctx, 6, 6, 52, 10, 5); ctx.fill();
  });
  mk('f8_stake', 14, 34, (ctx) => {
    ell(ctx, 7, 31, 5, 2, 'rgba(20,14,8,0.3)');
    ctx.fillStyle = lg(ctx, 4, 0, 10, 0, [[0, '#c49a6c'], [1, '#6e4c32']]); ctx.beginPath(); ctx.moveTo(4.4, 8); ctx.lineTo(9.6, 8); ctx.lineTo(9, 31); ctx.lineTo(5, 31); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d8b488'; ctx.beginPath(); ctx.ellipse(7, 8, 3.2, 1.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d24a3a'; ctx.fillRect(4.4, 10, 5.2, 3); ctx.fillStyle = rgba('#fff', 0.5); ctx.fillRect(4.4, 10, 1, 3); ctx.fillStyle = '#f0e6cf'; ctx.fillRect(4.4, 13, 5.2, 2.2);
    ctx.fillStyle = rgba('#fff', 0.35); ctx.fillRect(4.4, 8, 1, 22);
  });
  mk('f8_rope_h', 128, 14, (ctx) => { ctx.strokeStyle = 'rgba(20,14,8,0.28)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 6.6); ctx.quadraticCurveTo(64, 15, 128, 6.6); ctx.stroke(); ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 3); ctx.quadraticCurveTo(64, 11.4, 128, 3); ctx.stroke(); ctx.strokeStyle = rgba('#a8946a', 0.7); ctx.lineWidth = 0.6; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(0, 3.6); ctx.quadraticCurveTo(64, 12, 128, 3.6); ctx.stroke(); });
  mk('f8_rope_v', 12, 88, (ctx) => { ctx.strokeStyle = 'rgba(20,14,8,0.26)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(7, 0); ctx.quadraticCurveTo(10, 44, 7, 88); ctx.stroke(); ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(5, 0); ctx.quadraticCurveTo(8, 44, 5, 88); ctx.stroke(); });
  // SATILIK tabelası: direk + tahta; üzerinde ev ve altın sikke (yazı yok)
  mk('f8_sign', 64, 84, (ctx) => {
    ell(ctx, 32, 80, 14, 3.4, 'rgba(20,14,8,0.32)');
    ctx.fillStyle = lg(ctx, 28, 0, 37, 0, [[0, '#b88a5c'], [1, '#6e4c32']]); ctx.fillRect(28, 40, 8, 40);
    ctx.fillStyle = lg(ctx, 0, 6, 0, 52, [[0, '#f6ecd4'], [1, '#e2d2ae']]); rr(ctx, 6, 6, 52, 44, 7); ctx.fill();
    ctx.strokeStyle = '#b8402f'; ctx.lineWidth = 3; rr(ctx, 7.5, 7.5, 49, 41, 6); ctx.stroke();
    // ev
    ctx.fillStyle = '#c4502f'; poly(ctx, [[14, 28], [28, 14], [42, 28]]); ctx.fill(); ctx.fillStyle = '#f0b878'; ctx.fillRect(17, 28, 22, 14); ctx.fillStyle = '#6a3a22'; ctx.fillRect(25, 32, 6, 10); ctx.fillStyle = '#7aa8c8'; ctx.fillRect(19, 31, 4, 4);
    // sikke
    ell(ctx, 46, 38, 9, 9, '#d6962a'); ell(ctx, 46, 38, 7.4, 7.4, lg(ctx, 0, 30, 0, 46, [[0, '#ffe07a'], [1, '#e0a42e']])); ctx.fillStyle = '#a8701a'; ctx.fillRect(45.2, 32.6, 1.8, 10.8); ctx.fillRect(42.4, 35, 7.4, 1.6); ctx.fillRect(42.4, 40.4, 7.4, 1.6);
    ctx.fillStyle = rgba('#fff', 0.7); ctx.beginPath(); ctx.ellipse(43, 34.4, 2, 1, -0.7, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba('#fff', 0.7); ctx.fillRect(8, 8, 1.6, 40);
  });
}

export function genFarm8(scene) {
  genGreenhouse(scene); genCold(scene); genWare(scene); genSilo(scene); genGarage(scene);
  genTractor(scene); genHarvester(scene); genAdults(scene); genMisc(scene);
}
