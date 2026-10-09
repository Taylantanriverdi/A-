// Takım çapı tanıma: gerçek çapları bilinen sentetik NC dosyalarıyla (tools/gen_synthetic.mjs) doğrulama.
// Çalıştırma: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NCCore = createRequire(import.meta.url)(path.join(root, 'src', 'core.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncsim-'));

function synth(name, args) {
  const out = path.join(tmp, name + '.nc');
  execFileSync(process.execPath, [path.join(root, 'tools', 'gen_synthetic.mjs'), '--out', out, ...args]);
  return { job: NCCore.parseNC(fs.readFileSync(out, 'utf8'), name), truth: JSON.parse(fs.readFileSync(out.replace(/\.nc$/, '.truth.json'), 'utf8')) };
}
function check(name, args, sources) {
  const { job, truth } = synth(name, args);
  const id = NCCore.identifyTools(job);
  for (const t of truth.tools) {
    assert.ok(id[t.t], `T${t.t} tanınmadı`);
    assert.equal(id[t.t].d, t.d, `T${t.t}: beklenen Ø${t.d}, bulunan Ø${id[t.t].d} (${id[t.t].source}: ${id[t.t].note})`);
    assert.equal(id[t.t].type, t.type);
    if (sources) assert.ok(sources.includes(id[t.t].source), `T${t.t} kaynağı ${id[t.t].source}`);
  }
}

test('hyperDENT benzeri iş (yorumsuz): T5 Ø2.5 kaba, T4 Ø1.0 ince, T6 Ø0.5 artık geometriden tanınır', () => {
  check('varsayilan', [], ['arc', 'bound']);
});
test('farklı takım seti (T5 Ø2.0, T4 Ø1.0, T6 Ø0.6 — eski varsayılanlara yakın ama farklı)', () => {
  check('set2', ['--tools', '5:ball:2.0,4:ball:1.0,6:ball:0.6', '--parts', '1'], ['arc', 'bound']);
});
test('farklı takım seti (T5 Ø3.0, T4 Ø0.8, T6 Ø0.3) ve T M6 takım değişimi', () => {
  check('set3', ['--tools', '5:ball:3.0,4:ball:0.8,6:ball:0.3', '--format', 'm6', '--parts', '1'], ['arc', 'bound']);
});
test('NC yorumunda çap yazıyorsa yorum kullanılır', () => {
  check('yorumlu', ['--comments', '--parts', '1'], ['comment']);
});
test('yorum ayrıştırma', () => {
  const p = NCCore.parseToolText;
  assert.deepEqual([p('T4 KUGEL D=1.00 mm').tool, p('T4 KUGEL D=1.00 mm').d], [4, 1]);
  assert.equal(p('TOOL 5 BALL R1.25').d, 2.5);
  assert.equal(p('Ø0,6 Kugelfräser').d, 0.6);
  assert.equal(p('hyperDENT synthetic test job'), null);
});
test('tek dosyalık HTML, src/core.js ile güncel', () => {
  execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs'), '--check']);
});
