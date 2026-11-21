import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';

/** Yalnızca yönetici-olmayan sistem kayıtları (zamanlanmış yedek notu) için varsayılan çalışma alanı. Kullanıcı işlemleri ÇAĞIRANIN lab claim'ini kullanır. */
export const DEFAULT_LAB = 'digicad';
export const REGION = 'europe-west1';
/** Çalışma alanı (lab) kimliği: Firestore yolu ve claim değeri olarak güvenli, küçük harfli. */
export const LAB_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** Yönetici callable'larının ortak seçenekleri: App Check zorunlu + tek kullanımlık (replay korumalı) token. İstemci `limitedUseAppCheckTokens` ile çağırmalıdır. */
export const CALLABLE_OPTS = { enforceAppCheck: true, consumeAppCheckToken: true, region: REGION, maxInstances: 5 } as const;

interface TokenLike { role?: unknown; lab?: unknown; firebase?: { sign_in_second_factor?: string } }

/** Saf denetim: token yönetici + geçerli lab claim'li + MFA'lı mı? Dönen değer çağıranın çalışma alanıdır. Hata durumunda HttpsError fırlatır. */
export function assertAdminMfaToken(t: TokenLike | undefined, emulator: boolean): string {
  if (!t) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  if (t.role !== 'admin' || typeof t.lab !== 'string' || !LAB_RE.test(t.lab)) throw new HttpsError('permission-denied', 'Yalnızca yönetici.');
  if (!t.firebase?.sign_in_second_factor && !emulator) {
    throw new HttpsError('permission-denied', 'Çok faktörlü doğrulama zorunludur.');
  }
  return t.lab;
}

/** Çağıran admin değilse veya TOTP çok faktörlü doğrulama yoksa reddet. Yönetici yalnızca KENDİ lab claim'indeki çalışma alanında işlem yapar. */
export function requireAdminMfa(req: CallableRequest<unknown>): { uid: string; lab: string } {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  const lab = assertAdminMfaToken(req.auth.token as unknown as TokenLike, process.env.FUNCTIONS_EMULATOR === 'true');
  return { uid: req.auth.uid, lab };
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
   
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/<[^>]*>/g, ' ');
  if (clean.length > max) throw new HttpsError('invalid-argument', `Metin en fazla ${max} karakter olabilir.`);
  return clean.trim();
}
