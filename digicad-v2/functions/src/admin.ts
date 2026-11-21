import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { LAB, REGION, requireAdminMfa, rateLimit, randomPassword } from './util';
import { claimsFor, normalizeEmail, validateUid, cleanDisplayName, mapAuthError } from './validate';

const OPTS = { enforceAppCheck: true, region: REGION, maxInstances: 5 } as const;

async function audit(actor: string, action: string, detail: Record<string, unknown>) {
  try {
    await getFirestore().collection(`labs/${LAB}/auditLog`).add({ at: FieldValue.serverTimestamp(), actor, action, detail });
  } catch (e) {
    console.error('auditLog yazılamadı', action, (e as { code?: unknown })?.code);
  }
}

/** Şifre özeti parmak izi: kullanıcı şifreyi gerçekten değiştirdi mi kontrolü için (özetin kendisi saklanmaz). */
function pwFingerprint(rec: { passwordHash?: string; passwordSalt?: string }): string | null {
  if (!rec.passwordHash) return null;
  return createHash('sha256').update(`${rec.passwordSalt ?? ''}:${rec.passwordHash}`).digest('hex').slice(0, 16);
}

/** doctorId/techId gerçekten var olan bir kayda işaret etmeli (yanlış kimlikle başka hekimin verisine erişimi önler). */
async function assertRefExists(claims: Record<string, string>): Promise<void> {
  const coll = claims.role === 'doctor' ? 'doctors' : claims.role === 'tech' ? 'technicians' : null;
  if (!coll) return;
  const id = claims.role === 'doctor' ? claims.doctorId : claims.techId;
  const s = await getFirestore().doc(`labs/${LAB}/${coll}/${id}`).get();
  if (!s.exists) throw new HttpsError('failed-precondition', 'Bağlanacak hekim/teknisyen kaydı bulunamadı.');
}

export const adminCreateUser = onCall(OPTS, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(d.email);
  const claims = claimsFor(d.role, d.doctorId, d.techId);
  await assertRefExists(claims);
  const tempPassword = randomPassword();
  let uid: string;
  try {
    const user = await getAuth().createUser({ email, password: tempPassword, displayName: cleanDisplayName(d.displayName) });
    uid = user.uid;
    try {
      const rec = await getAuth().getUser(uid);
      await getAuth().setCustomUserClaims(uid, { ...claims, mustChangePassword: true, ...(pwFingerprint(rec) ? { pwv: pwFingerprint(rec) } : {}) });
    } catch (e) {
      // Yetkisiz/yarım hesap kalmasın: yeni oluşturulan (veri içermeyen) auth kaydını geri al.
      await getAuth().deleteUser(uid).catch(() => undefined);
      throw e;
    }
  } catch (e) { throw mapAuthError(e); }
  await audit(actor, 'adminCreateUser', { uid, email, role: claims.role });
  // Geçici şifre yalnızca bu yanıtta döner; saklanmaz/loglanmaz.
  return { uid, email, tempPassword };
});

export const adminSetRole = onCall(OPTS, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const uid = validateUid(d.uid);
  if (uid === actor && d.role !== 'admin') throw new HttpsError('failed-precondition', 'Kendi yöneticilik rolünüzü kaldıramazsınız.');
  const claims = claimsFor(d.role, d.doctorId, d.techId);
  await assertRefExists(claims);
  try {
    const target = await getAuth().getUser(uid);
    const prev = target.customClaims ?? {};
    if (prev.lab != null && prev.lab !== LAB) throw new HttpsError('permission-denied', 'Kullanıcı başka bir laboratuvara ait.');
    const keep: Record<string, unknown> = {};
    if (prev.mustChangePassword) { keep.mustChangePassword = true; if (prev.pwv) keep.pwv = prev.pwv; }
    await getAuth().setCustomUserClaims(uid, { ...claims, ...keep });
    await getAuth().revokeRefreshTokens(uid);
  } catch (e) { throw mapAuthError(e); }
  await audit(actor, 'adminSetRole', { uid, role: claims.role });
  return { ok: true };
});

export const adminResetPassword = onCall(OPTS, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const uid = validateUid(((req.data ?? {}) as Record<string, unknown>).uid);
  const tempPassword = randomPassword();
  try {
    const before = await getAuth().getUser(uid);
    if (before.customClaims?.lab != null && before.customClaims.lab !== LAB) throw new HttpsError('permission-denied', 'Kullanıcı başka bir laboratuvara ait.');
    const user = await getAuth().updateUser(uid, { password: tempPassword });
    const rec = await getAuth().getUser(uid);
    const fp = pwFingerprint(rec);
    await getAuth().setCustomUserClaims(uid, { ...(user.customClaims ?? {}), mustChangePassword: true, ...(fp ? { pwv: fp } : {}) });
    await getAuth().revokeRefreshTokens(uid);
  } catch (e) { throw mapAuthError(e); }
  await audit(actor, 'adminResetPassword', { uid });
  return { uid, tempPassword };
});

/**
 * Kullanıcı geçici şifresini değiştirdikten sonra `mustChangePassword` claim'ini kaldırır.
 * (Claim'i istemci kaldıramaz; aksi halde kullanıcı sonsuza dek şifre ekranında kalır.)
 */
export const clearMustChangePassword = onCall(OPTS, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  const uid = req.auth.uid;
  await rateLimit(uid, 'clearMcp', 20, 3600);
  try {
    const rec = await getAuth().getUser(uid);
    const c = { ...(rec.customClaims ?? {}) } as Record<string, unknown>;
    if (!c.mustChangePassword) return { ok: true };
    const fp = pwFingerprint(rec);
    if (fp && c.pwv && fp === c.pwv) throw new HttpsError('failed-precondition', 'Şifre henüz değiştirilmedi.');
    delete c.mustChangePassword; delete c.pwv;
    await getAuth().setCustomUserClaims(uid, c);
  } catch (e) { throw mapAuthError(e); }
  await audit(uid, 'clearMustChangePassword', { uid });
  return { ok: true };
});
