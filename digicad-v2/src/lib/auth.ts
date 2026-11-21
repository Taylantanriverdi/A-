import {
  signInWithEmailAndPassword, signOut, onIdTokenChanged, updatePassword, getMultiFactorResolver,
  multiFactor, TotpMultiFactorGenerator, type User, type MultiFactorError, type TotpSecret,
} from 'firebase/auth';
import { auth, callFn, wipeLocalData } from './firebase';
import { validatePassword, isTotpCode } from './checks';

export type Role = 'admin' | 'doctor' | 'tech';
export interface Session {
  user: User; role: Role; lab: string; doctorId?: string; techId?: string; mustChangePassword: boolean;
  /** Bu oturum ikinci faktörle (TOTP) açıldı mı? (token `firebase.sign_in_second_factor`) */
  mfa?: boolean;
}

const ROLES: readonly string[] = ['admin', 'doctor', 'tech'];

export async function readSession(user: User, force = false): Promise<Session | null> {
  const t = await user.getIdTokenResult(force);
  const role = t.claims.role as Role | undefined;
  if (!role || !ROLES.includes(role) || !t.claims.lab) return null;
  const fb = t.claims.firebase as { sign_in_second_factor?: string } | undefined;
  return {
    user, role, lab: String(t.claims.lab),
    doctorId: t.claims.doctorId ? String(t.claims.doctorId) : undefined,
    techId: t.claims.techId ? String(t.claims.techId) : undefined,
    mustChangePassword: t.claims.mustChangePassword === true,
    mfa: fb?.sign_in_second_factor === 'totp',
  };
}

/** Rol/kimlik alanlarının imzası: değişirse (yetki alındı/verildi) sayfa yeniden yüklenir. */
export const claimsKey = (s: Session | null): string => (s ? [s.role, s.lab, s.doctorId ?? '', s.techId ?? ''].join('|') : '');

/**
 * Oturum/token değişimlerini izler (giriş, çıkış, saatlik yenileme, zorla yenileme).
 * Eski (sıra dışı biten) okumalar atılır; hata `onError`'a gider.
 */
export function watchSession(cb: (s: Session | null, u: User | null) => void, onError?: (e: unknown) => void): () => void {
  let seq = 0;
  return onIdTokenChanged(auth, async (u) => {
    const my = ++seq;
    try { const s = u ? await readSession(u) : null; if (my === seq) cb(s, u); } catch (e) { if (my === seq) onError?.(e); }
  });
}

/** E-posta/şifre ile giriş. Çok faktörlü doğrulama gerekirse `askCode` ile TOTP kodu istenir. */
export async function login(email: string, password: string, askCode: () => Promise<string>): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/multi-factor-auth-required') {
      const resolver = getMultiFactorResolver(auth, e as MultiFactorError);
      const hint = resolver.hints.find((x) => x.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!hint) throw new Error('Desteklenen ikinci faktör bulunamadı.');
      const code = (await askCode()).trim();
      if (!isTotpCode(code)) throw new Error('Doğrulama kodu 6 haneli olmalı.');
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await resolver.resolveSignIn(assertion);
    } else throw e;
  }
}

/** Sayfayı yeniler (testlerde değiştirilebilsin diye ayrı). */
export const reloadPage = (): void => { try { window.location.reload(); } catch { /* test ortamı */ } };

/** Çıkış: oturum kapanır, Firestore dinleyicileri/önbelleği temizlenir ve sayfa yenilenir (bellekteki hasta verisi atılır). */
export async function logout(): Promise<void> {
  try { await signOut(auth); } finally {
    await wipeLocalData();
    reloadPage();
  }
}

/**
 * Sunucudaki `mustChangePassword` bayrağını kaldırması için `clearMustChangePassword` callable'ını çağırır.
 * Sunucu: göçle açılan hesaplarda (pwv yok) bayrağı doğrudan kaldırır; adminCreateUser/adminResetPassword hesaplarında
 * şifre gerçekten değişmişse kaldırır. Başarısızlıkta hata fırlatır (sessizce yutulmaz).
 */
export async function clearMustChangePassword(): Promise<void> {
  await callFn('clearMustChangePassword', {});
}

export async function changePassword(newPassword: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Oturum yok');
  const bad = validatePassword(newPassword);
  if (bad) throw new Error(bad);
  await updatePassword(auth.currentUser, newPassword);
  try { await clearMustChangePassword(); } catch {
    // Şifre değişti ama sunucu bayrağı kaldıramadı (ağ/App Check): kullanıcı aynı ekranda kalır ve tekrar dener (şifre zaten yeni).
    throw new Error('Şifreniz güncellendi ancak hesap durumu güncellenemedi. Lütfen "Kaydet"e tekrar basın.');
  }
  await auth.currentUser.getIdToken(true); // yeni claim'ler (mustChangePassword yok) token'a işlensin
}

/** TOTP kaydı: gizli anahtarı ve otpauth bağlantısını döndürür (kullanıcı kimlik doğrulayıcı uygulamaya ekler). */
export async function startTotpEnrollment(user: User): Promise<{ secret: TotpSecret; otpauth: string }> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return { secret, otpauth: secret.generateQrCodeUrl(user.email ?? 'admin', 'DigiCAD') };
}
export async function finishTotpEnrollment(user: User, secret: TotpSecret, code: string): Promise<void> {
  if (!isTotpCode(code)) throw new Error('Doğrulama kodu 6 haneli olmalı.');
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  await multiFactor(user).enroll(assertion, 'Kimlik doğrulayıcı');
}
export const hasMfa = (u: User): boolean => multiFactor(u).enrolledFactors.length > 0;
