// Pazar tezgâhı ve satış/alış efekt dokuları (PLAN §9 "Görsel"). Açılışta BİR KEZ üretilir (idempotent).
// Tint'e dayanmaz: renkler pişirilmiştir (Canvas renderer'da da doğru görünür).
// Yerleşim: tüm parçalar ayak noktasına (0,0) göre STALL_LAYOUT'ta; aynı tablo hem MarketStall'u hem
// gölge silüetini/vurgu halesini besler, böylece hepsi birebir örtüşür.
import { makeCanvas, register, shade, rgba, radial, softenCanvas } from './canvas.js';
import { mulberry32 } from './noise.js';
import { registerShadow } from './props.js';

export const STRIPES = 13;          // tente şerit sayısı (saçak da şerit başına bir kare)
export const STRIPE_W = 20;
const AW_W = STRIPES * STRIPE_W;    // 260
const RED = '#c4523f', CREAM = '#f3e4c6';

// [anahtar, dx, dy, originX(px), originY(px)] — ayak noktasına göre
export const STALL_LAYOUT = {
  body: { key: 'prop_stall_body', w: 240, h: 232, ox: 120, oy: 224, dx: 0, dy: 0 },
  awning: { key: 'prop_stall_awning', w: AW_W + 8, h: 74, ox: (AW_W + 8) / 2, oy: 62, dx: 0, dy: -150 },
  valance: { key: 'prop_stall_valance', dy: -153, h: 24 },
  crates: [{ dx: -60, dy: 10 }, { dx: 2, dy: 18 }, { dx: 64, dy: 11 }],
  crateBack: { key: 'prop_crate_back', w: 60, h: 46, ox: 30, oy: 46 },
  crateFront: { key: 'prop_crate_front', w: 60, h: 46, ox: 30, oy: 46 },
  sign: { key: 'prop_stall_sign', w: 46, h: 78, ox: 23, oy: 74, dx: -112, dy: 16 },
  lantern: { key: 'prop_lantern', w: 22, h: 40, ox: 11, oy: 2, dx: 70, dy: -134 },
};
export const CRATE_LIP = -27; // sandık ağzının ön kenarı (sandık ayağına göre)

function woodRect(ctx, x, y, w, h, base, r, vertical = false, grain = 0.18) {
  const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(base, 0.14)); g.addColorStop(0.55, base); g.addColorStop(1, shade(base, -0.25));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const n = Math.max(2, Math.round((vertical ? w : h) / 3));
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = rgba(r() < 0.5 ? '#2a160c' : '#ffe2b8', grain * (0.4 + r() * 0.6)); ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (vertical) { const xx = x + r() * w; ctx.moveTo(xx, y); ctx.bezierCurveTo(xx + (r() - 0.5) * 3, y + h * 0.3, xx + (r() - 0.5) * 3, y + h * 0.7, xx, y + h); }
    else { const yy = y + r() * h; ctx.moveTo(x, yy); ctx.bezierCurveTo(x + w * 0.3, yy + (r() - 0.5) * 2.5, x + w * 0.7, yy + (r() - 0.5) * 2.5, x + w, yy); }
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ gövde: direkler + tezgâh + arka raf
function body(scene) {
  const L = STALL_LAYOUT.body; if (scene.textures.exists(L.key)) return null;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(310);
  const post = (x, y0, y1, w, base) => {
    woodRect(ctx, x, y0, w, y1 - y0, base, r, true, 0.15);
    ctx.fillStyle = 'rgba(255,226,180,0.28)'; ctx.fillRect(x, y0, 1.4, y1 - y0); // sol kenar ışığı
  };
  // arka direkler (uzakta: daha koyu, daha kısa taban)
  post(36, 40, 182, 7, '#6e4a30'); post(197, 40, 182, 7, '#6e4a30');
  // arka raf + üzerinde sepetler
  woodRect(ctx, 38, 104, 166, 7, '#7a5236', r);
  for (const [x, c] of [[60, '#b98a52'], [100, '#a77a46'], [146, '#b98a52'], [180, '#a77a46']]) {
    ctx.fillStyle = shade(c, -0.15); ctx.beginPath(); ctx.ellipse(x, 104, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, 90, 0, 104); g.addColorStop(0, c); g.addColorStop(1, shade(c, -0.3));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 13, 104); ctx.lineTo(x - 11, 92); ctx.lineTo(x + 11, 92); ctx.lineTo(x + 13, 104); ctx.fill();
    ctx.strokeStyle = 'rgba(70,40,20,0.35)'; ctx.lineWidth = 0.8;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x - 12, 95 + k * 3.5); ctx.lineTo(x + 12, 95 + k * 3.5); ctx.stroke(); }
    ctx.fillStyle = rgba('#3a2414', 0.7); ctx.beginPath(); ctx.ellipse(x, 92, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  // tezgâh üst yüzeyi (yamuk: arka kenar dar, ön kenar geniş)
  const tg = ctx.createLinearGradient(0, 128, 0, 150);
  tg.addColorStop(0, '#9a6c46'); tg.addColorStop(1, '#c79a6a');
  ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(34, 128); ctx.lineTo(206, 128); ctx.lineTo(216, 150); ctx.lineTo(24, 150); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(70,40,20,0.3)'; ctx.lineWidth = 0.8;
  for (let i = 1; i < 4; i++) { const y = 128 + i * 5.5; const k = (y - 128) / 22; ctx.beginPath(); ctx.moveTo(34 - 10 * k, y); ctx.lineTo(206 + 10 * k, y); ctx.stroke(); }
  // ön kenar ışığı (rim)
  ctx.fillStyle = 'rgba(255,232,190,0.55)'; ctx.fillRect(24, 149, 192, 2);
  // ön yüz: dikey tahtalar
  for (let x = 26, i = 0; x < 214; x += 21, i++) {
    const w = Math.min(21, 214 - x);
    woodRect(ctx, x, 151, w - 1, 60, i % 2 ? '#8c5f3c' : '#966843', r, true, 0.2);
    ctx.fillStyle = 'rgba(40,20,10,0.35)'; ctx.fillRect(x + w - 1, 151, 1, 60);
  }
  // üstte saçak gölgesi, altta ambient oklüzyon
  const sg = ctx.createLinearGradient(0, 151, 0, 168); sg.addColorStop(0, 'rgba(30,15,10,0.45)'); sg.addColorStop(1, 'rgba(30,15,10,0)');
  ctx.fillStyle = sg; ctx.fillRect(26, 151, 188, 17);
  const ag = ctx.createLinearGradient(0, 196, 0, 212); ag.addColorStop(0, 'rgba(25,14,10,0)'); ag.addColorStop(1, 'rgba(25,14,10,0.45)');
  ctx.fillStyle = ag; ctx.fillRect(26, 196, 188, 16);
  // çapraz destek
  ctx.strokeStyle = '#5e3c26'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(40, 160); ctx.lineTo(100, 204); ctx.moveTo(200, 160); ctx.lineTo(140, 204); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,170,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 158.5); ctx.lineTo(100, 202.5); ctx.stroke();
  // tezgâh üstünde pirinç terazi
  const bx = 176, by = 138;
  ctx.fillStyle = '#6b4a22'; ctx.fillRect(bx - 1.2, by - 18, 2.4, 18);
  ctx.fillStyle = '#d9a640'; ctx.fillRect(bx - 14, by - 19, 28, 2.4);
  for (const sx of [-12, 12]) {
    ctx.strokeStyle = 'rgba(120,80,20,0.9)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(bx + sx, by - 17); ctx.lineTo(bx + sx - 4, by - 9); ctx.moveTo(bx + sx, by - 17); ctx.lineTo(bx + sx + 4, by - 9); ctx.stroke();
    ctx.fillStyle = radial(ctx, bx + sx - 1, by - 9, 6, [[0, '#ffe29a'], [1, '#a8741e']]); ctx.beginPath(); ctx.ellipse(bx + sx, by - 8.5, 5.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#8a6224'; ctx.beginPath(); ctx.ellipse(bx, by, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  // ön direkler
  post(20, 54, 216, 9, '#86593a'); post(211, 54, 216, 9, '#86593a');
  ctx.fillStyle = '#4a2f1e'; ctx.fillRect(18, 212, 13, 5); ctx.fillRect(209, 212, 13, 5);
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  return canvas;
}

// ------------------------------------------------------------------ tente (çatı yüzü) ve saçak şeritleri
function awning(scene) {
  const L = STALL_LAYOUT.awning; if (scene.textures.exists(L.key)) return null;
  const { canvas, ctx } = makeCanvas(L.w, L.h);
  const fy = L.oy, by = 8, x0 = 4, x1 = 4 + AW_W, bx0 = 34, bx1 = L.w - 34;
  for (let i = 0; i < STRIPES; i++) {
    const a = i / STRIPES, b = (i + 1) / STRIPES;
    const fa = x0 + (x1 - x0) * a, fb = x0 + (x1 - x0) * b, ba = bx0 + (bx1 - bx0) * a, bb = bx0 + (bx1 - bx0) * b;
    const c = i % 2 ? CREAM : RED;
    const g = ctx.createLinearGradient(0, by, 0, fy);
    g.addColorStop(0, shade(c, -0.32)); g.addColorStop(0.7, shade(c, -0.04)); g.addColorStop(1, shade(c, 0.1));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ba, by); ctx.lineTo(bb + 0.5, by); ctx.lineTo(fb + 0.5, fy); ctx.lineTo(fa, fy); ctx.closePath(); ctx.fill();
  }
  // kumaş kıvrımları: şerit ortalarında hafif gölge/ışık
  for (let i = 0; i < STRIPES; i++) {
    const m = (i + 0.5) / STRIPES; const fm = x0 + (x1 - x0) * m, bm = bx0 + (bx1 - bx0) * m;
    ctx.strokeStyle = 'rgba(255,245,225,0.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bm - 2, by); ctx.lineTo(fm - 3, fy); ctx.stroke();
  }
  // sarkma (orta hafif çökük): üstten yumuşak gölge bandı
  const sag = ctx.createRadialGradient(L.w / 2, by + (fy - by) * 0.55, 4, L.w / 2, by + (fy - by) * 0.55, L.w * 0.5);
  sag.addColorStop(0, 'rgba(60,20,20,0.12)'); sag.addColorStop(1, 'rgba(60,20,20,0)');
  ctx.fillStyle = sag; ctx.fillRect(0, 0, L.w, fy);
  // arka kenar çıtası + ön kenar ışığı
  ctx.fillStyle = '#5e3c26'; ctx.beginPath(); ctx.roundRect(bx0 - 4, by - 4, bx1 - bx0 + 8, 5, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,238,205,0.5)'; ctx.fillRect(x0, fy - 2, AW_W, 2);
  ctx.fillStyle = '#6a4329'; ctx.fillRect(x0 - 2, fy, AW_W + 4, 4);
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy, fy, by });
  // saçak: her şerit bir kare, alt kenar fiston (yuvarlak dil)
  const V = STALL_LAYOUT.valance;
  if (!scene.textures.exists(V.key)) {
    const { canvas: vc, ctx: v } = makeCanvas(AW_W, V.h);
    for (let i = 0; i < STRIPES; i++) {
      const x = i * STRIPE_W, c = i % 2 ? CREAM : RED;
      const g = v.createLinearGradient(0, 0, 0, V.h); g.addColorStop(0, shade(c, 0.08)); g.addColorStop(0.75, c); g.addColorStop(1, shade(c, -0.22));
      v.fillStyle = g; v.beginPath(); v.moveTo(x, 0); v.lineTo(x + STRIPE_W, 0); v.lineTo(x + STRIPE_W, V.h - 9);
      v.quadraticCurveTo(x + STRIPE_W - 1, V.h + 0.5, x + STRIPE_W / 2, V.h - 0.5); v.quadraticCurveTo(x + 1, V.h + 0.5, x, V.h - 9); v.closePath(); v.fill();
      v.fillStyle = 'rgba(40,15,10,0.18)'; v.fillRect(x, 0, 1, V.h - 8);
      v.fillStyle = 'rgba(255,240,215,0.35)'; v.fillRect(x, 0, STRIPE_W, 1.5);
    }
    const t = register(scene, V.key, vc, { strip: STRIPE_W });
    for (let i = 0; i < STRIPES; i++) t.add(`v${i}`, 0, i * STRIPE_W, 0, STRIPE_W, V.h);
    return { canvas, vc };
  }
  return { canvas, vc: null };
}

// ------------------------------------------------------------------ sandık (arka iç + ön yüz)
function crates(scene) {
  const B = STALL_LAYOUT.crateBack, F = STALL_LAYOUT.crateFront;
  if (scene.textures.exists(F.key)) return null;
  const r = mulberry32(77);
  const lip = F.oy + CRATE_LIP; // ağız ön kenarı (dokuda)
  // arka: iç karanlık + arka duvar üst kenarı
  const { canvas: bc, ctx: b } = makeCanvas(B.w, B.h);
  woodRect(b, 3, lip - 13, B.w - 6, 6, '#8a5e3a', r);
  const ig = b.createLinearGradient(0, lip - 8, 0, lip); ig.addColorStop(0, '#2c1a10'); ig.addColorStop(1, '#4a2e1c');
  b.fillStyle = ig; b.fillRect(5, lip - 8, B.w - 10, 9);
  b.fillStyle = '#6b4529'; b.fillRect(3, lip - 13, 3, 14); b.fillRect(B.w - 6, lip - 13, 3, 14);
  register(scene, B.key, bc, { footX: B.ox, footY: B.oy });
  // ön: iki yatay çıta + köşe dikmeleri + ağız ön kenarı ışığı
  const { canvas: fc, ctx: f } = makeCanvas(F.w, F.h);
  woodRect(f, 2, lip, F.w - 4, 12, '#a2714a', r, false, 0.22);
  woodRect(f, 2, lip + 13, F.w - 4, 12, '#93653f', r, false, 0.22);
  f.fillStyle = 'rgba(40,20,10,0.4)'; f.fillRect(2, lip + 12, F.w - 4, 1.2);
  woodRect(f, 1, lip - 1, 5, F.oy - lip + 1, '#7a5233', r, true); woodRect(f, F.w - 6, lip - 1, 5, F.oy - lip + 1, '#7a5233', r, true);
  f.fillStyle = 'rgba(255,232,190,0.6)'; f.fillRect(2, lip, F.w - 4, 1.4);
  const ao = f.createLinearGradient(0, F.oy - 8, 0, F.oy); ao.addColorStop(0, 'rgba(20,10,6,0)'); ao.addColorStop(1, 'rgba(20,10,6,0.4)');
  f.fillStyle = ao; f.fillRect(1, F.oy - 8, F.w - 2, 8);
  // tutma deliği
  f.fillStyle = '#3a2214'; f.beginPath(); f.roundRect(F.w / 2 - 7, lip + 4, 14, 4, 2); f.fill();
  register(scene, F.key, fc, { footX: F.ox, footY: F.oy });
  return { bc, fc };
}

// ------------------------------------------------------------------ tabela (yazısız: terazi + sikke)
function sign(scene) {
  const L = STALL_LAYOUT.sign; if (scene.textures.exists(L.key)) return null;
  const { canvas, ctx } = makeCanvas(L.w, L.h); const r = mulberry32(91);
  woodRect(ctx, L.ox - 2.5, 30, 5, L.oy - 28, '#6e4a30', r, true);
  ctx.fillStyle = '#4a2f1e'; ctx.fillRect(L.ox - 5, L.oy - 3, 10, 4);
  // pano
  ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.roundRect(3, 4, L.w - 6, 32, 6); ctx.fill();
  const g = ctx.createLinearGradient(0, 6, 0, 34); g.addColorStop(0, '#c9965f'); g.addColorStop(1, '#8e6038');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(5, 6, L.w - 10, 28, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,236,200,0.45)'; ctx.fillRect(7, 6.5, L.w - 14, 1.3);
  // terazi (sol) + sikke (sağ)
  const cx = 16, cy = 22;
  ctx.fillStyle = '#3c2616'; ctx.fillRect(cx - 0.8, cy - 10, 1.6, 12); ctx.fillRect(cx - 6, cy + 1.5, 12, 1.6); ctx.fillRect(cx - 9, cy - 10, 18, 1.6);
  ctx.strokeStyle = '#3c2616'; ctx.lineWidth = 0.9;
  for (const sx of [-8, 8]) { ctx.beginPath(); ctx.moveTo(cx + sx, cy - 9); ctx.lineTo(cx + sx - 3, cy - 3); ctx.lineTo(cx + sx + 3, cy - 3); ctx.closePath(); ctx.stroke(); ctx.fillStyle = '#3c2616'; ctx.beginPath(); ctx.ellipse(cx + sx, cy - 3, 3.4, 1.2, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = radial(ctx, 30, 18, 8, [[0, '#ffe7a0'], [0.6, '#e0a634'], [1, '#9a6a18']]); ctx.beginPath(); ctx.arc(31, 20, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(110,70,15,0.8)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(31, 20, 4.4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,250,220,0.8)'; ctx.beginPath(); ctx.arc(29, 18, 1.2, 0, Math.PI * 2); ctx.fill();
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  return canvas;
}

// ------------------------------------------------------------------ fener (+ gece yanan cam çekirdeği)
function lantern(scene) {
  const L = STALL_LAYOUT.lantern; if (scene.textures.exists(L.key)) return;
  const { canvas, ctx } = makeCanvas(L.w, L.h);
  const cx = L.ox;
  ctx.strokeStyle = '#2d2622'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, 8); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, 8, 3, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#34302c'; ctx.beginPath(); ctx.moveTo(cx - 7, 15); ctx.lineTo(cx, 9); ctx.lineTo(cx + 7, 15); ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - 7, 15, 14, 2.5);
  const g = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0); g.addColorStop(0, '#fff0c8'); g.addColorStop(0.5, '#ffd88a'); g.addColorStop(1, '#d9a85a');
  ctx.fillStyle = g; ctx.fillRect(cx - 6, 17.5, 12, 14);
  ctx.fillStyle = 'rgba(255,150,60,0.75)'; ctx.beginPath(); ctx.ellipse(cx, 26, 2.4, 3.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2d2622'; ctx.lineWidth = 1.2; ctx.strokeRect(cx - 6, 17.5, 12, 14); ctx.beginPath(); ctx.moveTo(cx, 17.5); ctx.lineTo(cx, 31.5); ctx.stroke();
  ctx.fillStyle = '#34302c'; ctx.fillRect(cx - 7.5, 31.5, 15, 3); ctx.fillRect(cx - 4, 34.5, 8, 2);
  register(scene, L.key, canvas, { footX: L.ox, footY: L.oy });
  // gece emisif: cam çekirdeği + yumuşak hale (ADD)
  const { canvas: gc, ctx: e } = makeCanvas(64, 64);
  e.fillStyle = radial(e, 32, 32, 30, [[0, 'rgba(255,236,190,1)'], [0.18, 'rgba(255,210,130,0.95)'], [0.4, 'rgba(255,160,70,0.35)'], [1, 'rgba(255,140,50,0)']]);
  e.fillRect(0, 0, 64, 64);
  register(scene, 'prop_lantern_glow', gc);
}

// ------------------------------------------------------------------ silüet (gölge + hover halesi)
function silhouette(scene, parts) {
  if (scene.textures.exists('prop_stall_sil__sh') && scene.textures.exists('prop_stall_hl')) return;
  const W = 330, H = 290, FX = 165, FY = 262; // ayak noktası silüet dokusunda
  const { canvas, ctx } = makeCanvas(W, H);
  const put = (key, dx, dy, ox, oy) => {
    const tex = scene.textures.get(key); if (!tex || tex.key === '__MISSING') return;
    ctx.drawImage(tex.getSourceImage(), FX + dx - ox, FY + dy - oy);
  };
  const S = STALL_LAYOUT;
  put(S.body.key, S.body.dx, S.body.dy, S.body.ox, S.body.oy);
  put(S.awning.key, S.awning.dx, S.awning.dy, S.awning.ox, S.awning.oy);
  put(S.valance.key, -AW_W / 2, S.valance.dy, 0, 0);
  for (const c of S.crates) { put(S.crateBack.key, c.dx, c.dy, S.crateBack.ox, S.crateBack.oy); put(S.crateFront.key, c.dx, c.dy, S.crateFront.ox, S.crateFront.oy); }
  put(S.sign.key, S.sign.dx, S.sign.dy, S.sign.ox, S.sign.oy);
  registerShadow(scene, 'prop_stall_sil', canvas, FX, FY);
  // hover halesi: genişletilmiş + yumuşatılmış sıcak beyaz silüet, iç kısmı büyük ölçüde oyulmuş (kenar ışığı)
  if (!scene.textures.exists('prop_stall_hl')) {
    const { canvas: mk, ctx: m } = makeCanvas(W, H);
    m.drawImage(canvas, 0, 0); m.globalCompositeOperation = 'source-in'; m.fillStyle = '#fff3d6'; m.fillRect(0, 0, W, H);
    const { canvas: hc, ctx: h } = makeCanvas(W, H);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; h.drawImage(mk, Math.cos(a) * 3.5, Math.sin(a) * 3.5); }
    softenCanvas(hc, 3);
    h.globalCompositeOperation = 'destination-out'; h.globalAlpha = 0.8; h.drawImage(mk, 0, 0);
    h.globalCompositeOperation = 'source-over'; h.globalAlpha = 1;
    register(scene, 'prop_stall_hl', hc, { footX: FX, footY: FY });
  }
  void parts;
}

// ------------------------------------------------------------------ efekt dokuları
function fx(scene) {
  if (!scene.textures.exists('fx_coin')) { // ön yüz; dönüş scaleX ile
    const s = 20; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#8a5a12'; ctx.beginPath(); ctx.arc(10, 10.6, 8.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = radial(ctx, 7.5, 7, 10, [[0, '#fff3b8'], [0.45, '#f2c24e'], [1, '#b07a1c']]); ctx.beginPath(); ctx.arc(10, 10, 8.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(140,90,20,0.75)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(10, 10, 5.6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,235,0.9)'; ctx.beginPath(); ctx.ellipse(7, 6.5, 2.2, 1.3, -0.6, 0, Math.PI * 2); ctx.fill();
    register(scene, 'fx_coin', canvas);
  }
  if (!scene.textures.exists('fx_sparkle_gold')) { // 4 kollu yıldız parıltısı (ADD)
    const s = 32; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 16, 16, 16, [[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,214,120,0.6)'], [1, 'rgba(255,180,60,0)']]); ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,246,210,0.95)';
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(17.2, 14.8, 32, 16); ctx.quadraticCurveTo(17.2, 17.2, 16, 32); ctx.quadraticCurveTo(14.8, 17.2, 0, 16); ctx.quadraticCurveTo(14.8, 14.8, 16, 0); ctx.fill();
    register(scene, 'fx_sparkle_gold', canvas);
  }
  if (!scene.textures.exists('fx_glow_gold')) {
    const s = 128; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 64, 64, 64, [[0, 'rgba(255,236,170,0.9)'], [0.3, 'rgba(255,196,90,0.45)'], [0.7, 'rgba(255,160,60,0.1)'], [1, 'rgba(255,150,50,0)']]);
    ctx.fillRect(0, 0, s, s); register(scene, 'fx_glow_gold', canvas);
  }
  if (!scene.textures.exists('fx_ring_gold')) { // ince yumuşak halka (seviye dalgası, zemin halkası)
    const s = 256; const { canvas, ctx } = makeCanvas(s, s);
    const img = ctx.createImageData(s, s); const d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s * 2 - 1, v = (y + 0.5) / s * 2 - 1; const rr = Math.sqrt(u * u + v * v);
      const k = (rr - 0.92) / 0.035; const a = Math.exp(-k * k) + Math.max(0, 0.18 * (1 - Math.abs(rr - 0.86) / 0.14)) * (rr < 0.92 ? 1 : 0);
      const i = (y * s + x) * 4; d[i] = 255; d[i + 1] = 220 + 30 * Math.exp(-k * k); d[i + 2] = 140 + 80 * Math.exp(-k * k); d[i + 3] = Math.min(255, a * 255);
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_ring_gold', canvas);
  }
  if (!scene.textures.exists('fx_parcel')) { // karton koli + sicim (teslimat)
    const w = 30, h = 30; const { canvas, ctx } = makeCanvas(w, h);
    ctx.fillStyle = '#c9965a'; ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(13, 5); ctx.lineTo(27, 7); ctx.lineTo(18, 12.5); ctx.closePath(); ctx.fill();   // üst
    const fg = ctx.createLinearGradient(0, 12, 0, 28); fg.addColorStop(0, '#b47d44'); fg.addColorStop(1, '#8a5a2e');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(18, 12.5); ctx.lineTo(18, 28); ctx.lineTo(4, 25); ctx.closePath(); ctx.fill();          // ön
    ctx.fillStyle = '#7a4e28'; ctx.beginPath(); ctx.moveTo(18, 12.5); ctx.lineTo(27, 7); ctx.lineTo(27, 22); ctx.lineTo(18, 28); ctx.closePath(); ctx.fill();         // yan
    ctx.strokeStyle = '#efe2c2'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(8.5, 7.5); ctx.lineTo(22.5, 9.8); ctx.moveTo(11, 11.2); ctx.lineTo(11, 26.5); ctx.moveTo(22.5, 9.8); ctx.lineTo(22.5, 25); ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,210,0.5)'; ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(13, 5); ctx.lineTo(14, 5.6); ctx.lineTo(5, 10.6); ctx.fill();
    ctx.fillStyle = '#d94a3e'; ctx.beginPath(); ctx.arc(15.2, 8.7, 2, 0, Math.PI * 2); ctx.fill(); // fiyonk
    register(scene, 'fx_parcel', canvas, { footX: 15, footY: 27 });
  }
}

export function genMarket(scene) {
  if (scene.textures.exists('prop_stall_hl') && scene.textures.exists('fx_parcel')) return;
  body(scene); awning(scene); crates(scene); sign(scene); lantern(scene);
  silhouette(scene);
  fx(scene);
}
