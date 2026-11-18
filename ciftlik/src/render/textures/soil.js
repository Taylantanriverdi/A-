// Sürülmüş toprak dokuları (PLAN §2, §8): karo başına 64×44 kare, 4 komşu maskesi (16) × 3 nem kademesi.
// Desen karo periyoduyla döşenebilir (sıralar ve topak gürültüsü dünya hizalı) → bitişik karolar dikişsiz birleşir;
// sürülmemiş komşu tarafında gürültülü, yuvarlatılmış organik kenar + çime düşen yumuşak AO + ön (güney) kenarda toprak dudağı.
// Ayrıca: yabani ot tutamları, taş/saman kırıntıları, silgi karesi (RenderTexture'da karo temizlemek için).
import { makeCanvas, register, shade, mixHex } from './canvas.js';
import { mulberry32, TileNoise } from './noise.js';
import { TILE_W, TILE_H } from '../../core/constants.js';

export const SOIL_ATLAS = 'soil_atlas';
export const SOIL_MISC = 'soil_misc';
export const SOIL_ERASE = 'soil_erase';
// maske bitleri: komşu SÜRÜLMÜŞ ise 1
export const N = 1, E = 2, S = 4, W = 8;
export const WEED_FRAMES = 3, BIT_FRAMES = 4;

// nem kademeleri: 0 kuru, 1 nemli, 2 ıslak (moisture ≥ 50)
const LEVELS = [
  { base: [160, 118, 78], dk: [116, 82, 54], lt: [204, 168, 122], sheen: 0 },
  { base: [124, 86, 55], dk: [82, 55, 35], lt: [164, 122, 84], sheen: 0.25 },
  { base: [86, 58, 38], dk: [52, 34, 22], lt: [124, 94, 70], sheen: 1 },
];

export function soilFrame(mask, level) { return `m${mask}_w${level}`; }

function genAtlas(scene) {
  if (scene.textures.exists(SOIL_ATLAS)) return;
  const TW = TILE_W, TH = TILE_H;
  const { canvas, ctx } = makeCanvas(TW * 16, TH * 3);
  const img = ctx.createImageData(TW * 16, TH * 3); const d = img.data; const stride = TW * 16;
  // dünya hizalı, karo periyotlu gürültüler
  const nClod = new TileNoise(31, 16, 11), nFine = new TileNoise(32, 32, 22), nWet = new TileNoise(33, 8, 6);
  const eN = new TileNoise(34, 6, 1), eS = new TileNoise(35, 6, 1), eW = new TileNoise(36, 1, 5), eE = new TileNoise(37, 1, 5);
  const nEdge = new TileNoise(38, 16, 11);
  // per-pixel önhesap (maske/nemden bağımsız)
  const P = TW * TH;
  const kBase = new Float32Array(P), ridgeA = new Float32Array(P), slopeA = new Float32Array(P), sheenA = new Float32Array(P), edgeJ = new Float32Array(P);
  const insN = new Float32Array(TW), insS = new Float32Array(TW), insW = new Float32Array(TH), insE = new Float32Array(TH);
  for (let x = 0; x < TW; x++) { const u = x / TW; insN[x] = 3 + (eN.sample(u * 6, 0) - 0.5) * 5; insS[x] = 5 + (eS.sample(u * 6, 0) - 0.5) * 5; }
  for (let y = 0; y < TH; y++) { const v = y / TH; insW[y] = 5 + (eW.sample(0, v * 5) - 0.5) * 6; insE[y] = 5 + (eE.sample(0, v * 5) - 0.5) * 6; }
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const u = x / TW, v = y / TH, i = y * TW + x;
    const wob = Math.sin(u * Math.PI * 4) * 1.1 + Math.sin(u * Math.PI * 2 + 1.3) * 0.8;
    const ph = (((y + wob) / (TH / 2)) % 1 + 1) % 1; // karo başına 2 sıra
    const ridge = Math.sin(ph * Math.PI);
    const slope = Math.cos(ph * Math.PI); // + : sırtın gökyüzüne bakan arka yüzü (aydınlık)
    const clod = nClod.fbm(u, v, 3), fine = nFine.fbm(u, v, 2);
    kBase[i] = (0.8 + ridge * 0.17 + slope * 0.09) * (0.86 + clod * 0.22) * (0.93 + fine * 0.14);
    ridgeA[i] = ridge; slopeA[i] = slope;
    sheenA[i] = Math.max(0, slope - 0.45) * Math.max(0, nWet.fbm(u, v, 3) - 0.42) * 6;
    edgeJ[i] = (nEdge.fbm(u, v, 3) - 0.5) * 3.2;
  }
  const R = 9;
  for (let lv = 0; lv < 3; lv++) {
    const L = LEVELS[lv];
    for (let m = 0; m < 16; m++) {
      const ox = m * TW, oy = lv * TH;
      const hasN = !(m & N), hasE = !(m & E), hasS = !(m & S), hasW = !(m & W); // has* = bu tarafta kenar var
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const i = y * TW + x;
        const dN = hasN ? y + 0.5 - insN[x] : 99, dS = hasS ? TH - y - 0.5 - insS[x] : 99;
        const dW = hasW ? x + 0.5 - insW[y] : 99, dE = hasE ? TW - x - 0.5 - insE[y] : 99;
        let dd = Math.min(dN, dS, dW, dE);
        const corner = (a, b) => { if (a < R && b < R) { const q = R - Math.hypot(R - a, R - b); if (q < dd) dd = q; } };
        if (hasN && hasW) corner(dN, dW); if (hasN && hasE) corner(dN, dE);
        if (hasS && hasW) corner(dS, dW); if (hasS && hasE) corner(dS, dE);
        dd += edgeJ[i];
        const a = Math.max(0, Math.min(1, (dd + 0.6) / 2.2));
        const o = ((oy + y) * stride + ox + x) * 4;
        // çime düşen yumuşak temas gölgesi (kenar dışı), güney (ön) kenarda daha belirgin
        let aoA = 0;
        if (dd < 0) { const fall = Math.max(0, 1 + dd / (dS < dN ? 6 : 4)); aoA = fall * fall * (dS < 6 && dS < dN ? 0.42 : 0.26); }
        if (a <= 0 && aoA <= 0.002) { d[o + 3] = 0; continue; }
        let k = kBase[i];
        const ridge = ridgeA[i];
        // kenar ışığı/dudak: arka (kuzey) kenar hafif aydınlık, ön (güney) kenar dikey yüz → koyu
        if (dN < 3) k *= 1.06;
        if (dS < 5) k *= 0.7 + 0.3 * Math.max(0, dS) / 5;
        if (dW < 3 || dE < 3) k *= 0.93;
        const mixDk = (1 - ridge) * 0.5;
        let r = (L.base[0] * (1 - mixDk) + L.dk[0] * mixDk) * k;
        let g = (L.base[1] * (1 - mixDk) + L.dk[1] * mixDk) * k;
        let b = (L.base[2] * (1 - mixDk) + L.dk[2] * mixDk) * k;
        if (slopeA[i] > 0.6) { const t = (slopeA[i] - 0.6) * 0.45; r += (L.lt[0] - r) * t; g += (L.lt[1] - g) * t; b += (L.lt[2] - b) * t; }
        // ıslak parlama: sırt üstlerinde soğuk, hafif speküler lekeler
        if (L.sheen > 0) { const s = Math.min(1, sheenA[i]) * L.sheen; r += (196 - r) * s * 0.32; g += (196 - g) * s * 0.32; b += (206 - b) * s * 0.36; }
        // kompozit: toprak (a) AO'nun (aoA) üstünde
        const sa = a, ba = aoA * (1 - sa), oa = sa + ba;
        if (oa <= 0) { d[o + 3] = 0; continue; }
        d[o] = Math.min(255, (r * sa + 28 * ba) / oa);
        d[o + 1] = Math.min(255, (g * sa + 22 * ba) / oa);
        d[o + 2] = Math.min(255, (b * sa + 18 * ba) / oa);
        d[o + 3] = oa * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // küçük topak benekleri (tüm karelerde aynı, dünya hizalı → dikişsiz)
  const rr = mulberry32(39);
  const specks = [];
  for (let i = 0; i < 26; i++) specks.push([5 + rr() * (TW - 10), 5 + rr() * (TH - 10), rr() < 0.5, 0.8 + rr() * 1.2]);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let lv = 0; lv < 3; lv++) for (let m = 0; m < 16; m++) {
    const ox = m * TW, oy = lv * TH;
    for (const [x, y, light, s] of specks) {
      ctx.fillStyle = light ? `rgba(225,195,150,${lv === 2 ? 0.25 : 0.45})` : 'rgba(40,26,16,0.45)';
      ctx.beginPath(); ctx.ellipse(ox + x, oy + y, s, s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  const tex = register(scene, SOIL_ATLAS, canvas);
  for (let lv = 0; lv < 3; lv++) for (let m = 0; m < 16; m++) tex.add(soilFrame(m, lv), 0, m * TW, lv * TH, TW, TH);
}

/** Ot tutamı: tabandan yelpaze yapan yumuşak hacimli yapraklar, kenar ışığı. foot = (w/2, h-1) */
function weedTuft(ctx, ox, oy, w, h, r, variant) {
  const cx = ox + w / 2, fy = oy + h - 1;
  // temas gölgesi
  const g0 = ctx.createRadialGradient(cx, fy, 0, cx, fy, w * 0.45);
  g0.addColorStop(0, 'rgba(25,20,12,0.45)'); g0.addColorStop(1, 'rgba(25,20,12,0)');
  ctx.save(); ctx.translate(cx, fy); ctx.scale(1, 0.35); ctx.translate(-cx, -fy); ctx.fillStyle = g0; ctx.fillRect(ox, fy - w, w, w * 2); ctx.restore();
  const cols = ['#6f9a3c', '#86ad45', '#5d8a35', '#9bbd52'];
  const n = 6 + variant * 2;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = (t - 0.5) * 2.1 + (r() - 0.5) * 0.3;
    const len = (h - 3) * (0.55 + r() * 0.45) * (1 - Math.abs(t - 0.5) * 0.5);
    const bx = cx + (t - 0.5) * 5;
    const tx = bx + Math.sin(ang) * len, ty = fy - Math.cos(ang) * len;
    const wid = 1.4 + r() * 1.3;
    const col = cols[(i + variant) % cols.length];
    const lg = ctx.createLinearGradient(bx, fy, tx, ty);
    lg.addColorStop(0, shade(col, -0.4)); lg.addColorStop(0.6, col); lg.addColorStop(1, shade(col, 0.3));
    ctx.fillStyle = lg;
    const mx = (bx + tx) / 2 + Math.cos(ang) * wid * 1.5, my = (fy + ty) / 2 + Math.sin(ang) * wid;
    ctx.beginPath(); ctx.moveTo(bx - wid, fy); ctx.quadraticCurveTo(mx - wid, my, tx, ty); ctx.quadraticCurveTo(mx + wid, my, bx + wid, fy); ctx.closePath(); ctx.fill();
    // kenar ışığı
    ctx.strokeStyle = 'rgba(232,245,170,0.35)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(bx - wid * 0.6, fy - 1); ctx.quadraticCurveTo(mx - wid, my, tx, ty); ctx.stroke();
  }
  if (variant === 2) { // küçük sarı çiçek (karahindiba)
    const fx = cx + 2, fyy = oy + 4;
    ctx.fillStyle = '#5d8a35'; ctx.fillRect(fx - 0.5, fyy, 1, h - 6);
    ctx.fillStyle = '#f2cf4a'; ctx.beginPath(); ctx.arc(fx, fyy, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff4b0'; ctx.beginPath(); ctx.arc(fx - 0.6, fyy - 0.7, 1, 0, Math.PI * 2); ctx.fill();
  }
}

function genMisc(scene) {
  if (scene.textures.exists(SOIL_MISC)) return;
  const WW = 22, WH = 20, BW = 10, BH = 8;
  const { canvas, ctx } = makeCanvas(WW * WEED_FRAMES + BW * BIT_FRAMES, WH);
  const r = mulberry32(51);
  for (let i = 0; i < WEED_FRAMES; i++) weedTuft(ctx, i * WW, 0, WW, WH, r, i);
  const bx0 = WW * WEED_FRAMES;
  // taş (2), saman, topak
  const stone = (ox, col) => {
    const g = ctx.createRadialGradient(ox + 4, 3, 0, ox + 5, 4, 5); g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.4));
    ctx.fillStyle = 'rgba(30,20,12,0.35)'; ctx.beginPath(); ctx.ellipse(ox + 5.5, 6.2, 4.2, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ox + 5, 4.5, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  };
  stone(bx0, '#a59886'); stone(bx0 + BW, '#8c8276');
  ctx.strokeStyle = '#d9c27a'; ctx.lineWidth = 1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx0 + BW * 2 + 1.5, 5); ctx.lineTo(bx0 + BW * 2 + 8, 3); ctx.stroke();
  ctx.strokeStyle = '#b89a58'; ctx.beginPath(); ctx.moveTo(bx0 + BW * 2 + 2.5, 3); ctx.lineTo(bx0 + BW * 2 + 7.5, 6); ctx.stroke();
  { const ox = bx0 + BW * 3; const g = ctx.createRadialGradient(ox + 4, 3, 0, ox + 5, 4, 5); g.addColorStop(0, '#a27650'); g.addColorStop(1, '#4e331f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ox + 5, 4.5, 3.4, 2.4, 0, 0, Math.PI * 2); ctx.fill(); }
  const tex = register(scene, SOIL_MISC, canvas, { weedW: WW, weedH: WH, bitW: BW, bitH: BH });
  for (let i = 0; i < WEED_FRAMES; i++) tex.add(`weed${i}`, 0, i * WW, 0, WW, WH);
  for (let i = 0; i < BIT_FRAMES; i++) tex.add(`bit${i}`, 0, bx0 + i * BW, 0, BW, BH);
}

function genErase(scene) {
  if (scene.textures.exists(SOIL_ERASE)) return;
  const { canvas, ctx } = makeCanvas(TILE_W, TILE_H); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, TILE_W, TILE_H);
  register(scene, SOIL_ERASE, canvas);
}

/** Islaklık yayılma lekesi (sulama efekti): ıslak toprak renginde yumuşak elips. */
function genWetBlob(scene) {
  const key = 'fx_wetblob'; if (scene.textures.exists(key)) return;
  const w = 64, h = 44; const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h); const dd = img.data; const n = new TileNoise(61, 8, 6);
  const c = [70, 47, 31];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1;
    const rr = Math.sqrt(u * u + v * v) + (n.fbm(x / w, y / h, 3) - 0.5) * 0.35;
    const a = Math.max(0, Math.min(1, (0.92 - rr) / 0.3));
    const i = (y * w + x) * 4; dd[i] = c[0]; dd[i + 1] = c[1]; dd[i + 2] = c[2]; dd[i + 3] = a * a * (3 - 2 * a) * 235;
  }
  ctx.putImageData(img, 0, 0); register(scene, key, canvas);
}

export function genSoil(scene) {
  genAtlas(scene); genMisc(scene); genErase(scene); genWetBlob(scene);
}

export { mixHex };
