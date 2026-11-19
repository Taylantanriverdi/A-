// Gece İstilası dokuları (PLAN §16 Görsel): canavarlar (zombi/iskelet/hayalet), askerler (bekçi/okçu/şövalye), savunma yapıları
// (telli çit + taş duvar atlasları, kazık tuzağı, meşale + alev, gözcü kulesi, ok), hasar/duman/yıldız/göz-parıltısı efektleri.
// Aile dostu: kan yok. Açılışta BİR KEZ üretilir (idempotent); hepsi SAĞA bakar, sola gitmek için ayna.
import { makeCanvas, register, shade, rgba, radial } from './canvas.js';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
const ell = (c, x, y, rx, ry, fill, rot = 0) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill(); };
const lg = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, col] of stops) g.addColorStop(o, col); return g; };
const line = (c, x0, y0, x1, y1, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
const rrect = (c, x, y, w, h, r) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); };

// ------------------------------------------------------------------ canavarlar
export const MON = {
  zombie: { w: 100, h: 112, ox: 46, oy: 104, n: 4, eyeCol: 0xb8ff5c, scale: 1 },
  skeleton: { w: 100, h: 112, ox: 46, oy: 104, n: 4, eyeCol: 0xffa23c, scale: 1 },
  ghost: { w: 100, h: 128, ox: 46, oy: 112, n: 4, eyeCol: 0x8feaff, scale: 1 },
};
export const monKey = (t, f) => `mon_${t}_${f}`;
/** Göz parıltısı konumu: MON_EYE[tür][kare] = [x, y, aralık] (doku px, ayak noktasına göre değil dokuya göre). */
export const MON_EYE = { zombie: [], skeleton: [], ghost: [] };

function legPair(c, hx, hy, fy, ph, amp, col, colBack, w) {
  const a = Math.sin(ph), b = Math.sin(ph + Math.PI);
  line(c, hx - 1, hy, hx - 1 + b * amp, fy - Math.max(0, Math.cos(ph + Math.PI)) * 4, w, colBack);
  line(c, hx + 1, hy, hx + 1 + a * amp, fy - Math.max(0, Math.cos(ph)) * 4, w, col);
  return [hx + 1 + a * amp, fy - Math.max(0, Math.cos(ph)) * 4, hx - 1 + b * amp, fy - Math.max(0, Math.cos(ph + Math.PI)) * 4];
}

function drawZombie(ctx, f) {
  const ph = f / 4 * TAU, bob = Math.abs(Math.sin(ph)) * 2.2, sway = Math.sin(ph) * 0.05;
  const fy = 104;
  ell(ctx, 46, fy + 1, 22, 4, rgba('#10180c', 0.22));
  ctx.save(); ctx.translate(46, fy); ctx.rotate(sway); ctx.translate(-46, -fy);
  const [f1x, f1y, f2x, f2y] = legPair(ctx, 44, 80 - bob, fy - 3, ph, 8, '#56607a', '#3c4458', 8);
  ell(ctx, f1x + 2, f1y + 1, 6, 3.4, '#8fb078'); ell(ctx, f2x + 2, f2y + 1, 6, 3.4, '#6f9060');
  // ripped pants hem
  line(ctx, 40, 90 - bob, 44, 94 - bob, 2, rgba('#2a3040', 0.5));
  // far arm (arkadaki, koyu)
  const aw = Math.sin(ph + 1.2) * 3;
  line(ctx, 58, 60 - bob, 78, 54 - bob + aw, 6.4, '#6a8a56'); ell(ctx, 80, 54 - bob + aw, 4.4, 4.2, '#7ea267');
  // gövde: öne eğik, yırtık gömlek
  ctx.save(); ctx.translate(52, 66 - bob); ctx.rotate(0.5);
  ctx.fillStyle = lg(ctx, -12, -16, 12, 18, [[0, '#8aa670'], [1, '#5d7a4c']]); rrect(ctx, -13, -17, 26, 36, 10); ctx.fill();
  ctx.fillStyle = rgba('#3a2f24', 0.55); ctx.beginPath(); ctx.moveTo(-13, 14); ctx.lineTo(-9, 21); ctx.lineTo(-4, 15); ctx.lineTo(1, 22); ctx.lineTo(6, 15); ctx.lineTo(11, 21); ctx.lineTo(13, 14); ctx.closePath(); ctx.fill();
  ell(ctx, -3, -4, 4, 3, rgba('#52402a', 0.7), 0.3); ell(ctx, 5, 6, 3, 2.4, rgba('#52402a', 0.6));
  line(ctx, -13, 0, 13, 0, 1.2, rgba('#2c3a24', 0.4));
  ctx.restore();
  // kafa (öne düşük)
  const hx = 67, hy = 48 - bob;
  ell(ctx, hx, hy, 14, 13.5, lg(ctx, hx - 12, hy - 12, hx + 12, hy + 12, [[0, '#b3d494'], [1, '#7da064']]));
  ell(ctx, hx - 4, hy - 8, 6, 3, rgba('#ffffff', 0.2), -0.4);
  // seyrek saç
  line(ctx, hx - 8, hy - 12, hx - 12, hy - 18, 1.6, '#3e3a26'); line(ctx, hx - 3, hy - 13, hx - 4, hy - 20, 1.6, '#3e3a26'); line(ctx, hx + 3, hy - 13, hx + 5, hy - 19, 1.6, '#3e3a26');
  // göz çukurları + ağız
  ell(ctx, hx + 7, hy - 1.5, 4.2, 4.6, '#1e2a18'); ell(ctx, hx - 4, hy - 2.5, 3.8, 4.2, '#26341e');
  ell(ctx, hx + 7.4, hy - 1.2, 1.6, 1.8, '#d8ffa0'); ell(ctx, hx - 3.6, hy - 2.2, 1.4, 1.6, '#d8ffa0');
  ctx.strokeStyle = '#2a3322'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hx + 1, hy + 7); ctx.quadraticCurveTo(hx + 7, hy + 9.5, hx + 11, hy + 6); ctx.stroke();
  ctx.fillStyle = '#e8efd8'; ctx.fillRect(hx + 4, hy + 6.8, 2.2, 2.4); ctx.fillRect(hx + 8, hy + 6.8, 2, 2);
  MON_EYE.zombie[f] = [hx + 1.5, hy - 2, 11 + 0];
  // yakın kol (öne uzanmış)
  const aw2 = Math.sin(ph) * 3;
  line(ctx, 58, 62 - bob, 84, 58 - bob + aw2, 7, '#86aa6e'); ell(ctx, 87, 58 - bob + aw2, 5, 4.6, '#9cc27f');
  line(ctx, 57, 61 - bob, 70, 59.5 - bob + aw2 * 0.5, 3, rgba('#ffffff', 0.15));
  ctx.restore();
}

function bone(ctx, x0, y0, x1, y1, w, col) { line(ctx, x0, y0, x1, y1, w, col); ell(ctx, x0, y0, w * 0.75, w * 0.75, col); ell(ctx, x1, y1, w * 0.8, w * 0.8, col); }
function drawSkeleton(ctx, f) {
  const ph = f / 4 * TAU, bob = Math.abs(Math.sin(ph * 1)) * 3, B = '#f0e8d2', BD = '#c9bd9c';
  const fy = 104;
  ell(ctx, 46, fy + 1, 19, 3.6, rgba('#10120c', 0.22));
  // bacaklar: hızlı geniş adım
  const a = Math.sin(ph), b = Math.sin(ph + Math.PI), hy = 78 - bob;
  for (const [s, col, pa] of [[b, BD, ph + Math.PI], [a, B, ph]]) {
    const fx = 46 + s * 11, fyy = fy - 2 - Math.max(0, Math.cos(pa)) * 7, kx = (46 + fx) / 2 + 5, ky = (hy + fyy) / 2;
    bone(ctx, 46, hy, kx, ky, 3.2, col); bone(ctx, kx, ky, fx, fyy, 3, col); ell(ctx, fx + 3, fyy + 1, 5.4, 2.6, col);
  }
  // pelvis
  ell(ctx, 46, hy - 1, 8, 5, B);
  // omurga + kaburgalar
  line(ctx, 46, hy - 4, 50, 52 - bob, 3, BD);
  for (let i = 0; i < 4; i++) { const t = i / 3, y = 56 - bob + (hy - 4 - (56 - bob)) * (1 - t) * 0.0 + i * 5 + 2; ell(ctx, 48 + (i - 1.5) * 0.3, y, 9 - Math.abs(i - 1.2) * 0.9, 2.3, i % 2 ? B : BD); }
  // kollar: sallanır
  const sw = Math.sin(ph + 0.8) * 12, sw2 = Math.sin(ph + 0.8 + Math.PI) * 12;
  bone(ctx, 50, 56 - bob, 50 + 8 + sw2 * 0.4, 66 - bob, 2.8, BD); bone(ctx, 50 + 8 + sw2 * 0.4, 66 - bob, 52 + sw2 * 0.9 + 8, 72 - bob + Math.abs(sw2) * 0.2, 2.6, BD);
  // kafa (büyük, sevimli)
  const hx = 53, hyy = 40 - bob;
  ell(ctx, hx, hyy, 14.5, 14, lg(ctx, hx - 12, hyy - 12, hx + 12, hyy + 14, [[0, '#fffaf0'], [1, '#d6caa8']]));
  ell(ctx, hx + 3, hyy + 11, 9, 4.5, B);                    // çene
  for (let i = 0; i < 4; i++) line(ctx, hx - 1 + i * 3.4, hyy + 9, hx - 1 + i * 3.4, hyy + 12.6, 1.2, '#7a705c');
  ell(ctx, hx + 6, hyy - 1.5, 5.2, 5.6, '#1c1a16'); ell(ctx, hx - 5, hyy - 2.5, 4.6, 5, '#26221c');
  ell(ctx, hx + 6.4, hyy - 1.2, 1.7, 1.9, '#ffd49a'); ell(ctx, hx - 4.6, hyy - 2.2, 1.5, 1.7, '#ffd49a');
  line(ctx, hx + 1, hyy + 4.5, hx + 2.4, hyy + 7, 1.4, '#4a4234');
  MON_EYE.skeleton[f] = [hx + 0.5, hyy - 2, 11];
  // ön kol (yakın)
  const x1 = 52 + 9 + sw * 0.5;
  bone(ctx, 52, 57 - bob, x1, 67 - bob, 3, B); bone(ctx, x1, 67 - bob, x1 + 7 + sw * 0.25, 73 - bob, 2.8, B);
  ell(ctx, x1 + 10 + sw * 0.25, 74 - bob, 3.2, 3, B);
  // küçük yırtık kuşak
  ctx.fillStyle = rgba('#6a4a4a', 0.85); ctx.beginPath(); ctx.moveTo(40, hy - 4); ctx.lineTo(52, hy - 4); ctx.lineTo(50, hy + 6); ctx.lineTo(46, hy + 3); ctx.lineTo(42, hy + 7); ctx.closePath(); ctx.fill();
}

function drawGhost(ctx, f) {
  const ph = f / 4 * TAU, w1 = Math.sin(ph), w2 = Math.sin(ph + 1.6);
  const cx = 52, top = 22, bot = 104 + w1 * 2;
  ell(ctx, 46, 118, 16, 3.4, rgba('#101a30', 0.0));
  // kuyruk (arkada kıvrılan)
  ctx.beginPath(); ctx.moveTo(cx - 18, 74); ctx.bezierCurveTo(cx - 30, 86, cx - 40 + w1 * 4, 98 + w2 * 3, cx - 36 + w2 * 6, 112 + w1 * 3);
  ctx.bezierCurveTo(cx - 26, 106, cx - 14, 104, cx - 6, 100); ctx.closePath();
  ctx.fillStyle = lg(ctx, 0, 74, 0, 112, [[0, 'rgba(214,232,255,0.5)'], [1, 'rgba(214,232,255,0)']]); ctx.fill();
  // gövde: çarşaf
  ctx.beginPath(); ctx.moveTo(cx - 24, 52);
  ctx.bezierCurveTo(cx - 24, 22, cx + 24, 22, cx + 24, 52);
  ctx.lineTo(cx + 24, bot - 12);
  const n = 5; for (let i = 0; i < n; i++) { const x0 = cx + 24 - i * (48 / n), x1 = cx + 24 - (i + 1) * (48 / n); ctx.quadraticCurveTo((x0 + x1) / 2, bot + (i % 2 ? -1 : 1) * 7 + Math.sin(ph + i) * 3, x1, bot - 12 + Math.sin(ph + i * 1.3) * 2); }
  ctx.closePath();
  ctx.fillStyle = lg(ctx, 0, top, 0, bot, [[0, 'rgba(244,250,255,0.9)'], [0.55, 'rgba(206,224,248,0.72)'], [1, 'rgba(160,190,235,0.28)']]); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4; ctx.stroke();
  ell(ctx, cx - 9, 38, 8, 5, 'rgba(255,255,255,0.35)', -0.5);
  // kollar (kısa, öne)
  ell(ctx, cx + 22, 62 + w2 * 2, 9, 5.5, 'rgba(226,238,255,0.8)', -0.25 + w2 * 0.1); ell(ctx, cx - 20, 66 - w2 * 2, 8, 5, 'rgba(200,220,248,0.55)', 0.3);
  // yüz
  ell(ctx, cx + 11, 47, 5, 6.4, 'rgba(24,34,70,0.92)'); ell(ctx, cx - 2, 48, 4.6, 6, 'rgba(24,34,70,0.92)');
  ell(ctx, cx + 11.4, 46.6, 1.8, 2.2, 'rgba(210,250,255,0.95)'); ell(ctx, cx - 1.6, 47.6, 1.6, 2, 'rgba(210,250,255,0.95)');
  ell(ctx, cx + 6, 60, 3.6, 4.4 + w1 * 0.6, 'rgba(24,34,70,0.8)');
  MON_EYE.ghost[f] = [cx + 4.5, 47, 13];
}

function genMonsters(scene) {
  const defs = { zombie: drawZombie, skeleton: drawSkeleton, ghost: drawGhost };
  for (const t of Object.keys(MON)) {
    const M = MON[t];
    for (let f = 0; f < M.n; f++) {
      const key = monKey(t, f); if (scene.textures.exists(key)) continue;
      const { canvas, ctx } = makeCanvas(M.w, M.h);
      defs[t](ctx, f); register(scene, key, canvas);
    }
  }
}

// ------------------------------------------------------------------ askerler
export const SOL = { w: 120, h: 124, ox: 48, oy: 112 };
export const SOL_POSES = ['w0', 'w1', 'w2', 'w3', 'a0', 'a1', 'down'];
export const solKey = (type, pose) => `sol_${type}_${pose}`;
const COL = {
  guard: { body: '#8a6a44', body2: '#5e4630', trim: '#d6b46a', pants: '#4a3f36', helm: '#9a7a4e' },
  archer: { body: '#4d7a4e', body2: '#355a39', trim: '#c8d98a', pants: '#3a4636', helm: '#3f6b43' },
  knight: { body: '#aab4c6', body2: '#7a869c', trim: '#f0d27a', pants: '#56607a', helm: '#c4cddd' },
};
const SKINC = '#f0c9a0';

function drawSoldier(ctx, type, pose) {
  const C = COL[type]; const fy = SOL.oy, cx = SOL.ox;
  const w = pose[0] === 'w' ? Number(pose[1]) : 0, walk = pose[0] === 'w';
  const ph = w / 4 * TAU, bob = walk ? Math.abs(Math.sin(ph)) * 2 : 0;
  const atk = pose[0] === 'a' ? Number(pose[1]) : -1;
  ell(ctx, cx, fy + 1, 20, 4, rgba('#10120c', 0.25));
  if (pose === 'down') { drawDown(ctx, type, C, cx, fy); return; }
  // bacaklar
  const hy = 82 - bob, step = walk ? 9 : 4, a = walk ? Math.sin(ph) : 0.4, b = walk ? Math.sin(ph + Math.PI) : -0.4;
  for (const [s, col, pa] of [[b, shade(C.pants, -0.25), ph + Math.PI], [a, C.pants, ph]]) {
    const fx = cx + s * step, fyy = fy - 4 - (walk ? Math.max(0, Math.cos(pa)) * 4 : 0);
    line(ctx, cx, hy, fx, fyy, 8, col); ell(ctx, fx + 2, fyy + 1.5, 6.4, 3.6, '#2a2420');
  }
  const lean = atk === 1 ? 0.12 : atk === 0 ? -0.08 : 0;
  ctx.save(); ctx.translate(cx, hy); ctx.rotate(lean); ctx.translate(-cx, -hy);
  // arka kol + silah arkası
  const sh = 58 - bob;
  const armSw = walk ? Math.sin(ph + Math.PI) * 6 : 0;
  line(ctx, cx + 2, sh, cx + 6 + armSw * 0.5, sh + 14, 6, shade(C.body2, -0.15)); ell(ctx, cx + 7 + armSw * 0.5, sh + 15, 3.6, 3.6, shade(SKINC, -0.15));
  // gövde
  ctx.fillStyle = lg(ctx, cx - 12, sh - 6, cx + 12, hy, [[0, C.body], [1, C.body2]]); rrect(ctx, cx - 12, sh - 6, 24, hy - sh + 8, 9); ctx.fill();
  ell(ctx, cx - 5, sh + 4, 3.6, 7, rgba('#ffffff', 0.14), 0.1);
  ctx.fillStyle = shade(C.body2, -0.3); ctx.fillRect(cx - 12, hy - 8, 24, 4); ctx.fillStyle = C.trim; ctx.fillRect(cx - 2, hy - 8.4, 4, 4.8);
  if (type === 'knight') { ell(ctx, cx - 1, sh + 6, 8, 6, rgba('#ffffff', 0.22)); ctx.strokeStyle = rgba('#4a5470', 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - 8, sh + 12); ctx.lineTo(cx + 8, sh + 12); ctx.stroke(); }
  if (type === 'guard') { line(ctx, cx - 12, sh + 2, cx + 12, hy - 10, 3, '#5a3c26'); }
  if (type === 'archer') { ctx.fillStyle = '#7a5a3a'; rrect(ctx, cx - 18, sh - 2, 7, 22, 3); ctx.fill(); line(ctx, cx - 16, sh - 3, cx - 15, sh - 10, 1.6, '#d8d0a8'); line(ctx, cx - 13, sh - 3, cx - 12, sh - 9, 1.6, '#d8d0a8'); }
  // kafa
  const hx = cx + 3, hyy = 40 - bob;
  ell(ctx, hx, hyy, 12, 12, lg(ctx, hx - 10, hyy - 10, hx + 10, hyy + 12, [[0, '#ffe0bb'], [1, SKINC]]));
  ell(ctx, hx + 6, hyy + 0.5, 1.9, 2.3, '#2a2018'); ell(ctx, hx + 6.6, hyy - 0.2, 0.7, 0.8, '#ffffff');
  ell(ctx, hx + 5, hyy + 6, 5, 1.2, '#b0705a'); ell(ctx, hx + 8, hyy + 4.4, 2.4, 1.6, rgba('#ff9a8a', 0.5));
  if (type === 'guard') { // deri başlık + kask
    ctx.fillStyle = C.helm; ctx.beginPath(); ctx.arc(hx - 0.5, hyy - 2, 13, Math.PI * 1.02, Math.PI * 2.02); ctx.fill();
    ctx.fillStyle = shade(C.helm, -0.25); ctx.fillRect(hx - 13, hyy - 3, 26, 3.4); ell(ctx, hx - 2, hyy - 9, 5, 2.4, rgba('#ffffff', 0.25), -0.3);
  } else if (type === 'archer') { // kapüşon
    ctx.fillStyle = lg(ctx, hx - 14, hyy - 14, hx + 12, hyy + 10, [[0, shade(C.helm, 0.15)], [1, C.helm]]);
    ctx.beginPath(); ctx.moveTo(hx - 15, hyy + 14); ctx.bezierCurveTo(hx - 19, hyy - 6, hx - 6, hyy - 20, hx + 5, hyy - 16); ctx.bezierCurveTo(hx + 12, hyy - 14, hx + 13, hyy - 6, hx + 11, hyy - 3);
    ctx.bezierCurveTo(hx + 4, hyy - 8, hx - 6, hyy - 6, hx - 9, hyy + 8); ctx.closePath(); ctx.fill();
    line(ctx, hx - 14, hyy - 4, hx - 8, hyy - 14, 2, rgba('#ffffff', 0.18));
  } else { // şövalye miğferi + tüy
    ctx.fillStyle = lg(ctx, hx - 13, 0, hx + 13, 0, [[0, shade(C.helm, 0.25)], [1, shade(C.helm, -0.2)]]);
    ctx.beginPath(); ctx.arc(hx, hyy - 1, 13.5, Math.PI, 0); ctx.lineTo(hx + 13.5, hyy + 4); ctx.lineTo(hx + 4, hyy + 4); ctx.lineTo(hx + 4, hyy - 2); ctx.lineTo(hx - 13.5, hyy - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1e2230'; ctx.fillRect(hx + 4, hyy - 1, 9, 2.2);
    ell(ctx, hx - 6, hyy - 12, 8, 4, '#c0443c', -0.9); ell(ctx, hx - 11, hyy - 8, 6, 3, '#a8342e', -0.5);
  }
  // ön kol + silah
  drawArmWeapon(ctx, type, C, atk, walk, ph, cx, sh, bob);
  ctx.restore();
}

function drawArmWeapon(ctx, type, C, atk, walk, ph, cx, sh, bob) {
  const sx = cx + 4, sy = sh + 2;
  const sw = walk ? Math.sin(ph) * 5 : 0;
  if (type === 'guard') {
    let hx = cx + 14, hy = sh + 16 + sw * 0.4;
    if (atk === 0) { hx = cx + 4; hy = sh + 14; } else if (atk === 1) { hx = cx + 24; hy = sh + 10; }
    line(ctx, sx, sy, hx, hy, 6.4, C.body); ell(ctx, hx, hy, 3.8, 3.8, SKINC);
    let tx, ty, bx, by;
    if (atk < 0) { bx = hx - 2; by = hy + 24; tx = hx + 3; ty = hy - 52; }                // dik tutulan mızrak
    else if (atk === 0) { bx = hx - 26; by = hy + 8; tx = hx + 20; ty = hy - 8; }         // geri çekiş
    else { bx = hx - 18; by = hy + 4; tx = hx + 44; ty = hy - 1; }                        // saplama
    line(ctx, bx, by, tx, ty, 3, '#8a6840'); line(ctx, bx, by, tx, ty, 1, '#caa070');
    const ang = Math.atan2(ty - by, tx - bx); ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); ctx.fillStyle = '#e2e8f2'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-2, -3.6); ctx.lineTo(-2, 3.6); ctx.closePath(); ctx.fill(); ctx.restore();
  } else if (type === 'archer') {
    let hx = cx + 16, hy = sh + 10 + sw * 0.3;
    if (atk === 0) { hx = cx + 20; hy = sh + 5; } else if (atk === 1) { hx = cx + 21; hy = sh + 5; }
    line(ctx, sx, sy, hx, hy, 6, C.body); ell(ctx, hx, hy, 3.6, 3.6, SKINC);
    // yay
    ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(hx + 2, hy, 22, -1.1, 1.1); ctx.stroke();
    const tx = hx + 2 + Math.cos(-1.1) * 22, ty = hy + Math.sin(-1.1) * 22, bx = hx + 2 + Math.cos(1.1) * 22, by = hy + Math.sin(1.1) * 22;
    if (atk === 0) { // gergin: ok ve çekilmiş kiriş
      const px = hx - 14, py = hy + 1;
      line(ctx, tx, ty, px, py, 1, '#f0ead2'); line(ctx, px, py, bx, by, 1, '#f0ead2');
      line(ctx, px - 2, py, hx + 18, hy, 1.8, '#d8c08a'); ell(ctx, hx + 19, hy, 2.4, 1.6, '#e8eef6');
      line(ctx, sx, sy + 2, px, py, 5, shade(C.body, -0.1)); ell(ctx, px, py, 3.4, 3.4, SKINC);
    } else line(ctx, tx, ty, bx, by, 1, '#f0ead2');
  } else {
    // şövalye: kalkan (ön) + kılıç
    let hx = cx + 14, hy = sh + 14 + sw * 0.3, sa = -0.9;
    if (atk === 0) { hx = cx + 10; hy = sh - 2; sa = -2.0; } else if (atk === 1) { hx = cx + 24; hy = sh + 16; sa = 0.35; }
    line(ctx, sx, sy, hx, hy, 6.6, C.body); ell(ctx, hx, hy, 4, 4, '#8a96ad');
    const L = 30, ex = hx + Math.cos(sa) * L, ey = hy + Math.sin(sa) * L;
    line(ctx, hx, hy, ex, ey, 4, '#dfe6f2'); line(ctx, hx, hy, ex, ey, 1.2, '#ffffff');
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(sa + Math.PI / 2); ctx.fillStyle = C.trim; ctx.fillRect(-6, -1.5, 12, 3); ctx.restore();
    // kalkan (gövde önünde)
    const kx = cx - 4, ky = sh + 18;
    ctx.fillStyle = lg(ctx, kx - 10, ky - 14, kx + 10, ky + 16, [[0, '#d0d8e8'], [1, '#7a869c']]); ctx.beginPath(); ctx.moveTo(kx - 11, ky - 12); ctx.lineTo(kx + 11, ky - 12); ctx.quadraticCurveTo(kx + 12, ky + 10, kx, ky + 19); ctx.quadraticCurveTo(kx - 12, ky + 10, kx - 11, ky - 12); ctx.fill();
    ctx.strokeStyle = C.trim; ctx.lineWidth = 2; ctx.stroke();
    line(ctx, kx, ky - 10, kx, ky + 14, 2.4, '#c0443c'); line(ctx, kx - 8, ky - 1, kx + 8, ky - 1, 2.4, '#c0443c');
  }
}

function drawDown(ctx, type, C, cx, fy) {
  // yere oturmuş, başı öne düşük, silah yanda
  const by = fy - 10;
  line(ctx, cx + 2, by - 2, cx + 30, by + 2, 8, C.pants); line(ctx, cx - 4, by, cx + 24, by + 5, 8, shade(C.pants, -0.25));
  ell(ctx, cx + 32, by + 3, 6, 3.6, '#2a2420'); ell(ctx, cx + 26, by + 7, 6, 3.6, '#2a2420');
  ctx.save(); ctx.translate(cx, by); ctx.rotate(0.2); ctx.fillStyle = lg(ctx, -12, -30, 12, 0, [[0, C.body], [1, C.body2]]); rrect(ctx, -12, -34, 24, 38, 9); ctx.fill(); ctx.restore();
  line(ctx, cx + 4, by - 26, cx + 20, by - 6, 6, C.body); ell(ctx, cx + 21, by - 5, 3.6, 3.6, SKINC);
  const hx = cx + 12, hy = by - 38;
  ell(ctx, hx, hy, 12, 12, lg(ctx, hx - 10, hy - 10, hx + 10, hy + 12, [[0, '#ffe0bb'], [1, SKINC]]));
  line(ctx, hx + 3, hy + 1, hx + 9, hy + 2, 1.8, '#2a2018'); line(ctx, hx + 2, hy + 7, hx + 8, hy + 8, 1.4, '#b0705a');  // kapalı gözler
  if (type === 'guard') { ctx.fillStyle = C.helm; ctx.beginPath(); ctx.arc(hx - 0.5, hy - 2, 13, Math.PI * 1.02, Math.PI * 2.02); ctx.fill(); ctx.fillStyle = shade(C.helm, -0.25); ctx.fillRect(hx - 13, hy - 3, 26, 3.4); line(ctx, cx - 24, fy - 4, cx - 24 + 30, fy - 8, 2.6, '#8a6840'); }
  else if (type === 'archer') { ctx.fillStyle = C.helm; ctx.beginPath(); ctx.moveTo(hx - 15, hy + 14); ctx.bezierCurveTo(hx - 19, hy - 6, hx - 6, hy - 20, hx + 5, hy - 16); ctx.bezierCurveTo(hx + 12, hy - 14, hx + 13, hy - 6, hx + 11, hy - 3); ctx.bezierCurveTo(hx + 4, hy - 8, hx - 6, hy - 6, hx - 9, hy + 8); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(cx - 20, fy - 14, 14, 0.8, 5.4); ctx.stroke(); }
  else { ctx.fillStyle = shade(C.helm, 0.05); ctx.beginPath(); ctx.arc(hx, hy - 1, 13.5, Math.PI, 0); ctx.lineTo(hx + 13.5, hy + 4); ctx.lineTo(hx - 13.5, hy + 2); ctx.closePath(); ctx.fill(); ell(ctx, hx - 6, hy - 12, 8, 4, '#c0443c', -0.9); line(ctx, cx - 28, fy - 5, cx - 6, fy - 3, 3, '#dfe6f2'); }
}

function genSoldiers(scene) {
  for (const t of ['guard', 'archer', 'knight']) for (const p of SOL_POSES) {
    const key = solKey(t, p); if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(SOL.w, SOL.h); drawSoldier(ctx, t, p); register(scene, key, canvas);
  }
}

// ------------------------------------------------------------------ savunma yapıları
// Telli çit ve taş duvar atlasları: kare başına (64 x 104), ayak (32,92); maske N1 E2 S4 W8 (FenceView ile aynı yerleşim).
export const DEF = { fw: 64, fh: 104, footX: 32, footY: 92, offY: 26 };
export const WIRE = { key: 'def_wire_atlas' }, WALL = { key: 'def_wall_atlas' };
export const defFrame = (mask) => `d${mask}`;

function drawWirePiece(ctx, mask, ox) {
  const cx = ox + 32, fy = DEF.footY, topY = fy - 52;
  const soft = (x, y, rx, ry, a) => ell(ctx, x, y, rx, ry, rgba('#141a0c', a));
  soft(cx, fy, 8, 3, 0.3); if (mask & 2) soft(cx + 16, fy, 17, 2.4, 0.18); if (mask & 8) soft(cx - 16, fy, 17, 2.4, 0.18);
  const hs = [16, 31, 45];
  const wire = (x0, y0, x1, y1) => {
    ctx.strokeStyle = '#4c5260'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = rgba('#b9c2d4', 0.7); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x0, y0 - 0.5); ctx.lineTo(x1, y1 - 0.5); ctx.stroke();
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(L / 9));
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t; line(ctx, bx - 2.4, by - 2.4, bx + 2.4, by + 2.4, 1, '#2c303a'); line(ctx, bx - 2.4, by + 2.4, bx + 2.4, by - 2.4, 1, '#2c303a'); }
  };
  if (mask & 1) for (const h of hs) wire(cx, fy - h, cx, fy - h - 44);
  for (const [bit, x0, x1] of [[2, cx, ox + 64], [8, ox, cx]]) if (mask & bit) for (const h of hs) wire(x0, fy - h + (h === 31 ? 1 : 0), x1, fy - h + (h === 31 ? 1 : 0));
  // direk: eskitilmiş koyu ahşap, sivri uç
  ctx.fillStyle = lg(ctx, cx - 4.5, 0, cx + 4.5, 0, [[0, '#7a5c42'], [1, '#43301f']]); ctx.beginPath(); ctx.moveTo(cx - 4.5, fy); ctx.lineTo(cx - 4.5, topY + 4); ctx.lineTo(cx, topY - 4); ctx.lineTo(cx + 4.5, topY + 4); ctx.lineTo(cx + 4.5, fy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#e0b890', 0.28); ctx.fillRect(cx - 4.5, topY + 4, 1.4, fy - topY - 4);
  for (const h of hs) { ctx.fillStyle = '#5a606e'; ctx.fillRect(cx - 5, fy - h - 1.6, 10, 3.2); ell(ctx, cx, fy - h, 1.4, 1.4, '#c9d2e6'); }
  if (mask & 4) for (const h of hs) wire(cx, fy - h, cx, fy - h + 8);
  // sivri uç parıltısı
  ell(ctx, cx - 1, topY, 1.2, 2, rgba('#ffffff', 0.35));
}

function drawWallPiece(ctx, mask, ox, seed) {
  const cx = ox + 32, fy = DEF.footY, H = 30, r = mulberry32(seed * 131 + mask);
  const stones = ['#9a9aa8', '#a9a9b6', '#8a8a98', '#b3b2bf', '#9392a0'];
  ell(ctx, cx, fy + 2, 16, 4, rgba('#101420', 0.28)); if (mask & 2) ell(ctx, cx + 16, fy + 2, 17, 3.6, rgba('#101420', 0.22)); if (mask & 8) ell(ctx, cx - 16, fy + 2, 17, 3.6, rgba('#101420', 0.22));
  const x0 = (mask & 8) ? ox : cx - 14, x1 = (mask & 2) ? ox + 64 : cx + 14;
  // üst yüz: kuzey bağlantısı geriye doğru uzar
  const topH = 8;
  const topRect = (x, y, w, h) => { ctx.fillStyle = lg(ctx, 0, y, 0, y + h, [[0, '#cfcfdc'], [1, '#aeaebd']]); rrect(ctx, x, y, w, h, 3); ctx.fill(); };
  if (mask & 1) topRect(cx - 12, fy - H - topH - 44, 24, 44 + topH, 3);
  // ön yüz taş sıraları
  ctx.save(); rrect(ctx, x0, fy - H, x1 - x0, H, 3); ctx.clip();
  ctx.fillStyle = '#8a8a98'; ctx.fillRect(x0, fy - H, x1 - x0, H);
  const rows = 3, rh = H / rows;
  for (let rI = 0; rI < rows; rI++) {
    let x = x0 - ((rI % 2) ? 9 : 0) - Math.floor((x0 % 18));
    while (x < x1) {
      const bw = 15 + Math.floor(r() * 6), col = stones[Math.floor(r() * stones.length)];
      ctx.fillStyle = lg(ctx, 0, fy - H + rI * rh, 0, fy - H + (rI + 1) * rh, [[0, shade(col, 0.14)], [1, shade(col, -0.16)]]);
      rrect(ctx, x + 0.8, fy - H + rI * rh + 0.8, bw - 1.6, rh - 1.6, 2.6); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.16); ctx.fillRect(x + 2, fy - H + rI * rh + 1.4, bw - 5, 1.2);
      x += bw;
    }
  }
  // yosun
  for (let i = 0; i < 3; i++) ell(ctx, x0 + 6 + r() * (x1 - x0 - 12), fy - 2 - r() * 6, 3 + r() * 3, 1.4 + r(), rgba('#5e8a4a', 0.45));
  ctx.restore();
  // üst yüz (kapak)
  topRect(x0, fy - H - topH, x1 - x0, topH + 1, 3);
  ctx.strokeStyle = rgba('#5a5a6a', 0.4); ctx.lineWidth = 1; for (let x = x0 + 12; x < x1 - 4; x += 14 + r() * 4) { ctx.beginPath(); ctx.moveTo(x, fy - H - topH + 1); ctx.lineTo(x, fy - H); ctx.stroke(); }
  if (mask & 4) topRect(cx - 12, fy - H - topH + 6, 24, 6, 3);
}

function genWallsAndWire(scene) {
  if (!scene.textures.exists(WIRE.key)) {
    const { canvas, ctx } = makeCanvas(DEF.fw * 16, DEF.fh);
    for (let m = 0; m < 16; m++) drawWirePiece(ctx, m, m * DEF.fw);
    const tex = register(scene, WIRE.key, canvas, { footX: DEF.footX, footY: DEF.footY });
    for (let m = 0; m < 16; m++) tex.add(defFrame(m), 0, m * DEF.fw, 0, DEF.fw, DEF.fh);
  }
  if (!scene.textures.exists(WALL.key)) {
    const { canvas, ctx } = makeCanvas(DEF.fw * 16, DEF.fh);
    for (let m = 0; m < 16; m++) drawWallPiece(ctx, m, m * DEF.fw, 7);
    const tex = register(scene, WALL.key, canvas, { footX: DEF.footX, footY: DEF.footY });
    for (let m = 0; m < 16; m++) tex.add(defFrame(m), 0, m * DEF.fw, 0, DEF.fw, DEF.fh);
  }
}

// ---- kazık tuzağı (zemine gömülü) — tek karo, ayak (32, 40)
export const SPIKE = { w: 64, h: 52, ox: 32, oy: 40 };
function genSpike(scene) {
  for (const broken of [false, true]) {
    const key = broken ? 'def_spike_broken' : 'def_spike'; if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(SPIKE.w, SPIKE.h);
    ell(ctx, 32, 40, 26, 9, rgba('#2a1e12', 0.55)); ell(ctx, 32, 39, 23, 7.4, lg(ctx, 0, 32, 0, 46, [[0, '#6a5238'], [1, '#43331f']]));
    const r = mulberry32(5);
    for (let i = 0; i < 7; i++) {
      const x = 14 + i * 6 + (r() - 0.5) * 2, y = 38 + Math.sin(i * 2.1) * 3, tilt = (i - 3) * 0.07 + (r() - 0.5) * 0.06;
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      if (!broken) {
        ctx.fillStyle = lg(ctx, -3, 0, 3, 0, [[0, '#caa070'], [1, '#7a5a3a']]); ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(0, -(24 + r() * 6)); ctx.lineTo(3, 0); ctx.closePath(); ctx.fill();
        ell(ctx, -0.6, -12, 0.8, 8, rgba('#fff2d0', 0.3));
      } else {
        const h = 5 + r() * 5; ctx.fillStyle = '#6a4e32'; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-2, -h); ctx.lineTo(1, -h + 2); ctx.lineTo(3, 0); ctx.closePath(); ctx.fill();
        if (i % 2) { ctx.rotate(1.3); ctx.fillStyle = '#8a6a46'; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(0, -14); ctx.lineTo(3, 0); ctx.closePath(); ctx.fill(); }
      }
      ctx.restore();
    }
    ell(ctx, 32, 41, 24, 5, rgba('#2a1e12', 0.3));
    register(scene, key, canvas);
  }
}

// ---- meşale (demir kâse + ayak), alev kareleri (ADD ile çizilir)
export const BRAZ = { w: 48, h: 72, ox: 24, oy: 64 };
export const FLAME = { w: 40, h: 64, ox: 20, oy: 56, n: 4 };
function genBrazier(scene) {
  if (!scene.textures.exists('def_brazier')) {
    const { canvas, ctx } = makeCanvas(BRAZ.w, BRAZ.h);
    ell(ctx, 24, 64, 14, 3.4, rgba('#10120c', 0.3));
    for (const [x, d] of [[-9, 0.2], [0, 0], [9, -0.2]]) line(ctx, 24 + x * 0.5, 40, 24 + x * 1.3, 63, 3, d ? '#2a2c36' : '#3a3d4a');
    line(ctx, 24, 40, 24, 62, 3.6, '#454958');
    ctx.fillStyle = lg(ctx, 8, 0, 40, 0, [[0, '#6a6e7e'], [0.5, '#4a4e5c'], [1, '#2a2c36']]); ctx.beginPath(); ctx.moveTo(8, 30); ctx.quadraticCurveTo(24, 50, 40, 30); ctx.lineTo(37, 28); ctx.lineTo(11, 28); ctx.closePath(); ctx.fill();
    ell(ctx, 24, 29, 14, 4, '#1a1410'); ell(ctx, 24, 29.5, 11.5, 2.8, lg(ctx, 0, 27, 0, 32, [[0, '#ff9a3a'], [1, '#b83a1a']]));
    ell(ctx, 16, 33, 3, 5, rgba('#ffffff', 0.15), 0.4);
    register(scene, 'def_brazier', canvas);
  }
  for (let f = 0; f < FLAME.n; f++) {
    const key = `def_flame${f}`; if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(FLAME.w, FLAME.h); const w = Math.sin(f / FLAME.n * TAU), w2 = Math.cos(f / FLAME.n * TAU);
    const tongue = (x, base, h, wd, sw, c0, c1) => { ctx.fillStyle = lg(ctx, 0, base, 0, base - h, [[0, c0], [1, c1]]); ctx.beginPath(); ctx.moveTo(x - wd, base); ctx.bezierCurveTo(x - wd * 1.1, base - h * 0.5, x + sw * 0.5, base - h * 0.55, x + sw, base - h); ctx.bezierCurveTo(x + wd * 0.9, base - h * 0.55, x + wd * 1.1, base - h * 0.3, x + wd, base); ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = radial(ctx, 20, 44, 20, [[0, 'rgba(255,170,60,0.55)'], [1, 'rgba(255,120,20,0)']]); ctx.fillRect(0, 20, 40, 40);
    tongue(20, 54, 44 + w * 4, 11, w * 5, 'rgba(255,110,20,0.95)', 'rgba(255,200,60,0.0)');
    tongue(13, 54, 26 + w2 * 4, 6, -w2 * 4, 'rgba(255,140,30,0.9)', 'rgba(255,220,90,0)');
    tongue(27, 54, 30 - w * 4, 6, w2 * 4, 'rgba(255,140,30,0.9)', 'rgba(255,220,90,0)');
    tongue(20, 54, 26 + w2 * 3, 6.5, w * 2.5, 'rgba(255,236,150,1)', 'rgba(255,250,200,0)');
    register(scene, key, canvas);
  }
}

// ---- gözcü kulesi (2×2 karo): arka gövde + ön korkuluk; ok ve ok izi
export const TOWER = { w: 136, h: 214, ox: 68, oy: 202, platY: 108 };    // platY: ayaktan platform zeminine yükseklik
function genTower(scene) {
  if (!scene.textures.exists('def_tower')) {
    const { canvas, ctx } = makeCanvas(TOWER.w, TOWER.h); const cx = 68, fy = TOWER.oy;
    ell(ctx, cx, fy + 2, 46, 11, rgba('#10140c', 0.32));
    const wood = (x0, x1) => lg(ctx, x0, 0, x1, 0, [[0, '#a98058'], [1, '#5f4229']]);
    const platY = fy - TOWER.platY;
    // bacaklar (ışın): geniş tabandan dar tepeye
    for (const [bx, tx] of [[cx - 40, cx - 28], [cx + 40, cx + 28]]) { ctx.fillStyle = wood(Math.min(bx, tx) - 4, Math.max(bx, tx) + 4); ctx.beginPath(); ctx.moveTo(bx - 4.5, fy); ctx.lineTo(tx - 3.5, platY); ctx.lineTo(tx + 3.5, platY); ctx.lineTo(bx + 4.5, fy); ctx.closePath(); ctx.fill(); }
    for (const [ya, yb] of [[0.25, 0.6], [0.55, 0.15]]) { void ya; void yb; }
    // çapraz payandalar
    ctx.strokeStyle = '#6f5034'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 38, fy - 8); ctx.lineTo(cx + 30, fy - 62); ctx.moveTo(cx + 38, fy - 8); ctx.lineTo(cx - 30, fy - 62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 33, fy - 62); ctx.lineTo(cx + 32, fy - 100); ctx.moveTo(cx + 33, fy - 62); ctx.lineTo(cx - 32, fy - 100); ctx.stroke();
    ctx.strokeStyle = '#8c6a44'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx - 38, fy - 56); ctx.lineTo(cx + 38, fy - 56); ctx.stroke();
    // platform (üstten görünüm: ön kenar kalın)
    ctx.fillStyle = lg(ctx, 0, platY - 8, 0, platY + 8, [[0, '#caa070'], [1, '#7a5a3a']]); rrect(ctx, cx - 40, platY - 6, 80, 14, 3); ctx.fill();
    for (let i = 1; i < 6; i++) line(ctx, cx - 40 + i * 13.3, platY - 5, cx - 40 + i * 13.3, platY + 7, 1, rgba('#3a2a1a', 0.5));
    // arka korkuluk + çatı direkleri
    ctx.fillStyle = wood(cx - 42, cx - 36); ctx.fillRect(cx - 42, platY - 62, 6, 58); ctx.fillStyle = wood(cx + 36, cx + 42); ctx.fillRect(cx + 36, platY - 62, 6, 58);
    ctx.fillStyle = '#6f5034'; ctx.fillRect(cx - 40, platY - 34, 80, 4); ctx.fillRect(cx - 40, platY - 52, 80, 3);
    // çatı
    const ry = platY - 60;
    ctx.fillStyle = lg(ctx, 0, ry - 38, 0, ry + 6, [[0, '#b85a3e'], [1, '#7a3626']]); ctx.beginPath(); ctx.moveTo(cx, ry - 42); ctx.lineTo(cx + 58, ry + 6); ctx.quadraticCurveTo(cx, ry + 14, cx - 58, ry + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba('#3a1a14', 0.4); ctx.lineWidth = 1.4; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(cx, ry - 40); ctx.lineTo(cx + i * 16, ry + 9); ctx.stroke(); }
    ell(ctx, cx - 16, ry - 14, 5, 22, rgba('#ffd2a0', 0.2), 0.6);
    // bayrak
    line(ctx, cx, ry - 42, cx, ry - 66, 2.4, '#4a3624'); ctx.fillStyle = '#c0443c'; ctx.beginPath(); ctx.moveTo(cx, ry - 66); ctx.lineTo(cx + 22, ry - 60); ctx.lineTo(cx, ry - 53); ctx.closePath(); ctx.fill();
    register(scene, 'def_tower', canvas, { footX: cx, footY: fy });
  }
  if (!scene.textures.exists('def_tower_front')) {
    const { canvas, ctx } = makeCanvas(TOWER.w, 40); const cx = 68;
    ctx.fillStyle = lg(ctx, 0, 6, 0, 30, [[0, '#c0966a'], [1, '#6a4a2e']]); rrect(ctx, cx - 42, 10, 84, 7, 2); ctx.fill(); rrect(ctx, cx - 42, 24, 84, 6, 2); ctx.fill();
    for (const x of [-42, -20, 0, 20, 40]) { ctx.fillStyle = '#7a5a3a'; ctx.fillRect(cx + x - 2.4, 8, 5, 24); }
    ctx.fillStyle = rgba('#ffffff', 0.2); ctx.fillRect(cx - 42, 10, 84, 1.2);
    register(scene, 'def_tower_front', canvas);
  }
}

function genArrow(scene) {
  if (!scene.textures.exists('def_arrow')) {
    const { canvas, ctx } = makeCanvas(36, 8);
    line(ctx, 3, 4, 30, 4, 1.8, '#d8c08a'); ctx.fillStyle = '#e8eef6'; ctx.beginPath(); ctx.moveTo(35, 4); ctx.lineTo(28, 1.2); ctx.lineTo(28, 6.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0443c'; ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(7, 4); ctx.lineTo(0, 7.5); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill();
    register(scene, 'def_arrow', canvas);
  }
  if (!scene.textures.exists('def_trail')) {
    const { canvas, ctx } = makeCanvas(96, 8);
    const g = ctx.createLinearGradient(0, 0, 96, 0); g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(1, 'rgba(255,248,224,0.95)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(96, 1.2); ctx.lineTo(96, 6.8); ctx.closePath(); ctx.fill();
    register(scene, 'def_trail', canvas);
  }
}

// ------------------------------------------------------------------ hasar + efekt dokuları
function genFx(scene) {
  if (!scene.textures.exists('dm_crack')) {
    const { canvas, ctx } = makeCanvas(96, 72); const r = mulberry32(31);
    const crack = (x, y, a, len, w, depth) => {
      if (depth <= 0 || len < 4) return; const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
      ctx.strokeStyle = rgba('#20160f', 0.85); ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo((x + x1) / 2 + (r() - 0.5) * 6, (y + y1) / 2 + (r() - 0.5) * 6); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = rgba('#fff0d8', 0.22); ctx.lineWidth = w * 0.4; ctx.beginPath(); ctx.moveTo(x + 1, y - 1); ctx.lineTo(x1 + 1, y1 - 1); ctx.stroke();
      crack(x1, y1, a + (r() - 0.3) * 0.9, len * 0.7, w * 0.75, depth - 1); if (r() < 0.7) crack((x + x1) / 2, (y + y1) / 2, a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.5), len * 0.5, w * 0.7, depth - 1);
    };
    crack(44, 6, 1.5, 22, 2.4, 4); crack(60, 34, 2.4, 20, 2, 3); crack(30, 40, 0.4, 18, 1.8, 3);
    register(scene, 'dm_crack', canvas);
  }
  if (!scene.textures.exists('dm_soot')) {
    const { canvas, ctx } = makeCanvas(96, 72); const r = mulberry32(47);
    for (let i = 0; i < 9; i++) { const x = 10 + r() * 76, y = 14 + r() * 50, rad = 10 + r() * 14; ctx.fillStyle = radial(ctx, x, y, rad, [[0, 'rgba(14,10,8,0.55)'], [1, 'rgba(14,10,8,0)']]); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    ctx.fillStyle = lg(ctx, 0, 36, 0, 72, [[0, 'rgba(14,10,8,0)'], [1, 'rgba(14,10,8,0.4)']]); ctx.fillRect(0, 36, 96, 36);
    register(scene, 'dm_soot', canvas);
  }
  if (!scene.textures.exists('dm_rubble')) {
    const { canvas, ctx } = makeCanvas(112, 44); const r = mulberry32(63);
    ell(ctx, 56, 32, 50, 9, rgba('#10100c', 0.35));
    for (let i = 0; i < 9; i++) { // kırık tahtalar
      ctx.save(); ctx.translate(14 + r() * 84, 28 - r() * 10); ctx.rotate((r() - 0.5) * 2.4); ctx.fillStyle = i % 3 ? '#6a4e32' : '#8a6a46'; ctx.fillRect(-12, -2.4, 18 + r() * 12, 4.8); ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(-12, 1, 28, 1.4); ctx.restore();
    }
    for (let i = 0; i < 7; i++) ell(ctx, 12 + r() * 88, 30 + r() * 6, 4 + r() * 5, 2.6 + r() * 2.6, ['#8a8a98', '#6e6e7c', '#a2a2b0'][i % 3], r());
    register(scene, 'dm_rubble', canvas);
  }
  if (!scene.textures.exists('rd_smoke')) {
    const s = 64; const { canvas, ctx } = makeCanvas(s, s); const r = mulberry32(88);
    for (let i = 0; i < 7; i++) { const x = 32 + (r() - 0.5) * 22, y = 32 + (r() - 0.5) * 22, rad = 12 + r() * 10; ctx.fillStyle = radial(ctx, x, y, rad, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(0, 0, s, s); }
    register(scene, 'rd_smoke', canvas);
  }
  if (!scene.textures.exists('rd_star')) {
    const s = 20; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 10, 10, 10, [[0, 'rgba(255,230,120,0.6)'], [1, 'rgba(255,230,120,0)']]); ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffe36a'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? 2.8 : 7, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(10 + Math.cos(a) * rr, 10 + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff8c8'; ctx.beginPath(); ctx.arc(10, 10, 2, 0, TAU); ctx.fill();
    register(scene, 'rd_star', canvas);
  }
  if (!scene.textures.exists('rd_eyes')) { // iki parlak göz (beyaz, tint'lenir; ADD)
    const w = 40, h = 20; const { canvas, ctx } = makeCanvas(w, h);
    for (const x of [13, 27]) {
      ctx.fillStyle = radial(ctx, x, 10, 10, [[0, 'rgba(255,255,255,0.85)'], [0.3, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(x - 10, 0, 20, 20);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x, 10, 2.4, 3.2, 0, 0, TAU); ctx.fill();
    }
    register(scene, 'rd_eyes', canvas);
  }
  if (!scene.textures.exists('rd_hit')) { // vuruş yıldızı (ADD)
    const s = 48; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 24, 24, 24, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,240,200,0.5)'], [1, 'rgba(255,220,150,0)']]); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(24 + Math.cos(a) * 6, 24 + Math.sin(a) * 6); ctx.lineTo(24 + Math.cos(a) * (i % 2 ? 14 : 21), 24 + Math.sin(a) * (i % 2 ? 14 : 21)); ctx.stroke(); }
    register(scene, 'rd_hit', canvas);
  }
}

export function genDefense(scene) {
  genMonsters(scene); genSoldiers(scene); genWallsAndWire(scene); genSpike(scene); genBrazier(scene); genTower(scene); genArrow(scene); genFx(scene);
}
