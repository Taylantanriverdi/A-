import { describe, expect, it } from 'vitest';
import { run } from '../src/runner';
import { MemoryAuthSink, MemoryDocSink } from '../src/sinks';
import { hashRecord, canonical } from '../src/canonical';

// Tamamen UYDURMA örnek veri (gerçek kayıt değildir).
const fake = () => ({
  db: { digicad: {
    doctors: { 1: { id: 1, name: 'Dr. Deneme Bir', email: 'bir@example.test', password: '1234', phone: '000', autoTechId: 7 }, 2: { id: 2, name: 'Dr. Deneme İki', pin: '9999', ozelAlan: { a: [1, 2, { b: 'c' }] } } },
    technicians: [null, { id: 1, name: 'Tek Bir', email: 'tek@example.test', type: 'ic', password: 'x' }],
    jobs: { 100: { id: 100, drId: 1, drName: 'Dr. Deneme Bir', techId: 7, patient: 'Örnek Hasta', status: 'Bekliyor', price: 10.5, qty: 2, bilinmeyenAlan: 'korunmalı', files: [{ name: "x');alert(1)//", url: 'https://example.test/f' }] }, 101: { id: 101, drId: 2, patient: 'Hasta İki', status: 'Tamamlandı', techId: null } },
    payments: { 5: { id: 5, drId: 1, amount: 100, date: '2025-01-01' } },
    pendingJobs: {}, expenses: { 9: { id: 9, amount: 5, title: 'gider' } }, sales: {}, orderForms: { 100: { id: 100, drId: 1 } }, doctorSubmissions: { s1: { id: 's1', drId: 1, status: 'Yeni', patient: 'P' } }, statementClosures: {},
    settings: { gipDirectMode: true }, mailFilters: ['a@example.test', 'b@example.test'], pass: '0000',
    chats: { dr_1: { messages: { 111: { id: 111, text: 'merhaba', senderRole: 'doctor' } } } },
  }, primer: { jobs: { 1: { id: 1, drId: 3, patient: 'Primer Hasta' } } } },
  meta: { pass: 'gizli' },
});
const text = () => JSON.stringify(fake());

describe('göç: dry-run', () => {
  it('hiçbir şey yazmaz ve hedefe dokunmaz', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink();
    const { report } = await run({ sourceText: text(), execute: false, docs, auth });
    expect(docs.writes).toBe(0); expect(docs.store.size).toBe(0); expect(auth.creates).toBe(0);
    expect(report.mode).toBe('dry-run'); expect(report.totals.planned).toBeGreaterThan(10); expect(report.ok).toBe(true);
  });
  it('kaynak SHA-256 raporlanır', async () => {
    const { report } = await run({ sourceText: text(), execute: false });
    expect(report.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('göç: kayıpsızlık', () => {
  it('tüm kayıtlar yazılır ve hash doğrulanır; gizli alanlar taşınmaz; bilinmeyen alanlar korunur', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink(); let csv: string[][] = [];
    const { report } = await run({ sourceText: text(), execute: true, docs, auth, accountsCsv: (r) => { csv = r; } });
    expect(report.ok).toBe(true); expect(report.totals.missing).toBe(0); expect(report.totals.mismatched).toBe(0); expect(report.totals.verifiedOk).toBe(report.totals.planned);
    const job = docs.store.get('labs/digicad/jobs/100')!;
    expect(job.bilinmeyenAlan).toBe('korunmalı'); expect(job.doctorId).toBe('1'); expect(job.techIds).toEqual(['7']); expect(job.drId).toBe(1); expect(job.price).toBe(10.5);
    expect((job.files as { name: string }[])[0].name).toBe("x');alert(1)//");
    expect(docs.store.get('labs/digicad/jobs/101')!.techIds).toEqual([]);
    expect(docs.store.get('labs/digicad/doctors/1')).not.toHaveProperty('password'); expect(docs.store.get('labs/digicad/doctors/2')).not.toHaveProperty('pin');
    expect(docs.store.get('labs/digicad/doctors/2')!.ozelAlan).toEqual({ a: [1, 2, { b: 'c' }] });
    expect(docs.store.get('labs/primer/jobs/1')!.patient).toBe('Primer Hasta');
    expect(docs.store.get('labs/digicad/threads/dr_1/messages/111')!.text).toBe('merhaba');
    expect(docs.store.get('labs/digicad/mailFilters/main')!.items).toEqual(['a@example.test', 'b@example.test']);
    expect(docs.store.get('labs/digicad/technicians/1')!.name).toBe('Tek Bir'); // dizi biçimli RTDB düğümü
    expect(report.strippedSecretFields).toBe(3); expect(JSON.stringify([...docs.store.values()])).not.toContain('gizli');
    expect(report.skipped.some((s) => s.what.includes('pass'))).toBe(true);
    expect(auth.creates).toBe(2); expect(csv.length).toBe(3); expect(auth.users.get('bir@example.test')!.claims).toMatchObject({ role: 'doctor', doctorId: '1', lab: 'digicad', mustChangePassword: true });
    expect(report.accounts.skippedNoEmail.length).toBe(1);
  });
  it('kaynak kayıt sayısı = hedef kayıt sayısı', async () => {
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText: text(), execute: true, docs });
    for (const k of ['digicad/doctors', 'digicad/jobs', 'digicad/payments', 'digicad/technicians', 'digicad/doctorSubmissions', 'primer/jobs']) { expect(report.collections[k].sourceCount).toBe(report.collections[k].planned); }
    expect(report.collections['digicad/doctors'].sourceCount).toBe(2);
  });
  it('hedefteki tek bir kayıp/bozulma raporda yakalanır (başarısız)', async () => {
    class Lossy extends MemoryDocSink { async set(p: string, d: Record<string, unknown>) { if (p.endsWith('payments/5')) return; if (p.endsWith('jobs/101')) d = { ...d, patient: 'DEĞİŞTİ' }; await super.set(p, d); } }
    const { report } = await run({ sourceText: text(), execute: true, docs: new Lossy() });
    expect(report.ok).toBe(false); expect(report.collections['digicad/payments'].missing).toEqual(['labs/digicad/payments/5']); expect(report.collections['digicad/jobs'].mismatched).toEqual(['labs/digicad/jobs/101']);
  });
});

describe('göç: idempotentlik', () => {
  it('ikinci çalıştırma hiçbir şey yazmaz, aynı sonucu verir, hesapları çoğaltmaz', async () => {
    const docs = new MemoryDocSink(); const auth = new MemoryAuthSink();
    const r1 = await run({ sourceText: text(), execute: true, docs, auth }); const snapshot = canonical([...docs.store.entries()].sort());
    const w = docs.writes; const r2 = await run({ sourceText: text(), execute: true, docs, auth });
    expect(docs.writes).toBe(w); expect(r2.report.totals.written).toBe(0); expect(r2.report.totals.unchanged).toBe(r1.report.totals.planned); expect(r2.report.ok).toBe(true);
    expect(canonical([...docs.store.entries()].sort())).toBe(snapshot); expect(auth.creates).toBe(2); expect(r2.report.accounts.created).toBe(0);
  });
});

describe('göç: şema doğrulama', () => {
  it('bozuk kayıt hata verir ve hiçbir şey yazmaz', async () => {
    const bad = fake() as any; bad.db.digicad.jobs['a/b'] = { id: 1 }; bad.db.digicad.payments[6] = 'metin';
    const docs = new MemoryDocSink(); const { report } = await run({ sourceText: JSON.stringify(bad), execute: true, docs });
    expect(report.ok).toBe(false); expect(report.validationErrors.length).toBeGreaterThanOrEqual(2); expect(docs.writes).toBe(0);
  });
  it('iç içe dizi (Firestore desteklemez) hata olarak bildirilir', async () => {
    const bad = fake() as any; bad.db.digicad.jobs[100].m = [[1, 2]];
    const { report } = await run({ sourceText: JSON.stringify(bad), execute: false });
    expect(report.validationErrors.join()).toContain('İç içe dizi');
  });
  it('geçersiz JSON ve tanınmayan yapı', async () => {
    await expect(run({ sourceText: '{bozuk', execute: false })).rejects.toThrow();
    const { report } = await run({ sourceText: '{"x":1}', execute: false }); expect(report.ok).toBe(false);
  });
  it('kanonik hash anahtar sırasından bağımsız', () => { expect(hashRecord({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRecord({ b: [1, { d: 3, c: 2 }], a: 1 })); });
});
