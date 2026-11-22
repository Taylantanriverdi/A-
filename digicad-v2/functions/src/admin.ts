import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CALLABLE_OPTS, requireAdminMfa, rateLimit, randomPassword } from './util';
import { claimsFor, clearDecision, validAfterSec, normalizeEmail, validateUid, cleanDisplayName, mapAuthError, refId } from './validate';
import { planFileCopies, applyCopies } from './files';

const OPTS = CALLABLE_OPTS;

async function audit(lab: string, actor: string, action: string, detail: Record<string, unknown>) {
  try {
    await getFirestore().collection(`labs/${lab}/auditLog`).add({ at: FieldValue.serverTimestamp(), actor, action, detail });
  } catch (e) {
    console.error('auditLog yazılamadı', action, (e as { code?: unknown })?.code);
  }
}


/** doctorId/techId gerçekten var olan bir kayda işaret etmeli (yanlış kimlikle başka hekimin verisine erişimi önler). */
async function assertRefExists(lab: string, claims: Record<string, string>): Promise<void> {
  const coll = claims.role === 'doctor' ? 'doctors' : claims.role === 'tech' ? 'technicians' : null;
  if (!coll) return;
  const id = claims.role === 'doctor' ? claims.doctorId : claims.techId;
  const s = await getFirestore().doc(`labs/${lab}/${coll}/${id}`).get();
  if (!s.exists) throw new HttpsError('failed-precondition', 'Bağlanacak hekim/teknisyen kaydı bulunamadı.');
}

/** Hedef hesap bu çalışma alanına ait mi? (claim'i olmayan/başka lab'daki hesaba dokunulmaz.) */
function assertSameLab(claims: Record<string, unknown> | undefined, lab: string, allowUnassigned = false): void {
  const l = claims?.lab;
  if (l == null || l === '') { if (allowUnassigned) return; throw new HttpsError('permission-denied', 'Kullanıcı bu laboratuvara ait değil.'); }
  if (l !== lab) throw new HttpsError('permission-denied', 'Kullanıcı başka bir laboratuvara ait.');
}

export const adminCreateUser = onCall(OPTS, async (req) => {
  const { uid: actor, lab } = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(d.email);
  const claims = claimsFor(d.role, lab, d.doctorId, d.techId); // hedef lab = çağıranın lab'ı
  await assertRefExists(lab, claims);
  const tempPassword = randomPassword();
  let uid: string;
  try {
    const user = await getAuth().createUser({ email, password: tempPassword, displayName: cleanDisplayName(d.displayName) });
    uid = user.uid;
    try {
      const rec = await getAuth().getUser(uid);
      await getAuth().setCustomUserClaims(uid, { ...claims, mustChangePassword: true, pwt: validAfterSec(rec) });
    } catch (e) {
      // Yetkisiz/yarım hesap kalmasın: yeni oluşturulan (veri içermeyen) auth kaydını geri al.
      await getAuth().deleteUser(uid).catch(() => undefined);
      throw e;
    }
  } catch (e) { throw mapAuthError(e); }
  await audit(lab, actor, 'adminCreateUser', { uid, email, role: claims.role });
  // Geçici şifre yalnızca bu yanıtta döner; saklanmaz/loglanmaz.
  return { uid, email, tempPassword };
});

export const adminSetRole = onCall(OPTS, async (req) => {
  const { uid: actor, lab } = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const uid = validateUid(d.uid);
  if (uid === actor && d.role !== 'admin') throw new HttpsError('failed-precondition', 'Kendi yöneticilik rolünüzü kaldıramazsınız.');
  const claims = claimsFor(d.role, lab, d.doctorId, d.techId);
  await assertRefExists(lab, claims);
  try {
    const target = await getAuth().getUser(uid);
    const prev = target.customClaims ?? {};
    assertSameLab(prev, lab, true);
    const keep: Record<string, unknown> = {};
    if (prev.mustChangePassword) { keep.mustChangePassword = true; if (typeof prev.pwt === 'number') keep.pwt = prev.pwt; }
    await getAuth().setCustomUserClaims(uid, { ...claims, ...keep });
    await getAuth().revokeRefreshTokens(uid);
  } catch (e) { throw mapAuthError(e); }
  await audit(lab, actor, 'adminSetRole', { uid, role: claims.role });
  return { ok: true };
});

export const adminResetPassword = onCall(OPTS, async (req) => {
  const { uid: actor, lab } = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const uid = validateUid(((req.data ?? {}) as Record<string, unknown>).uid);
  const tempPassword = randomPassword();
  try {
    const before = await getAuth().getUser(uid);
    assertSameLab(before.customClaims, lab);
    await getAuth().updateUser(uid, { password: tempPassword });
    // Önce oturumları iptal et, SONRA geçerlilik zamanını oku: aksi halde iptal zamanı "şifre değişti" sanılırdı.
    await getAuth().revokeRefreshTokens(uid);
    const rec = await getAuth().getUser(uid);
    const c = { ...(rec.customClaims ?? {}) } as Record<string, unknown>; delete c.pwv;
    await getAuth().setCustomUserClaims(uid, { ...c, mustChangePassword: true, pwt: validAfterSec(rec) });
  } catch (e) { throw mapAuthError(e); }
  await audit(lab, actor, 'adminResetPassword', { uid });
  return { uid, tempPassword };
});

/**
 * Yumuşak silinen hekim/teknisyenin giriş hesabını devre dışı bırakır (ve oturumlarını iptal eder);
 * `disabled:false` ile (kayıt çöp kutusundan geri alınınca) yeniden etkinleştirir.
 * Yalnızca bu lab'ın hekim/teknisyen hesapları; yönetici hesabı ve kendi hesabınız bu yolla kapatılamaz.
 */
export const adminDisableUser = onCall(OPTS, async (req) => {
  const { uid: actor, lab } = requireAdminMfa(req);
  await rateLimit(actor, 'adminUsers', 60, 3600);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const uid = validateUid(d.uid);
  const disabled = d.disabled !== false;
  if (uid === actor) throw new HttpsError('failed-precondition', 'Kendi hesabınızı kapatamazsınız.');
  try {
    const target = await getAuth().getUser(uid);
    assertSameLab(target.customClaims, lab);
    const role = target.customClaims?.role;
    if (role !== 'doctor' && role !== 'tech') throw new HttpsError('failed-precondition', 'Yalnızca hekim/teknisyen hesapları kapatılabilir.');
    await getAuth().updateUser(uid, { disabled });
    if (disabled) await getAuth().revokeRefreshTokens(uid);
  } catch (e) { throw mapAuthError(e); }
  await audit(lab, actor, disabled ? 'adminDisableUser' : 'adminEnableUser', { uid });
  return { ok: true, disabled };
});

/**
 * Siparişe aktarılan işin dosyalarını hekim gönderim klasöründen işin klasörüne (jobFiles/{jobId}) kopyalar
 * (sunucu tarafı kopya; teknisyen yalnızca jobFiles'ı okuyabilir). Idempotent: yalnızca hâlâ submissions altında olan girdiler işlenir.
 */
export const copyJobFiles = onCall(OPTS, async (req) => {
  const { uid: actor, lab } = requireAdminMfa(req);
  await rateLimit(actor, 'copyJobFiles', 300, 3600);
  const jobId = refId(((req.data ?? {}) as Record<string, unknown>).jobId, 'jobId');
  const db = getFirestore();
  const jref = db.doc(`labs/${lab}/jobs/${jobId}`);
  const snap = await jref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'İş bulunamadı.');
  const job = snap.data() ?? {};
  const doctorId = String(job.doctorId ?? job.drId ?? '');
  const steps = planFileCopies(lab, jobId, doctorId, job.files);
  if (!steps.length) return { copied: 0, failed: 0 };
  const bucket = getStorage().bucket();
  const done = new Map<string, string>(); let failed = 0;
  for (const st of steps) {
    try {
      const dest = bucket.file(st.to);
      const [exists] = await dest.exists();
      if (!exists) await bucket.file(st.from).copy(dest);
      done.set(st.from, st.to);
    } catch (e) { failed++; console.error('Dosya kopyalanamadı', (e as { code?: unknown })?.code); }
  }
  if (done.size) {
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(jref);
      const files = cur.data()?.files;
      if (!Array.isArray(files)) return;
      tx.update(jref, { files: applyCopies(files, done), updatedAt: new Date().toISOString(), updatedBy: actor });
    });
  }
  await audit(lab, actor, 'copyJobFiles', { jobId, copied: done.size, failed });
  return { copied: done.size, failed };
});

/**
 * Kullanıcı geçici şifresini değiştirdikten sonra `mustChangePassword` claim'ini kaldırır.
 * (Claim'i istemci kaldıramaz; aksi halde kullanıcı sonsuza dek şifre ekranında kalır.)
 * Tüm hesap açma yolları (adminCreateUser, adminResetPassword, göç, bootstrap) `pwt` yazar; şifre gerçekten
 * değişmeden (tokensValidAfterTime ilerlemeden) bayrak kaldırılmaz. `pwt` yoksa kapalı kalır.
 */
export const clearMustChangePassword = onCall(OPTS, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Giriş gerekli.');
  const uid = req.auth.uid;
  await rateLimit(uid, 'clearMcp', 20, 3600);
  let lab = '';
  try {
    const rec = await getAuth().getUser(uid);
    const c = { ...(rec.customClaims ?? {}) } as Record<string, unknown>;
    lab = typeof c.lab === 'string' ? c.lab : '';
    const decision = clearDecision(c, validAfterSec(rec));
    if (decision === 'noop') return { ok: true };
    if (decision === 'wait') throw new HttpsError('failed-precondition', 'Şifre değişikliği henüz algılanmadı. Birkaç saniye sonra yeniden deneyin; sorun sürerse yöneticiden şifre sıfırlamasını isteyin.');
    delete c.mustChangePassword; delete c.pwv; delete c.pwt;
    await getAuth().setCustomUserClaims(uid, c);
  } catch (e) { throw mapAuthError(e); }
  if (lab) await audit(lab, uid, 'clearMustChangePassword', { uid });
  return { ok: true };
});
