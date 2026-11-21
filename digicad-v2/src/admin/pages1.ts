import { h, link, type Child } from '../lib/dom';
import { fmtDate, fmtMoney, JOB_STATUSES, normStatus, statusOptions } from '../lib/format';
import { patch, newId, softDelete, type Rec } from '../lib/store';
import { callFn } from '../lib/firebase';
import { downloadUrl, upload, type FileRef } from '../lib/files';
import { badge, btn, field, input, modal, printNode, select, table, textarea, toast, val } from '../lib/ui';
import { doctorOf, isOpen, live, techOf, unassigned, type State } from './state';
import type { Session } from '../lib/auth';
import { abtn, arr, ask, curOptions, fmtSums, money, searchInput, sure, trLower } from './util';
import {
  approveCompletionPatch, assignPatch, autoTechOf, buildOrder, curOf, formatTeeth, isOverdue, jobCents, jobEditPatch, jobInfoText, matchDoctor, openDebt, parseTeeth,
  pendingToJob, rejectCompletionPatch, statusPatch, sumExpenses, suggestTech, activeLoad, todayLocal, unassignPatch, validateOrderLines, zeroSums, monthLocal, techIdsOf, doctorIdOf, type Cur, type OrderLine, type R,
} from './calc';
import { approvePending, createOrder, jobHistory, mutateJob, transition } from './data';
import { toothChart } from '../lib/teeth';
import { downloadJobsZip } from '../lib/zip';
import { printReport } from './print';

export interface Ctx { s: Session; st: State; rerender: () => void; go: (page: string, prefill?: Rec) => void; prefill?: Rec; own: (off: () => void) => void; onData: (fn: () => void) => void; ps: Record<string, any> }  

const nowIso = (): string => new Date().toISOString();
const openFile = async (path: string): Promise<void> => { const a = h('a', { href: await downloadUrl(path), target: '_blank', rel: 'noopener noreferrer' }); document.body.appendChild(a); a.click(); a.remove(); };

/** İşin dosyalarından hâlâ hekim gönderim klasöründe (submissions/) duranlar var mı? Teknisyen yalnızca jobFiles/{işId}/ altını okuyabilir. */
export const needsFileCopy = (j: Rec): boolean => arr(j.files).some((f: Rec) => typeof f?.path === 'string' && /^labs\/[^/]+\/submissions\//.test(f.path));
/** Sunucu tarafı kopya (functions: copyJobFiles). Başarısızlık siparişi/atamayı engellemez; yönetici uyarılır ve İş Detayı > Tarama'dan yeniden deneyebilir. */
export async function copyFilesForTech(ids: string[]): Promise<boolean> {
  try {
    for (const id of ids) { const r = await callFn<{ failed?: number }>('copyJobFiles', { jobId: id }); if (r?.failed) throw new Error(`${r.failed} dosya kopyalanamadı`); }
    return true;
  } catch (e) { toast(`Hekim dosyaları iş klasörüne kopyalanamadı (teknisyen göremez): ${(e as Error).message}. İş Detayı > Tarama sekmesinden tekrar deneyin.`, 'err'); return false; }
}

export const fileLinks = (files: unknown): Child =>
  arr(files).map((f: Rec) => h('div', null, f.path ? abtn(`📎 ${f.name ?? 'dosya'}`, () => openFile(String(f.path)), 'btn ghost') : f.url ? link(String(f.url), `📎 ${f.name ?? 'dosya'} (eski arşiv)`) : h('span', { class: 'muted' }, `📎 ${f.name ?? 'dosya'}`)));
const stat = (t: string, v: Child, onClick?: () => void, cls = ''): HTMLElement => h('button', { class: `stat ${cls}`, type: 'button', on: { click: () => onClick?.() } }, h('small', null, t), h('b', null, v));
const tabBar = (tabs: [string, string][], cur: string, set: (k: string) => void): HTMLElement => h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: `tab ${k === cur ? 'active' : ''}`, on: { click: () => set(k) } }, l)));

/* ---------------- Genel Bakış ---------------- */
export function dash(c: Ctx): HTMLElement {
  const jobs = live(c.st.jobs); const open = jobs.filter(isOpen); const today = todayLocal(); const late = open.filter((j) => isOverdue(j, today));
  const awaiting = jobs.filter((j) => j.status === 'Tamamlama Onayı'); const thisMonth = today.slice(0, 7);
  const debt = openDebt(jobs, c.st.payments); const expMonth = sumExpenses(c.st.expenses, (e) => monthLocal(e.date) === thisMonth);
  const cnt = (f: (j: Rec) => boolean) => jobs.filter(f).length;
  return h('div', null, h('h2', null, 'Genel Bakış'),
    awaiting.length ? h('div', { class: 'card rowhl' }, h('b', null, `📨 ${awaiting.length} iş tamamlama onayı bekliyor. `), btn('Hemen incele', () => { c.ps.pending = { tab: 'completion' }; c.go('pending'); }, 'btn primary')) : null,
    h('div', { class: 'stats' }, stat('Bekliyor', cnt((j) => normStatus(j.status) === 'Bekliyor'), () => c.go('jobs')), stat('Süreçte', cnt((j) => isOpen(j) && normStatus(j.status) !== 'Bekliyor'), () => c.go('jobs')), stat('Tamamlanan', cnt((j) => j.status === 'Tamamlandı'), () => c.go('done')),
      stat('Onay bekleyen', live(c.st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor').length, () => c.go('pending')), stat('Hekimden gelen (yeni)', live(c.st.doctorSubmissions).filter((x) => x.status === 'Yeni').length, () => c.go('doctorsubs')),
      stat('Atanmamış', open.filter(unassigned).length, () => c.go('dispatch')), stat('Teslimi geçen', late.length, () => c.go('jobs'), late.length ? 'warn' : ''),
      stat('Açık bakiye (alacak)', fmtSums(debt, true), () => c.go('archive')), stat('Bu ay gider', fmtSums(expMonth, true), () => c.go('expenses'))),
    h('h3', null, 'Teslimi geçen işler'), table([{ head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'Hekim', cell: (j: Rec) => j.drName ?? doctorOf(c.st, j.doctorId)?.name }, { head: 'Teslim', cell: (j: Rec) => h('span', { class: 'pend-late' }, fmtDate(j.dateout)) }, { head: 'Durum', cell: (j: Rec) => j.status }], late, 'Geciken iş yok'),
    h('h3', null, 'Son işler'), table([{ head: 'Hekim', cell: (j: Rec) => j.drName }, { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Teknisyen', cell: (j: Rec) => j.techName || '—' }, { head: 'Tutar', cell: (j: Rec) => money(jobCents(j), curOf(j)) }, { head: 'Durum', cell: (j: Rec) => j.status }],
      [...jobs].sort((a, b) => String(b.createdAt ?? b.id).localeCompare(String(a.createdAt ?? a.id))).slice(0, 10), 'İş yok'));
}

/* ---------------- Sipariş Formu ---------------- */
export function orderPrintNode(f: R, lines: { type: string; qty: number; price: number; currency: Cur }[]): HTMLElement {
  return h('div', { class: 'print-doc' }, h('h2', null, 'DigiCAD Dental Laboratuvar — Sipariş Formu'), h('p', null, `Hekim: ${f.drName ?? ''}   |   Hasta: ${f.patient ?? ''}   |   Teslim: ${fmtDate(f.dateout) || '—'}`),
    h('p', null, `Renk: ${f.color ?? '—'}   |   Dişler: ${formatTeeth(f.teeth) || '—'}${f.material ? `   |   Materyal: ${f.material}` : ''}`), table([{ head: 'İş türü', cell: (r: R) => r.type }, { head: 'Adet', cell: (r: R) => r.qty }, { head: 'Birim fiyat', cell: (r: R) => fmtMoney(r.price, r.currency) }], lines),
    h('p', null, `Notlar: ${f.notes || '—'}`), h('p', { class: 'muted' }, `Tarih: ${new Date().toLocaleString('tr-TR')}`));
}

/** Çok kalemli sipariş; hekimde otomatik teknisyen varsa onaysız doğrudan iş, yoksa Onay Bekleyen. Hekim gönderiminden aktarılırsa dosyalar da işe taşınır. */
export function order(c: Ctx): HTMLElement {
  const pre = (c.prefill ?? {}) as Rec; const root = h('div', { class: 'card' }); const linesBox = h('div'); const priceHint = h('datalist', { id: 'of-types' });
  const lines: OrderLine[] = [{ type: String(pre.jobType ?? ''), qty: 1, price: 0, currency: 'TRY' }]; let qtyTouched = false;
  const drSel = select('doctorId', [['', '— Hekim seçin —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])], String(pre.drId ?? pre.doctorId ?? ''));
  const chart = toothChart(pre.teeth ?? [], (t) => { if (!qtyTouched && t.length) { lines[0].qty = t.length; drawLines(); } });
  const restTeeth = parseTeeth(pre.teeth ?? []).rest;
  const prices = (): R[] => arr(doctorOf(c.st, drSel.value)?.prices);
  const priceFor = (type: string): R | undefined => prices().find((p) => trLower(p.name) === trLower(type.trim()));
  const applyPrice = (l: OrderLine): void => { const p = priceFor(l.type); if (p) { l.price = Number(p.price) || 0; l.currency = curOf(p); } };
  const drawLines = (): void => {
    priceHint.replaceChildren(...prices().map((p) => h('option', { value: String(p.name) })));
    linesBox.replaceChildren(...lines.map((l, i) => h('div', { class: 'row' },
      h('input', { placeholder: 'İş türü', list: 'of-types', value: l.type, maxlength: 200, 'aria-label': 'İş türü', on: { change: (e) => { l.type = (e.target as HTMLInputElement).value; applyPrice(l); drawLines(); } } }),
      h('input', { type: 'number', min: 1, step: 1, value: l.qty, 'aria-label': 'Adet', on: { input: (e) => { l.qty = Number((e.target as HTMLInputElement).value); if (i === 0) qtyTouched = true; } } }),
      h('input', { type: 'number', min: 0, step: '0.01', value: l.price, 'aria-label': 'Birim fiyat', on: { input: (e) => { l.price = Number((e.target as HTMLInputElement).value); } } }),
      (() => { const s = select('cur', curOptions, l.currency); s.addEventListener('change', () => { l.currency = s.value as Cur; }); return s; })(),
      lines.length > 1 ? btn('Sil', () => { lines.splice(i, 1); drawLines(); }, 'btn ghost') : null)));
  };
  drSel.addEventListener('change', () => { lines.forEach(applyPrice); drawLines(); });
  const initTeeth = parseTeeth(pre.teeth ?? []).teeth; if (initTeeth.length) lines[0].qty = initTeeth.length; lines.forEach(applyPrice); // aktarılan gönderimde diş sayısı adet, hekim fiyat listesi fiyat olur
  drawLines();
  const submit = abtn('Siparişi kaydet', async () => {
    const dr = doctorOf(c.st, drSel.value); if (!dr) throw new Error('Hekim seçin.'); const patient = val(root, 'patient'); if (!patient) throw new Error('Hasta adı girin.');
    const valid = lines.filter((l) => l.type.trim() || val(root, 'material')); const err = validateOrderLines(valid); if (err) throw new Error(err);
    const auto = autoTechOf(dr, live(c.st.technicians)); const srcId = pre.id ? String(pre.id) : null;
    const notes = [val(root, 'notes'), restTeeth.length ? `Diş notu: ${restTeeth.join(' ')}` : '', pre.jaw ? `Çene: ${pre.jaw}` : ''].filter(Boolean).join('\n');
    const r = buildOrder({ doctor: dr, tech: auto, patient, lines: valid, teeth: chart.get(), material: val(root, 'material'), color: val(root, 'color'), dateout: val(root, 'dateout'), notes, files: arr(pre.files), sourceSubId: srcId, now: nowIso(), newId });
    await createOrder(c.s, r.ops, srcId);
    if (arr(pre.files).length) await copyFilesForTech(r.ops.filter((o) => o.name === 'jobs').map((o) => o.id));
    const f = { drName: dr.name, patient, dateout: val(root, 'dateout'), color: val(root, 'color'), teeth: chart.get(), material: val(root, 'material'), notes };
    root.replaceChildren(h('h2', null, 'Sipariş kaydedildi'), h('p', null, r.auto ? `Hekimin otomatik teknisyeni (${auto?.name}) olduğu için ${valid.length} iş onaysız "Devam Eden İşler"e düştü.` : `${valid.length} kalem "Onay Bekleyen" listesine gönderildi.`),
      btn('🖨️ Yazdır', () => printNode(orderPrintNode(f, valid))), btn('Yeni form', () => c.go('order'), 'btn primary'), btn(r.auto ? 'Devam eden işler' : 'Onay bekleyenler', () => c.go(r.auto ? 'jobs' : 'pending')));
  }, 'btn primary');
  root.append(h('h2', null, pre.id ? 'Sipariş Formu (hekim gönderiminden)' : 'Sipariş Formu'), ...(pre.files?.length ? [h('p', { class: 'muted' }, `📎 ${pre.files.length} tarama dosyası işe eklenecek.`)] : []),
    field('Hekim', drSel), field('Hasta', input('patient', 'text', pre.patient ?? '', { maxlength: 300 })), h('div', { class: 'field' }, h('span', null, 'Dişler (FDI)'), chart.el),
    field('Materyal', input('material', 'text', pre.material ?? '', { maxlength: 100 })), field('Renk (VITA, örn. A2)', input('color', 'text', pre.color ?? pre.toothColor ?? '', { maxlength: 40 })), field('Teslim tarihi', input('dateout', 'date')), field('Notlar', textarea('notes', String(pre.notes ?? ''))),
    h('h3', null, 'Kalemler (tür / adet / birim fiyat / para birimi)'), priceHint, linesBox, btn('+ Kalem', () => { lines.push({ type: '', qty: 1, price: 0, currency: 'TRY' }); drawLines(); }), h('p', null, submit));
  const hist = [...c.st.orderForms].filter((f) => !f.deleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 15);
  return h('div', null, root, h('h3', null, 'Son sipariş formları'), table([{ head: 'Tarih', cell: (f: Rec) => fmtDate(f.createdAt) }, { head: 'Hekim', cell: (f: Rec) => f.drName }, { head: 'Hasta', cell: (f: Rec) => f.patient }, { head: 'İş', cell: (f: Rec) => f.jobType }, { head: 'Yazdırıldı', cell: (f: Rec) => (f.printed ? badge('Evet', 'ok') : badge('Hayır')) },
    { head: '', cell: (f: Rec) => abtn('Yazdır', async () => { printNode(orderPrintNode({ ...f, color: f.color }, [{ type: f.jobType, qty: f.qty ?? 1, price: f.price ?? 0, currency: curOf(f) }])); await patch(c.s, 'orderForms', f.id, { printed: true, printedAt: nowIso() }); }, 'btn ghost') }], hist, 'Henüz form yok'));
}

/* ---------------- Hekimden Gelenler ---------------- */
export function doctorsubs(c: Ctx): HTMLElement {
  const state = (c.ps.subs ??= { tab: 'Yeni' }) as { tab: string };
  const all = live(c.st.doctorSubmissions).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const rows = all.filter((r) => r.status === state.tab);
  const tabs: [string, string][] = ['Yeni', 'Aktarıldı', 'Reddedildi'].map((k) => [k, `${k} (${all.filter((r) => r.status === k).length})`]);
  return h('div', null, h('h2', null, 'Hekimden Gelenler'), tabBar(tabs, state.tab, (k) => { state.tab = k; c.rerender(); }), table([
    { head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.doctorName ?? doctorOf(c.st, r.doctorId)?.name ?? r.doctorId }, { head: 'Hasta', cell: (r: Rec) => r.patient },
    { head: 'İş', cell: (r: Rec) => `${r.jobType ?? ''} ${formatTeeth(r.teeth)}${r.color ? ` · ${r.color}` : ''}` }, { head: 'Not', cell: (r: Rec) => r.notes }, { head: 'Dosya', cell: (r: Rec) => h('div', null, fileLinks(r.files), arr(r.files).length ? abtn('📦 ZIP', async () => { const x = await downloadJobsZip([{ drName: r.doctorName ?? r.doctorId, patient: r.patient, toothColor: r.color, type: r.jobType, note: r.notes, files: r.files, status: 'Hekim gönderimi' }], 'scan'); toast(`${x.ok} dosya indirildi${x.fail ? `, ${x.fail} başarısız` : ''}`, x.fail ? 'err' : 'ok'); }, 'btn ghost') : null) },
    { head: 'Durum', cell: (r: Rec) => badge(String(r.status)) },
    { head: '', cell: (r: Rec) => (r.status === 'Yeni' ? h('span', null, btn('Siparişe aktar', () => c.go('order', { ...r, drId: r.drId ?? r.doctorId })),
      abtn('Reddet', async () => { const why = ask('Ret nedeni (hekime gösterilir):', 'Eksik/hatalı bilgi'); if (why === null) return; await transition(c.s, 'doctorSubmissions', r.id, 'Yeni', 'Reddedildi', { rejectReason: why.slice(0, 500), rejectedAt: nowIso() }); }, 'btn ghost', 'Reddedildi'))
      : abtn('Sil', async () => { if (sure('Çöp kutusuna taşınsın mı? (Silinenler sayfasından geri alınabilir)')) await softDelete(c.s, 'doctorSubmissions', r.id); }, 'btn ghost')) },
  ], rows, 'Kayıt yok'));
}

/* ---------------- Onay Bekleyen ---------------- */
function pendingEdit(c: Ctx, p: Rec): void {
  const f = h('div', null, field('Hekim', select('doctorId', [['', '— Seçin —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])], String(matchDoctor(p, live(c.st.doctors))?.id ?? ''))), field('Hasta', input('patient', 'text', p.patient ?? '', { maxlength: 300 })),
    field('İş türü', input('type', 'text', p.type ?? '', { maxlength: 200 })), field('Adet', input('qty', 'number', p.qty ?? 1, { min: 1, step: 1 })), field('Birim fiyat', input('price', 'number', p.price ?? 0, { min: 0, step: '0.01' })), field('Para birimi', select('currency', curOptions, curOf(p))),
    field('Teslim', input('dateout', 'date', p.dateout ?? '')), field('Renk', input('color', 'text', p.toothColor ?? '', { maxlength: 40 })),
    field('Teknisyen', select('techId', [['', '— Atanmamış —'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], String(p.techId ?? ''))), field('Not', textarea('note', String(p.note ?? ''))));
  const m = modal('Onay bekleyen işi düzenle', f, abtn('Kaydet', async () => {
    const dr = doctorOf(c.st, val(f, 'doctorId')); const qty = Number(val(f, 'qty')); const price = Number(val(f, 'price'));
    if (!val(f, 'patient')) throw new Error('Hasta adı girin.'); if (!Number.isInteger(qty) || qty < 1) throw new Error('Adet 1 veya daha büyük tam sayı olmalı.'); if (!(price >= 0)) throw new Error('Fiyat negatif olamaz.');
    const t = techOf(c.st, val(f, 'techId'));
    await patch(c.s, 'pendingJobs', p.id, { ...(dr ? { drId: dr.id, doctorId: String(dr.id), drName: dr.name } : {}), patient: val(f, 'patient'), type: val(f, 'type'), qty, price, currency: val(f, 'currency'), dateout: val(f, 'dateout'), toothColor: val(f, 'color'), note: val(f, 'note'), techId: t?.id ?? null, techName: t?.name ?? '', techIds: t ? [String(t.id)] : [] });
    m.close();
  }, 'btn primary', 'Kaydedildi'));
}
/** Hızlı iş talebinde hekim adı kayıtlarla eşleşmediyse: hekim seçtirir, sonra onaylar. */
function chooseDoctorThenApprove(c: Ctx, p: Rec): void {
  const sel = select('doctorId', [['', '— Hekim seçin —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])], '');
  const m = modal('Hekim seçin', h('div', null, h('p', null, `"${p.drName || '—'}" adlı hekim kayıtlarla eşleşmedi. İşi onaylamak için hekimi seçin (hekimsiz iş oluşturulmaz).`), field('Hekim', sel)),
    abtn('Seç ve onayla', async () => {
      const dr = doctorOf(c.st, sel.value); if (!dr) throw new Error('Hekim seçin.');
      await approvePending(c.s, String(p.id), (x) => pendingToJob(x, dr, nowIso()));
      m.close();
      if (needsFileCopy(p)) await copyFilesForTech([String(p.id)]);
    }, 'btn primary', 'İş onaylandı'));
}
export function pending(c: Ctx): HTMLElement {
  const state = (c.ps.pending ??= { tab: 'incoming' }) as { tab: string };
  const incoming = live(c.st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor' || p.status === 'Reddedildi').sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const done = live(c.st.jobs).filter((j) => j.status === 'Tamamlama Onayı').sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const body = state.tab === 'incoming' ? table([
    { head: 'Kaynak', cell: (r: Rec) => (r.submittedBy === 'tech' ? `🔧 ${r.techName ?? 'Teknisyen'}` : '📋 Sipariş formu') }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.type ?? ''} ×${r.qty ?? 1}` },
    { head: 'Tutar', cell: (r: Rec) => money(jobCents(r), curOf(r)) }, { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) }, { head: 'Dosya', cell: (r: Rec) => (arr(r.files).length ? `📎 ${arr(r.files).length}` : '') }, { head: 'Not', cell: (r: Rec) => `${r.note ?? ''}${r.rejectReason ? ` (Red: ${r.rejectReason})` : ''}` },
    { head: 'Durum', cell: (r: Rec) => badge(String(r.status)) },
    { head: '', cell: (r: Rec) => (r.status === 'Onay Bekliyor' ? h('span', null, btn('Düzenle', () => pendingEdit(c, r), 'btn ghost'),
      abtn('Onayla', async () => {
        const dr = matchDoctor(r, live(c.st.doctors));
        if (!dr) { chooseDoctorThenApprove(c, r); return; } // hekim eşleşmedi: seçmeden iş oluşmaz (doctorId boş iş yok)
        if (!sure(`"${r.patient}" için ${r.type || 'iş'} onaylanıp ana listeye eklensin mi?`)) return;
        await approvePending(c.s, r.id, (p) => pendingToJob(p, dr, nowIso()));
        if (needsFileCopy(r)) await copyFilesForTech([String(r.id)]);
      }, 'btn primary', 'İş onaylandı'),
      abtn('Reddet', async () => { const why = ask('Ret nedeni (teknisyene gösterilir):', 'Eksik/hatalı bilgi'); if (why === null) return; await transition(c.s, 'pendingJobs', r.id, 'Onay Bekliyor', 'Reddedildi', { rejectReason: why.slice(0, 500), rejectedAt: nowIso() }); }, 'btn ghost', 'Reddedildi'))
      : abtn('Sil', async () => { if (sure('Çöp kutusuna taşınsın mı?')) await softDelete(c.s, 'pendingJobs', r.id); }, 'btn ghost')) },
  ], incoming, 'Gelen iş onayı yok') : table([
    { head: 'Teknisyen', cell: (r: Rec) => r.techName }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.type ?? ''} ×${r.qty ?? 1}` }, { head: 'Tutar', cell: (r: Rec) => money(jobCents(r), curOf(r)) },
    { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) }, { head: 'Tasarım', cell: (r: Rec) => (arr(r.designFiles).length ? `🎨 ${arr(r.designFiles).length}` : '') },
    { head: '', cell: (r: Rec) => h('span', null, btn('Detay', () => jobDetail(c, r), 'btn ghost'),
      abtn('Onayla', async () => { if (sure(`"${r.patient}" işinin tamamlandığı onaylansın mı?`)) await mutateJob(c.s, r.id, (j) => approveCompletionPatch(j, nowIso())); }, 'btn primary', 'Tamamlandı olarak onaylandı'),
      abtn('Reddet', async () => { const why = ask('Reddetme sebebi (teknisyene iletilir):', ''); if (why === null) return; await mutateJob(c.s, r.id, (j) => rejectCompletionPatch(j, why, nowIso())); }, 'btn ghost', 'Makyajda durumuna geri alındı')) },
  ], done, 'Tamamlama onayı bekleyen iş yok');
  return h('div', null, h('h2', null, 'Onay Bekleyen'), tabBar([['incoming', `📥 Gelen iş onayı (${incoming.filter((p) => p.status === 'Onay Bekliyor').length})`], ['completion', `📤 Biten iş onayı (${done.length})`]], state.tab, (k) => { state.tab = k; c.rerender(); }), body);
}

/* ---------------- İş Dağıtım Merkezi ---------------- */
export function dispatch(c: Ctx): HTMLElement {
  const techs = live(c.st.technicians); const jobs = live(c.st.jobs); const rows = jobs.filter((j) => isOpen(j) && unassigned(j));
  const opts: [string, string][] = [['', '— Teknisyen —'], ...techs.map((t): [string, string] => [String(t.id), `${t.name} (${activeLoad(jobs, String(t.id))} aktif)`])];
  const assign = (j: Rec, techId: string, note: string) => mutateJob(c.s, j.id, (cur) => { const t = techOf(c.st, techId); if (!t) throw new Error('Teknisyen seçin.'); if (cur.status === 'Tamamlandı') throw new Error('Tamamlanmış işe atama yapılamaz.'); return assignPatch(t, note); }).then(async () => { const j2 = c.st.jobs.find((x) => x.id === j.id); if (j2 && needsFileCopy(j2)) await copyFilesForTech([String(j.id)]); });
  const best = suggestTech(techs, jobs);
  return h('div', null, h('h2', null, 'İş Dağıtım Merkezi'), best ? h('p', { class: 'muted' }, `En az yüklü teknisyen: ${best.name} (${activeLoad(jobs, String(best.id))} aktif iş)`) : null, table([
    { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.type }, { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) }, { head: 'Durum', cell: (r: Rec) => r.status },
    { head: 'Ata', cell: (r: Rec) => { const sel = select('t', opts, best ? String(best.id) : ''); const note = input('note', 'text', '', { placeholder: 'Not', maxlength: 300 }); return h('span', null, sel, note, abtn('Ata', () => assign(r, sel.value, note.value), 'btn primary', 'Atandı')); } },
  ], rows, 'Atanmamış iş yok'),
  h('h3', null, 'Teknisyen iş yükü'), table([{ head: 'Teknisyen', cell: (t: Rec) => t.name }, { head: 'Aktif iş', cell: (t: Rec) => activeLoad(jobs, String(t.id)) }, { head: 'Geciken', cell: (t: Rec) => jobs.filter((j) => isOpen(j) && techIdsOf(j).includes(String(t.id)) && isOverdue(j, todayLocal())).length }], techs, 'Teknisyen yok'),
  h('h3', null, 'Atanmış açık işler'), table([{ head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.type }, { head: 'Teknisyen', cell: (r: Rec) => r.techName }, { head: 'Durum', cell: (r: Rec) => r.status },
    { head: '', cell: (r: Rec) => h('span', null, abtn('Atamayı kaldır', async () => { await mutateJob(c.s, r.id, (cur) => (cur.status === 'Tamamlandı' ? null : unassignPatch())); }, 'btn ghost', 'Atama kaldırıldı')) }], jobs.filter((j) => isOpen(j) && !unassigned(j)), 'Atanmış açık iş yok'));
}

/* ---------------- İş detayı (sekmeli) ---------------- */
export function printJob(j: R): void {
  printNode(h('div', { class: 'print-doc' }, h('h2', null, 'İş Emri'), h('pre', null, jobInfoText(j, 'scan')), h('p', null, `Teknisyen: ${j.techName ?? '—'}   |   Tutar: ${money(jobCents(j), curOf(j))}`)));
}
export function jobDetail(c: Ctx, j0: Rec): void {
  const j = j0; const body = h('div'); let tab = 'info';
  const TABS: [string, string][] = [['info', 'Genel'], ['scan', `Tarama (${arr(j.files).length})`], ['design', `Tasarım (${arr(j.designFiles).length})`], ['form', 'Sipariş formu'], ['hist', 'Geçmiş']];
  const bar = h('div'); const m = modal(`${j.patient ?? ''} — ${j.type ?? ''}`, h('div', null, bar, body));
  const draw = (k: string): void => { tab = k; bar.replaceChildren(tabBar(TABS, tab, draw)); body.replaceChildren(({ info, scan: () => files('files'), design: () => files('designFiles'), form, hist } as Record<string, () => HTMLElement>)[k]()); };
  const closed = j.status === 'Tamamlandı' && !!j.closureId;
  const info = (): HTMLElement => {
    const chart = toothChart(j.orderForm?.teeth ?? []);
    const f = h('div', null, closed ? h('p', { class: 'muted' }, 'Bu iş hesabı kapatılmış bir döneme dahil: hekim/tutar/adet değiştirilemez.') : null,
      field('Hekim', select('doctorId', [...(doctorIdOf(j) ? [] : [['', '— Hekim seçin (eski kayıt hekimsiz) —'] as [string, string]]), ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])], doctorIdOf(j))), field('Hasta', input('patient', 'text', j.patient ?? '', { maxlength: 300 })), field('İş türü', input('type', 'text', j.type ?? '', { maxlength: 200 })),
      field('Adet', input('qty', 'number', j.qty ?? 1, { min: 0, step: 1 })), field('Birim fiyat', input('price', 'number', j.price ?? 0, { min: 0, step: '0.01' })), field('Para birimi', select('currency', curOptions, curOf(j))), field('Teslim', input('dateout', 'date', j.dateout ?? '')),
      field('Renk', input('color', 'text', j.toothColor ?? '', { maxlength: 40 })), field('Materyal', input('material', 'text', j.orderForm?.material ?? '', { maxlength: 100 })), h('div', { class: 'field' }, h('span', null, 'Dişler'), chart.el),
      field('Teknisyen', select('techId', [['', '— Atanmamış —'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], techIdsOf(j)[0] ?? '')),
      field('Durum', select('status', statusOptions(j.status), String(j.status))), field('Not', textarea('note', String(j.note ?? ''))),
      h('p', { class: 'muted' }, `Teknisyen notu: ${j.techNote || '—'}${j.completionRejectReason ? ` | Son ret sebebi: ${j.completionRejectReason}` : ''}`));
    return h('div', null, f, abtn('Kaydet', async () => {
      const doctor = doctorOf(c.st, val(f, 'doctorId')); if (!doctor) throw new Error('Hekim seçin.');
      const form = { doctor, patient: val(f, 'patient'), type: val(f, 'type'), qty: Number(val(f, 'qty')), price: Number(val(f, 'price')), currency: val(f, 'currency') as Cur, dateout: val(f, 'dateout'), color: val(f, 'color'), note: val(f, 'note'), tech: techOf(c.st, val(f, 'techId')) ?? null, status: val(f, 'status') };
      if (form.status === 'Tamamlandı' && j.status !== 'Tamamlandı' && !sure('İş "Tamamlandı" yapılacak ve hekimin bakiyesine yansıyacak. Emin misiniz?')) return;
      await mutateJob(c.s, j.id, (cur) => ({ ...jobEditPatch(cur, form, nowIso()), orderForm: { ...(cur.orderForm ?? {}), teeth: chart.get(), material: val(f, 'material'), doctorName: doctor.name } }));
      if (form.tech && needsFileCopy(j)) await copyFilesForTech([String(j.id)]);
      m.close();
    }, 'btn primary', 'İş güncellendi'), btn('🖨️ İş emri yazdır', () => printJob(j), 'btn ghost'), btn('💬 Hekime yaz', () => { m.close(); c.ps.chat = { thread: `dr_${doctorIdOf(j)}` }; c.go('chat'); }, 'btn ghost'), btn('💬 İş sohbeti', () => { m.close(); c.ps.chat = { thread: `job_${j.id}` }; c.go('chat'); }, 'btn ghost'),
    abtn('Sil', async () => { if (j.closureId) throw new Error('Hesabı kapatılmış dönemdeki iş silinemez (önce dönem kapatmayı geri alın).'); if (sure('İş çöp kutusuna taşınsın mı? (Silinenlerden geri alınabilir)')) { await softDelete(c.s, 'jobs', j.id); m.close(); } }, 'btn ghost'));
  };
  const files = (field: 'files' | 'designFiles'): HTMLElement => {
    const list = arr(j[field]) as Rec[]; const pick = h('input', { type: 'file', multiple: true });
    return h('div', null, list.length ? list.map((f) => h('div', { class: 'row' }, fileLinks([f]), f.size ? h('span', { class: 'muted' }, `${(f.size / 1048576).toFixed(1)} MB`) : null,
      abtn('Listeden kaldır', async () => { if (!sure(`"${f.name}" iş kaydından kaldırılsın mı? (Dosya depoda kalır)`)) return; await mutateJob(c.s, j.id, (cur) => ({ [field]: arr(cur[field]).filter((x: Rec) => (x.path ?? x.url ?? x.name) !== (f.path ?? f.url ?? f.name)), ...(field === 'designFiles' ? { designFilesUpdatedAt: nowIso() } : {}) })); m.close(); }, 'btn ghost'))) : h('p', { class: 'muted' }, 'Dosya yok.'),
    field === 'files' && needsFileCopy(j) ? abtn('📁 Dosyaları teknisyen için hazırla', async () => { if (await copyFilesForTech([String(j.id)])) { toast('Dosyalar iş klasörüne kopyalandı'); m.close(); } }, 'btn ghost') : null,
    list.length ? abtn('📦 Tümünü ZIP indir', async () => { const x = await downloadJobsZip([j], field === 'files' ? 'scan' : 'design'); toast(`${x.ok} dosya paketlendi${x.fail ? `, ${x.fail} başarısız` : ''}`, x.fail ? 'err' : 'ok'); }) : null,
    h('div', { class: 'row' }, pick, abtn('Yükle', async () => { const picked = Array.from((pick as HTMLInputElement).files ?? []); if (!picked.length) return; const up: FileRef[] = []; for (const x of picked) up.push(await upload(`labs/${c.s.lab}/jobFiles/${j.id}`, x, c.s.user.uid));
      await mutateJob(c.s, j.id, (cur) => ({ [field]: [...arr(cur[field]), ...up], ...(field === 'designFiles' ? { designFilesUpdatedAt: nowIso() } : {}) })); m.close(); }, 'btn', 'Dosyalar yüklendi')));
  };
  const form = (): HTMLElement => { const t = toothChart(j.orderForm?.teeth ?? [], undefined, true); return h('div', null, h('p', null, `Hekim: ${j.drName ?? ''} | Renk: ${j.toothColor ?? '—'} | Materyal: ${j.orderForm?.material ?? '—'}`), t.el, h('p', null, `Not: ${j.note ?? ''}`), btn('🖨️ Yazdır', () => printNode(orderPrintNode({ drName: j.drName, patient: j.patient, dateout: j.dateout, color: j.toothColor, teeth: j.orderForm?.teeth, material: j.orderForm?.material, notes: j.note }, [{ type: j.type, qty: qtyShown(j), price: Number(j.price) || 0, currency: curOf(j) }])))); };
  const hist = (): HTMLElement => {
    const box = h('div', null, h('p', { class: 'muted' }, 'Yükleniyor…'));
    void jobHistory(c.s, j.id).then((rows) => box.replaceChildren(table([{ head: 'Zaman', cell: (r: R) => (r.at?.toDate ? r.at.toDate().toLocaleString('tr-TR') : '') }, { head: 'İşlem', cell: (r: R) => r.kind }, { head: 'Önceki durum', cell: (r: R) => r.before?.status ?? '' }, { head: 'Önceki teknisyen', cell: (r: R) => r.before?.techName ?? '' }, { head: 'Yapan (beyan)', cell: (r: R) => r.actor }], rows, 'Geçmiş kaydı yok'))).catch((e: Error) => box.replaceChildren(h('p', { class: 'muted' }, `Geçmiş okunamadı: ${e.message}`)));
    return box;
  };
  draw('info');
}
const qtyShown = (j: R): number => (j.qty === undefined || j.qty === null || j.qty === '' ? 1 : Number(j.qty) || 0);

/* ---------------- İşler ---------------- */
export function jobsPage(c: Ctx, done: boolean): HTMLElement {
  const key = done ? 'done' : 'jobs'; const f = (c.ps[key] ??= { q: '', status: '', tech: '' }) as { q: string; status: string; tech: string };
  const base = live(c.st.jobs).filter((j) => (j.status === 'Tamamlandı') === done).sort((a, b) => String(done ? b.completedAt ?? '' : a.dateout ?? '9999').localeCompare(String(done ? a.completedAt ?? '' : b.dateout ?? '9999')));
  const box = h('div'); const today = todayLocal();
  const statusSel = (j: Rec) => {
    const s = select('st', statusOptions(j.status), String(j.status));
    s.addEventListener('change', () => { const next = s.value; s.disabled = true; void (async () => {
      try { if (next === 'Tamamlandı' && !sure(`"${j.patient}" işi Tamamlandı yapılsın mı? (Hekimin bakiyesine yansır)`)) { s.value = j.status; return; } await mutateJob(c.s, j.id, (cur) => statusPatch(cur, next, nowIso())); toast('Durum güncellendi'); } catch (e) { s.value = j.status; toast((e as Error).message, 'err'); } finally { s.disabled = false; }
    })(); });
    return s;
  };
  const cols = [{ head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.type ?? ''} ×${qtyShown(r)}` }, { head: 'Teknisyen', cell: (r: Rec) => r.techName || '—' },
    { head: 'Teslim', cell: (r: Rec) => (isOverdue(r, today) ? h('span', { class: 'pend-late' }, `${fmtDate(r.dateout)} ⚠️`) : fmtDate(r.dateout)) }, { head: 'Tutar', cell: (r: Rec) => money(jobCents(r), curOf(r)) }, { head: 'Durum', cell: statusSel },
    { head: '', cell: (r: Rec) => h('span', null, btn('Detay', () => jobDetail(c, r), 'btn ghost'), abtn('Sil', async () => { if (r.closureId) throw new Error('Hesabı kapatılmış dönemdeki iş silinemez.'); if (sure('İş çöp kutusuna taşınsın mı? (Silinenler sayfasından geri alınabilir)')) await softDelete(c.s, 'jobs', r.id); }, 'btn ghost')) }];
  const filtered = (): Rec[] => base.filter((j) => (!f.q || [j.drName, j.patient, j.type, j.techName].some((x) => trLower(x).includes(f.q))) && (!f.status || j.status === f.status) && (!f.tech || (f.tech === '-' ? unassigned(j) : techIdsOf(j).includes(f.tech))));
  const draw = (): void => { const rows = filtered(); box.replaceChildren(h('p', { class: 'muted' }, `${rows.length} kayıt · toplam ${fmtSums(rows.reduce((s, j) => { s[curOf(j)] += jobCents(j); return s; }, zeroSums()), true)}`), table(cols, rows, done ? 'Tamamlanan iş yok' : 'Devam eden iş yok')); };
  const st = select('f', [['', 'Tüm durumlar'], ...JOB_STATUSES.filter((x) => (x === 'Tamamlandı') === done).map((x): [string, string] => [x, x])], f.status); st.addEventListener('change', () => { f.status = st.value; draw(); });
  const tc = select('t', [['', 'Tüm teknisyenler'], ['-', 'Atanmamış'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], f.tech); tc.addEventListener('change', () => { f.tech = tc.value; draw(); });
  draw();
  return h('div', null, h('h2', null, done ? 'Tamamlanan İşler' : 'Devam Eden İşler'), h('div', { class: 'row' }, searchInput('Ara: hekim, hasta, iş, teknisyen', (q) => { f.q = q; draw(); }, f.q), st, tc,
    btn('🖨️ Yazdır', () => printReport(done ? 'Tamamlanan İşler' : 'Devam Eden İşler', new Date().toLocaleDateString('tr-TR'), [{ head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.type ?? ''} ×${qtyShown(r)}` }, { head: 'Teknisyen', cell: (r: Rec) => r.techName }, { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) }, { head: 'Tutar', cell: (r: Rec) => money(jobCents(r), curOf(r)) }, { head: 'Durum', cell: (r: Rec) => r.status }], filtered(), [`Toplam: ${fmtSums(filtered().reduce((s, j) => { s[curOf(j)] += jobCents(j); return s; }, zeroSums()), true)}`]), 'btn ghost')), box);
}

/* ---------------- Dosyalar (toplu ZIP) ---------------- */
export function files(c: Ctx): HTMLElement {
  const sel = new Set<string>(); const f = (c.ps.files ??= { q: '' }) as { q: string }; const box = h('div'); const summary = h('span', { class: 'muted' });
  const all = live(c.st.jobs).filter((j) => arr(j.files).length || arr(j.designFiles).length);
  const rows = (): Rec[] => all.filter((j) => !f.q || [j.drName, j.patient, j.type].some((x) => trLower(x).includes(f.q)));
  const draw = (): void => { box.replaceChildren(table([
    { head: '', cell: (r: Rec) => h('input', { type: 'checkbox', checked: sel.has(r.id), 'aria-label': `Seç: ${r.patient}`, on: { change: (e) => { if ((e.target as HTMLInputElement).checked) sel.add(r.id); else sel.delete(r.id); summary.textContent = `${sel.size} iş seçili`; } } }) },
    { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Durum', cell: (r: Rec) => r.status }, { head: 'Tarama', cell: (r: Rec) => fileLinks(r.files) }, { head: 'Tasarım', cell: (r: Rec) => fileLinks(r.designFiles) }], rows(), 'Dosyalı iş yok')); };
  const zipSel = (kind: 'scan' | 'design' | 'both') => abtn(kind === 'scan' ? '📦 Tarama ZIP' : kind === 'design' ? '📦 Tasarım ZIP' : '📦 Hepsi ZIP', async () => {
    const jobs = all.filter((j) => sel.has(j.id)); if (!jobs.length) throw new Error('Önce iş seçin.');
    const x = await downloadJobsZip(jobs, kind, (d, t) => { summary.textContent = `Hazırlanıyor ${d}/${t}…`; }); summary.textContent = `${sel.size} iş seçili`; toast(`${x.ok} dosya paketlendi${x.fail ? `, ${x.fail} başarısız (ZIP içinde not var)` : ''}`, x.fail ? 'err' : 'ok');
  });
  draw();
  return h('div', null, h('h2', null, 'Dosyalar'), h('div', { class: 'row' }, searchInput('Ara: hasta, hekim, iş', (q) => { f.q = q; draw(); }, f.q), btn('Tümünü seç', () => { rows().forEach((r) => sel.add(r.id)); summary.textContent = `${sel.size} iş seçili`; draw(); }, 'btn ghost'), btn('Seçimi temizle', () => { sel.clear(); summary.textContent = ''; draw(); }, 'btn ghost'), zipSel('scan'), zipSel('design'), zipSel('both'), summary), box);
}
