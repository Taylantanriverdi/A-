import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ updatePassword: vi.fn(), signOut: vi.fn(async () => undefined), call: vi.fn(), wipe: vi.fn(async () => undefined), cur: null as null | { getIdToken: (f: boolean) => Promise<string> } }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, storage: {}, functions: {}, callFn: (...a: unknown[]) => m.call(...a), wipeLocalData: m.wipe, auth: { get currentUser() { return m.cur; } } }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(), signOut: m.signOut, onIdTokenChanged: vi.fn(), updatePassword: m.updatePassword, getMultiFactorResolver: vi.fn(), multiFactor: vi.fn(),
  TotpMultiFactorGenerator: { FACTOR_ID: 'totp', assertionForSignIn: vi.fn(), assertionForEnrollment: vi.fn(), generateSecret: vi.fn() },
}));
import { readSession, claimsKey, changePassword, clearMustChangePassword, logout } from '../../src/lib/auth';

const user = (claims: Record<string, unknown>) => ({ uid: 'u', getIdTokenResult: vi.fn(async () => ({ claims })) }) as never;
beforeEach(() => { vi.clearAllMocks(); m.cur = { getIdToken: vi.fn(async () => 't') }; });

describe('readSession', () => {
  it('claim yoksa / bilinmeyen rolse null', async () => {
    expect(await readSession(user({}))).toBeNull(); expect(await readSession(user({ role: 'admin' }))).toBeNull(); expect(await readSession(user({ role: 'root', lab: 'x' }))).toBeNull();
  });
  it('rol, lab, kimlikler ve MFA bayrağı okunur', async () => {
    const s = await readSession(user({ role: 'doctor', lab: 'digicad', doctorId: 5, mustChangePassword: true }));
    expect(s).toMatchObject({ role: 'doctor', lab: 'digicad', doctorId: '5', techId: undefined, mustChangePassword: true, mfa: false });
    expect((await readSession(user({ role: 'admin', lab: 'x', firebase: { sign_in_second_factor: 'totp' } })))!.mfa).toBe(true);
    expect((await readSession(user({ role: 'admin', lab: 'x', firebase: { sign_in_provider: 'password' } })))!.mfa).toBe(false);
  });
  it('mustChangePassword yalnızca tam true ise', async () => { expect((await readSession(user({ role: 'tech', lab: 'x', techId: '1', mustChangePassword: 'true' })))!.mustChangePassword).toBe(false); });
  it('claimsKey yetki değişimini yakalar', async () => {
    const a = (await readSession(user({ role: 'doctor', lab: 'x', doctorId: '1' })))!; const b = (await readSession(user({ role: 'doctor', lab: 'x', doctorId: '2' })))!;
    expect(claimsKey(a)).not.toBe(claimsKey(b)); expect(claimsKey(a)).toBe(claimsKey({ ...a })); expect(claimsKey(null)).toBe('');
  });
});

describe('changePassword', () => {
  it('zayıf şifre sunucuya gitmeden reddedilir', async () => { await expect(changePassword('kisa')).rejects.toThrow(/10/); expect(m.updatePassword).not.toHaveBeenCalled(); });
  it('oturum yoksa hata', async () => { m.cur = null; await expect(changePassword('Laboratuvar2026')).rejects.toThrow(/Oturum/); });
  it('başarılı: şifre güncellenir, bayrak temizleme çağrılır, token yenilenir', async () => {
    await changePassword('Laboratuvar2026'); expect(m.updatePassword).toHaveBeenCalledTimes(1); expect(m.call).toHaveBeenCalledTimes(1); expect(m.cur!.getIdToken).toHaveBeenCalledWith(true);
  });
  it("sunucudaki callable adı 'clearMustChangePassword' (functions/src/admin.ts ile aynı) ve boş veriyle çağrılır", async () => {
    await clearMustChangePassword(); expect(m.call).toHaveBeenCalledWith('clearMustChangePassword', {});
  });
  it('bayrak temizlenemezse hata görünür (sessiz yutulmaz), token yenilenmez; yeniden denemede başarılı olur', async () => {
    m.call.mockRejectedValueOnce(new Error('unavailable'));
    await expect(changePassword('Laboratuvar2026')).rejects.toThrow(/tekrar/);
    expect(m.cur!.getIdToken).not.toHaveBeenCalled();
    await expect(changePassword('Laboratuvar2026')).resolves.toBeUndefined();
    expect(m.cur!.getIdToken).toHaveBeenCalledWith(true);
  });
});

describe('logout', () => { it('oturumu kapatır ve yerel veriyi siler', async () => { await logout(); expect(m.signOut).toHaveBeenCalled(); expect(m.wipe).toHaveBeenCalled(); }); });
