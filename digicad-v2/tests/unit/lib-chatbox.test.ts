// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ addDoc: vi.fn(async () => ({})), setDoc: vi.fn(async () => undefined), snap: null as null | ((s: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void), paths: [] as string[] }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  addDoc: m.addDoc, setDoc: m.setDoc, collection: (_d: unknown, p: string) => { m.paths.push(p); return { p }; }, doc: (_d: unknown, ...p: string[]) => ({ p: p.join('/') }),
  onSnapshot: (_q: unknown, cb: typeof m.snap) => { m.snap = cb; return vi.fn(); }, orderBy: vi.fn(), query: (c: unknown) => c, limitToLast: vi.fn(), serverTimestamp: vi.fn(), where: vi.fn(), updateDoc: vi.fn(), getDoc: vi.fn(), writeBatch: vi.fn(), limit: vi.fn(),
}));
vi.mock('../../src/lib/files', () => ({ upload: vi.fn(), openFile: vi.fn(), MAX_CHAT_MB: 25 }));
import { chatBox, roleLabel, openJobChat } from '../../src/lib/chatbox';

const s = { user: { uid: 'u1' }, role: 'doctor', lab: 'digicad', doctorId: '5' } as never;
beforeEach(() => { vi.clearAllMocks(); m.paths.length = 0; document.body.replaceChildren(); });

describe('chatBox', () => {
  it('rol etiketleri (eski göç verisindeki technician dahil)', () => {
    expect([roleLabel('admin'), roleLabel('doctor'), roleLabel('tech'), roleLabel('technician'), roleLabel('x')]).toEqual(['Laboratuvar', 'Hekim', 'Teknisyen', 'Teknisyen', 'Kullanıcı']);
  });
  it('anonim (iş sohbeti): gerçek ad gösterilmez/yazılmaz, rol etiketi kullanılır; eski mesajlar (senderUid yok) çizilir', async () => {
    const c = chatBox(s, 'job_100', 'Dr Gerçek Ad', { anonymous: true }); document.body.append(c.el);
    m.snap!({ docs: [{ id: 'a', data: () => ({ text: 'merhaba', senderRole: 'technician', senderName: 'Tekn Gerçek', timestamp: '2025-01-01T10:00:00Z' }) }, { id: 'b', data: () => ({ text: 'silinmiş', deletedAt: 'x' }) }] });
    expect(c.el.textContent).toContain('Teknisyen'); expect(c.el.textContent).not.toContain('Tekn Gerçek'); expect(c.el.textContent).not.toContain('silinmiş');
    (c.el.querySelector('input[type=text]') as HTMLInputElement).value = 'selam'; (c.el.querySelector('button.primary') as HTMLButtonElement).click(); await new Promise((r) => setTimeout(r, 5));
    const body = (m.addDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(body).toMatchObject({ text: 'selam', senderUid: 'u1', senderRole: 'doctor', senderName: 'Hekim' }); expect(Object.keys(body).sort()).toEqual(['senderName', 'senderRole', 'senderUid', 'text', 'timestamp']);
    expect(m.paths[0]).toBe('labs/digicad/threads/job_100/messages');
  });
  it('normal konuşma (dr_/tech_) gönderen adını gösterir', () => {
    const c = chatBox(s, 'dr_5', 'Dr Ad'); m.snap!({ docs: [{ id: 'a', data: () => ({ text: 'x', senderRole: 'admin', senderName: 'Laboratuvar' }) }] });
    expect(c.el.textContent).toContain('Laboratuvar');
  });
  it('openJobChat pencere açar ve kapanınca dinleyiciyi durdurur', () => {
    openJobChat(s, { id: 100, patient: 'Ayşe', type: 'Kron' });
    expect(document.querySelector('.modal-back')!.textContent).toContain('Ayşe'); expect(m.paths[0]).toBe('labs/digicad/threads/job_100/messages');
    (document.querySelector('.modal-h button') as HTMLButtonElement).click(); expect(document.querySelector('.modal-back')).toBeNull();
  });
});
