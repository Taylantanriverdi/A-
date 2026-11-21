import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claimsFor as fnClaims } from '../../functions/src/validate';
import { claimsFor as migClaims } from '../../migration/src/sinks';

// Claim adları ve türleri: functions (adminCreateUser/SetRole) ↔ göç aracı ↔ kurallar ↔ ön yüz kapısı birebir aynı olmalı.
const root = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');

describe('claim adları (role, lab, doctorId, techId metin, mustChangePassword)', () => {
  it('functions ve göç aracı aynı claim nesnesini üretir (tüm değerler METİN)', () => {
    expect(migClaims({ email: 'a@b.c', role: 'doctor', refId: '5', lab: 'digicad', name: 'x' })).toEqual(fnClaims('doctor', 'digicad', 5));
    expect(migClaims({ email: 'a@b.c', role: 'tech', refId: 't_1', lab: 'primer', name: 'x' })).toEqual(fnClaims('tech', 'primer', undefined, 't_1'));
    for (const v of Object.values(fnClaims('doctor', 'digicad', 12))) expect(typeof v).toBe('string');
  });
  it('kurallar yalnızca bu claim adlarını okur', () => {
    const names = new Set([...(read('firestore.rules') + read('storage.rules')).matchAll(/request\.auth\.token\.(\w+)/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(['doctorId', 'firebase', 'lab', 'role', 'techId']);
  });
  it('ön yüz kapısı (readSession) aynı claim adlarını okur; mustChangePassword yalnızca tam true', () => {
    const auth = read('src/lib/auth.ts');
    for (const k of ['claims.role', 'claims.lab', 'claims.doctorId', 'claims.techId', 'claims.mustChangePassword']) expect(auth, k).toContain(k);
  });
  it('mustChangePassword akışı: functions bayrağı ve pwv parmak izini yönetir; ön yüz aynı callable adını çağırır', () => {
    const adm = read('functions/src/admin.ts'); const auth = read('src/lib/auth.ts');
    expect(adm).toMatch(/export const clearMustChangePassword = onCall/); expect(auth).toContain("callFn('clearMustChangePassword'");
    expect(adm).toMatch(/mustChangePassword: true, \.\.\.\(pwFingerprint\(rec\) \? \{ pwv: pwFingerprint\(rec\) \} : \{\}\)/); // adminCreateUser
    expect(adm).toMatch(/mustChangePassword: true, \.\.\.\(fp \? \{ pwv: fp \} : \{\}\)/); // adminResetPassword
    expect(adm).toMatch(/if \(fp && c\.pwv && fp === c\.pwv\)/); // pwv yoksa (göç/bootstrap hesabı) doğrudan kaldırılır
    expect(read('migration/src/sinks.ts')).toContain('mustChangePassword: true'); expect(read('scripts/bootstrap-admin.ts')).toContain('mustChangePassword: true');
  });
});
