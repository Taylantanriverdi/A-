// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  put: vi.fn(async () => undefined), patch: vi.fn(async () => undefined), softDelete: vi.fn(async () => undefined), restore: vi.fn(async () => undefined),
  createOrder: vi.fn(async () => undefined), approvePending: vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); }), transition: vi.fn(async () => undefined), mutateJob: vi.fn(async () => ({})),
  callFn: vi.fn(async () => ({ copied: 1, failed: 0 })), closeStatement: vi.fn(async () => undefined), undoClosure: vi.fn(async () => undefined), hideMessage: vi.fn(async () => undefined), postMessage: vi.fn(async () => undefined), stopMsgs: vi.fn(), msgCb: null as null | ((r: unknown[]) => void),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {}, callFn: m.callFn }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn(async () => 'https://x/y') }));
vi.mock('../../src/lib/store', async () => { let n = 0; return { put: m.put, patch: m.patch, softDelete: m.softDelete, restore: m.restore, newId: () => `id${++n}`, listen: () => () => undefined, colPath: (l: string, c: string) => `labs/${l}/${c}` }; });
vi.mock('../../src/admin/data', () => ({ createOrder: m.createOrder, approvePending: m.approvePending, transition: m.transition, mutateJob: m.mutateJob, closeStatement: m.closeStatement, undoClosure: m.undoClosure, hideMessage: m.hideMessage, postMessage: m.postMessage,
  watchMessages: (_s: unknown, _t: string, cb: (r: unknown[]) => void) => { m.msgCb = cb; return m.stopMsgs; }, jobHistory: async () => [], setDoctorPrices: vi.fn(), setJobFiles: vi.fn(), addMailFilter: vi.fn(), removeMailFilter: vi.fn() }));

import * as P1 from '../../src/admin/pages1';
import * as P2 from '../../src/admin/pages2';
import * as P3 from '../../src/admin/pages3';
import { emptyState } from '../../src/admin/state';
import type { Ctx } from '../../src/admin/pages1';

const XSS = '<img src=x onerror=alert(1)>';
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
function ctx(over: Record<string, unknown[]> = {}, extra: Partial<Ctx> = {}): Ctx & { disposers: (() => void)[] } {
  const st = { ...emptyState(), ...over } as Ctx['st']; const disposers: (() => void)[] = [];
  return { s: { user: { uid: 'u1' }, role: 'admin', lab: 'digicad' } as never, st, rerender: vi.fn(), go: vi.fn(), own: (f) => disposers.push(f), onData: vi.fn(), ps: {}, disposers, ...extra };
}
const show = (el: HTMLElement) => { document.body.replaceChildren(el); return el; };
const btnByText = (root: ParentNode, t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
beforeEach(() => { Object.values(m).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as ReturnType<typeof vi.fn>).mockClear()); m.msgCb = null; document.body.replaceChildren(); });

const doctors = [{ id: 'd1', name: `Dr ${XSS}`, autoTechId: 't1', prices: [{ id: '1', name: 'Kron', price: 100, currency: 'TRY' }] }, { id: 'd2', name: 'Dr B' }];
const techs = [{ id: 't1', name: 'Tek A' }];
const jobs = [
  { id: 'j1', drId: 'd1', doctorId: 'd1', drName: XSS, patient: XSS, type: 'Kron', qty: 2, price: 10.5, status: 'Tamamlandı', completedAt: '2026-02-01T10:00:00Z', techIds: ['t1'], files: [{ name: `x');alert(1)//`, path: 'p/x' }, { name: 'eski', url: 'javascript:alert(1)' }] },
  { id: 'j2', doctorId: 'd1', patient: 'Bekleyen', type: 'Köprü', status: 'Tamamlama Onayı', price: 5, techIds: [], dateout: '2020-01-01' },
];

describe('admin sayfaları: güvenli çizim ve duman testi', () => {
  it('tüm sayfalar çizilir, XSS içerikli veri metin olarak kalır, javascript: bağlantısı çalıştırılmaz', () => {
    const c = ctx({ doctors, technicians: techs, jobs, payments: [{ id: 'p1', doctorId: 'd1', amount: 20, date: '2026-02-02', drName: XSS }], expenses: [{ id: 'e1', date: '2026-02-03', amount: 7, title: XSS, category: 'Sabit' }], sales: [{ id: 's1', customer: XSS, items: [{ name: XSS, qty: 1, price: 1 }], total: 1, date: '2026-02-01' }],
      pendingJobs: [{ id: 'p1', status: 'Onay Bekliyor', drName: XSS, patient: 'x', type: 'K' }], doctorSubmissions: [{ id: 's1', status: 'Yeni', patient: XSS, doctorId: 'd1' }], statementClosures: [], mailFilters: [{ id: 'main', items: ['a@b.com'] }] });
    const pages: Record<string, () => HTMLElement> = { dash: () => P1.dash(c), order: () => P1.order(c), subs: () => P1.doctorsubs(c), pending: () => P1.pending(c), dispatch: () => P1.dispatch(c), jobs: () => P1.jobsPage(c, false), done: () => P1.jobsPage(c, true), files: () => P1.files(c),
      doctors: () => P2.doctors(c), techs: () => P2.techs(c), expenses: () => P2.expenses(c), archive: () => P2.archive(c), monthly: () => P2.monthly(c), trash: () => P2.trash(c), settings: () => P2.settings(c), chat: () => P2.chat(c), sales: () => P3.sales(c), mail: () => P3.mail(c, vi.fn()) };
    for (const [name, fn] of Object.entries(pages)) { const el = show(fn()); expect(el.querySelector('img'), name).toBeNull(); expect(el.querySelector('script'), name).toBeNull(); expect(el.querySelector('[onerror],[onclick]'), name).toBeNull(); }
    show(P1.files(c)); const a = [...document.querySelectorAll('a')].find((x) => x.textContent?.includes('eski'))!; expect(a.getAttribute('href')).toBe('#');
  });
  it('sayfa verisiz da çökmez', () => { const c = ctx(); for (const f of [P1.dash, P1.order, P1.doctorsubs, P1.pending, P1.dispatch, P1.files, P2.archive, P2.monthly, P2.trash, P2.expenses, P3.sales]) expect(() => f(c)).not.toThrow(); });
});

describe('çift tıklama / yarış koruması', () => {
  it('Onayla düğmesi çift tıklanınca approvePending bir kez çağrılır', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = ctx({ doctors, pendingJobs: [{ id: 'p1', status: 'Onay Bekliyor', drName: 'Dr B', patient: 'x', type: 'K' }] }); const el = show(P1.pending(c)); const b = btnByText(el, 'Onayla'); b.click(); b.click(); await flush();
    expect(m.approvePending).toHaveBeenCalledTimes(1); expect(b.disabled).toBe(false);
  });
  it('Sipariş kaydı çift tıklamada bir kez yazılır; otomatik teknisyen → jobs, dosyalar korunur', async () => {
    const c = ctx({ doctors, technicians: techs }, { prefill: { id: 'sub1', drId: 'd1', patient: 'Ali', jobType: 'Kron', teeth: ['11', '12'], files: [{ name: 'a.stl', path: 'p' }] } as never });
    const el = show(P1.order(c)); const b = btnByText(el, 'Siparişi kaydet'); b.click(); b.click(); await flush();
    expect(m.createOrder).toHaveBeenCalledTimes(1); const [, ops, sub] = m.createOrder.mock.calls[0] as unknown as [unknown, { name: string; data: Record<string, unknown> }[], string];
    expect(sub).toBe('sub1'); expect(ops[0].name).toBe('jobs'); expect(ops[0].data).toMatchObject({ techIds: ['t1'], files: [{ name: 'a.stl', path: 'p' }], qty: 2, price: 100 }); // diş sayısı adet, hekim fiyat listesi
  });
  it('hekim seçilmeden/kalem hatasında yazım yapılmaz ve düğme tekrar açılır', async () => {
    const c = ctx({ doctors }); const el = show(P1.order(c)); const b = btnByText(el, 'Siparişi kaydet'); b.click(); await flush(); expect(m.createOrder).not.toHaveBeenCalled(); expect(b.disabled).toBe(false);
  });
  it('Tamamlama onayı: onayla/reddet transaction fonksiyonuna gider', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'prompt').mockReturnValue('eksik');
    const c = ctx({ doctors, jobs }); c.ps.pending = { tab: 'completion' }; const el = show(P1.pending(c)); btnByText(el, 'Onayla').click(); btnByText(el, 'Reddet').click(); await flush(); expect(m.mutateJob).toHaveBeenCalledTimes(2);
  });
  it('dönem kapatma onaylanınca planlı kayıt yazılır', async () => {
    const c = ctx({ doctors, jobs, payments: [{ id: 'p1', doctorId: 'd1', amount: 5 }] }); show(P2.archive(c)); btnByText(document.body, 'Dönemi kapat').click(); btnByText(document.querySelector('.modal-back') as HTMLElement, 'Dönemi kapat').click(); await flush();
    expect(m.closeStatement).toHaveBeenCalledTimes(1); const plan = (m.closeStatement.mock.calls[0] as unknown as [unknown, { jobIds: string[]; carryJobs: unknown[] }])[1]; expect(plan.jobIds).toEqual(['j1']); expect(plan.carryJobs.length).toBe(1);
  });
});

describe('sohbet', () => {
  it('dinleyici sayfadan çıkınca kapatılır; mesaj metin olarak çizilir; ek yalnızca görsel/PDF', async () => {
    const c = ctx({ doctors }); const el = show(P2.chat(c)); btnByText(el, 'Hekim').click();
    m.msgCb!([{ id: 'm1', text: XSS, senderRole: 'doctor', timestamp: '2026-01-01T00:00:00Z' }, { id: 'm2', text: 'gizli', deletedAt: 'x' }]);
    expect(el.querySelector('img')).toBeNull(); expect(el.textContent).toContain(XSS); expect(el.textContent).not.toContain('gizli');
    const file = el.querySelector('input[type=file]') as HTMLInputElement; Object.defineProperty(file, 'files', { value: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })] });
    btnByText(el, 'Gönder').click(); await flush(); expect(m.postMessage).not.toHaveBeenCalled();
    c.disposers.forEach((d) => d()); expect(m.stopMsgs).toHaveBeenCalled();
  });
  it('mesaj gönderme: metin boşsa gönderilmez, doluysa bir kez', async () => {
    const c = ctx({ doctors }); const el = show(P2.chat(c)); btnByText(el, 'Hekim').click(); const inp = el.querySelector('input[type=text]') as HTMLInputElement; btnByText(el, 'Gönder').click(); await flush(); expect(m.postMessage).not.toHaveBeenCalled();
    inp.value = 'merhaba'; const b = btnByText(el, 'Gönder'); b.click(); b.click(); await flush(); expect(m.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('satışlar', () => {
  it('eski sales şemasıyla kaydeder: kalemler, KDV, toplam kuruş doğrulukta', async () => {
    const c = ctx(); const el = show(P3.sales(c)); btnByText(el, 'Yeni form').click(); const mod = document.querySelector('.modal-back') as HTMLElement;
    (mod.querySelector('input[name=customer]') as HTMLInputElement).value = 'Klinik X'; const nm = mod.querySelector('input[placeholder^="Ürün"]') as HTMLInputElement; nm.value = 'Maske'; nm.dispatchEvent(new Event('input'));
    const [qty, price] = [...mod.querySelectorAll('input[type=number]')].filter((x) => (x as HTMLInputElement).getAttribute('aria-label')) as HTMLInputElement[]; qty.value = '3'; qty.dispatchEvent(new Event('input')); price.value = '0.1'; price.dispatchEvent(new Event('input'));
    btnByText(mod, 'Kaydet').click(); await flush(); expect(m.put).toHaveBeenCalledTimes(1); const [, coll, , data, isNew] = m.put.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>, boolean];
    expect(coll).toBe('sales'); expect(isNew).toBe(true); expect(data).toMatchObject({ customer: 'Klinik X', subtotal: 0.3, vatAmt: 0.06, total: 0.36, vat: 20, currency: 'TRY', status: 'Beklemede' }); expect(String(data.formNo)).toMatch(/^PT-\d{8}-\d{3}$/);
  });
  it('müşterisiz form kaydedilmez', async () => { const c = ctx(); show(P3.sales(c)); btnByText(document.body, 'Yeni form').click(); btnByText(document.querySelector('.modal-back') as HTMLElement, 'Kaydet').click(); await flush(); expect(m.put).not.toHaveBeenCalled(); });
});

import { readFileSync } from 'node:fs';
import { buildPlan } from '../../migration/src/transform';

describe('göçle gelen belgeler (_legacy, {_nestedArray}, x-önekli alanlar, bilinmeyen durum)', () => {
  const root = JSON.parse(readFileSync('migration/test/fixtures/rtdb-export.fake.json', 'utf8'));
  const plan = buildPlan(root, { ignoreUnknown: true, includeLegacyRoot: true, ignoreLegacyRoot: true });
  const migrated = (id: string): Record<string, unknown> => ({ ...(plan.docs.find((d) => d.path === `labs/digicad/jobs/${id}`)!.data), id });
  const upd = (cur: Record<string, unknown>, patch: Record<string, unknown>) => ({ ...cur, ...patch }); // updateDoc: yalnızca verilen alanlar değişir, diğerleri korunur

  it('fixture içinde göçün ürettiği özel alanlar var (test anlamlı)', () => {
    const j = migrated('1700000000100');
    expect(j._legacy).toBeTruthy(); expect(JSON.stringify(j.teethMap)).toContain('_nestedArray');
  });
  it('admin düzenleme yaması mevcut alanların hiçbirini silmez (kurallardaki keys().hasAll ile uyumlu)', async () => {
    for (const id of ['1700000000100', '1700000000102']) {
      const cur = migrated(id); let patch: Record<string, unknown> = {};
      m.mutateJob.mockImplementationOnce((async (_s: unknown, _id: string, fn: (j: Record<string, unknown>) => Record<string, unknown> | null) => { patch = fn(cur) ?? {}; return patch; }) as never);
      const c = ctx({ doctors: [{ id: String(cur.doctorId || 'd1'), name: 'Dr' }, { id: 'd1', name: 'Dr' }], technicians: techs, jobs: [cur] });
      const el = show(P1.jobsPage(c, cur.status === 'Tamamlandı')); btnByText(el, 'Detay').click();
      const sel = (document.querySelector('.modal-back') as HTMLElement).querySelector('select[name=doctorId]') as HTMLSelectElement;
      if (!cur.doctorId) { expect(sel.value).toBe(''); sel.value = 'd1'; } // hekimsiz eski iş: sessizce ilk hekime atanmaz, yönetici seçer
      btnByText(document.querySelector('.modal-back') as HTMLElement, 'Kaydet').click(); await flush();
      const after = upd(cur, { ...patch, updatedBy: 'u1' });
      for (const k of Object.keys(cur)) expect(Object.keys(after), `${id}: ${k} korunmalı`).toContain(k);
      expect(after._legacy).toEqual(cur._legacy);
      if ('teethMap' in cur) expect(after.teethMap).toEqual(cur.teethMap);
      expect(Object.keys(patch)).not.toContain('_legacy'); expect(Object.keys(patch).some((k) => /^x__/.test(k))).toBe(false);
      document.body.replaceChildren();
    }
  });
  it('bilinmeyen/eski durum çizilir, seçicide "(eski)" olarak korunur ve değiştirilmeden kaydedilince Geçersiz durum hatası vermez', async () => {
    const cur = { id: 'o1', doctorId: 'd1', drName: 'Dr', patient: 'Eski', type: 'Kron', status: 'Gönderildi', techIds: [] };
    const c = ctx({ doctors, jobs: [cur] }); const el = show(P1.jobsPage(c, false));
    const sel = el.querySelector('select[name=st]') as HTMLSelectElement; expect(sel.value).toBe('Gönderildi'); expect([...sel.options].some((o) => o.textContent?.includes('(eski)'))).toBe(true);
    let patch: Record<string, unknown> | null = {}; m.mutateJob.mockImplementationOnce((async (_s: unknown, _id: string, fn: (j: Record<string, unknown>) => Record<string, unknown> | null) => { patch = fn(cur); return patch; }) as never);
    btnByText(el, 'Detay').click(); btnByText(document.querySelector('.modal-back') as HTMLElement, 'Kaydet').click(); await flush();
    expect(patch).not.toBeNull(); expect((patch as unknown as Record<string, unknown>).status).toBeUndefined(); // durum dokunulmadan kalır
  });
});

describe('çalışma alanı, hesap devre dışı bırakma, hekim seçimi, dosya kopyası', () => {
  it('ayarlar: çalışma alanı seçici yok, yalnızca claim lab gösterilir', () => {
    const el = show(P2.settings(ctx())); expect(el.querySelector('select[name=lab]')).toBeNull(); expect(el.textContent).toContain('"digicad"');
  });
  it('hekim silinince bağlı hesap devre dışı bırakılır; çöpten geri alınınca yeniden etkinleştirilir', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const c = ctx({ doctors: [{ id: 'd9', name: 'Dr Z', authUid: 'uidZ' }] }); const el = show(P2.doctors(c)); btnByText(el, 'Sil').click(); await flush();
    expect(m.softDelete).toHaveBeenCalledWith(expect.anything(), 'doctors', 'd9'); expect(m.callFn).toHaveBeenCalledWith('adminDisableUser', { uid: 'uidZ', disabled: true });
    m.callFn.mockClear(); const t = show(P2.trash(ctx({ doctors: [{ id: 'd9', name: 'Dr Z', authUid: 'uidZ', deleted: true, deletedAt: 'x' }] }))); btnByText(t, 'Geri al').click(); await flush();
    expect(m.restore).toHaveBeenCalledWith(expect.anything(), 'doctors', 'd9'); expect(m.callFn).toHaveBeenCalledWith('adminDisableUser', { uid: 'uidZ', disabled: false });
  });
  it('hızlı iş talebi: hekim eşleşmezse onay hekim seçtirir; seçmeden approvePending çağrılmaz, seçince doctorId dolu iş oluşur', async () => {
    const c = ctx({ doctors, pendingJobs: [{ id: 'p9', status: 'Onay Bekliyor', drName: 'Kayıtsız Hekim', patient: 'x', type: 'K' }] }); const el = show(P1.pending(c));
    btnByText(el, 'Onayla').click(); await flush(); expect(m.approvePending).not.toHaveBeenCalled();
    const mod = document.querySelector('.modal-back') as HTMLElement; expect(mod.textContent).toContain('eşleşmedi');
    btnByText(mod, 'Seç ve onayla').click(); await flush(); expect(m.approvePending).not.toHaveBeenCalled(); // hekim seçilmedi
    (mod.querySelector('select[name=doctorId]') as HTMLSelectElement).value = 'd2'; btnByText(mod, 'Seç ve onayla').click(); await flush(60);
    expect(m.approvePending).toHaveBeenCalledTimes(1);
    const build = m.approvePending.mock.calls[0][2] as unknown as (p: Record<string, unknown>) => Record<string, unknown>;
    expect(build({ id: 'p9', patient: 'x', type: 'K' })).toMatchObject({ doctorId: 'd2' });
  });
  it('hekim gönderiminden aktarılan siparişte dosyalar sunucuda iş klasörüne kopyalanır (teknisyen görebilsin)', async () => {
    const c = ctx({ doctors, technicians: techs }, { prefill: { id: 'sub1', drId: 'd1', patient: 'Ali', jobType: 'Kron', teeth: ['11'], files: [{ name: 'a.stl', path: 'labs/digicad/submissions/d1/a.stl' }] } as never });
    const el = show(P1.order(c)); btnByText(el, 'Siparişi kaydet').click(); await flush(60);
    const jobIds = (m.createOrder.mock.calls[0][1] as { name: string; id: string }[]).filter((o) => o.name === 'jobs').map((o) => o.id);
    expect(jobIds.length).toBe(1); expect(m.callFn).toHaveBeenCalledWith('copyJobFiles', { jobId: jobIds[0] });
  });
  it('iş detayı: hâlâ submissions altında dosyası olan işte "teknisyen için hazırla" düğmesi ve iş sohbeti düğmesi var', () => {
    const j = { id: 'k1', doctorId: 'd1', drName: 'Dr', patient: 'P', type: 'K', status: 'Bekliyor', techIds: ['t1'], files: [{ name: 'a', path: 'labs/digicad/submissions/d1/a.stl' }] };
    const c = ctx({ doctors, technicians: techs, jobs: [j] }); const el = show(P1.jobsPage(c, false)); btnByText(el, 'Detay').click();
    const mod = document.querySelector('.modal-back') as HTMLElement; expect(btnByText(mod, 'İş sohbeti')).toBeTruthy();
    const tabs = [...mod.querySelectorAll('[role=tab]')] as HTMLElement[]; tabs.find((t) => t.textContent?.includes('Tarama'))!.click();
    expect(btnByText(document.querySelector('.modal-back') as HTMLElement, 'teknisyen için hazırla')).toBeTruthy();
  });
});
