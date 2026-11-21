/** DEMO — `firebase/auth` taklidi: sayfaya uygun rolle otomatik açılmış oturum (admin için TOTP'li). */
import { DEMO_DOCTOR, DEMO_TECH, LAB } from '../seed';

type Claims = Record<string, unknown>;
export interface DemoUser {
  uid: string; email: string; displayName: string; emailVerified: boolean; claims: Claims;
  getIdToken: (force?: boolean) => Promise<string>;
  getIdTokenResult: (force?: boolean) => Promise<{ token: string; claims: Claims }>;
}

function identity(): { uid: string; email: string; name: string; claims: Claims } {
  switch (__DEMO_PAGE__) {
    case 'hekim': return { uid: `demo-doctor-${DEMO_DOCTOR.id}`, email: DEMO_DOCTOR.email, name: DEMO_DOCTOR.name, claims: { role: 'doctor', lab: LAB, doctorId: DEMO_DOCTOR.id } };
    case 'teknisyen': return { uid: `demo-tech-${DEMO_TECH.id}`, email: DEMO_TECH.email, name: DEMO_TECH.name, claims: { role: 'tech', lab: LAB, techId: DEMO_TECH.id } };
    default: return { uid: 'demo-admin', email: 'yonetici@digicad-demo.example', name: 'Demo Yönetici', claims: { role: 'admin', lab: LAB, firebase: { sign_in_second_factor: 'totp' } } };
  }
}
function makeUser(): DemoUser {
  const i = identity();
  return { uid: i.uid, email: i.email, displayName: i.name, emailVerified: true, claims: i.claims,
    getIdToken: async () => 'demo-token', getIdTokenResult: async () => ({ token: 'demo-token', claims: { ...i.claims } }) };
}

export interface DemoAuth { currentUser: DemoUser | null; app: object }
type Cb = (u: DemoUser | null) => void;
const listeners = new Set<Cb>();
let auth: DemoAuth | undefined;

export const initializeAuth = (): DemoAuth => (auth ??= { currentUser: makeUser(), app: {} });
export const getAuth = initializeAuth;
export const connectAuthEmulator = (): void => undefined;
export const browserSessionPersistence = { type: 'SESSION' };
export const indexedDBLocalPersistence = { type: 'LOCAL' };
export const browserLocalPersistence = { type: 'LOCAL' };

function watch(a: DemoAuth, cb: Cb): () => void {
  listeners.add(cb);
  setTimeout(() => { if (listeners.has(cb)) cb(a.currentUser); }, 0);
  return () => { listeners.delete(cb); };
}
export const onAuthStateChanged = (a: DemoAuth, cb: Cb): (() => void) => watch(a, cb);
export const onIdTokenChanged = (a: DemoAuth, cb: Cb): (() => void) => watch(a, cb);

/** Çıkış: oturum kapanır; uygulama ardından sayfayı yeniler ve demo kimliğiyle yeniden açılır (bu yüzden dinleyicilere bildirilmez: giriş formu yanıp sönmesin). */
export async function signOut(a: DemoAuth): Promise<void> { a.currentUser = null; }
export async function signInWithEmailAndPassword(a: DemoAuth): Promise<{ user: DemoUser }> { a.currentUser = makeUser(); listeners.forEach((l) => l(a.currentUser)); return { user: a.currentUser }; }
export const updatePassword = async (): Promise<void> => undefined;

/* ---------- Çok faktörlü doğrulama (TOTP): demo hesaplarda kayıtlı görünür ---------- */
export const multiFactor = (): { enrolledFactors: object[]; getSession: () => Promise<object>; enroll: () => Promise<void> } => ({
  enrolledFactors: [{ uid: 'demo-totp', factorId: 'totp', displayName: 'Kimlik doğrulayıcı' }], getSession: async () => ({}), enroll: async () => undefined,
});
export const getMultiFactorResolver = (): never => { throw new Error('Demo: ikinci faktör gerekmez.'); };
export const TotpMultiFactorGenerator = {
  FACTOR_ID: 'totp',
  assertionForSignIn: (): object => ({}), assertionForEnrollment: (): object => ({}),
  generateSecret: async (): Promise<{ secretKey: string; generateQrCodeUrl: () => string }> => ({ secretKey: 'DEMODEMODEMODEMO', generateQrCodeUrl: () => 'otpauth://totp/DigiCAD:demo?secret=DEMODEMODEMODEMO' }),
};
