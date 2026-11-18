// Gökyüzü ve ışık dokuları: parıltılar, güneş, ay evreleri, yıldızlar, bulutlar, sis, huzme.
import { makeCanvas, register, radial, bakeTint } from './canvas.js';
import { mulberry32, TileNoise } from './noise.js';

export function genBasics(scene, canvasMode) {
  // düz beyaz piksel
  { const { canvas, ctx } = makeCanvas(8, 8); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 8, 8); register(scene, 'fx_white', canvas); }
  // yumuşak parıltı (Gauss'a yakın)
  { const s = 256; const { canvas, ctx } = makeCanvas(s, s);
    const img = ctx.createImageData(s, s); const d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s * 2 - 1, dy = (y + 0.5) / s * 2 - 1; const r2 = dx * dx + dy * dy;
      const a = r2 >= 1 ? 0 : Math.exp(-r2 * 4.2) * (1 - r2) ** 1.5; const i = (y * s + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_glow', canvas); }
  // keskin çekirdekli parıltı (ateş böceği, yıldız, pencere)
  { const s = 64; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 32, 32, 32, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.95)'], [0.3, 'rgba(255,255,255,0.35)'], [0.6, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, s, s); register(scene, 'fx_spark', canvas); }
  // nokta ışık (radyal düşüş)
  { const s = 256; const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = radial(ctx, 128, 128, 128, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.45)'], [0.55, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, s, s); if (canvasMode) bakeTint(canvas, '#ffc878'); register(scene, 'fx_light', canvas); }
  // temas gölgesi (AO)
  { const { canvas, ctx } = makeCanvas(128, 64);
    ctx.save(); ctx.scale(1, 0.5);
    ctx.fillStyle = radial(ctx, 64, 64, 64, [[0, 'rgba(26,22,48,0.85)'], [0.5, 'rgba(26,22,48,0.45)'], [1, 'rgba(26,22,48,0)']]);
    ctx.fillRect(0, 0, 128, 128); ctx.restore(); register(scene, 'fx_ao', canvas); }
  // dikey rampalar (ambient geçişi ve ufuk puslanması)
  { const { canvas, ctx } = makeCanvas(6, 126); const g = ctx.createLinearGradient(0, 0, 0, 126);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 6, 126);
    register(scene, 'fx_ramp_up', canvas); }
  { const { canvas, ctx } = makeCanvas(6, 126); const g = ctx.createLinearGradient(0, 0, 0, 126);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 6, 126);
    register(scene, 'fx_ramp_down', canvas); }
  // ışık huzmesi
  { const w = 96, h = 512; const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = y / h;
      const a = Math.exp(-u * u * 5) * Math.sin(Math.PI * Math.min(1, v * 1.15)) ** 1.2 * (1 - v * 0.6);
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, a) * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_shaft', canvas); }
  // toz zerresi
  { const { canvas, ctx } = makeCanvas(16, 16);
    ctx.fillStyle = radial(ctx, 8, 8, 8, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, 16, 16); register(scene, 'fx_mote', canvas); }
  // gök gradyanı (dinamik, SkyLayer renk değişince yeniden boyar)
  // NPOT → kenar kenetleme (POT dokular sarmalanır, kenarda çizgi oluşur). CPU canvas (willReadFrequently):
  // GPU hızlandırmalı canvas'ın her yüklemesi 'GPU stall due to ReadPixels' uyarısı ve takılma üretir.
  if (!scene.textures.exists('sky_grad')) { const { canvas } = makeCanvas(3, 250); scene.textures.addCanvas('sky_grad', canvas); }
}

export function genSun(scene) {
  const s = 128; const { canvas, ctx } = makeCanvas(s, s);
  ctx.fillStyle = radial(ctx, 64, 64, 64, [[0, 'rgba(255,255,255,1)'], [0.62, 'rgba(255,253,245,1)'], [0.74, 'rgba(255,246,225,0.92)'], [0.84, 'rgba(255,240,210,0.35)'], [1, 'rgba(255,240,210,0)']]);
  ctx.fillRect(0, 0, s, s);
  register(scene, 'sky_sun', canvas);
}

export function genMoons(scene) {
  const s = 96, R = 40; const n = new TileNoise(77, 8, 8);
  for (let p = 0; p < 8; p++) {
    const key = 'sky_moon_' + p; if (scene.textures.exists(key)) continue;
    const { canvas, ctx } = makeCanvas(s, s);
    const img = ctx.createImageData(s, s); const d = img.data;
    const ph = p / 8; // 0 yeni ay, 0.5 dolunay
    const lx = Math.sin(ph * Math.PI * 2), lz = -Math.cos(ph * Math.PI * 2);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const nx = (x + 0.5 - s / 2) / R, ny = (y + 0.5 - s / 2) / R; const r2 = nx * nx + ny * ny;
      const i = (y * s + x) * 4;
      if (r2 > 1.04) { d[i + 3] = 0; continue; }
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const lit = Math.max(0, Math.min(1, (nx * lx + nz * lz) * 6 + 0.5));
      const mare = n.fbm((nx + 1) * 0.5, (ny + 1) * 0.5, 3) ;
      const albedo = 0.78 + 0.22 * (1 - Math.max(0, mare - 0.45) * 2.2);
      const limb = 0.75 + 0.25 * nz;
      const b = (0.05 + 0.95 * lit) * albedo * limb;
      d[i] = 235 * b + 10; d[i + 1] = 238 * b + 12; d[i + 2] = 255 * b + 18;
      const edge = Math.max(0, Math.min(1, (1.04 - r2) / 0.08));
      d[i + 3] = 255 * edge * (0.25 + 0.75 * Math.max(lit, 0.06));
    }
    ctx.putImageData(img, 0, 0); register(scene, key, canvas);
  }
}

export function genStars(scene) {
  for (const [key, seed] of [['sky_stars_a', 11], ['sky_stars_b', 29]]) {
    if (scene.textures.exists(key)) continue;
    const w = 1024, h = 512; const { canvas, ctx } = makeCanvas(w, h); const r = mulberry32(seed);
    for (let i = 0; i < 420; i++) {
      const x = r() * w, y = (r() ** 1.3) * h; // üstte daha yoğun
      const big = r() < 0.06; const rad = big ? 1.6 + r() * 1.4 : 0.5 + r() * 0.9;
      const tint = r(); const col = tint < 0.2 ? '255,220,190' : tint < 0.45 ? '200,215,255' : '255,255,255';
      const a = (big ? 0.9 : 0.35 + r() * 0.55);
      ctx.fillStyle = radial(ctx, x, y, rad * 2.2, [[0, `rgba(${col},${a})`], [0.4, `rgba(${col},${a * 0.5})`], [1, `rgba(${col},0)`]]);
      ctx.fillRect(x - rad * 2.5, y - rad * 2.5, rad * 5, rad * 5);
      if (big && r() < 0.5) { ctx.fillStyle = `rgba(${col},${a * 0.25})`; ctx.fillRect(x - rad * 4, y - 0.4, rad * 8, 0.8); ctx.fillRect(x - 0.4, y - rad * 4, 0.8, rad * 8); }
    }
    register(scene, key, canvas);
  }
}

/** Kümülüs bulutları: yoğunluk alanı + kendi kendine gölgelenme (üst yüzey aydınlık). Gri tonlu, tint ile renklenir. */
export function genClouds(scene) {
  const W = 300, H = 130;
  for (let k = 0; k < 6; k++) {
    const key = 'sky_cloud_' + k; if (scene.textures.exists(key)) continue;
    const r = mulberry32(100 + k * 17); const n = new TileNoise(300 + k, 12, 6);
    const blobs = []; const count = 9 + Math.floor(r() * 7); const flat = k >= 4; // 4,5: ince katman bulutları
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const cx = W * (0.14 + 0.72 * t + (r() - 0.5) * 0.08);
      const hump = Math.sin(Math.PI * t);
      const rad = (flat ? 16 + r() * 10 : 18 + r() * 16 + hump * 22);
      const cy = H * (flat ? 0.62 : 0.66) - hump * (flat ? 6 : 28) * r() - rad * 0.25;
      blobs.push([cx, cy, rad]);
    }
    const dens = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (const [cx, cy, rr] of blobs) { const dx = (x - cx) / rr, dy = (y - cy) / (rr * (flat ? 0.55 : 0.85)); s += Math.exp(-(dx * dx + dy * dy) * 1.6); }
      const base = y > H * 0.7 ? Math.exp(-(((y - H * 0.7) / 8) ** 2)) : 1; // düz taban
      s *= base * (0.75 + 0.5 * n.fbm(x / W, y / H, 4));
      dens[y * W + x] = s;
    }
    const { canvas, ctx } = makeCanvas(W, H); const img = ctx.createImageData(W, H); const d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = dens[y * W + x]; const a = Math.max(0, Math.min(1, (s - 0.22) / 0.55));
      const above = y >= 9 ? dens[(y - 9) * W + x] : 0;
      const lit = Math.max(0, Math.min(1, 1 - above * 0.75));
      const vert = 1 - (y / H) * 0.35;
      const b = Math.max(0, Math.min(1, 0.66 + 0.26 * lit + 0.08 * vert));
      const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = b * 255; d[i + 3] = a * a * (3 - 2 * a) * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, key, canvas);
  }
}

export function genFog(scene) {
  if (!scene.textures.exists('fx_fogband')) {
    const w = 1024, h = 126; const n = new TileNoise(55, 16, 4);
    const { canvas, ctx } = makeCanvas(w, h); const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = y / h; const prof = Math.exp(-(((v - 0.6) / 0.24) ** 2));
      const f = n.fbm(x / w, v, 4); const a = Math.max(0, Math.min(1, prof * (0.45 + f * 0.9)));
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_fogband', canvas);
  }
  if (!scene.textures.exists('fx_fogpuff')) {
    const w = 256, h = 64; const n = new TileNoise(91, 8, 4);
    const { canvas, ctx } = makeCanvas(w, h); const img = ctx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1; const r2 = u * u + v * v;
      const a = Math.max(0, 1 - r2) ** 1.6 * (0.55 + 0.6 * n.fbm(x / w, y / h, 3));
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(1, a) * 255;
    }
    ctx.putImageData(img, 0, 0); register(scene, 'fx_fogpuff', canvas);
  }
}
