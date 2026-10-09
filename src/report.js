/* Dental NC Simülatörü — DETAYLI KAZIMA RAPORU (DOM'suz; tarayıcıda window.NCReport, Node'da require ile)
 *
 * core.js'in ayrıştırdığı işi (parseNC) alır, malzeme kaldırmayı simüle eder ve kazımada oluşan her kısmı raporlar:
 *  - Genel: süre, kesme/hızlı yol, kaldırılan hacim, disk kalınlığı, uyarılar
 *  - Takım bazında: çap/tip ve kaynağı (kullanıcı, ya da core.identifyTools: NC yorumu, yol eğriliği, takımlar arası sınır, varsayılan), süre, yol, hacim, kullanıldığı yüzler
 *  - Aşama bazında: kaba / ince / artık (rest) işleme, her yüz için ayrı
 *  - Yüz bazında: üst (A0) / alt (A180) / eğik
 *  - Operasyon bazında: strateji, Z adımı, yanal adım, teorik scallop, maks. talaş derinliği, havada kesme oranı,
 *    malzemeye hızlı (G0) dalma
 *  - Parça bazında: konum, boyut, yükseklik, kenar/komşu mesafesi, her yüzde hangi aşamanın son yüzeyi bıraktığı
 *    (ör. "%12 kaba izinde kaldı"), aşama/operasyon başına kaldırılan hacim, temas süresi, işlenmemiş yüzey
 * Çıktılar: yapı (JSON), düz metin, bağımsız HTML, CSV.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.NCReport = factory(root.NCCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
'use strict';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const fmt = (v, d = 3) => (v == null || !isFinite(v)) ? '–' : (+v).toFixed(d);
const fmtInt = (v) => (v == null || !isFinite(v)) ? '–' : Math.round(v).toLocaleString('tr-TR');
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : (100 * v).toFixed(d) + '%';
function fmtTime(min) {
  if (!isFinite(min)) return '–';
  const s = Math.round(min * 60), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DEFAULTS = {
  discD: 98.5, H: null, res: 0.1, ref: 'tip', aSign: 1, bSign: -1, bAxis: 'Y', order: 'AB', rapid: 10000, conn: 1.3,
  defaultTool: { type: 'ball', d: 1.0 },
};
const STD_THICK = [10, 12, 14, 15, 16, 18, 20, 22, 25, 30];
const STAGES = { kaba: 'Kaba işleme', ince: 'İnce işleme', artik: 'Artık malzeme (rest)', diger: 'Diğer' };
const STAGE_ORDER = ['kaba', 'ince', 'artik', 'diger'];
const SIDE_NAMES = { 1: 'Üst (A0)', '-1': 'Alt (A180)', 0: 'Eğik / yan' };

// ───────────────────────────── takımlar ─────────────────────────────
const TOOL_TYPES = { ball: 'Küresel (bilye uç)', flat: 'Düz (parmak)', bull: 'Torus (köşe radyuslu)' };
const TOOL_SHORT = { ball: 'Küresel', flat: 'Düz', bull: 'Torus' };
function normTool(t) {
  const type = TOOL_TYPES[t.type] ? t.type : 'ball';
  const d = +t.d > 0 ? +t.d : 1;
  return { type, d, cr: type === 'bull' ? (+t.cr > 0 ? Math.min(+t.cr, d / 2) : d / 4) : 0 };
}
function toolLabel(td) { return `${TOOL_SHORT[td.type]} Ø${+td.d.toFixed(3)}` + (td.type === 'bull' ? ` R${+td.cr.toFixed(3)}` : ''); }
const ID_SOURCES = { comment: 'NC yorumu', arc: 'Yol eğriliği (tanıma)', bound: 'Takımlar arası sınır (tanıma)', default: 'Varsayılan (doğrulanmadı)' };
const CONF_TR = { high: 'yüksek', medium: 'orta', low: 'düşük', none: 'yok' };

// Öncelik: kullanıcı (--tools / profil) > core.identifyTools (NC yorumu, yol eğriliği, takımlar arası sınır, varsayılan)
function resolveTools(job, S, overrides) {
  overrides = overrides || {};
  const ident = typeof core.identifyTools === 'function' ? (safe(() => core.identifyTools(job, { ref: S.ref })) || {}) : {};
  const used = [...new Set(job.ops.filter((o) => o.tool > 0).map((o) => o.tool))].sort((a, b) => a - b);
  const out = {};
  for (const t of used) {
    let src, base, conf = null, note = null;
    const id = ident[t];
    if (overrides[t]) { base = overrides[t]; src = 'Kullanıcı'; }
    else if (id && id.d > 0) { base = id; src = ID_SOURCES[id.source] || id.source || 'Tanıma'; conf = CONF_TR[id.conf] || id.conf || null; note = id.note || null; }
    else { base = (core.DEFAULT_TOOLS && core.DEFAULT_TOOLS[t]) || S.defaultTool; src = ID_SOURCES.default; }
    const td = normTool(base);
    out[t] = Object.assign(td, { tool: t, src, conf, note, label: toolLabel(td) });
  }
  return out;
}
function safe(fn) { try { return fn(); } catch (e) { return null; } }

// ───────────────────────────── kinematik + istatistik ─────────────────────────────
function rot(axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 'X') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'Y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul(A, B) {
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return R;
}
function blockFromMachine(S, A, B) {
  const ra = rot('X', -S.aSign * A), rb = rot(S.bAxis, -S.bSign * B);
  return S.order === 'AB' ? mul(ra, rb) : mul(rb, ra);
}

function prepare(job, tools, S) {
  const { MX, MY, MZ, TYPE, FEED, ops } = job;
  const R = S.discD / 2;
  let px = job.start.x, py = job.start.y, pz = job.start.z;
  const warnings = [];
  let outside = 0, outsideLine = -1;
  for (const op of ops) {
    op.M = blockFromMachine(S, op.A, op.B);
    op.u = [op.M[2], op.M[5], op.M[8]];
    op.side = op.u[2] > 0.26 ? 1 : (op.u[2] < -0.26 ? -1 : 0);
    op.tilt = Math.acos(Math.min(1, Math.abs(op.u[2]))) * 180 / Math.PI;
    const td = tools[op.tool];
    op.r = td ? td.d / 2 : 0;
    let cut = 0, rap = 0, nF = 0, constZ = 0, time = 0, cutTime = 0;
    const feeds = new Map(), zl = new Map();
    let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, bz0 = 1e9, bz1 = -1e9, mzMin = 1e9, mzMax = -1e9;
    const M = op.M;
    for (let i = op.start; i < op.end; i++) {
      const x = MX[i], y = MY[i], z = MZ[i];
      const d = Math.hypot(x - px, y - py, z - pz);
      if (TYPE[i] === 0) { rap += d; time += d / S.rapid; }
      else {
        const f = FEED[i] > 0 ? FEED[i] : 1000;
        cut += d; time += d / f; cutTime += d / f;
        if (d > 0) {
          nF++;
          feeds.set(FEED[i], (feeds.get(FEED[i]) || 0) + d);
          if (Math.abs(z - pz) < 1e-6) { constZ += d; const k = Math.round(z * 1000); zl.set(k, (zl.get(k) || 0) + d); }
          const bx = M[0] * x + M[1] * y + M[2] * z, by = M[3] * x + M[4] * y + M[5] * z, bz = M[6] * x + M[7] * y + M[8] * z;
          if (bx < bx0) bx0 = bx; if (bx > bx1) bx1 = bx; if (by < by0) by0 = by; if (by > by1) by1 = by; if (bz < bz0) bz0 = bz; if (bz > bz1) bz1 = bz;
          if (z < mzMin) mzMin = z; if (z > mzMax) mzMax = z;
          if (op.tool > 0 && Math.hypot(bx, by) > R - op.r * 0.5) { outside++; if (outsideLine < 0) outsideLine = job.LINE[i]; }
        }
      }
      px = x; py = y; pz = z;
    }
    Object.assign(op, { cut, rap, time, cutTime, nF, feeds, constZRatio: cut > 0 ? constZ / cut : 0, bbox: [bx0, by0, bz0, bx1, by1, bz1], mz: [mzMin, mzMax] });
    const lv = [...zl.entries()].filter(([, L]) => L > Math.max(2, cut * 0.002)).map(([k]) => k / 1000).sort((a, b) => b - a);
    const dz = [];
    for (let k = 1; k < lv.length; k++) dz.push(lv[k - 1] - lv[k]);
    dz.sort((a, b) => a - b);
    op.zStep = dz.length ? dz[dz.length >> 1] : NaN;
    op.zLevels = lv.length;
    op.kind = op.tool <= 0 ? 'Takımsız' : (op.nF === 0 ? 'Konumlama' : (op.constZRatio > 0.85 ? 'Z-sabit' : '3D yüzey'));
  }
  job.totalTime = ops.reduce((s, o) => s + o.time, 0) + (job.dwellTime || 0);
  job.totalCut = ops.reduce((s, o) => s + o.cut, 0);
  job.totalRapid = ops.reduce((s, o) => s + o.rap, 0);
  // kalınlık tahmini (diske ilk yaklaşma yüksekliğinden)
  let zmaxCut = 0;
  for (const op of ops) if (op.nF && op.tool > 0 && op.tilt < 1) zmaxCut = Math.max(zmaxCut, op.mz[1]);
  const ups = Object.values(job.firstRapidZ).filter((v) => v < 20);
  const U = ups.length ? Math.min(...ups) : zmaxCut + 1;
  let H = STD_THICK.filter((t) => t <= 2 * U - 0.05).pop();
  if (!H) H = Math.max(4, Math.floor((2 * U - 0.05) * 2) / 2);
  job.Hauto = H;
  if (outside) warnings.push({ lvl: 'bad', t: `${fmtInt(outside)} kesme hareketi disk kenarına (Ø${S.discD}) takım yarıçapından daha yakın veya disk dışında. İlk satır: ${outsideLine + 1}` });
  const sideless = ops.filter((o) => o.side === 0 && o.nF > 0);
  if (sideless.length) warnings.push({ lvl: 'warn', t: `${sideless.length} operasyon 75°'den fazla eğik (yan kesim); yükseklik haritası modeli bunları simüle etmez.` });
  return warnings;
}

// ───────────────────────────── yanal adım / scallop ─────────────────────────────
function analyzeStepover(job, op, td) {
  op.stepover = NaN; op.scallop = NaN;
  if (op.nF < 30 || op.cut < 1 || !td) return;
  const { MX, MY, MZ, TYPE } = job;
  const ds = Math.max(0.03, op.cut / 150000);
  const P = [], Sx = [];
  let s = 0, carry = 0;
  let px = op.start > 0 ? MX[op.start - 1] : 0, py = op.start > 0 ? MY[op.start - 1] : 0, pz = op.start > 0 ? MZ[op.start - 1] : 50;
  for (let i = op.start; i < op.end; i++) {
    const x = MX[i], y = MY[i], z = MZ[i];
    const L = Math.hypot(x - px, y - py, z - pz);
    if (TYPE[i] === 1 && L > 0) {
      let t = carry;
      while (t <= L) { const f = t / L; P.push(px + (x - px) * f, py + (y - py) * f, pz + (z - pz) * f); Sx.push(s + t); t += ds; }
      carry = t - L;
    } else carry = 0;
    s += L; px = x; py = y; pz = z;
  }
  const np = Sx.length;
  if (np < 50) return;
  const inv = 1 / 0.25, map = new Map();
  const key = (a, b, c) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  for (let k = 0; k < np; k++) {
    const kk = key(Math.floor(P[3 * k] * inv), Math.floor(P[3 * k + 1] * inv), Math.floor(P[3 * k + 2] * inv));
    let a = map.get(kk); if (!a) map.set(kk, a = []); a.push(k);
  }
  const flatZ = op.constZRatio > 0.85;
  const res = [];
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const reach = 5;
  for (let q = 0, nS = Math.min(700, np); q < nS; q++) {
    const j = Math.floor(rnd() * np);
    const x = P[3 * j], y = P[3 * j + 1], z = P[3 * j + 2];
    const ix = Math.floor(x * inv), iy = Math.floor(y * inv), iz = Math.floor(z * inv);
    let best = 1e9;
    const zr = flatZ ? 0 : reach;
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (let c = -zr; c <= zr; c++) {
      const arr = map.get(key(ix + a, iy + b, iz + c)); if (!arr) continue;
      for (const k of arr) {
        if (Math.abs(Sx[k] - Sx[j]) < 1.5) continue;
        const dz = P[3 * k + 2] - z;
        if (flatZ && Math.abs(dz) > 1e-4) continue;
        const dx = P[3 * k] - x, dy = P[3 * k + 1] - y, d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
    if (best < 1e8) res.push(Math.sqrt(best));
  }
  res.sort((a, b) => a - b);
  op.stepover = res.length > 20 ? res[res.length >> 1] : NaN;
  const r = td.d / 2;
  const sc = (sv) => (td.type === 'ball' && sv < 2 * r) ? (r - Math.sqrt(r * r - sv * sv / 4)) * 1000 : NaN;
  if (flatZ) {
    const wall = isFinite(op.zStep) ? sc(op.zStep) : NaN, fl = isFinite(op.stepover) ? sc(op.stepover) : NaN;
    op.scallop = isFinite(fl) ? Math.max(fl, wall || 0) : wall;
  } else op.scallop = sc(op.stepover);
  if (!flatZ && isFinite(op.stepover) && op.stepover >= 2 * r) op.scallop = 999;
}
function rating(um) {
  if (!isFinite(um)) return '–';
  if (um < 1) return 'Çok ince';
  if (um < 3) return 'İnce';
  if (um < 8) return 'Orta';
  if (um < 20) return 'Kaba';
  return 'Çok kaba';
}

// ───────────────────────────── aşama sınıflandırma (kaba / ince / artık) ─────────────────────────────
const RE_STAGE = [
  ['artik', /ARTIK|ARTİK|REST|RESTMAT|REMAIN|KALAN|PENCIL|KALEM/],
  ['kaba', /KABA|ROUGH|SCHRUPP|VORSCHL|ADAPTIVE|POCKET|CEP|BOŞALT|BOSALT/],
  ['ince', /İNCE|INCE|FINISH|SCHLICHT|FINI|FINAL|PERDAH|SEMI|ARA\s*İNCE/],
];
function classifyStages(job, tools) {
  const ops = job.ops;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const from = k > 0 ? ops[k - 1].line : -1;
    const texts = [op.label || ''];
    for (const c of job.comments) if (c.line > from && c.line <= op.line) texts.push(c.text);
    const s = texts.join(' ').toUpperCase();
    op.stageSrc = null;
    for (const [st, re] of RE_STAGE) if (re.test(s)) { op.stage = st; op.stageSrc = 'NC yorumu'; break; }
  }
  // yorumda yoksa: Z-sabit → kaba; aynı yüzdeki 3D operasyonlarda en büyük çaplı → ince, daha küçük çaplılar → artık
  const bySide = new Map();
  for (const op of ops) {
    if (op.stage || op.nF === 0 || op.tool <= 0) continue;
    if (op.constZRatio > 0.85 && op.zLevels >= 2) { op.stage = 'kaba'; op.stageSrc = 'Z-sabit strateji'; continue; }
    const k = op.side; if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(op);
  }
  for (const list of bySide.values()) {
    const dmax = Math.max(...list.map((o) => tools[o.tool] ? tools[o.tool].d : 0));
    for (const op of list) {
      const d = tools[op.tool] ? tools[op.tool].d : 0;
      if (d >= dmax - 1e-9) { op.stage = 'ince'; op.stageSrc = 'Yüzdeki en büyük çaplı 3D takım'; }
      else { op.stage = 'artik'; op.stageSrc = `Yüzdeki ince takımdan (Ø${fmt(dmax, 2)}) küçük çaplı 3D takım`; }
    }
  }
  for (const op of ops) if (!op.stage) { op.stage = 'diger'; op.stageSrc = op.stageSrc || (op.nF === 0 ? 'Kesme yok' : '–'); }
}

// ───────────────────────────── malzeme kaldırma simülasyonu ─────────────────────────────
function makeGrid(job, tools, S, H) {
  const R = S.discD / 2, res = S.res;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const op of job.ops) {
    if (op.side === 0 || !op.nF || !tools[op.tool]) continue;
    const m = tools[op.tool].d / 2 + 2 * S.conn + 1;
    x0 = Math.min(x0, op.bbox[0] - m); y0 = Math.min(y0, op.bbox[1] - m); x1 = Math.max(x1, op.bbox[3] + m); y1 = Math.max(y1, op.bbox[4] + m);
  }
  x0 = Math.max(x0, -R - res); y0 = Math.max(y0, -R - res); x1 = Math.min(x1, R + res); y1 = Math.min(y1, R + res);
  if (!(x1 > x0 && y1 > y0)) { x0 = y0 = -R - res; x1 = y1 = R + res; }
  const nx = Math.max(3, Math.round((x1 - x0) / res) + 1), ny = Math.max(3, Math.round((y1 - y0) / res) + 1);
  return { x0, y0, nx, ny, res, R, H, roi: true };
}

class Sim {
  // lab/np: ikinci geçişte hücre → parça etiketi (0 = parça dışı: kanal, konnektör, disk)
  constructor(job, tools, S, grid, lab, np) {
    this.job = job; this.tools = tools; this.S = S; this.g = grid;
    const N = grid.nx * grid.ny, no = job.ops.length;
    this.top = new Float32Array(N); this.bot = new Float32Array(N);
    this.lastTop = new Uint16Array(N); this.lastBot = new Uint16Array(N); // yüzeyi son kesen op+1
    this.mask = new Uint8Array(N);
    const H2 = grid.H / 2, R2 = grid.R * grid.R;
    for (let j = 0, k = 0; j < grid.ny; j++) {
      const y = grid.y0 + j * grid.res;
      for (let i = 0; i < grid.nx; i++, k++) { const x = grid.x0 + i * grid.res; this.mask[k] = x * x + y * y <= R2 ? 1 : 0; this.top[k] = H2; this.bot[k] = -H2; }
    }
    this.opVol = new Float64Array(no); this.opDepth = new Float32Array(no);
    this.opContact = new Float64Array(no); this.opAir = new Float64Array(no); this.opAirTime = new Float64Array(no);
    this.rapidHits = []; this.rapidHitCount = 0;
    this.lab = lab || null; this.np = np || 0;
    if (lab) {
      const W = np + 1;
      this.opPartVol = new Float64Array(no * W); this.opPartCells = new Int32Array(no * W); this.opPartTime = new Float64Array(no * W);
      this.stampTop = new Uint16Array(N); this.stampBot = new Uint16Array(N);
      this.mv = new Float64Array(W);
    }
  }
  run() { for (let i = 0; i < this.job.n; i++) this.apply(i); }
  apply(i) {
    const job = this.job, opI = job.OP[i], op = job.ops[opI];
    if (!op || op.tool <= 0 || op.side === 0) return;
    const td = this.tools[op.tool], r = td.d / 2;
    if (!(r > 0)) return;
    const M = op.M, u = op.u;
    const ax = i > 0 ? job.MX[i - 1] : job.start.x, ay = i > 0 ? job.MY[i - 1] : job.start.y, az = i > 0 ? job.MZ[i - 1] : job.start.z;
    const bx = job.MX[i], by = job.MY[i], bz = job.MZ[i];
    const L3 = Math.hypot(bx - ax, by - ay, bz - az);
    const ball = td.type === 'ball';
    const off = (ball && this.S.ref === 'tip') ? r : 0;
    const x0 = M[0] * ax + M[1] * ay + M[2] * az + u[0] * off, y0 = M[3] * ax + M[4] * ay + M[5] * az + u[1] * off, z0 = M[6] * ax + M[7] * ay + M[8] * az + u[2] * off;
    const x1 = M[0] * bx + M[1] * by + M[2] * bz + u[0] * off, y1 = M[3] * bx + M[4] * by + M[5] * bz + u[1] * off, z1 = M[6] * bx + M[7] * by + M[8] * bz + u[2] * off;
    const H2 = this.g.H / 2, side = op.side, isFeed = job.TYPE[i] !== 0;
    const ft = isFeed ? L3 / (job.FEED[i] > 0 ? job.FEED[i] : 1000) : 0;
    const above = side > 0 ? Math.min(z0, z1) - r > H2 : Math.max(z0, z1) + r < -H2;
    if (above) { if (isFeed && L3 > 0) { this.opAir[opI] += L3; this.opAirTime[opI] += ft; } return; }
    if (this.mv) this.mv.fill(0);
    const L = Math.hypot(x1 - x0, y1 - y0);
    const ns = L > 4 * r ? Math.ceil(L / (2 * r)) : 1;
    let depth = 0, vol = 0;
    const chain = op.tilt > 0.5 ? Math.ceil(Math.min(6, Math.max(2, 4 * td.d)) / (0.5 * r)) : 0;
    this.cur = opI;
    for (let c = 0; c <= chain; c++) {
      const sh = c * 0.5 * r, ox = u[0] * sh, oy = u[1] * sh, oz = u[2] * sh;
      if (c > 0) { if (side > 0) { if (Math.min(z0, z1) + oz - r > H2) break; } else if (Math.max(z0, z1) + oz + r < -H2) break; }
      for (let s = 0; s < ns; s++) {
        const ta = s / ns, tb = (s + 1) / ns;
        const o = this.cut(x0 + ox + (x1 - x0) * ta, y0 + oy + (y1 - y0) * ta, z0 + oz + (z1 - z0) * ta, x0 + ox + (x1 - x0) * tb, y0 + oy + (y1 - y0) * tb, z0 + oz + (z1 - z0) * tb, r, ball || c > 0, side, opI + 1);
        if (o) { if (o[0] > depth) depth = o[0]; vol += o[1]; }
      }
    }
    if (vol > 0) {
      this.opVol[opI] += vol; if (depth > this.opDepth[opI]) this.opDepth[opI] = depth;
      if (isFeed) this.opContact[opI] += L3;
      if (!isFeed && depth > 0.02) { this.rapidHitCount++; if (this.rapidHits.length < 500) this.rapidHits.push({ i, line: job.LINE[i], depth, op: opI }); }
      if (this.mv && isFeed) { // temas süresini en çok malzeme alınan parçaya yaz
        let bp = 0; for (let p = 1; p <= this.np; p++) if (this.mv[p] > this.mv[bp]) bp = p;
        this.opPartTime[opI * (this.np + 1) + bp] += ft;
      }
    } else if (isFeed && L3 > 0) { this.opAir[opI] += L3; this.opAirTime[opI] += ft; }
  }
  // süpürülmüş küre (veya düz disk) zarfı ile üst/alt yükseklik haritasını kesme
  cut(xa, ya, za, xb, yb, zb, r, ball, side, opId) {
    const g = this.g, res = g.res, inv = 1 / res;
    const i0 = Math.max(0, Math.floor((Math.min(xa, xb) - r - g.x0) * inv)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(xa, xb) + r - g.x0) * inv));
    const j0 = Math.max(0, Math.floor((Math.min(ya, yb) - r - g.y0) * inv)), j1 = Math.min(g.ny - 1, Math.ceil((Math.max(ya, yb) + r - g.y0) * inv));
    if (i0 > i1 || j0 > j1) return null;
    const vx = xb - xa, vy = yb - ya, vz = zb - za, a = vx * vx + vy * vy, r2 = r * r;
    const sd = side > 0 ? vz : -vz;
    const big = a > 1e-12;
    const k1 = big ? Math.sqrt(a * (a + sd * sd)) : 0;
    const top = this.top, bot = this.bot, mask = this.mask, nx = g.nx, lab = this.lab, W = this.np + 1, cell = res * res;
    let dmax = 0, vol = 0;
    for (let j = j0; j <= j1; j++) {
      const dy = g.y0 + j * res - ya;
      const base = j * nx;
      for (let i = i0; i <= i1; i++) {
        const k = base + i;
        if (mask[k] === 0) continue;
        const dx = g.x0 + i * res - xa;
        let t, hd2;
        if (big) {
          const t0 = (dx * vx + dy * vy) / a;
          const e = dx * dx + dy * dy - a * t0 * t0;
          const R2 = r2 - e;
          if (R2 <= 0) continue;
          if (ball) t = t0 - sd * Math.sqrt(R2) / k1;
          else t = sd < 0 ? t0 + Math.sqrt(R2 / a) : (sd > 0 ? t0 - Math.sqrt(R2 / a) : t0);
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const q = t - t0; hd2 = e + a * q * q;
          if (hd2 >= r2) continue;
        } else {
          hd2 = dx * dx + dy * dy;
          if (hd2 >= r2) continue;
          t = sd < 0 ? 1 : 0;
        }
        const zc = za + vz * t, h = ball ? Math.sqrt(r2 - hd2) : 0;
        let d = 0;
        if (side > 0) {
          const zt = zc - h, old = top[k];
          if (zt < old) {
            const b = bot[k];
            if (old > b) d = old - (zt > b ? zt : b);
            top[k] = zt; this.lastTop[k] = opId;
            if (lab && this.stampTop[k] !== opId) { this.stampTop[k] = opId; this.opPartCells[(opId - 1) * W + lab[k]]++; }
          }
        } else {
          const zt = zc + h, old = bot[k];
          if (zt > old) {
            const tp = top[k];
            if (tp > old) d = (zt < tp ? zt : tp) - old;
            bot[k] = zt; this.lastBot[k] = opId;
            if (lab && this.stampBot[k] !== opId) { this.stampBot[k] = opId; this.opPartCells[(opId - 1) * W + lab[k]]++; }
          }
        }
        if (d > 0) {
          if (d > dmax) dmax = d; vol += d;
          if (lab) { this.opPartVol[(opId - 1) * W + lab[k]] += d * cell; this.mv[lab[k]] += d; }
        }
      }
    }
    return dmax > 0 ? [dmax, vol * cell] : null;
  }
}

// ───────────────────────────── parça tespiti ─────────────────────────────
// Katı kalan hücrelerden, konnektör eşiğinden (S.conn) kalın bölgeleri bileşenlere ayırır; her parçaya hücre etiketi verir.
function detectParts(sim, S) {
  const g = sim.g, nx = g.nx, ny = g.ny, N = nx * ny, res = g.res;
  const solid = new Uint8Array(N);
  for (let k = 0; k < N; k++) solid[k] = (sim.mask[k] && sim.top[k] - sim.bot[k] > 1e-3) ? 1 : 0;
  const D = new Float32Array(N), INF = 1e9;
  for (let k = 0; k < N; k++) D[k] = solid[k] ? INF : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!D[k]) continue; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + 3); if (j > 0) { v = Math.min(v, D[k - nx] + 3); if (i > 0) v = Math.min(v, D[k - nx - 1] + 4); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + 4); }
    D[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; if (!D[k]) continue; let v = D[k];
    if (i < nx - 1) v = Math.min(v, D[k + 1] + 3); if (j < ny - 1) { v = Math.min(v, D[k + nx] + 3); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + 4); if (i > 0) v = Math.min(v, D[k + nx - 1] + 4); }
    D[k] = v;
  }
  const thr = S.conn / res * 3;
  const lab = new Int32Array(N); let nl = 0;
  const comps = [], stack = new Int32Array(N);
  for (let k0 = 0; k0 < N; k0++) {
    if (lab[k0] || D[k0] <= thr) continue;
    nl++; let sp = 0; stack[sp++] = k0; lab[k0] = nl;
    const c = { id: nl, n: 0, uncut: 0, i0: 1e9, i1: -1, j0: 1e9, j1: -1, sx: 0, sy: 0 };
    while (sp) {
      const k = stack[--sp], i = k % nx, j = (k / nx) | 0;
      c.n++; c.sx += i; c.sy += j;
      if (sim.lastTop[k] === 0 && sim.lastBot[k] === 0) c.uncut++;
      if (i < c.i0) c.i0 = i; if (i > c.i1) c.i1 = i; if (j < c.j0) c.j0 = j; if (j > c.j1) c.j1 = j;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii; if (!lab[kk] && D[kk] > thr) { lab[kk] = nl; stack[sp++] = kk; }
      }
    }
    comps.push(c);
  }
  const minCells = 3 / (res * res); // 3 mm²
  const parts = comps.filter((c) => c.uncut < c.n * 0.02 && c.n >= minCells);
  parts.sort((a, c) => (Math.round(-(a.sy / a.n) * res / 15) * 1000 + a.sx / a.n * res) - (Math.round(-(c.sy / c.n) * res / 15) * 1000 + c.sx / c.n * res));
  // gerçek sınırlar: çekirdeği konnektör eşiği kadar geri büyüt, parça hücrelerini etiketle
  const grow = Math.ceil(S.conn / res) + 1;
  const plab = new Uint16Array(N);
  parts.forEach((p, pi) => {
    p.name = 'P' + (pi + 1); p.index = pi + 1;
    let i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1, zt = -1e9, zb = 1e9, rmax = 0, area = 0;
    const I0 = Math.max(0, p.i0 - grow), I1 = Math.min(nx - 1, p.i1 + grow), J0 = Math.max(0, p.j0 - grow), J1 = Math.min(ny - 1, p.j1 + grow);
    for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) {
      const k = j * nx + i; if (!solid[k] || plab[k]) continue;
      let near = lab[k] === p.id;
      for (let dj = -grow; dj <= grow && !near; dj += 1) for (let di = -grow; di <= grow; di += 1) {
        if (di * di + dj * dj > grow * grow) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        if (lab[jj * nx + ii] === p.id) { near = true; break; }
      }
      if (!near) continue;
      plab[k] = p.index; area++;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      if (sim.top[k] > zt) zt = sim.top[k]; if (sim.bot[k] < zb) zb = sim.bot[k];
      const x = g.x0 + i * res, y = g.y0 + j * res; const rr = Math.hypot(x, y); if (rr > rmax) rmax = rr;
    }
    Object.assign(p, {
      x0: g.x0 + i0 * res, x1: g.x0 + i1 * res, y0: g.y0 + j0 * res, y1: g.y0 + j1 * res, ztop: zt, zbot: zb,
      cx: g.x0 + (p.sx / p.n) * res, cy: g.y0 + (p.sy / p.n) * res, area: area * res * res, cells: area, edge: g.R - rmax,
    });
  });
  for (const p of parts) {
    let gap = Infinity;
    for (const q of parts) if (q !== p) {
      const dx = Math.max(0, Math.max(q.x0 - p.x1, p.x0 - q.x1)), dy = Math.max(0, Math.max(q.y0 - p.y1, p.y0 - q.y1));
      gap = Math.min(gap, Math.hypot(dx, dy));
    }
    p.gap = gap;
  }
  return { parts, plab };
}

// ───────────────────────────── rapor ─────────────────────────────
function buildReport(text, name, opts) {
  opts = opts || {};
  const S = Object.assign({}, DEFAULTS, opts.settings || {});
  const t0 = now();
  const job = core.parseNC(text, name);
  const tools = resolveTools(job, S, opts.tools);
  const warnings = prepare(job, tools, S);
  const H = S.H || job.Hauto;
  classifyStages(job, tools);
  for (const op of job.ops) analyzeStepover(job, op, tools[op.tool]);
  const grid = makeGrid(job, tools, S, H);
  // 1. geçiş: son durum → parçalar; 2. geçiş: parça etiketleriyle hacim/temas/kapsama dağılımı
  const sim1 = new Sim(job, tools, S, grid); sim1.run();
  const { parts, plab } = detectParts(sim1, S);
  const sim = new Sim(job, tools, S, grid, plab, parts.length); sim.run();
  const W = parts.length + 1;

  // operasyonlar
  const ops = job.ops.filter((o) => o.nF > 0 || o.rap > 0).map((o) => {
    const td = tools[o.tool];
    const feeds = [...o.feeds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    const perPart = parts.map((p) => ({ part: p.name, vol: sim.opPartVol[o.idx * W + p.index], time: sim.opPartTime[o.idx * W + p.index], coverage: sim.opPartCells[o.idx * W + p.index] / p.cells }));
    return {
      idx: o.idx + 1, tool: o.tool, toolLabel: td ? td.label : '–', stage: o.stage, stageName: STAGES[o.stage], stageSrc: o.stageSrc,
      side: o.side, sideName: SIDE_NAMES[o.side] + (o.tilt > 0.5 && o.side !== 0 ? ` eğik ${o.tilt.toFixed(1)}°` : ''), A: o.A, B: o.B, S: o.S,
      line: o.line + 1, moves: o.end - o.start, strategy: o.kind, time: o.time, cutTime: o.cutTime, cut: o.cut, rapid: o.rap, feeds,
      zStep: o.zStep, zLevels: o.zLevels, stepover: o.stepover, scallop: o.scallop, scallopRating: rating(o.scallop),
      vol: sim.opVol[o.idx], maxDepth: sim.opDepth[o.idx], contact: sim.opContact[o.idx], air: sim.opAir[o.idx], airTime: sim.opAirTime[o.idx],
      airRatio: o.cut > 0 ? sim.opAir[o.idx] / o.cut : 0, rest: perPart.filter((q) => q.vol > 0 || q.coverage > 0).length,
      zRange: [o.bbox[2], o.bbox[5]], perPart,
      outsideVol: sim.opPartVol[o.idx * W],
    };
  });
  const opByIdx = new Map(ops.map((o) => [o.idx - 1, o]));

  // takımlar
  const toolRows = Object.values(tools).map((td) => {
    const mine = ops.filter((o) => o.tool === td.tool);
    return {
      tool: td.tool, label: td.label, type: td.type, typeName: TOOL_TYPES[td.type], d: td.d, src: td.src, conf: td.conf, note: td.note,
      ops: mine.map((o) => o.idx), stages: [...new Set(mine.map((o) => o.stage))], sides: [...new Set(mine.map((o) => o.sideName))],
      time: sum(mine, 'time'), cut: sum(mine, 'cut'), vol: sum(mine, 'vol'), air: sum(mine, 'air'), maxDepth: Math.max(0, ...mine.map((o) => o.maxDepth)),
      S: Math.max(0, ...mine.map((o) => o.S || 0)),
    };
  });

  // yüz × aşama
  const sides = [1, -1, 0].map((sd) => {
    const mine = ops.filter((o) => o.side === sd && o.cut > 0);
    if (!mine.length) return null;
    return {
      side: sd, name: SIDE_NAMES[sd], time: sum(mine, 'time'), vol: sum(mine, 'vol'), cut: sum(mine, 'cut'),
      stages: STAGE_ORDER.map((st) => {
        const so = mine.filter((o) => o.stage === st);
        if (!so.length) return null;
        return { stage: st, name: STAGES[st], ops: so.map((o) => o.idx), tools: [...new Set(so.map((o) => 'T' + o.tool + ' ' + o.toolLabel))], time: sum(so, 'time'), vol: sum(so, 'vol'), cut: sum(so, 'cut'), air: sum(so, 'air'), maxDepth: Math.max(...so.map((o) => o.maxDepth)) };
      }).filter(Boolean),
    };
  }).filter(Boolean);

  // parçalar: her yüzde son yüzeyi bırakan aşama/operasyon dağılımı
  const g = grid, N = g.nx * g.ny;
  const partRows = parts.map((p) => {
    const surf = { 1: new Map(), '-1': new Map() };
    let untTop = 0, untBot = 0;
    for (let k = 0; k < N; k++) {
      if (plab[k] !== p.index) continue;
      const lt = sim.lastTop[k], lb = sim.lastBot[k];
      if (lt) surf[1].set(lt - 1, (surf[1].get(lt - 1) || 0) + 1); else untTop++;
      if (lb) surf['-1'].set(lb - 1, (surf['-1'].get(lb - 1) || 0) + 1); else untBot++;
    }
    const sideInfo = (sd, m, unt) => {
      const byStage = {}, byOp = [];
      for (const [oi, c] of m) {
        const o = opByIdx.get(oi); const st = o ? o.stage : 'diger';
        byStage[st] = (byStage[st] || 0) + c / p.cells;
        byOp.push({ op: oi + 1, tool: o ? o.tool : 0, stage: st, share: c / p.cells });
      }
      byOp.sort((a, b) => b.share - a.share);
      const sideOps = ops.filter((o) => o.side === sd);
      return {
        side: sd, name: SIDE_NAMES[sd], untouched: unt / p.cells, finalSurface: byStage, finalByOp: byOp,
        stages: STAGE_ORDER.map((st) => {
          const so = sideOps.filter((o) => o.stage === st);
          if (!so.length) return null;
          const pp = so.map((o) => o.perPart[p.index - 1]);
          return { stage: st, name: STAGES[st], vol: sum(pp, 'vol'), time: sum(pp, 'time'), coverage: Math.max(...pp.map((q) => q.coverage)), ops: so.map((o) => o.idx) };
        }).filter(Boolean),
      };
    };
    const tl = new Set();
    for (const o of ops) if (o.perPart[p.index - 1].coverage > 0) tl.add(o.tool);
    return {
      name: p.name, cx: p.cx, cy: p.cy, sizeX: p.x1 - p.x0, sizeY: p.y1 - p.y0, ztop: p.ztop, zbot: p.zbot, height: p.ztop - p.zbot,
      area: p.area, edge: p.edge, gap: p.gap, tools: [...tl].sort((a, b) => a - b),
      vol: ops.reduce((s, o) => s + o.perPart[p.index - 1].vol, 0), time: ops.reduce((s, o) => s + o.perPart[p.index - 1].time, 0),
      sides: [sideInfo(1, surf[1], untTop), sideInfo(-1, surf['-1'], untBot)],
    };
  });

  // uyarılar
  for (const td of Object.values(tools)) if (/Varsayılan/.test(td.src)) warnings.push({ lvl: 'warn', t: `T${td.tool}: çap NC dosyasından çıkarılamadı, varsayılan ${td.label} kullanıldı. Hacim, derinlik ve kapsama değerleri bu takıma bağlıdır; doğru takımı girin.` });
  for (const td of Object.values(tools)) if (td.conf === 'düşük' || td.conf === 'orta') warnings.push({ lvl: 'info', t: `T${td.tool} ${td.label}: çap tanıma güveni ${td.conf} — ${td.note || ''}` });
  if (sim.rapidHits.length) {
    const byOp = new Map(); for (const h of sim.rapidHits) byOp.set(h.op, (byOp.get(h.op) || 0) + 1);
    warnings.push({ lvl: 'bad', t: `${fmtInt(sim.rapidHitCount)} hızlı (G0) hareket malzemeye giriyor (çarpma riski). İlk satır: ${sim.rapidHits[0].line + 1}, maks. ${fmt(Math.max(...sim.rapidHits.map((h) => h.depth)), 3)} mm. Operasyonlar: ${[...byOp.keys()].map((k) => k + 1).join(', ')}` });
  }
  for (const pr of partRows) for (const sd of pr.sides) {
    if (sd.untouched > 0.02) warnings.push({ lvl: 'warn', t: `${pr.name} ${sd.name}: yüzeyin ${pct(sd.untouched)}'i hiç işlenmemiş (ham disk yüzeyi).` });
    const k = sd.finalSurface.kaba || 0;
    if (k > 0.02) warnings.push({ lvl: 'warn', t: `${pr.name} ${sd.name}: yüzeyin ${pct(k)}'i kaba işleme izinde kalmış (ince/artık takım bu bölgelere değmiyor).` });
  }
  for (const o of ops) {
    const td = tools[o.tool];
    if (td && (o.stage === 'ince' || o.stage === 'artik') && o.maxDepth > Math.max(td.d, 0.5)) warnings.push({ lvl: 'warn', t: `Op ${o.idx} (T${o.tool} ${td.label}, ${o.stageName}): ${fmt(o.maxDepth, 2)} mm talaş derinliği takım çapından büyük; önceki aşama bu bölgeyi boşaltmamış (kırılma riski).` });
  }
  for (const o of ops) if (o.cut > 5 && o.airRatio > 0.6) warnings.push({ lvl: 'info', t: `Op ${o.idx} (T${o.tool}, ${o.stageName}): kesme yolunun ${pct(o.airRatio)}'i havada (malzemeye değmiyor).` });
  for (const nt of job.notes) warnings.push(nt);

  const totalVol = sum(ops, 'vol');
  return {
    file: name, generatedAt: new Date().toISOString(), cam: job.cam || [], dialect: job.dialect || 'iso', lines: job.lines.length, moves: job.n,
    settings: { discD: S.discD, H, Hauto: job.Hauto, res: S.res, ref: S.ref, rapid: S.rapid, conn: S.conn, grid: [g.nx, g.ny] },
    summary: {
      time: job.totalTime, cutLen: job.totalCut, rapidLen: job.totalRapid, vol: totalVol, ops: ops.length, tools: toolRows.length, parts: partRows.length,
      outsidePartsVol: sum(ops, 'outsideVol'), airLen: sum(ops, 'air'), rapidHits: sim.rapidHitCount, dwell: job.dwellTime || 0,
    },
    tools: toolRows, sides, ops: ops.map((o) => { const c = Object.assign({}, o); return c; }), parts: partRows, warnings,
    elapsedMs: Math.round(now() - t0),
  };
}
function sum(a, k) { let s = 0; for (const x of a) s += x[k] || 0; return s; }

// ───────────────────────────── metin çıktısı ─────────────────────────────
function table(head, rows) {
  const all = [head, ...rows].map((r) => r.map((c) => String(c)));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [line(all[0]), w.map((x) => '-'.repeat(x)).join('  '), ...all.slice(1).map(line)].join('\n');
}
function shareTxt(m) { return STAGE_ORDER.filter((s) => m[s]).map((s) => `${STAGES[s].split(' ')[0]} ${pct(m[s])}`).join(', ') || '–'; }

function toText(R) {
  const s = R.summary, o = [];
  o.push(`DETAYLI KAZIMA RAPORU — ${R.file}`);
  o.push(`Oluşturma: ${R.generatedAt}${R.cam.length ? '   CAM: ' + R.cam.join(', ') : ''}   Biçim: ${R.dialect === 'heidenhain' ? 'Heidenhain' : 'ISO G-kod'}`);
  o.push(`Disk Ø${R.settings.discD} mm, kalınlık ${R.settings.H} mm${R.settings.H === R.settings.Hauto ? ' (otomatik)' : ''}, simülasyon ızgarası ${R.settings.res} mm (${R.settings.grid.join('×')})`);
  o.push('');
  o.push('GENEL');
  o.push(`  Toplam süre: ${fmtTime(s.time)}   Kesme yolu: ${fmtInt(s.cutLen)} mm   Hızlı yol: ${fmtInt(s.rapidLen)} mm   Havada kesme: ${fmtInt(s.airLen)} mm`);
  o.push(`  Kaldırılan hacim: ${fmt(s.vol / 1000, 3)} cm³ (parça dışı/kanal: ${fmt(s.outsidePartsVol / 1000, 3)} cm³)   Operasyon: ${s.ops}   Takım: ${s.tools}   Parça: ${s.parts}   G0 çarpma: ${s.rapidHits}`);
  o.push('');
  o.push('TAKIMLAR');
  o.push(table(['Takım', 'Tip / çap', 'Kaynak', 'Aşamalar', 'Yüzler', 'Süre', 'Kesme mm', 'Hacim mm³', 'Maks. talaş', 'Devir'],
    R.tools.map((t) => [`T${t.tool}`, t.label, t.src + (t.conf ? ` (güven: ${t.conf})` : ''), t.stages.map((x) => STAGES[x].split(' ')[0]).join('/'), t.sides.join(', '), fmtTime(t.time), fmtInt(t.cut), fmt(t.vol, 1), fmt(t.maxDepth, 3), fmtInt(t.S)])));
  o.push('');
  o.push('YÜZ VE AŞAMA ÖZETİ');
  for (const sd of R.sides) {
    o.push(`  ${sd.name}: süre ${fmtTime(sd.time)}, hacim ${fmt(sd.vol, 1)} mm³, kesme ${fmtInt(sd.cut)} mm`);
    o.push(table(['    Aşama', 'Takımlar', 'Op', 'Süre', 'Kesme mm', 'Havada mm', 'Hacim mm³', 'Maks. talaş'],
      sd.stages.map((st) => ['    ' + st.name, st.tools.join(', '), st.ops.join(','), fmtTime(st.time), fmtInt(st.cut), fmtInt(st.air), fmt(st.vol, 1), fmt(st.maxDepth, 3)])));
  }
  o.push('');
  o.push('OPERASYONLAR');
  o.push(table(['Op', 'Satır', 'Takım', 'Aşama', 'Yüz', 'Strateji', 'Süre', 'Kesme mm', 'Havada', 'Hacim mm³', 'Maks. talaş', 'Z adımı', 'Yanal adım', 'Scallop µm', 'F', 'S'],
    R.ops.map((x) => [x.idx, x.line, `T${x.tool} ${x.toolLabel}`, STAGES[x.stage].split(' ')[0], x.sideName, x.strategy + (x.zLevels > 1 ? ` (${x.zLevels} seviye)` : ''), fmtTime(x.time), fmtInt(x.cut), pct(x.airRatio, 0), fmt(x.vol, 1), fmt(x.maxDepth, 3), fmt(x.zStep, 3), fmt(x.stepover, 3), isFinite(x.scallop) ? (x.scallop >= 999 ? '>çap' : fmt(x.scallop, 2) + ' ' + x.scallopRating) : '–', x.feeds.join('/'), fmtInt(x.S)])));
  o.push('  Aşama kaynağı: ' + R.ops.map((x) => `Op${x.idx}=${x.stageSrc}`).join('; '));
  o.push('');
  o.push('PARÇALAR');
  if (!R.parts.length) o.push('  Parça bulunamadı.');
  for (const p of R.parts) {
    o.push(`  ${p.name}: merkez (${fmt(p.cx, 2)}, ${fmt(p.cy, 2)}) mm, boyut ${fmt(p.sizeX, 2)}×${fmt(p.sizeY, 2)} mm, Z ${fmt(p.zbot, 2)}…${fmt(p.ztop, 2)} (yükseklik ${fmt(p.height, 2)} mm), alan ${fmt(p.area, 1)} mm²`);
    o.push(`      Disk kenarına ${fmt(p.edge, 2)} mm, komşuya ${isFinite(p.gap) ? fmt(p.gap, 2) + ' mm' : '–'}; takımlar T${p.tools.join(', T')}; kaldırılan ${fmt(p.vol, 1)} mm³, temas süresi ${fmtTime(p.time)}`);
    for (const sd of p.sides) {
      o.push(`      ${sd.name}: son yüzey → ${shareTxt(sd.finalSurface)}${sd.untouched > 0.0005 ? `, işlenmemiş ${pct(sd.untouched)}` : ''}`);
      for (const st of sd.stages) o.push(`        ${st.name.padEnd(22)} op ${st.ops.join(',').padEnd(6)} kapsama ${pct(st.coverage).padStart(6)}  hacim ${fmt(st.vol, 1).padStart(8)} mm³  temas ${fmtTime(st.time)}`);
    }
  }
  o.push('');
  o.push('UYARILAR VE NOTLAR');
  if (!R.warnings.length) o.push('  Yok.');
  for (const w of R.warnings) o.push(`  [${w.lvl === 'bad' ? 'HATA' : w.lvl === 'warn' ? 'UYARI' : 'BİLGİ'}] ${w.t}`);
  o.push('');
  o.push('Notlar: Hacimler ızgara simülasyonundan (üst/alt yükseklik haritası) hesaplanır; kapsama, parçanın o yüzündeki hücrelerden takımın değdiği oran;');
  o.push('"son yüzey", her hücrede yüzeyi en son kesen aşamadır (kaba payı kalan yerler "Kaba" görünür). Eğik (>75°) operasyonlar simüle edilmez.');
  return o.join('\n');
}

// ───────────────────────────── HTML çıktısı ─────────────────────────────
function toHTML(R) {
  const s = R.summary;
  const tbl = (head, rows) => `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const card = (k, v, sub) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const stageBar = (m, unt) => {
    const seg = STAGE_ORDER.filter((x) => m[x]).map((x) => `<span class="st-${x}" style="width:${(100 * m[x]).toFixed(2)}%" title="${esc(STAGES[x])} ${pct(m[x])}"></span>`).join('');
    return `<div class="bar">${seg}${unt > 0 ? `<span class="st-raw" style="width:${(100 * unt).toFixed(2)}%" title="İşlenmemiş ${pct(unt)}"></span>` : ''}</div>`;
  };
  const h = [];
  h.push(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kazıma Raporu</title><style>
:root{--bg:#fff;--fg:#1d2433;--mut:#5c6578;--line:#dfe3ea;--card:#f5f7fa;--kaba:#e8590c;--ince:#2b8a3e;--artik:#1971c2;--diger:#868e96;--raw:#c9ccd1;--bad:#c92a2a;--warn:#e67700;--info:#1971c2}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#14171c;--fg:#e6e9ef;--mut:#9aa3b2;--line:#2c323c;--card:#1c2027;--raw:#4a4f57}}
:root[data-theme="dark"]{--bg:#14171c;--fg:#e6e9ef;--mut:#9aa3b2;--line:#2c323c;--card:#1c2027;--raw:#4a4f57}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font-size:14px;margin:14px 0 6px}
.mut{color:var(--mut)}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.card{background:var(--card);border-radius:8px;padding:8px 10px}.card .k{color:var(--mut);font-size:12px}.card .v{font-size:18px;font-weight:600}.card .s{color:var(--mut);font-size:11px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-weight:600}
.pill{display:inline-block;padding:0 6px;border-radius:9px;color:#fff;font-size:11px}.p-kaba{background:var(--kaba)}.p-ince{background:var(--ince)}.p-artik{background:var(--artik)}.p-diger{background:var(--diger)}
.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--line);min-width:160px}.bar span{display:block;height:100%}.st-kaba{background:var(--kaba)}.st-ince{background:var(--ince)}.st-artik{background:var(--artik)}.st-diger{background:var(--diger)}.st-raw{background:var(--raw)}
.part{background:var(--card);border-radius:8px;padding:10px 12px;margin:8px 0}.w{padding:4px 8px;border-left:3px solid var(--info);margin:4px 0}.w.bad{border-color:var(--bad)}.w.warn{border-color:var(--warn)}
.legend span{margin-right:12px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
</style></head><body><main>`);
  h.push(`<h1>Detaylı Kazıma Raporu</h1><div class="mut">${esc(R.file)} · ${esc(R.generatedAt)}${R.cam.length ? ' · CAM: ' + esc(R.cam.join(', ')) : ''} · Disk Ø${R.settings.discD} mm, kalınlık ${R.settings.H} mm · ızgara ${R.settings.res} mm</div>`);
  h.push('<h2>Genel</h2><div class="cards">' + [
    card('Toplam süre', fmtTime(s.time)), card('Kaldırılan hacim', fmt(s.vol / 1000, 3) + ' cm³', `parça dışı ${fmt(s.outsidePartsVol / 1000, 3)} cm³`),
    card('Kesme yolu', fmtInt(s.cutLen) + ' mm', `havada ${fmtInt(s.airLen)} mm`), card('Hızlı yol', fmtInt(s.rapidLen) + ' mm'),
    card('Operasyon', s.ops), card('Takım', s.tools), card('Parça', s.parts), card('G0 çarpma', s.rapidHits),
  ].join('') + '</div>');
  if (R.warnings.length) h.push('<h2>Uyarılar ve notlar</h2>' + R.warnings.map((w) => `<div class="w ${w.lvl}">${esc(w.t)}</div>`).join(''));
  h.push('<h2>Takımlar</h2>' + tbl(['Takım', 'Tip / çap', 'Çap kaynağı', 'Aşamalar', 'Yüzler', 'Süre', 'Kesme (mm)', 'Hacim (mm³)', 'Maks. talaş (mm)', 'Devir'],
    R.tools.map((t) => [`<b>T${t.tool}</b>`, esc(t.label), esc(t.src) + (t.conf ? ` <span class="mut">(güven: ${esc(t.conf)})</span>` : '') + (t.note ? `<div class="mut" style="white-space:normal;max-width:420px">${esc(t.note)}</div>` : ''), t.stages.map((x) => `<span class="pill p-${x}">${esc(STAGES[x].split(' ')[0])}</span>`).join(' '), esc(t.sides.join(', ')), fmtTime(t.time), fmtInt(t.cut), fmt(t.vol, 1), fmt(t.maxDepth, 3), fmtInt(t.S)])));
  h.push('<h2>Yüz ve aşama özeti</h2>');
  for (const sd of R.sides) {
    h.push(`<h3>${esc(sd.name)} <span class="mut">· ${fmtTime(sd.time)} · ${fmt(sd.vol, 1)} mm³</span></h3>`);
    h.push(tbl(['Aşama', 'Takımlar', 'Operasyonlar', 'Süre', 'Kesme (mm)', 'Havada (mm)', 'Hacim (mm³)', 'Maks. talaş (mm)'],
      sd.stages.map((st) => [`<span class="pill p-${st.stage}">${esc(st.name)}</span>`, esc(st.tools.join(', ')), st.ops.join(', '), fmtTime(st.time), fmtInt(st.cut), fmtInt(st.air), fmt(st.vol, 1), fmt(st.maxDepth, 3)])));
  }
  h.push('<h2>Parçalar</h2><div class="legend mut">' + STAGE_ORDER.slice(0, 3).map((x) => `<span><i class="st-${x}"></i>${esc(STAGES[x])}</span>`).join('') + '<span><i class="st-raw"></i>İşlenmemiş</span> — çubuk: yüzeyi en son hangi aşamanın bıraktığı</div>');
  if (!R.parts.length) h.push('<div class="mut">Parça bulunamadı.</div>');
  for (const p of R.parts) {
    h.push(`<div class="part"><b>${esc(p.name)}</b> <span class="mut">merkez (${fmt(p.cx, 2)}, ${fmt(p.cy, 2)}) · ${fmt(p.sizeX, 2)}×${fmt(p.sizeY, 2)} mm · yükseklik ${fmt(p.height, 2)} mm (Z ${fmt(p.zbot, 2)}…${fmt(p.ztop, 2)}) · alan ${fmt(p.area, 1)} mm² · kenara ${fmt(p.edge, 2)} mm · komşuya ${isFinite(p.gap) ? fmt(p.gap, 2) + ' mm' : '–'} · T${p.tools.join(', T')} · ${fmt(p.vol, 1)} mm³ · temas ${fmtTime(p.time)}</span>`);
    h.push(tbl(['Yüz', 'Son yüzey', 'Dağılım', 'Aşama', 'Op', 'Kapsama', 'Hacim (mm³)', 'Temas'],
      p.sides.flatMap((sd) => (sd.stages.length ? sd.stages : [{ name: '–', ops: [], coverage: NaN, vol: NaN, time: NaN, stage: 'diger' }]).map((st, i) => [
        i ? '' : esc(sd.name), i ? '' : stageBar(sd.finalSurface, sd.untouched), i ? '' : esc(shareTxt(sd.finalSurface) + (sd.untouched > 0.0005 ? `, işlenmemiş ${pct(sd.untouched)}` : '')),
        `<span class="pill p-${st.stage}">${esc(st.name)}</span>`, st.ops.join(', '), pct(st.coverage), fmt(st.vol, 1), fmtTime(st.time)]))));
    h.push('</div>');
  }
  h.push('<h2>Operasyonlar</h2>' + tbl(['Op', 'Satır', 'Takım', 'Aşama', 'Yüz', 'Strateji', 'Süre', 'Kesme (mm)', 'Havada', 'Hacim (mm³)', 'Maks. talaş', 'Z adımı', 'Yanal adım', 'Scallop', 'F (mm/dk)', 'S'],
    R.ops.map((x) => [x.idx, x.line, `T${x.tool} ${esc(x.toolLabel)}`, `<span class="pill p-${x.stage}" title="${esc(x.stageSrc)}">${esc(STAGES[x.stage].split(' ')[0])}</span>`, esc(x.sideName), esc(x.strategy) + (x.zLevels > 1 ? ` <span class="mut">(${x.zLevels} sev.)</span>` : ''), fmtTime(x.time), fmtInt(x.cut), pct(x.airRatio, 0), fmt(x.vol, 1), fmt(x.maxDepth, 3), fmt(x.zStep, 3), fmt(x.stepover, 3), isFinite(x.scallop) ? (x.scallop >= 999 ? '&gt; çap' : fmt(x.scallop, 2) + ' µm ' + esc(x.scallopRating)) : '–', x.feeds.join('/'), fmtInt(x.S)])));
  h.push(`<p class="mut">Hacimler ızgara simülasyonundan (üst/alt yükseklik haritası, ${R.settings.res} mm) hesaplanır. Kapsama: parçanın o yüzündeki hücrelerden aşamanın değdiği oran. Son yüzey: her hücrede yüzeyi en son kesen aşama; kaba payı kalan yerler “Kaba” görünür. Eğik (&gt;75°) operasyonlar simüle edilmez. Rapor ${R.elapsedMs} ms'de üretildi.</p>`);
  h.push('</main></body></html>');
  return h.join('\n');
}

// ───────────────────────────── CSV ─────────────────────────────
function toCSV(R) {
  const q = (v) => { const s = v == null ? '' : typeof v === 'number' ? (isFinite(v) ? String(+v.toFixed(4)).replace('.', ',') : '') : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Kayıt', 'Parça', 'Yüz', 'Aşama', 'Op', 'Takım', 'Çap (mm)', 'Süre (dk)', 'Kesme (mm)', 'Havada (mm)', 'Hacim (mm³)', 'Kapsama', 'Maks. talaş (mm)', 'Z adımı', 'Yanal adım', 'Scallop (µm)']];
  for (const o of R.ops) {
    const td = R.tools.find((t) => t.tool === o.tool);
    rows.push(['Operasyon', '', o.sideName, STAGES[o.stage], o.idx, 'T' + o.tool, td ? td.d : '', o.time, o.cut, o.air, o.vol, '', o.maxDepth, o.zStep, o.stepover, o.scallop]);
    for (const pp of o.perPart) if (pp.vol > 0 || pp.coverage > 0) rows.push(['Operasyon×Parça', pp.part, o.sideName, STAGES[o.stage], o.idx, 'T' + o.tool, td ? td.d : '', pp.time, '', '', pp.vol, pp.coverage, '', '', '', '']);
  }
  for (const p of R.parts) for (const sd of p.sides) for (const st of STAGE_ORDER) if (sd.finalSurface[st]) rows.push(['Son yüzey', p.name, sd.name, STAGES[st], '', '', '', '', '', '', '', sd.finalSurface[st], '', '', '', '']);
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}

return { DEFAULTS, STAGES, buildReport, toText, toHTML, toCSV, resolveTools, classifyStages, fmtTime };
});
