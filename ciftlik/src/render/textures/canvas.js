// Canvas yardımcıları: oluşturma, kaydetme (idempotent), alfa bulanıklaştırma, gölge silüeti, renk pişirme.
import { WORLD } from '../../data/palette.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) };
}

/** Anahtar zaten varsa dokunmaz. customData ile meta (ayak noktası vb.) iliştirir. */
export function register(scene, key, canvas, meta) {
  if (scene.textures.exists(key)) return scene.textures.get(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (meta) tex.customData = { ...tex.customData, ...meta };
  return tex;
}

/** Alfa kanalında ayrık kutu bulanıklığı (3 geçiş ≈ Gauss). Renk sabit kabul edilir. */
export function blurAlpha(alpha, w, h, radius, passes = 3) {
  if (radius < 1) return alpha;
  const tmp = new Float32Array(alpha.length);
  const r = Math.round(radius);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += alpha[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * inv;
        acc += alpha[row + Math.min(w - 1, x + r + 1)] - alpha[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        alpha[y * w + x] = acc * inv;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
  return alpha;
}

/** Tüm canvas'ı (renk+alfa) yumuşat: ctx.filter varsa onu, yoksa alfa bulanıklığı kullanır. */
export function softenCanvas(canvas, radius) {
  const { canvas: c2, ctx } = makeCanvas(canvas.width, canvas.height);
  if ('filter' in ctx) {
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(c2, 0, 0);
  }
  return canvas;
}

/**
 * Kaynak silüetten yumuşak gölge dokusu üretir.
 * @returns {HTMLCanvasElement} meta: {footX, footY (gölge dokusunda), scale, silH, silW}
 */
export function makeShadowCanvas(src, footX, footY, scale, blur, color = WORLD.shadow) {
  const pad = Math.ceil(blur * 3 + 2);
  const sw = Math.ceil(src.width * scale), sh = Math.ceil(src.height * scale);
  const w = sw + pad * 2, h = sh + pad * 2;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(src, pad, pad, sw, sh);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  blurAlpha(a, w, h, blur);
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < a.length; i++) {
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
    d[i * 4 + 3] = Math.min(255, a[i] * 255 * 1.08);
  }
  ctx.putImageData(img, 0, 0);
  canvas.__meta = { footX: pad + footX * scale, footY: pad + footY * scale, scale, silH: sh, silW: sw, w, h };
  return canvas;
}

/** Gri tonlu (tint için) dokuyu Canvas renderer'da kullanılmak üzere taban renkle çarpar. */
export function bakeTint(canvas, color) {
  const ctx = canvas.getContext('2d');
  const { canvas: mask, ctx: m } = makeCanvas(canvas.width, canvas.height);
  m.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Hex rengi açar/koyulaştırır (k>0 beyaza, k<0 siyaha) */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function mixHex(a, b, t) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const r = ((x >> 16) & 255) * (1 - t) + ((y >> 16) & 255) * t;
  const g = ((x >> 8) & 255) * (1 - t) + ((y >> 8) & 255) * t;
  const bb = (x & 255) * (1 - t) + (y & 255) * t;
  return '#' + ((1 << 24) | ((r | 0) << 16) | ((g | 0) << 8) | (bb | 0)).toString(16).slice(1);
}
