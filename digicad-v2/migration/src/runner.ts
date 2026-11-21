import { randomBytes } from 'node:crypto';
import { sha256, hashRecord } from './canonical';
import { buildPlan, type Plan } from './transform';
import type { AuthSink, DocSink, Account } from './sinks';

export interface CollectionReport { sourceCount: number; planned: number; written: number; unchanged: number; verifiedOk: number; missing: string[]; mismatched: string[] }
export interface Report {
  startedAt: string; mode: 'dry-run' | 'execute'; sourceSha256: string; project: string | null;
  validationErrors: string[]; warnings: string[]; skipped: Plan['skipped']; strippedSecretFields: number;
  collections: Record<string, CollectionReport>; accounts: { planned: number; created: number; skippedNoEmail: string[] };
  totals: { planned: number; written: number; unchanged: number; verifiedOk: number; missing: number; mismatched: number };
  ok: boolean;
}
export interface RunOptions { sourceText: string; execute: boolean; project?: string; docs?: DocSink; auth?: AuthSink; accountsCsv?: (rows: string[][]) => void }

const tempPassword = () => randomBytes(12).toString('base64url') + '#9a';
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function run(o: RunOptions): Promise<{ report: Report; plan: Plan }> {
  let json: unknown;
  try { json = JSON.parse(o.sourceText); } catch (e) { throw new Error('Kaynak JSON ayrıştırılamadı: ' + (e as Error).message); }
  const plan = buildPlan(json);
  const rep: Report = {
    startedAt: new Date().toISOString(), mode: o.execute ? 'execute' : 'dry-run', sourceSha256: sha256(o.sourceText), project: o.project ?? null,
    validationErrors: [...plan.errors], warnings: [...plan.warnings], skipped: plan.skipped, strippedSecretFields: plan.strippedSecrets, collections: {},
    accounts: { planned: 0, created: 0, skippedNoEmail: [] }, totals: { planned: 0, written: 0, unchanged: 0, verifiedOk: 0, missing: 0, mismatched: 0 }, ok: false,
  };
  for (const [k, n] of Object.entries(plan.sourceCounts)) rep.collections[k] = { sourceCount: n, planned: 0, written: 0, unchanged: 0, verifiedOk: 0, missing: [], mismatched: [] };
  for (const d of plan.docs) { (rep.collections[d.collection] ??= { sourceCount: 0, planned: 0, written: 0, unchanged: 0, verifiedOk: 0, missing: [], mismatched: [] }).planned++; }

  // Hesap planı (hekim/teknisyen)
  const accounts: Account[] = [];
  for (const d of plan.docs) {
    const m = /^(.+)\/(doctors|technicians)$/.exec(d.collection); if (!m) continue;
    const email = typeof d.data.email === 'string' ? d.data.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) { rep.accounts.skippedNoEmail.push(`${d.path} (${String(d.data.name ?? '')})`); continue; }
    accounts.push({ email, role: m[2] === 'doctors' ? 'doctor' : 'tech', refId: d.sourceKey, lab: m[1], name: String(d.data.name ?? '') });
  }
  rep.accounts.planned = accounts.length;

  const fatal = plan.errors.length > 0;
  if (o.execute && !fatal) {
    if (!o.docs) throw new Error('execute modu için hedef gerekli.');
    for (const d of plan.docs) {
      const c = rep.collections[d.collection];
      const ex = await o.docs.get(d.path);
      if (ex && hashRecord(ex) === d.hash) { c.unchanged++; continue; }
      await o.docs.set(d.path, d.data); c.written++;
    }
    if (o.auth) {
      const rows: string[][] = [['email', 'rol', 'laboratuvar', 'kayit_id', 'ad', 'gecici_sifre']];
      for (const a of accounts) { const pw = tempPassword(); const r = await o.auth.ensureUser(a, pw); if (r.created) { rep.accounts.created++; rows.push([a.email, a.role, a.lab, a.refId, a.name, pw]); } }
      o.accountsCsv?.(rows.map((r) => r.map(csvCell)));
    }
    // Doğrulama: her kaydı geri oku, kanonik SHA-256 karşılaştır
    for (const d of plan.docs) {
      const c = rep.collections[d.collection]; const back = await o.docs.get(d.path);
      if (!back) c.missing.push(d.path); else if (hashRecord(back) !== d.hash) c.mismatched.push(d.path); else c.verifiedOk++;
    }
  }
  for (const c of Object.values(rep.collections)) {
    rep.totals.planned += c.planned; rep.totals.written += c.written; rep.totals.unchanged += c.unchanged; rep.totals.verifiedOk += c.verifiedOk; rep.totals.missing += c.missing.length; rep.totals.mismatched += c.mismatched.length;
  }
  // Kayıt sayısı kontrolü: kaynaktaki her kayıt planlanmış olmalı (kayıp = hata)
  for (const [k, c] of Object.entries(rep.collections)) if (c.planned !== c.sourceCount && !(k.endsWith('threads') || k.endsWith('threads/messages'))) rep.validationErrors.push(`${k}: kaynak ${c.sourceCount}, planlanan ${c.planned}`);
  rep.ok = !rep.validationErrors.length && rep.totals.missing === 0 && rep.totals.mismatched === 0 && (!o.execute || rep.totals.verifiedOk === rep.totals.planned);
  return { report: rep, plan };
}
