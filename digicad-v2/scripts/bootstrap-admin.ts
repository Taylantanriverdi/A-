/**
 * İlk yönetici hesabını oluşturur/yetkilendirir (YENİ projede, yerelden bir kez çalıştırılır).
 * Kullanım: GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/bootstrap-admin.ts YENI-PROJE-ID yonetici@ornek.com [--lab digicad]
 * --lab: yöneticinin çalışma alanı (varsayılan digicad). Her yönetici YALNIZCA kendi lab claim'indeki alana erişir;
 * Primer için ayrı bir hesapla `--lab primer` çalıştırın (aynı e-posta iki alana yönetici olamaz: claim tektir).
 * Geçici şifre ekrana yazılır; ilk girişte değiştirilir ve TOTP kurulumu zorunludur.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { assertSafeTarget } from '../migration/src/guard';

const args = process.argv.slice(2);
let lab = 'digicad';
const li = args.indexOf('--lab');
if (li >= 0) { lab = args[li + 1] ?? ''; args.splice(li, 2); }
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(lab)) { console.error('--lab geçersiz (küçük harf/rakam/-/_ , en fazla 32 karakter).'); process.exit(3); }
const [project, email] = args;
if (!project || !email) { console.error('Kullanım: bootstrap-admin.ts PROJE-ID e-posta [--lab digicad]'); process.exit(3); }
let projectId: string;
try { projectId = assertSafeTarget(project); } catch (e) { console.error((e as Error).message); process.exit(3); }
const app = initializeApp({ projectId, credential: applicationDefault() });
const au = getAuth(app);
const pw = randomBytes(18).toString('base64url') + '#9a';
let uid: string;
try { uid = (await au.getUserByEmail(email)).uid; } catch (e) { if ((e as { code?: string }).code !== 'auth/user-not-found') { console.error((e as Error).message); process.exit(1); } uid = (await au.createUser({ email, password: pw })).uid; console.log('Geçici şifre:', pw); }
await au.setCustomUserClaims(uid, { role: 'admin', lab, mustChangePassword: true });
console.log(`Yönetici yetkisi verildi: ${email} (çalışma alanı: ${lab})`);
