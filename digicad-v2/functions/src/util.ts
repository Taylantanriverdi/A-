import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';

export const LAB = 'digicad';
export const REGION = 'europe-west1';

interface TokenLike { role?: unknown; lab?: unknown; firebase?: { sign_in_second_factor?: string } }

/** Saf denetim: token yönetici + MFA'lı mı? Hata durumunda HttpsError fırlatır. */
export function assertAdminMfaToken(t: TokenLike | undefined, emulator: boolean): void {
  if (!t) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  if (t.role !== 'admin' || t.lab !== LAB) throw new HttpsError('permission-denied', 'Yalnızca yönetici.');
  if (!t.firebase?.sign_in_second_factor && !emulator) {
    throw new HttpsError('permission-denied', 'Çok faktörlü doğrulama zorunludur.');
  }
}

/** Çağıran admin değilse veya TOTP çok faktörlü doğrulama yoksa reddet. */
export function requireAdminMfa(req: CallableRequest<unknown>): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  assertAdminMfaToken(req.auth.token as unknown as TokenLike, process.env.FUNCTIONS_EMULATOR === 'true');
  return req.auth.uid;
}

export interface RateState { start: number; n: number }
export type RateDecision = { allow: true; next: RateState } | { allow: false };

/** Saf oran sınırı hesabı (sabit pencere). Saat geriye giderse pencere sıfırlanır. */
export function decideRate(d: RateState | undefined, now: number, max: number, windowSec: number): RateDecision {
  const valid = d && Number.isFinite(d.start) && Number.isFinite(d.n);
  if (!valid || now < d.start || now - d.start >= windowSec * 1000) return { allow: true, next: { start: now, n: 1 } };
  if (d.n >= max) return { allow: false };
  return { allow: true, next: { start: d.start, n: d.n + 1 } };
}

/** Firestore tabanlı oran sınırlama; okuma+yazma tek transaction içinde (atomik). */
export async function rateLimit(uid: string, key: string, max: number, windowSec: number): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`_rateLimits/${uid}_${key}`);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const dec = decideRate(s.data() as RateState | undefined, Date.now(), max, windowSec);
    if (!dec.allow) throw new HttpsError('resource-exhausted', 'Çok fazla istek. Lütfen daha sonra deneyin.');
    tx.set(ref, { ...dec.next, at: FieldValue.serverTimestamp() });
  });
}

export function randomPassword(len = 16): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!?#%';
  let out = '';
  for (let i = 0; i < len; i++) out += abc[randomInt(abc.length)];
  return out;
}

export function sanitizeText(s: unknown, max: number): string {
  if (typeof s !== 'string') throw new HttpsError('invalid-argument', 'Metin bekleniyor.');
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/<[^>]*>/g, ' ');
  if (clean.length > max) throw new HttpsError('invalid-argument', `Metin en fazla ${max} karakter olabilir.`);
  return clean.trim();
}
