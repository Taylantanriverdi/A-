import { canonical, hashRecord } from './canonical';

export const KNOWN_WORKSPACES: Record<string, string> = { digicad: 'digicad', primer: 'primer' };
export const RECORD_COLLECTIONS = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures'] as const;
/** Taşınmayan gizli alanlar (düz metin şifre/PIN). */
export const SECRET_FIELDS = ['password', 'pass', 'pin', 'pwd', 'sifre', 'şifre'];

export interface PlannedDoc { path: string; collection: string; data: Record<string, unknown>; hash: string; sourceKey: string }
export interface Plan {
  docs: PlannedDoc[];
  errors: string[];
  warnings: string[];
  skipped: { what: string; reason: string }[];
  strippedSecrets: number;
  sourceCounts: Record<string, number>; // "lab/koleksiyon" -> kaynak kayıt sayısı
}
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** RTDB'nin dizi/obje ikiliğini tek biçime indirger: [key, value][] (null/boş atlanır). */
export function entriesOf(node: unknown): [string, unknown][] {
  if (node == null) return [];
  if (Array.isArray(node)) return node.map((v, i): [string, unknown] => [String(i), v]).filter(([, v]) => v != null);
  if (isObj(node)) return Object.entries(node).filter(([, v]) => v != null);
  return [];
}

/** JSON dışa aktarımının farklı biçimlerinden çalışma alanı ağaçlarını bulur. */
export function extractWorkspaces(root: unknown): Record<string, Json> {
  if (!isObj(root)) throw new Error('Dışa aktarım bir JSON nesnesi olmalı.');
  const out: Record<string, Json> = {};
  const db = isObj(root.db) ? root.db : undefined;
  const src = db ?? root;
  for (const ws of Object.keys(KNOWN_WORKSPACES)) if (isObj(src[ws])) out[ws] = src[ws] as Json;
  if (!Object.keys(out).length && RECORD_COLLECTIONS.some((c) => c in root)) out.digicad = root; // doğrudan digicad alt ağacı
  return out;
}

function hasNestedArray(v: unknown, depth = 0): boolean {
  if (Array.isArray(v)) return v.some((x) => Array.isArray(x) || hasNestedArray(x, depth + 1));
  if (isObj(v)) return Object.values(v).some((x) => hasNestedArray(x, depth + 1));
  return false;
}
const validKey = (k: string) => k.length > 0 && !k.includes('/') && k !== '.' && k !== '..' && !/^__.*__$/.test(k);

export function transformRecord(collection: string, key: string, rec: Json, ws: string): { data: Json; stripped: number } {
  const data: Json = { ...rec };
  let stripped = 0;
  if (collection === 'doctors' || collection === 'technicians') for (const f of SECRET_FIELDS) if (f in data) { delete data[f]; stripped++; }
  if (data.id === undefined) data.id = isNaN(Number(key)) ? key : Number(key);
  if (['jobs', 'pendingJobs', 'orderForms', 'payments', 'doctorSubmissions', 'statementClosures'].includes(collection)) {
    const dr = data.doctorId ?? data.drId;
    if (dr !== undefined && dr !== null) data.doctorId = String(dr);
    if (collection === 'jobs' || collection === 'pendingJobs') {
      data.techIds = Array.isArray(data.techIds) ? (data.techIds as unknown[]).map(String) : data.techId != null && data.techId !== '' ? [String(data.techId)] : [];
    }
  }
  data._legacy = { workspace: ws, key };
  return { data, stripped };
}

export function buildPlan(root: unknown): Plan {
  const plan: Plan = { docs: [], errors: [], warnings: [], skipped: [], strippedSecrets: 0, sourceCounts: {} };
  const workspaces = extractWorkspaces(root);
  if (!Object.keys(workspaces).length) plan.errors.push('Dışa aktarımda tanınan çalışma alanı (db/digicad veya db/primer) bulunamadı.');
  const seen = new Set<string>();
  const add = (d: Omit<PlannedDoc, 'hash'>) => {
    if (seen.has(d.path)) { plan.errors.push(`Yinelenen hedef yol: ${d.path}`); return; }
    seen.add(d.path);
    if (hasNestedArray(d.data)) plan.errors.push(`İç içe dizi (Firestore desteklemez): ${d.path}`);
    plan.docs.push({ ...d, hash: hashRecord(d.data) });
  };
  for (const [ws, tree] of Object.entries(workspaces)) {
    const lab = KNOWN_WORKSPACES[ws];
    for (const c of RECORD_COLLECTIONS) {
      const ents = entriesOf(tree[c]);
      plan.sourceCounts[`${lab}/${c}`] = ents.length;
      for (const [key, v] of ents) {
        if (!isObj(v)) { plan.errors.push(`${lab}/${c}/${key}: kayıt nesne değil`); continue; }
        if (!validKey(key)) { plan.errors.push(`${lab}/${c}/${key}: geçersiz anahtar`); continue; }
        const { data, stripped } = transformRecord(c, key, v, ws);
        plan.strippedSecrets += stripped;
        add({ path: `labs/${lab}/${c}/${key}`, collection: `${lab}/${c}`, data, sourceKey: key });
      }
    }
    if (isObj(tree.settings)) { plan.sourceCounts[`${lab}/settings`] = 1; add({ path: `labs/${lab}/settings/main`, collection: `${lab}/settings`, data: { ...tree.settings, id: 'main' }, sourceKey: 'settings' }); }
    else plan.sourceCounts[`${lab}/settings`] = 0;
    if (tree.mailFilters != null) {
      const items = entriesOf(tree.mailFilters).map(([, v]) => v);
      plan.sourceCounts[`${lab}/mailFilters`] = 1;
      add({ path: `labs/${lab}/mailFilters/main`, collection: `${lab}/mailFilters`, data: { id: 'main', items }, sourceKey: 'mailFilters' });
    } else plan.sourceCounts[`${lab}/mailFilters`] = 0;
    let msgCount = 0, threadCount = 0;
    for (const [tid, t] of entriesOf(tree.chats)) {
      if (!validKey(tid) || !isObj(t)) { plan.errors.push(`${lab}/chats/${tid}: geçersiz konuşma`); continue; }
      threadCount++;
      add({ path: `labs/${lab}/threads/${tid}`, collection: `${lab}/threads`, data: { id: tid, _legacy: { workspace: ws, key: tid } }, sourceKey: tid });
      for (const [mid, m] of entriesOf(t.messages)) {
        if (!isObj(m) || !validKey(mid)) { plan.errors.push(`${lab}/chats/${tid}/messages/${mid}: geçersiz mesaj`); continue; }
        msgCount++;
        add({ path: `labs/${lab}/threads/${tid}/messages/${mid}`, collection: `${lab}/threads/messages`, data: { ...m, id: m.id ?? mid, _legacy: { workspace: ws, key: mid } }, sourceKey: `${tid}/${mid}` });
      }
    }
    plan.sourceCounts[`${lab}/threads`] = threadCount; plan.sourceCounts[`${lab}/threads/messages`] = msgCount;
    if (tree.pass != null) plan.skipped.push({ what: `${lab}/pass`, reason: 'Düz metin yönetici şifresi/PIN taşınmaz' });
    const known = new Set<string>([...RECORD_COLLECTIONS, 'settings', 'mailFilters', 'chats', 'pass']);
    for (const k of Object.keys(tree)) if (!known.has(k)) plan.warnings.push(`${lab}/${k}: tanınmayan üst düzey anahtar, TAŞINMADI (elle inceleyin)`);
  }
  if (isObj(root) && isObj(root.meta)) plan.skipped.push({ what: 'meta/*', reason: 'Eski şifre/göç bayrakları taşınmaz' });
  return plan;
}
export { canonical };
