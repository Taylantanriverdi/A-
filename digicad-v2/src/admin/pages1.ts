import { h, link, type Child } from '../lib/dom';
import { fmtDate, fmtMoney, JOB_STATUSES, STATUS_ICONS, todayISO } from '../lib/format';
import { patch, put, putMany, newId, softDelete, type Rec } from '../lib/store';
import { downloadUrl } from '../lib/files';
import { badge, btn, field, guard, input, modal, printNode, select, table, textarea, val } from '../lib/ui';
import { doctorOf, isOpen, jobTotal, live, techOf, withIds, type State } from './state';
import type { Session } from '../lib/auth';

export interface Ctx { s: Session; st: State; rerender: () => void; go: (page: string, prefill?: Rec) => void; prefill?: Rec }

const fileLinks = (files: unknown): Child =>
  (Array.isArray(files) ? files : []).map((f: Rec) => h('div', null, f.path ? h('button', { class: 'btn ghost', on: { click: () => void guard(async () => { window.open(await downloadUrl(String(f.path)), '_blank', 'noopener'); }) } }, `📎 ${f.name ?? 'dosya'}`) : link(String(f.url ?? '#'), `📎 ${f.name ?? 'dosya'} (eski arşiv)`)));

export function dash(c: Ctx): HTMLElement {
  const jobs = live(c.st.jobs); const open = jobs.filter(isOpen);
  const late = open.filter((j) => j.dateout && String(j.dateout) < todayISO());
  const card = (t: string, v: Child, go?: string) => h('button', { class: 'stat', on: { click: () => go && c.go(go) } }, h('small', null, t), h('b', null, v));
  return h('div', null, h('h2', null, 'Genel Bakış'), h('div', { class: 'stats' },
    card('Devam eden iş', open.length, 'jobs'), card('Onay bekleyen', live(c.st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor').length, 'pending'),
    card('Hekimden gelen (yeni)', live(c.st.doctorSubmissions).filter((x) => x.status === 'Yeni').length, 'doctorsubs'), card('Teslimi geçen', late.length, 'jobs'),
    card('Atanmamış', open.filter((j) => !(j.techIds ?? []).length).length, 'dispatch')),
  h('h3', null, 'Teslimi geçen işler'), table([
    { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'Hekim', cell: (j: Rec) => j.drName ?? doctorOf(c.st, j.doctorId)?.name }, { head: 'Teslim', cell: (j: Rec) => fmtDate(j.dateout) }, { head: 'Durum', cell: (j: Rec) => j.status },
  ], late, 'Geciken iş yok'));
}

/** Sipariş Formu: çok kalemli; hekimde autoTechId varsa onaysız doğrudan iş olur, yoksa Onay Bekleyen. */
export function order(c: Ctx): HTMLElement {
  const pre = (c.prefill ?? {}) as Rec;
  const lines: { type: string; qty: string; price: string }[] = [{ type: String(pre.jobType ?? ''), qty: '1', price: '0' }];
  const linesBox = h('div');
  const root = h('div', { class: 'card' });
  const drSel = select('doctorId', [['', '— Hekim seçin —'], ...live(c.st.doctors).map((d): [string, string] => [String(d.id), String(d.name)])], String(pre.drId ?? pre.doctorId ?? ''));
  const drawLines = () => { linesBox.replaceChildren(...lines.map((l, i) => h('div', { class: 'row' },
    h('input', { placeholder: 'İş türü', value: l.type, on: { input: (e) => { l.type = (e.target as HTMLInputElement).value; } } }),
    h('input', { type: 'number', min: 1, value: l.qty, on: { input: (e) => { l.qty = (e.target as HTMLInputElement).value; } } }),
    h('input', { type: 'number', min: 0, step: '0.01', value: l.price, on: { input: (e) => { l.price = (e.target as HTMLInputElement).value; } } }),
    btn('Sil', () => { lines.splice(i, 1); drawLines(); }, 'btn ghost')))); };
  drawLines();
  root.append(h('h2', null, 'Sipariş Formu'), field('Hekim', drSel), field('Hasta', input('patient', 'text', pre.patient ?? '')), field('Dişler (örn. 11,12,21)', input('teeth', 'text', Array.isArray(pre.teeth) ? pre.teeth.join(',') : '')),
    field('Renk', input('color', 'text', pre.color ?? '')), field('Teslim tarihi', input('dateout', 'date')), field('Notlar', textarea('notes', String(pre.notes ?? ''))),
    h('h3', null, 'Kalemler (tür / adet / birim fiyat)'), linesBox, btn('+ Kalem', () => { lines.push({ type: '', qty: '1', price: '0' }); drawLines(); }, 'btn'),
    h('p', null, btn('Siparişi kaydet', () => void guard(async () => {
      const dr = doctorOf(c.st, val(root, 'doctorId')); if (!dr) throw new Error('Hekim seçin.'); const patient = val(root, 'patient'); if (!patient) throw new Error('Hasta adı girin.');
      const valid = lines.filter((l) => l.type.trim()); if (!valid.length) throw new Error('En az bir kalem girin.');
      const auto = dr.autoTechId ? techOf(c.st, dr.autoTechId) : undefined; const group = valid.length > 1 ? newId() : null; const created: Rec[] = [];
      const ops = valid.flatMap((l, idx) => {
        const id = newId() + idx; const teeth = val(root, 'teeth').split(',').map((x) => x.trim()).filter(Boolean);
        const base = { id, drId: dr.id, drName: dr.name, patient, type: l.type.trim(), price: Number(l.price) || 0, currency: 'TRY', qty: Number(l.qty) || 1, dateout: val(root, 'dateout'), toothColor: val(root, 'color'), note: val(root, 'notes'), orderGroupId: group, orderGroupIndex: group ? idx : null, orderGroupTotal: group ? valid.length : null, orderForm: { teeth, jobType: l.type.trim(), doctorName: dr.name, color: val(root, 'color'), notes: val(root, 'notes') }, sourceDoctorSubmissionId: pre.id || null };
        created.push(base);
        const form = { id, drId: dr.id, drName: dr.name, patient, jobType: l.type.trim(), qty: base.qty, price: base.price, dateout: base.dateout, notes: base.note, color: base.toothColor, teeth, pendingJobId: id, printed: false, doctorId: String(dr.id) };
        const rec = auto ? withIds({ ...base, techId: auto.id, techName: auto.name, status: 'Bekliyor', deleted: false, approvedAt: new Date().toISOString(), autoAssigned: true }) : withIds({ ...base, techId: null, techName: '', status: 'Onay Bekliyor' });
        return [{ name: auto ? 'jobs' : 'pendingJobs', id, data: rec }, { name: 'orderForms', id, data: form }];
      });
      await putMany(c.s, ops);
      if (pre.id) await patch(c.s, 'doctorSubmissions', String(pre.id), { status: 'Aktarıldı', transferredAt: new Date().toISOString() });
      printNode(h('div', null, h('h2', null, 'Sipariş Formu'), h('p', null, `Hekim: ${dr.name}  |  Hasta: ${patient}  |  Teslim: ${fmtDate(val(root, 'dateout'))}`), table([{ head: 'Tür', cell: (r: Rec) => r.type }, { head: 'Adet', cell: (r: Rec) => r.qty }, { head: 'Tutar', cell: (r: Rec) => fmtMoney(jobTotal(r)) }], created)));
      c.go(auto ? 'jobs' : 'pending');
    }, 'Sipariş kaydedildi'), 'btn primary')));
  return root;
}

export function doctorsubs(c: Ctx): HTMLElement {
  const rows = live(c.st.doctorSubmissions).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return h('div', null, h('h2', null, 'Hekimden Gelenler'), table([
    { head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.doctorName ?? r.doctorId }, { head: 'Hasta', cell: (r: Rec) => r.patient },
    { head: 'İş', cell: (r: Rec) => `${r.jobType ?? ''} ${(r.teeth ?? []).join(',')}` }, { head: 'Dosya', cell: (r: Rec) => fileLinks(r.files) }, { head: 'Durum', cell: (r: Rec) => badge(String(r.status)) },
    { head: '', cell: (r: Rec) => r.status === 'Yeni' ? h('span', null, btn('Siparişe aktar', () => c.go('order', { ...r, drId: r.drId ?? r.doctorId })), btn('Reddet', () => void guard(() => patch(c.s, 'doctorSubmissions', r.id, { status: 'Reddedildi' }).then(c.rerender), 'Reddedildi'), 'btn ghost')) : null },
  ], rows));
}

export function pending(c: Ctx): HTMLElement {
  const rows = live(c.st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor');
  return h('div', null, h('h2', null, 'Onay Bekleyen'), table([
    { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.type }, { head: 'Tutar', cell: (r: Rec) => fmtMoney(jobTotal(r), r.currency) }, { head: 'Kaynak', cell: (r: Rec) => r.techName || r.source || '' },
    { head: '', cell: (r: Rec) => h('span', null,
      btn('Onayla', () => void guard(async () => {
        const { id, status: _s, ...rest } = r; void _s;
        await put(c.s, 'jobs', id, withIds({ ...rest, id, status: 'Bekliyor', deleted: false, approvedFrom: 'pendingJobs', approvedAt: new Date().toISOString() }), true);
        await patch(c.s, 'pendingJobs', id, { status: 'Onaylandı' });
      }, 'İş onaylandı'), 'btn primary'),
      btn('Reddet', () => void guard(() => patch(c.s, 'pendingJobs', r.id, { status: 'Reddedildi' }), 'Reddedildi'), 'btn ghost')) },
  ], rows, 'Onay bekleyen iş yok'));
}

export function dispatch(c: Ctx): HTMLElement {
  const rows = live(c.st.jobs).filter((j) => isOpen(j) && !(j.techIds ?? []).length);
  const opts: [string, string][] = [['', '— Teknisyen —'], ...live(c.st.technicians).map((t): [string, string] => [String(t.id), String(t.name)])];
  return h('div', null, h('h2', null, 'İş Dağıtım Merkezi'), table([
    { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.type }, { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) },
    { head: 'Ata', cell: (r: Rec) => { const sel = select('t', opts); return h('span', null, sel, btn('Ata', () => void guard(async () => { const t = techOf(c.st, sel.value); if (!t) throw new Error('Teknisyen seçin.'); await patch(c.s, 'jobs', r.id, { techId: t.id, techName: t.name, techIds: [String(t.id)] }); }, 'Atandı'))); } },
  ], rows, 'Atanmamış iş yok'));
}

function jobDetail(c: Ctx, j: Rec): void {
  modal(`${j.patient} — ${j.type}`, h('div', null, h('p', null, `Hekim: ${j.drName ?? ''} | Teknisyen: ${j.techName ?? '—'} | Renk: ${j.toothColor ?? ''}`), h('p', null, `Not: ${j.note ?? ''}`), h('p', null, `Teknisyen notu: ${j.techNote ?? ''}`), h('h4', null, 'Dosyalar'), fileLinks(j.files), h('h4', null, 'Tasarım'), fileLinks(j.designFiles)));
}

export function jobsPage(c: Ctx, done: boolean): HTMLElement {
  const rows = live(c.st.jobs).filter((j) => (j.status === 'Tamamlandı') === done).sort((a, b) => String(a.dateout ?? '').localeCompare(String(b.dateout ?? '')));
  const statusSel = (j: Rec) => { const s = select('st', JOB_STATUSES.map((x): [string, string] => [x, `${STATUS_ICONS[x]} ${x}`]), String(j.status)); s.addEventListener('change', () => void guard(() => patch(c.s, 'jobs', j.id, { status: s.value, ...(s.value === 'Tamamlandı' ? { completedAt: new Date().toISOString() } : {}) }), 'Durum güncellendi')); return s; };
  return h('div', null, h('h2', null, done ? 'Tamamlanan İşler' : 'Devam Eden İşler'), table([
    { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.type} ×${r.qty ?? 1}` }, { head: 'Teknisyen', cell: (r: Rec) => r.techName || '—' },
    { head: 'Teslim', cell: (r: Rec) => fmtDate(r.dateout) }, { head: 'Tutar', cell: (r: Rec) => fmtMoney(jobTotal(r), r.currency) }, { head: 'Durum', cell: statusSel },
    { head: '', cell: (r: Rec) => h('span', null, btn('Detay', () => jobDetail(c, r), 'btn ghost'), btn('Sil', () => { if (window.confirm('İş çöp kutusuna taşınsın mı? (Silinenler sayfasından geri alınabilir)')) void guard(() => softDelete(c.s, 'jobs', r.id), 'Silinenlere taşındı'); }, 'btn ghost')) },
  ], rows));
}

export function files(c: Ctx): HTMLElement {
  const rows = live(c.st.jobs).filter((j) => (j.files ?? []).length || (j.designFiles ?? []).length);
  return h('div', null, h('h2', null, 'Dosyalar'), table([{ head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hekim dosyaları', cell: (r: Rec) => fileLinks(r.files) }, { head: 'Tasarım dosyaları', cell: (r: Rec) => fileLinks(r.designFiles) }], rows, 'Dosyalı iş yok'));
}
export { link };
