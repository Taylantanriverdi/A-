import { describe, expect, it } from 'vitest';
import { validatePassword, isTotpCode, firebaseErrorMessage } from '../../src/lib/checks';

describe('validatePassword', () => {
  it('kısa / basit şifreler reddedilir', () => {
    expect(validatePassword('abc123')).toMatch(/10/); expect(validatePassword('aaaaaaaaaaaa')).toMatch(/basit/);
    expect(validatePassword('abcdefghijkl')).toMatch(/en az ikisini/); expect(validatePassword('1234567890')).toBeTruthy();
    expect(validatePassword('x'.repeat(129))).toMatch(/128/);
  });
  it('yeterli şifre kabul edilir', () => { expect(validatePassword('Laboratuvar2026')).toBeNull(); expect(validatePassword('kuru-yemis-79')).toBeNull(); });
});
describe('isTotpCode', () => { it('yalnızca 6 rakam', () => { expect(isTotpCode('123456')).toBe(true); for (const c of ['12345', '1234567', '12345a', ' 123456', '']) expect(isTotpCode(c), c).toBe(false); }); });
describe('firebaseErrorMessage', () => {
  it('hesap varlığı sızdırılmaz: yanlış şifre ve olmayan kullanıcı aynı ileti', () => {
    expect(firebaseErrorMessage({ code: 'auth/wrong-password' })).toBe(firebaseErrorMessage({ code: 'auth/user-not-found' }));
    expect(firebaseErrorMessage({ code: 'auth/invalid-credential' })).toBe(firebaseErrorMessage({ code: 'auth/user-not-found' }));
  });
  it('bilinmeyen kod / kodsuz hata null', () => { expect(firebaseErrorMessage({ code: 'x/y' })).toBeNull(); expect(firebaseErrorMessage(new Error('a'))).toBeNull(); expect(firebaseErrorMessage(null)).toBeNull(); });
  it('izin hatası Türkçe', () => { expect(firebaseErrorMessage({ code: 'permission-denied' })).toMatch(/yetki/); expect(firebaseErrorMessage({ code: 'storage/unauthorized' })).toMatch(/yetki/); });
});
