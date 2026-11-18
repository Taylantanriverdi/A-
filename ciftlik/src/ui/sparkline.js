// Canvas 2D ile elle çizilen küçük fiyat grafiği (harici kütüphane yok).
// Yalnızca veri değişince yeniden çizer (anahtar karşılaştırması); DPR'a duyarlı.

const COL_UP = '#7fd18b';
const COL_DOWN = '#ff7a6b';
const COL_FLAT = '#f2b84b';

/**
 * @param {number} w  CSS pikseli genişlik
 * @param {number} h  CSS pikseli yükseklik
 * @returns {{el:HTMLCanvasElement, draw(values:number[], change:number):void}}
 */
export function createSparkline(w, h, cls = 'spark') {
  const el = document.createElement('canvas');
  el.className = cls;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.setAttribute('aria-hidden', 'true');
  let key = '';
  let dprShown = 0;

  function draw(values, change) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const n = Array.isArray(values) ? values.length : 0;
    const k = n ? `${n}|${values[0]}|${values[n - 1]}|${values[n >> 1]}|${change}` : `0|${change}`;
    if (k === key && dpr === dprShown) return;
    key = k; dprShown = dpr;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (el.width !== W) el.width = W;
    if (el.height !== H) el.height = H;
    const g = el.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const col = change > 0.005 ? COL_UP : change < -0.005 ? COL_DOWN : COL_FLAT;
    const pad = 3;
    if (n < 2) {
      // Geçmiş yok: kesik orta çizgi + tek nokta
      g.strokeStyle = 'rgba(245,236,217,0.25)';
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(pad, h / 2); g.lineTo(w - pad, h / 2); g.stroke();
      g.setLineDash([]);
      if (n === 1) { g.fillStyle = col; g.beginPath(); g.arc(w - pad, h / 2, 2.4, 0, Math.PI * 2); g.fill(); }
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
    const span = hi - lo;
    const x = (i) => pad + (i / (n - 1)) * (w - pad * 2 - 2);
    const y = (v) => pad + (1 - (v - lo) / span) * (h - pad * 2);

    // Dolgu
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hexA(col, 0.32));
    grad.addColorStop(1, hexA(col, 0));
    g.beginPath();
    g.moveTo(x(0), h);
    for (let i = 0; i < n; i++) g.lineTo(x(i), y(values[i]));
    g.lineTo(x(n - 1), h);
    g.closePath();
    g.fillStyle = grad;
    g.fill();

    // Çizgi
    g.beginPath();
    for (let i = 0; i < n; i++) { const px = x(i), py = y(values[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();

    // Son nokta vurgusu
    const lx = x(n - 1), ly = y(values[n - 1]);
    g.fillStyle = hexA(col, 0.3);
    g.beginPath(); g.arc(lx, ly, 4.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(lx, ly, 2.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8e6';
    g.beginPath(); g.arc(lx, ly, 0.9, 0, Math.PI * 2); g.fill();
  }

  return { el, draw };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
