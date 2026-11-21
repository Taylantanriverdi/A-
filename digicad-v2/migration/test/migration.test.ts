import { describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../src/runner';
import { MemoryAuthSink, MemoryDocSink, type Doc, type DocSink } from '../src/sinks';
import { hashRecord, canonical } from '../src/canonical';
import { buildPlan } from '../src/transform';
import { lostFields } from '../src/verify';
import { assertSafeTarget, isForbiddenProject } from '../src/guard';
import { collectFileRefs, buildManifest, copyToBucket, type BucketSink } from '../src/storage';
import { secureAppend, csvCell } from '../src/csv';
import { main } from '../src/cli';

// Tamamen UYDURMA (gerçek kişi/kayıt değil) zengin RTDB dışa aktarımı: tüm kenar durumları içerir.
const FIXTURE = resolve(__dirname, 'fixtures/rtdb-export.fake.json');
const sourceText = readFileSync(FIXTURE, 'utf8');
const fake = (): any => JSON.parse(sourceText);
const text = (o: unknown) => JSON.stringify(o);
const P = 'yeni-test-proje';
const base = { project: P, retryDelayMs: 0, env: {} as Record<string, string> };
const D1 = '1700000000001';

/** Test-yerel, dönüşümden bağımsız "kaynak ⊆ hedef" denetimi (yalnızca belgelenmiş dönüşümler hoşgörülür). */
function includes(src: any, tgt: any, path: string, errs: string[]): void {
  if (src === null || src === undefined) return;
  if (Array.isArray(src)) {
    if (!Array.isArray(tgt)) return void errs.push(path + ' dizi değil');
    src.forEach((x, i) => (Array.isArray(x) ? includes(x, tgt[i]?._nestedArray, `${path}[${i}]`, errs) : includes(x, tgt[i], `${path}[${i}]`, errs)));
  } else if (typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) { const tk = /^__.*__$/.test(k) ? 'x' + k : k === '' ? 'x(bos)' : k; if (v != null && !(tgt && Object.prototype.hasOwnProperty.call(tgt, tk))) errs.push(`${path}.${k} yok`); else includes(v, tgt?.[tk], `${path}.${k}`, errs); }
  } else if (src !== tgt && String(src) !== String(tgt)) errs.push(`${path}: ${String(src)} != ${String(tgt)}`);
}
const SECRET = /^(pass|password|pin|sifre|şifre)$/i;
const entries = (n: any): [string, any][] => (Array.isArray(n) ? n.map((v, i): [string, any] => [String(i), v]) : Object.entries(n ?? {})).filter(([, v]) => v != null);

describe('dry-run', () => {
  it('hiçbir sink çağrılmaz (okuma da yok), hiçbir şey yazılmaz; rapor temiz', async () => {
    const boom = new Proxy({}, { get: () => () => { throw new Error('DRY-RUN SİNK ÇAĞRISI!'); } });
    const { report } = await run({ sourceText, execute: false, docs: boom as any, auth: boom as any });
    expect(report.mode).toBe('dry-run'); expect(report.ok).toBe(true); expect(report.validationErrors).toEqual([]);
    expect(report.totals.written).toBe(0); expect(report.totals.planned).toBeGreaterThan(30);
    expect(report.sourceSha256).toBe(createHash('sha256').update(sourceText).digest('hex'));
  });
  it('dry-run bağımsız kapsama denetimini de çalıştırır (dönüşüm hatası dry-run\'da yakalanır)', async () => {
    const plan = buildPlan(fake());
    const d = plan.docs.find((x) => x.path.endsWith('jobs/1700000000100'))!;
    const data = structuredClone(d.data); delete data.patient; delete data.price; // kendi kendini doğrulayan hash: yeniden hesaplanır
    const tampered = { ...d, data, hash: hashRecord(data) };
    expect(lostFields(fake(), tampered, tampered.data).join()).toContain('patient');
    expect(hashRecord(tampered.data)).toBe(tampered.hash); // hash tek başına kaybı GÖRMEZDİ
  });
});

describe('kayıpsızlık: tüm yollar ve alanlar', () => {
  it('her kaynak kaydın her alanı (gizli alanlar hariç) geri okunan hedefte vardır', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink();
    const { report } = await run({ sourceText, execute: true, docs, auth, ...base });
    expect(report.validationErrors).toEqual([]); expect(report.ok).toBe(true);
    expect(report.totals.verifiedOk).toBe(report.totals.planned); expect(report.totals.lost + report.totals.missing + report.totals.mismatched).toBe(0);
    const src = fake(); const errs: string[] = [];
    let expected = 0;
    for (const ws of ['digicad', 'primer']) {
      for (const c of ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures']) {
        for (const [k, rec] of entries(src.db[ws][c])) {
          expected++; const t = docs.store.get(`labs/${ws}/${c}/${k}`);
          if (!t) { errs.push(`yok: ${ws}/${c}/${k}`); continue; }
          const r = { ...rec }; if (c === 'doctors' || c === 'technicians') for (const f of Object.keys(r)) if (SECRET.test(f)) delete r[f];
          includes(r, t, `${ws}/${c}/${k}`, errs);
        }
      }
      for (const [tid, th] of entries(src.db[ws].chats)) {
        expected++; expect(docs.store.has(`labs/${ws}/threads/${tid}`)).toBe(true);
        for (const [mid, m] of entries(th.messages)) { expected++; const t = docs.store.get(`labs/${ws}/threads/${tid}/messages/${mid}`); if (!t) errs.push('mesaj yok ' + mid); else includes(m, t, `${ws}/chats/${tid}/${mid}`, errs); }
        const rest = { ...th }; delete rest.messages; includes(rest, docs.store.get(`labs/${ws}/threads/${tid}`), `thread ${tid}`, errs);
      }
      if (src.db[ws].mailFilters) { expected++; const items = Object.values(src.db[ws].mailFilters); expect(docs.store.get(`labs/${ws}/mailFilters/main`)!.items).toEqual(items); }
      if (src.db[ws].settings) { expected++; includes(src.db[ws].settings, docs.store.get(`labs/${ws}/settings/main`), 'settings', errs); }
    }
    expect(errs).toEqual([]); expect(docs.store.size).toBe(expected); expect(report.totals.planned).toBe(expected);
  });

  it('gizli alanlar (her harf biçimi) hiçbir hedef belgede yok; yönetici/meta şifresi taşınmaz; diğer her şey var', async () => {
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText, execute: true, docs, ...base });
    const all = JSON.stringify([...docs.store.entries()]);
    for (const needle of ['"password"', '"PIN"', '"pass"', '"sifre"', '"Password"', 'gizli', '"1234"', '"abc"']) expect(all).not.toContain(needle);
    expect(report.strippedSecretFields).toBe(7);
    expect(report.skipped.map((s) => s.what)).toEqual(expect.arrayContaining(['digicad/pass', 'meta/pass', 'meta/migratedToWorkspaces']));
    expect(docs.store.get(`labs/digicad/doctors/${D1}`)).toMatchObject({ name: 'Dr. Örnek Bir', username: 'ornekbir', autoTechId: 1 });
  });

  it('çöp filtresi için deleted alanı (jobs/pendingJobs/doctorSubmissions) her zaman yazılır; durumsuz iş açık sayılır; mevcut değerler korunur', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    expect(docs.store.get('labs/digicad/jobs/1700000000100')).toMatchObject({ deleted: false, status: 'Üretimde' });
    expect(docs.store.get('labs/digicad/jobs/1700000000101')).toMatchObject({ deleted: true });
    expect(docs.store.get('labs/digicad/pendingJobs/1700000000200')).toMatchObject({ deleted: false });
    for (const [path, d] of docs.store) if (/^labs\/[^/]+\/(jobs|pendingJobs|doctorSubmissions)\/[^/]+$/.test(path)) expect(typeof d.deleted, path).toBe('boolean');
    const t = buildPlan({ db: { digicad: { jobs: { 9: { id: 9, drId: 1, patient: 'Durumsuz' } } } } }).docs.find((x) => x.path === 'labs/digicad/jobs/9')!;
    expect(t.data).toMatchObject({ status: 'Bekliyor', deleted: false, _legacy: { defaultedStatus: true } });
  });

  it('kimlik ve tür normalizasyonu: doctorId/techIds metin, pendingJobs.techId metin, hekimsiz iş doctorId boş metin', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    const j = docs.store.get('labs/digicad/jobs/1700000000100')!;
    expect(j).toMatchObject({ doctorId: D1, drId: Number(D1), techIds: ['1'], techId: 1, id: 1700000000100, price: 1234567.891, qty: 3, paid: false, discount: 0 });
    expect(docs.store.get('labs/digicad/jobs/1700000000101')).toMatchObject({ techIds: ['1', '2'], doctorId: D1, deleted: true, dateout: '01.03.2025' });
    expect(docs.store.get('labs/digicad/jobs/1700000000102')).toMatchObject({ doctorId: '', techIds: ['1'] });
    expect((docs.store.get('labs/digicad/jobs/1700000000102')!.large as string).length).toBe(20000);
    expect(docs.store.get('labs/digicad/jobs/7')).toMatchObject({ id: 7, techIds: [], createdAt: 1709290000000 });
    expect(docs.store.get('labs/digicad/pendingJobs/1700000000200')).toMatchObject({ techId: '2', techIds: ['2'], status: 'Onay Bekliyor' });
    expect(docs.store.get('labs/digicad/technicians/1')).toMatchObject({ name: 'Tek Bir (kurgu)' }); // dizi biçimli düğüm, null deliği atlandı
    expect(docs.store.get('labs/digicad/payments/2')).toMatchObject({ amount: 0, doctorId: D1 });
  });

  it('dosya URL\'leri (eski adresler ve token) aynen korunur; metin/özel karakterler bozulmaz', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    const j = docs.store.get('labs/digicad/jobs/1700000000100') as any;
    expect(j.files[0].url).toBe(fake().db.digicad.jobs['1700000000100'].files[0].url); expect(j.files[0].url).toContain('token=tok-1');
    expect(j.files[0].name).toBe("x');alert(1)//.stl"); expect(j.note).toContain('☃'); expect(j.note).toContain('🦷');
    expect(docs.store.get(`labs/digicad/doctorSubmissions/sub_1`)).toMatchObject({ doctorId: D1, status: 'Yeni' });
  });

  it('Firestore\'un kabul etmediği yapılar: iç içe dizi sarılır, __x__/boş anahtar yeniden adlandırılır, __proto__ kirlenmez; hiçbiri kaybolmaz', async () => {
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText, execute: true, docs, ...base });
    const d3 = docs.store.get('labs/digicad/doctors/' + '1700000000003') as any;
    expect(d3.notesGrid).toEqual([{ _nestedArray: [1, 2] }, { _nestedArray: [3] }]);
    expect(d3.meta.deep[0].m).toEqual([{ _nestedArray: [1] }, { _nestedArray: [2, 3] }]);
    expect(Object.prototype.hasOwnProperty.call(d3, 'x__proto__')).toBe(true); expect(d3.x__proto__).toEqual({ polluted: true });
    expect(({} as any).polluted).toBeUndefined(); expect(d3['x(bos)']).toBe('bos-anahtar');
    expect((docs.store.get(`labs/digicad/doctors/${D1}`) as any).prices).toMatchObject({ 'Zirkonyum/Kuron': 10, 'E.max v1.2': 12.5, x__x__: 3, '$ #[x]': 1 });
    expect((docs.store.get('labs/digicad/jobs/1700000000100') as any).teethMap).toEqual([{ _nestedArray: [11, 12] }, { _nestedArray: [21] }]);
    expect(report.warnings.join('\n')).toContain('iç içe dizi'); expect((d3._legacy as any).nestedArrays.length).toBe(4);
  });

  it('sohbet: thread alanları (lastRead), dizi/nesne mesajlar, job_ konuşmaları, eksik timestamp türetilir', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    expect(docs.store.get(`labs/digicad/threads/dr_${D1}`)).toMatchObject({ id: `dr_${D1}`, lastRead: { admin: '2025-03-01T00:00:00.000Z' } });
    expect(docs.store.get(`labs/digicad/threads/dr_${D1}/messages/1700000000601`)).toMatchObject({ fileName: 'resim.png', senderId: 'admin' });
    expect(docs.store.get('labs/digicad/threads/tech_1/messages/1')).toMatchObject({ text: 'dizi biçimli mesaj' });
    const m = docs.store.get('labs/digicad/threads/job_1700000000100/messages/1700000000555')!;
    expect(m.text).toBe('zaman damgası yok'); expect(m.timestamp).toBe(new Date(1700000000555).toISOString()); expect((m._legacy as any).derivedTimestamp).toBe(true);
    expect(docs.store.get('labs/primer/threads/dr_1/messages/1700000000800')).toMatchObject({ text: 'p-mesaj' });
  });

  it('mailFilters: dizi ve nesne biçimi; ayarlar; primer çalışma alanı', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    expect(docs.store.get('labs/digicad/mailFilters/main')!.items).toEqual(['a@example.test', 'b@example.test']);
    const p = docs.store.get('labs/primer/mailFilters/main')!; expect(p.items).toEqual(['p@example.test', 'q@example.test']); expect((p._legacy as any).keys).toEqual(['-NaBcDeF', '-NaBcDeG']);
    expect(docs.store.get('labs/digicad/settings/main')).toMatchObject({ id: 'main', gipDirectMode: true, theme: { dark: false, colors: ['#fff', '#000'] } });
    expect(docs.store.get('labs/primer/jobs/1')).toMatchObject({ patient: 'Primer Hasta' });
  });

  it('değer muhasebesi: kaynaktaki her değer bir belgeye ya da listelenmiş atlamaya karşılık gelir', () => {
    const p = buildPlan(fake()); expect(p.leaf.total).toBe(p.leaf.accounted); expect(p.leaf.total).toBeGreaterThan(150);
  });
});

describe('doğrulama gerçekten kaybı yakalar (kendi kendini doğrulayan kontrol değil)', () => {
  class Mut extends MemoryDocSink { constructor(public f: (p: string, d: Doc) => Doc | null) { super(); } async set(p: string, d: Doc) { const x = this.f(p, structuredClone(d)); if (x) await super.set(p, x); } }
  it('belge hiç yazılmazsa: kayıp', async () => {
    const { report } = await run({ sourceText, execute: true, docs: new Mut((p, d) => (p.endsWith('payments/1') ? null : d)), ...base });
    expect(report.ok).toBe(false); expect(report.collections['digicad/payments'].missing).toEqual(['labs/digicad/payments/1']);
  });
  it('bir alan düşerse: farklı + (bağımsız) eksik alan', async () => {
    const { report } = await run({ sourceText, execute: true, docs: new Mut((p, d) => { if (p.endsWith('jobs/1700000000101')) delete d.patient; return d; }), ...base });
    expect(report.ok).toBe(false); expect(report.collections['digicad/jobs'].mismatched).toEqual(['labs/digicad/jobs/1700000000101']);
  });
  it('hash\'i değiştirmeden değer bozulursa da (iç içe) yakalanır', async () => {
    const { report } = await run({ sourceText, execute: true, docs: new Mut((p, d) => { if (p.endsWith('jobs/1700000000100')) (d.files as any)[0].name = 'başka'; return d; }), ...base });
    expect(report.ok).toBe(false); expect(report.totals.mismatched + report.totals.lost).toBeGreaterThan(0);
  });
  it('mesaj/thread/ayar kaybı yakalanır', async () => {
    const { report } = await run({ sourceText, execute: true, docs: new Mut((p, d) => (p.includes('threads/dr_' + D1 + '/messages/1700000000600') || p.endsWith('settings/main') ? null : d)), ...base });
    expect(report.totals.missing).toBe(2); expect(report.ok).toBe(false);
  });
  it('lostFields: sözlük dışı bir alan hedefte yoksa bildirir; gizli alan yokluğu kayıp sayılmaz', () => {
    const plan = buildPlan(fake()); const d = plan.docs.find((x) => x.path.endsWith(`doctors/${D1}`))!;
    expect(lostFields(fake(), d, d.data)).toEqual([]);
    const cut = { ...d.data }; delete cut.phone; expect(lostFields(fake(), d, cut)).toEqual(['phone: alan hedefte yok']);
    expect(lostFields(fake(), d, undefined)).toEqual(['belge hedefte yok']);
  });
});

describe('idempotentlik, yarıda kesilme, çakışma', () => {
  it('ikinci çalıştırma hiçbir şey yazmaz; sonuç aynı; hesaplar çoğalmaz', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink();
    const r1 = await run({ sourceText, execute: true, docs, auth, ...base }); const snap = canonical([...docs.store.entries()].sort());
    const w = docs.writes; const r2 = await run({ sourceText, execute: true, docs, auth, ...base });
    expect(docs.writes).toBe(w); expect(r2.report.totals.written).toBe(0); expect(r2.report.totals.unchanged).toBe(r1.report.totals.planned); expect(r2.report.ok).toBe(true);
    expect(canonical([...docs.store.entries()].sort())).toBe(snap); expect(r2.report.accounts.created).toBe(0);
  });
  it('yarıda kesilme: bazı yazımlar kalıcı hata verir -> başarısız rapor, diğerleri yazılır; yeniden çalıştırma kalanı tamamlar', async () => {
    const docs = new MemoryDocSink(); const orig = docs.set.bind(docs); let fail = true;
    docs.set = async (p, d) => { if (fail && /jobs\/17000000001/.test(p)) throw new Error('UNAVAILABLE'); return orig(p, d); };
    const r1 = await run({ sourceText, execute: true, docs, ...base, retries: 1 });
    expect(r1.report.ok).toBe(false); expect(r1.report.totals.writeErrors).toBe(3); expect(docs.store.size).toBeGreaterThan(30);
    fail = false; const before = docs.writes; const r2 = await run({ sourceText, execute: true, docs, ...base });
    expect(r2.report.ok).toBe(true); expect(docs.writes - before).toBe(3); expect(r2.report.totals.unchanged).toBe(r1.report.totals.planned - 3);
  });
  it('geçici hatalar yeniden denenir', async () => {
    const docs = new MemoryDocSink(); const orig = docs.set.bind(docs); const seen = new Set<string>();
    docs.set = async (p, d) => { if (!seen.has(p)) { seen.add(p); throw new Error('DEADLINE_EXCEEDED'); } return orig(p, d); };
    const { report } = await run({ sourceText, execute: true, docs, ...base }); expect(report.ok).toBe(true);
  });
  it('yazma 500\'lük gruplar yerine tek tek yapıldığı için 1500 kayıt sorunsuz (sınır yok)', async () => {
    const big = fake(); for (let i = 0; i < 1500; i++) big.db.digicad.expenses['e' + i] = { id: 'e' + i, amount: i };
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText: text(big), execute: true, docs, ...base, concurrency: 16 });
    expect(report.ok).toBe(true); expect(docs.store.size).toBe(report.totals.planned);
  });
  it('yeni sistemde oluşmuş (göç işaretsiz) belgenin üzerine YAZMAZ; çakışma raporlanır; bayrakla yazar ve eskisini yedekler', async () => {
    const docs = new MemoryDocSink(); await docs.set('labs/digicad/payments/2', { id: '2', amount: 999, createdBy: 'uid-yeni' });
    const r = await run({ sourceText, execute: true, docs, ...base });
    expect(r.report.ok).toBe(false); expect(r.report.totals.conflicts).toBe(1); expect(docs.store.get('labs/digicad/payments/2')!.amount).toBe(999);
    const saved: string[] = []; const r2 = await run({ sourceText, execute: true, docs, ...base, overwriteNewSystemDocs: true, onOverwrite: (p) => saved.push(p) });
    expect(r2.report.ok).toBe(true); expect(saved).toEqual(['labs/digicad/payments/2']); expect(docs.store.get('labs/digicad/payments/2')!.amount).toBe(0);
  });
  it('göç işaretli ama sonradan değişmiş belge ezilmeden önce yedeklenir', async () => {
    const docs = new MemoryDocSink(); await run({ sourceText, execute: true, docs, ...base });
    const cur = docs.store.get('labs/digicad/expenses/1700000000300')!; cur.amount = 1; const saved: Doc[] = [];
    const r = await run({ sourceText, execute: true, docs, ...base, onOverwrite: (_p, b) => saved.push(b) });
    expect(r.report.totals.overwritten).toBe(1); expect(saved[0].amount).toBe(1); expect(docs.store.get('labs/digicad/expenses/1700000000300')!.amount).toBe(55.25);
  });
  it('plan dışı belgeler silinmez/ezilmez; sayısı raporlanır', async () => {
    const docs = new MemoryDocSink(); await docs.set('labs/digicad/jobs/yeni-sistem-isi', { id: 'x', doctorId: '1', status: 'Bekliyor' });
    const { report } = await run({ sourceText, execute: true, docs, ...base });
    expect(docs.store.has('labs/digicad/jobs/yeni-sistem-isi')).toBe(true); expect(report.extraInTarget['labs/digicad/jobs']).toBe(1);
  });
});

describe('şema/yapı doğrulaması (hiçbir şey yazılmadan durur)', () => {
  const errs = async (mut: (x: any) => void, opts = {}) => { const b = fake(); mut(b); const docs = new MemoryDocSink(); const { report } = await run({ sourceText: text(b), execute: true, docs, ...base, plan: opts }); return { report, docs }; };
  it('geçersiz anahtar / kayıt nesne değil / skaler koleksiyon', async () => {
    const { report, docs } = await errs((b) => { b.db.digicad.jobs['a/b'] = { id: 1 }; b.db.digicad.payments[9] = 'metin'; b.db.digicad.sales = 'bozuk'; b.db.digicad.expenses['__x__'] = { id: 1 }; });
    expect(report.ok).toBe(false); expect(report.validationErrors.join('\n')).toMatch(/geçersiz belge kimliği[\s\S]*kayıt nesne değil[\s\S]*beklenmeyen tür/); expect(report.validationErrors.filter((e) => e.includes('geçersiz belge kimliği')).length).toBe(2); expect(docs.writes).toBe(0);
  });
  it('tanınmayan üst düzey anahtar hata; bilinçli yok sayma uyarı', async () => {
    const m = (b: any) => { b.db.digicad.bildirimler = { a: { x: 1 } }; b.araKayit = { z: 1 }; b.meta.baska = 5; };
    const r = await errs(m); expect(r.report.ok).toBe(false); expect(r.report.unmigrated.map((u) => u.path)).toEqual(expect.arrayContaining(['db/digicad/bildirimler', 'araKayit', 'meta/baska'])); expect(r.docs.writes).toBe(0);
    const r2 = await errs(m, { ignoreUnknown: true }); expect(r2.report.ok).toBe(true); expect(r2.report.warnings.join()).toContain('bildirimler');
  });
  it('güvenli olmayan büyük tam sayı, tek başına vekil karakter, 1 MiB aşan belge, çok derin nesne', async () => {
    const r = await errs((b) => { b.db.digicad.jobs['1700000000100'].big = 12345678901234567890; });
    expect(r.report.validationErrors.join()).toContain('güvenli tam sayı');
    const r1 = await errs((b) => { b.db.digicad.jobs['1700000000100'].s = 'a\uD800b'; }); expect(r1.report.validationErrors.join()).toContain('Unicode');
    const r2 = await errs((b) => { b.db.digicad.jobs['1700000000100'].blob = 'x'.repeat(1_100_000); }); expect(r2.report.validationErrors.join()).toContain('1 MiB');
    const r3 = await errs((b) => { let o: any = {}; const root = o; for (let i = 0; i < 25; i++) { o.n = {}; o = o.n; } b.db.digicad.jobs['1700000000100'].deep = root; }); expect(r3.report.validationErrors.join()).toContain('derinliği');
    expect(r.docs.writes + r1.docs.writes + r2.docs.writes + r3.docs.writes).toBe(0);
  });
  it('eski kök (db/doctors...) yalnızca digicad\'da OLMAYAN kayıt içerirse kayıp riski hatası; ekleme ve bilinçli yok sayma', async () => {
    const m = (b: any) => { b.db.doctors['999'] = { id: 999, name: 'Kök Yalnız' }; b.db.jobs['888'] = { id: 888, drId: 999, patient: 'Kök İş' }; b.db.chats = { dr_999: { messages: { 1: { id: 1, text: 'eski', timestamp: 't' } } } }; b.chats = { dr_1000: { messages: { 2: { id: 2, text: 'x', timestamp: 't' } } } }; };
    const r = await errs(m); expect(r.report.ok).toBe(false); expect(r.report.validationErrors.join('\n')).toMatch(/eski kök db\/doctors[\s\S]*eski kök db\/jobs[\s\S]*eski kök db\/chats/); expect(r.docs.writes).toBe(0);
    const r2 = await errs(m, { includeLegacyRoot: true });
    expect(r2.report.ok).toBe(true); expect(r2.docs.store.get('labs/digicad/doctors/999')).toMatchObject({ name: 'Kök Yalnız', _legacy: { workspace: 'root' } });
    expect(r2.docs.store.get('labs/digicad/jobs/888')).toMatchObject({ doctorId: '999' }); expect(r2.docs.store.get('labs/digicad/threads/dr_999/messages/1')!.text).toBe('eski'); expect(r2.docs.store.has('labs/digicad/threads/dr_1000/messages/2')).toBe(true);
    const r3 = await errs(m, { ignoreLegacyRoot: true }); expect(r3.report.ok).toBe(true); expect(r3.report.warnings.join()).toContain('YOK SAYILDI');
  });
  it('db/digicad hiç yoksa eski kök yapı digicad olarak taşınır (eski uygulamanın kendi göçü gibi)', async () => {
    const legacy = { db: { doctors: { 1: { id: 1, name: 'K', password: 'p' } }, jobs: { 5: { id: 5, drId: 1, patient: 'Z', status: 'Bekliyor' } }, pass: '1' }, meta: { migratedToWorkspaces: false } };
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText: text(legacy), execute: true, docs, ...base });
    expect(report.ok).toBe(true); expect(docs.store.get('labs/digicad/jobs/5')).toMatchObject({ patient: 'Z', doctorId: '1' }); expect(docs.store.get('labs/digicad/doctors/1')).not.toHaveProperty('password');
    const direct = { doctors: { 1: { id: 1, name: 'K' } }, jobs: [null, { id: 1, patient: 'D', status: 'Bekliyor' }] }; // db/digicad alt ağacı doğrudan dışa aktarılmış
    const d2 = new MemoryDocSink(); expect((await run({ sourceText: text(direct), execute: true, docs: d2, ...base })).report.ok).toBe(true); expect(d2.store.get('labs/digicad/jobs/1')).toMatchObject({ patient: 'D' });
  });
  it('tanınan çalışma alanı yok / geçersiz JSON / BOM', async () => {
    const { report } = await run({ sourceText: '{"x":1}', execute: false }); expect(report.ok).toBe(false);
    await expect(run({ sourceText: '{bozuk', execute: false })).rejects.toThrow(); expect((await run({ sourceText: '﻿' + sourceText, execute: false })).report.ok).toBe(true);
  });
  it('anahtar sırasından bağımsız kanonik karma', () => { expect(hashRecord({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRecord({ b: [1, { d: 3, c: 2 }], a: 1 })); });
});

describe('proje koruması (primer-dental yazma reddi atlatılamaz)', () => {
  const bad = ['primer-dental', 'PRIMER-DENTAL', ' Primer-Dental ', 'primer_dental', 'primerdental', 'primer-dental-2', 'my-primer-dental', 'ｐrimer-dental', 'Primer.Dental'];
  it.each(bad)('reddedilir: %s', (p) => { expect(isForbiddenProject(p)).toBe(true); expect(() => assertSafeTarget(p, {})).toThrow(/REDDEDİLDİ/); });
  it('run() eski projeye execute etmez ve hiçbir şey yazmaz', async () => {
    for (const p of bad) { const docs = new MemoryDocSink(); await expect(run({ sourceText, execute: true, docs, project: p, env: {} })).rejects.toThrow(); expect(docs.writes + docs.reads).toBe(0); }
    await expect(run({ sourceText, execute: true, docs: new MemoryDocSink(), env: {} })).rejects.toThrow(/zorunlu/);
  });
  it('ortam değişkenleri, FIREBASE_CONFIG ve servis hesabı anahtarı üzerinden atlatma reddedilir', () => {
    for (const k of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) expect(() => assertSafeTarget(P, { [k]: 'Primer-Dental' })).toThrow(/ortam değişkeni/);
    expect(() => assertSafeTarget(P, { FIREBASE_CONFIG: '{"projectId":"primer-dental"}' })).toThrow();
    const rf = (id: string) => () => JSON.stringify({ project_id: id });
    expect(() => assertSafeTarget(P, { GOOGLE_APPLICATION_CREDENTIALS: 'k.json' }, { readFile: rf('primer-dental') })).toThrow(/eski projeye ait/);
    expect(() => assertSafeTarget(P, { GOOGLE_APPLICATION_CREDENTIALS: 'k.json' }, { readFile: rf('baska-proje-123') })).toThrow(/aynı değil/);
    expect(assertSafeTarget(P.toUpperCase(), { GOOGLE_APPLICATION_CREDENTIALS: 'k.json' }, { readFile: rf(P) })).toBe(P);
  });
  it('emülatör değişkenleri varsa (sessiz yanlış hedef) reddedilir; geçersiz kimlik biçimi reddedilir', () => {
    expect(() => assertSafeTarget(P, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toThrow(/emülatör/); expect(assertSafeTarget(P, { FIRESTORE_EMULATOR_HOST: 'x' }, { allowEmulator: true })).toBe(P);
    for (const p of ['a', 'Yeni Proje', 'proje/x', '']) expect(() => assertSafeTarget(p, {})).toThrow();
  });
  it('CLI: eski proje, projesiz --execute ve girdisiz çağrı hiçbir şey yapmadan 3 döner', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['--input', FIXTURE, '--execute', '--project', 'PRIMER-DENTAL'])).toBe(3);
    expect(await main(['--input', FIXTURE, '--execute'])).toBe(3); expect(await main([])).toBe(3); expect(await main(['--bilinmeyen'])).toBe(3);
    spy.mockRestore(); log.mockRestore();
  });
  it('güvenlik sabiti kaynakta duruyor (silinemesin)', () => { expect(readFileSync(resolve(__dirname, '../src/guard.ts'), 'utf8')).toContain("'primer-dental'"); });
});

describe('Auth hesapları', () => {
  it('e-postasız / geçersiz / ortak e-posta hekimleri için hesap açılmaz; e-posta normalleştirilir; şifre güçlü ve benzersiz', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink(); const rows: string[][] = [];
    const { report } = await run({ sourceText, execute: true, docs, auth, ...base, onAccountRow: (r) => rows.push(r) });
    expect([...auth.users.keys()].sort()).toEqual(['bir@example.test', 'primerdr@example.test', 'teknisyen2@example.test']); // tek@example.test hem hekim hem teknisyen: açılmadı
    expect(report.accounts.skippedNoEmail.length).toBe(1); expect(report.accounts.invalidEmail.length).toBe(1); expect(report.accounts.duplicateEmails.length).toBe(2);
    expect(auth.users.get('bir@example.test')!.claims).toMatchObject({ role: 'doctor', doctorId: D1, lab: 'digicad', mustChangePassword: true });
    expect(auth.users.get('primerdr@example.test')!.claims).toMatchObject({ lab: 'primer' });
    expect(auth.users.get('teknisyen2@example.test')!.claims).toMatchObject({ role: 'tech', techId: '2' });
    const pws = rows.map((r) => r[5]); expect(new Set(pws).size).toBe(pws.length);
    for (const pw of pws) { expect(pw.length).toBeGreaterThanOrEqual(20); expect(pw).toMatch(/[a-z]/); expect(pw).toMatch(/[A-Z0-9]/); expect(pw).toMatch(/#/); expect(JSON.stringify(report)).not.toContain(pw); }
  });
  it('mevcut yönetici hesabı veya başka kayda bağlı hesap ezilmez', async () => {
    const auth = new MemoryAuthSink(); auth.users.set('bir@example.test', { uid: 'u-admin', claims: { role: 'admin', lab: 'digicad' } }); auth.users.set('teknisyen2@example.test', { uid: 'u2', claims: { role: 'tech', lab: 'digicad', techId: '99' } });
    const { report } = await run({ sourceText, execute: true, docs: new MemoryDocSink(), auth, ...base });
    expect(auth.users.get('bir@example.test')!.claims.role).toBe('admin'); expect(auth.users.get('teknisyen2@example.test')!.claims.techId).toBe('99'); expect(report.accounts.skippedExisting.length).toBe(2);
  });
  it('hesap oluşturma hatası veri göçünü ve diğer hesapları durdurmaz; şifreler anında yazılır', async () => {
    const auth = new MemoryAuthSink(); const orig = auth.ensureUser.bind(auth); auth.ensureUser = async (a, pw) => { if (a.email.startsWith('bir@')) throw new Error('auth/invalid-email'); return orig(a, pw); };
    const rows: string[][] = []; const { report } = await run({ sourceText, execute: true, docs: new MemoryDocSink(), auth, ...base, onAccountRow: (r) => rows.push(r) });
    expect(report.ok).toBe(true); expect(report.accounts.failed.length).toBe(1); expect(rows.length).toBe(2);
  });
  it('CSV: 0600, ekleme (asla ezme), formül enjeksiyonu önlemi; .gitignore *.csv ve out/input dizinlerini kapsar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goc-')); const f = join(dir, 'h.csv'); writeFileSync(f, '', { mode: 0o644 });
    secureAppend(f, 'a\n', 'H\n'); secureAppend(f, 'b\n', 'H\n');
    expect(readFileSync(f, 'utf8')).toBe('H\na\nb\n'); expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`); expect(csvCell('+90')).toBe(`"'+90"`);
    const gi = readFileSync(resolve(__dirname, '../../.gitignore'), 'utf8'); for (const p of ['*.csv', 'migration/out/', 'migration/input/']) expect(gi).toContain(p);
  });
});

describe('Storage dosyaları: manifest ve kopyalama', () => {
  it('kaynağın TAMAMINDAKİ Storage bağlantıları (iş, tasarım, gönderim, sohbet) token ile bulunur', () => {
    const refs = collectFileRefs(fake()); const objs = new Set(refs.map((r) => r.object));
    expect(objs).toEqual(new Set(['jobFiles/1700000000100/tarama.stl', 'jobFiles/1700000000100/tasarim.zip', 'jobFiles/1700000000200/a.png', `submissions/${D1}/scan.stl`, `chatFiles/digicad/dr_${D1}/1700000000601_resim.png`]));
    expect(refs.every((r) => r.bucket === 'primer-dental.appspot.com' && r.token)).toBe(true); expect(refs.find((r) => r.token === 'tok-5')!.sourcePath).toContain('chats');
  });
  it('manifest: yerel dosya eşleştirme, eksik ve kayıtsız dosyalar; kopyalama idempotent, çakışmada ezmez, URL eşlemesi token korur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gocst-')); const put = (rel: string, c: string) => { const p = join(dir, 'primer-dental.appspot.com', rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };
    put('jobFiles/1700000000100/tarama.stl', 'STL'); put('jobFiles/1700000000100/tasarim.zip', 'ZIP'); put('baska/kayitsiz.bin', 'X');
    const m = buildManifest(collectFileRefs(fake()), dir);
    expect(m).toMatchObject({ referenced: 5, foundLocally: 2, missingLocally: 3 }); expect(m.unreferencedLocal.length).toBe(1);
    expect(m.entries.find((e) => e.object.endsWith('tarama.stl'))!.local).toMatchObject({ size: 3, sha256: createHash('sha256').update('STL').digest('hex') });
    class Mem implements BucketSink { o = new Map<string, { md5: string; meta: any }>(); async head(n: string) { const x = this.o.get(n); return x && { md5: x.md5 }; } async upload(lp: string, n: string, meta: any) { this.o.set(n, { md5: createHash('md5').update(readFileSync(lp)).digest('base64'), meta }); } }
    const dry = await copyToBucket(m, 'yeni-bucket', 'labs/digicad/legacy', undefined, false); expect(dry.copied.length).toBe(2);
    const sink = new Mem(); const r = await copyToBucket(m, 'yeni-bucket', 'labs/digicad/legacy/', sink, true);
    expect(r.copied.length).toBe(2); expect(r.verified).toBe(2); expect(r.missingLocal.length).toBe(3); expect(sink.o.get('labs/digicad/legacy/jobFiles/1700000000100/tarama.stl')!.meta).toMatchObject({ token: 'tok-1', contentType: 'model/stl' });
    expect(r.urlMap[0].newUrl).toContain('/b/yeni-bucket/o/labs%2Fdigicad%2Flegacy%2FjobFiles') ; expect(r.urlMap[0].newUrl).toContain('token=tok-1');
    const r2 = await copyToBucket(m, 'yeni-bucket', 'labs/digicad/legacy', sink, true); expect(r2.copied.length).toBe(0); expect(r2.skippedSame.length).toBe(2);
    sink.o.get('labs/digicad/legacy/jobFiles/1700000000100/tasarim.zip')!.md5 = 'FARKLI'; const r3 = await copyToBucket(m, 'yeni-bucket', 'labs/digicad/legacy', sink, true);
    expect(r3.conflicts).toEqual(['labs/digicad/legacy/jobFiles/1700000000100/tasarim.zip']); expect(sink.o.get('labs/digicad/legacy/jobFiles/1700000000100/tasarim.zip')!.md5).toBe('FARKLI');
    const bad = new Mem(); bad.upload = async (lp, n) => { bad.o.set(n, { md5: 'BOZUK', meta: {} }); void lp; }; expect((await copyToBucket(m, 'yeni-bucket', 'p', bad, true)).failed.length).toBe(2);
  });
  it('CLI dry-run: yalnızca yerel rapor/manifest yazar, hesap CSV\'si yazmaz, çıkış 0', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gocout-')); const log = vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'table').mockImplementation(() => {});
    expect(await main(['--input', FIXTURE, '--out', out])).toBe(0);
    const files = readdirSync(out); expect(files.some((f) => f.startsWith('rapor-dry-run'))).toBe(true); expect(files).toContain('dosya-manifesti.json'); expect(files.some((f) => f.endsWith('.csv'))).toBe(false);
    expect(existsSync(join(out, 'hesaplar.csv'))).toBe(false); log.mockRestore(); vi.restoreAllMocks();
  });
  it('CLI: yapısal hata varsa çıkış 1', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gocout-')); const b = fake(); b.db.digicad.xyz = { a: 1 }; const f = join(out, 'in.json'); writeFileSync(f, text(b));
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'table').mockImplementation(() => {});
    expect(await main(['--input', f, '--out', out])).toBe(1); vi.restoreAllMocks();
  });
});

// DocSink arayüzünün derleme zamanı denetimi
void ({} as DocSink);
