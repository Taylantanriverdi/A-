import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
import { h, type Child } from '../lib/dom';
import { fmtDate, fmtMoney, monthOf, todayISO } from '../lib/format';
import { functions, db } from '../lib/firebase';
import { colPath, newId, patch, put, restore, softDelete, type Rec } from '../lib/store';
import { badge, btn, field, guard, input, modal, printNode, select, table, textarea, toast, val } from '../lib/ui';
import { balanceOf, doctorOf, jobTotal, live, techOf } from './state';
import { upload } from '../lib/files';
import type { Ctx } from './pages1';

const callAdmin = <T>(name: string, data: unknown) => httpsCallable<unknown, T>(functions, name)(data).then((r) => r.data);

function showTemp(email: string, pw: string): void {
  modal('Geçici şifre (yalnızca şimdi gösterilir)', h('div', null, h('p', null, `Hesap: ${email}`), h('p', null, h('code', null, pw)), h('p', { class: 'muted' }, 'Bu şifreyi güvenli bir kanaldan iletin. İlk girişte değiştirilmesi zorunludur. Sistem şifreyi saklamaz.')));
}

export function chat(c: Ctx, state: { thread: string | null }): HTMLElement {
  const threads: { id: string; name: string }[] = [...live(c.st.doctors).map((d) => ({ id: `dr_${d.id}`, name: `Hekim: ${d.name}` })), ...live(c.st.technicians).map((t) => ({ id: `tech_${t.id}`, name: `Teknisyen: ${t.name}` }))];
  const box = h('div', { class: 'chat-msgs' }); const side = h('div', { class: 'chat-list' }); const right = h('div', { class: 'chat-conv' });
  const draw = () => {
    side.replaceChildren(...threads.map((t) => h('button', { class: `btn ${state.thread === t.id ? 'primary' : 'ghost'}`, on: { click: () => { state.thread = t.id; c.rerender(); } } }, t.name)));
    if (!state.thread) { right.replaceChildren(h('p', { class: 'muted' }, 'Bir konuşma seçin')); return; }
    const tid = state.thread; const inp = input('text', 'text', '', { maxlength: 4000, placeholder: 'Mesaj…' });
    const send = () => void guard(async () => { const t = inp.value.trim(); if (!t) return; await addDoc(collection(db, `${colPath(c.s.lab, 'threads')}/${tid}/messages`), { text: t, senderUid: c.s.user.uid, senderRole: 'admin', senderName: 'Laboratuvar', timestamp: new Date().toISOString() }); await setDoc(doc(db, colPath(c.s.lab, 'threads'), tid), { updatedAt: new Date().toISOString() }, { merge: true }); inp.value = ''; });
    right.replaceChildren(box, h('div', { class: 'row' }, inp, btn('Gönder', send, 'btn primary')));
    void import('firebase/firestore').then(({ onSnapshot, query, orderBy }) => { _off?.(); _off = onSnapshot(query(collection(db, `${colPath(c.s.lab, 'threads')}/${tid}/messages`), orderBy('timestamp')), (sn) => { box.replaceChildren(...sn.docs.filter((d) => !d.data().deletedAt).map((d) => { const m = d.data(); return h('div', { class: `msg ${m.senderRole === 'admin' ? 'me' : ''}` }, h('small', null, `${m.senderName ?? m.senderRole} · ${fmtDate(m.timestamp)}`), h('div', null, String(m.text ?? '')), m.fileName ? h('small', null, `📎 ${m.fileName}`) : null); })); }); });
  };
  draw();
  return h('div', null, h('h2', null, 'Mesajlar'), h('div', { class: 'chat' }, side, right));
}
let _off: (() => void) | undefined;

function personPage(c: Ctx, kind: 'doctors' | 'technicians'): HTMLElement {
  const isDr = kind === 'doctors'; const rows = live(c.st[kind]);
  const edit = (r?: Rec) => {
    const f = h('div', null, field('Ad', input('name', 'text', r?.name ?? '')), field('Telefon', input('phone', 'tel', r?.phone ?? '')), field(isDr ? 'Klinik / not' : 'Uzmanlık', input('spec', 'text', r?.spec ?? r?.clinic ?? '')),
      isDr ? field('Otomatik teknisyen', select('autoTechId', [['', '— Yok (onaya düşer) —'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])], String(r?.autoTechId ?? ''))) : field('Tür', select('type', [['ic', 'İç teknisyen'], ['dis', 'Dış teknisyen']], String(r?.type ?? 'ic'))));
    const m = modal(r ? 'Düzenle' : 'Yeni kayıt', f, btn('Kaydet', () => void guard(async () => {
      const name = val(f, 'name'); if (!name) throw new Error('Ad gerekli.'); const id = r?.id ?? newId();
      await put(c.s, kind, id, { id, name, phone: val(f, 'phone'), spec: val(f, 'spec'), ...(isDr ? { autoTechId: val(f, 'autoTechId') || null } : { type: val(f, 'type') }) }, !r); m.close();
    }, 'Kaydedildi'), 'btn primary'));
  };
  const account = (r: Rec) => {
    const f = h('div', null, field('E-posta', input('email', 'email', r.email ?? '')));
    const m = modal(`${r.name}: hesap oluştur`, f, btn('Oluştur', () => void guard(async () => {
      const email = val(f, 'email'); const res = await callAdmin<{ uid: string; email: string; tempPassword: string }>('adminCreateUser', { email, role: isDr ? 'doctor' : 'tech', ...(isDr ? { doctorId: String(r.id) } : { techId: String(r.id) }), displayName: r.name });
      await patch(c.s, kind, r.id, { email, authUid: res.uid }); m.close(); showTemp(res.email, res.tempPassword);
    }), 'btn primary'));
  };
  const resetPw = (r: Rec) => void guard(async () => { if (!window.confirm('Şifre sıfırlansın mı?')) return; const res = await callAdmin<{ tempPassword: string }>('adminResetPassword', { uid: r.authUid }); showTemp(String(r.email), res.tempPassword); });
  const statement = (r: Rec) => {
    const b = balanceOf(c.st, String(r.id)); const js = live(c.st.jobs).filter((j) => String(j.doctorId ?? j.drId) === String(r.id) && j.status === 'Tamamlandı'); const ps = live(c.st.payments).filter((p) => String(p.doctorId ?? p.drId) === String(r.id));
    printNode(h('div', null, h('h2', null, `Hesap Ekstresi — ${r.name}`), table([{ head: 'Tarih', cell: (j: Rec) => fmtDate(j.completedAt ?? j.dateout) }, { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Tutar', cell: (j: Rec) => fmtMoney(jobTotal(j)) }], js), h('h3', null, 'Tahsilatlar'), table([{ head: 'Tarih', cell: (p: Rec) => fmtDate(p.date) }, { head: 'Tutar', cell: (p: Rec) => fmtMoney(p.amount) }], ps), h('p', null, h('b', null, `Bakiye: ${fmtMoney(b.balance)}`))));
  };
  return h('div', null, h('h2', null, isDr ? 'Hekimler' : 'Teknisyenler'), btn('+ Yeni', () => edit(), 'btn primary'), table([
    { head: 'Ad', cell: (r: Rec) => r.name }, { head: 'Telefon', cell: (r: Rec) => r.phone }, { head: 'Hesap', cell: (r: Rec) => r.authUid ? badge('Var', 'ok') : badge('Yok') },
    ...(isDr ? [{ head: 'Bakiye', cell: (r: Rec) => fmtMoney(balanceOf(c.st, String(r.id)).balance) }, { head: 'Oto. teknisyen', cell: (r: Rec) => techOf(c.st, r.autoTechId)?.name ?? '—' }] : []),
    { head: '', cell: (r: Rec) => h('span', null, btn('Düzenle', () => edit(r), 'btn ghost'), r.authUid ? btn('Şifre sıfırla', () => resetPw(r), 'btn ghost') : btn('Hesap aç', () => account(r), 'btn'), isDr ? btn('Ekstre', () => statement(r), 'btn ghost') : null, btn('Sil', () => { if (window.confirm('Silinenlere taşınsın mı?')) void guard(() => softDelete(c.s, kind, r.id)); }, 'btn ghost')) },
  ], rows));
}
export const doctors = (c: Ctx): HTMLElement => personPage(c, 'doctors');
export const techs = (c: Ctx): HTMLElement => personPage(c, 'technicians');

function simpleCrud(c: Ctx, coll: 'expenses' | 'sales' | 'payments', title: string, fields: { k: string; label: string; type?: string; opts?: [string, string][] }[], cols: { head: string; cell: (r: Rec) => Child }[]): HTMLElement {
  const edit = (r?: Rec) => {
    const f = h('div', null, fields.map((x) => field(x.label, x.opts ? select(x.k, x.opts, String(r?.[x.k] ?? '')) : input(x.k, x.type ?? 'text', r?.[x.k] ?? (x.type === 'date' ? todayISO() : '')))));
    const m = modal(r ? 'Düzenle' : 'Yeni', f, btn('Kaydet', () => void guard(async () => {
      const id = r?.id ?? newId(); const data: Record<string, unknown> = { id }; for (const x of fields) data[x.k] = x.type === 'number' ? Number(val(f, x.k)) || 0 : val(f, x.k);
      if (coll === 'payments') { const dr = doctorOf(c.st, data.doctorId); if (!dr) throw new Error('Hekim seçin.'); data.drId = dr.id; data.drName = dr.name; data.currency = 'TRY'; }
      await put(c.s, coll, id, data, !r); m.close();
    }, 'Kaydedildi'), 'btn primary'));
  };
  const rows = live(c.st[coll]).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return h('div', null, h('h2', null, title), btn('+ Yeni', () => edit(), 'btn primary'), table([...cols, { head: '', cell: (r: Rec) => h('span', null, btn('Düzenle', () => edit(r), 'btn ghost'), btn('Sil', () => { if (window.confirm('Silinenlere taşınsın mı?')) void guard(() => softDelete(c.s, coll, r.id)); }, 'btn ghost')) }], rows));
}
export const expenses = (c: Ctx): HTMLElement => simpleCrud(c, 'expenses', 'Giderler', [{ k: 'date', label: 'Tarih', type: 'date' }, { k: 'category', label: 'Kategori' }, { k: 'title', label: 'Başlık' }, { k: 'amount', label: 'Tutar', type: 'number' }, { k: 'vendor', label: 'Satıcı' }, { k: 'note', label: 'Not' }],
  [{ head: 'Tarih', cell: (r) => fmtDate(r.date) }, { head: 'Kategori', cell: (r) => r.category }, { head: 'Başlık', cell: (r) => r.title }, { head: 'Tutar', cell: (r) => fmtMoney(r.amount, r.currency) }]);
export const sales = (c: Ctx): HTMLElement => simpleCrud(c, 'sales', 'Satışlar', [{ k: 'date', label: 'Tarih', type: 'date' }, { k: 'title', label: 'Ürün/Açıklama' }, { k: 'amount', label: 'Tutar', type: 'number' }, { k: 'note', label: 'Not' }],
  [{ head: 'Tarih', cell: (r) => fmtDate(r.date) }, { head: 'Açıklama', cell: (r) => r.title }, { head: 'Tutar', cell: (r) => fmtMoney(r.amount, r.currency) }]);

export function archive(c: Ctx): HTMLElement {
  const drOpts: [string, string][] = [['', '— Hekim —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])];
  const pay = simpleCrud(c, 'payments', 'Tahsilatlar', [{ k: 'doctorId', label: 'Hekim', opts: drOpts }, { k: 'date', label: 'Tarih', type: 'date' }, { k: 'amount', label: 'Tutar', type: 'number' }, { k: 'note', label: 'Not' }],
    [{ head: 'Tarih', cell: (r) => fmtDate(r.date) }, { head: 'Hekim', cell: (r) => r.drName }, { head: 'Tutar', cell: (r) => fmtMoney(r.amount, r.currency) }, { head: 'Not', cell: (r) => r.note }]);
  const closures = live(c.st.statementClosures);
  const bal = live(c.st.doctors).map((d) => ({ d, ...balanceOf(c.st, String(d.id)) }));
  return h('div', null, h('h2', null, 'Kasa / Arşiv'), table([{ head: 'Hekim', cell: (r: { d: Rec }) => r.d.name }, { head: 'Tamamlanan', cell: (r: { charged: number }) => fmtMoney(r.charged) }, { head: 'Tahsilat', cell: (r: { paid: number }) => fmtMoney(r.paid) }, { head: 'Bakiye', cell: (r: { balance: number }) => fmtMoney(r.balance) },
    { head: 'Ekstre kapat', cell: (r: { d: Rec; balance: number }) => btn('Dönemi kapat', () => void guard(() => put(c.s, 'statementClosures', newId(), { doctorId: String(r.d.id), drId: r.d.id, closedAt: new Date().toISOString(), balance: r.balance }, true), 'Dönem kapatıldı'), 'btn ghost') }], bal), pay,
  h('h3', null, 'Kapatılan dönemler'), table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.closedAt) }, { head: 'Hekim', cell: (r: Rec) => doctorOf(c.st, r.doctorId ?? r.drId)?.name }, { head: 'Bakiye', cell: (r: Rec) => fmtMoney(r.balance) }], closures));
}

export function monthly(c: Ctx, state: { month: string }): HTMLElement {
  const m = state.month; const jobs = live(c.st.jobs).filter((j) => j.status === 'Tamamlandı' && monthOf(j.completedAt ?? j.dateout) === m);
  const ciro = jobs.reduce((a, j) => a + jobTotal(j), 0); const tah = live(c.st.payments).filter((p) => monthOf(p.date) === m).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const gid = live(c.st.expenses).filter((e) => monthOf(e.date) === m).reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const mi = input('m', 'month', m); mi.addEventListener('change', () => { state.month = mi.value; c.rerender(); });
  return h('div', null, h('h2', null, 'Aylık Rapor'), field('Ay', mi), h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('small', null, 'Ciro (tamamlanan)'), h('b', null, fmtMoney(ciro))), h('div', { class: 'stat' }, h('small', null, 'Tahsilat'), h('b', null, fmtMoney(tah))),
    h('div', { class: 'stat' }, h('small', null, 'Gider'), h('b', null, fmtMoney(gid))), h('div', { class: 'stat' }, h('small', null, 'Net (tahsilat − gider)'), h('b', null, fmtMoney(tah - gid))), h('div', { class: 'stat' }, h('small', null, 'Tamamlanan iş'), h('b', null, jobs.length))));
}

export function trash(c: Ctx): HTMLElement {
  const names = ['jobs', 'pendingJobs', 'doctors', 'technicians', 'payments', 'expenses', 'sales', 'doctorSubmissions'] as const;
  const rows = names.flatMap((n) => c.st[n].filter((r) => r.deleted).map((r) => ({ n, r })));
  return h('div', null, h('h2', null, 'Silinenler'), h('p', { class: 'muted' }, 'Kayıtlar fiziksel olarak silinmez; buradan geri alınabilir.'), table([
    { head: 'Tür', cell: (x: { n: string }) => x.n }, { head: 'Kayıt', cell: (x: { r: Rec }) => String(x.r.patient ?? x.r.name ?? x.r.title ?? x.r.id) }, { head: 'Silinme', cell: (x: { r: Rec }) => fmtDate(x.r.deletedAt) },
    { head: '', cell: (x: { n: string; r: Rec }) => btn('Geri al', () => void guard(() => restore(c.s, x.n, x.r.id), 'Geri alındı')) }], rows, 'Silinen kayıt yok'));
}

export function settings(c: Ctx, workspace: { lab: string; set: (l: string) => void }): HTMLElement {
  const main = c.st.settings.find((x) => x.id === 'main') ?? { id: 'main' };
  const f = h('div', { class: 'card' }, field('Laboratuvar adı', input('labName', 'text', main.labName ?? '')), field('Telefon', input('phone', 'tel', main.phone ?? '')), field('Adres', textarea('address', String(main.address ?? ''))),
    btn('Kaydet', () => void guard(() => put(c.s, 'settings', 'main', { id: 'main', labName: val(f, 'labName'), phone: val(f, 'phone'), address: val(f, 'address') }, !c.st.settings.length), 'Kaydedildi'), 'btn primary'));
  return h('div', null, h('h2', null, 'Ayarlar'), f, h('h3', null, 'Çalışma alanı'), h('p', { class: 'muted' }, 'Primer Teknoloji kayıtları ayrı bir çalışma alanında (labs/primer) tutulur.'),
    select('lab', [['digicad', 'DigiCAD'], ['primer', 'Primer Teknoloji']], workspace.lab), btn('Çalışma alanını değiştir', () => { const v = (document.querySelector('select[name="lab"]') as HTMLSelectElement).value; workspace.set(v); }),
    h('h3', null, 'Güvenlik'), h('p', null, 'Hesap/rol yönetimi Hekimler ve Teknisyenler sayfalarındadır. Eski 4 haneli PIN sistemi kaldırılmıştır.'));
}

/** Mail Kutusu: Gmail erişim anahtarı yalnızca bellekte tutulur (localStorage/sessionStorage YOK). */
let gmailToken: string | null = null;
export function mail(c: Ctx, onOrder: (p: Rec) => void): HTMLElement {
  const box = h('div'); const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const filt = c.st.mailFilters.find((x) => x.id === 'main') ?? { id: 'main', items: [] as string[] }; const items: string[] = Array.isArray(filt.items) ? filt.items : [];
  const hdr = (m: Rec, n: string) => String((m.payload?.headers ?? []).find((x: Rec) => String(x.name).toLowerCase() === n)?.value ?? '');
  const list = async () => {
    if (!gmailToken) throw new Error('Önce Gmail ile bağlanın.');
    const q = items.length ? items.map((x) => `from:${x}`).join(' OR ') : 'newer_than:14d';
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${gmailToken}` } });
    if (!r.ok) throw new Error('Gmail isteği başarısız (oturum süresi dolmuş olabilir).');
    const ids: Rec[] = ((await r.json()) as { messages?: Rec[] }).messages ?? []; const out: Rec[] = [];
    for (const m of ids.slice(0, 20)) { const d = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: { Authorization: `Bearer ${gmailToken}` } }); if (d.ok) out.push((await d.json()) as Rec); }
    box.replaceChildren(table([{ head: 'Gönderen', cell: (m: Rec) => hdr(m, 'from') }, { head: 'Konu', cell: (m: Rec) => hdr(m, 'subject') }, { head: '', cell: (m: Rec) => btn('Ayrıştır → Sipariş', () => void guard(async () => {
      const text = String(m.snippet ?? ''); const res = await callAdmin<Rec>('parseOrderMail', { text: `${hdr(m, 'subject')}\n${text}` }); onOrder({ ...res, id: "", patient: res.patient, jobType: res.jobType, notes: res.notes, color: res.color, teeth: res.teeth }); }, 'Ayrıştırıldı')) }], out, 'Mail yok'));
  };
  const connect = () => {
    const g = (window as unknown as { google?: { accounts: { oauth2: { initTokenClient: (o: unknown) => { requestAccessToken: () => void } } } } }).google;
    if (!clientId) { toast('VITE_GOOGLE_CLIENT_ID tanımlı değil.', 'err'); return; }
    if (!g) { toast('Google Identity Services yüklenemedi.', 'err'); return; }
    g.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/gmail.readonly', callback: (r: { access_token?: string }) => { gmailToken = r.access_token ?? null; void guard(list); } }).requestAccessToken();
  };
  const fi = input('filter', 'text', '', { placeholder: 'Gönderen filtresi (e-posta)' });
  return h('div', null, h('h2', null, 'Mail Kutusu'), h('p', { class: 'muted' }, 'Erişim anahtarı yalnızca bellekte tutulur; sayfa yenilenince bağlantı sona erer. Ayrıştırma sunucuda yapılır.'),
    btn('Gmail ile bağlan', connect, 'btn primary'), btn('Yenile', () => void guard(list), 'btn'), h('div', { class: 'row' }, fi, btn('Filtre ekle', () => void guard(() => put(c.s, 'mailFilters', 'main', { id: 'main', items: [...items, fi.value.trim()].filter(Boolean) }, !c.st.mailFilters.length)))),
    h('p', null, items.map((x) => badge(x))), box);
}
export { upload };
