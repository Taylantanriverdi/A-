import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { LAB, requireAdminMfa, rateLimit, randomPassword } from './util';

type Role = 'admin' | 'doctor' | 'tech';
const ROLES: Role[] = ['admin', 'doctor', 'tech'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

interface CreateIn { email: string; role: Role; doctorId?: string | number; techId?: string | number; displayName?: string }

function claimsFor(role: Role, doctorId?: string | number, techId?: string | number): Record<string, string> {
  if (!ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Geçersiz rol.');
  const c: Record<string, string> = { role, lab: LAB };
  if (role === 'doctor') { if (doctorId == null) throw new HttpsError('invalid-argument', 'doctorId gerekli.'); c.doctorId = String(doctorId); }
  if (role === 'tech') { if (techId == null) throw new HttpsError('invalid-argument', 'techId gerekli.'); c.techId = String(techId); }
  return c;
}

async function audit(actor: string, action: string, detail: Record<string, unknown>) {
  await getFirestore().collection(`labs/${LAB}/auditLog`).add({ at: FieldValue.serverTimestamp(), actor, action, detail });
}

export const adminCreateUser = onCall({ enforceAppCheck: true, region: 'europe-west1' }, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = req.data as CreateIn;
  if (!d || typeof d.email !== 'string' || !EMAIL.test(d.email)) throw new HttpsError('invalid-argument', 'Geçerli e-posta gerekli.');
  const claims = claimsFor(d.role, d.doctorId, d.techId);
  const tempPassword = randomPassword();
  const user = await getAuth().createUser({
    email: d.email.trim().toLowerCase(), password: tempPassword,
    displayName: typeof d.displayName === 'string' ? d.displayName.slice(0, 120) : undefined,
  });
  await getAuth().setCustomUserClaims(user.uid, { ...claims, mustChangePassword: true });
  await audit(actor, 'adminCreateUser', { uid: user.uid, email: user.email, role: d.role });
  // Geçici şifre yalnızca bu yanıtta döner; saklanmaz/loglanmaz.
  return { uid: user.uid, email: user.email, tempPassword };
});

export const adminSetRole = onCall({ enforceAppCheck: true, region: 'europe-west1' }, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = req.data as { uid: string; role: Role; doctorId?: string | number; techId?: string | number };
  if (!d || typeof d.uid !== 'string' || d.uid.length > 128) throw new HttpsError('invalid-argument', 'uid gerekli.');
  if (d.uid === req.auth!.uid && d.role !== 'admin') throw new HttpsError('failed-precondition', 'Kendi yöneticilik rolünüzü kaldıramazsınız.');
  const claims = claimsFor(d.role, d.doctorId, d.techId);
  const prev = (await getAuth().getUser(d.uid)).customClaims ?? {};
  await getAuth().setCustomUserClaims(d.uid, { ...claims, ...(prev.mustChangePassword ? { mustChangePassword: true } : {}) });
  await getAuth().revokeRefreshTokens(d.uid);
  await audit(actor, 'adminSetRole', { uid: d.uid, role: d.role });
  return { ok: true };
});

export const adminResetPassword = onCall({ enforceAppCheck: true, region: 'europe-west1' }, async (req) => {
  const actor = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = req.data as { uid: string };
  if (!d || typeof d.uid !== 'string') throw new HttpsError('invalid-argument', 'uid gerekli.');
  const tempPassword = randomPassword();
  const user = await getAuth().updateUser(d.uid, { password: tempPassword });
  const prev = user.customClaims ?? {};
  await getAuth().setCustomUserClaims(d.uid, { ...prev, mustChangePassword: true });
  await getAuth().revokeRefreshTokens(d.uid);
  await audit(actor, 'adminResetPassword', { uid: d.uid });
  return { uid: d.uid, tempPassword };
});
