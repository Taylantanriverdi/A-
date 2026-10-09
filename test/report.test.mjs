// Detaylı kazıma raporu testleri — tools/gen_synthetic.mjs ile gerçek değerleri bilinen iş üretir.
// Çalıştırma: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NCReport = require('../src/report.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncrep-'));
const nc = path.join(dir, 'a.nc');
execFileSync(process.execPath, [path.join(root, 'tools/gen_synthetic.mjs'), '--out', nc, '--comments'], { stdio: 'ignore' });
const text = fs.readFileSync(nc, 'utf8');
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'a.truth.json'), 'utf8'));
const truthTools = Object.fromEntries(truth.tools.map((t) => [t.t, { type: t.type, d: t.d }]));
const R = NCReport.buildReport(text, 'a.nc');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('takım çapları NC yorumundan okunur', () => {
  assert.equal(R.tools.length, 3);
  for (const t of truth.tools) {
    const r = R.tools.find((x) => x.tool === t.t);
    assert.equal(r.d, t.d, `T${t.t}`);
    assert.equal(r.type, t.type);
    assert.equal(r.src, 'NC yorumu');
  }
});

test('her yüzde kaba / ince / artık aşamaları ayrı raporlanır', () => {
  assert.deepEqual(R.sides.map((s) => s.side), [1, -1]);
  for (const sd of R.sides) {
    assert.deepEqual(sd.stages.map((s) => s.stage), ['kaba', 'ince', 'artik']);
    const by = Object.fromEntries(sd.stages.map((s) => [s.stage, s]));
    assert.ok(by.kaba.vol > by.ince.vol && by.ince.vol > by.artik.vol, 'hacim kaba > ince > artık');
    assert.ok(near(by.kaba.maxDepth, 0.4, 0.02), 'kaba Z adımı kadar talaş');
  }
  const T = Object.fromEntries(R.ops.map((o) => [o.idx, o]));
  assert.equal(T[1].strategy, 'Z-sabit');
  assert.ok(near(T[1].zStep, 0.4, 1e-6));
  assert.ok(near(T[2].stepover, 0.1, 0.01), 'ince yanal adım 0.1');
  assert.ok(near(T[3].stepover, 0.06, 0.01), 'artık yanal adım 0.06');
});

test('yorumsuz dosyada aşamalar stratejiden ve çaptan çıkarılır', () => {
  const R2 = NCReport.buildReport(text.replace(/^\(.*\)$/gm, ''), 'b.nc', { tools: truthTools });
  assert.deepEqual(R2.ops.map((o) => o.stage), ['kaba', 'ince', 'artik', 'kaba', 'ince', 'artik']);
  assert.ok(R2.tools.every((t) => t.src === 'Kullanıcı'));
});

test('yorum da takım da yoksa çaplar core.identifyTools ile tanınır', () => {
  const R3 = NCReport.buildReport(text.replace(/^\(.*\)$/gm, ''), 'c.nc');
  for (const t of truth.tools) {
    const r = R3.tools.find((x) => x.tool === t.t);
    assert.equal(r.d, t.d, `T${t.t} ${r.src}`);
    assert.ok(!/Varsayılan|Kullanıcı|NC yorumu/.test(r.src), r.src);
  }
  assert.deepEqual(R3.ops.map((o) => o.stage), ['kaba', 'ince', 'artik', 'kaba', 'ince', 'artik']);
});

test('parçalar bulunur, konum ve yükseklik gerçeğe uyar', () => {
  assert.equal(R.parts.length, truth.parts.length);
  for (const [cx, cy] of truth.parts) {
    const p = R.parts.find((q) => near(q.cx, cx, 0.3) && near(q.cy, cy, 0.3));
    assert.ok(p, `parça (${cx}, ${cy})`);
    assert.ok(near(p.ztop, 4.5, 0.1) && near(p.zbot, -3.0, 0.1), `${p.name} Z ${p.zbot}…${p.ztop}`);
    for (const sd of p.sides) {
      const kaba = sd.stages.find((s) => s.stage === 'kaba');
      assert.ok(kaba.coverage > 0.99, `${p.name} ${sd.name} kaba kapsama`);
      assert.ok((sd.finalSurface.kaba || 0) < 0.02, `${p.name} ${sd.name} kaba izi kalmamalı`);
      assert.ok(sd.untouched < 0.001, `${p.name} ${sd.name} işlenmemiş yüzey`);
      const share = Object.values(sd.finalSurface).reduce((a, b) => a + b, 0) + sd.untouched;
      assert.ok(near(share, 1, 1e-9), 'son yüzey payları toplamı 1');
    }
  }
});

test('hacim parçalara eksiksiz dağıtılır', () => {
  const ops = R.ops.reduce((s, o) => s + o.vol, 0);
  const parts = R.parts.reduce((s, p) => s + p.vol, 0) + R.summary.outsidePartsVol;
  assert.ok(near(ops, parts, ops * 1e-6), `${ops} ≈ ${parts}`);
  assert.ok(near(R.summary.vol, ops, 1e-6));
});

test('malzemeye hızlı dalma ve aşırı talaş uyarılır', () => {
  // sentetik üretici kanal kenarını kaba işlemede boşaltmıyor; ince takım orada G0 ile malzemeye iniyor
  assert.ok(R.summary.rapidHits > 0);
  assert.ok(R.warnings.some((w) => w.lvl === 'bad' && /G0/.test(w.t)));
  assert.ok(R.warnings.some((w) => /talaş derinliği/.test(w.t)));
});

test('metin, HTML ve CSV çıktıları', () => {
  const t = NCReport.toText(R), h = NCReport.toHTML(R), c = NCReport.toCSV(R);
  for (const s of ['TAKIMLAR', 'YÜZ VE AŞAMA ÖZETİ', 'OPERASYONLAR', 'PARÇALAR', 'P1', 'P3', 'Artık malzeme']) assert.ok(t.includes(s), s);
  assert.ok(h.startsWith('<!doctype html>') && h.includes('<title>Kazıma Raporu</title>') && h.includes('P2'));
  const rows = c.trim().split('\r\n');
  assert.ok(rows.length > 6 + 18);
  assert.ok(rows.some((r) => r.startsWith('Son yüzey;P1;Üst (A0);')));
});
