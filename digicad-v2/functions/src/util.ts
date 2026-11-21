import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const LAB = 'digicad';

/** Çağıran admin değilse veya TOTP çok faktörlü doğrulama yoksa reddet. */
export function requireAdminMfa(req: CallableRequest<unknown>): string {
  const t = req.auth?.token;
  if (!req.auth || !t) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  if (t.role !== 'admin') throw new HttpsError('permission-denied', 'Yalnızca yönetici.');
  const second = (t.firebase as { sign_in_second_factor?: string } | undefined)?.sign_in_second_factor;
  if (!second && process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new HttpsError('permission-denied', 'Çok faktörlü doğrulama zorunludur.');
  }
  return req.auth.uid;
}

/** Firestore tabanlı basit oran sınırlama (pencere başına en fazla `max` çağrı). */
export async function rateLimit(uid: string, key: string, max: number, windowSec: number): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`_rateLimits/${uid}_${key}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data() as { start: number; n: number } | undefined;
    if (!d || now - d.start > windowSec * 1000) { tx.set(ref, { start: now, n: 1, at: FieldValue.serverTimestamp() }); return; }
    if (d.n >= max) throw new HttpsError('resource-exhausted', 'Çok fazla istek. Lütfen daha sonra deneyin.');
    tx.update(ref, { n: d.n + 1 });
  });
}

export function randomPassword(len = 16): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomInt } = require('node:crypto') as typeof import('node:crypto');
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
