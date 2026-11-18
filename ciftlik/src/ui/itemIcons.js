// Ürün / tohum / gübre / ilaç ikonları — kodla üretilmiş SVG (crops.js color/accent, items.js color).
// id/gradyan kullanılmaz (aynı sayfada çok kez basılabilir). Sonuçlar önbelleğe alınır.
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';

const wrap = (body) =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Sıcak, sade stil: koyu kontur, düz dolgu, tek açık parlama.
const OUT = '#2a1d12';
const SW = 'stroke="' + OUT + '" stroke-width="1.3"';
const hi = (d, op = 0.35) => `<path d="${d}" fill="none" stroke="#fff8e6" stroke-width="1.4" opacity="${op}"/>`;
const leaf = (d, fill) => `<path d="${d}" fill="${fill}" ${SW}/>`;

function shade(hex, k) {
  // k>0 açar, k<0 koyulaştırır
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  r = Math.round(r + (t - r) * a); g = Math.round(g + (t - g) * a); b = Math.round(b + (t - b) * a);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const CROP_DRAW = {
  lettuce: (c) =>
    leaf('M16 27c-7 0-11-4-11-9 0-3 2-5 4-5-1-3 2-6 5-5 1-3 6-3 7 0 3-1 6 2 5 5 2 0 4 2 4 5 0 5-4 9-11 9z', c.color) +
    leaf('M16 27c-4 0-7-3-7-7 0-3 3-5 7-5s7 2 7 5c0 4-3 7-7 7z', c.accent) +
    `<path d="M16 26v-9M16 21l-3-2M16 21l3-2" stroke="${shade(c.color, -0.25)}" stroke-width="1.1" fill="none"/>`,
  spinach: (c) =>
    leaf('M15 27C8 24 6 16 9 9c4 2 7 8 6 18z', c.color) +
    leaf('M17 27c7-3 9-11 6-18-4 2-7 8-6 18z', shade(c.color, 0.12)) +
    leaf('M16 27c-3-5-3-12 0-19 3 7 3 14 0 19z', c.accent) +
    `<path d="M16 27v-14" stroke="${shade(c.color, -0.3)}" stroke-width="1" fill="none"/>`,
  potato: (c) =>
    `<path d="M7 18c0-6 5-9 10-9 6 0 9 4 9 8 0 6-5 9-10 9-6 0-9-3-9-8z" fill="${c.accent}" ${SW}/>` +
    `<g fill="${shade(c.accent, -0.35)}"><circle cx="12" cy="16" r="1"/><circle cx="19" cy="14" r="1"/><circle cx="21" cy="20" r="1"/><circle cx="14" cy="22" r="1"/></g>` +
    hi('M10 15c1-2 3-3 5-3'),
  strawberry: (c) =>
    `<path d="M16 28c-6-3-10-9-9-14 1-3 5-4 9-3 4-1 8 0 9 3 1 5-3 11-9 14z" fill="${c.accent}" ${SW}/>` +
    `<g fill="#ffe27a"><circle cx="12" cy="16" r=".8"/><circle cx="16" cy="15" r=".8"/><circle cx="20" cy="16" r=".8"/><circle cx="14" cy="20" r=".8"/><circle cx="18" cy="20" r=".8"/><circle cx="16" cy="24" r=".8"/></g>` +
    leaf('M10 11c2-1 4-1 6 0 2-1 4-1 6 0-1-2-3-3-4-3l-2-3-2 3c-1 0-3 1-4 3z', c.color),
  wheat: (c) => {
    let s = `<path d="M16 29V8" stroke="${shade(c.accent, -0.3)}" stroke-width="1.4" fill="none"/>`;
    for (let i = 0; i < 4; i++) {
      const y = 9 + i * 4;
      s += `<ellipse cx="13" cy="${y + 1}" rx="2.6" ry="1.5" transform="rotate(-35 13 ${y + 1})" fill="${c.accent}" ${SW}/>`;
      s += `<ellipse cx="19" cy="${y + 1}" rx="2.6" ry="1.5" transform="rotate(35 19 ${y + 1})" fill="${c.accent}" ${SW}/>`;
    }
    s += `<ellipse cx="16" cy="6.5" rx="1.6" ry="2.6" fill="${c.accent}" ${SW}/>`;
    return s;
  },
  bean: (c) =>
    `<path d="M7 9c3 0 5 3 7 7s5 8 11 8c0 3-3 4-6 4-6 0-9-5-11-9S5 12 7 9z" fill="${c.accent}" ${SW}/>` +
    `<g fill="${shade(c.accent, -0.25)}"><circle cx="11" cy="15" r="1.3"/><circle cx="14.5" cy="20" r="1.3"/><circle cx="19" cy="24.5" r="1.3"/></g>` +
    leaf('M6 9c-1-3 1-5 3-5 0 2-1 4-3 5z', c.color),
  tomato: (c) =>
    `<circle cx="16" cy="18" r="10" fill="${c.accent}" ${SW}/>` +
    leaf('M16 8l2 2.5 3.5-.5-2 2.5 2 2-3.5-.4L16 17l-2-2.9-3.5.4 2-2-2-2.5 3.5.5z', c.color) +
    hi('M10 16c0-2 1.5-4 3.5-4.8', 0.45),
  corn: (c) =>
    `<path d="M16 4c4 0 6 6 6 12s-2 11-6 11-6-5-6-11 2-12 6-12z" fill="${c.accent}" ${SW}/>` +
    `<path d="M12 10h8M11 14h10M11 18h10M12 22h8M16 5v21M13.5 7v18M18.5 7v18" stroke="${shade(c.accent, -0.28)}" stroke-width=".8" fill="none" opacity=".6"/>` +
    leaf('M16 28c-6-2-9-7-9-14 3 3 6 7 9 14z', c.color) +
    leaf('M16 28c6-2 9-7 9-14-3 3-6 7-9 14z', shade(c.color, 0.12)),
  watermelon: (c) =>
    `<ellipse cx="16" cy="17" rx="12" ry="9.5" fill="${shade(c.color, 0.15)}" ${SW}/>` +
    `<path d="M8 10c2 4 2 10 0 14M13 8c2 5 2 13 0 18M19 8c-2 5-2 13 0 18M24 10c-2 4-2 10 0 14" stroke="${c.accent}" stroke-width="2" fill="none"/>` +
    hi('M7 14c1-2 3-3.5 5-4'),
  sunflower: (c) => {
    let s = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const x = (16 + Math.cos(a) * 8).toFixed(2), y = (15 + Math.sin(a) * 8).toFixed(2);
      s += `<ellipse cx="${x}" cy="${y}" rx="3.2" ry="1.7" transform="rotate(${i * 30} ${x} ${y})" fill="${c.accent}" stroke="${shade(c.accent, -0.35)}" stroke-width=".8"/>`;
    }
    s += `<circle cx="16" cy="15" r="5.4" fill="#6a4320" ${SW}/>`;
    s += `<g fill="#3d2610"><circle cx="14.5" cy="13.5" r=".7"/><circle cx="17.5" cy="14" r=".7"/><circle cx="15" cy="16.8" r=".7"/><circle cx="17.6" cy="17" r=".7"/></g>`;
    return s;
  },
  pumpkin: (c) =>
    `<path d="M16 9c-2-1-6-1-8 1-4 3-4 12 0 15 2 2 6 2 8 1 2 1 6 1 8-1 4-3 4-12 0-15-2-2-6-2-8-1z" fill="${c.accent}" ${SW}/>` +
    `<path d="M16 10v16M11 11c-2 4-2 10 0 14M21 11c2 4 2 10 0 14" stroke="${shade(c.accent, -0.3)}" stroke-width="1.1" fill="none"/>` +
    `<path d="M16 10c0-3 1-5 3-6" stroke="#5a7a2c" stroke-width="2.2" fill="none"/>` +
    hi('M9 14c0-2 1-3 2-3.6'),
  carrot: (c) =>
    `<path d="M10 11c2-2 8-2 10 0 1 1 0 4-1 6l-5 11c-1 1-2 0-2-1l-2-12c0-2-1-3 0-4z" fill="${c.accent}" ${SW}/>` +
    `<path d="M12 15h3M12.5 19h3M13.5 23h2" stroke="${shade(c.accent, -0.3)}" stroke-width="1" fill="none"/>` +
    leaf('M15 10c-3-3-4-6-3-8 2 1 3 4 3 8z', c.color) +
    leaf('M15 10c1-4 3-6 6-6 0 3-2 5-6 6z', shade(c.color, 0.1)) +
    leaf('M15 10c-1-3 0-6 2-7 1 2 0 5-2 7z', shade(c.color, -0.1)),
  grape: (c) => {
    const pts = [[12, 12], [16, 12], [20, 12], [14, 16], [18, 16], [10, 16], [22, 16], [12, 20], [16, 20], [20, 20], [14, 24], [18, 24], [16, 27.5]];
    let s = `<path d="M16 11V5c2 0 4 1 5 3" stroke="#6b4a2b" stroke-width="1.6" fill="none"/>`;
    s += leaf('M17 7c2-3 6-3 8-1-2 3-5 3-8 1z', c.color);
    for (const [x, y] of pts) s += `<circle cx="${x}" cy="${y}" r="2.6" fill="${c.accent}" stroke="${OUT}" stroke-width="1"/>`;
    s += hi('M10.5 15.2a1.6 1.6 0 0 1 1.6-1.2M14.5 11.2a1.6 1.6 0 0 1 1.6-1.2', 0.5);
    return s;
  },
};

const SHAPE_FALLBACK = (c) =>
  `<circle cx="16" cy="17" r="9" fill="${c.accent}" ${SW}/>` + leaf('M16 8c-3-2-5-2-6 0 2 1 4 1 6 0z', c.color);

const cache = new Map();

/** Hasat ürünü ikonu (13 ürün). */
export function cropIcon(cropId) {
  const key = `c:${cropId}`;
  let v = cache.get(key);
  if (v) return v;
  const c = CROPS[cropId];
  if (!c) return genericIcon();
  const fn = CROP_DRAW[cropId] || SHAPE_FALLBACK;
  v = wrap(fn(c));
  cache.set(key, v);
  return v;
}

/** Tohum paketi: kraft kâğıt paket + üstünde küçük ürün ikonu. */
export function seedIcon(cropId) {
  const key = `s:${cropId}`;
  let v = cache.get(key);
  if (v) return v;
  const c = CROPS[cropId];
  if (!c) return genericIcon();
  const fn = CROP_DRAW[cropId] || SHAPE_FALLBACK;
  v = wrap(
    `<path d="M6 6h20l-1 22H7z" fill="#e8d2a6" ${SW}/>` +
    `<path d="M6 6l2 3 2-3 2 3 2-3 2 3 2-3 2 3 2-3 2 3 2-3" fill="none" stroke="${OUT}" stroke-width="1.1"/>` +
    `<rect x="9" y="11" width="14" height="14" rx="3" fill="${shade(c.color, 0.55)}" stroke="${shade(c.color, -0.2)}" stroke-width=".9"/>` +
    `<g transform="translate(9.6 11.6) scale(.4)">${fn(c)}</g>`
  );
  cache.set(key, v);
  return v;
}

const SUPPLY = {
  compost: (col) =>
    `<path d="M8 10c0-2 2-3 8-3s8 1 8 3l1 15c0 2-3 3-9 3s-9-1-9-3z" fill="${col}" ${SW}/>` +
    `<path d="M8.5 10c2 1 5 1.5 7.5 1.5S21.5 11 23.5 10" stroke="${shade(col, -0.3)}" stroke-width="1.2" fill="none"/>` +
    `<path d="M16 21c-3 0-4-2-4-4 2 0 4 1 4 4zm0 0c0-3 2-5 5-5 0 3-2 5-5 5z" fill="#8fc65e" stroke="#2f4a1c" stroke-width=".9"/>` +
    hi('M10 13v9'),
  npk: (col) =>
    `<path d="M8 9c0-2 2-3 8-3s8 1 8 3l1 16c0 2-3 3-9 3s-9-1-9-3z" fill="${col}" ${SW}/>` +
    `<rect x="9" y="14" width="14" height="7" rx="1.5" fill="#f5ecd9" stroke="${shade(col, -0.35)}" stroke-width=".8"/>` +
    `<text x="16" y="19.6" text-anchor="middle" font-size="5.6" font-weight="800" font-family="system-ui,sans-serif" fill="${shade(col, -0.45)}">NPK</text>` +
    hi('M10 11v2'),
  lime: (col) =>
    `<path d="M8 9c0-2 2-3 8-3s8 1 8 3l1 16c0 2-3 3-9 3s-9-1-9-3z" fill="${col}" ${SW}/>` +
    `<path d="M10 22c2-3 10-3 12 0" stroke="#b8b09a" stroke-width="1.4" fill="none"/>` +
    `<circle cx="16" cy="15" r="3.4" fill="none" stroke="#9a9078" stroke-width="1.2"/>` +
    `<path d="M14.8 15h2.4" stroke="#9a9078" stroke-width="1.2"/>`,
  pesticide: (col) =>
    `<path d="M12 6h8v4h-8z" fill="#3a3a44" ${SW}/>` +
    `<path d="M11 10h10l2 4v12c0 1.5-1 2-2 2H11c-1 0-2-.5-2-2V14z" fill="${col}" ${SW}/>` +
    `<rect x="11" y="16" width="10" height="7" rx="1.2" fill="#f5ecd9" stroke="${OUT}" stroke-width=".7"/>` +
    `<path d="M13 21.5l1.5-3.5h3l1.5 3.5z" fill="#2a1d12"/>` +
    hi('M10.8 15v9'),
  organic_spray: (col) =>
    `<path d="M14 4h5v3h-5zM19 5h5l-1 2h-4z" fill="#3a3a44" ${SW}/>` +
    `<path d="M13 7h7v3l2 3v13c0 1.5-1 2-2 2h-7c-1 0-2-.5-2-2V13l2-3z" fill="${col}" ${SW}/>` +
    `<path d="M16.5 25c-4 0-5-3-5-6 3 0 5 2 5 6zm0 0c0-4 2-7 5-7 0 4-2 7-5 7z" fill="#e8f5c8" stroke="#2f4a1c" stroke-width=".8"/>` +
    hi('M12.8 14v8'),
};

/** Eşya ikonu: tohum, ürün, gübre, ilaç. Bilinmeyen eşya → genel kutu. */
export function itemIcon(itemId) {
  const it = ITEMS[itemId];
  if (!it) return genericIcon();
  if (it.category === 'seed') return seedIcon(it.crop);
  if (it.category === 'crop') return cropIcon(it.crop);
  const key = `i:${itemId}`;
  let v = cache.get(key);
  if (v) return v;
  const fn = SUPPLY[itemId];
  v = fn ? wrap(fn(it.color || '#8a7a60')) : genericIcon();
  cache.set(key, v);
  return v;
}

function genericIcon() {
  let v = cache.get('g');
  if (!v) {
    v = wrap(`<rect x="7" y="9" width="18" height="16" rx="3" fill="#a88a5c" ${SW}/><path d="M7 14h18M16 9v16" stroke="${OUT}" stroke-width="1"/>`);
    cache.set('g', v);
  }
  return v;
}
