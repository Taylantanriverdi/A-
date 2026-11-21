// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({
  data: {} as Record<string, unknown[]>, put: vi.fn(async () => undefined), patch: vi.fn(async () => undefined), upload: vi.fn(async (_b: string, f: File) => ({ name: f.name, path: `p/${f.name}`, size: f.size, uploadedBy: 'u1', uploadedAt: 'x' })),
  openChat: vi.fn(),
  listeners: [] as { name: string; c: unknown[] }[],
}));
vi.mock('../../src/lib/gate', () => ({ gate: (_a: unknown, _t: unknown, start: (s: unknown, r: HTMLElement) => void) => start({ user: { uid: 'u1', email: 't@x.y' }, role: 'tech', lab: 'digicad', techId: '7', mustChangePassword: false }, document.getElementById('app') as HTMLElement) }));
vi.mock('../../src/lib/auth', () => ({ logout: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('../../src/lib/store', () => ({
  listen: (_l: string, name: string, cb: (r: unknown[]) => void, c: unknown[] = []) => { st.listeners.push({ name, c }); cb(st.data[name] ?? []); return () => undefined; },
  byField: (f: string, v: unknown) => ({ f, v }), notDeleted: () => ({ f: 'deleted', v: false }), hasItem: (f: string, v: unknown) => ({ has: f, v }), put: st.put, patch: st.patch, newId: () => '1700000000000999',
}));
vi.mock('../../src/lib/chatbox', () => ({ openJobChat: (...a: unknown[]) => st.openChat(...a), chatBox: (_s: unknown, tid: string) => { const el = document.createElement('div'); el.className = 'chat'; el.textContent = tid; return { el, stop: vi.fn() }; } }));
vi.mock('../../src/lib/files', async (orig) => ({ ...(await orig<typeof import('../../src/lib/files')>()), upload: st.upload, openFile: vi.fn() }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn() }));

const app = () => document.getElementById('app')!;
const click = (txt: string, root: ParentNode = app()) => ([...root.querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) as HTMLButtonElement).click();
async function load() { const a = document.createElement('div'); a.id = 'app'; document.body.replaceChildren(a); vi.resetModules(); await import('../../src/pages/teknisyen'); }
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { st.data = {}; st.listeners.length = 0; st.put.mockClear(); st.patch.mockClear(); st.upload.mockClear(); });

const job = (o: Record<string, unknown>) => ({ id: 'j1', patient: 'Ayşe', type: 'Kron', qty: 2, status: 'Bekliyor', dateout: '2999-01-01', drName: 'Dr X', techIds: ['7'], ...o });

describe('teknisyen paneli', () => {
  it('işler techIds array-contains ile, taleplerim techId ile sorgulanır', async () => {
    await load(); expect(st.listeners.find((l) => l.name === 'jobs')!.c).toEqual([{ has: 'techIds', v: '7' }, { f: 'deleted', v: false }]); expect(st.listeners.find((l) => l.name === 'pendingJobs')!.c).toEqual([{ f: 'techId', v: '7' }, { f: 'deleted', v: false }]);
  });
  it('durum değişimi yalnızca status yazar; teknisyen seçeneklerinde Tamamlandı yok', async () => {
    st.data.jobs = [job({})]; await load();
    const sel = app().querySelector('select[name=st]') as HTMLSelectElement; expect([...sel.options].map((o) => o.value)).not.toContain('Tamamlandı');
    sel.value = 'Üretimde'; sel.dispatchEvent(new Event('change')); await flush();
    expect(st.patch).toHaveBeenCalledWith(expect.anything(), 'jobs', 'j1', { status: 'Üretimde' });
  });
  it('Tamamlandı veya çöpteki işte düzenleme denetimleri yok (kurallar reddeder)', async () => {
    st.data.jobs = [job({ status: 'Tamamlandı', completedAt: '2026-01-01' }), job({ id: 'j2', deleted: true })]; await load(); click('Tamamlanan');
    expect(app().querySelector('select[name=st]')).toBeNull(); expect(app().querySelector('input[type=file]')).toBeNull(); expect(app().querySelector('input[name=techNote]')).toBeNull(); expect(app().textContent).toContain('Tamamlandı');
  });
  it('tasarım dosyası: mevcutlar korunarak eklenir (kural: hasAll) ve jobFiles yoluna yüklenir', async () => {
    st.data.jobs = [job({ designFiles: [{ name: 'eski.stl', path: 'p/eski.stl' }] })]; await load();
    const fi = app().querySelector('tbody input[type=file]') as HTMLInputElement; Object.defineProperty(fi, 'files', { value: [new File([new Uint8Array(5)], 'yeni.stl')], configurable: true }); click('Yükle'); await flush(); await flush();
    expect(st.upload.mock.calls[0][0]).toBe('labs/digicad/jobFiles/j1');
    const [, , , body] = st.patch.mock.calls[0] as unknown as [unknown, string, string, { designFiles: { name: string }[] }];
    expect(body.designFiles.map((f) => f.name)).toEqual(['eski.stl', 'yeni.stl']);
  });
  it('yasaklı dosya yüklenmez, yazma olmaz', async () => {
    st.data.jobs = [job({})]; await load(); const fi = app().querySelector('tbody input[type=file]') as HTMLInputElement;
    Object.defineProperty(fi, 'files', { value: [new File(['x'], 'a.exe')], configurable: true }); click('Yükle'); await flush();
    expect(st.upload).not.toHaveBeenCalled(); expect(st.patch).not.toHaveBeenCalled(); expect(document.querySelector('#toasts .toast.err')!.textContent).toMatch(/uzantı/);
  });
  it('istatistik: geciken sayısı', async () => { st.data.jobs = [job({ dateout: '2000-01-01' }), job({ id: 'j2' })]; await load(); expect(app().querySelector('.stats')!.textContent).toMatch(/Geciken1/); });
  it('hızlı talep: yalnızca kuralların izin verdiği alanlar; diş/renk nota eklenir', async () => {
    await load(); click('Hızlı iş talebi'); const f = app().querySelector('.card')!;
    (f.querySelector('[name=patient]') as HTMLInputElement).value = 'veli'; (f.querySelector('[name=color]') as HTMLInputElement).value = 'b1'; (f.querySelector('[name=note]') as HTMLTextAreaElement).value = 'acil';
    ([...f.querySelectorAll('button.tooth')].find((b) => b.textContent === '21') as HTMLButtonElement).click(); click('Onaya gönder', f); await flush();
    const [, coll, , body, isNew] = st.put.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>, boolean];
    expect(coll).toBe('pendingJobs'); expect(isNew).toBe(true);
    const allowed = ['id', 'drName', 'patient', 'type', 'qty', 'dateout', 'note', 'techId', 'status', 'submittedBy', 'submittedAt', 'deleted']; expect(Object.keys(body).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(body).toMatchObject({ techId: '7', status: 'Onay Bekliyor', patient: 'VELİ', qty: 1 }); expect(String(body.note)).toContain('Dişler: 21'); expect(String(body.note)).toContain('Renk: B1'); expect(String(body.note)).toContain('acil');
  });
  it('hızlı talep: hasta yoksa yazılmaz', async () => { await load(); click('Hızlı iş talebi'); click('Onaya gönder'); await flush(); expect(st.put).not.toHaveBeenCalled(); });
  it('sohbet tech_<techId>', async () => { await load(); click('Laboratuvarla yaz'); expect(app().querySelector('.chat')!.textContent).toBe('tech_7'); });
});
