import { describe, expect, it } from 'vitest';
import {
  toCents, fromCents, lineCents, qtyOf, jobCents, doctorTotals, planClosure, monthlyData, isoToLocalDate, todayLocal, incomeDate, statusPatch,
  approveCompletionPatch, rejectCompletionPatch, suggestTech, assignPatch, unassignPatch, autoTechOf, parseTeeth, formatTeeth, buildOrder, validateOrderLines,
  pendingToJob, matchDoctor, jobEditPatch, openDebt, sumExpenses, saleTotals, formNo, b64urlToText, mailContent, sanitizeFilter, gmailQuery, safeName, uniqueNames, jobInfoText, techIdsOf, withIds, zeroSums,
  type R, type OrderLine,
} from '../../src/admin/calc';

describe('para: kuruş yuvarlama', () => {
  it('float hataları yok', () => {
    expect(toCents(1.005)).toBe(101); expect(toCents(0.1 + 0.2)).toBe(30); expect(toCents('12,5')).toBe(1250); expect(toCents(-1.005)).toBe(-101);
    expect(toCents('abc')).toBe(0); expect(toCents(undefined)).toBe(0); expect(fromCents(1999)).toBe(19.99);
    expect(lineCents(0.1, 3)).toBe(30); expect(lineCents(19.99, 3)).toBe(5997); expect(lineCents(10.5, 0.1)).toBe(105);
  });
  it('qty kuralı eski sistemle aynı', () => {
    expect(qtyOf({})).toBe(1); expect(qtyOf({ qty: '' })).toBe(1); expect(qtyOf({ qty: 0 })).toBe(0); expect(qtyOf({ qty: '3' })).toBe(3);
    expect(jobCents({ price: 33.33, qty: 3 })).toBe(9999);
  });
  it('0.1 + 0.2 türü toplam kuruşta tam', () => {
    const jobs: R[] = [{ id: '1', doctorId: 'd', status: 'Tamamlandı', price: 0.1 }, { id: '2', doctorId: 'd', status: 'Tamamlandı', price: 0.2 }];
    expect(doctorTotals(jobs, [], 'd').charged.TRY).toBe(30);
  });
});

describe('bakiye ve çoklu para birimi', () => {
  const jobs: R[] = [
    { id: '1', drId: 'd1', status: 'Tamamlandı', price: 100, qty: 2 }, { id: '2', doctorId: 'd1', status: 'Tamamlandı', price: 50, currency: 'USD' },
    { id: '3', doctorId: 'd1', status: 'Üretimde', price: 999 }, { id: '4', doctorId: 'd1', status: 'Tamamlandı', price: 70, deleted: true }, { id: '5', doctorId: 'd2', status: 'Tamamlandı', price: 5 },
    { id: '6', doctorId: 'd1', status: 'Tamamlandı', price: 10, closureId: 'c0' },
  ];
  const pays: R[] = [{ id: 'p1', drId: 'd1', amount: 120.5 }, { id: 'p2', doctorId: 'd1', amount: 10, currency: 'USD', deleted: true }, { id: 'p3', doctorId: 'd1', amount: 3, closureId: 'c0' }];
  it('yalnızca tamamlanan, silinmeyen, açık dönem; para birimi ayrı', () => {
    const t = doctorTotals(jobs, pays, 'd1');
    expect(t.charged).toEqual({ TRY: 20000, USD: 5000, EUR: 0 }); expect(t.paid).toEqual({ TRY: 12050, USD: 0, EUR: 0 }); expect(t.balance.TRY).toBe(7950);
    expect(doctorTotals(jobs, pays, 'd1', true).charged.TRY).toBe(21000);
  });
  it('dönem kapatma: kayıtlar işaretlenir, bakiye devredilir, devreden satır aylık gelire girmez', () => {
    const plan = planClosure({ doctor: { id: 'd1', name: 'Dr A' }, jobs, pays, carry: true, closeDate: '2026-03-31', closureId: 'cl1', now: '2026-03-31T10:00:00Z' });
    expect(plan.jobIds.sort()).toEqual(['1', '2']); expect(plan.payIds).toEqual(['p1']);
    expect(plan.closure.balance).toEqual({ TRY: 79.5, USD: 50, EUR: 0 });
    expect(plan.carryJobs.map((j) => [j.currency, j.price])).toEqual([['TRY', 79.5], ['USD', 50]]);
    expect(plan.carryJobs[0]).toMatchObject({ isCarryForward: true, status: 'Tamamlandı', doctorId: 'd1' });
    const after = [...jobs.map((j) => (plan.jobIds.includes(j.id) ? { ...j, closureId: 'cl1' } : j)), ...plan.carryJobs];
    const afterPays = pays.map((p) => (plan.payIds.includes(p.id) ? { ...p, closureId: 'cl1' } : p));
    expect(doctorTotals(after, afterPays, 'd1').balance).toEqual({ TRY: 7950, USD: 5000, EUR: 0 }); // devir sonrası bakiye aynı
    expect(monthlyData('2026', 'TRY', after, [], []).reduce((a, m) => a + m.labIncome, 0)).toBe(0); // devreden satırlar ve tarihsiz işler gelire girmez
  });
  it('elle düzeltilmiş kapanış bakiyesi ve boş durum hatası', () => {
    const plan = planClosure({ doctor: { id: 'd1', name: 'x' }, jobs, pays, carry: false, closeDate: '2026-01-01', closureId: 'c', now: 'n', override: { TRY: 5000 } });
    expect(plan.closure.balanceManuallyEdited).toBe(true); expect(plan.closure.balance.TRY).toBe(50); expect(plan.carryJobs).toEqual([]);
    expect(() => planClosure({ doctor: { id: 'zz' }, jobs, pays, carry: true, closeDate: '2026-01-01', closureId: 'c', now: 'n' })).toThrow();
  });
});

describe('tarih / saat dilimi', () => {
  it('UTC gece yarısı sonrası Türkiye gününe çevrilir', () => {
    expect(isoToLocalDate('2026-11-30T22:30:00.000Z')).toBe('2026-12-01'); expect(isoToLocalDate('2026-11-30T20:59:00Z')).toBe('2026-11-30');
    expect(isoToLocalDate('2026-05-05')).toBe('2026-05-05'); expect(isoToLocalDate('saçma')).toBe(''); expect(isoToLocalDate(null)).toBe('');
    expect(todayLocal(new Date('2026-01-01T21:30:00Z'))).toBe('2026-01-02');
  });
  it('gelir tarihi: completedAt > dateout > id', () => {
    expect(incomeDate({ completedAt: '2026-11-30T22:30:00Z', dateout: '2026-01-01' })).toBe('2026-12-01'); expect(incomeDate({ dateout: '2026-02-03' })).toBe('2026-02-03');
    expect(incomeDate({ id: '1767225600000' })).toBe('2026-01-01'); expect(incomeDate({ id: 'abc' })).toBe('');
  });
});

describe('aylık rapor', () => {
  const jobs: R[] = [
    { id: 'a', status: 'Tamamlandı', price: 100, qty: 2, completedAt: '2026-11-30T22:30:00Z' }, { id: 'b', status: 'Tamamlandı', price: 0.1, dateout: '2026-12-10' }, { id: 'c', status: 'Tamamlandı', price: 0.2, dateout: '2026-12-11' },
    { id: 'd', status: 'Tamamlandı', price: 50, currency: 'USD', dateout: '2026-12-02' }, { id: 'e', status: 'Bekliyor', price: 500, dateout: '2026-12-02' }, { id: 'f', status: 'Tamamlandı', price: 9, dateout: '2026-12-02', deleted: true },
    { id: 'g', status: 'Tamamlandı', price: 77, dateout: '2026-12-02', isCarryForward: true },
  ];
  const sales: R[] = [{ date: '2026-12-05', total: 118, status: 'Tamamlandı' }, { date: '2026-12-05', total: 50, status: 'İptal' }];
  const exp: R[] = [{ date: '2026-12-03', amount: 10.1, category: 'Sabit' }, { date: '2026-12-04', amount: 20.2, category: 'Hizmet' }, { date: '2026-12-04', amount: 5, currency: 'USD' }];
  it('toplamlar kuruş doğruluğunda; kapsam: tamamlanan, silinmeyen, devir hariç, iptal satış hariç', () => {
    const r = monthlyData('2026', 'TRY', jobs, sales, exp, [{ date: '2026-12-09', amount: 40 }]);
    expect(r[11].labIncome).toBe(20000 + 30); // 'a' yerel Aralık 1: 2x100 TL + 0.1 + 0.2
    expect(r[10].labIncome).toBe(0);
    expect(r[11].salesIncome).toBe(11800); expect(r[11].fixedExp).toBe(1010); expect(r[11].serviceExp).toBe(2020); expect(r[11].totalExp).toBe(3030);
    expect(r[11].net).toBe(20030 + 11800 - 3030); expect(r[11].collected).toBe(4000); expect(r[11].jobCount).toBe(3);
    expect(monthlyData('2026', 'USD', jobs, sales, exp)[11]).toMatchObject({ labIncome: 5000, totalExp: 500 });
  });
});

describe('durum akışı', () => {
  const now = '2026-01-01T00:00:00Z';
  it('tamamlanınca completedAt, geri açılınca temizlenir', () => {
    expect(statusPatch({ status: 'Makyajda' }, 'Tamamlandı', now)).toMatchObject({ status: 'Tamamlandı', completedAt: now });
    expect(statusPatch({ status: 'Tamamlandı', completedAt: 'x' }, 'Üretimde', now)).toMatchObject({ status: 'Üretimde', completedAt: null });
    expect(statusPatch({ status: 'Bekliyor' }, 'Bekliyor', now)).toBeNull(); expect(() => statusPatch({ status: 'Bekliyor' }, 'Uçtu', now)).toThrow();
    expect(statusPatch({ status: 'Bekliyor' }, 'Tasarımda', now)).toEqual({ status: 'Tasarımda' });
  });
  it('kapatılmış dönemdeki iş geri açılamaz', () => { expect(() => statusPatch({ status: 'Tamamlandı', closureId: 'c' }, 'Üretimde', now)).toThrow(/kapat/); });
  it('tamamlama onayı yalnızca "Tamamlama Onayı"ndan; ret Makyajda\'ya döner', () => {
    expect(approveCompletionPatch({ status: 'Tamamlama Onayı' }, now)).toMatchObject({ status: 'Tamamlandı', completedAt: now });
    expect(() => approveCompletionPatch({ status: 'Tamamlandı' }, now)).toThrow(); expect(() => approveCompletionPatch({ status: 'Tamamlama Onayı', deleted: true }, now)).toThrow();
    expect(rejectCompletionPatch({ status: 'Tamamlama Onayı' }, ' eksik ', now)).toMatchObject({ status: 'Makyajda', completionRejectReason: 'eksik' });
    expect(rejectCompletionPatch({ status: 'Tamamlama Onayı' }, '', now).completionRejectReason).toBe('Yönetici reddetti'); expect(() => rejectCompletionPatch({ status: 'Bekliyor' }, 'x', now)).toThrow();
  });
});

describe('teknisyen ataması', () => {
  const techs: R[] = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }, { id: 't3', name: 'C', deleted: true }];
  const jobs: R[] = [{ techIds: ['t1'], status: 'Bekliyor' }, { techId: 't1', status: 'Üretimde' }, { techIds: ['t2'], status: 'Tamamlandı' }, { techIds: ['t2'], status: 'Bekliyor', deleted: true }];
  it('en az yüklü (tamamlanan/silinen sayılmaz)', () => { expect(suggestTech(techs, jobs)?.id).toBe('t2'); expect(suggestTech([], jobs)).toBeNull(); });
  it('atama yaması erişim alanlarını (techIds) içerir; durumu değiştirmez', () => {
    expect(assignPatch(techs[0], ' not ')).toEqual({ techId: 't1', techName: 'A', techIds: ['t1'], dispatchNote: 'not' }); expect(unassignPatch().techIds).toEqual([]);
  });
  it('otomatik teknisyen: silinmişse yok sayılır', () => {
    expect(autoTechOf({ autoTechId: 't1' }, techs)?.id).toBe('t1'); expect(autoTechOf({ autoTechId: 't3' }, techs)).toBeNull(); expect(autoTechOf({}, techs)).toBeNull();
    expect(techIdsOf({ techId: 5 })).toEqual(['5']); expect(withIds({ drId: 3, techId: 5 })).toMatchObject({ doctorId: '3', techIds: ['5'] });
  });
});

describe('dişler', () => {
  it('FDI ayrıştırma', () => {
    expect(parseTeeth('21, 11 11;99 x 48')).toEqual({ teeth: [11, 21, 48], rest: ['99', 'x'] }); expect(parseTeeth([36, '37'])).toEqual({ teeth: [36, 37], rest: [] });
    expect(formatTeeth(['12', 11])).toBe('11, 12'); expect(parseTeeth(null).teeth).toEqual([]);
  });
});

describe('sipariş', () => {
  let n = 0; const newId = () => `id${++n}`;
  const lines: OrderLine[] = [{ type: 'Zirkon Kron', qty: 3, price: 10.005, currency: 'TRY' }, { type: 'Köprü', qty: 1, price: 0, currency: 'USD' }];
  const base = { patient: 'Ali', teeth: [11, 12, 13], material: '', color: 'A2', dateout: '2026-02-01', notes: 'acil', files: [{ name: 'a.stl', path: 'p' }], sourceSubId: 's1', now: 'NOW', newId };
  it('otomatik teknisyen: onaysız iş + sipariş formu; erişim alanları ve dosyalar korunur', () => {
    n = 0; const r = buildOrder({ ...base, doctor: { id: 'd1', name: 'Dr' }, tech: { id: 't1', name: 'T' }, lines });
    expect(r.auto).toBe(true); expect(r.ops.map((o) => o.name)).toEqual(['jobs', 'orderForms', 'jobs', 'orderForms']);
    expect(r.records[0]).toMatchObject({ status: 'Bekliyor', doctorId: 'd1', techIds: ['t1'], files: base.files, price: 10.01, orderGroupTotal: 2, autoAssigned: true });
    expect(r.records[0].id).not.toBe(r.records[1].id); expect(r.records[0].note).toContain('DİŞLER: 11, 12, 13');
  });
  it('otomatik teknisyen yoksa Onay Bekliyor', () => {
    const r = buildOrder({ ...base, doctor: { id: 'd1', name: 'Dr' }, tech: null, lines: [lines[0]] });
    expect(r.auto).toBe(false); expect(r.ops[0].name).toBe('pendingJobs'); expect(r.records[0]).toMatchObject({ status: 'Onay Bekliyor', techIds: [], orderGroupId: null });
  });
  it('doğrulama', () => {
    expect(validateOrderLines([])).toBeTruthy(); expect(validateOrderLines([{ ...lines[0], qty: 0 }])).toBeTruthy(); expect(validateOrderLines([{ ...lines[0], qty: 1.5 }])).toBeTruthy();
    expect(validateOrderLines([{ ...lines[0], price: -1 }])).toBeTruthy(); expect(validateOrderLines(lines)).toBeNull();
  });
  it('onay bekleyen → iş: hekim şart, hekim tasarımlıysa Üretimde', () => {
    const p: R = { id: 'p1', drName: 'Dr Ali', patient: 'x', type: 'Kron', price: 5, qty: 2, techId: 't1', techName: 'T', files: [1] };
    expect(() => pendingToJob(p, undefined, 'N')).toThrow(/Hekim/);
    expect(pendingToJob(p, { id: 'd1', name: 'Dr Ali' }, 'N')).toMatchObject({ id: 'p1', status: 'Bekliyor', doctorId: 'd1', techIds: ['t1'], files: [1], approvedFrom: 'pendingJobs' });
    expect(pendingToJob({ ...p, designSource: 'doctor' }, { id: 'd1', name: 'x' }, 'N').status).toBe('Üretimde');
    const docs: R[] = [{ id: 'd1', name: 'DR  ali' }, { id: 'd2', name: 'Dr İlker' }, { id: 'd3', name: 'dr ilker' }];
    expect(matchDoctor({ drName: 'DR ali' }, [{ id: 'd1', name: 'dr ali' }])?.id).toBe('d1');
    expect(matchDoctor({ drName: 'dr ilker' }, docs)).toBeUndefined(); expect(matchDoctor({ drId: 'd2' }, docs)?.id).toBe('d2');
  });
});

describe('satışlar (eski sales şeması)', () => {
  it('KDV ve toplam kuruş doğrulukta', () => {
    expect(saleTotals([{ name: 'a', qty: 3, unit: 'Adet', price: 0.1 }], 20)).toEqual({ subtotal: 0.3, vatAmt: 0.06, total: 0.36 });
    expect(saleTotals([{ name: 'a', qty: 1.5, unit: 'Kg', price: 19.99 }, { name: 'b', qty: 2, unit: 'Adet', price: 5 }], 18)).toEqual({ subtotal: 39.99, vatAmt: 7.2, total: 47.19 });
    expect(saleTotals([], 20).total).toBe(0); expect(saleTotals([{ name: 'a', qty: 1, unit: 'Adet', price: 10 }], NaN).total).toBe(10);
    expect(formNo(new Date('2026-03-04T10:00:00Z'), 123)).toBe('PT-20260304-123');
  });
});

describe('mail', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  it('Türkçe karakterli gövde ve ekler çözülür', () => {
    expect(b64urlToText(b64('Şükrü İğdır çğ'))).toBe('Şükrü İğdır çğ');
    const c = mailContent({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Merhaba ğ') } }, { mimeType: 'text/html', body: { data: b64('<b>x</b>') } }] }, { mimeType: 'application/pdf', filename: 'f.pdf', body: { attachmentId: 'A1' } }] });
    expect(c.text).toBe('Merhaba ğ'); expect(c.attachments).toEqual([{ filename: 'f.pdf', mimeType: 'application/pdf', attachmentId: 'A1' }]);
    expect(mailContent({ mimeType: 'text/html', body: { data: b64('<style>a{}</style><p>Selam&nbsp;<b>dünya</b></p><script>x()</script>') } }).text).toBe('Selam dünya');
    expect(mailContent(undefined).text).toBe('');
  });
  it('filtre doğrulama ve sorgu enjeksiyonu', () => {
    expect(sanitizeFilter(' Dr@Klinik.COM ')).toBe('dr@klinik.com'); expect(sanitizeFilter('@klinik.com')).toBe('@klinik.com');
    for (const bad of ['', 'abc', 'a b@c.com', 'x@y.com OR from:z', 'a@b', '"a"@b.com', '-in:spam a@b.com']) expect(sanitizeFilter(bad)).toBeNull();
    expect(gmailQuery(['a@b.com', '@k.com'])).toBe('from:a@b.com OR from:k.com'); expect(gmailQuery([])).toBe('in:inbox');
  });
});

describe('ZIP yardımcıları', () => {
  it('dosya adı temizliği ve çakışma', () => {
    expect(safeName('../a/b:c?.stl')).toBe('__a_b_c_.stl'); expect(safeName('')).toBe('dosya'); expect(safeName('x'.repeat(200)).length).toBe(80);
    expect(uniqueNames(['a.stl', 'A.stl', 'b', 'b', 'a.stl'])).toEqual(['a.stl', 'A (2).stl', 'b', 'b (2)', 'a (3).stl']);
  });
  it('iş bilgisi metni', () => {
    const t = jobInfoText({ drName: 'Dr', patient: 'P', type: 'Kron', toothColor: 'A2', status: 'Bekliyor', orderForm: { teeth: [11, 12] }, files: [{ name: 'a.stl' }] });
    expect(t).toContain('Dişler        : 11, 12'); expect(t).toContain('1. a.stl'); expect(jobInfoText({ designFiles: [{ name: 'd.stl' }] }, 'design')).toContain('1. d.stl');
    expect(zeroSums()).toEqual({ TRY: 0, USD: 0, EUR: 0 });
  });
});

describe('iş düzenleme', () => {
  const dr = { id: 'd1', name: 'Dr A' }; const t1 = { id: 't1', name: 'T' };
  const job: R = { id: 'j', doctorId: 'd1', patient: 'x', type: 'Kron', qty: 2, price: 10, currency: 'TRY', status: 'Bekliyor', techIds: [] };
  const form = { doctor: dr, patient: ' Ali ', type: 'Kron', qty: 2, price: 10.005, currency: 'TRY' as const, dateout: '2026-01-01', color: 'A2', note: '', tech: null as R | null, status: 'Bekliyor' };
  it('alanlar temizlenir, kuruş yuvarlanır, atama ve durum birleşir', () => {
    const p = jobEditPatch(job, { ...form, tech: t1, status: 'Tamamlandı' }, 'N');
    expect(p).toMatchObject({ patient: 'Ali', price: 10.01, doctorId: 'd1', techIds: ['t1'], status: 'Tamamlandı', completedAt: 'N' });
    expect(jobEditPatch({ ...job, techIds: ['t1'] }, form, 'N').techIds).toEqual([]);
  });
  it('doğrulama ve kapalı dönem koruması', () => {
    expect(() => jobEditPatch(job, { ...form, patient: ' ' }, 'N')).toThrow(); expect(() => jobEditPatch(job, { ...form, price: -1 }, 'N')).toThrow();
    const closed = { ...job, status: 'Tamamlandı', closureId: 'c' };
    expect(() => jobEditPatch(closed, { ...form, price: 99, status: 'Tamamlandı' }, 'N')).toThrow(/kapat/);
    expect(jobEditPatch(closed, { ...form, price: 10, status: 'Tamamlandı', note: 'n' }, 'N').note).toBe('n');
  });
});

describe('genel borç / gider özeti', () => {
  it('kapalı dönem hariç, para birimi ayrı', () => {
    const jobs: R[] = [{ status: 'Tamamlandı', price: 10.1 }, { status: 'Tamamlandı', price: 5, closureId: 'c' }, { status: 'Tamamlandı', price: 3, currency: 'EUR', qty: 2 }, { status: 'Bekliyor', price: 99 }];
    expect(openDebt(jobs, [{ amount: 0.1 }, { amount: 9, closureId: 'c' }, { amount: 1, deleted: true }])).toEqual({ TRY: 1000, USD: 0, EUR: 600 });
    expect(sumExpenses([{ amount: 1.1, date: '2026-01-02' }, { amount: 2.2, date: '2026-02-01' }, { amount: 4, deleted: true, date: '2026-01-05' }], (e) => String(e.date).startsWith('2026-01')).TRY).toBe(110);
  });
});
