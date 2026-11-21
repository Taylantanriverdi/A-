import { readFileSync } from 'node:fs';

/** Eski canlı proje: göç aracı ona ASLA yazmaz/bağlanmaz. Büyük/küçük harf, boşluk, noktalama ve alt dizgi atlatmaları da reddedilir. */
export const FORBIDDEN_PROJECTS = ['primer-dental'];
const squash = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
export const normalizeProjectId = (p: string): string => p.normalize('NFKC').trim().toLowerCase();

export function isForbiddenProject(p: string | undefined | null): boolean {
  if (!p) return false;
  const q = squash(p);
  return FORBIDDEN_PROJECTS.some((f) => q.includes(squash(f)));
}

export interface GuardEnv { [k: string]: string | undefined }

/** Hedef proje kimliğini doğrular; ihlalde Error fırlatır. Ağ çağrısı yapmaz. */
export function assertSafeTarget(project: string | undefined, env: GuardEnv = process.env, opts: { allowEmulator?: boolean; readFile?: (p: string) => string } = {}): string {
  if (!project || !project.trim()) throw new Error('--project (YENİ proje kimliği) zorunlu.');
  const id = normalizeProjectId(project);
  if (isForbiddenProject(project)) throw new Error('REDDEDİLDİ: eski canlı projeye (primer-dental) yazılamaz.');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) throw new Error(`REDDEDİLDİ: geçersiz proje kimliği biçimi: "${project}"`);
  for (const k of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT']) {
    if (isForbiddenProject(env[k])) throw new Error(`REDDEDİLDİ: ortam değişkeni ${k} eski projeyi gösteriyor.`);
  }
  if (env.FIREBASE_CONFIG) {
    let pid: unknown = env.FIREBASE_CONFIG;
    try { pid = (JSON.parse(env.FIREBASE_CONFIG) as { projectId?: string }).projectId; } catch { /* düz metin */ }
    if (isForbiddenProject(String(pid)) || isForbiddenProject(env.FIREBASE_CONFIG)) throw new Error('REDDEDİLDİ: FIREBASE_CONFIG eski projeyi gösteriyor.');
  }
  if (!opts.allowEmulator && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST)) {
    throw new Error('REDDEDİLDİ: emülatör ortam değişkenleri ayarlı; yazımlar gerçek projeye değil emülatöre giderdi ve rapor yanıltıcı olurdu. Değişkenleri kaldırın.');
  }
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    let cred: { project_id?: string; quota_project_id?: string } | undefined;
    try { cred = JSON.parse((opts.readFile ?? ((p) => readFileSync(p, 'utf8')))(credPath)); } catch { cred = undefined; }
    if (cred) {
      if (isForbiddenProject(cred.project_id) || isForbiddenProject(cred.quota_project_id)) throw new Error('REDDEDİLDİ: servis hesabı anahtarı eski projeye ait.');
      if (cred.project_id && normalizeProjectId(cred.project_id) !== id) throw new Error(`REDDEDİLDİ: servis hesabı anahtarının projesi (${cred.project_id}) --project (${project}) ile aynı değil.`);
    }
  }
  return id;
}
