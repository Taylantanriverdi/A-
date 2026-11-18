// Hava dokuları (açılışta BİR KEZ): yağmur çizgisi, kar tanesi, dolu, sıçrama halkası, birikinti, bulut gölgesi,
// yaprak, kar başlığı, kar zemini (döşenebilir), şimşek çatalları. Tümü Canvas 2D; tint'e dayanmayan renkler pişirilmiştir.
import { makeCanvas, register } from './canvas.js';
import { mulberry32, TileNoise } from './noise.js';

export const BOLT_W = 360, BOLT_H = 640, BOLT_VARIANTS = 4;
export const LEAF_COLORS = ['#d9772b', '#b8432a', '#e6a23a'];

function boltPath(r, x0, y0, x1, y1, off, out, depth) {
  if (depth === 0) { out.push([x1, y1]); return; }
  const mx = (x0 + x1) / 2 + (r() - 0.5) * off, my = (y0 + y1) / 2 + (r() - 0.5) * off * 0.35;
  boltPath(r, x0, y0, mx, my, off * 0.55, out, depth - 1); boltPath(r, mx, my, x1, y1, off * 0.55, out, depth - 1);
}

function genBolt(scene, k) {
  const key = 'fx_bolt_' + k; if (scene.textures.exists(key)) return;
  const r = mulberry32(5100 + k * 31); const { canvas, ctx } = makeCanvas(BOLT_W, BOLT_H);
  const strokeChain = (pts, w, a, col) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = w; ctx.strokeStyle = col.replace('A', a); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  };
  const main = [[BOLT_W / 2 + (r() - 0.5) * 60, 0]];
  boltPath(r, main[0][0], 0, BOLT_W / 2 + (r() - 0.5) * 140, BOLT_H * 0.97, 130, main, 6);
  const chains = [{ pts: main, w: 1 }];
  const nb = 3 + Math.floor(r() * 3);
  for (let b = 0; b < nb; b++) { // çatallar ana hattan ayrılır
    const i = 4 + Math.floor(r() * (main.length - 12)); const [sx, sy] = main[i];
    const pts = [[sx, sy]]; const dir = r() < 0.5 ? -1 : 1;
    boltPath(r, sx, sy, sx + dir * (50 + r() * 90), sy + 90 + r() * 170, 60, pts, 4);
    chains.push({ pts, w: 0.55 });
  }
  for (const c of chains) strokeChain(c.pts, 14 * c.w, 0.10, 'rgba(170,190,255,A)');
  for (const c of chains) strokeChain(c.pts, 6 * c.w, 0.28, 'rgba(200,215,255,A)');
  for (const c of chains) strokeChain(c.pts, 2.2 * c.w, 0.95, 'rgba(255,255,255,A)');
  register(scene, key, canvas);
}

export function genWeather(scene) {
  const T = scene.textures;
  // yağmur çizgisi (üst saydam → alt parlak)
  if (!T.exists('fx_rain')) { const { canvas, ctx } = makeCanvas(4, 40);
    const g = ctx.createLinearGradient(0, 0, 0, 40); g.addColorStop(0, 'rgba(205,222,245,0)'); g.addColorStop(1, 'rgba(225,238,255,0.95)');
    ctx.fillStyle = g; ctx.fillRect(1, 0, 2, 40); register(scene, 'fx_rain', canvas); }
  // kar tanesi (yumuşak) ve dolu (parlak çekirdek)
  if (!T.exists('fx_flake')) { const { canvas, ctx } = makeCanvas(16, 16);
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16); register(scene, 'fx_flake', canvas); }
  if (!T.exists('fx_hail')) { const { canvas, ctx } = makeCanvas(10, 10);
    const g = ctx.createRadialGradient(4, 4, 0, 5, 5, 5); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(228,240,255,0.95)'); g.addColorStop(1, 'rgba(200,220,245,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 10, 10); register(scene, 'fx_hail', canvas); }
  // sıçrama halkası
  if (!T.exists('fx_ring')) { const { canvas, ctx } = makeCanvas(64, 24);
    ctx.strokeStyle = 'rgba(235,245,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(32, 12, 28, 9, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(235,245,255,0.35)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.ellipse(32, 12, 26, 8, 0, 0, Math.PI * 2); ctx.stroke();
    register(scene, 'fx_ring', canvas); }
  // birikinti: yumuşak kenarlı, gökten hafif aydınlık yansıma
  if (!T.exists('fx_puddle')) { const w = 160, h = 64; const { canvas, ctx } = makeCanvas(w, h); const n = new TileNoise(61, 6, 4);
    const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1;
      const wob = 1 + (n.sample(x / w * 6, y / h * 4) - 0.5) * 0.45;
      const r2 = (u * u + v * v) * wob; const a = Math.max(0, Math.min(1, (1 - r2) * 3.2));
      const sky = 0.55 + 0.45 * (1 - (v + 1) / 2); // üst kenar daha parlak yansıma
      const i = (y * w + x) * 4; d[i] = 120 + 70 * sky; d[i + 1] = 138 + 70 * sky; d[i + 2] = 165 + 60 * sky; d[i + 3] = a * a * 215;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_puddle', canvas); }
  // bulut gölgesi (büyük yumuşak leke)
  if (!T.exists('fx_cloudshade')) { const w = 256, h = 128; const { canvas, ctx } = makeCanvas(w, h); const n = new TileNoise(73, 6, 3);
    const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1; const r2 = u * u + v * v;
      const a = Math.max(0, 1 - r2) ** 1.4 * (0.55 + 0.7 * n.sample(x / w * 6, y / h * 3));
      const i = (y * w + x) * 4; d[i] = 20; d[i + 1] = 28; d[i + 2] = 52; d[i + 3] = Math.min(1, a) * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_cloudshade', canvas); }
  // sonbahar yaprakları
  LEAF_COLORS.forEach((col, k) => { const key = 'fx_leaf_' + k; if (T.exists(key)) return;
    const { canvas, ctx } = makeCanvas(18, 18); ctx.translate(9, 9);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.quadraticCurveTo(0, -7.5, 7, 0); ctx.quadraticCurveTo(0, 7.5, -7, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(70,30,10,0.5)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(6, 0); ctx.stroke();
    register(scene, key, canvas); });
  // kar başlığı: üstü parlak, alt kenarı mavimsi gölge, tabanı yumuşak (çatı/ağaç/çit üstüne oturur)
  if (!T.exists('fx_snowcap')) { const w = 128, h = 48; const { canvas, ctx } = makeCanvas(w, h);
    const r = mulberry32(88);
    const lump = (cx, cy, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
    for (let i = 0; i < 9; i++) lump(14 + i * 12 + (r() - 0.5) * 6, 28 - Math.sin(i / 8 * Math.PI) * 8 + (r() - 0.5) * 3, 13 + r() * 5, 12 + r() * 4, '#c9d8ee');
    for (let i = 0; i < 9; i++) lump(14 + i * 12 + (r() - 0.5) * 6, 25 - Math.sin(i / 8 * Math.PI) * 8 + (r() - 0.5) * 3, 12 + r() * 4, 10 + r() * 3, '#f4f8ff');
    const g = ctx.createLinearGradient(0, 30, 0, 48); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g; ctx.fillRect(0, 30, w, 18); ctx.globalCompositeOperation = 'source-over';
    register(scene, 'fx_snowcap', canvas); }
  // kar zemini: döşenebilir, mavimsi gölgeli beyaz + parıltı
  if (!T.exists('fx_snowground')) { const s = 256; const { canvas, ctx } = makeCanvas(s, s); const n = new TileNoise(41, 8, 8), n2 = new TileNoise(42, 16, 16); const r = mulberry32(43);
    const img = ctx.createImageData(s, s); const d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = 0.6 * n.sample(x / s * 8, y / s * 8) + 0.4 * n2.sample(x / s * 16, y / s * 16);
      const i = (y * s + x) * 4; d[i] = 226 + v * 26; d[i + 1] = 235 + v * 18; d[i + 2] = 248 + v * 7; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`; const x = r() * s, y = r() * s; ctx.fillRect(x, y, 1.4, 1.4); }
    register(scene, 'fx_snowground', canvas); }
  for (let k = 0; k < BOLT_VARIANTS; k++) genBolt(scene, k);
}
