/**
 * İlk yönetici hesabını oluşturur/yetkilendirir (YENİ projede, yerelden bir kez çalıştırılır).
 * Kullanım: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/bootstrap-admin.ts YENI-PROJE-ID yonetici@ornek.com
 * Geçici şifre ekrana yazılır; ilk girişte değiştirilir ve TOTP kurulumu zorunludur.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [project, email] = process.argv.slice(2);
if (!project || !email) { console.error('Kullanım: bootstrap-admin.ts PROJE-ID e-posta'); process.exit(3); }
if (project.toLowerCase() === 'primer-dental') { console.error('REDDEDİLDİ: eski proje.'); process.exit(3); }
const app = initializeApp({ projectId: project, credential: applicationDefault() });
const au = getAuth(app);
const pw = randomBytes(12).toString('base64url') + '#9a';
let uid: string;
try { uid = (await au.getUserByEmail(email)).uid; } catch { uid = (await au.createUser({ email, password: pw })).uid; console.log('Geçici şifre:', pw); }
await au.setCustomUserClaims(uid, { role: 'admin', lab: 'digicad', mustChangePassword: true });
console.log('Yönetici yetkisi verildi:', email);
