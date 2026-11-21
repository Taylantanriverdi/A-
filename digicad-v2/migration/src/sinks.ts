export type Doc = Record<string, unknown>;
export interface DocSink { get(path: string): Promise<Doc | undefined>; set(path: string, data: Doc): Promise<void> }
export interface Account { email: string; role: 'doctor' | 'tech'; refId: string; lab: string; name: string }
export interface AuthSink {
  /** Yoksa oluşturur ve geçici şifreyi döndürür; varsa yalnızca claims günceller ve null döndürür. */
  ensureUser(a: Account, tempPassword: string): Promise<{ uid: string; created: boolean }>;
}

export class MemoryDocSink implements DocSink {
  store = new Map<string, Doc>(); writes = 0;
  async get(p: string) { const v = this.store.get(p); return v ? structuredClone(v) : undefined; }
  async set(p: string, d: Doc) { this.writes++; this.store.set(p, structuredClone(d)); }
}
export class MemoryAuthSink implements AuthSink {
  users = new Map<string, { uid: string; claims: Record<string, unknown> }>(); creates = 0;
  async ensureUser(a: Account, pw: string) {
    void pw; const claims = { role: a.role, lab: a.lab, ...(a.role === 'doctor' ? { doctorId: a.refId } : { techId: a.refId }) };
    const ex = this.users.get(a.email);
    if (ex) { ex.claims = { ...claims }; return { uid: ex.uid, created: false }; }
    this.creates++; const uid = 'uid_' + this.users.size; this.users.set(a.email, { uid, claims: { ...claims, mustChangePassword: true } }); return { uid, created: true };
  }
}

export async function firestoreSinks(projectId: string): Promise<{ docs: DocSink; auth: AuthSink }> {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const app = initializeApp({ projectId, credential: applicationDefault() }, 'migration');
  const fs = getFirestore(app); const au = getAuth(app);
  return {
    docs: {
      async get(p) { const s = await fs.doc(p).get(); return s.exists ? (s.data() as Doc) : undefined; },
      async set(p, d) { await fs.doc(p).set(d); }, // tam üzerine yazma: idempotent
    },
    auth: {
      async ensureUser(a, pw) {
        const claims = { role: a.role, lab: a.lab, ...(a.role === 'doctor' ? { doctorId: a.refId } : { techId: a.refId }) };
        try { const u = await au.getUserByEmail(a.email); await au.setCustomUserClaims(u.uid, { ...(u.customClaims ?? {}), ...claims }); return { uid: u.uid, created: false }; }
        catch (e) { if ((e as { code?: string }).code !== 'auth/user-not-found') throw e; }
        const u = await au.createUser({ email: a.email, password: pw, displayName: a.name });
        await au.setCustomUserClaims(u.uid, { ...claims, mustChangePassword: true });
        return { uid: u.uid, created: true };
      },
    },
  };
}
