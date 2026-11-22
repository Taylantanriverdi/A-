import { h, type Child } from '../lib/dom';
import { fmtDate, fmtMoney } from '../lib/format';
import { callFn } from '../lib/firebase';
import { newId, put, softDelete, type Rec } from '../lib/store';
import { badge, btn, field, input, modal, printNode, select, table, textarea, toast, val } from '../lib/ui';
import { live } from './state';
import type { Ctx } from './pages1';
import { abtn, arr, curOptions, fmtSums, searchInput, sure, trLower } from './util';
import { curOf, formNo, fromCents, gmailQuery, isoToLocalDate, mailContent, sanitizeFilter, saleTotals, SALE_STATUSES, SALE_TYPES, SALE_UNITS, toCents, todayLocal, zeroSums, type Cur, type R, type SaleItem, type MailPart } from './calc';
import { addMailFilter, removeMailFilter } from './data';
import { saveBlob } from '../lib/zip';

/* ---------------- Satışlar (eski `sales`: servis / sarf formu) ---------------- */
function saleNode(c: Ctx, s: Rec): HTMLElement {
  const lab = c.st.settings.find((x) => x.id === 'main'); const cur = curOf(s);
  return h('div', { class: 'print-doc' }, h('h2', null, `${lab?.labName ?? 'DigiCAD Dental Laboratuvar'} — ${s.type ?? 'Servis'} Formu`), lab?.phone || lab?.address ? h('p', { class: 'muted' }, [lab?.phone, lab?.address].filter(Boolean).join(' · ')) : null,
    h('p', null, `Form no: ${s.formNo ?? ''}   |   Tarih: ${fmtDate(s.date)}   |   Durum: ${s.status ?? ''}`), h('p', null, `Müşteri: ${s.customer ?? ''}${s.contact ? ` (${s.contact})` : ''}   |   ${[s.phone, s.email].filter(Boolean).join(' · ')}`), s.address ? h('p', null, `Adres: ${s.address}`) : null,
    table([{ head: 'Ürün / hizmet', cell: (it: R) => it.name }, { head: 'Adet', cell: (it: R) => `${it.qty} ${it.unit ?? ''}` }, { head: 'Birim fiyat', cell: (it: R) => fmtMoney(it.price, cur) }, { head: 'Tutar', cell: (it: R) => fmtMoney(fromCents(Math.round(toCents(it.price) * Number(it.qty))), cur) }], arr(s.items), 'Kalem yok'),
    h('p', null, `Ara toplam: ${fmtMoney(s.subtotal, cur)}   |   KDV (%${s.vat ?? 0}): ${fmtMoney(s.vatAmt, cur)}`), h('p', null, h('b', null, `Genel toplam: ${fmtMoney(s.total, cur)}`)), h('p', null, `Ödeme: ${s.payment ?? ''}${s.note ? `   |   Not: ${s.note}` : ''}`));
}

function saleForm(c: Ctx, existing: Rec | undefined, done: () => void): void {
  const items: SaleItem[] = existing && arr(existing.items).length ? arr(existing.items).map((it: R) => ({ name: String(it.name ?? ''), qty: Number(it.qty) || 0, unit: String(it.unit ?? 'Adet'), price: Number(it.price) || 0 })) : [{ name: '', qty: 1, unit: 'Adet', price: 0 }];
  const itemsBox = h('div'); const totals = h('p', { 'aria-live': 'polite' });
  const e: R = existing ?? {};
  const f = h('div', null, field('Form no', input('formNo', 'text', e.formNo ?? formNo(), { maxlength: 40 })), field('Tarih', input('date', 'date', e.date ?? todayLocal())), field('Tür', select('type', SALE_TYPES.map((x): [string, string] => [x, x]), String(e.type ?? 'Servis'))), field('Durum', select('status', SALE_STATUSES.map((x): [string, string] => [x, x]), String(e.status ?? 'Beklemede'))),
    field('Müşteri', input('customer', 'text', e.customer ?? '', { maxlength: 200 })), field('İlgili kişi', input('contact', 'text', e.contact ?? '', { maxlength: 200 })), field('E-posta', input('email', 'email', e.email ?? '', { maxlength: 200 })), field('Telefon', input('phone', 'tel', e.phone ?? '', { maxlength: 40 })), field('Adres', textarea('address', String(e.address ?? ''))),
    h('h4', null, 'Kalemler'), itemsBox, btn('+ Kalem', () => { items.push({ name: '', qty: 1, unit: 'Adet', price: 0 }); draw(); }), field('KDV oranı (%)', input('vat', 'number', e.vat ?? 20, { min: 0, max: 100, step: '1' })), field('Para birimi', select('currency', curOptions, curOf(e))), field('Ödeme', select('payment', ['Nakit', 'Kart', 'Havale/EFT', 'Çek', 'Vadeli'].map((x): [string, string] => [x, x]), String(e.payment ?? 'Nakit'))), field('Not', textarea('note', String(e.note ?? ''))), totals);
  const recalc = (): void => { const cur = (val(f, 'currency') || 'TRY') as Cur; const t = saleTotals(items, Number(val(f, 'vat'))); totals.textContent = `Ara toplam ${fmtMoney(t.subtotal, cur)} · KDV ${fmtMoney(t.vatAmt, cur)} · Genel toplam ${fmtMoney(t.total, cur)}`; };
  const draw = (): void => { itemsBox.replaceChildren(...items.map((it, i) => h('div', { class: 'row' },
    h('input', { placeholder: 'Ürün / hizmet adı', value: it.name, maxlength: 200, 'aria-label': 'Ürün adı', on: { input: (ev) => { it.name = (ev.target as HTMLInputElement).value; } } }),
    h('input', { type: 'number', min: 0, step: '0.01', value: it.qty, 'aria-label': 'Adet', on: { input: (ev) => { it.qty = Number((ev.target as HTMLInputElement).value); recalc(); } } }),
    (() => { const s = select('unit', SALE_UNITS.map((x): [string, string] => [x, x]), it.unit); s.addEventListener('change', () => { it.unit = s.value; }); return s; })(),
    h('input', { type: 'number', min: 0, step: '0.01', value: it.price, 'aria-label': 'Birim fiyat', on: { input: (ev) => { it.price = Number((ev.target as HTMLInputElement).value); recalc(); } } }),
    btn('✕', () => { items.splice(i, 1); if (!items.length) items.push({ name: '', qty: 1, unit: 'Adet', price: 0 }); draw(); recalc(); }, 'btn ghost')))); recalc(); };
  draw(); f.addEventListener('input', recalc); f.addEventListener('change', recalc);
  const m = modal(existing ? 'Servis formunu düzenle' : 'Yeni servis / sarf formu', f, abtn('Kaydet', async () => {
    const customer = val(f, 'customer'); if (!customer) throw new Error('Müşteri adı girin.'); const valid = items.filter((it) => it.name.trim());
    if (!valid.length) throw new Error('En az bir ürün/hizmet kalemi ekleyin.'); if (valid.some((it) => !(it.qty > 0) || !(it.price >= 0))) throw new Error('Adet sıfırdan büyük, fiyat negatif olmamalı.');
    const vat = Number(val(f, 'vat')); if (!(vat >= 0 && vat <= 100)) throw new Error('KDV oranı 0-100 arasında olmalı.'); if (!isoToLocalDate(val(f, 'date'))) throw new Error('Tarih girin.');
    const t = saleTotals(valid, vat); const id = existing?.id ?? newId();
    await put(c.s, 'sales', id, { id, formNo: val(f, 'formNo'), date: val(f, 'date'), type: val(f, 'type'), status: val(f, 'status'), customer, contact: val(f, 'contact'), email: val(f, 'email'), phone: val(f, 'phone'), address: val(f, 'address'), items: valid.map((it) => ({ ...it, price: fromCents(toCents(it.price)) })), vat, currency: val(f, 'currency'), payment: val(f, 'payment'), note: val(f, 'note'), ...t }, !existing);
    m.close(); done();
  }, 'btn primary', 'Kaydedildi'));
}

export function sales(c: Ctx): HTMLElement {
  const f = (c.ps.sales ??= { q: '', type: '', status: '', from: '', to: '' }) as { q: string; type: string; status: string; from: string; to: string }; const box = h('div'); const sum = h('div', { class: 'stats' });
  const all = live(c.st.sales);
  const rows = (): Rec[] => all.filter((s) => (!f.q || [s.customer, s.formNo, s.contact, ...arr(s.items).map((it: R) => it.name)].some((x) => trLower(x).includes(f.q))) && (!f.type || s.type === f.type) && (!f.status || s.status === f.status) && (!f.from || String(s.date) >= f.from) && (!f.to || String(s.date) <= f.to)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  const draw = (): void => {
    const total = zeroSums(); all.forEach((s) => { if (s.status !== 'İptal') total[curOf(s)] += toCents(s.total); });
    const stat = (t: string, v: Child) => h('div', { class: 'stat' }, h('small', null, t), h('b', null, v));
    sum.replaceChildren(stat('Toplam form', all.length), stat('Sarf', all.filter((s) => s.type === 'Sarf' || s.type === 'Karma').length), stat('Servis', all.filter((s) => s.type === 'Servis' || s.type === 'Karma').length), stat('Toplam (iptal hariç)', fmtSums(total, true)));
    box.replaceChildren(table([{ head: 'Form no', cell: (s: Rec) => s.formNo }, { head: 'Tarih', cell: (s: Rec) => fmtDate(s.date) }, { head: 'Müşteri', cell: (s: Rec) => `${s.customer ?? ''}${s.contact ? ` (${s.contact})` : ''}` }, { head: 'Tür', cell: (s: Rec) => badge(String(s.type)) }, { head: 'Kalem', cell: (s: Rec) => arr(s.items).length },
      { head: 'Tutar', cell: (s: Rec) => fmtMoney(s.total, curOf(s)) }, { head: 'Durum', cell: (s: Rec) => badge(String(s.status)) },
      { head: '', cell: (s: Rec) => h('span', null, btn('Düzenle', () => saleForm(c, s, c.rerender), 'btn ghost'), btn('🖨️ Yazdır/PDF', () => printNode(saleNode(c, s)), 'btn ghost'), abtn('Sil', async () => { if (sure(`"${s.formNo}" nolu form silinenlere taşınsın mı?`)) await softDelete(c.s, 'sales', s.id); }, 'btn ghost')) }], rows(), all.length ? 'Filtreye uyan kayıt yok' : 'Henüz servis formu yok'));
  };
  draw();
  const ts = select('t', [['', 'Tüm türler'], ...SALE_TYPES.map((x): [string, string] => [x, x])], f.type); ts.addEventListener('change', () => { f.type = ts.value; draw(); });
  const ss = select('s', [['', 'Tüm durumlar'], ...SALE_STATUSES.map((x): [string, string] => [x, x])], f.status); ss.addEventListener('change', () => { f.status = ss.value; draw(); });
  const d1 = input('from', 'date', f.from); d1.addEventListener('change', () => { f.from = d1.value; draw(); }); const d2 = input('to', 'date', f.to); d2.addEventListener('change', () => { f.to = d2.value; draw(); });
  return h('div', null, h('h2', null, 'Satışlar (servis / sarf formları)'), sum, h('div', { class: 'row' }, btn('+ Yeni form', () => saleForm(c, undefined, c.rerender), 'btn primary'), searchInput('Ara: müşteri, form no, ürün', (q) => { f.q = q; draw(); }, f.q), ts, ss, d1, d2), box,
    h('p', { class: 'muted' }, 'Satış gelirleri Aylık Rapor\'a tarihe ve para birimine göre eklenir (iptaller hariç).'));
}

/* ---------------- Mail Kutusu ---------------- */
/** Gmail erişim anahtarı yalnızca bellekte tutulur (localStorage/sessionStorage YOK). */
let gmailToken: string | null = null; let mails: Rec[] = [];
const callAdmin = <T>(name: string, data: unknown) => callFn<T>(name, data);
const hdr = (m: Rec, n: string): string => String((m.payload?.headers ?? []).find((x: R) => String(x.name).toLowerCase() === n)?.value ?? '');
const fromEmail = (m: Rec): string => { const f = hdr(m, 'from'); return (f.match(/<([^>]+)>/)?.[1] ?? f).trim().toLowerCase(); };
async function gmail(path: string): Promise<Response> {
  if (!gmailToken) throw new Error('Önce Gmail ile bağlanın.');
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${gmailToken}` } });
  if (r.status === 401) { gmailToken = null; throw new Error('Gmail oturumu sona erdi; yeniden bağlanın.'); }
  if (!r.ok) throw new Error(`Gmail isteği başarısız (${r.status}).`);
  return r;
}

export function mail(c: Ctx, onOrder: (p: Rec) => void): HTMLElement {
  const box = h('div'); const filtersBox = h('div'); const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const items = (): string[] => arr(c.st.mailFilters.find((x) => x.id === 'main')?.items).map(String);
  const drawFilters = (): void => {
    const fi = items();
    filtersBox.replaceChildren(fi.length ? table([{ head: 'Güvenilir gönderen', cell: (x: string) => x }, { head: 'Eşleşen hekim', cell: (x: string) => { const d = live(c.st.doctors).find((d) => String(d.email ?? '').toLowerCase() === x); return d ? badge(String(d.name), 'ok') : badge('Hekim eşleşmedi'); } }, { head: '', cell: (x: string) => abtn('Kaldır', async () => { await removeMailFilter(c.s, x); }, 'btn ghost', 'Filtre kaldırıldı') }], fi) : h('p', { class: 'muted' }, 'Filtre yok: son gelen kutusu (in:inbox) listelenir.'));
  };
  const drawMails = (): void => box.replaceChildren(table([{ head: 'Gönderen', cell: (m: Rec) => hdr(m, 'from') }, { head: 'Konu', cell: (m: Rec) => hdr(m, 'subject') }, { head: 'Tarih', cell: (m: Rec) => fmtDate(hdr(m, 'date')) }, { head: '', cell: (m: Rec) => btn('Aç', () => openMail(m), 'btn') }], mails, 'Mail yok'));
  const list = async (): Promise<void> => {
    const r = await gmail(`messages?maxResults=20&q=${encodeURIComponent(gmailQuery(items()))}`); const ids: Rec[] = ((await r.json()) as { messages?: Rec[] }).messages ?? []; const out: Rec[] = []; let next = 0;
    const worker = async (): Promise<void> => { while (next < ids.length) { const id = ids[next++].id; const d = await gmail(`messages/${id}?format=full`); out.push((await d.json()) as Rec); } };
    await Promise.all([worker(), worker(), worker()]);
    mails = out.sort((a, b) => Number(b.internalDate) - Number(a.internalDate)); drawMails();
  };
  const openMail = (m: Rec): void => {
    const { text, attachments } = mailContent(m.payload as MailPart); const sender = fromEmail(m); const doctor = live(c.st.doctors).find((d) => String(d.email ?? '').toLowerCase() === sender);
    const dlg = modal(hdr(m, 'subject') || '(konu yok)', h('div', null, h('p', { class: 'muted' }, `Gönderen: ${hdr(m, 'from')}${doctor ? ` → hekim: ${doctor.name}` : ''}`), h('div', { class: 'mailbody' }, text || '(gövde yok)'),
      attachments.map((a) => abtn(`📎 ${a.filename}`, async () => { const r = await gmail(`messages/${m.id}/attachments/${a.attachmentId}`); const d = ((await r.json()) as { data?: string }).data ?? ''; const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/')); saveBlob(new Blob([Uint8Array.from(bin, (ch) => ch.charCodeAt(0))], { type: a.mimeType }), a.filename); }, 'btn ghost')),
      abtn('Ayrıştır → Sipariş formu', async () => {
        const res = await callAdmin<R>('parseOrderMail', { text: `${hdr(m, 'subject')}\n${text}`.slice(0, 12000) });
        const byName = live(c.st.doctors).find((d) => trLower(d.name) === trLower(res.doctorName));
        dlg.close(); // sipariş formu açılırken mail penceresi üstte kalmasın
        onOrder({ id: '', drId: doctor?.id ?? byName?.id ?? '', patient: res.patient, jobType: res.jobType, notes: res.notes, color: res.color, teeth: res.teeth, material: '' });
      }, 'btn primary', 'Ayrıştırıldı (taslak; kaydetmeden önce kontrol edin)')));
  };
  const connect = (): void => {
    const g = (window as unknown as { google?: { accounts: { oauth2: { initTokenClient: (o: unknown) => { requestAccessToken: () => void } } } } }).google;
    if (!clientId) { toast('VITE_GOOGLE_CLIENT_ID tanımlı değil.', 'err'); return; } if (!g) { toast('Google Identity Services yüklenemedi.', 'err'); return; }
    g.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/gmail.readonly', callback: (r: { access_token?: string; error?: string }) => { if (!r.access_token) { toast('Gmail bağlantısı reddedildi.', 'err'); return; } gmailToken = r.access_token; void list().catch((e: Error) => toast(e.message, 'err')); } }).requestAccessToken();
  };
  const fi = input('filter', 'text', '', { placeholder: 'Gönderen: ad@klinik.com veya @klinik.com', maxlength: 120 });
  drawFilters(); drawMails(); c.onData(drawFilters);
  return h('div', null, h('h2', null, 'Mail Kutusu'), h('p', { class: 'muted' }, 'Erişim anahtarı yalnızca bellekte tutulur; sayfa yenilenince bağlantı sona erer. Ayrıştırma sunucuda yapılır ve yalnızca bir TASLAK üretir; siparişi siz kaydedersiniz.'),
    h('div', { class: 'row' }, btn('Gmail ile bağlan', connect, 'btn primary'), abtn('Yenile', list, 'btn')), h('h3', null, 'Güvenilir gönderen filtreleri'),
    h('div', { class: 'row' }, fi, abtn('Filtre ekle', async () => { const v = sanitizeFilter(fi.value); if (!v) throw new Error('Geçerli bir e-posta (ad@klinik.com) veya alan adı (@klinik.com) girin.'); if (items().includes(v)) throw new Error('Bu filtre zaten var.'); await addMailFilter(c.s, v); fi.value = ''; }, 'btn', 'Filtre eklendi')), filtersBox, h('h3', null, 'Mailler'), box);
}
