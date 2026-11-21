import '../style.css';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { shell, toast } from '../lib/ui';
import { connect, emptyState, live, isOpen, type State } from './state';
import * as P1 from './pages1';
import * as P2 from './pages2';
import type { Ctx } from './pages1';
import type { Rec } from '../lib/store';

const PAGES: [string, string][] = [['dash', '🏠 Genel Bakış'], ['order', '📝 Sipariş Formu'], ['doctorsubs', '📥 Hekimden Gelenler'], ['chat', '💬 Mesajlar'], ['pending', '🔔 Onay Bekleyen'], ['dispatch', '🎯 İş Dağıtım'], ['jobs', '📋 Devam Eden İşler'], ['done', '✅ Tamamlanan'], ['files', '🗂️ Dosyalar'],
  ['doctors', '👨‍⚕️ Hekimler'], ['techs', '🔧 Teknisyenler'], ['mail', '📧 Mail Kutusu'], ['archive', '💰 Kasa / Arşiv'], ['expenses', '💸 Giderler'], ['monthly', '📊 Aylık Rapor'], ['sales', '🛒 Satışlar'], ['trash', '🗑️ Silinenler'], ['settings', '⚙️ Ayarlar']];

gate(['admin'], 'DigiCAD Yönetim', (session, root) => {
  let s: Session = session; let st: State = emptyState(); let page = 'jobs'; let prefill: Rec | undefined; let off: (() => void) | undefined;
  const chatState = { thread: null as string | null }; const monthState = { month: new Date().toISOString().slice(0, 7) };
  let prevStatus: Record<string, string> = {}; let first = true;
  const nav = h('div'); const { root: ui, main } = shell('DigiCAD Yönetim', nav, () => void logout(), session.user.email ?? '');
  mount(root, ui);

  const go = (p: string, pre?: Rec) => { page = p; prefill = pre; render(); };
  const ctx = (): Ctx => ({ s, st, rerender: render, go, prefill });
  const badges = (): Record<string, number> => ({ jobs: live(st.jobs).filter(isOpen).length, pending: live(st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor').length, doctorsubs: live(st.doctorSubmissions).filter((x) => x.status === 'Yeni').length, dispatch: live(st.jobs).filter((j) => isOpen(j) && !(j.techIds ?? []).length).length });

  function render(): void {
    const b = badges();
    mount(nav, PAGES.map(([id, label]) => h('button', { class: `nav-item ${id === page ? 'active' : ''}`, on: { click: () => go(id) } }, label, b[id] ? h('span', { class: 'nav-badge' }, b[id]) : null)));
    const c = ctx();
    const view: Record<string, () => HTMLElement> = {
      dash: () => P1.dash(c), order: () => P1.order(c), doctorsubs: () => P1.doctorsubs(c), chat: () => P2.chat(c, chatState), pending: () => P1.pending(c), dispatch: () => P1.dispatch(c),
      jobs: () => P1.jobsPage(c, false), done: () => P1.jobsPage(c, true), files: () => P1.files(c), doctors: () => P2.doctors(c), techs: () => P2.techs(c), mail: () => P2.mail(c, (p) => go('order', p)),
      archive: () => P2.archive(c), expenses: () => P2.expenses(c), monthly: () => P2.monthly(c, monthState), sales: () => P2.sales(c), trash: () => P2.trash(c),
      settings: () => P2.settings(c, { lab: s.lab, set: (l) => { off?.(); s = { ...s, lab: l }; st = emptyState(); first = true; start(); toast(`Çalışma alanı: ${l}`); } }),
    };
    mount(main, view[page]());
  }

  function notify(): void {
    // Canlı bildirim: yalnızca oturum sırasında gerçekleşen geçişler (ilk yüklemede yağmur yok)
    const cur: Record<string, string> = {}; live(st.jobs).forEach((j) => { cur[j.id] = String(j.status); });
    if (!first) live(st.jobs).forEach((j) => { if (prevStatus[j.id] && prevStatus[j.id] !== j.status && j.status === 'Tamamlandı') toast(`✅ Tamamlandı: ${j.patient} (${j.type})`); });
    prevStatus = cur; first = false;
  }
  function start(): void {
    off = connect(s, st, () => { notify(); if (!document.querySelector('.modal-back')) render(); }, (e) => toast(`Veri hatası: ${e.message}`, 'err'));
    render();
  }
  start();
});
