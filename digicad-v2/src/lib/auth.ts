import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, getMultiFactorResolver,
  multiFactor, TotpMultiFactorGenerator, type User, type MultiFactorError, type TotpSecret,
} from 'firebase/auth';
import { auth } from './firebase';

export type Role = 'admin' | 'doctor' | 'tech';
export interface Session { user: User; role: Role; lab: string; doctorId?: string; techId?: string; mustChangePassword: boolean }

export async function readSession(user: User, force = false): Promise<Session | null> {
  const t = await user.getIdTokenResult(force);
  const role = t.claims.role as Role | undefined;
  if (!role || !t.claims.lab) return null;
  return {
    user, role, lab: String(t.claims.lab),
    doctorId: t.claims.doctorId ? String(t.claims.doctorId) : undefined,
    techId: t.claims.techId ? String(t.claims.techId) : undefined,
    mustChangePassword: t.claims.mustChangePassword === true,
  };
}

export function watchSession(cb: (s: Session | null, u: User | null) => void): () => void {
  return onAuthStateChanged(auth, async (u) => { cb(u ? await readSession(u) : null, u); });
}

/** E-posta/şifre ile giriş. Çok faktörlü doğrulama gerekirse `askCode` ile TOTP kodu istenir. */
export async function login(email: string, password: string, askCode: () => Promise<string>): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/multi-factor-auth-required') {
      const resolver = getMultiFactorResolver(auth, e as MultiFactorError);
      const hint = resolver.hints.find((x) => x.factorId === TotpMultiFactorGenerator.FACTOR_ID);
      if (!hint) throw new Error('Desteklenen ikinci faktör bulunamadı.');
      const code = await askCode();
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await resolver.resolveSignIn(assertion);
    } else throw e;
  }
}

export const logout = (): Promise<void> => signOut(auth);

export async function changePassword(newPassword: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Oturum yok');
  if (newPassword.length < 10) throw new Error('Şifre en az 10 karakter olmalı.');
  await updatePassword(auth.currentUser, newPassword);
  await auth.currentUser.getIdToken(true);
}

/** TOTP kaydı: gizli anahtarı ve otpauth bağlantısını döndürür (kullanıcı kimlik doğrulayıcı uygulamaya ekler). */
export async function startTotpEnrollment(user: User): Promise<{ secret: TotpSecret; otpauth: string }> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  return { secret, otpauth: secret.generateQrCodeUrl(user.email ?? 'admin', 'DigiCAD') };
}
export async function finishTotpEnrollment(user: User, secret: TotpSecret, code: string): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  await multiFactor(user).enroll(assertion, 'Kimlik doğrulayıcı');
}
export const hasMfa = (u: User): boolean => multiFactor(u).enrolledFactors.length > 0;
