import { randomBytes } from 'node:crypto';
import { sha256, hashRecord } from './canonical';
import { buildPlan, type Plan, type PlanOptions } from './transform';
import { lostFields } from './verify';
import { assertSafeTarget } from './guard';
import { collectFileRefs, type FileRef } from './storage';
import type { AuthSink, DocSink, Account, Doc } from './sinks';

export interface CollectionReport { sourceCount: number; planned: number; written: number; unchanged: number; overwritten: number; verifiedOk: number; missing: string[]; mismatched: string[]; lost: string[]; conflicts: string[]; writeErrors: string[] }
export interface Report {
  startedAt: string; mode: 'dry-run' | 'execute'; sourceSha256: string; project: string | null;
  validationErrors: string[]; warnings: string[]; skipped: Plan['skipped']; unmigrated: Plan['unmigrated']; strippedSecretFields: number;
  leafAccounting: Plan['leaf']; legacyRoot: Plan['legacyRoot'];
  collections: Record<string, CollectionReport>;
  accounts: { planned: number; created: number; skippedNoEmail: string[]; invalidEmail: string[]; duplicateEmails: string[]; skippedExisting: string[]; failed: string[] };
  totals: { planned: number; written: number; unchanged: number; overwritten: number; verifiedOk: number; missing: number; mismatched: number; lost: number; conflicts: number; writeErrors: number };
  extraInTarget: Record<string, number>;
  files: { referenced: number };
  fatalError: string | null;
  ok: boolean;
}
export interface RunOptions {
  sourceText: string; execute: boolean; project?: string; docs?: DocSink; auth?: AuthSink;
  /** Hesap oluşturulur oluşturulmaz çağrılır (geçici şifre diske hemen yazılsın; sonraki hata şifreyi kaybettirmesin). */
  onAccountRow?: (row: string[]) => void;
  /** Ezilecek (farklı) mevcut belgenin önceki hali; yerel yedeğe yazılır. */
  onOverwrite?: (path: string, before: Doc) => void;
  plan?: PlanOptions; overwriteNewSystemDocs?: boolean; allowEmulator?: boolean;
  concurrency?: number; retries?: number; retryDelayMs?: number; env?: Record<string, string | undefined>;
}

const tempPassword = () => randomBytes(18).toString('base64url') + '#9a';
const EMAIL_RE = /^[^\s@,;"<>()]+@[^\s@,;"<>()]+\.[^\s@,;"<>()]{2,}$/;
const emptyCol = (): CollectionReport => ({ sourceCount: 0, planned: 0, written: 0, unchanged: 0, overwritten: 0, verifiedOk: 0, missing: [], mismatched: [], lost: [], conflicts: [], writeErrors: [] });

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}
async function retry<T>(fn: () => Promise<T>, tries: number, delay: number): Promise<T> {
  for (let a = 0; ; a++) { try { return await fn(); } catch (e) { if (a >= tries) throw e; await new Promise((r) => setTimeout(r, delay * 2 ** a)); } }
}

export async function run(o: RunOptions): Promise<{ report: Report; plan: Plan; fileRefs: FileRef[] }> {
  if (o.execute) assertSafeTarget(o.project, o.env ?? process.env, { allowEmulator: o.allowEmulator });
  let json: unknown;
  try { json = JSON.parse(o.sourceText.replace(/^﻿/, '')); } catch (e) { throw new Error('Kaynak JSON ayrıştırılamadı: ' + (e as Error).message); }
  const plan = buildPlan(json, o.plan);
  const fileRefs = collectFileRefs(json);
  const rep: Report = {
    startedAt: new Date().toISOString(), mode: o.execute ? 'execute' : 'dry-run', sourceSha256: sha256(o.sourceText), project: o.project ?? null,
    validationErrors: [...plan.errors], warnings: [...plan.warnings], skipped: plan.skipped, unmigrated: plan.unmigrated, strippedSecretFields: plan.strippedSecrets,
    leafAccounting: plan.leaf, legacyRoot: plan.legacyRoot, collections: {},
    accounts: { planned: 0, created: 0, skippedNoEmail: [], invalidEmail: [], duplicateEmails: [], skippedExisting: [], failed: [] },
    totals: { planned: 0, written: 0, unchanged: 0, overwritten: 0, verifiedOk: 0, missing: 0, mismatched: 0, lost: 0, conflicts: 0, writeErrors: 0 },
    extraInTarget: {}, files: { referenced: new Set(fileRefs.map((f) => f.bucket + '/' + f.object)).size }, fatalError: null, ok: false,
  };
  const col = (k: string) => (rep.collections[k] ??= emptyCol());
  for (const [k, n] of Object.entries(plan.sourceCounts)) col(k).sourceCount = n;
  for (const d of plan.docs) col(d.collection).planned++;

  // Bağımsız kapsama denetimi: planlanan veri ham kaynakla karşılaştırılır (dry-run'da da çalışır)
  for (const d of plan.docs) { const l = lostFields(json, d, d.data); if (l.length) col(d.collection).lost.push(`${d.path}: ${l.join('; ')}`); }

  // Hesap planı (hekim/teknisyen)
  const accounts: Account[] = []; const byEmail = new Map<string, string[]>();
  for (const d of plan.docs) {
    const m = /^(.+)\/(doctors|technicians)$/.exec(d.collection); if (!m || d.data.deleted === true) continue;
    const raw = typeof d.data.email === 'string' ? d.data.email.trim().toLowerCase() : '';
    const label = `${d.path} (${String(d.data.name ?? '')})`;
    if (!raw) { rep.accounts.skippedNoEmail.push(label); continue; }
    if (!EMAIL_RE.test(raw)) { rep.accounts.invalidEmail.push(`${label}: "${raw}"`); continue; }
    (byEmail.get(raw) ?? byEmail.set(raw, []).get(raw)!).push(label);
    accounts.push({ email: raw, role: m[2] === 'doctors' ? 'doctor' : 'tech', refId: d.sourceKey, lab: m[1], name: String(d.data.name ?? '') });
  }
  const dupEmails = new Set([...byEmail.entries()].filter(([, v]) => v.length > 1).map(([k]) => k));
  for (const e of dupEmails) rep.accounts.duplicateEmails.push(`${e}: ${byEmail.get(e)!.join(' | ')}`);
  if (dupEmails.size) rep.warnings.push(`${dupEmails.size} e-posta birden çok kayıtta ortak; bu e-postalar için hesap AÇILMADI (biri diğerinin erişimini ezerdi). Yönetim panelinden elle açın.`);
  const acctPlan = accounts.filter((a) => !dupEmails.has(a.email));
  rep.accounts.planned = acctPlan.length;

  const fatal = plan.errors.length > 0;
  const retries = o.retries ?? 4, delay = o.retryDelayMs ?? 500, conc = o.concurrency ?? 8;
  if (o.execute && !fatal) {
    if (!o.docs) throw new Error('execute modu için hedef gerekli.');
    const docs = o.docs; const skipPaths = new Set<string>();
    try {
      // 1) Yaz (kaldığı yerden devam: hash'i aynı olanlar atlanır; hata kayıt başına yakalanır, diğerleri sürer)
      await pool(plan.docs, conc, async (d) => {
        const c = col(d.collection);
        try {
          const ex = await retry(() => docs.get(d.path), retries, delay);
          if (ex && hashRecord(ex) === d.hash) { c.unchanged++; return; }
          if (ex) {
            if (ex._legacy === undefined && !o.overwriteNewSystemDocs) { c.conflicts.push(d.path); skipPaths.add(d.path); return; } // yeni sistemde oluşmuş belge: ezme
            o.onOverwrite?.(d.path, ex); c.overwritten++;
          }
          await retry(() => docs.set(d.path, d.data), retries, delay); c.written++;
        } catch (e) { c.writeErrors.push(`${d.path}: ${(e as Error).message}`); skipPaths.add(d.path); }
      });
      // 2) Hesaplar
      if (o.auth) {
        for (const a of acctPlan) {
          const pw = tempPassword();
          try {
            const r = await o.auth.ensureUser(a, pw);
            if (r.skipped) rep.accounts.skippedExisting.push(`${a.email}: ${r.skipped}`);
            else if (r.created) { rep.accounts.created++; o.onAccountRow?.([a.email, a.role, a.lab, a.refId, a.name, pw]); }
          } catch (e) { rep.accounts.failed.push(`${a.email}: ${(e as Error).message}`); }
        }
        if (rep.accounts.failed.length) rep.warnings.push(`${rep.accounts.failed.length} hesap oluşturulamadı (veri göçünü etkilemez); Yönetim > Hesap aç ile sonradan oluşturun.`);
      }
      // 3) Doğrulama: her belge Firestore'dan GERİ OKUNUR; hem kanonik karma hem ham kaynakla alan-alan kapsama denetlenir
      await pool(plan.docs.filter((d) => !skipPaths.has(d.path)), conc, async (d) => {
        const c = col(d.collection);
        try {
          const back = await retry(() => docs.get(d.path), retries, delay);
          if (!back) { c.missing.push(d.path); return; }
          const l = lostFields(json, d, back);
          if (hashRecord(back) !== d.hash) c.mismatched.push(d.path);
          else if (l.length) c.lost.push(`${d.path} (geri okunan): ${l.join('; ')}`);
          else c.verifiedOk++;
        } catch (e) { c.writeErrors.push(`${d.path}: geri okuma hatası: ${(e as Error).message}`); }
      });
      // 4) Hedefte plan dışı belge sayısı (bilgi; ezilmez/silinmez)
      if (docs.listIds) {
        const planned = new Set(plan.docs.map((d) => d.path));
        const colls = new Set(plan.docs.filter((d) => !d.collection.includes('/threads/')).map((d) => d.path.split('/').slice(0, -1).join('/')));
        for (const cp of colls) { try { const ids = await docs.listIds(cp); const extra = ids.filter((i) => !planned.has(`${cp}/${i}`)).length; if (extra) rep.extraInTarget[cp] = extra; } catch { /* bilgi amaçlı */ } }
      }
    } catch (e) { rep.fatalError = (e as Error).message; }
  }
  for (const c of Object.values(rep.collections)) {
    const t = rep.totals; t.planned += c.planned; t.written += c.written; t.unchanged += c.unchanged; t.overwritten += c.overwritten; t.verifiedOk += c.verifiedOk;
    t.missing += c.missing.length; t.mismatched += c.mismatched.length; t.lost += c.lost.length; t.conflicts += c.conflicts.length; t.writeErrors += c.writeErrors.length;
  }
  // Kayıt sayısı kontrolü: kaynaktaki her kayıt planlanmış olmalı (kayıp = hata)
  for (const [k, c] of Object.entries(rep.collections)) if (c.planned !== c.sourceCount) rep.validationErrors.push(`${k}: kaynak ${c.sourceCount}, planlanan ${c.planned}`);
  const t = rep.totals;
  rep.ok = !rep.validationErrors.length && !rep.fatalError && !t.missing && !t.mismatched && !t.lost && !t.conflicts && !t.writeErrors && (!o.execute || t.verifiedOk + t.conflicts === t.planned);
  return { report: rep, plan, fileRefs };
}
