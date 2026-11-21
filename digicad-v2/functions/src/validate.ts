import { HttpsError } from 'firebase-functions/v2/https';

export type Role = 'admin' | 'doctor' | 'tech';
export const ROLES: readonly Role[] = ['admin', 'doctor', 'tech'];
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const REF_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeEmail(v: unknown): string {
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', 'Geçerli e-posta gerekli.');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw new HttpsError('invalid-argument', 'Geçerli e-posta gerekli.');
  return e;
}

export function validateUid(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', 'Geçerli uid gerekli.');
  return v;
}

export function refId(v: unknown, label: string): string {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) v = String(v);
  if (typeof v !== 'string' || !REF_ID.test(v)) throw new HttpsError('invalid-argument', `${label} geçersiz.`);
  return v;
}

/** Claim'ler: role, lab, doctorId (hekim), techId (teknisyen; hepsi METİN). Göç aracı, kurallar ve ön yüzle birebir aynı adlar. */
export function claimsFor(role: unknown, lab: string, doctorId?: unknown, techId?: unknown): Record<string, string> {
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) throw new HttpsError('invalid-argument', 'Geçersiz rol.');
  const c: Record<string, string> = { role, lab };
  if (role === 'doctor') c.doctorId = refId(doctorId, 'doctorId');
  if (role === 'tech') c.techId = refId(techId, 'techId');
  return c;
}

export function cleanDisplayName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
   
  const s = v.replace(/[\u0000-\u001F\u007F<>]/g, ' ').trim().slice(0, 120);
  return s || undefined;
}

/** Firebase Auth hatalarını bilgi sızdırmadan HttpsError'a çevirir. */
export function mapAuthError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'auth/email-already-exists') return new HttpsError('already-exists', 'Bu e-posta ile hesap zaten var.');
  if (code === 'auth/user-not-found') return new HttpsError('not-found', 'Kullanıcı bulunamadı.');
  if (code === 'auth/invalid-email' || code === 'auth/invalid-password') return new HttpsError('invalid-argument', 'Geçersiz değer.');
  console.error('Beklenmeyen hata kodu:', code || 'bilinmiyor');
  return new HttpsError('internal', 'İşlem tamamlanamadı.');
}
