#!/usr/bin/env node
// Sentetik (yapay) hyperDENT benzeri NC dosyası üretici — GERÇEK takım çapları bilinen test verisi.
// Diskte birkaç "kron" benzeri parça: üstten (A0) ve alttan (A180) kaba Z-sabit + ince tarama + artık malzeme.
// Drop-cutter (takım düşürme) algoritmasıyla oyuk açmayan (gouge-free) takım yolları üretir, NC koordinatı = takım ucu.
//
// Kullanım: node tools/gen_synthetic.mjs --out ornek.nc [--tools 5:ball:2.5,4:ball:1.0,6:ball:0.5]
//           [--format g200|m6] [--comments] [--parts 3] [--stock 0.15] [--H 14]
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, s, i, arr) => {
  if (s.startsWith('--')) a.push([s.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const OUT = args.out || 'ornek.nc';
const FORMAT = args.format || 'g200';
const COMMENTS = !!args.comments;
const NPARTS = +(args.parts || 3);
const STOCK = +(args.stock || 0.15);
const H = +(args.H || 14), H2 = H / 2;
const toolSpec = (args.tools || '5:ball:2.5,4:ball:1.0,6:ball:0.5').split(',').map((s) => { const [t, type, d] = s.split(':'); return { t: +t, type, d: +d }; });
const [TR, TF, TS] = toolSpec; // kaba, ince, artık

// ── parça tasarımı (blok koordinatı, parça merkezine göre) ──
const A = 5.0, B = 4.0, GAP = 2.6; // ayak izi elipsi ve kanal genişliği
function rho(x, y, a, b) { return Math.sqrt((x / a) ** 2 + (y / b) ** 2); }
function inConnector(x, y) { return x > 0 && Math.abs(y) < 0.6 && rho(x, y, A + GAP, B + GAP) < 1.02; }
function designTop(x, y) {
  const r = rho(x, y, A, B);
  if (r < 1) {
    const dome = 0.5 + 4.0 * Math.sqrt(1 - r * r);
    const fis = 0.7 * Math.exp(-(((x - 0.3) / 0.35) ** 2)) * (r < 0.7 ? 1 : Math.max(0, 1 - (r - 0.7) / 0.2)); // fissür (oluk)
    return dome - fis;
  }
  if (inConnector(x, y)) return 0.6;
  if (rho(x, y, A + GAP, B + GAP) < 1) return -0.3;
  return H2;
}
function designBot(x, y) { // alttan bakışta malzemenin alt sınırı (blok Z)
  const r = rho(x, y, A, B);
  if (r < 1) {
    const ri = rho(x, y, 3.2, 2.5);
    return ri < 1 ? -3.0 + 2.6 * Math.sqrt(1 - ri * ri) : -3.0;
  }
  if (inConnector(x, y)) return -0.6;
  if (rho(x, y, A + GAP, B + GAP) < 1) return 0.3;
  return -H2;
}

// ── yükseklik alanı + drop-cutter ──
const h = 0.025, EXT = Math.max(A, B) + GAP + 2.5;
const NS = Math.round(2 * EXT / h) + 1;
function sampleField(fn) {
  const S = new Float32Array(NS * NS);
  for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) S[j * NS + i] = fn(-EXT + i * h, -EXT + j * h);
  return S;
}
function profile(tool) {
  const r = tool.d / 2;
  if (tool.type === 'ball') return (q) => r - Math.sqrt(Math.max(0, r * r - q * q));
  return () => 0; // düz
}
function makeDrop(S, tool) {
  const r = tool.d / 2, f = profile(tool), R = Math.ceil(r / h);
  const off = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const q = Math.hypot(di, dj) * h; if (q <= r) off.push(dj * NS + di, f(q)); }
  const cache = new Map();
  return function drop(x, y) {
    const i = Math.round((x + EXT) / h), j = Math.round((y + EXT) / h);
    if (i < R || j < R || i >= NS - R || j >= NS - R) return H2;
    const k = j * NS + i;
    const c = cache.get(k); if (c !== undefined) return c;
    let m = -1e9;
    for (let o = 0; o < off.length; o += 2) { const v = S[k + off[o]] - off[o + 1]; if (v > m) m = v; }
    cache.set(k, m);
    return m;
  };
}

// ── NC yazıcı ──
const out = [];
let N = 10;
const f3 = (v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
function L(s) { out.push(`N${N} ${s}`); N += 2; }
let cur = { x: 0, y: 0, z: 50, mode: -1, f: -1 };
function G0(x, y, z) { const p = []; if (x != null && x !== cur.x) p.push('X' + f3(x)); if (y != null && y !== cur.y) p.push('Y' + f3(y)); if (z != null && z !== cur.z) p.push('Z' + f3(z)); if (!p.length) return; L((cur.mode !== 0 ? 'G0 ' : '') + p.join(' ')); cur.mode = 0; if (x != null) cur.x = x; if (y != null) cur.y = y; if (z != null) cur.z = z; }
function G1(x, y, z, f) { const p = []; if (x !== cur.x) p.push('X' + f3(x)); if (y !== cur.y) p.push('Y' + f3(y)); if (z !== cur.z) p.push('Z' + f3(z)); if (!p.length) return; if (f !== cur.f) p.push('F' + f); L((cur.mode !== 1 ? 'G1 ' : '') + p.join(' ')); cur.mode = 1; cur.x = x; cur.y = y; cur.z = z; cur.f = f; }

function toolChange(t, label) {
  const td = toolSpec.find((q) => q.t === t);
  if (COMMENTS) out.push(`(${label} - T${t} ${td.type === 'ball' ? 'KUGEL' : 'SCHAFT'} D=${td.d.toFixed(2)} mm)`);
  if (FORMAT === 'm6') L(`T${t} M6`); else L(`G200 P${t}`);
  cur.mode = -1; cur.f = -1; cur.z = 50;
}

// ── stratejiler (makine koordinatında, yerel parça merkezi + kaydırma) ──
const SAFE = H2 + 1;
function roughing(drop, cx, cy, flip, tool, z0, z1, ap, ae, F) {
  // Z-sabit tarama kaba: her seviyede tutucu konumların bitişik aralıkları
  const lim = A + GAP - 0.05;
  for (let z = z0 - ap; z >= z1 - 1e-6; z -= ap) {
    const zl = Math.max(z, z1);
    let first = true;
    for (let y = -B - GAP + tool.d / 2; y <= B + GAP - tool.d / 2 + 1e-6; y += ae) {
      const runs = []; let run = null;
      for (let x = -lim; x <= lim + 1e-6; x += 0.1) {
        const ok = rho(x, y, A + GAP - tool.d / 2, B + GAP - tool.d / 2) < 1 && drop(x, y) <= zl;
        if (ok) { if (!run) run = []; run.push(x); } else if (run) { runs.push(run); run = null; }
      }
      if (run) runs.push(run);
      for (const r of (first ? runs : runs)) {
        const mx = (x) => cx + x, my = flip ? -cy + y : cy + y;
        G0(null, null, SAFE); G0(mx(r[0]), my, null); G0(null, null, Math.min(SAFE, zl + ap + 0.25));
        G1(mx(r[0]), my, zl, F);
        G1(mx(r[r.length - 1]), my, zl, F);
        first = false;
      }
    }
  }
  G0(null, null, SAFE);
}
function raster(drop, cx, cy, flip, tool, step, dx, F, maskFn) {
  const lim = A + GAP;
  let dir = 1;
  for (let y = -B - GAP; y <= B + GAP + 1e-6; y += step) {
    const xs = [];
    for (let x = -lim; x <= lim + 1e-6; x += dx) xs.push(x);
    if (dir < 0) xs.reverse();
    dir = -dir;
    let run = null; const runs = [];
    for (const x of xs) {
      const ok = rho(x, y, A + GAP - tool.d / 2 - 0.02, B + GAP - tool.d / 2 - 0.02) < 1 && (!maskFn || maskFn(x, y));
      if (ok) { if (!run) run = []; run.push([x, drop(x, y)]); } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const r of runs) {
      if (r.length < 2) continue;
      const my = flip ? -cy + y : cy + y;
      G0(null, null, SAFE); G0(cx + r[0][0], my, null); G0(null, null, r[0][1] + 0.5);
      for (const [x, z] of r) G1(cx + x, my, z, F);
    }
  }
  G0(null, null, SAFE);
}

// ── iş ──
const parts = [];
for (let p = 0; p < NPARTS; p++) parts.push([-22 + p * 22, p % 2 ? 8 : -6]);
const Stop = sampleField(designTop), Sbot = sampleField((x, y) => -designBot(x, -y));
const StopS = sampleField((x, y) => designTop(x, y) + (designTop(x, y) < H2 - 1e-6 ? STOCK : 0));
const SbotS = sampleField((x, y) => -designBot(x, -y) + (-designBot(x, -y) < H2 - 1e-6 ? STOCK : 0));

out.push('%');
if (COMMENTS) out.push('(hyperDENT synthetic test job)');
L('G90 G54 G17 G21');
for (const [side, S, SS, aVal] of [['ust', Stop, StopS, 0], ['alt', Sbot, SbotS, 180]]) {
  const dR = makeDrop(SS, TR), dF = makeDrop(S, TF), dS = makeDrop(S, TS);
  // TF ulaşamadığı yerler (artık malzeme maskesi)
  const restMask = (x, y) => {
    for (let a = -0.25; a <= 0.25; a += 0.125) for (let b = -0.25; b <= 0.25; b += 0.125) if (dS(x + a, y + b) < dF(x + a, y + b) - 0.004) return true;
    return false;
  };
  toolChange(TR.t, 'Kaba ' + side); L('M3 S30000'); L(`G0 A${aVal} B0`);
  for (const [cx, cy] of parts) roughing(dR, cx, cy, aVal === 180, TR, H2, -0.3 + STOCK, 0.4, TR.d * 0.4, 1500);
  toolChange(TF.t, 'Ince ' + side); L('M3 S35000'); L(`G0 A${aVal} B0`);
  for (const [cx, cy] of parts) raster(dF, cx, cy, aVal === 180, TF, 0.1, 0.05, 1800);
  toolChange(TS.t, 'Artik ' + side); L('M3 S40000'); L(`G0 A${aVal} B0`);
  for (const [cx, cy] of parts) raster(dS, cx, cy, aVal === 180, TS, 0.06, 0.04, 1200, restMask);
}
L('M5'); L('G0 A0 B0'); L('M30'); out.push('%');
fs.writeFileSync(OUT, out.join('\n') + '\n');
fs.writeFileSync(OUT.replace(/\.[^.]+$/, '') + '.truth.json', JSON.stringify({ tools: toolSpec, H, stock: STOCK, parts, discD: 98.5 }, null, 1));
console.log(`${OUT}: ${out.length} satır, takımlar ${toolSpec.map((t) => `T${t.t}=${t.type} Ø${t.d}`).join(', ')}`);
