import '../style.css';
import { gate } from '../lib/gate';
import { h, mount, link } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { listen, patch, type Rec } from '../lib/store';
import { shell, table, btn, guard, printNode, badge, modal, select, field, withBusy } from '../lib/ui';
import { fmtDate, fmtDateTime } from '../lib/format';
import { jawLabel } from '../lib/teeth';
import { fileChips, tabBar, empty } from '../lib/widgets';
import { array, live, filterRows, subStatusLabel, uniqueSorted, type Row } from './_util';

/** Gelen İşler (yalnızca yönetici): hekimden gelen gönderimler (inceleme/reddet/yazdır) ve sipariş formları (yazdırma durumu). */
gate(['admin'], 'Gelen İşler', (s: Session, root) => {
  let forms: Rec[] = []; let subs: Rec[] = []; let tab = 'Yeni'; let drFilter = ''; let q = ''; let printedFilter = '';
  const { root: ui, main } = shell('Gelen İşler', null, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const sorted = (rows: Rec[]) => [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const orderSheet = (r: Rec) => h('div', null, h('h2', null, 'Sipariş Formu'), h('p', null, `Hekim: ${r.drName ?? ''}  |  Hasta: ${r.patient ?? ''}  |  Teslim: ${fmtDate(r.dateout)}`),
    h('p', null, `İş: ${r.jobType ?? ''} ×${r.qty ?? 1}  |  Renk: ${r.color ?? ''}  |  Dişler: ${array(r.teeth).join(', ')}`), h('p', null, String(r.notes ?? '')));
  const printForm = (r: Rec) => { printNode(orderSheet(r)); void guard(() => patch(s, 'orderForms', r.id, { printed: true, printedAt: new Date().toISOString() })); };

  function detail(r: Rec): void {
    const m = modal(`${r.patient} — ${r.jobType ?? ''}`, h('div', null, h('dl', { class: 'detail' },
      h('dt', null, 'Hekim'), h('dd', null, String(r.doctorName ?? r.doctorId ?? '')), h('dt', null, 'Durum'), h('dd', null, subStatusLabel(r)),
      h('dt', null, 'Dişler'), h('dd', null, array(r.teeth).join(', ') || '—'), h('dt', null, 'Çene'), h('dd', null, jawLabel(r.jaw) || '—'),
      h('dt', null, 'Renk'), h('dd', null, String(r.color ?? '') || '—'), h('dt', null, 'Notlar'), h('dd', null, String(r.notes ?? '') || '—'),
      h('dt', null, 'Tarama dosyaları'), h('dd', null, fileChips(r.files)), h('dt', null, 'Gönderim'), h('dd', null, fmtDateTime(r.createdAt)),
      r.seenAt ? [h('dt', null, 'İncelendi'), h('dd', null, fmtDateTime(r.seenAt))] : null)),
    h('span', null,
      r.status === 'Yeni' && !r.seenAt ? btn('İncelendi işaretle', () => void guard(() => patch(s, 'doctorSubmissions', r.id, { seenAt: new Date().toISOString(), seenBy: s.user.uid }), 'İncelendi')) : null,
      btn('Yazdır', () => printNode(orderSheet({ ...r, drName: r.doctorName ?? r.doctorId }))),
      r.status === 'Yeni' ? btn('Reddet', () => { if (window.confirm('Bu gönderim reddedilsin mi? (Hekim durumu görür; kayıt silinmez.)')) void guard(() => patch(s, 'doctorSubmissions', r.id, { status: 'Reddedildi', rejectedAt: new Date().toISOString() }), 'Reddedildi').then((ok) => ok && m.close()); }, 'btn ghost') : null,
      r.status === 'Yeni' ? link('/admin.html', 'Yönetimde siparişe aktar') : null));
  }

  const render = () => {
    const subAll = live(subs as Row[]) as Rec[]; const doctors = uniqueSorted(subAll.map((x) => x.doctorName ?? x.doctorId));
    const count = (st: string) => subAll.filter((x) => st === 'Hepsi' || x.status === st).length;
    const rows = sorted(filterRows(subAll.filter((x) => (tab === 'Hepsi' || x.status === tab) && (!drFilter || String(x.doctorName ?? x.doctorId) === drFilter)), { q, dateKey: 'createdAt' }) as Rec[]);
    const formRows = sorted(live(forms as Row[]) as Rec[]).filter((x) => !printedFilter || (printedFilter === 'yes') === !!x.printed);
    const drSel = select('dr', [['', 'Tüm hekimler'], ...doctors.map((d): [string, string] => [d, d])], drFilter);
    drSel.addEventListener('change', () => { drFilter = drSel.value; render(); });
    const pf = select('pf', [['', 'Tümü'], ['no', 'Yazdırılmamış'], ['yes', 'Yazdırılmış']], printedFilter);
    pf.addEventListener('change', () => { printedFilter = pf.value; render(); });
    const qi = h('input', { type: 'search', value: q, 'aria-label': 'Ara', placeholder: 'Hasta / iş / hekim', on: { change: (e) => { q = (e.target as HTMLInputElement).value; render(); } } });
    mount(main, h('h2', null, 'Hekimden gelenler'),
      tabBar([['Yeni', `Yeni (${count('Yeni')})`], ['Aktarıldı', `Aktarılan (${count('Aktarıldı')})`], ['Reddedildi', `Reddedilen (${count('Reddedildi')})`], ['Hepsi', `Hepsi (${count('Hepsi')})`]], tab, (id) => { tab = id; render(); }),
      h('div', { class: 'filters' }, field('Hekim', drSel), field('Ara', qi)),
      table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.doctorName ?? r.doctorId }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => `${r.jobType ?? ''} ${array(r.teeth).join(',')}` },
        { head: 'Durum', cell: (r: Rec) => badge(subStatusLabel(r), r.status === 'Yeni' && !r.seenAt ? 'ok' : '') }, { head: '', cell: (r: Rec) => btn('Detay', () => detail(r), 'btn ghost') }], rows, 'Bu sekmede gönderim yok'),
      h('h2', null, 'Sipariş formları'), h('div', { class: 'filters' }, field('Yazdırma', pf)),
      table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.jobType },
        { head: 'Yazdırıldı', cell: (r: Rec) => (r.printed ? badge('Evet', 'ok') : badge('Hayır')) }, { head: '', cell: (r: Rec) => { const b = btn('Yazdır', () => void withBusy(b, async () => printForm(r))); return b; } }], formRows, 'Sipariş formu yok'));
  };
  const onErr = (e: Error) => mount(main, empty(`Veriler yüklenemedi: ${e.message}`));
  listen(s.lab, 'orderForms', (r) => { forms = r; render(); }, [], onErr);
  listen(s.lab, 'doctorSubmissions', (r) => { subs = r; render(); }, [], onErr);
  render();
});
