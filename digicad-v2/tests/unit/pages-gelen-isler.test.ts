// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ data: {} as Record<string, unknown[]>, patch: vi.fn((...a: unknown[]) => Promise.resolve(a.length && undefined)), print: vi.fn() }));
vi.mock('../../src/lib/gate', () => ({ gate: (allowed: string[], _t: unknown, start: (s: unknown, r: HTMLElement) => void) => { (globalThis as { __allowed?: string[] }).__allowed = allowed; start({ user: { uid: 'u1', email: 'a@x.y' }, role: 'admin', lab: 'digicad', mustChangePassword: false, mfa: true }, document.getElementById('app') as HTMLElement); } }));
vi.mock('../../src/lib/auth', () => ({ logout: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('../../src/lib/store', () => ({ listen: (_l: string, name: string, cb: (r: unknown[]) => void) => { cb(st.data[name] ?? []); return () => undefined; }, patch: st.patch }));
vi.mock('../../src/lib/ui', async (orig) => ({ ...(await orig<typeof import('../../src/lib/ui')>()), printNode: st.print }));
vi.mock('../../src/lib/files', () => ({ openFile: vi.fn() }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn() }));

const app = () => document.getElementById('app')!;
const click = (txt: string, root: ParentNode = app()) => ([...root.querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) as HTMLButtonElement).click();
async function load() { const a = document.createElement('div'); a.id = 'app'; document.body.replaceChildren(a); vi.resetModules(); await import('../../src/pages/gelen-isler'); }
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { st.data = {}; st.patch.mockClear(); st.print.mockClear(); document.querySelectorAll('.modal-back').forEach((e) => e.remove()); });

describe('gelen işler', () => {
  it('yalnızca yönetici kapısı (kurallar orderForms/doctorSubmissions listesini admin dışına kapatır)', async () => { await load(); expect((globalThis as { __allowed?: string[] }).__allowed).toEqual(['admin']); });
  it('sekmeler durum sayısını gösterir; Yeni sekmesi yalnızca Yeni kayıtları listeler', async () => {
    st.data.doctorSubmissions = [{ id: '1', patient: 'A', status: 'Yeni', doctorName: 'Dr A', createdAt: '2026-01-01' }, { id: '2', patient: 'B', status: 'Aktarıldı', doctorName: 'Dr A', createdAt: '2026-01-02' }, { id: '3', patient: 'C', status: 'Yeni', doctorId: '9', deleted: true }];
    await load(); expect(app().textContent).toContain('Yeni (1)'); expect(app().textContent).toContain('Aktarılan (1)'); expect(app().querySelector('tbody')!.textContent).toContain('A'); expect(app().querySelector('tbody')!.textContent).not.toContain('Dr A Aktarıldı');
    click('Aktarılan'); expect(app().querySelector('tbody')!.textContent).toContain('B');
  });
  it('detay: incelendi işareti seenAt yazar, durumu (status) değiştirmez; reddetme onay ister', async () => {
    st.data.doctorSubmissions = [{ id: '1', patient: 'A', status: 'Yeni', createdAt: '2026-01-01', teeth: [11], files: [{ name: 'x.stl', path: 'p' }] }];
    await load(); click('Detay'); const modal = document.querySelector('.modal') as HTMLElement; click('İncelendi işaretle', modal); await flush();
    const [, coll, id, body] = st.patch.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>]; expect(coll).toBe('doctorSubmissions'); expect(id).toBe('1'); expect(Object.keys(body)).toEqual(['seenAt', 'seenBy']);
    const conf = vi.spyOn(window, 'confirm').mockReturnValue(false); click('Reddet', modal); await flush(); expect(st.patch).toHaveBeenCalledTimes(1);
    conf.mockReturnValue(true); click('Reddet', modal); await flush(); expect(st.patch.mock.calls[1][3]).toMatchObject({ status: 'Reddedildi' }); conf.mockRestore();
  });
  it('sipariş formu yazdırılınca printed işaretlenir', async () => {
    st.data.orderForms = [{ id: 'f1', drName: 'Dr', patient: 'Z', jobType: 'Kron', teeth: [11, 12], createdAt: '2026-01-01', printed: false }]; await load(); click('Yazdır'); await flush();
    expect(st.print).toHaveBeenCalledTimes(1); expect(st.patch.mock.calls[0].slice(1, 3)).toEqual(['orderForms', 'f1']); expect(st.patch.mock.calls[0][3]).toMatchObject({ printed: true });
  });
  it('XSS: hasta adı metin olarak çizilir', async () => {
    st.data.doctorSubmissions = [{ id: '1', patient: '<script>alert(1)</script>', status: 'Yeni', createdAt: '2026-01-01' }]; await load(); expect(app().querySelector('script')).toBeNull(); expect(app().textContent).toContain('<script>');
  });
});
