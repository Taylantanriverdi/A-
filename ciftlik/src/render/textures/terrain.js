// Arazi dokuları: dağlar, tepeler, orman, çim, toprak tarla, yol, küçük süsler, ön plan çimleri.
import { makeCanvas, register, bakeTint, softenCanvas, shade, mixHex, rgba } from './canvas.js';
import { mulberry32, TileNoise, profile1D } from './noise.js';
import { WORLD } from '../../data/palette.js';

export const LAYER_W = 2048;

function putGrey(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = fn(x, y); const i = (y * w + x) * 4;
    if (!r) { d[i + 3] = 0; continue; }
    const v = Math.max(0, Math.min(255, r[0] * 255)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.max(0, Math.min(1, r[1])) * 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Dağ katmanı: gri tonlu, taban (y=h-base) altı dolu. meta.baseY = zemin çizgisi. */
function mountain(scene, key, seed, h, amp, baseH, sharp, canvasMode, color) {
  if (scene.textures.exists(key)) return;
  const w = LAYER_W; const { canvas, ctx } = makeCanvas(w, h);
  const p1 = profile1D(seed, w, 5, 6), p2 = profile1D(seed + 1, w, 4, 14), p3 = profile1D(seed + 2, w, 3, 9);
  const n = new TileNoise(seed + 5, 64, 16);
  const top = new Float32Array(w), ridge2 = new Float32Array(w);
  const baseY = h - baseH;
  for (let x = 0; x < w; x++) {
    const ridged = 1 - Math.abs(p2[x] * 2 - 1);
    const m = Math.pow(p1[x], 1.25) * (1 - sharp) + ridged * sharp * p1[x] * 1.4;
    top[x] = baseY - 30 - m * amp;
    ridge2[x] = baseY - 10 - (p3[x] * 0.8 + 0.2) * amp * 0.55;
  }
  // yumuşatılmış profil (ışık/kar hesabı için; sütun şeritlenmesini önler)
  const sm = new Float32Array(w);
  for (let x = 0; x < w; x++) { let s = 0; for (let k = -8; k <= 8; k++) s += top[(x + k + w) % w]; sm[x] = s / 17; }
  const res = [0, 0];
  putGrey(ctx, w, h, (x, y) => {
    const t = top[x]; if (y < t - 1) return null;
    const a = Math.min(1, y - t + 1);
    const slope = (sm[(x + 6) % w] - sm[(x - 6 + w) % w]);
    const depth = (y - t) / (h - t);
    const lit = Math.max(-1, Math.min(1, slope * 0.06));
    const fall = Math.exp(-(y - t) / 70); // sırt eğim ışığı yalnızca tepeye yakın (sütun şeridi olmasın)
    let v = 0.86 + lit * 0.1 * fall - depth * 0.1 + (n.fbm(x / w, y / h, 4) - 0.5) * 0.1;
    if (y > ridge2[x]) v -= 0.05 + Math.min(0.06, (y - ridge2[x]) * 0.002); // ön sırt biraz koyu
    if (y - t < 4 && lit > 0) v += 0.06 * lit; // sırt kenar ışığı
    const peak = Math.max(0, Math.min(1, ((baseY - amp * 0.6) - sm[x]) / (amp * 0.25)));
    const snow = 0.12 * peak * Math.max(0, 1 - (y - t) / (amp * 0.14));
    res[0] = Math.min(1, v + snow); res[1] = a; return res;
  });
  if (canvasMode) bakeTint(canvas, color);
  register(scene, key, canvas, { baseY });
}

function hills(scene, canvasMode) {
  const key = 'env_hills'; if (scene.textures.exists(key)) return;
  const w = LAYER_W, h = 300, baseH = 60, baseY = h - baseH;
  const { canvas, ctx } = makeCanvas(w, h);
  const p1 = profile1D(41, w, 3, 5), p2 = profile1D(42, w, 3, 3);
  const n = new TileNoise(43, 48, 12); const r = mulberry32(44);
  const top = new Float32Array(w), top2 = new Float32Array(w);
  for (let x = 0; x < w; x++) { top[x] = baseY - 20 - p1[x] * 150; top2[x] = baseY - 10 - p2[x] * 90; }
  const res = [0, 0];
  putGrey(ctx, w, h, (x, y) => {
    const t = Math.min(top[x], top2[x]); if (y < t - 1) return null;
    const front = y >= top2[x];
    const sl = (top[(x + 4) % w] - top[(x - 4 + w) % w]) * 0.04;
    let v = (front ? 0.86 : 0.93) + sl * 0.5 * Math.exp(-(y - t) / 50) - (y - t) / h * 0.12 + (n.fbm(x / w, y / h, 4) - 0.5) * 0.12;
    if (front && y - top2[x] < 3) v += 0.05;
    res[0] = v; res[1] = Math.min(1, y - t + 1); return res;
  });
  // uzaktaki ağaç kümeleri ve çit çizgileri
  for (let i = 0; i < 160; i++) {
    const x = r() * w; const xi = Math.floor(x); const t = Math.min(top[xi], top2[xi]);
    const y = t + 6 + r() * (baseY - t) * 0.7; const s = 2 + r() * 4;
    ctx.fillStyle = 'rgba(70,70,70,0.55)';
    ctx.beginPath(); ctx.ellipse(x, y, s * 1.2, s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.ellipse(x - s * 0.3, y - s * 0.4, s * 0.6, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (canvasMode) bakeTint(canvas, WORLD.hill);
  register(scene, key, canvas, { baseY });
}

function forest(scene, canvasMode) {
  const key = 'env_forest'; if (!scene.textures.exists(key)) {
    const w = LAYER_W, h = 254, baseH = 50, baseY = h - baseH; // NPOT yükseklik: POT dokular sarmalanır → üst kenarda çizgi
    const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(61);
    ctx.fillStyle = "rgb(150,150,150)"; ctx.fillRect(0, baseY - 18, w, h - baseY + 18);
    const crowns = [];
    for (let x = -40; x < w + 40; x += 9 + r() * 10) {
      const conifer = r() < 0.45; const ch = 26 + r() * 42; crowns.push([x, baseY - 14 - r() * 14, ch, conifer, 0.55 + r() * 0.3]);
    }
    for (const [x, by, ch, con, v] of crowns) for (const off of [-w, 0, w]) {
      const cx = x + off; if (cx < -60 || cx > w + 60) continue;
      const g = Math.round(v * 200);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      if (con) { ctx.beginPath(); ctx.moveTo(cx, by - ch); ctx.quadraticCurveTo(cx + ch * 0.2, by - ch * 0.35, cx + ch * 0.3, by); ctx.lineTo(cx - ch * 0.3, by); ctx.quadraticCurveTo(cx - ch * 0.2, by - ch * 0.35, cx, by - ch); ctx.fill(); }
      else { ctx.beginPath(); ctx.ellipse(cx, by - ch * 0.5, ch * 0.42, ch * 0.5, 0, 0, Math.PI * 2); ctx.fill(); }
      const hl = Math.round(Math.min(255, g + 40));
      ctx.fillStyle = `rgba(${hl},${hl},${hl},0.35)`;
      ctx.beginPath(); ctx.ellipse(cx - ch * 0.1, by - ch * 0.72, ch * 0.16, ch * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    }
    // tabana doğru koyulaşma
    const g = ctx.createLinearGradient(0, baseY - 90, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
    if (canvasMode) bakeTint(canvas, WORLD.forest);
    register(scene, key, canvas, { baseY });
  }
  // tek tek salınan ön sıra ağaç tepeleri
  for (let k = 0; k < 4; k++) {
    const kk = 'env_ftree_' + k; if (scene.textures.exists(kk)) continue;
    const w = 72, h = 150; const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(70 + k);
    const con = k < 2; const cx = w / 2, by = h - 4;
    ctx.fillStyle = 'rgb(90,90,90)'; ctx.fillRect(cx - 2, by - 20, 4, 20);
    if (con) {
      const layers = 5;
      for (let i = 0; i < layers; i++) {
        const t = i / layers; const yy = by - 14 - t * (h - 30); const ww = (1 - t) * 30 + 6;
        const g = 140 + i * 14;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.beginPath(); ctx.moveTo(cx, yy - 40); ctx.quadraticCurveTo(cx + ww * 0.6, yy - 6, cx + ww, yy + 4); ctx.quadraticCurveTo(cx, yy - 2, cx - ww, yy + 4); ctx.quadraticCurveTo(cx - ww * 0.6, yy - 6, cx, yy - 40); ctx.fill();
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2; const rr = 10 + r() * 12; const x = cx + Math.cos(a) * 14, y = by - 70 + Math.sin(a) * 22 - i * 2;
        const g = 150 + Math.round((1 - (y - (by - 110)) / 90) * 60);
        ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(cx - 8, by - 98, 10, 0, Math.PI * 2); ctx.fill();
    }
    if (canvasMode) bakeTint(canvas, WORLD.forest);
    register(scene, kk, canvas);
  }
}

function grass(scene) {
  const key = 'env_grass'; if (scene.textures.exists(key)) return;
  const S = 512; const { canvas, ctx } = makeCanvas(S, S);
  const n1 = new TileNoise(5, 8, 8), n2 = new TileNoise(6, 32, 32), n3 = new TileNoise(7, 96, 96);
  const base = [120, 162, 86], dark = [84, 128, 62], warm = [150, 170, 92];
  const img = ctx.createImageData(S, S); const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const a = n1.fbm(u, v, 3), b = n2.fbm(u, v, 2), c = n3.sample(u * 96, v * 96);
    const t = Math.max(0, Math.min(1, (a - 0.35) * 1.8)); const wv = Math.max(0, (b - 0.55) * 2.2);
    const i = (y * S + x) * 4; const k = 0.92 + c * 0.14;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = ((base[ch] * (1 - t) + dark[ch] * t) * (1 - wv * 0.5) + warm[ch] * wv * 0.5) * k;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // çim ipleri (döşenebilir: kenarlarda sarılır)
  const r = mulberry32(8);
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S; const len = 3 + r() * 6; const lean = (r() - 0.5) * 3;
    const lightB = r() < 0.5;
    ctx.strokeStyle = lightB ? `rgba(196,226,130,${0.18 + r() * 0.25})` : `rgba(50,92,38,${0.16 + r() * 0.22})`;
    ctx.lineWidth = 0.8 + r() * 0.7;
    for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
      const xx = x + ox, yy = y + oy; if (xx < -10 || xx > S + 10 || yy < -10 || yy > S + 10) continue;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + lean, yy - len); ctx.stroke();
    }
  }
  register(scene, key, canvas);
}

function groundMacro(scene) {
  const key = 'env_macro'; if (scene.textures.exists(key)) return;
  const w = 256, h = 64; const { canvas, ctx } = makeCanvas(w, h);
  const n = new TileNoise(12, 16, 4), m = new TileNoise(13, 24, 6);
  const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = n.fbm(x / w, y / h, 4), b = m.fbm(x / w, y / h, 3); const i = (y * w + x) * 4;
    if (a > 0.5) { d[i] = 70; d[i + 1] = 112; d[i + 2] = 48; d[i + 3] = Math.min(1, (a - 0.5) * 2.6) * 120; }
    else if (b > 0.56) { d[i] = 196; d[i + 1] = 196; d[i + 2] = 104; d[i + 3] = Math.min(1, (b - 0.56) * 3) * 90; }
    else d[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0); register(scene, key, canvas);
}

/** 6×4 karo sürülmüş tarla: her karo sırasında 2 kabarık sıra, yumuşak kenar. */
function soilField(scene) {
  const key = 'env_field'; if (scene.textures.exists(key)) return;
  const tw = 6, th = 4, TW = 64, TH = 44, m = 10; const w = tw * TW + m * 2, h = th * TH + m * 2;
  const { canvas, ctx } = makeCanvas(w, h); const n = new TileNoise(21, 32, 16), n2 = new TileNoise(22, 96, 48);
  const base = [122, 85, 54], dk = [74, 50, 32], lt = [160, 118, 80];
  const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lx = x - m, ly = y - m; const i = (y * w + x) * 4;
    const ex = Math.min(lx, tw * TW - lx), ey = Math.min(ly, th * TH - ly);
    const edge = Math.min(ex, ey) + (n.sample(x * 0.3, y * 0.3) - 0.5) * 6;
    const a = Math.max(0, Math.min(1, (edge + 4) / 8));
    if (a <= 0) { d[i + 3] = 0; continue; }
    const rowPhase = (ly / (TH / 2)) % 1; // her karo 2 sıra
    const ridge = Math.sin(rowPhase * Math.PI); // 0 oluk, 1 sırt
    const slopeLight = Math.cos(rowPhase * Math.PI); // üst yüz aydınlık
    let k = 0.82 + ridge * 0.16 + slopeLight * 0.08;
    const clod = n2.sample(x * 0.9, y * 0.9); k *= 0.9 + clod * 0.2;
    const gx = (lx % TW + TW) % TW; const seam = gx < 1.2 || gx > TW - 1.2 ? 0.92 : 1;
    const mixDk = 1 - ridge;
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, (base[c] * (1 - mixDk * 0.45) + dk[c] * mixDk * 0.45) * k * seam + (slopeLight > 0.6 ? (lt[c] - base[c]) * 0.15 : 0));
    d[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  // taş ve saman kırıntıları
  const r = mulberry32(23);
  for (let i = 0; i < 140; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(200,170,130,0.5)' : 'rgba(60,40,25,0.5)'; ctx.fillRect(m + r() * tw * TW, m + r() * th * TH, 1.5, 1.2); }
  register(scene, key, canvas, { margin: m });
}

/** Toprak yol: polyline (doku yerel koordinatı) etrafında yumuşak kenarlı şerit. */
export function genPath(scene, key, pts, width, w, h) {
  if (scene.textures.exists(key)) return;
  const { canvas, ctx } = makeCanvas(w, h); const n = new TileNoise(31, 32, 32), n2 = new TileNoise(32, 128, 128);
  const img = ctx.createImageData(w, h); const d = img.data;
  const base = [201, 168, 120], dk = [150, 118, 80];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = 1e9;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
      const vx = bx - ax, vy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
      const dx = x - (ax + vx * t), dy = (y - (ay + vy * t)) * 1.3; const dd = dx * dx + dy * dy; if (dd < best) best = dd;
    }
    const dist = Math.sqrt(best) + (n.sample(x / w * 32, y / h * 32) - 0.5) * 10;
    const a = Math.max(0, Math.min(1, (width - dist) / 9));
    const i = (y * w + x) * 4; if (a <= 0) { d[i + 3] = 0; continue; }
    const center = Math.max(0, 1 - dist / width); const g = n2.sample(x / w * 128, y / h * 128);
    const wear = center > 0.35 && center < 0.6 ? 0.06 : 0; // tekerlek izi
    for (let c = 0; c < 3; c++) d[i + c] = (base[c] * (0.86 + g * 0.18) - wear * 255 * 0.3) * (0.92 + center * 0.08) * (1 - (1 - center) * 0.08) + (dk[c] - base[c]) * (1 - a) * 0.5;
    d[i + 3] = a * 235;
  }
  ctx.putImageData(img, 0, 0);
  const r = mulberry32(33);
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h; const k = (Math.floor(y) * w + Math.floor(x)) * 4; if (d[k + 3] < 200) continue;
    ctx.fillStyle = r() < 0.6 ? 'rgba(120,96,70,0.6)' : 'rgba(235,215,180,0.7)'; ctx.beginPath(); ctx.ellipse(x, y, 1 + r() * 2, 0.8 + r(), 0, 0, Math.PI * 2); ctx.fill();
  }
  register(scene, key, canvas);
}

function smalls(scene) {
  const cols = ['#fff6e8', '#ffd84d', '#ff8fb1', '#a88cff', '#ff6a4d'];
  cols.forEach((col, k) => {
    const key = 'env_flower_' + k; if (scene.textures.exists(key)) return;
    const { canvas, ctx } = makeCanvas(18, 22); const r = mulberry32(400 + k);
    ctx.strokeStyle = '#4f7f35'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(9, 22); ctx.quadraticCurveTo(8, 14, 9 + (r() - 0.5) * 3, 8); ctx.stroke();
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(9 + Math.cos(a) * 2.6, 7 + Math.sin(a) * 2, 2.2, 1.7, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = k === 1 ? '#d9822b' : '#ffd84d'; ctx.beginPath(); ctx.arc(9, 7, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(8, 5.6, 1.2, 0, Math.PI * 2); ctx.fill();
    register(scene, key, canvas);
  });
  for (let k = 0; k < 3; k++) {
    const key = 'env_stone_' + k; if (scene.textures.exists(key)) continue;
    const w = 22 + k * 6, h = 14 + k * 3; const { canvas, ctx } = makeCanvas(w, h);
    ctx.fillStyle = 'rgba(26,22,48,0.25)'; ctx.beginPath(); ctx.ellipse(w / 2 + 1, h - 3, w / 2 - 1, 3, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#c9c4bb'); g.addColorStop(1, '#7d776f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(w / 2, h / 2 + 1, w / 2 - 3, h / 2 - 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(w / 2 - 3, h / 2 - 1, w / 5, h / 6, -0.3, 0, Math.PI * 2); ctx.fill();
    register(scene, key, canvas);
  }
  for (let k = 0; k < 3; k++) {
    const key = 'env_tuft_' + k; if (scene.textures.exists(key)) continue;
    const w = 34, h = 26; const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(500 + k);
    for (let i = 0; i < 16; i++) {
      const x = 6 + r() * 22; const len = 8 + r() * 14; const lean = (r() - 0.5) * 12;
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(180,215,110,0.9)' : i % 3 === 1 ? 'rgba(92,140,58,0.95)' : 'rgba(64,108,44,0.95)';
      ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, h); ctx.quadraticCurveTo(x + lean * 0.3, h - len * 0.6, x + lean, h - len); ctx.stroke();
    }
    register(scene, key, canvas);
  }
}

/** Ön plan çim kümeleri: koyu, arkadan ışıklı, hafif bulanık (alan derinliği). Taban ortası orijin. */
function foreground(scene) {
  for (let k = 0; k < 4; k++) {
    const key = 'env_fg_' + k; if (scene.textures.exists(key)) continue;
    const w = 200, h = 190; const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(600 + k);
    const blades = 46 + k * 6;
    for (let i = 0; i < blades; i++) {
      const x = 30 + r() * 140; const len = 50 + r() * 130 * (1 - Math.abs(x - 100) / 120); const lean = (r() - 0.5) * 70;
      const wd = 2.5 + r() * 4; const g = ctx.createLinearGradient(0, h, 0, h - len);
      const tone = r(); g.addColorStop(0, '#1a2a14'); g.addColorStop(0.6, tone < 0.5 ? '#2f4a22' : '#3a5a28'); g.addColorStop(1, tone < 0.3 ? '#8aa858' : '#56783a');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - wd, h);
      ctx.quadraticCurveTo(x + lean * 0.25, h - len * 0.6, x + lean, h - len); ctx.quadraticCurveTo(x + lean * 0.25 + wd * 0.4, h - len * 0.55, x + wd, h); ctx.fill();
    }
    if (k === 1 || k === 3) { // birkaç çiçek başı / başak
      for (let i = 0; i < 4; i++) { const x = 50 + r() * 100, y = 30 + r() * 50; ctx.fillStyle = k === 1 ? 'rgba(240,220,170,0.9)' : 'rgba(200,170,90,0.9)'; ctx.beginPath(); ctx.ellipse(x, y, 4, 7, (r() - 0.5), 0, Math.PI * 2); ctx.fill(); }
    }
    softenCanvas(canvas, 1.6);
    register(scene, key, canvas);
  }
}

/** Ufuk dibi: düzensiz çalı/gövde kümeleri (dalgalı alt kenar, zemine farklı yüksekliklerde oturur).
 * Açık gri tonlu, tepeden ışıklı (tint ile yeşil + atmosfer rengi alır; öğlende düz koyu bant okunmasın). meta.groundY */
function treeline(scene, canvasMode) {
  const key = 'env_treeline'; if (scene.textures.exists(key)) return;
  const w = LAYER_W, h = 110, groundY = 84; const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(81);
  const wrapDraw = (fn) => { for (const off of [-w, 0, w]) fn(off); };
  const blob = (x, y, rx, ry, lo, hi) => {
    wrapDraw((o) => {
      const g = ctx.createRadialGradient(x + o - rx * 0.35, y - ry * 0.55, Math.max(1, ry * 0.15), x + o, y, Math.max(rx, ry) * 1.1);
      g.addColorStop(0, `rgb(${hi},${hi},${hi})`); g.addColorStop(0.55, `rgb(${(hi + lo) >> 1},${(hi + lo) >> 1},${(hi + lo) >> 1})`); g.addColorStop(1, `rgb(${lo},${lo},${lo})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + o, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    });
  };
  // arka sıra: yumuşak çalı kütlesi, tabanı dalgalı (bazıları zemine taşar)
  for (let x = -30; x < w + 30; x += 8 + r() * 14) {
    const rad = 6 + r() * 13, foot = groundY - 3 + r() * 7, v = r();
    blob(x, foot - rad * 0.55, rad * 1.25, rad * 0.8, 150 + Math.round(v * 20), 215 + Math.round(v * 30));
  }
  // küçük ağaçlar (farklı yükseklik): ince açık gövde + tepeden ışıklı taç
  for (let i = 0; i < 55; i++) {
    const x = r() * w, foot = groundY - 2 + r() * 10, th = 8 + r() * 16, v = r();
    const rx = 4 + r() * 4, ry = 5 + r() * 4;
    wrapDraw((o) => { ctx.fillStyle = 'rgb(150,150,150)'; ctx.fillRect(x + o - 1, foot - th, 2, th); });
    blob(x, foot - th - 4, rx, ry, 165 + Math.round(v * 20), 235 + Math.round(v * 20));
  }
  // ön sıra: ufak açık tonlu çalılar, zemine taşan
  for (let x = 0; x < w; x += 30 + r() * 60) {
    const rad = 4 + r() * 6, foot = groundY + 2 + r() * 5;
    blob(x, foot - rad * 0.5, rad * 1.4, rad * 0.75, 175, 240);
  }
  softenCanvas(canvas, 0.8);
  // üst kenar yumuşak (uzak, sise karışır)
  const g = ctx.createLinearGradient(0, 0, 0, 40); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g; ctx.fillRect(0, 0, w, 40); ctx.globalCompositeOperation = 'source-over';
  if (canvasMode) bakeTint(canvas, mixHex(mixHex(WORLD.forest, WORLD.hill, 0.4), '#c4dcd0', 0.3));
  register(scene, key, canvas, { groundY });
}

const ihash = (a, b) => { let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** Uzak tarla şeritleri (piksel bazlı, organik): perspektifle ufka doğru incelen, gürültüyle dalgalanan yumuşak
 * sınırlı bantlar; yamalar arası yumuşak renk geçişi, hafif çit/çalı izleri, ufka doğru atmosfer rengine karışma. */
function farFields(scene) {
  const key = 'env_farfields'; if (scene.textures.exists(key)) return;
  const w = LAYER_W, h = 170; const { canvas, ctx } = makeCanvas(w, h);
  const tones = ['#86ad5c', '#9cb766', '#7a9f52', '#b5b46a', '#8fb062', '#a7a35e', '#7fa656'].map(hexRgb);
  const haze = hexRgb('#c6d8bc');
  const nWarp = new TileNoise(92, 24, 6), nCol = new TileNoise(93, 96, 12), nX = new TileNoise(94, 48, 8);
  const BANDS = 11;
  const pn = (bi) => 3 + Math.floor(ihash(bi, 7) * 6);          // bant başına yama sayısı (tamsayı → döşenebilir)
  const col = (bi, pi, out) => { const c = tones[Math.floor(ihash(bi, ((pi % pn(bi)) + pn(bi)) % pn(bi)) * tones.length)]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; };
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  // bandın x yönündeki yamaları (komşu yama ile yumuşak geçiş)
  const rowCol = (bi, u, p, out) => {
    const n = pn(bi); const pc = u * n + ihash(bi, 3) * n + (nX.sample(u * 48, bi * 1.7) - 0.5) * 0.35;
    const pi = Math.floor(pc), fp = pc - pi;
    col(bi, pi, C); col(bi, pi - 1, D);
    const e = fp < 0.08 ? (fp / 0.08) : 1; const k = e * e * (3 - 2 * e);
    out[0] = D[0] + (C[0] - D[0]) * k; out[1] = D[1] + (C[1] - D[1]) * k; out[2] = D[2] + (C[2] - D[2]) * k;
    return out;
  };
  const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) {
    const p = (y + 0.5) / h;                           // 0 ufuk .. 1 yakın
    const bv = Math.pow(p, 0.62) * BANDS;              // ufka yakın bantlar sıkışır (perspektif)
    const atm = Math.pow(1 - p, 2.2) * 0.7;
    const alpha = 1 - Math.min(1, Math.max(0, (p - 0.45) / 0.55));
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const warp = (nWarp.fbm(u, p, 3) - 0.5) * (0.5 + 0.9 * p);
      const b = bv + warp; const bi = Math.floor(b), fb = b - bi;
      rowCol(bi, u, p, A); rowCol(bi - 1, u, p, B);
      const e = fb < 0.3 ? fb / 0.3 : 1; const k = e * e * (3 - 2 * e);
      let r = B[0] + (A[0] - B[0]) * k, g = B[1] + (A[1] - B[1]) * k, bl = B[2] + (A[2] - B[2]) * k;
      // tarla içi gürültü + hafif sıra dokusu
      const nv = 0.9 + nCol.fbm(u, p, 3) * 0.2;
      const rows = ihash(bi, 11) < 0.5 ? 1 - 0.035 * (0.5 + 0.5 * Math.sin(b * 40)) * p : 1;
      // bant sınırında yumuşak çit/çalı izi (uzakta zayıf)
      const hedge = 1 - 0.13 * Math.exp(-((fb - 0.03) * (fb - 0.03)) / 0.0025) * (0.3 + 0.7 * p);
      const m = nv * rows * hedge;
      r *= m; g *= m; bl *= m;
      r += (haze[0] - r) * atm; g += (haze[1] - g) * atm; bl += (haze[2] - bl) * atm;
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  softenCanvas(canvas, 0.6);
  register(scene, key, canvas);
}

export function genTerrain(scene, canvasMode, step) {
  treeline(scene, canvasMode); farFields(scene);
  mountain(scene, 'env_mtn_far', 1001, 510, 300, 70, 0.55, canvasMode, WORLD.mountainFar); step();
  mountain(scene, 'env_mtn_near', 2002, 420, 200, 70, 0.3, canvasMode, WORLD.mountainNear); step();
  hills(scene, canvasMode); forest(scene, canvasMode); step();
  grass(scene); groundMacro(scene); step();
  soilField(scene); smalls(scene); foreground(scene); step();
}

export { mixHex, shade, rgba };
