/**
 * İlk yönetici hesabını oluşturur/yetkilendirir (YENİ projede, yerelden bir kez çalıştırılır).
 * Kullanım: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/bootstrap-admin.ts YENI-PROJE-ID yonetici@ornek.com
 * Geçici şifre ekrana yazılır; ilk girişte değiştirilir ve TOTP kurulumu zorunludur.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { assertSafeTarget } from '../migration/src/guard';

const [project, email] = process.argv.slice(2);
if (!project || !email) { console.error('Kullanım: bootstrap-admin.ts PROJE-ID e-posta'); process.exit(3); }
let projectId: string;
try { projectId = assertSafeTarget(project); } catch (e) { console.error((e as Error).message); process.exit(3); }
const app = initializeApp({ projectId, credential: applicationDefault() });
const au = getAuth(app);
const pw = randomBytes(18).toString('base64url') + '#9a';
let uid: string;
try { uid = (await au.getUserByEmail(email)).uid; } catch (e) { if ((e as { code?: string }).code !== 'auth/user-not-found') { console.error((e as Error).message); process.exit(1); } uid = (await au.createUser({ email, password: pw })).uid; console.log('Geçici şifre:', pw); }
await au.setCustomUserClaims(uid, { role: 'admin', lab: 'digicad', mustChangePassword: true });
console.log('Yönetici yetkisi verildi:', email);
