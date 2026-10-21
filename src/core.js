/* Dental NC Simülatörü — ÇEKİRDEK (DOM'suz; tarayıcıda window.NCCore, Node'da require ile kullanılır)
 *
 *  - NC ayrıştırıcı (G00-G03, G90/G91, G20/G21, G17-19, G200 P / T M6, A/B döner eksenler, G28/G30/G53),
 *    yorumlar ve takım değişimi satırları da toplanır
 *  - TAKIM ÇAPI TANIMA: hyperDENT NC dosyalarında çap yazmaz (yalnızca G200 Pxx). Çap şu sırayla bulunur:
 *      1) NC yorumu (başka CAM'ler "(T4 D=1.0 KUGEL)" gibi yazar)
 *      2) Takım yolu eğriliği: bilye uç keskin bir dış kenarın üzerinden geçerken uç noktası tam olarak
 *         takım yarıçapında bir yay çizer; yolun en küçük dış (dışbükey) yay yarıçapı = takım yarıçapı
 *      3) Takımlar arası tutarlılık: aynı yüzeyi işleyen iki bilye takımda büyük takımın merkezi, küçük takımın
 *         merkez yüzeyinin (R−r) kadar genişletilmişinin altına inemez (oyuk açmama). Çapı bilinen takıma göre
 *         bilinmeyen takım için en büyük / en küçük tutarlı standart çap seçilir
 *      4) Hiçbiri yoksa takım numarasına göre başlangıç tahmini (kullanıcı düzeltmeli)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NCCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// diş hekimliği frezelerinde yaygın çaplar (tahminler buna yuvarlanır)
const STD_DIAMETERS = [0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0];
// hyperDENT'te yaygın kullanılan takım numaraları için yalnızca son çare tahmin — kullanıcı düzeltmeli
const DEFAULT_TOOLS = {
  4: { type: 'ball', d: 1.5 }, 5: { type: 'ball', d: 2.0 }, 6: { type: 'ball', d: 0.6 }, 7: { type: 'ball', d: 1.0 },
  1: { type: 'ball', d: 2.0 }, 2: { type: 'ball', d: 1.0 }, 3: { type: 'ball', d: 0.6 }, 8: { type: 'ball', d: 0.3 }, 9: { type: 'flat', d: 2.0 } };

// ───────────────────────────── NC ayrıştırıcı ─────────────────────────────
function parseNC(text, name) {
  const lines = text.split(/\r\n|\n|\r/);
  let cap = lines.length + 1024;
  let MX = new Float32Array(cap), MY = new Float32Array(cap), MZ = new Float32Array(cap);
  let TYPE = new Uint8Array(cap), FEED = new Float32Array(cap), LINE = new Int32Array(cap), OP = new Uint16Array(cap);
  let n = 0;
  function grow() {
    cap = Math.ceil(cap * 1.5);
    const g = (A, C) => { const b = new C(cap); b.set(A); return b; };
    MX = g(MX, Float32Array); MY = g(MY, Float32Array); MZ = g(MZ, Float32Array); TYPE = g(TYPE, Uint8Array);
    FEED = g(FEED, Float32Array); LINE = g(LINE, Int32Array); OP = g(OP, Uint16Array);
  }
  const ops = [];
  const st = { x: 0, y: 0, z: 50, a: 0, b: 0, f: 0, s: 0, tool: 0, pendT: 0, motion: 0, abs: true, scale: 1, plane: 17, spindle: false };
  let newOp = true, maxDec = 0, opLabel = '';
  let homeCount = 0;
  const SAFE_Z = 100; // G28/G30/G53 sonrası "makine sıfırında" kabul edilen güvenli yükseklik
  const gSeen = new Set(), mSeen = new Set(), notes = [], comments = [], toolChanges = [];
  let simult = 0, arcCount = 0, firstRapidZ = {}; // yön (A) başına malzemeye ilk yaklaşma
  let cutStarted = {};
  const re = /([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;

  function addMove(x, y, z, type, li) {
    if (newOp || ops.length === 0) {
      if (ops.length) ops[ops.length - 1].end = n;
      ops.push({ idx: ops.length, tool: st.tool, A: st.a, B: st.b, S: st.s, start: n, end: n, line: li, label: opLabel });
      newOp = false;
      if (ops.length > 65000) throw new Error('Çok fazla operasyon');
    }
    if (n >= cap) grow();
    MX[n] = x; MY[n] = y; MZ[n] = z; TYPE[n] = type; FEED[n] = st.f; LINE[n] = li; OP[n] = ops.length - 1; n++;
  }

  for (let li = 0; li < lines.length; li++) {
    let s = lines[li];
    if (!s) continue;
    if (s.indexOf('(') >= 0) {
      // WorkNC / diğer CAM'ler: "(Operation 5)" yorumu yeni operasyon başlatır
      const om = /\(\s*(operation|operasyon|op)\s*[:#]?\s*(\d+)[^)]*\)/i.exec(s);
      if (om) { newOp = true; opLabel = 'Op ' + om[2]; }
      // yorumlar takım çapı bilgisi taşıyabilir (CAM'e göre): sakla
      s = s.replace(/\(([^)]*)\)?/g, (_, c) => { if (c && c.trim()) comments.push({ line: li, text: c.trim() }); return ' '; });
    }
    const sc = s.indexOf(';'); if (sc >= 0) { const c = s.slice(sc + 1).trim(); if (c) comments.push({ line: li, text: c }); s = s.slice(0, sc); }
    s = s.trim();
    if (!s || s[0] === '%') continue;
    re.lastIndex = 0;
    let m, X, Y, Z, A, B, I, J, R, P, F, S, T;
    const G = [], M = [];
    while ((m = re.exec(s))) {
      const L = m[1].toUpperCase(), v = parseFloat(m[2]);
      switch (L) {
        case 'G': G.push(v); break;
        case 'M': M.push(v); break;
        case 'X': X = v; break; case 'Y': Y = v; break; case 'Z': Z = v; break;
        case 'A': A = v; break; case 'B': B = v; break;
        case 'I': I = v; break; case 'J': J = v; break; case 'R': R = v; break;
        case 'P': P = v; break; case 'F': F = v; break; case 'S': S = v; break; case 'T': T = v; break;
        default: break;
      }
      if (L === 'X' || L === 'Y' || L === 'Z') { const d = m[2].indexOf('.'); if (d >= 0) maxDec = Math.max(maxDec, m[2].length - d - 1); }
    }
    let toolChange = false;
    for (const g of G) {
      gSeen.add(g);
      if (g === 0 || g === 1 || g === 2 || g === 3) st.motion = g;
      else if (g === 90) st.abs = true; else if (g === 91) st.abs = false;
      else if (g === 20) st.scale = 25.4; else if (g === 21) st.scale = 1;
      else if (g === 17 || g === 18 || g === 19) st.plane = g;
      else if (g === 200) { st.tool = P != null ? Math.round(P) : 0; toolChange = true; }
    }
    for (const mm of M) {
      mSeen.add(mm);
      if (mm === 6) { st.tool = T != null ? Math.round(T) : st.pendT; toolChange = true; }
      else if (mm === 3 || mm === 4) st.spindle = true; else if (mm === 5) st.spindle = false;
    }
    if (T != null && M.indexOf(6) < 0) st.pendT = Math.round(T);
    if (toolChange) { newOp = true; toolChanges.push({ tool: st.tool, line: li }); }
    if (F != null) st.f = F * st.scale;
    if (S != null) st.s = S;
    if (G.indexOf(200) >= 0) continue; // G200 Pxx satırı yalnızca takım değişimi
    if (G.indexOf(4) >= 0) continue;   // G04 bekleme (X/P süre değeri koordinat değildir)
    // G28/G30 referans noktasına dönüş, G53 makine koordinatı: takım makine sıfırına (en üste) çıkar.
    // Bu koordinatlar iş parçası (G54) sistemi değildir; önce Z güvenli yüksekliğe kalkar, XY korunur.
    if (G.indexOf(28) >= 0 || G.indexOf(30) >= 0 || G.indexOf(53) >= 0) {
      if (X != null || Y != null || Z != null) {
        homeCount++;
        if (st.z < SAFE_Z) addMove(st.x, st.y, SAFE_Z, 0, li);
        st.z = SAFE_Z;
      }
      continue;
    }
    const hasXYZ = X != null || Y != null || Z != null;
    if (A != null || B != null) {
      if (A != null) st.a = A; if (B != null) st.b = B;
      newOp = true;
      if (hasXYZ) simult++;
    }
    if (!hasXYZ) continue;
    const sx = st.x, sy = st.y, sz = st.z;
    let tx = sx, ty = sy, tz = sz;
    if (st.abs) { if (X != null) tx = X * st.scale; if (Y != null) ty = Y * st.scale; if (Z != null) tz = Z * st.scale; }
    else { if (X != null) tx += X * st.scale; if (Y != null) ty += Y * st.scale; if (Z != null) tz += Z * st.scale; }
    if ((st.motion === 2 || st.motion === 3) && st.plane === 17 && (I != null || J != null || R != null)) {
      arcCount++;
      let cx, cy;
      if (I != null || J != null) { cx = sx + (I || 0) * st.scale; cy = sy + (J || 0) * st.scale; }
      else {
        const rr = R * st.scale, mx = (sx + tx) / 2, my = (sy + ty) / 2, dx = tx - sx, dy = ty - sy, q = Math.hypot(dx, dy);
        const h = Math.sqrt(Math.max(0, rr * rr - q * q / 4)), sgn = ((st.motion === 2) === (rr > 0)) ? -1 : 1;
        cx = mx + sgn * h * (-dy) / (q || 1); cy = my + sgn * h * dx / (q || 1);
      }
      const r = Math.hypot(sx - cx, sy - cy);
      let a0 = Math.atan2(sy - cy, sx - cx), a1 = Math.atan2(ty - cy, tx - cx);
      let sweep = a1 - a0;
      if (st.motion === 2) { if (sweep >= -1e-9) sweep -= 2 * Math.PI; } else { if (sweep <= 1e-9) sweep += 2 * Math.PI; }
      const dth = 2 * Math.acos(Math.max(-1, 1 - 0.001 / Math.max(r, 1e-3)));
      const nseg = Math.min(2000, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(dth, 1e-3))));
      for (let k = 1; k <= nseg; k++) {
        const t = k / nseg, an = a0 + sweep * t;
        addMove(k === nseg ? tx : cx + r * Math.cos(an), k === nseg ? ty : cy + r * Math.sin(an), sz + (tz - sz) * t, 1, li);
      }
    } else {
      const type = st.motion === 0 ? 0 : 1;
      // diske ilk yaklaşma yüksekliği (kalınlık tahmini için)
      const key = Math.round(st.a) % 360 === 0 ? 'up' : (Math.abs(Math.abs(Math.round(st.a)) - 180) < 20 ? 'dn' : 'x');
      if (type === 0 && !cutStarted[key] && Z != null && tx === sx && ty === sy && tz < 20) firstRapidZ[key] = Math.min(firstRapidZ[key] ?? 1e9, tz);
      if (type === 1 && tz < 20) cutStarted[key] = true;
      addMove(tx, ty, tz, type, li);
    }
    st.x = tx; st.y = ty; st.z = tz;
  }
  if (ops.length) ops[ops.length - 1].end = n;
  if (simult) notes.push({ lvl: 'warn', t: `${simult} satırda döner eksen ve doğrusal eksen aynı satırda hareket ediyor (eşzamanlı 5 eksen). Simülasyon bu hareketleri 3+2 olarak yaklaşıklar.` });
  if (homeCount) notes.push({ lvl: 'info', t: `${homeCount} satırda G28/G30/G53 (makine sıfırına dönüş) bulundu; bu satırlar takımın güvenli yüksekliğe kalkması olarak simüle edildi.` });
  if (arcCount) notes.push({ lvl: 'info', t: `${arcCount} yay (G02/G03) hareketi 0.001 mm kiriş toleransıyla doğrusallaştırıldı.` });
  return {
    name, lines, n, MX, MY, MZ, TYPE, FEED, LINE, OP, ops, maxDec, gSeen, mSeen, notes, firstRapidZ, comments, toolChanges,
    start: { x: 0, y: 0, z: 50 },
  };
}

// ───────────────────────────── yorumlardan takım bilgisi ─────────────────────────────
const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const RE_TOOLNO = /(?:^|[^A-Z0-9])(?:T|TOOL|WERKZEUG|WKZ|TAKIM)\s*(?:NR\.?|NO\.?|#|:|=)?\s*0*(\d{1,3})(?![\d.])/;
const RE_DIA = [
  new RegExp('(?:Ø|⌀|DIA(?:METER|M)?\\.?|DURCHMESSER|ÇAP|CAP)\\s*[:=]?\\s*' + NUM),
  new RegExp('(?:^|[^A-Z])D\\s*[:=]?\\s*' + NUM + '(?![\\d.])'),
];
const RE_RAD = new RegExp('(?:^|[^A-Z])(?:R|RAD|RADIUS)\\s*[:=]?\\s*' + NUM + '(?![\\d.])');
const RE_TOOLWORD = /BALL|KUGEL|FR(?:AE|Ä)S|FREZ|MILL|CUTTER|TOOL|WERKZEUG|WKZ|TAKIM|SCHAFT|TORUS|BULL|ENDMILL|PARMAK|ROUGH|SCHRUPP|SCHLICHT|FINISH|KABA|İNCE|INCE/;
function toolTypeFromText(s) {
  if (/BALL|KUGEL|SPH|KÜRE|KURE|BILYE|BİLYE|\bBN\b|BALLNOSE|RADIUSFR/.test(s)) return 'ball';
  if (/FLAT|SCHAFT|END\s*MILL|ENDMILL|PARMAK|DÜZ|DUZ|ZYLIND|STIRN|SQUARE/.test(s)) return 'flat';
  return null;
}
// Bir yorum metninden takım bilgisi: {tool?, d?, type?, conf} (conf: 3 açık çap, 2 yarıçap, 1 takım adındaki sayı)
function parseToolText(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/(\d),(\d)/g, '$1.$2').toUpperCase();
  const out = { text: String(raw).trim(), conf: 0 };
  const tn = RE_TOOLNO.exec(s); if (tn) out.tool = +tn[1];
  out.type = toolTypeFromText(s) || undefined;
  for (const re of RE_DIA) {
    const m = re.exec(s);
    if (m && +m[1] >= 0.05 && +m[1] <= 30) { out.d = +m[1]; out.conf = 3; break; }
  }
  if (out.d == null) {
    const m = RE_RAD.exec(s);
    if (m && out.type !== 'flat' && +m[1] > 0.02 && +m[1] < 10) { out.d = 2 * m[1]; out.type = out.type || 'ball'; out.conf = 2; }
  }
  if (out.d == null && RE_TOOLWORD.test(s)) {
    // ör. "KUGEL 1.5", "BALL_D1_0": takım kelimesi + ondalıklı sayı
    const re = /(?:^|[^A-Z0-9.])[A-Z]{0,3}(\d{1,2}\.\d{1,3})(?!\d)/g;
    let q;
    while ((q = re.exec(s.replace(/(\d)_(\d)/g, '$1.$2')))) { const v = +q[1]; if (v >= 0.1 && v <= 12) { out.d = v; out.conf = 1; break; } }
  }
  if (out.d == null && out.type == null) return null;
  return out;
}
// Takım değişimi satırının çevresindeki (ve takım numarasını açıkça anan) yorumlardan çap
function toolsFromComments(job) {
  const res = {};
  const consider = (T, info, line) => {
    if (!info || info.d == null || (info.tool != null && info.tool !== T)) return;
    if (!res[T] || info.conf > res[T].conf) res[T] = { d: info.d, type: info.type || 'ball', conf: info.conf, text: info.text, line };
  };
  const byLine = new Map();
  for (const c of job.comments || []) { const a = byLine.get(c.line) || []; a.push(c); byLine.set(c.line, a); }
  const changes = job.toolChanges || [];
  for (let k = 0; k < changes.length; k++) {
    const { tool, line } = changes[k];
    if (tool <= 0) continue;
    const lo = Math.max(k ? changes[k - 1].line + 1 : 0, line - 4), hi = Math.min(k + 1 < changes.length ? changes[k + 1].line - 1 : Infinity, line + 4);
    for (let l = lo; l <= hi; l++) for (const c of byLine.get(l) || []) consider(tool, parseToolText(c.text), l);
  }
  // takım listesi başlıkları: "(T4 = KUGEL D1.0)"
  for (const c of job.comments || []) { const info = parseToolText(c.text); if (info && info.tool != null) consider(info.tool, info, c.line); }
  return res;
}

// ───────────────────────────── geometriden takım çapı ─────────────────────────────
const nearestStd = (d) => STD_DIAMETERS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
function snapDiameter(d) { const s = nearestStd(d); return Math.abs(s - d) <= 0.08 * s ? s : Math.round(d * 20) / 20; }
const nextStd = (d) => STD_DIAMETERS.find((c) => c > d + 1e-9) ?? d;
const prevStd = (d) => [...STD_DIAMETERS].reverse().find((c) => c < d - 1e-9) ?? d;
const orientKey = (op) => (Math.round(op.A * 100) / 100) + '|' + (Math.round(op.B * 100) / 100);

// Daire uydurma (s, z) düzleminde, i0..i1 noktaları (cebirsel, ortalamaya göre merkezlenmiş)
function fitCircle(S, Z, i0, i1) {
  const n = i1 - i0 + 1;
  let ms = 0, mz = 0;
  for (let i = i0; i <= i1; i++) { ms += S[i]; mz += Z[i]; }
  ms /= n; mz /= n;
  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (let i = i0; i <= i1; i++) {
    const u = S[i] - ms, v = Z[i] - mz;
    Suu += u * u; Svv += v * v; Suv += u * v; Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-18) return null;
  const a = 0.5 * (Suuu + Suvv), b = 0.5 * (Svvv + Svuu);
  const uc = (a * Svv - b * Suv) / det, vc = (b * Suu - a * Suv) / det;
  const rho = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  let e = 0;
  for (let i = i0; i <= i1; i++) { const d = Math.hypot(S[i] - ms - uc, Z[i] - mz - vc) - rho; e += d * d; }
  return { rho, zc: vc + mz, rms: Math.sqrt(e / n) };
}

// Bir kesme çoklu çizgisindeki dışbükey (tepe) yayların yarıçapları. Yol, XY'de doğrusal parçalara bölünür ve
// her parça düşey kesit (s, z) olarak incelenir. Bilye uç keskin bir kenarı aşarken uç noktası r yarıçaplı yay çizer;
// düzgün dışbükey yüzeylerde yay yarıçapı (yüzey yarıçapı + r) olur, yani hiçbir dış yay r'den küçük olamaz.
const WIN_LEN = [0.1, 0.15, 0.22, 0.33, 0.5, 0.75, 1.1, 1.6];
function convexArcsOfPolyline(P, m, out) {
  let a = 0;
  const S = new Float64Array(m), Z = new Float64Array(m);
  while (a < m - 1) {
    let dx0 = P[3 * a + 3] - P[3 * a], dy0 = P[3 * a + 4] - P[3 * a + 1];
    const h0 = Math.hypot(dx0, dy0);
    if (h0 < 1e-6) { a++; continue; }
    dx0 /= h0; dy0 /= h0;
    let n = 1, b = a + 1;
    S[0] = 0; Z[0] = P[3 * a + 2];
    while (b < m) {
      const dx = P[3 * b] - P[3 * a], dy = P[3 * b + 1] - P[3 * a + 1];
      const along = dx * dx0 + dy * dy0, perp = Math.abs(dy * dx0 - dx * dy0);
      if (along - S[n - 1] < 1e-6 || perp > 0.005 + 0.01 * along) break;
      S[n] = along; Z[n] = P[3 * b + 2]; n++; b++;
    }
    for (let i = 0; i + 4 < n; i++) {
      for (const L of WIN_LEN) {
        let j = i + 4;
        while (j < n && S[j] - S[i] < L) j++;
        if (j >= n) break;
        const span = S[j] - S[i];
        if (span > 1.6 * L) continue;
        const c = fitCircle(S, Z, i, j);
        if (!c || c.rms > 0.0012 || c.rho > 20 || span / c.rho < 0.6) continue;
        if (!(c.zc < Z[(i + j) >> 1])) continue; // içbükey (çukur) yay: bilgi taşımaz
        out.push(c.rho);
      }
    }
    a = Math.max(b - 1, a + 1);
  }
}
// Takım başına dışbükey yay yarıçapı örnekleri
function convexRadiiByTool(job) {
  const { MX, MY, MZ, TYPE, ops } = job;
  const res = {};
  let P = new Float64Array(3 * 4096), m = 0;
  const push = (x, y, z) => {
    if (3 * m + 3 > P.length) { const Q = new Float64Array(P.length * 2); Q.set(P); P = Q; }
    P[3 * m] = x; P[3 * m + 1] = y; P[3 * m + 2] = z; m++;
  };
  for (const op of ops) {
    if (op.tool <= 0) continue;
    const out = res[op.tool] || (res[op.tool] = []);
    let px = op.start > 0 ? MX[op.start - 1] : job.start.x, py = op.start > 0 ? MY[op.start - 1] : job.start.y, pz = op.start > 0 ? MZ[op.start - 1] : job.start.z;
    m = 0;
    for (let i = op.start; i < op.end; i++) {
      if (TYPE[i] === 1) { if (!m) push(px, py, pz); push(MX[i], MY[i], MZ[i]); }
      else { if (m >= 5) convexArcsOfPolyline(P, m, out); m = 0; }
      px = MX[i]; py = MY[i]; pz = MZ[i];
    }
    if (m >= 5) convexArcsOfPolyline(P, m, out);
  }
  return res;
}
// Yarıçap örneklerinden takım yarıçapı: en küçük güçlü küme (log ölçekli histogram)
function radiusFromArcs(rs) {
  if (rs.length < 20) return null;
  const v = Float64Array.from(rs).sort();
  const lo = Math.log(0.02), bw = Math.log(1.03), nb = Math.ceil((Math.log(25) - lo) / bw);
  const h = new Float64Array(nb);
  for (const x of v) { const k = Math.floor((Math.log(x) - lo) / bw); if (k >= 0 && k < nb) h[k]++; }
  const sm = new Float64Array(nb);
  for (let k = 0; k < nb; k++) sm[k] = (h[k - 1] || 0) + h[k] + (h[k + 1] || 0);
  let M = 0; for (const c of sm) if (c > M) M = c;
  const need = Math.max(60, 0.3 * M);
  for (let k = 1; k < nb - 1; k++) {
    if (sm[k] < need || sm[k] < sm[k - 1] || sm[k] < sm[k + 1]) continue;
    // tepe bulundu: tepe çevresindeki örneklerin alt çeyreği (yay kenara tam oturduğunda en küçük değer gerçek r'dir)
    const c = Math.exp(lo + (k + 0.5) * bw), sel = [];
    for (const x of v) if (x >= c * 0.88 && x <= c * 1.12) sel.push(x);
    const rho = sel[Math.floor(sel.length * 0.25)];
    return { rho, support: sel.length, total: v.length };
  }
  return null;
}

// Oyuk açmama sınaması: büyük takım (yarıçap Rb, uç noktaları big) ile sonra çalışan küçük takımın (yarıçap rs, temas
// noktaları ızgarası G) merkez yüzeyi arasında. Küçük takımın her merkezi, parça+rs genişletmesinin üst yüzeyindedir;
// (Rb−rs) kadar genişletilmiş hali büyük takımın merkez yüzeyinin altında kalmalıdır. Pozitif değer = tutarsızlık (mm).
// delta: XY toleransı (dik duvarlarda yolun örnekleme sıçramalarını yok saymak için)
function pointsOf(job, opList) {
  const { MX, MY, MZ, TYPE } = job;
  let n = 0;
  for (const op of opList) for (let i = op.start; i < op.end; i++) if (TYPE[i] === 1) n++;
  const P = new Float64Array(3 * n);
  let k = 0;
  for (const op of opList) for (let i = op.start; i < op.end; i++) if (TYPE[i] === 1) { P[k++] = MX[i]; P[k++] = MY[i]; P[k++] = MZ[i]; }
  return P;
}
function gridOf(P, cs) {
  const m = new Map();
  for (let i = 0; i < P.length; i += 3) {
    const key = Math.floor(P[i] / cs) * 1000003 + Math.floor(P[i + 1] / cs);
    let c = m.get(key);
    if (!c) m.set(key, (c = { idx: [], max: -Infinity }));
    c.idx.push(i);
    if (P[i + 2] > c.max) c.max = P[i + 2];
  }
  return { m, cs, P };
}
function gougeExcess(big, Rb, G, rs, opt) {
  const delta = opt.delta, tipB = opt.tip ? Rb : 0, tipS = opt.tip ? rs : 0;
  const rr = Rb - rs - delta;
  if (rr <= 0) return -Infinity;
  const cs = G.cs, nc = Math.ceil(rr / cs), P = G.P, rr2 = rr * rr;
  let worst = -Infinity;
  for (let i = 0; i < big.length; i += 3) {
    const x = big[i], y = big[i + 1], zc = big[i + 2] + tipB;
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    for (let a = -nc; a <= nc; a++) {
      for (let b = -nc; b <= nc; b++) {
        const c = G.m.get((cx + a) * 1000003 + cy + b);
        if (!c || c.max + tipS + rr - zc <= worst) continue;
        for (const j of c.idx) {
          const dx = P[j] - x, dy = P[j + 1] - y, d2 = dx * dx + dy * dy;
          if (d2 > rr2) continue;
          const v = P[j + 2] + tipS + Math.sqrt(rr2 - d2) - zc;
          if (v > worst) worst = v;
        }
      }
    }
  }
  return worst;
}

const MIN_ARC_SUPPORT = 300;
// Ana fonksiyon: { [T]: { d, type, source: 'comment'|'arc'|'bound'|'default', conf: 'high'|'medium'|'low'|'none', note, evidence } }
// opts.ref: 'tip' (NC koordinatı takım ucu, varsayılan) veya 'center'
function identifyTools(job, opts) {
  opts = Object.assign({ ref: 'tip', delta: 0.02, tol: 0.005 }, opts || {});
  const { TYPE, ops } = job;
  const cutOps = ops.filter((op) => {
    if (op.tool <= 0) return false;
    for (let i = op.start; i < op.end; i++) if (TYPE[i] === 1) return true;
    return false;
  });
  const tools = [...new Set(cutOps.map((o) => o.tool))].sort((a, b) => a - b);
  const res = {};
  const fmt = (v) => String(+v.toFixed(3));

  // 1) NC yorumları
  const fromCmt = toolsFromComments(job);
  for (const T of tools) {
    const c = fromCmt[T];
    if (c) res[T] = { d: c.d, type: c.type, source: 'comment', conf: c.conf >= 2 ? 'high' : 'medium', note: `NC yorumu (satır ${c.line + 1}): “${c.text}”`, evidence: { comment: c } };
  }
  // 2) yol eğriliği (dış yaylar)
  const arcs = convexRadiiByTool(job);
  const arcEst = {};
  for (const T of tools) {
    const e = radiusFromArcs(arcs[T] || []);
    arcEst[T] = e;
    // yeterince çok temiz yay yoksa (ör. yalnızca çukurlarda çalışan artık işleme) bu ölçüme güvenme
    if (!res[T] && e && e.support >= MIN_ARC_SUPPORT) {
      const d = snapDiameter(2 * e.rho);
      res[T] = { d, type: 'ball', source: 'arc', conf: 'high',
        note: `Takım yolu keskin kenarları Ø${fmt(2 * e.rho)} mm'lik yaylarla aşıyor (${e.support} ölçüm) → Ø${fmt(d)}`, evidence: { arc: e } };
    }
  }
  // 3) takımlar arası oyuk açmama sınırları (aynı A/B yöneliminde)
  const groups = new Map();
  for (const op of cutOps) { const k = orientKey(op); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(op); }
  const cacheP = new Map(), cacheG = new Map();
  const ptsKey = (k, T) => k + '#' + T;
  const pts = (k, T) => { const key = ptsKey(k, T); if (!cacheP.has(key)) cacheP.set(key, pointsOf(job, groups.get(k).filter((o) => o.tool === T))); return cacheP.get(key); };
  const grid = (k, T) => { const key = ptsKey(k, T); if (!cacheG.has(key)) cacheG.set(key, gridOf(pts(k, T), 0.25)); return cacheG.get(key); };
  const g = { delta: opts.delta, tip: opts.ref !== 'center' };
  let progress = true;
  while (progress) {
    progress = false;
    for (const U of tools) {
      if (res[U]) continue;
      // lo/hi: kesin sınırlar; tight*: sınama yönüne göre sıkı (gerçeğe en yakın) değerler
      let lo = 0, hi = Infinity, tightLo = null, tightHi = null;
      const why = [];
      for (const [k, list] of groups) {
        const uOps = list.filter((o) => o.tool === U);
        if (!uOps.length) continue;
        const uPos = uOps.reduce((s, o) => s + o.idx, 0) / uOps.length;
        for (const K of tools) {
          if (K === U || !res[K] || res[K].type !== 'ball' || res[K].source === 'default') continue;
          const kOps = list.filter((o) => o.tool === K);
          if (!kOps.length) continue;
          const kPos = kOps.reduce((s, o) => s + o.idx, 0) / kOps.length, dK = res[K].d, rK = dK / 2;
          if (uPos < kPos) {
            // U önce çalışıyor (kaba): K'nın temasları kesin yüzeydir → U için en büyük oyuksuz çap
            let best = null;
            for (const c of STD_DIAMETERS) {
              if (c <= dK) continue;
              if (gougeExcess(pts(k, U), c / 2, grid(k, K), rK, g) <= opts.tol) best = c; else break;
            }
            if (best != null) {
              lo = Math.max(lo, nextStd(dK)); hi = Math.min(hi, best); tightHi = tightHi == null ? best : Math.min(tightHi, best);
              why.push(`T${K} (Ø${fmt(dK)}) yüzeyine oyuk açmayan en büyük çap Ø${fmt(best)}`);
            } else { hi = Math.min(hi, dK); why.push(`T${K}'dan (Ø${fmt(dK)}) büyük olamaz`); }
          } else {
            // U sonra çalışıyor (ince/artık): U'nun temasları kesin → K'nın oyuk açmış görünmediği en küçük çap
            let best = null;
            for (let i = STD_DIAMETERS.length - 1; i >= 0; i--) {
              const c = STD_DIAMETERS[i];
              if (c >= dK) continue;
              if (gougeExcess(pts(k, K), rK, grid(k, U), c / 2, g) <= opts.tol) best = c; else break;
            }
            if (best != null) {
              hi = Math.min(hi, prevStd(dK)); lo = Math.max(lo, best); tightLo = tightLo == null ? best : Math.max(tightLo, best);
              why.push(`T${K} (Ø${fmt(dK)}) yollarıyla tutarlı en küçük çap Ø${fmt(best)}`);
            } else { lo = Math.max(lo, dK); why.push(`T${K}'dan (Ø${fmt(dK)}) küçük olamaz`); }
          }
        }
      }
      if (!why.length) continue;
      const cands = STD_DIAMETERS.filter((c) => c >= lo && c <= hi);
      if (!cands.length) continue;
      let d;
      if (tightLo != null && cands.includes(tightLo)) d = tightLo;
      else if (tightHi != null && cands.includes(tightHi)) d = tightHi;
      else d = cands[0];
      res[U] = { d, type: 'ball', source: 'bound', conf: cands.length === 1 ? 'high' : 'medium', note: [...new Set(why)].join('; ') + ` → Ø${fmt(d)}`, evidence: { lo, hi, cands } };
      progress = true;
    }
  }
  // 4) son çare: takım numarasına göre varsayılan
  for (const T of tools) {
    if (res[T]) continue;
    const def = DEFAULT_TOOLS[T] || { type: 'ball', d: 1.0 };
    res[T] = { d: def.d, type: def.type, source: 'default', conf: 'none', note: 'NC dosyasından çap çıkarılamadı; takım numarasına göre varsayılan değer', evidence: {} };
  }
  return res;
}

return { STD_DIAMETERS, DEFAULT_TOOLS, parseNC, parseToolText, toolsFromComments, convexRadiiByTool, radiusFromArcs, gougeExcess, identifyTools, snapDiameter };
});
