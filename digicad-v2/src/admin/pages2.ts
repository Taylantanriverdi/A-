import { h, type Child } from '../lib/dom';
import { fmtDate } from '../lib/format';
import { callFn } from '../lib/firebase';
import { listen, newId, patch, put, restore, softDelete, type Rec } from '../lib/store';
import { badge, btn, field, input, modal, printNode, select, table, textarea, toast, val } from '../lib/ui';
import { COLLECTIONS, doctorOf, live, techOf, type State } from './state';
import { downloadUrl, upload } from '../lib/files';
import type { Ctx } from './pages1';
import { jobDetail } from './pages1';
import { abtn, arr, curOptions, fmtSums, money, searchInput, sure, trLower } from './util';
import { CURRENCIES, curOf, doctorTotals, fromCents, incomeDate, isoToLocalDate, jobCents, monthlyData, monthLocal, payCents, planClosure, sumExpenses, techIdsOf, todayLocal, toCents, yearsOf, zeroSums, type Cur, type R, type Sums } from './calc';
import { closeStatement, hideMessage, postMessage, recentAudit, undoClosure, watchMessages, setDoctorPrices } from './data';
import { printReport } from './print';
import { saveBlob } from '../lib/zip';

const callAdmin = <T>(name: string, data: unknown) => callFn<T>(name, data);
const nowIso = (): string => new Date().toISOString();
const sumsOf = (rows: R[], cents: (r: R) => number): Sums => rows.reduce<Sums>((s, r) => { s[curOf(r)] += cents(r); return s; }, zeroSums());

function showTemp(email: string, pw: string): void {
  modal('Geçici şifre (yalnızca şimdi gösterilir)', h('div', null, h('p', null, `Hesap: ${email}`), h('p', null, h('code', null, pw)), h('p', { class: 'muted' }, 'Bu şifreyi güvenli bir kanaldan iletin. İlk girişte değiştirilmesi zorunludur. Sistem şifreyi saklamaz.')));
}

/* ---------------- Mesajlar ---------------- */
const CHAT_TYPES = /^(image\/(png|jpeg|webp)|application\/pdf)$/;
export function chat(c: Ctx): HTMLElement {
  const state = (c.ps.chat ??= { thread: null }) as { thread: string | null };
  // İş sohbetleri (job_{işId}): eski uygulamadan göçle gelenler ve hekim/teknisyenin iş detayından açtıkları; `threads` koleksiyonundan listelenir.
  let jobThreads: Rec[] = [];
  const jobName = (tid: string): string => { const j = c.st.jobs.find((x) => `job_${x.id}` === tid); return `İş: ${j ? `${j.patient ?? ''} — ${j.type ?? ''}` : tid.slice(4)}`; };
  const threadList = (): { id: string; name: string }[] => {
    const jobs = [...jobThreads].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))).slice(0, 60).map((t) => String(t.id));
    if (state.thread?.startsWith('job_') && !jobs.includes(state.thread)) jobs.unshift(state.thread);
    return [...live(c.st.doctors).map((d) => ({ id: `dr_${d.id}`, name: `Hekim: ${d.name}` })), ...live(c.st.technicians).map((t) => ({ id: `tech_${t.id}`, name: `Teknisyen: ${t.name}` })), ...jobs.map((id) => ({ id, name: jobName(id) }))];
  };
  const side = h('div', { class: 'chat-list' }); const right = h('div', { class: 'chat-conv' }); let stop: (() => void) | undefined;
  c.own(() => { stop?.(); stop = undefined; });
  const open = (tid: string): void => {
    stop?.(); state.thread = tid; drawSide();
    const box = h('div', { class: 'chat-msgs', 'aria-live': 'polite' }); const inp = input('text', 'text', '', { maxlength: 4000, placeholder: 'Mesaj…', 'aria-label': 'Mesaj' }); const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf', 'aria-label': 'Dosya eki' });
    const send = abtn('Gönder', async () => {
      const text = inp.value.trim(); const f = file.files?.[0]; if (!text && !f) return;
      let att: { path: string; name: string } | undefined;
      if (f) { if (!CHAT_TYPES.test(f.type)) throw new Error('Sohbet eki yalnızca görsel (PNG/JPEG/WebP) veya PDF olabilir.'); const r = await upload(`labs/${c.s.lab}/chat/${tid}`, f, c.s.user.uid, 25); att = { path: r.path, name: r.name }; }
      await postMessage(c.s, tid, text, att); inp.value = ''; file.value = '';
    }, 'btn primary');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send.click(); } });
    right.replaceChildren(box, h('div', { class: 'row' }, inp, file, send));
    stop = watchMessages(c.s, tid, (rows) => {
      box.replaceChildren(...rows.filter((m) => !m.deletedAt).map((m) => h('div', { class: `msg ${m.senderRole === 'admin' ? 'me' : ''}` }, h('small', null, `${m.senderName ?? m.senderRole} · ${fmtDate(m.timestamp)} `, abtn('Sil', async () => { if (sure('Mesaj gizlensin mi? (Kayıt silinmez, denetim izinde kalır)')) await hideMessage(c.s, tid, m.id); }, 'btn ghost')), h('div', null, String(m.text ?? '')),
        m.filePath ? abtn(`📎 ${m.fileName ?? 'ek'}`, async () => { const a = h('a', { href: await downloadUrl(String(m.filePath)), target: '_blank', rel: 'noopener noreferrer' }); document.body.appendChild(a); a.click(); a.remove(); }, 'btn ghost chat-file') : m.fileUrl ? h('a', { href: String(m.fileUrl), target: '_blank', rel: 'noopener noreferrer' }, `📎 ${m.fileName ?? 'ek (eski)'}`) : null)));
      box.scrollTop = box.scrollHeight;
    }, (e) => toast(`Mesajlar okunamadı: ${e.message}`, 'err'));
  };
  const drawSide = (): void => side.replaceChildren(...threadList().map((t) => h('button', { type: 'button', class: `btn ${state.thread === t.id ? 'primary' : 'ghost'}`, on: { click: () => open(t.id) } }, t.name)));
  drawSide(); right.replaceChildren(h('p', { class: 'muted' }, 'Bir konuşma seçin'));
  if (state.thread && threadList().some((t) => t.id === state.thread)) open(state.thread);
  c.own(listen(c.s.lab, 'threads', (rows) => { jobThreads = rows.filter((r) => String(r.id).startsWith('job_')); drawSide(); }, [], () => undefined));
  return h('div', null, h('h2', null, 'Mesajlar'), h('div', { class: 'chat' }, side, right));
}

/* ---------------- Ekstre / kasa yardımcıları ---------------- */
export function statementNode(c: Ctx, dr: Rec, includeClosed = false, closureId?: string): HTMLElement {
  const id = String(dr.id); const inClosure = (r: Rec) => (closureId ? r.closureId === closureId : includeClosed || !r.closureId);
  const jobs = live(c.st.jobs).filter((j) => String(j.doctorId || j.drId) === id && j.status === 'Tamamlandı' && inClosure(j)).sort((a, b) => incomeDate(a).localeCompare(incomeDate(b)));
  const pays = live(c.st.payments).filter((p) => String(p.doctorId || p.drId) === id && inClosure(p)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const t = doctorTotals(jobs, pays, id, true);
  return h('div', { class: 'print-doc' }, h('h2', null, `Hesap Ekstresi — ${dr.name}`), h('p', { class: 'muted' }, `Düzenlenme: ${todayLocal()}${closureId ? ' (kapanmış dönem)' : includeClosed ? ' (tüm dönemler)' : ' (açık dönem)'}`),
    table([{ head: 'Tarih', cell: (j: Rec) => fmtDate(incomeDate(j)) }, { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Adet', cell: (j: Rec) => j.qty ?? 1 }, { head: 'Tutar', cell: (j: Rec) => money(jobCents(j), curOf(j)) }], jobs, 'İş yok'),
    h('h3', null, 'Tahsilatlar'), table([{ head: 'Tarih', cell: (p: Rec) => fmtDate(p.date) }, { head: 'Tutar', cell: (p: Rec) => money(payCents(p), curOf(p)) }, { head: 'Not', cell: (p: Rec) => p.note }], pays, 'Tahsilat yok'),
    h('p', null, `İş toplamı: ${fmtSums(t.charged, true)}   |   Tahsilat: ${fmtSums(t.paid, true)}`), h('p', null, h('b', null, `Bakiye (alacak): ${fmtSums(t.balance, true)}`)));
}

function paymentModal(c: Ctx, p: Rec | undefined, doctorId: string | undefined, done: () => void): void {
  const drOpts: [string, string][] = [['', '— Hekim —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])];
  const f = h('div', null, field('Hekim', select('doctorId', drOpts, String(p?.doctorId || p?.drId || doctorId || ''))), field('Tarih', input('date', 'date', p?.date ?? todayLocal())), field('Tutar', input('amount', 'number', p?.amount ?? '', { min: 0.01, step: '0.01' })),
    field('Para birimi', select('currency', curOptions, curOf(p))), field('Tahsil eden teknisyen (isteğe bağlı)', select('collectorId', [['', '—'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], String(p?.collectorId ?? ''))), field('Not', input('note', 'text', p?.note ?? '', { maxlength: 500 })));
  const m = modal(p ? 'Tahsilatı düzenle' : 'Yeni tahsilat', f, abtn('Kaydet', async () => {
    const dr = doctorOf(c.st, val(f, 'doctorId')); if (!dr) throw new Error('Hekim seçin.'); const amount = toCents(val(f, 'amount')); const date = val(f, 'date');
    if (amount <= 0) throw new Error('Tutar sıfırdan büyük olmalı.'); if (!isoToLocalDate(date)) throw new Error('Tarih girin.');
    if (p?.closureId && (String(p.doctorId || p.drId) !== String(dr.id) || toCents(p.amount) !== amount || curOf(p) !== val(f, 'currency'))) throw new Error('Hesabı kapatılmış dönemdeki tahsilatın hekim/tutarı değiştirilemez.');
    const t = techOf(c.st, val(f, 'collectorId')); const id = p?.id ?? newId();
    await put(c.s, 'payments', id, { id, doctorId: String(dr.id), drId: dr.id, drName: dr.name, date, amount: fromCents(amount), currency: val(f, 'currency'), collectorId: t?.id ?? null, collectorName: t?.name ?? null, note: val(f, 'note') }, !p);
    m.close(); done();
  }, 'btn primary', 'Kaydedildi'));
}

function closeModal(c: Ctx, dr: Rec, done: () => void): void {
  const t = doctorTotals(live(c.st.jobs), live(c.st.payments), String(dr.id));
  if (!t.jobCount && !t.payCount) { toast('Bu hekim için kapatılacak açık kayıt yok', 'err'); return; }
  const f = h('div', null, h('p', null, `${t.jobCount} iş, ${t.payCount} tahsilat bu dönemde kapatılacak (silinmez, "Geçmiş dönemler"e taşınır).`), h('p', null, `İş: ${fmtSums(t.charged, true)} | Tahsilat: ${fmtSums(t.paid, true)}`),
    ...CURRENCIES.filter((cur) => t.charged[cur] !== 0 || t.paid[cur] !== 0).map((cur) => field(`Kapanış bakiyesi (${cur}) — gerekirse düzeltin`, input(`bal_${cur}`, 'number', fromCents(t.balance[cur]), { step: '0.01' }))),
    field('Kapanış tarihi', input('date', 'date', todayLocal())), h('label', { class: 'row' }, h('input', { type: 'checkbox', name: 'carry', checked: true }), 'Bakiyeyi yeni döneme devret'));
  const m = modal(`${dr.name}: dönemi kapat`, f, abtn('Dönemi kapat', async () => {
    const override: Partial<Sums> = {}; for (const cur of CURRENCIES) { const el = f.querySelector(`[name="bal_${cur}"]`) as HTMLInputElement | null; if (el) override[cur] = toCents(el.value); }
    const plan = planClosure({ doctor: dr, jobs: live(c.st.jobs), pays: live(c.st.payments), carry: (f.querySelector('[name="carry"]') as HTMLInputElement).checked, closeDate: val(f, 'date') || todayLocal(), closureId: newId(), now: nowIso(), override });
    await closeStatement(c.s, plan); m.close(); done();
  }, 'btn primary', 'Dönem kapatıldı'));
}

export function doctorDetail(c: Ctx, doctorId: string, tab0 = 'jobs'): void {
  const body = h('div'); const bar = h('div'); let tab = tab0;
  const m0 = modal(`${doctorOf(c.st, doctorId)?.name ?? ''} — hesap`, body); const close = m0.close;
  const reopen = (): void => { close(); doctorDetail(c, doctorId, tab); };
  const draw = (k: string): void => {
    tab = k; const dr = doctorOf(c.st, doctorId); if (!dr) { body.replaceChildren(h('p', null, 'Hekim bulunamadı.')); return; }
    const t = doctorTotals(live(c.st.jobs), live(c.st.payments), doctorId); const open = (r: Rec) => !r.closureId;
    const jobs = live(c.st.jobs).filter((j) => String(j.doctorId || j.drId) === doctorId && j.status === 'Tamamlandı').sort((a, b) => incomeDate(b).localeCompare(incomeDate(a)));
    const pays = live(c.st.payments).filter((p) => String(p.doctorId || p.drId) === doctorId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const closures = live(c.st.statementClosures).filter((x) => String(x.doctorId || x.drId) === doctorId).sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
    const tabs: [string, string][] = [['jobs', `İşler (${t.jobCount})`], ['pays', `Tahsilatlar (${t.payCount})`], ['closures', `Geçmiş dönemler (${closures.length})`]];
    const views: Record<string, () => Child> = {
      jobs: () => table([{ head: 'Tarih', cell: (j: Rec) => fmtDate(incomeDate(j)) }, { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => `${j.type ?? ''} ×${j.qty ?? 1}` }, { head: 'Tutar', cell: (j: Rec) => money(jobCents(j), curOf(j)) }, { head: 'Dönem', cell: (j: Rec) => (open(j) ? badge('Açık', 'ok') : badge('Kapalı')) }, { head: '', cell: (j: Rec) => btn('Detay', () => { close(); jobDetail(c, j); }, 'btn ghost') }], jobs, 'Tamamlanan iş yok'),
      pays: () => h('div', null, btn('+ Tahsilat', () => paymentModal(c, undefined, doctorId, reopen), 'btn primary'), table([{ head: 'Tarih', cell: (p: Rec) => fmtDate(p.date) }, { head: 'Tutar', cell: (p: Rec) => money(payCents(p), curOf(p)) }, { head: 'Not', cell: (p: Rec) => p.note }, { head: 'Dönem', cell: (p: Rec) => (open(p) ? badge('Açık', 'ok') : badge('Kapalı')) },
        { head: '', cell: (p: Rec) => h('span', null, btn('Düzenle', () => paymentModal(c, p, doctorId, reopen), 'btn ghost'), abtn('Sil', async () => { if (p.closureId) throw new Error('Kapatılmış dönemdeki tahsilat silinemez.'); if (sure('Tahsilat çöp kutusuna taşınsın mı?')) { await softDelete(c.s, 'payments', p.id); reopen(); } }, 'btn ghost')) }], pays, 'Tahsilat yok')),
      closures: () => table([{ head: 'Kapanış', cell: (x: Rec) => fmtDate(x.closedAt) }, { head: 'İş', cell: (x: Rec) => arr(x.jobIds).length }, { head: 'Bakiye', cell: (x: Rec) => fmtSums(CURRENCIES.reduce((s, cur) => { s[cur] = toCents(x.balance?.[cur]); return s; }, zeroSums()), true) }, { head: 'Devir', cell: (x: Rec) => (x.carriedForward ? 'Evet' : 'Hayır') },
        { head: '', cell: (x: Rec) => h('span', null, btn('Ekstre', () => printNode(statementNode(c, dr, true, String(x.id))), 'btn ghost'), abtn('Geri al', async () => { if (!sure('Dönem kapatma geri alınsın mı? İşler/tahsilatlar açık döneme döner, devreden satırlar çöp kutusuna gider.')) return; await undoClosure(c.s, x, live(c.st.jobs).filter((j) => j.carriedFromClosureId === x.id).map((j) => j.id)); reopen(); }, 'btn ghost')) }], closures, 'Kapatılmış dönem yok'),
    };
    bar.replaceChildren(h('div', { class: 'row' }, h('span', { class: t.balance.TRY > 0 ? 'bal-debt' : 'bal-ok' }, `Açık bakiye: ${fmtSums(t.balance, true)}`), btn('🖨️ Ekstre', () => printNode(statementNode(c, dr)), 'btn ghost'), btn('Dönemi kapat', () => closeModal(c, dr, reopen), 'btn ghost')),
      h('div', { class: 'tabs' }, tabs.map(([id, l]) => h('button', { type: 'button', class: `tab ${id === tab ? 'active' : ''}`, on: { click: () => draw(id) } }, l))));
    body.replaceChildren(bar, views[tab]() as Node);
  };
  draw(tab);
}

/* ---------------- Hekim / Teknisyen ---------------- */
function pricesModal(c: Ctx, dr: Rec): void {
  const list: R[] = arr(dr.prices).map((p: R) => ({ ...p })); const box = h('div'); const nm = input('pname', 'text', '', { placeholder: 'İş adı (Kron, Köprü…)', maxlength: 100 }); const pv = input('pval', 'number', '', { min: 0, step: '0.01', placeholder: 'Fiyat' }); const pc = select('pcur', curOptions, 'TRY');
  const save = async (): Promise<void> => { await setDoctorPrices(c.s, String(dr.id), list); };
  const draw = (): void => box.replaceChildren(table([{ head: 'İş', cell: (p: R) => p.name }, { head: 'Fiyat', cell: (p: R) => money(toCents(p.price), curOf(p)) },
    { head: '', cell: (p: R) => { const i = list.indexOf(p); return h('span', null, abtn('▲', async () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; await save(); draw(); } }, 'btn ghost'), abtn('▼', async () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; await save(); draw(); } }, 'btn ghost'), abtn('Sil', async () => { if (sure(`"${p.name}" fiyatı silinsin mi?`)) { list.splice(i, 1); await save(); draw(); } }, 'btn ghost')); } }], list, 'Fiyat listesi boş'));
  draw();
  modal(`${dr.name}: fiyat listesi`, h('div', null, h('div', { class: 'row' }, nm, pv, pc, abtn('Ekle', async () => { const name = nm.value.trim(); const price = Number(pv.value); if (!name || !(price >= 0) || pv.value === '') throw new Error('İş adı ve geçerli fiyat girin.'); list.push({ id: newId(), name, price: fromCents(toCents(price)), currency: pc.value }); await save(); nm.value = ''; pv.value = ''; draw(); }, 'btn primary')), box));
}

function personPage(c: Ctx, kind: 'doctors' | 'technicians'): HTMLElement {
  const isDr = kind === 'doctors'; const f = (c.ps[kind] ??= { q: '' }) as { q: string }; const box = h('div');
  const edit = (r?: Rec) => {
    const form = h('div', null, field('Ad', input('name', 'text', r?.name ?? '', { maxlength: 200 })), field('Telefon', input('phone', 'tel', r?.phone ?? '', { maxlength: 40 })), field('E-posta (mail filtresi/hesap için)', input('email', 'email', r?.email ?? '', { maxlength: 200 })), field(isDr ? 'Klinik / not' : 'Uzmanlık', input('spec', 'text', r?.spec ?? r?.clinic ?? '', { maxlength: 200 })),
      isDr ? field('Otomatik teknisyen (siparişler onaysız bu teknisyene düşer)', select('autoTechId', [['', '— Yok (onaya düşer) —'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], String(r?.autoTechId ?? ''))) : field('Tür', select('type', [['ic', 'İç teknisyen'], ['dis', 'Dış teknisyen']], String(r?.type ?? 'ic'))));
    const m = modal(r ? 'Düzenle' : 'Yeni kayıt', form, abtn('Kaydet', async () => {
      const name = val(form, 'name'); if (!name) throw new Error('Ad gerekli.'); const email = val(form, 'email').toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-posta geçersiz.');
      const id = r?.id ?? newId(); await put(c.s, kind, id, { id, name, phone: val(form, 'phone'), email, spec: val(form, 'spec'), ...(isDr ? { autoTechId: val(form, 'autoTechId') || null, ...(r ? {} : { prices: [] }) } : { type: val(form, 'type') }) }, !r); m.close();
    }, 'btn primary', 'Kaydedildi'));
  };
  const account = (r: Rec) => {
    const form = h('div', null, field('E-posta', input('email', 'email', r.email ?? '')));
    const m = modal(`${r.name}: hesap oluştur`, form, abtn('Oluştur', async () => {
      const email = val(form, 'email'); const res = await callAdmin<{ uid: string; email: string; tempPassword: string }>('adminCreateUser', { email, role: isDr ? 'doctor' : 'tech', ...(isDr ? { doctorId: String(r.id) } : { techId: String(r.id) }), displayName: r.name });
      m.close(); showTemp(res.email, res.tempPassword); // önce şifre gösterilir; kayıt bağlama başarısız olsa bile şifre kaybolmaz
      try { await patch(c.s, kind, r.id, { email, authUid: res.uid }); } catch (e) { toast(`Hesap açıldı ama kayda bağlanamadı: ${(e as Error).message}`, 'err'); }
    }, 'btn primary'));
  };
  const resetPw = (r: Rec) => abtn('Şifre sıfırla', async () => { if (!sure('Şifre sıfırlansın mı?')) return; const res = await callAdmin<{ tempPassword: string }>('adminResetPassword', { uid: r.authUid }); showTemp(String(r.email), res.tempPassword); }, 'btn ghost');
  const remove = (r: Rec) => abtn('Sil', async () => {
    const openJobs = live(c.st.jobs).filter((j) => j.status !== 'Tamamlandı' && (isDr ? String(j.doctorId || j.drId) === String(r.id) : techIdsOf(j).includes(String(r.id)))).length;
    if (openJobs) throw new Error(`${openJobs} açık işi var; önce işleri tamamlayın/devredin.`);
    if (isDr) { const t = doctorTotals(live(c.st.jobs), live(c.st.payments), String(r.id)); if (CURRENCIES.some((cur) => t.balance[cur] !== 0) && !sure(`Hekimin açık bakiyesi var (${fmtSums(t.balance)}). Yine de silinenlere taşınsın mı?`)) return; }
    if (!sure('Silinenlere taşınsın mı? (Geri alınabilir. Bağlı giriş hesabı da devre dışı bırakılır ve oturumları kapatılır.)')) return;
    await softDelete(c.s, kind, r.id);
    if (r.authUid) {
      try { await callAdmin('adminDisableUser', { uid: r.authUid, disabled: true }); toast('Giriş hesabı devre dışı bırakıldı'); } catch (e) { toast(`Kayıt silindi ama giriş hesabı devre dışı bırakılamadı: ${(e as Error).message}`, 'err'); }
    }
  }, 'btn ghost');
  const techDetail = (r: Rec) => {
    const jobs = live(c.st.jobs).filter((j) => techIdsOf(j).includes(String(r.id))); const pays = live(c.st.payments).filter((p) => String(p.collectorId) === String(r.id)); const exps = live(c.st.expenses).filter((e) => String(e.spenderId) === String(r.id));
    const ciro = sumsOf(jobs.filter((j) => j.status === 'Tamamlandı'), jobCents);
    modal(`${r.name} — özet`, h('div', null, h('p', null, `Aktif iş: ${jobs.filter((j) => j.status !== 'Tamamlandı').length} | Tamamlanan: ${jobs.filter((j) => j.status === 'Tamamlandı').length} | Ciro: ${fmtSums(ciro, true)}`), h('p', null, `Yaptığı tahsilat: ${fmtSums(sumsOf(pays, payCents), true)} (${pays.length}) | Harcama: ${fmtSums(sumsOf(exps, (e) => toCents(e.amount)), true)} (${exps.length})`),
      table([{ head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Durum', cell: (j: Rec) => j.status }], jobs.filter((j) => j.status !== 'Tamamlandı'), 'Aktif iş yok')));
  };
  const cols = (): { head: string; cell: (r: Rec) => Child }[] => [{ head: 'Ad', cell: (r) => r.name }, { head: 'Telefon', cell: (r) => r.phone }, { head: 'E-posta', cell: (r) => r.email }, { head: 'Hesap', cell: (r) => (r.authUid ? badge('Var', 'ok') : badge('Yok')) },
    ...(isDr ? [{ head: 'Açık bakiye', cell: (r: Rec) => { const t = doctorTotals(live(c.st.jobs), live(c.st.payments), String(r.id)); return h('span', { class: CURRENCIES.some((cur) => t.balance[cur] > 0) ? 'bal-debt' : 'bal-ok' }, fmtSums(t.balance, true)); } }, { head: 'Oto. teknisyen', cell: (r: Rec) => techOf(c.st, r.autoTechId)?.name ?? '—' }]
      : [{ head: 'Aktif iş', cell: (r: Rec) => live(c.st.jobs).filter((j) => j.status !== 'Tamamlandı' && techIdsOf(j).includes(String(r.id))).length }]),
    { head: '', cell: (r) => h('span', null, btn('Düzenle', () => edit(r), 'btn ghost'), isDr ? btn('Hesap/Kasa', () => doctorDetail(c, String(r.id)), 'btn ghost') : btn('Özet', () => techDetail(r), 'btn ghost'), isDr ? btn('Fiyat listesi', () => pricesModal(c, r), 'btn ghost') : null, r.authUid ? resetPw(r) : btn('Hesap aç', () => account(r)), isDr ? btn('Ekstre', () => printNode(statementNode(c, r)), 'btn ghost') : null, remove(r)) }];
  const draw = (): void => box.replaceChildren(table(cols(), live(c.st[kind]).filter((r) => !f.q || [r.name, r.phone, r.email].some((x) => trLower(x).includes(f.q))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr')), 'Kayıt yok'));
  draw();
  return h('div', null, h('h2', null, isDr ? 'Hekimler' : 'Teknisyenler'), h('div', { class: 'row' }, btn('+ Yeni', () => edit(), 'btn primary'), searchInput('Ara', (q) => { f.q = q; draw(); }, f.q)), box);
}
export const doctors = (c: Ctx): HTMLElement => personPage(c, 'doctors');
export const techs = (c: Ctx): HTMLElement => personPage(c, 'technicians');

/* ---------------- Giderler ---------------- */
export const EXPENSE_TYPES: Record<string, string[]> = {
  Sabit: ['Kira', 'Personel Maaşı', 'SGK Primi', 'Elektrik', 'Su', 'Doğalgaz', 'İnternet / Telefon', 'Vergi', 'Muhasebe / Mali Müşavir', 'Sigorta', 'Aidat', 'Kredi Taksiti', 'Diğer Sabit'],
  Hizmet: ['Malzeme / Tedarik', 'Cihaz Tamiri', 'Teknik Servis', 'Yazılım Aboneliği', 'Temizlik / Bakım', 'Kargo / Nakliye', 'Eğitim / Kurs', 'Reklam / Tanıtım', 'Ofis Malzemesi', 'Akaryakıt', 'Yemek', 'Diğer Hizmet'],
};
export function expenses(c: Ctx): HTMLElement {
  const f = (c.ps.expenses ??= { q: '', cat: '', month: '' }) as { q: string; cat: string; month: string }; const box = h('div');
  const edit = (r?: Rec) => {
    const cat = select('category', Object.keys(EXPENSE_TYPES).map((k): [string, string] => [k, k]), String(r?.category ?? 'Sabit')); const sub = select('subcategory', [], '');
    const fillSub = () => { sub.replaceChildren(...EXPENSE_TYPES[cat.value].map((x) => h('option', { value: x }, x))); sub.value = r?.subcategory && EXPENSE_TYPES[cat.value].includes(r.subcategory) ? r.subcategory : EXPENSE_TYPES[cat.value][0]; }; cat.addEventListener('change', fillSub); fillSub();
    const form = h('div', null, field('Tarih', input('date', 'date', r?.date ?? todayLocal())), field('Kategori', cat), field('Alt kategori', sub), field('Başlık', input('title', 'text', r?.title ?? '', { maxlength: 200 })), field('Tutar', input('amount', 'number', r?.amount ?? '', { min: 0.01, step: '0.01' })), field('Para birimi', select('currency', curOptions, curOf(r))),
      field('Ödeme', select('payment', ['Nakit', 'Kart', 'Havale/EFT', 'Çek'].map((x): [string, string] => [x, x]), String(r?.payment ?? 'Nakit'))), field('Satıcı', input('vendor', 'text', r?.vendor ?? '', { maxlength: 200 })), field('Harcayan teknisyen (isteğe bağlı)', select('spenderId', [['', '—'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], String(r?.spenderId ?? ''))), field('Not', input('note', 'text', r?.note ?? '', { maxlength: 500 })));
    const m = modal(r ? 'Gideri düzenle' : 'Yeni gider', form, abtn('Kaydet', async () => {
      const amount = toCents(val(form, 'amount')); if (amount <= 0) throw new Error('Tutar sıfırdan büyük olmalı.'); if (!val(form, 'title')) throw new Error('Başlık girin.'); if (!isoToLocalDate(val(form, 'date'))) throw new Error('Tarih girin.');
      const id = r?.id ?? newId(); const sp = techOf(c.st, val(form, 'spenderId'));
      await put(c.s, 'expenses', id, { id, date: val(form, 'date'), category: val(form, 'category'), subcategory: val(form, 'subcategory'), title: val(form, 'title'), amount: fromCents(amount), currency: val(form, 'currency'), payment: val(form, 'payment'), vendor: val(form, 'vendor'), note: val(form, 'note'), spenderId: sp?.id ?? null, spenderName: sp?.name ?? '' }, !r); m.close();
    }, 'btn primary', 'Kaydedildi'));
  };
  const rows = (): Rec[] => live(c.st.expenses).filter((e) => (!f.q || [e.title, e.vendor, e.subcategory, e.note].some((x) => trLower(x).includes(f.q))) && (!f.cat || e.category === f.cat) && (!f.month || monthLocal(e.date) === f.month)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cols = [{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.date) }, { head: 'Kategori', cell: (r: Rec) => `${r.category ?? ''}${r.subcategory ? ` / ${r.subcategory}` : ''}` }, { head: 'Başlık', cell: (r: Rec) => r.title }, { head: 'Satıcı', cell: (r: Rec) => r.vendor }, { head: 'Tutar', cell: (r: Rec) => money(toCents(r.amount), curOf(r)) }];
  const draw = (): void => { const rs = rows(); box.replaceChildren(h('p', { class: 'muted' }, `${rs.length} kayıt · toplam ${fmtSums(sumExpenses(rs, () => true), true)}`), table([...cols, { head: '', cell: (r: Rec) => h('span', null, btn('Düzenle', () => edit(r), 'btn ghost'), abtn('Sil', async () => { if (sure('Silinenlere taşınsın mı?')) await softDelete(c.s, 'expenses', r.id); }, 'btn ghost')) }], rs, 'Gider yok')); };
  draw();
  const cs = select('c', [['', 'Tüm kategoriler'], ...Object.keys(EXPENSE_TYPES).map((k): [string, string] => [k, k])], f.cat); cs.addEventListener('change', () => { f.cat = cs.value; draw(); }); const mi = input('m', 'month', f.month); mi.addEventListener('change', () => { f.month = mi.value; draw(); });
  return h('div', null, h('h2', null, 'Giderler'), h('div', { class: 'row' }, btn('+ Yeni', () => edit(), 'btn primary'), searchInput('Ara', (q) => { f.q = q; draw(); }, f.q), cs, mi, btn('🖨️ Yazdır', () => printReport('Giderler', f.month || 'Tümü', cols, rows(), [`Toplam: ${fmtSums(sumExpenses(rows(), () => true), true)}`]), 'btn ghost')), box);
}

/* ---------------- Kasa / Arşiv ---------------- */
export function archive(c: Ctx): HTMLElement {
  const f = (c.ps.archive ??= { q: '' }) as { q: string }; const box = h('div');
  const jobs = live(c.st.jobs); const pays = live(c.st.payments); const all = zeroSums(); const paid = zeroSums(); const unpaid = zeroSums();
  jobs.filter((j) => j.status === 'Tamamlandı').forEach((j) => { all[curOf(j)] += jobCents(j); }); pays.forEach((p) => { paid[curOf(p)] += payCents(p); });
  CURRENCIES.forEach((cur) => { unpaid[cur] = jobs.filter((j) => j.status === 'Tamamlandı' && !j.closureId && curOf(j) === cur).reduce((a, j) => a + jobCents(j), 0) - pays.filter((p) => !p.closureId && curOf(p) === cur).reduce((a, p) => a + payCents(p), 0); });
  const draw = (): void => {
    const bal = live(c.st.doctors).filter((d) => !f.q || trLower(d.name).includes(f.q)).map((d) => ({ d, t: doctorTotals(jobs, pays, String(d.id)) }));
    box.replaceChildren(table([{ head: 'Hekim', cell: (r: { d: Rec }) => h('button', { type: 'button', class: 'btn ghost', on: { click: () => doctorDetail(c, String(r.d.id)) } }, String(r.d.name)) }, { head: 'Açık dönem iş', cell: (r: { t: { charged: Sums } }) => fmtSums(r.t.charged, true) }, { head: 'Tahsilat', cell: (r: { t: { paid: Sums } }) => fmtSums(r.t.paid, true) },
      { head: 'Kalan bakiye', cell: (r: { t: { balance: Sums } }) => h('span', { class: CURRENCIES.some((cur) => r.t.balance[cur] > 0) ? 'bal-debt' : 'bal-ok' }, fmtSums(r.t.balance, true)) }, { head: '', cell: (r: { d: Rec }) => h('span', null, btn('Tahsilat', () => paymentModal(c, undefined, String(r.d.id), c.rerender), 'btn ghost'), btn('Dönemi kapat', () => closeModal(c, r.d, c.rerender), 'btn ghost')) }], bal, 'Hekim yok'));
  };
  draw();
  const recent = [...pays].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30);
  return h('div', null, h('h2', null, 'Kasa / Arşiv'), h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('small', null, 'Toplam tahsilat'), h('b', null, fmtSums(paid, true))), h('div', { class: 'stat' }, h('small', null, 'Bekleyen (açık dönem)'), h('b', null, fmtSums(unpaid, true))), h('div', { class: 'stat' }, h('small', null, 'Toplam tamamlanan iş'), h('b', null, fmtSums(all, true)))),
    h('div', { class: 'row' }, searchInput('Hekim ara', (q) => { f.q = q; draw(); }, f.q), btn('+ Tahsilat', () => paymentModal(c, undefined, undefined, c.rerender), 'btn primary'),
      btn('🖨️ Bakiye listesi', () => printReport('Hekim Bakiyeleri', todayLocal(), [{ head: 'Hekim', cell: (d: Rec) => d.name }, { head: 'Bakiye', cell: (d: Rec) => fmtSums(doctorTotals(jobs, pays, String(d.id)).balance, true) }], live(c.st.doctors), [`Toplam bekleyen: ${fmtSums(unpaid, true)}`]), 'btn ghost')),
    box, h('h3', null, 'Son tahsilatlar'), table([{ head: 'Tarih', cell: (p: Rec) => fmtDate(p.date) }, { head: 'Hekim', cell: (p: Rec) => p.drName }, { head: 'Tutar', cell: (p: Rec) => money(payCents(p), curOf(p)) }, { head: 'Not', cell: (p: Rec) => p.note }, { head: '', cell: (p: Rec) => btn('Düzenle', () => paymentModal(c, p, undefined, c.rerender), 'btn ghost') }], recent, 'Tahsilat yok'));
}

/* ---------------- Aylık Rapor ---------------- */
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export function monthly(c: Ctx): HTMLElement {
  const f = (c.ps.monthly ??= { year: todayLocal().slice(0, 4), cur: 'TRY' }) as { year: string; cur: Cur };
  const years = yearsOf(c.st.jobs, c.st.payments, c.st.expenses, c.st.sales, todayLocal().slice(0, 4)); const rows = monthlyData(f.year, f.cur, c.st.jobs, c.st.sales, c.st.expenses, c.st.payments);
  const tot = rows.reduce((a, r) => ({ lab: a.lab + r.labIncome, sales: a.sales + r.salesIncome, inc: a.inc + r.income, exp: a.exp + r.totalExp, net: a.net + r.net, col: a.col + r.collected, n: a.n + r.jobCount }), { lab: 0, sales: 0, inc: 0, exp: 0, net: 0, col: 0, n: 0 });
  const m = (v: number) => money(v, f.cur);
  const cols = [{ head: 'Ay', cell: (r: { month: number }) => MONTHS[r.month] }, { head: 'İş sayısı', cell: (r: { jobCount: number }) => r.jobCount }, { head: 'İş geliri', cell: (r: { labIncome: number }) => m(r.labIncome) }, { head: 'Satış geliri', cell: (r: { salesIncome: number }) => m(r.salesIncome) }, { head: 'Toplam gelir', cell: (r: { income: number }) => m(r.income) },
    { head: 'Sabit gider', cell: (r: { fixedExp: number }) => m(r.fixedExp) }, { head: 'Hizmet gideri', cell: (r: { serviceExp: number }) => m(r.serviceExp) }, { head: 'Net (gelir − gider)', cell: (r: { net: number }) => h('b', { class: r.net < 0 ? 'bal-debt' : '' }, m(r.net)) }, { head: 'Tahsilat (bilgi)', cell: (r: { collected: number }) => m(r.collected) }];
  const ys = select('y', years.map((y): [string, string] => [y, y]), f.year); ys.addEventListener('change', () => { f.year = ys.value; c.rerender(); }); const cs = select('c', CURRENCIES.map((x): [string, string] => [x, x]), f.cur); cs.addEventListener('change', () => { f.cur = cs.value as Cur; c.rerender(); });
  return h('div', null, h('h2', null, 'Aylık Rapor'), h('div', { class: 'row' }, field('Yıl', ys), field('Para birimi', cs), btn('🖨️ Yazdır', () => printReport(`Aylık Rapor ${f.year} (${f.cur})`, 'Gelir = tamamlanan işler (tamamlanma ayına göre) + satışlar', cols, rows, [`Toplam gelir: ${m(tot.inc)} | Gider: ${m(tot.exp)} | Net: ${m(tot.net)} | Tahsilat: ${m(tot.col)}`]), 'btn ghost')),
    h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('small', null, 'Toplam gelir'), h('b', null, m(tot.inc))), h('div', { class: 'stat' }, h('small', null, 'Gider'), h('b', null, m(tot.exp))), h('div', { class: 'stat' }, h('small', null, 'Net'), h('b', null, m(tot.net))), h('div', { class: 'stat' }, h('small', null, 'Tahsilat (bilgi)'), h('b', null, m(tot.col))), h('div', { class: 'stat' }, h('small', null, 'Tamamlanan iş'), h('b', null, tot.n))),
    table(cols, rows), h('p', { class: 'muted' }, 'Devreden bakiye satırları ve silinmiş kayıtlar rapora girmez. Aylar İstanbul saatine göre belirlenir.'));
}

/* ---------------- Silinenler ---------------- */
const TRASH: [string, string][] = [['jobs', 'İş'], ['pendingJobs', 'Onay bekleyen'], ['doctors', 'Hekim'], ['technicians', 'Teknisyen'], ['payments', 'Tahsilat'], ['expenses', 'Gider'], ['sales', 'Satış'], ['doctorSubmissions', 'Hekim gönderimi']];
export function trash(c: Ctx): HTMLElement {
  const rows = TRASH.flatMap(([n, label]) => (c.st[n as (typeof COLLECTIONS)[number]] as Rec[]).filter((r) => r.deleted).map((r) => ({ n, label, r })));
  return h('div', null, h('h2', null, 'Silinenler'), h('p', { class: 'muted' }, 'Kayıtlar fiziksel olarak silinmez; buradan geri alınabilir.'), table([
    { head: 'Tür', cell: (x: { label: string }) => x.label }, { head: 'Kayıt', cell: (x: { r: Rec }) => String(x.r.patient ?? x.r.name ?? x.r.title ?? x.r.customer ?? x.r.id) }, { head: 'Silinme', cell: (x: { r: Rec }) => fmtDate(x.r.deletedAt) },
    { head: '', cell: (x: { n: string; r: Rec }) => abtn('Geri al', async () => {
      await restore(c.s, x.n, x.r.id);
      // Hekim/teknisyen geri alınınca (silerken kapatılan) giriş hesabı yeniden etkinleştirilir.
      if ((x.n === 'doctors' || x.n === 'technicians') && x.r.authUid) {
        try { await callAdmin('adminDisableUser', { uid: x.r.authUid, disabled: false }); } catch (e) { toast(`Kayıt geri alındı ama giriş hesabı etkinleştirilemedi: ${(e as Error).message}`, 'err'); }
      }
    }, 'btn', 'Geri alındı') }], rows.sort((a, b) => String(b.r.deletedAt).localeCompare(String(a.r.deletedAt))), 'Silinen kayıt yok'));
}

/* ---------------- Ayarlar ---------------- */
export function settings(c: Ctx): HTMLElement {
  const main = c.st.settings.find((x) => x.id === 'main'); const f: HTMLElement = h('div', { class: 'card' }, field('Laboratuvar adı', input('labName', 'text', main?.labName ?? '', { maxlength: 200 })), field('Telefon', input('phone', 'tel', main?.phone ?? '', { maxlength: 40 })), field('Adres', textarea('address', String(main?.address ?? ''))),
    abtn('Kaydet', () => put(c.s, 'settings', 'main', { id: 'main', labName: val(f, 'labName'), phone: val(f, 'phone'), address: val(f, 'address') }, !main), 'btn primary', 'Kaydedildi'));
  const backup = abtn('Veriyi JSON olarak indir', async () => {
    if (!sure('Dosya HASTA VE FİNANS verisi içerir. Güvenli bir yerde saklayacağınıza emin misiniz?')) return;
    const data: Record<string, Rec[]> = {}; for (const k of COLLECTIONS) data[k] = (c.st as State)[k]; saveBlob(new Blob([JSON.stringify({ lab: c.s.lab, exportedAt: nowIso(), data }, null, 1)], { type: 'application/json' }), `digicad-${c.s.lab}-${todayLocal()}.json`);
  }, 'btn ghost');
  const auditBox = h('div');
  const showAudit = abtn('Son denetim kayıtlarını göster', async () => {
    const rows = await recentAudit(c.s, 50);
    auditBox.replaceChildren(table([
      { head: 'Zaman', cell: (r: Rec) => (r.at?.toDate ? r.at.toDate().toLocaleString('tr-TR') : '') }, { head: 'Kayıt', cell: (r: Rec) => (r.coll ? `${r.coll}/${r.id}` : String(r.action ?? '')) },
      { head: 'İşlem', cell: (r: Rec) => `${r.kind ?? r.action ?? ''}${r.status ? ` (${r.status})` : ''}` }, { head: 'Yapan (beyan)', cell: (r: Rec) => String(r.actor ?? '') },
      { head: 'Not', cell: (r: Rec) => [r.oversize ? '⚠️ belge çok büyük (kayıt eksik olabilir)' : '', r.beforeGz || r.afterGz ? 'sıkıştırılmış kayıt' : '', r.actor === 'system' ? 'sistem' : ''].filter(Boolean).join(' · ') },
    ], rows, 'Denetim kaydı yok'));
  }, 'btn ghost');
  return h('div', null, h('h2', null, 'Ayarlar'), f, h('h3', null, 'Çalışma alanı'), h('p', null, `Bu hesap yalnızca "${c.s.lab}" çalışma alanına bağlıdır (hesabın lab yetkisi). Başka bir alan (ör. Primer Teknoloji) için o alana ait ayrı yönetici hesabıyla giriş yapılır.`),
    h('h3', null, 'Yedek'), h('p', { class: 'muted' }, 'Sunucu tarafı günlük yedek ayrıca çalışır; bu düğme yalnızca ekranda yüklü verinin anlık kopyasını indirir.'), backup, h('h3', null, 'Denetim'), h('p', { class: 'muted' }, 'Kayıtlar sunucuda tutulur (istemci yazamaz); "yapan" istemci beyanıdır, kesin kimlik için Cloud Audit Logs.'), showAudit, auditBox, h('h3', null, 'Güvenlik'), h('p', null, 'Hesap/rol yönetimi Hekimler ve Teknisyenler sayfalarındadır. Eski 4 haneli PIN sistemi kaldırılmıştır.'));
}
