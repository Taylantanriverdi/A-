/**
 * Yönetim paneli SAF mantığı (Firebase/DOM yok; birim testli).
 * Para: kuruş (tamsayı) hesaplanır, yalnızca saklarken/gösterirken TL'ye çevrilir (float hatası yok).
 * Tarih: laboratuvar saat dilimi (Europe/Istanbul) esas alınır; UTC'ye göre ay/gün kayması olmaz.
 */
import { JOB_STATUSES } from '../lib/format';

 
export type R = { [k: string]: any };
export const LAB_TZ = 'Europe/Istanbul';
export type Cur = 'TRY' | 'USD' | 'EUR';
export const CURRENCIES: readonly Cur[] = ['TRY', 'USD', 'EUR'];
export type Sums = Record<Cur, number>;
export const zeroSums = (): Sums => ({ TRY: 0, USD: 0, EUR: 0 });
export const curOf = (x: R | undefined | null): Cur => (x && (CURRENCIES as readonly string[]).includes(String(x.currency)) ? (x.currency as Cur) : 'TRY');

/* ---------- Para ---------- */
export function toCents(n: unknown): number {
  const v = typeof n === 'string' ? Number(n.replace(',', '.')) : Number(n);
  if (!Number.isFinite(v)) return 0;
  const c = Math.round(Number((Math.abs(v) * 100).toPrecision(15)));
  return v < 0 ? -c : c;
}
export const fromCents = (c: number): number => Math.round(c) / 100;
/** Eski sistemle aynı: qty yok/boş ise 1; sayı değilse 0. */
export function qtyOf(j: R | undefined | null): number {
  const q = j?.qty;
  return q === undefined || q === null || q === '' ? 1 : Number(q) || 0;
}
export function lineCents(price: unknown, qty: unknown): number {
  const q = Number(qty);
  if (!Number.isFinite(q)) return 0;
  const x = Number((toCents(price) * Math.abs(q)).toPrecision(14));
  const c = Math.round(x);
  return q < 0 ? -c : c;
}
export const jobCents = (j: R): number => lineCents(j.price, qtyOf(j));
export const payCents = (p: R): number => toCents(p.amount);
export function addTo(s: Sums, cur: Cur, cents: number): void { s[cur] += cents; }
export const sumsEmpty = (s: Sums): boolean => CURRENCIES.every((c) => s[c] === 0);
export function sumsToMajor(s: Sums): Sums { return { TRY: fromCents(s.TRY), USD: fromCents(s.USD), EUR: fromCents(s.EUR) }; }

/* ---------- Kimlikler ---------- */
export const doctorIdOf = (r: R): string => String(r.doctorId || r.drId || '');
export function techIdsOf(j: R): string[] {
  if (Array.isArray(j.techIds) && j.techIds.length) return j.techIds.map(String);
  return j.techId != null && j.techId !== '' ? [String(j.techId)] : [];
}
/** Eski alan adlarını (drId/techId) koruyarak v2 erişim alanlarını (doctorId/techIds) tamamlar. */
export function withIds<T extends Record<string, unknown>>(j: T): T & { doctorId: string; techIds: string[] } {
  return { ...j, doctorId: doctorIdOf(j as R), techIds: techIdsOf(j as R) };
}

/* ---------- Tarih (lab saat dilimi) ---------- */
/** 'YYYY-MM-DD' ise aynen; zaman damgası ise Istanbul yerel tarihi. Geçersizse ''. */
export function isoToLocalDate(v: unknown, tz: string = LAB_TZ): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!s || isNaN(+d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const todayLocal = (now: Date = new Date()): string => isoToLocalDate(now.toISOString());
export const monthLocal = (v: unknown): string => isoToLocalDate(v).slice(0, 7);
/** Gelir tarihi: tamamlanma anı (yerel gün) → teslim tarihi → kayıt kimliğindeki zaman. */
export function incomeDate(j: R): string {
  if (j.completedAt) { const d = isoToLocalDate(j.completedAt); if (d) return d; }
  if (j.dateout) { const d = isoToLocalDate(j.dateout); if (d) return d; }
  const n = Number(j.id);
  if (Number.isFinite(n) && n > 1e11 && n < 4e12) return isoToLocalDate(new Date(n).toISOString());
  return '';
}
export const isOverdue = (j: R, today: string): boolean => !!j.dateout && isoToLocalDate(j.dateout) < today && j.status !== 'Tamamlandı';

/* ---------- Bakiye / hesap kesimi ---------- */
export interface Totals { charged: Sums; paid: Sums; balance: Sums; jobCount: number; payCount: number }
export function doctorTotals(jobs: R[], pays: R[], doctorId: string, includeClosed = false): Totals {
  const charged = zeroSums(); const paid = zeroSums(); let jobCount = 0; let payCount = 0;
  for (const j of jobs) {
    if (j.deleted || j.status !== 'Tamamlandı' || doctorIdOf(j) !== doctorId || (!includeClosed && j.closureId)) continue;
    addTo(charged, curOf(j), jobCents(j)); jobCount++;
  }
  for (const p of pays) {
    if (p.deleted || doctorIdOf(p) !== doctorId || (!includeClosed && p.closureId)) continue;
    addTo(paid, curOf(p), payCents(p)); payCount++;
  }
  return { charged, paid, balance: { TRY: charged.TRY - paid.TRY, USD: charged.USD - paid.USD, EUR: charged.EUR - paid.EUR }, jobCount, payCount };
}

export interface ClosureInput { doctor: R; jobs: R[]; pays: R[]; carry: boolean; closeDate: string; closureId: string; now: string; override?: Partial<Sums> }
export interface ClosurePlan { closure: R; jobIds: string[]; payIds: string[]; carryJobs: R[] }
/** Dönem kapatma planı: açık (closureId'siz) tamamlanmış işler + tahsilatlar kapatılır; istenirse bakiye yeni döneme devredilir. */
export function planClosure(i: ClosureInput): ClosurePlan {
  const did = String(i.doctor.id);
  const jobs = i.jobs.filter((j) => !j.deleted && j.status === 'Tamamlandı' && doctorIdOf(j) === did && !j.closureId);
  const pays = i.pays.filter((p) => !p.deleted && doctorIdOf(p) === did && !p.closureId);
  if (!jobs.length && !pays.length) throw new Error('Kapatılacak açık kayıt yok.');
  const t = doctorTotals(jobs, pays, did, true);
  const balance = zeroSums(); let edited = false;
  for (const c of CURRENCIES) {
    const ov = i.override?.[c];
    if (ov !== undefined && (t.charged[c] !== 0 || t.paid[c] !== 0)) { balance[c] = ov; if (ov !== t.balance[c]) edited = true; } else balance[c] = t.balance[c];
  }
  const closedAt = `${i.closeDate}T12:00:00.000Z`;
  const closure = { id: i.closureId, doctorId: did, drId: did, drName: String(i.doctor.name ?? ''), closedAt, jobIds: jobs.map((j) => String(j.id)), paymentIds: pays.map((p) => String(p.id)),
    jobTotal: sumsToMajor(t.charged), paymentTotal: sumsToMajor(t.paid), balance: sumsToMajor(balance), balanceAutoCalculated: sumsToMajor(t.balance), balanceManuallyEdited: edited, carriedForward: i.carry };
  const carryJobs: R[] = [];
  if (i.carry) for (const c of CURRENCIES) if (balance[c] !== 0) carryJobs.push(withIds({ id: `${i.closureId}-${c}`, drId: did, doctorId: did, drName: closure.drName, patient: 'Devreden Bakiye', type: `${i.closeDate} öncesi dönemden devir`, price: fromCents(balance[c]), qty: 1, currency: c, status: 'Tamamlandı', deleted: false, dateout: i.closeDate, completedAt: closedAt, approvedAt: i.now, isCarryForward: true, carriedFromClosureId: i.closureId, techIds: [] }));
  return { closure, jobIds: closure.jobIds, payIds: closure.paymentIds, carryJobs };
}

/* ---------- Aylık rapor ---------- */
export interface MonthRow { month: number; labIncome: number; salesIncome: number; income: number; fixedExp: number; serviceExp: number; totalExp: number; net: number; collected: number; jobCount: number }
export function monthlyData(year: string, cur: Cur, jobs: R[], sales: R[], expenses: R[], payments: R[] = []): MonthRow[] {
  const rows: MonthRow[] = Array.from({ length: 12 }, (_, month) => ({ month, labIncome: 0, salesIncome: 0, income: 0, fixedExp: 0, serviceExp: 0, totalExp: 0, net: 0, collected: 0, jobCount: 0 }));
  const idx = (d: string): number => (d.slice(0, 4) === year ? Number(d.slice(5, 7)) - 1 : -1);
  for (const j of jobs) {
    if (j.deleted || j.status !== 'Tamamlandı' || j.isCarryForward || curOf(j) !== cur) continue;
    const m = idx(incomeDate(j)); if (m >= 0 && m < 12) { rows[m].labIncome += jobCents(j); rows[m].jobCount++; }
  }
  for (const s of sales) {
    if (s.deleted || s.status === 'İptal' || curOf(s) !== cur) continue;
    const m = idx(isoToLocalDate(s.date)); if (m >= 0 && m < 12) rows[m].salesIncome += toCents(s.total);
  }
  for (const e of expenses) {
    if (e.deleted || curOf(e) !== cur) continue;
    const m = idx(isoToLocalDate(e.date)); if (m < 0 || m > 11) continue;
    const a = toCents(e.amount); if (e.category === 'Sabit') rows[m].fixedExp += a; else rows[m].serviceExp += a; rows[m].totalExp += a;
  }
  for (const p of payments) {
    if (p.deleted || curOf(p) !== cur) continue;
    const m = idx(isoToLocalDate(p.date)); if (m >= 0 && m < 12) rows[m].collected += payCents(p);
  }
  for (const r of rows) { r.income = r.labIncome + r.salesIncome; r.net = r.income - r.totalExp; }
  return rows;
}
export function yearsOf(jobs: R[], pays: R[], expenses: R[], sales: R[], nowYear: string): string[] {
  const y = new Set<string>([nowYear]);
  for (const j of jobs) if (!j.deleted && j.status === 'Tamamlandı') { const d = incomeDate(j); if (d) y.add(d.slice(0, 4)); }
  for (const r of [...pays, ...expenses, ...sales]) { const d = isoToLocalDate(r.date); if (d) y.add(d.slice(0, 4)); }
  return [...y].sort((a, b) => b.localeCompare(a));
}

/* ---------- Durum akışı ---------- */
export type JobStatus = (typeof JOB_STATUSES)[number];
export const isStatus = (s: unknown): s is JobStatus => (JOB_STATUSES as readonly string[]).includes(String(s));
/** Admin durum değişikliği yaması. Değişiklik yoksa null; kural ihlalinde Error. */
export function statusPatch(job: R, next: string, now: string): R | null {
  if (!isStatus(next)) throw new Error('Geçersiz durum.');
  if (job.status === next) return null;
  if (job.status === 'Tamamlandı' && job.closureId) throw new Error('Hesabı kapatılmış dönemdeki iş yeniden açılamaz (önce dönem kapatmayı geri alın).');
  if (next === 'Tamamlandı') return { status: next, completedAt: job.completedAt || now, completionApprovedBy: 'admin', completionApprovedAt: now };
  if (job.status === 'Tamamlandı') return { status: next, completedAt: null, completionApprovedBy: null, completionApprovedAt: null };
  return { status: next };
}
export function approveCompletionPatch(job: R, now: string): R {
  if (job.deleted) throw new Error('İş silinmiş.');
  if (job.status !== 'Tamamlama Onayı') throw new Error('İş artık "Tamamlama Onayı" durumunda değil (başka biri işlemiş olabilir).');
  return { status: 'Tamamlandı', completedAt: now, completionApprovedBy: 'admin', completionApprovedAt: now, completionRejectReason: null };
}
export function rejectCompletionPatch(job: R, reason: string, now: string): R {
  if (job.deleted) throw new Error('İş silinmiş.');
  if (job.status !== 'Tamamlama Onayı') throw new Error('İş artık "Tamamlama Onayı" durumunda değil (başka biri işlemiş olabilir).');
  return { status: 'Makyajda', completionRejectedAt: now, completionRejectReason: reason.trim().slice(0, 500) || 'Yönetici reddetti' };
}

/* ---------- Teknisyen ataması ---------- */
export const activeLoad = (jobs: R[], techId: string): number => jobs.filter((j) => !j.deleted && j.status !== 'Tamamlandı' && techIdsOf(j).includes(techId)).length;
/** En az aktif iş yüklü teknisyen (eşitlikte listedeki ilk). Teknisyen yoksa null. */
export function suggestTech(techs: R[], jobs: R[]): R | null {
  const live = techs.filter((t) => !t.deleted);
  if (!live.length) return null;
  return live.map((t) => ({ t, l: activeLoad(jobs, String(t.id)) })).sort((a, b) => a.l - b.l)[0].t;
}
export function assignPatch(tech: R, note: string): R {
  return { techId: tech.id, techName: String(tech.name ?? ''), techIds: [String(tech.id)], dispatchNote: note.trim().slice(0, 1000) };
}
export const unassignPatch = (): R => ({ techId: null, techName: null, techIds: [], dispatchNote: '' });
/** Hekimin otomatik teknisyeni: kayıt var ve silinmemişse. */
export function autoTechOf(doctor: R, techs: R[]): R | null {
  if (!doctor.autoTechId) return null;
  return techs.find((t) => !t.deleted && String(t.id) === String(doctor.autoTechId)) ?? null;
}

/* ---------- Dişler (FDI) ---------- */
export const FDI = { ur: [18, 17, 16, 15, 14, 13, 12, 11], ul: [21, 22, 23, 24, 25, 26, 27, 28], br: [48, 47, 46, 45, 44, 43, 42, 41], bl: [31, 32, 33, 34, 35, 36, 37, 38] } as const;
const VALID_TEETH = new Set<number>([...FDI.ur, ...FDI.ul, ...FDI.br, ...FDI.bl, 51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]);
export function parseTeeth(v: unknown): { teeth: number[]; rest: string[] } {
  const toks = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;\s]+/);
  const set = new Set<number>(); const rest: string[] = [];
  for (const raw of toks) { const t = raw.trim(); if (!t) continue; const n = Number(t); if (/^\d{2}$/.test(t) && VALID_TEETH.has(n)) set.add(n); else rest.push(t); }
  return { teeth: [...set].sort((a, b) => a - b), rest };
}
export const formatTeeth = (t: unknown): string => parseTeeth(t).teeth.join(', ');

/* ---------- Sipariş ---------- */
export interface OrderLine { type: string; qty: number; price: number; currency: Cur }
export interface OrderInput { doctor: R; tech: R | null; patient: string; lines: OrderLine[]; teeth: number[]; material: string; color: string; dateout: string; notes: string; files: unknown[]; sourceSubId: string | null; now: string; newId: () => string }
export interface Op { name: string; id: string; data: R }
/** Sipariş formundan kayıtlar: otomatik teknisyen varsa onaysız iş (jobs), yoksa Onay Bekleyen (pendingJobs); her durumda orderForms arşivi. */
export function buildOrder(i: OrderInput): { ops: Op[]; records: R[]; auto: boolean } {
  const group = i.lines.length > 1 ? i.newId() : null; const ops: Op[] = []; const records: R[] = []; const dr = i.doctor;
  i.lines.forEach((l, idx) => {
    const id = i.newId(); const type = l.type.trim() || i.material || 'Belirsiz';
    const note = [i.teeth.length ? `DİŞLER: ${i.teeth.join(', ')}` : '', i.material && i.material !== type ? `MATERYAL: ${i.material}` : '', group ? `KALEM: ${idx + 1}/${i.lines.length}` : '', i.notes].filter(Boolean).join('\n');
    const base: R = { id, drId: dr.id, drName: dr.name, patient: i.patient, type, price: fromCents(toCents(l.price)), currency: l.currency, qty: l.qty, dateout: i.dateout, toothColor: i.color, note, files: i.files, sourceDoctorSubmissionId: i.sourceSubId,
      orderGroupId: group, orderGroupIndex: group ? idx : null, orderGroupTotal: group ? i.lines.length : null, orderForm: { teeth: i.teeth, material: i.material, jobType: type, doctorName: String(dr.name ?? ''), color: i.color, notes: i.notes } };
    const rec = i.tech ? withIds({ ...base, techId: i.tech.id, techName: i.tech.name, status: 'Bekliyor', deleted: false, approvedAt: i.now, autoAssigned: true }) : withIds({ ...base, techId: null, techName: '', status: 'Onay Bekliyor', submittedAt: i.now, source: 'siparis-formu' });
    records.push(rec);
    ops.push({ name: i.tech ? 'jobs' : 'pendingJobs', id, data: rec });
    ops.push({ name: 'orderForms', id, data: { id, createdAt: i.now, drId: dr.id, doctorId: String(dr.id), drName: dr.name, patient: i.patient, jobType: type, material: i.material, color: i.color, qty: l.qty, dateout: i.dateout, notes: i.notes, teeth: i.teeth, price: base.price, currency: l.currency, pendingJobId: i.tech ? null : id, printed: false, printedAt: null, orderGroupId: group, orderGroupIndex: base.orderGroupIndex, orderGroupTotal: base.orderGroupTotal } });
  });
  return { ops, records, auto: !!i.tech };
}
export function validateOrderLines(lines: OrderLine[]): string | null {
  if (!lines.length) return 'En az bir kalem girin.';
  for (const l of lines) {
    if (!Number.isFinite(l.qty) || l.qty < 1 || !Number.isInteger(l.qty)) return 'Adet 1 veya daha büyük bir tam sayı olmalı.';
    if (!Number.isFinite(l.price) || l.price < 0) return 'Fiyat negatif olamaz.';
  }
  return null;
}

/** Onay Bekleyen → iş: kaydın izinli alanları kopyalanır; hekim zorunlu; hekim tasarımlıysa Üretimde başlar. */
export function pendingToJob(p: R, doctor: R | undefined, now: string): R {
  if (!doctor) throw new Error('Hekim eşleşmedi: önce "Düzenle" ile hekim seçin.');
  return withIds({ id: p.id, drId: doctor.id, doctorId: String(doctor.id), drName: doctor.name, patient: p.patient, type: p.type, price: p.price, currency: p.currency ?? 'TRY', qty: p.qty, dateout: p.dateout, techId: p.techId ?? null, techName: p.techName || null,
    toothColor: p.toothColor, status: p.designSource === 'doctor' ? 'Üretimde' : 'Bekliyor', deleted: false, approvedFrom: 'pendingJobs', approvedAt: now, note: p.note ?? '', files: p.files ?? [], designFiles: p.designFiles ?? [], designFilesUpdatedAt: p.designFilesUpdatedAt ?? null,
    designSource: p.designSource ?? 'lab', orderForm: p.orderForm ?? null, orderGroupId: p.orderGroupId ?? null, orderGroupIndex: p.orderGroupIndex ?? null, orderGroupTotal: p.orderGroupTotal ?? null, sourceDoctorSubmissionId: p.sourceDoctorSubmissionId ?? null,
    sourceType: p.submittedBy === 'tech' ? 'tech_order_form' : 'manual' });
}
/** Teknisyenin serbest metin hekim adından hekim bul (büyük/küçük harf ve Türkçe duyarsız). */
export function matchDoctor(p: R, doctors: R[]): R | undefined {
  const byId = doctorIdOf(p); if (byId) { const d = doctors.find((x) => String(x.id) === byId && !x.deleted); if (d) return d; }
  const n = String(p.drName ?? '').trim().toLocaleLowerCase('tr-TR'); if (!n) return undefined;
  const hits = doctors.filter((d) => !d.deleted && String(d.name ?? '').trim().toLocaleLowerCase('tr-TR') === n);
  return hits.length === 1 ? hits[0] : undefined;
}

/* ---------- Satışlar (eski `sales` şeması: servis/sarf formu) ---------- */
export interface SaleItem { name: string; qty: number; unit: string; price: number }
export const SALE_TYPES = ['Sarf', 'Servis', 'Karma'] as const;
export const SALE_STATUSES = ['Beklemede', 'Gönderildi', 'Tamamlandı', 'İptal'] as const;
export const SALE_UNITS = ['Adet', 'Kutu', 'Paket', 'Kg', 'Litre', 'Saat', 'Set'] as const;
export function saleTotals(items: SaleItem[], vatRate: number): { subtotal: number; vatAmt: number; total: number } {
  const sub = items.reduce((a, it) => a + lineCents(it.price, it.qty), 0);
  const rate = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
  const vat = Math.round(Number((sub * rate / 100).toPrecision(14)));
  return { subtotal: fromCents(sub), vatAmt: fromCents(vat), total: fromCents(sub + vat) };
}
export function formNo(now: Date = new Date(), rnd: number = Math.floor(Math.random() * 900) + 100): string {
  return `PT-${todayLocal(now).replace(/-/g, '')}-${rnd}`;
}

/* ---------- Mail ---------- */
export function b64urlToText(data: string): string {
  const b = atob(data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
  const bytes = Uint8Array.from(b, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
export interface MailPart { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; parts?: MailPart[] }
export function mailContent(payload: MailPart | undefined): { text: string; attachments: { filename: string; mimeType: string; attachmentId: string }[] } {
  let plain = ''; let html = ''; const attachments: { filename: string; mimeType: string; attachmentId: string }[] = [];
  const walk = (p?: MailPart): void => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) attachments.push({ filename: p.filename, mimeType: p.mimeType ?? 'application/octet-stream', attachmentId: p.body.attachmentId });
    else if (p.mimeType === 'text/plain' && p.body?.data && !plain) { try { plain = b64urlToText(p.body.data); } catch { /* bozuk parça atlanır */ } }
    else if (p.mimeType === 'text/html' && p.body?.data && !html) { try { html = b64urlToText(p.body.data); } catch { /* atla */ } }
    (p.parts ?? []).forEach(walk);
  };
  walk(payload);
  const text = plain || html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return { text, attachments };
}
/** Güvenilir gönderen filtresi: e-posta veya @alanadi.com. Geçersizse null. Gmail arama sözdizimi enjeksiyonunu önler. */
export function sanitizeFilter(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (s.length > 120) return null;
  if (/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return s;
  if (/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return s;
  return null;
}
export const gmailQuery = (items: string[]): string => (items.length ? items.map((x) => `from:${x.replace(/^@/, '')}`).join(' OR ') : 'in:inbox');

/* ---------- ZIP ---------- */
export const safeName = (s: unknown, max = 80): string => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/^\.+/, '_').replace(/\s+/g, ' ').trim().slice(0, max) || 'dosya';
/** Aynı adlı dosyaları ZIP içinde ezmemek için benzersizleştirir: a.stl, a (2).stl */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase(); const c = (seen.get(k) ?? 0) + 1; seen.set(k, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.'); return dot > 0 ? `${n.slice(0, dot)} (${c})${n.slice(dot)}` : `${n} (${c})`;
  });
}
export function jobInfoText(j: R, kind: 'scan' | 'design' = 'scan'): string {
  const teeth = formatTeeth(j.orderForm?.teeth);
  const files = (Array.isArray(kind === 'design' ? j.designFiles : j.files) ? (kind === 'design' ? j.designFiles : j.files) : []) as R[];
  return ['DIGICAD DENTAL LABORATUVAR — İŞ BİLGİSİ', '='.repeat(48), `Hekim         : ${j.drName ?? '—'}`, `Hasta         : ${j.patient ?? '—'}`, `İş Türü       : ${j.type ?? '—'}`, `Dişler        : ${teeth || '—'}`, `Diş Rengi     : ${j.toothColor ?? '—'}`,
    `Teslim Tarihi : ${j.dateout ? isoToLocalDate(j.dateout) : '—'}`, `Durum         : ${j.status ?? '—'}`, '', 'Notlar:', String(j.note || '—'), '', kind === 'design' ? 'Tasarım dosyaları:' : 'Tarama dosyaları:', ...(files.length ? files.map((f, k) => `  ${k + 1}. ${f.name}`) : ['  —'])].join('\r\n');
}

/* ---------- İş düzenleme ---------- */
export interface JobEditForm { doctor: R; patient: string; type: string; qty: number; price: number; currency: Cur; dateout: string; color: string; note: string; tech: R | null; status: string }
/** Admin iş düzenleme yaması. Hesabı kapatılmış işte hekim/tutar/adet/para birimi değiştirilemez (kapanış bakiyesi bozulmasın). */
export function jobEditPatch(job: R, f: JobEditForm, now: string): R {
  if (!f.patient.trim()) throw new Error('Hasta adı girin.');
  if (!Number.isFinite(f.qty) || f.qty < 0) throw new Error('Adet geçersiz.');
  if (!Number.isFinite(f.price) || f.price < 0) throw new Error('Fiyat negatif olamaz.');
  const price = fromCents(toCents(f.price));
  if (job.status === 'Tamamlandı' && job.closureId) {
    const same = doctorIdOf(job) === String(f.doctor.id) && toCents(job.price) === toCents(price) && qtyOf(job) === f.qty && curOf(job) === f.currency;
    if (!same) throw new Error('Hesabı kapatılmış dönemdeki işin hekim/tutar/adet bilgisi değiştirilemez (önce dönem kapatmayı geri alın).');
  }
  const patch: R = { drId: f.doctor.id, doctorId: String(f.doctor.id), drName: f.doctor.name, patient: f.patient.trim().slice(0, 300), type: f.type.trim().slice(0, 200), qty: f.qty, price, currency: f.currency, dateout: f.dateout, toothColor: f.color.trim().slice(0, 40), note: f.note.trim().slice(0, 5000) };
  const curTech = techIdsOf(job)[0] ?? '';
  if (f.tech && String(f.tech.id) !== curTech) Object.assign(patch, assignPatch(f.tech, String(job.dispatchNote ?? '')));
  else if (!f.tech && curTech) Object.assign(patch, unassignPatch());
  const sp = statusPatch(job, f.status, now); if (sp) Object.assign(patch, sp);
  return patch;
}

/** Tüm hekimler için açık dönem toplamı (tamamlanan − tahsilat), para birimi başına. */
export function openDebt(jobs: R[], pays: R[]): Sums {
  const s = zeroSums();
  for (const j of jobs) if (!j.deleted && j.status === 'Tamamlandı' && !j.closureId) addTo(s, curOf(j), jobCents(j));
  for (const p of pays) if (!p.deleted && !p.closureId) addTo(s, curOf(p), -payCents(p));
  return s;
}
export function sumExpenses(expenses: R[], pred: (e: R) => boolean): Sums {
  const s = zeroSums(); for (const e of expenses) if (!e.deleted && pred(e)) addTo(s, curOf(e), toCents(e.amount)); return s;
}
