import '../style.css';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { listen, patch, type Rec } from '../lib/store';
import { shell, table, btn, guard, printNode, badge } from '../lib/ui';
import { fmtDate } from '../lib/format';

/** Gelen İşler: sipariş formları (yazdırma durumu) ve hekimden yeni gelenler. */
gate(['admin'], 'Gelen İşler', (s: Session, root) => {
  let forms: Rec[] = []; let subs: Rec[] = [];
  const { root: ui, main } = shell('Gelen İşler', null, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const print = (r: Rec) => { printNode(h('div', null, h('h2', null, 'Sipariş Formu'), h('p', null, `Hekim: ${r.drName}  |  Hasta: ${r.patient}  |  Teslim: ${fmtDate(r.dateout)}`), h('p', null, `İş: ${r.jobType} ×${r.qty ?? 1}  |  Renk: ${r.color ?? ''}  |  Dişler: ${(r.teeth ?? []).join(', ')}`), h('p', null, String(r.notes ?? '')))); void guard(() => patch(s, 'orderForms', r.id, { printed: true, printedAt: new Date().toISOString() })); };
  const render = () => mount(main, h('h2', null, 'Yeni hekim gönderimleri'),
    table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.doctorName ?? r.doctorId }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.jobType }], subs.filter((x) => x.status === 'Yeni' && !x.deleted), 'Yeni gönderim yok'),
    h('h2', null, 'Sipariş formları'), table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hekim', cell: (r: Rec) => r.drName }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.jobType }, { head: 'Yazdırıldı', cell: (r: Rec) => r.printed ? badge('Evet', 'ok') : badge('Hayır') }, { head: '', cell: (r: Rec) => btn('Yazdır', () => print(r)) }], forms.filter((x) => !x.deleted)));
  listen(s.lab, 'orderForms', (r) => { forms = r.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); render(); });
  listen(s.lab, 'doctorSubmissions', (r) => { subs = r; render(); });
  render();
});
