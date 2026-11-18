// Finans grafikleri — canvas 2D, elle çizim, harici kütüphane yok. DPR'ye duyarlı; renkler #ui tema belirteçlerinden.
// Çizim yalnızca çağrıldığında olur (panel kapalıyken çağrı yok). Canvas genişliği kapsayıcıya uyar (width:100%).

let tokens = null;
/** Tema belirteçlerini (#ui özel özellikleri) bir kez okur. */
function theme() {
  if (tokens) return tokens;
  const root = document.getElementById('ui');
  const cs = root ? getComputedStyle(root) : null;
  const v = (n, d) => (cs && cs.getPropertyValue(n).trim()) || d;
  tokens = { good: v('--good', '#7fd18b'), bad: v('--bad', '#ff7a6b'), accent: v('--accent', '#f2b84b'), text: v('--text', '#f5ecd9'), event: v('--event', '#9bb7ff') };
  return tokens;
}
const dim = 'rgba(245,236,217,0.55)';
const grid = 'rgba(245,236,217,0.1)';
const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const short = (n) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(n / 1e3)}k` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)); };

/** Canvas'ı CSS boyutuna ve DPR'ye göre ayarlar; {g,w,h} döner (w/h CSS px). */
export function fit(canvas, cssH) {
  const w = Math.max(40, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || 300));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * dpr), H = Math.round(cssH * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  canvas.style.height = `${cssH}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, cssH);
  return { g, w, h: cssH };
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/**
 * Günlük gelir (yeşil, yukarı) / gider (kırmızı, aşağı) çubukları + net varlık çizgisi.
 * @param {HTMLCanvasElement} canvas
 * @param {{income:number,expense:number,net:number|null,label?:number}[]} days  eski → yeni (boş gün = 0)
 * @param {{height?:number, compact?:boolean, sel?:number}} o
 * @returns {{barX:(i:number)=>number, n:number, slot:number, left:number}}
 */
export function drawFlow(canvas, days, o = {}) {
  const T = theme();
  const H = o.height || (o.compact ? 64 : 200);
  const { g, w, h } = fit(canvas, H);
  const n = days.length;
  const padL = o.compact ? 4 : 38, padR = o.compact ? 4 : 40, padT = 8, padB = o.compact ? 4 : 18;
  const cw = w - padL - padR, ch = h - padT - padB;
  let maxIn = 0, maxEx = 0, nwLo = Infinity, nwHi = -Infinity;
  for (const d of days) {
    if (d.income > maxIn) maxIn = d.income;
    if (d.expense > maxEx) maxEx = d.expense;
    if (d.net != null) { if (d.net < nwLo) nwLo = d.net; if (d.net > nwHi) nwHi = d.net; }
  }
  const top = niceMax(maxIn), bot = niceMax(maxEx);
  const total = top + bot;
  const zeroY = padT + (top / total) * ch;
  const scale = ch / total;
  const slot = n > 0 ? cw / n : cw;
  const bw = Math.max(1.5, Math.min(18, slot * 0.66));
  g.font = FONT; g.textBaseline = 'middle';
  if (!o.compact) {
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = dim; g.textAlign = 'right';
    for (const [val, y] of [[top, padT], [0, zeroY], [-bot, padT + ch]]) {
      g.beginPath(); g.moveTo(padL, Math.round(y) + 0.5); g.lineTo(w - padR, Math.round(y) + 0.5); g.stroke();
      g.fillText(short(val), padL - 5, Math.min(h - 7, Math.max(7, y)));
    }
  } else {
    g.strokeStyle = grid; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, Math.round(zeroY) + 0.5); g.lineTo(w - padR, Math.round(zeroY) + 0.5); g.stroke();
  }
  const xs = (i) => padL + slot * i + slot / 2;
  for (let i = 0; i < n; i++) {
    const d = days[i], x = xs(i) - bw / 2;
    if (o.sel === i) { g.fillStyle = 'rgba(245,236,217,0.1)'; g.fillRect(padL + slot * i, padT - 4, slot, ch + 8); }
    if (d.income > 0) { g.fillStyle = T.good; const hh = Math.max(1, d.income * scale); g.fillRect(x, zeroY - hh, bw, hh); }
    if (d.expense > 0) { g.fillStyle = T.bad; const hh = Math.max(1, d.expense * scale); g.fillRect(x, zeroY, bw, hh); }
  }
  // Net varlık çizgisi (sağ eksen)
  if (nwHi > -Infinity && !o.compact) {
    let lo = nwLo, hi = nwHi;
    if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const ny = (v) => padT + (1 - (v - lo) / (hi - lo)) * ch;
    g.strokeStyle = T.accent; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    let started = false, lx = 0, ly = 0;
    for (let i = 0; i < n; i++) {
      const v = days[i].net; if (v == null) continue;
      const x = xs(i), y = ny(v);
      if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
      lx = x; ly = y;
    }
    g.stroke();
    g.fillStyle = T.accent; g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
    g.textAlign = 'left'; g.fillStyle = T.accent;
    g.fillText(short(hi), w - padR + 4, padT + 2);
    g.fillText(short(lo), w - padR + 4, padT + ch - 2);
  }
  if (!o.compact && n) {
    g.fillStyle = dim; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const step = Math.max(1, Math.ceil(n / Math.floor(cw / 38)));
    for (let i = n - 1; i >= 0; i -= step) if (days[i].label != null) g.fillText(String(days[i].label), xs(i), h - 4);
  }
  return { n, slot, left: padL };
}

/**
 * Yatay çubuklar (kategori kırılımı). rows: [{label, value}] value + yeşil, − kırmızı.
 * @returns {number} kullanılan yükseklik
 */
export function drawHBars(canvas, rows) {
  const T = theme();
  const rowH = 26;
  const H = Math.max(rowH, rows.length * rowH + 4);
  const { g, w } = fit(canvas, H);
  g.font = FONT; g.textBaseline = 'middle';
  let max = 0;
  for (const r of rows) max = Math.max(max, Math.abs(r.value));
  const labW = Math.min(110, w * 0.34), valW = 66;
  const bx = labW + 6, bwMax = Math.max(10, w - bx - valW - 6);
  rows.forEach((r, i) => {
    const y = i * rowH + rowH / 2 + 2;
    g.fillStyle = 'rgba(245,236,217,0.85)'; g.textAlign = 'left';
    g.fillText(r.label, 0, y, labW);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    rr(g, bx, y - 6, bwMax, 12, 6); g.fill();
    const bl = max > 0 ? Math.max(4, (Math.abs(r.value) / max) * bwMax) : 0;
    g.fillStyle = r.value >= 0 ? T.good : T.bad;
    if (bl) { rr(g, bx, y - 6, bl, 12, 6); g.fill(); }
    g.fillStyle = r.value >= 0 ? T.good : T.bad; g.textAlign = 'right';
    g.fillText(`${r.value >= 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(r.value)))}`, w, y);
  });
  return H;
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
