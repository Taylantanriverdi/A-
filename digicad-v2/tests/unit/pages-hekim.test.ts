// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({
  data: {} as Record<string, unknown[]>, doc: null as unknown, put: vi.fn(async () => undefined), upload: vi.fn(async (_b: string, f: File) => ({ name: f.name, path: `p/${f.name}`, size: f.size, uploadedBy: 'u1', uploadedAt: 'x' })),
  listeners: [] as { name: string; cb: (r: unknown[]) => void; c: unknown[] }[], doctorId: '5',
}));
vi.mock('../../src/lib/gate', () => ({ gate: (_a: unknown, _t: unknown, start: (s: unknown, r: HTMLElement) => void) => start({ user: { uid: 'u1', email: 'dr@x.y' }, role: 'doctor', lab: 'digicad', doctorId: st.doctorId, mustChangePassword: false }, document.getElementById('app') as HTMLElement) }));
vi.mock('../../src/lib/auth', () => ({ logout: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('../../src/lib/store', () => ({
  listen: (_l: string, name: string, cb: (r: unknown[]) => void, c: unknown[] = []) => { st.listeners.push({ name, cb, c }); cb(st.data[name] ?? []); return () => undefined; },
  listenDoc: (_l: string, _n: string, _id: string, cb: (r: unknown) => void) => { cb(st.doc); return () => undefined; },
  byField: (f: string, v: unknown) => ({ f, v }), put: st.put, newId: () => '1700000000000123',
}));
vi.mock('../../src/lib/chatbox', () => ({ chatBox: (_s: unknown, tid: string) => { const el = document.createElement('div'); el.className = 'chat'; el.textContent = tid; return { el, stop: vi.fn() }; } }));
vi.mock('../../src/lib/files', async (orig) => ({ ...(await orig<typeof import('../../src/lib/files')>()), upload: st.upload, openFile: vi.fn() }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn() }));

const app = () => document.getElementById('app')!;
const click = (txt: string) => ([...app().querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) as HTMLButtonElement).click();
async function load() { const a = document.createElement('div'); a.id = 'app'; document.body.replaceChildren(a); vi.resetModules(); await import('../../src/pages/hekim'); }
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { st.data = {}; st.doc = null; st.listeners.length = 0; st.put.mockClear(); st.upload.mockClear(); st.doctorId = '5'; });

describe('hekim portalı', () => {
  it('işler yalnızca kendi doctorId ile sorgulanır (kurallar liste sorgusunda filtre ister)', async () => {
    await load(); for (const n of ['jobs', 'doctorSubmissions']) expect(st.listeners.find((l) => l.name === n)!.c).toEqual([{ f: 'doctorId', v: '5' }]);
  });
  it('devam eden/tamamlanan sekmeleri, gecikme işareti ve XSS içerikli hasta adı metin olarak çizilir', async () => {
    st.data.jobs = [{ id: '1', patient: '<img src=x onerror=1>', type: 'Kron', status: 'Üretimde', dateout: '2020-01-01' }, { id: '2', patient: 'Bitti', type: 'Köprü', status: 'Tamamlandı', completedAt: '2026-01-01' }, { id: '3', patient: 'Silindi', status: 'Bekliyor', deleted: true }];
    await load(); expect(app().querySelector('img')).toBeNull(); expect(app().textContent).toContain('<img src=x'); expect(app().querySelector('.late')).not.toBeNull();
    expect(app().textContent).toContain('Devam eden (1)'); expect(app().textContent).toContain('Tamamlanan (1)'); expect(app().textContent).not.toContain('Silindi');
    click('Tamamlanan'); expect(app().textContent).toContain('Bitti');
  });
  it('arama filtresi listeyi daraltır', async () => {
    st.data.jobs = [{ id: '1', patient: 'Ayşe', type: 'Kron', status: 'Bekliyor' }, { id: '2', patient: 'Mehmet', type: 'Köprü', status: 'Bekliyor' }];
    await load(); const q = app().querySelector('input[type=search]') as HTMLInputElement; q.value = 'mehm'; q.dispatchEvent(new Event('input'));
    expect(app().querySelectorAll('tbody tr').length).toBe(1); expect(app().querySelector('tbody')!.textContent).toContain('Mehmet');
  });
  it('yeni gönderim: eksik alanlarda yazma yapılmaz', async () => {
    await load(); click('Yeni gönderim'); click('Laboratuvara gönder'); await flush();
    expect(st.put).not.toHaveBeenCalled(); expect(document.querySelector('#toasts .toast.err')!.textContent).toMatch(/Eksik alanlar: .*Hasta adı.*İş türü.*Diş seçimi.*Diş rengi.*Tarama dosyası/);
  });
  it('yeni gönderim: kurallara uygun alanlarla yazılır (hasOnly listesi dışında alan yok), hasta adı büyük harf, çene dişlerden', async () => {
    st.doc = { id: '5', name: 'Dr', prices: [{ name: 'Zirkonya Kron', price: 1 }] };
    await load(); click('Yeni gönderim');
    const f = app().querySelector('form')!; (f.querySelector('[name=patient]') as HTMLInputElement).value = 'ışık can'; (f.querySelector('[name=jobType]') as HTMLSelectElement).value = 'Zirkonya Kron'; (f.querySelector('[name=color]') as HTMLInputElement).value = 'a2';
    ([...f.querySelectorAll('button.tooth')].find((b) => b.textContent === '11') as HTMLButtonElement).click(); ([...f.querySelectorAll('button.tooth')].find((b) => b.textContent === '41') as HTMLButtonElement).click();
    const fi = f.querySelector('input[type=file]') as HTMLInputElement; Object.defineProperty(fi, 'files', { value: [new File([new Uint8Array(10)], 'scan.stl')], configurable: true }); fi.dispatchEvent(new Event('change'));
    click('Laboratuvara gönder'); await flush(); await flush();
    expect(st.upload).toHaveBeenCalledTimes(1); expect(st.upload.mock.calls[0][0]).toBe('labs/digicad/submissions/5');
    const [, coll, id, body, isNew] = st.put.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>, boolean];
    expect(coll).toBe('doctorSubmissions'); expect(isNew).toBe(true); expect(id).toBe('1700000000000123');
    const allowed = ['id', 'doctorId', 'drId', 'patient', 'jobType', 'teeth', 'jaw', 'color', 'notes', 'files', 'status', 'source'];
    expect(Object.keys(body).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(body).toMatchObject({ doctorId: '5', drId: '5', patient: 'IŞIK CAN', jobType: 'Zirkonya Kron', teeth: [11, 41], jaw: 'her', color: 'A2', status: 'Yeni' });
  });
  it('yasaklı dosya türü listeye eklenmez', async () => {
    await load(); click('Yeni gönderim'); const fi = app().querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(fi, 'files', { value: [new File(['<html>'], 'x.html', { type: 'text/html' })], configurable: true }); fi.dispatchEvent(new Event('change')); await flush();
    expect(app().textContent).toContain('Henüz dosya eklenmedi'); expect(document.querySelector('#toasts .toast.err')!.textContent).toMatch(/izin verilmiyor/);
  });
  it('gönderimlerim: aşama etiketleri; Reddedildi görünür; dosya adları metin', async () => {
    st.data.doctorSubmissions = [{ id: '10', patient: 'A', jobType: 'T', status: 'Yeni', createdAt: '2026-01-02' }, { id: '11', patient: 'B', jobType: 'T', status: 'Reddedildi', createdAt: '2026-01-01' }, { id: '12', patient: 'C', jobType: 'T', status: 'Aktarıldı', createdAt: '2026-01-03', files: [{ name: '<b>x</b>', path: 'p' }] }];
    st.data.jobs = [{ id: 'j', sourceDoctorSubmissionId: '12', status: 'Tamamlandı' }];
    await load(); click('Gönderimlerim'); const t = app().textContent!; expect(t).toContain('Onay bekliyor'); expect(t).toContain('Reddedildi'); expect(t).toContain('Tamamlandı');
    click('Detay'); expect(document.querySelector('.modal')).not.toBeNull(); expect(document.querySelector('.modal b')?.textContent).not.toBe('x');
  });
  it('sohbet kanalı dr_<doctorId>', async () => { await load(); click('Laboratuvarla yaz'); expect(app().querySelector('.chat')!.textContent).toBe('dr_5'); });
});
