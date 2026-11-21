import { assertSafeTarget, isForbiddenProject } from './guard';
import type { BucketSink } from './storage';

export type Doc = Record<string, unknown>;
export interface DocSink { get(path: string): Promise<Doc | undefined>; set(path: string, data: Doc): Promise<void>; listIds?(collectionPath: string): Promise<string[]> }
export interface Account { email: string; role: 'doctor' | 'tech'; refId: string; lab: string; name: string }
export interface EnsureResult { uid: string; created: boolean; skipped?: string }
export interface AuthSink {
  /** Yoksa oluşturur; varsa yalnızca claims günceller. Mevcut yönetici/başka kimliğe ait hesabı ASLA ezmez (skipped döner). */
  ensureUser(a: Account, tempPassword: string): Promise<EnsureResult>;
}
export const claimsFor = (a: Account): Record<string, unknown> => ({ role: a.role, lab: a.lab, ...(a.role === 'doctor' ? { doctorId: a.refId } : { techId: a.refId }) });
/** Mevcut hesap bu kayda ait değilse neden döndürür. */
export function claimConflict(existing: Record<string, unknown> | undefined, a: Account): string | undefined {
  if (!existing || !existing.role) return undefined;
  if (existing.role === 'admin') return 'mevcut hesap yönetici; ezilmedi';
  const mine = claimsFor(a);
  for (const k of ['role', 'lab', 'doctorId', 'techId']) if (existing[k] !== undefined && existing[k] !== mine[k]) return `mevcut hesap başka kayda bağlı (${k}=${String(existing[k])}); ezilmedi`;
  return undefined;
}

export class MemoryDocSink implements DocSink {
  store = new Map<string, Doc>(); writes = 0; reads = 0;
  async get(p: string) { this.reads++; const v = this.store.get(p); return v ? structuredClone(v) : undefined; }
  async set(p: string, d: Doc) { this.writes++; this.store.set(p, structuredClone(d)); }
  async listIds(c: string) { const pre = c + '/'; return [...this.store.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length)); }
}
export class MemoryAuthSink implements AuthSink {
  users = new Map<string, { uid: string; claims: Record<string, unknown> }>(); creates = 0; passwords: string[] = [];
  async ensureUser(a: Account, pw: string): Promise<EnsureResult> {
    const ex = this.users.get(a.email);
    if (ex) { const c = claimConflict(ex.claims, a); if (c) return { uid: ex.uid, created: false, skipped: c }; ex.claims = { ...ex.claims, ...claimsFor(a) }; return { uid: ex.uid, created: false }; }
    this.creates++; this.passwords.push(pw); const uid = 'uid_' + this.users.size; this.users.set(a.email, { uid, claims: { ...claimsFor(a), mustChangePassword: true } }); return { uid, created: true };
  }
}

async function adminApp(projectId: string, allowEmulator = false) {
  const id = assertSafeTarget(projectId, process.env, { allowEmulator });
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const app = initializeApp({ projectId: id, credential: applicationDefault() }, 'migration-' + Date.now());
  if (app.options.projectId !== id || isForbiddenProject(app.options.projectId)) throw new Error('REDDEDİLDİ: uygulama proje kimliği doğrulanamadı.');
  return { app, id };
}

export async function firestoreSinks(projectId: string, allowEmulator = false): Promise<{ docs: DocSink; auth: AuthSink }> {
  const { app } = await adminApp(projectId, allowEmulator);
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const fs = getFirestore(app); const au = getAuth(app);
  return {
    docs: {
      async get(p) { const s = await fs.doc(p).get(); return s.exists ? (s.data() as Doc) : undefined; },
      async set(p, d) { await fs.doc(p).set(d); }, // tam üzerine yazma: idempotent (çalıştırıcı, ezilen farklı sürümleri yerel dosyaya yedekler)
      async listIds(c) { return (await fs.collection(c).listDocuments()).map((r) => r.id); },
    },
    auth: {
      async ensureUser(a, pw) {
        try {
          const u = await au.getUserByEmail(a.email); const c = claimConflict(u.customClaims, a);
          if (c) return { uid: u.uid, created: false, skipped: c };
          await au.setCustomUserClaims(u.uid, { ...(u.customClaims ?? {}), ...claimsFor(a) }); return { uid: u.uid, created: false };
        } catch (e) { if ((e as { code?: string }).code !== 'auth/user-not-found') throw e; }
        const u = await au.createUser({ email: a.email, password: pw, displayName: a.name || undefined });
        await au.setCustomUserClaims(u.uid, { ...claimsFor(a), mustChangePassword: true });
        return { uid: u.uid, created: true };
      },
    },
  };
}

export async function storageSink(projectId: string, bucketName: string, allowEmulator = false): Promise<BucketSink> {
  if (isForbiddenProject(bucketName)) throw new Error('REDDEDİLDİ: eski projenin bucket\'ına yazılamaz.');
  const { app } = await adminApp(projectId, allowEmulator);
  const { getStorage } = await import('firebase-admin/storage');
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async head(object) { const f = bucket.file(object); const [ex] = await f.exists(); if (!ex) return undefined; const [m] = await f.getMetadata(); return { md5: String(m.md5Hash) }; },
    async upload(localPath, object, meta) {
      await bucket.upload(localPath, { destination: object, resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: meta.contentType, metadata: meta.token ? { firebaseStorageDownloadTokens: meta.token } : {} } });
    },
  };
}
