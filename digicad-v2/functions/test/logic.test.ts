import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import * as nodeCrypto from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertAdminMfaToken, decideRate, randomPassword, sanitizeText } from '../src/util';
import { normalizeEmail, validateUid, claimsFor, refId, mapAuthError, cleanDisplayName, clearDecision } from '../src/validate';
import { kindOf, actorOf, pack, AUDITED } from '../src/auditLogic';
import { coerceParsed } from '../src/parseMail';
import { backupPrefix } from '../src/backup';
import { planFileCopies, applyCopies } from '../src/files';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as HttpsError).code; } return 'ok'; };

describe('assertAdminMfaToken', () => {
  it('reddeder: token yok, admin değil, lab yanlış, MFA yok', () => {
    expect(code(() => assertAdminMfaToken(undefined, false))).toBe('unauthenticated');
    expect(code(() => assertAdminMfaToken({ role: 'doctor', lab: 'digicad' }, false))).toBe('permission-denied');
    expect(code(() => assertAdminMfaToken({ role: 'admin', lab: 'Bas ka/..' }, false))).toBe('permission-denied');
    expect(code(() => assertAdminMfaToken({ role: 'admin' }, false))).toBe('permission-denied');
    expect(code(() => assertAdminMfaToken({ role: 'admin', lab: 'digicad', firebase: {} }, false))).toBe('permission-denied');
  });
  it('kabul eder: admin + MFA; emülatörde MFA gevşer', () => {
    expect(code(() => assertAdminMfaToken({ role: 'admin', lab: 'digicad', firebase: { sign_in_second_factor: 'totp' } }, false))).toBe('ok');
    expect(code(() => assertAdminMfaToken({ role: 'admin', lab: 'digicad' }, true))).toBe('ok');
    expect(code(() => assertAdminMfaToken({ role: 'doctor', lab: 'digicad' }, true))).toBe('permission-denied');
  });
});

describe('decideRate', () => {
  it('ilk çağrı pencere açar, limite kadar izin, sonra reddeder, pencere dolunca sıfırlar', () => {
    let st = decideRate(undefined, 1000, 3, 60);
    expect(st).toEqual({ allow: true, next: { start: 1000, n: 1 } });
    st = decideRate({ start: 1000, n: 1 }, 2000, 3, 60); expect(st).toEqual({ allow: true, next: { start: 1000, n: 2 } });
    st = decideRate({ start: 1000, n: 3 }, 3000, 3, 60); expect(st.allow).toBe(false);
    st = decideRate({ start: 1000, n: 3 }, 61000, 3, 60); expect(st).toEqual({ allow: true, next: { start: 61000, n: 1 } });
  });
  it('bozuk durum veya geriye giden saat pencereyi sıfırlar', () => {
    expect(decideRate({ start: NaN, n: 5 }, 10, 3, 60).allow).toBe(true);
    expect(decideRate({ start: 5000, n: 99 }, 10, 3, 60)).toEqual({ allow: true, next: { start: 10, n: 1 } });
  });
});

describe('doğrulama', () => {
  it('e-posta normalize edilir ve kötüsü reddedilir', () => {
    expect(normalizeEmail('  Ali@Ornek.COM ')).toBe('ali@ornek.com');
    for (const bad of ['a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a@c..com', 5, null, 'a'.repeat(65) + '@c.com', `a@${'b'.repeat(250)}.com`]) {
      expect(code(() => normalizeEmail(bad))).toBe('invalid-argument');
    }
  });
  it('uid', () => {
    expect(validateUid('abcDEF123')).toBe('abcDEF123');
    for (const bad of ['', 'a/b', 'x'.repeat(129), 1, undefined, '../x']) expect(code(() => validateUid(bad))).toBe('invalid-argument');
  });
  it('claimsFor: rol ve kimlik doğrulaması', () => {
    expect(claimsFor('admin', 'digicad')).toEqual({ role: 'admin', lab: 'digicad' });
    expect(claimsFor('doctor', 'digicad', 12)).toEqual({ role: 'doctor', lab: 'digicad', doctorId: '12' });
    expect(claimsFor('tech', 'primer', undefined, 't_1')).toEqual({ role: 'tech', lab: 'primer', techId: 't_1' });
    expect(code(() => claimsFor('root', 'digicad'))).toBe('invalid-argument');
    expect(code(() => claimsFor('doctor', 'digicad'))).toBe('invalid-argument');
    expect(code(() => claimsFor('doctor', 'digicad', { a: 1 }))).toBe('invalid-argument');
    expect(code(() => claimsFor('doctor', 'digicad', true))).toBe('invalid-argument');
    expect(code(() => claimsFor('tech', 'digicad', undefined, 'a/b'))).toBe('invalid-argument');
    expect(code(() => claimsFor(undefined, 'digicad'))).toBe('invalid-argument');
    expect(refId(0, 'x')).toBe('0');
    expect(code(() => refId(-1, 'x'))).toBe('invalid-argument');
  });
  it('displayName temizlenir', () => {
    expect(cleanDisplayName('<b>Ali</b>\n')).toBe('b Ali /b');
    expect(cleanDisplayName(5)).toBeUndefined();
    expect(cleanDisplayName('x'.repeat(500))?.length).toBe(120);
  });
  it('mapAuthError bilgi sızdırmaz', () => {
    expect(mapAuthError({ code: 'auth/email-already-exists' }).code).toBe('already-exists');
    expect(mapAuthError({ code: 'auth/user-not-found' }).code).toBe('not-found');
    const e = mapAuthError(new Error('secret internal stack /srv/x'));
    expect(e.code).toBe('internal'); expect(e.message).not.toMatch(/secret|srv/);
  });
  it('randomPassword ve sanitizeText', () => {
    const p = randomPassword(); expect(p).toHaveLength(16); expect(randomPassword()).not.toBe(p);
    expect(sanitizeText('a<script>x</script>b', 100)).toBe('a x b');
    expect(code(() => sanitizeText(5, 10))).toBe('invalid-argument');
    expect(code(() => sanitizeText('x'.repeat(11), 10))).toBe('invalid-argument');
    expect(sanitizeText('a\u0000b', 10)).toBe('ab');
  });
});

describe('audit mantığı', () => {
  it('kind', () => { expect(kindOf(null, { a: 1 })).toBe('create'); expect(kindOf({ a: 1 }, null)).toBe('DELETE-ALERT'); expect(kindOf({ a: 1 }, { a: 2 })).toBe('update'); });
  it('tüm klinik/finans koleksiyonları kapsanır; auditLog/history kapsanmaz (döngü yok)', () => {
    for (const c of ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures', 'settings', 'mailFilters', 'threads']) expect(AUDITED).toContain(c);
    expect(AUDITED).not.toContain('auditLog'); expect(AUDITED).not.toContain('history');
  });
  it('actor: silme değişince deletedBy, aksi halde updatedBy', () => {
    expect(actorOf({ n: 1 }, { n: 1, deletedAt: 5, deletedBy: 'u1', updatedBy: 'u2' })).toBe('u1');
    expect(actorOf({ deletedAt: 5, deletedBy: 'u1' }, { deletedAt: 5, deletedBy: 'u1', updatedBy: 'u3' })).toBe('u3');
    expect(actorOf(null, { createdBy: 'c' })).toBe('c');
    expect(actorOf({ updatedBy: 'z' }, null)).toBe('z');
    expect(actorOf(null, null)).toBeNull();
  });
  it('pack: küçük belge olduğu gibi, büyük belge gzip ile kayıpsız', () => {
    const small = pack({ a: 1 }, { a: 2 }, true); expect(small.compressed).toBeUndefined(); expect(small.before).toEqual({ a: 1 });
    const big = { text: 'abcdefghij'.repeat(60000) };
    const p = pack(big, big, true);
    expect(p.before).toBeNull(); expect(p.oversize).toBe(false);
    expect(JSON.parse(gunzipSync(p.compressed!.before!).toString())).toEqual(big);
    expect(JSON.parse(gunzipSync(p.compressed!.after!).toString())).toEqual(big);
  });
  it('pack: sıkıştırılamayan dev belge oversize işaretlenir', () => {
    const randomBytes = (n: number) => nodeCrypto.randomBytes(n);
    const rnd = { t: randomBytes(900_000).toString('base64') };
    expect(pack(rnd, null, false).oversize).toBe(true);
  });
});

describe('coerceParsed (prompt injection sonucu şema zorlaması)', () => {
  it('geçersiz girdi boş şema döner', () => {
    for (const bad of [null, undefined, 'x', 5, [], [1]]) expect(coerceParsed(bad)).toEqual({ patient: '', doctorName: '', jobType: '', teeth: [], color: '', dateout: '', notes: '' });
  });
  it('bilinmeyen alanları atar, uzunlukları kısar, işaretlemeyi temizler', () => {
    const r = coerceParsed({ patient: 'A<img onerror=x>', evil: 'rm -rf', notes: 'n'.repeat(5000), teeth: ['11', 12, '<x>', 'toolong', {}, '21'], dateout: '2025-02-30x', color: 'A2' });
    expect(r).not.toHaveProperty('evil');
    expect(r.patient).not.toMatch(/[<>]/); expect(r.notes).toHaveLength(2000);
    expect(r.teeth).toEqual(['11', '12', '21']); expect(r.dateout).toBe('');
    expect(coerceParsed({ dateout: '2025-03-14' }).dateout).toBe('2025-03-14');
    expect(coerceParsed({ teeth: Array(100).fill('11') }).teeth).toHaveLength(32);
  });
});

describe('backupPrefix', () => {
  it('geçerli bucket ve zaman damgalı yol (aynı gün çakışmaz)', () => {
    expect(backupPrefix('my-backup-bucket', new Date('2026-01-02T03:04:05.678Z'))).toBe('gs://my-backup-bucket/firestore/2026-01-02T03-04-05-678Z');
  });
  it('geçersiz bucket reddedilir', () => {
    for (const b of ['', 'gs://x-bucket', 'A_B', 'ab', 'x/y', 'bucket name']) expect(() => backupPrefix(b)).toThrow();
  });
});

describe('assertAdminMfaToken: lab claim', () => {
  it('çağıranın lab claim değerini döndürür (sabit lab yok)', () => {
    const mfa = { sign_in_second_factor: 'totp' };
    expect(assertAdminMfaToken({ role: 'admin', lab: 'primer', firebase: mfa }, false)).toBe('primer');
    expect(assertAdminMfaToken({ role: 'admin', lab: 'digicad', firebase: mfa }, false)).toBe('digicad');
  });
});

describe('planFileCopies / applyCopies (hekim gönderim dosyaları → iş klasörü)', () => {
  const sub = (n: string) => ({ name: n, path: `labs/digicad/submissions/5/${n}`, size: 3 });
  it('yalnızca işin hekimine ait submissions yollarını planlar', () => {
    const files = [sub('a.stl'), { name: 'b', path: 'labs/digicad/jobFiles/9/b.zip' }, { name: 'c', url: 'https://x' }, { name: 'd', path: 'labs/digicad/submissions/6/d.stl' }, { name: 'e', path: 'labs/primer/submissions/5/e.stl' }, { name: 'f', path: 'labs/digicad/submissions/5/../6/f.stl' }];
    expect(planFileCopies('digicad', '900', '5', files)).toEqual([{ index: 0, from: 'labs/digicad/submissions/5/a.stl', to: 'labs/digicad/jobFiles/900/a.stl' }]);
  });
  it('geçersiz kimlik/girdi boş plan döner', () => {
    expect(planFileCopies('digicad', '../x', '5', [sub('a')])).toEqual([]);
    expect(planFileCopies('digicad', '1', '', [sub('a')])).toEqual([]);
    expect(planFileCopies('digicad', '1', '5', 'x')).toEqual([]);
  });
  it('applyCopies yolu günceller, kaynağı copiedFrom olarak saklar, diğerlerine dokunmaz', () => {
    const files = [sub('a.stl'), { name: 'u', url: 'https://x' }];
    const out = applyCopies(files, new Map([[files[0].path, 'labs/digicad/jobFiles/900/a.stl']])) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ name: 'a.stl', path: 'labs/digicad/jobFiles/900/a.stl', copiedFrom: 'labs/digicad/submissions/5/a.stl' });
    expect(out[1]).toEqual({ name: 'u', url: 'https://x' });
  });
});

describe('clearDecision (mustChangePassword akışı)', () => {
  it('bayrak yoksa işlem yok', () => { expect(clearDecision({ role: 'doctor' }, 'abc')).toBe('noop'); });
  it('adminCreateUser/adminResetPassword hesabı: şifre değişmediyse bekletir, değiştiyse kaldırır', () => {
    expect(clearDecision({ mustChangePassword: true, pwv: 'aaa' }, 'aaa')).toBe('wait');
    expect(clearDecision({ mustChangePassword: true, pwv: 'aaa' }, 'bbb')).toBe('clear');
  });
  it('göçle/bootstrap ile açılan hesap (pwv yok): doğrudan kaldırılır', () => {
    expect(clearDecision({ mustChangePassword: true }, 'bbb')).toBe('clear');
    expect(clearDecision({ mustChangePassword: true }, null)).toBe('clear');
  });
  it('parmak izi çıkarılamazsa (parola özeti yok) fail-open', () => { expect(clearDecision({ mustChangePassword: true, pwv: 'aaa' }, null)).toBe('clear'); });
});
