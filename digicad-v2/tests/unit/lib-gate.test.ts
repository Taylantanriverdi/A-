// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Sess = Record<string, unknown>;
const h = vi.hoisted(() => ({ cb: null as null | ((s: Sess | null, u: unknown) => Promise<void>), onErr: null as null | ((e: unknown) => void), calls: [] as string[], idle: [] as { limitMs: number; onTimeout: () => void }[], mfaEnrolled: false }));
vi.mock('../../src/lib/auth', () => ({
  watchSession: (cb: never, onErr: never) => { h.cb = cb; h.onErr = onErr; return () => undefined; },
  login: vi.fn(), changePassword: vi.fn(async () => { h.calls.push('changePassword'); }), readSession: vi.fn(async () => null),
  logout: vi.fn(async () => { h.calls.push('logout'); }), reloadPage: vi.fn(() => { h.calls.push('reload'); }),
  claimsKey: (s: Sess | null) => (s ? [s.role, s.lab, s.doctorId ?? '', s.techId ?? ''].join('|') : ''),
  startTotpEnrollment: vi.fn(async () => { h.calls.push('enroll'); return { secret: { secretKey: 'SECRET' }, otpauth: 'otpauth://x' }; }), finishTotpEnrollment: vi.fn(),
  hasMfa: () => h.mfaEnrolled,
}));
vi.mock('../../src/lib/idle', () => ({ IDLE_LIMITS: { admin: 1200000, other: 1800000 }, startIdleWatch: (o: { limitMs: number; onTimeout: () => void }) => { h.idle.push(o); return () => undefined; } }));
import { gate } from '../../src/lib/gate';

const user = { uid: 'u1', email: 'a@b.c' };
const sess = (o: Sess = {}): Sess => ({ user, role: 'doctor', lab: 'digicad', doctorId: '5', mustChangePassword: false, mfa: false, ...o });
const text = () => document.getElementById('app')!.textContent ?? '';
const start = vi.fn();
const resetDom = () => { const app = document.createElement('div'); app.id = 'app'; document.body.replaceChildren(app); };
const run = async (s: Sess | null, u: unknown = user) => { await h.cb!(s, s || u ? u : null); };

beforeEach(() => { resetDom(); start.mockReset(); h.calls.length = 0; h.idle.length = 0; h.mfaEnrolled = false; gate(['doctor'], 'Hekim', start); });

describe('gate', () => {
  it('oturum yok → giriş formu', async () => { await run(null, null); expect(document.querySelector('form input[type=password]')).not.toBeNull(); expect(start).not.toHaveBeenCalled(); });
  it('rolsüz hesap → yetkisiz, sayfa başlamaz', async () => { await run(null, user); expect(text()).toMatch(/yetkisiz/); expect(start).not.toHaveBeenCalled(); });
  it('izinli olmayan rol → erişim yok', async () => { await run(sess({ role: 'tech', techId: '1', doctorId: undefined })); expect(text()).toMatch(/erişiminiz yok/); expect(start).not.toHaveBeenCalled(); });
  it('hekim claim eksik (doctorId yok) → başlamaz', async () => { await run(sess({ doctorId: undefined })); expect(text()).toMatch(/eksik/); expect(start).not.toHaveBeenCalled(); });
  it('ilk girişte şifre değişimi zorlanır', async () => { await run(sess({ mustChangePassword: true })); expect(text()).toMatch(/Şifrenizi değiştirin/); expect(document.querySelectorAll('input[type=password]').length).toBe(2); expect(start).not.toHaveBeenCalled(); });
  it('geçerli hekim → start çağrılır, hareketsizlik izleyici 30 dk; zaman aşımında çıkış', async () => {
    await run(sess()); expect(start).toHaveBeenCalledTimes(1); expect(h.idle[0].limitMs).toBe(1800000);
    h.idle[0].onTimeout(); expect(h.calls).toContain('logout');
  });
  it('aynı oturum tekrar bildirilince (token yenileme) yeniden başlamaz', async () => { await run(sess()); await run(sess()); expect(start).toHaveBeenCalledTimes(1); });
  it('claim/rol değişirse sayfa yenilenir (yetki alındı/verildi)', async () => { await run(sess()); await run(sess({ doctorId: '9' })); expect(h.calls).toContain('reload'); expect(start).toHaveBeenCalledTimes(1); });
  it('oturum okuma hatası ekranı', async () => { h.onErr!(new Error('ağ')); expect(text()).toMatch(/okunamadı/); });
});

describe('gate: yönetici', () => {
  beforeEach(() => { resetDom(); start.mockReset(); h.calls.length = 0; h.idle.length = 0; gate(['admin'], 'Yönetim', start); });
  const admin = (o: Sess = {}) => sess({ role: 'admin', doctorId: undefined, ...o });
  it('TOTP kayıtlı değilse kurulum zorunlu, panel açılmaz', async () => { h.mfaEnrolled = false; await run(admin()); expect(h.calls).toContain('enroll'); expect(text()).toMatch(/Çok faktörlü/); expect(start).not.toHaveBeenCalled(); });
  it('TOTP kayıtlı ama oturum ikinci faktörsüz (mfa=false) → reddedilir ve çıkış yapılır', async () => { h.mfaEnrolled = true; await run(admin({ mfa: false })); expect(h.calls).toContain('logout'); expect(start).not.toHaveBeenCalled(); });
  it('MFA\'lı yönetici → panel açılır, 20 dk zaman aşımı', async () => { h.mfaEnrolled = true; await run(admin({ mfa: true })); expect(start).toHaveBeenCalledTimes(1); expect(h.idle[0].limitMs).toBe(1200000); });
  it('yönetici de ilk girişte şifre değiştirir (MFA\'dan önce)', async () => { h.mfaEnrolled = false; await run(admin({ mustChangePassword: true })); expect(text()).toMatch(/Şifrenizi değiştirin/); expect(h.calls).not.toContain('enroll'); });
});
