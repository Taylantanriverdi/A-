// Tohumlu rastgele + döşenebilir değer gürültüsü (yalnızca doku üretiminde kullanılır).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periyodik (döşenebilir) 2B değer gürültüsü. periodX/Y: kafes hücresi sayısı. */
export class TileNoise {
  constructor(seed, periodX = 16, periodY = 16) {
    this.px = periodX; this.py = periodY;
    const r = mulberry32(seed);
    this.v = new Float32Array(periodX * periodY);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  /** x,y kafes biriminde; sonuç 0..1 */
  sample(x, y) {
    const px = this.px, py = this.py;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
    const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    const v = this.v;
    const a = v[y0 * px + x0], b = v[y0 * px + x1], c = v[y1 * px + x0], d = v[y1 * px + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /** u,v 0..1 doku koordinatı; oktavlar periyodu iki katına çıkarır (döşenebilirlik korunur) */
  fbm(u, v, octaves = 4, baseFreq = 1) {
    let sum = 0, amp = 0.5, norm = 0, f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(u * this.px * f, v * this.py * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
}

/** 1B döşenebilir gürültü profili (dağ sırtları vb.) */
export function profile1D(seed, width, octaves, period) {
  const n = new TileNoise(seed, period, 1);
  const out = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0, amp = 0.5, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      s += amp * n.sample((x / width) * period * f, 0.5 * o);
      norm += amp; amp *= 0.5; f *= 2;
    }
    out[x] = s / norm;
  }
  return out;
}
