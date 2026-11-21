import '../style.css';
import './admin.css';
import { onAuthStateChanged } from 'firebase/auth';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { auth } from '../lib/firebase';
import { shell, toast } from '../lib/ui';
import { connect, emptyState, live, isOpen, unassigned, type State } from './state';
import * as P1 from './pages1';
import * as P2 from './pages2';
import * as P3 from './pages3';
import type { Ctx } from './pages1';
import type { Rec } from '../lib/store';

const PAGES: [string, string][] = [['dash', '🏠 Genel Bakış'], ['order', '📝 Sipariş Formu'], ['doctorsubs', '📥 Hekimden Gelenler'], ['chat', '💬 Mesajlar'], ['pending', '🔔 Onay Bekleyen'], ['dispatch', '🎯 İş Dağıtım'], ['jobs', '📋 Devam Eden İşler'], ['done', '✅ Tamamlanan'], ['files', '🗂️ Dosyalar'],
  ['doctors', '👨‍⚕️ Hekimler'], ['techs', '🔧 Teknisyenler'], ['mail', '📧 Mail Kutusu'], ['archive', '💰 Kasa / Arşiv'], ['expenses', '💸 Giderler'], ['monthly', '📊 Aylık Rapor'], ['sales', '🛒 Satışlar'], ['trash', '🗑️ Silinenler'], ['settings', '⚙️ Ayarlar']];
/** Kullanıcının yazdığı/yerel durumu olan sayfalar: veri değişince YENİDEN ÇİZİLMEZ (yazılan form/sohbet silinmesin); yalnızca rozetler güncellenir. */
const STATEFUL = new Set(['order', 'chat', 'mail', 'settings']);
const DATA_DEBOUNCE_MS = 150;

let stopAll: (() => void) | undefined; // oturumdan çıkış / ikinci başlatma için tek kapatma noktası

gate(['admin'], 'DigiCAD Yönetim', (session, root) => {
  stopAll?.(); // gate aynı oturum için start'ı yeniden çağırırsa (şifre değişimi) eski dinleyiciler kapatılır
  let s: Session = session; let st: State = emptyState(); let page = 'dash'; let prefill: Rec | undefined; let off: (() => void) | undefined; let disposers: (() => void)[] = []; let dataFns: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined; let dirty = false; let prevJobs: Record<string, { status: string; design: string }> = {}; let first = true; let stopped = false; let unsubAuth: (() => void) | undefined; const shown = new Set<string>();
  const ps: Record<string, any> = {};  
  const nav = h('div'); const { root: ui, main } = shell('DigiCAD Yönetim', nav, () => { stop(); void logout(); }, session.user.email ?? '');
  mount(root, ui);

  const own = (fn: () => void): void => { disposers.push(fn); };
  const onData = (fn: () => void): void => { dataFns.push(fn); };
  const go = (p: string, pre?: Rec): void => { page = p; prefill = pre; render(); };
  const ctx = (): Ctx => ({ s, st, rerender: render, go, prefill, own, onData, ps });
  const badges = (): Record<string, number> => ({ jobs: live(st.jobs).filter(isOpen).length, pending: live(st.pendingJobs).filter((p) => p.status === 'Onay Bekliyor').length + live(st.jobs).filter((j) => j.status === 'Tamamlama Onayı').length, doctorsubs: live(st.doctorSubmissions).filter((x) => x.status === 'Yeni').length, dispatch: live(st.jobs).filter((j) => isOpen(j) && unassigned(j)).length, trash: 0 });
  const drawNav = (): void => { const b = badges(); mount(nav, PAGES.map(([id, label]) => h('button', { class: `nav-item ${id === page ? 'active' : ''}`, 'aria-current': id === page ? 'page' : null, on: { click: () => go(id) } }, label, b[id] ? h('span', { class: 'nav-badge' }, b[id]) : null))); };

  function render(): void {
    if (stopped) return;
    disposers.forEach((d) => d()); disposers = []; dataFns = []; // önceki sayfanın dinleyicileri (ör. sohbet) kapatılır
    drawNav(); const c = ctx();
    const view: Record<string, () => HTMLElement> = {
      dash: () => P1.dash(c), order: () => P1.order(c), doctorsubs: () => P1.doctorsubs(c), chat: () => P2.chat(c), pending: () => P1.pending(c), dispatch: () => P1.dispatch(c), jobs: () => P1.jobsPage(c, false), done: () => P1.jobsPage(c, true), files: () => P1.files(c),
      doctors: () => P2.doctors(c), techs: () => P2.techs(c), mail: () => P3.mail(c, (p) => go('order', p)), archive: () => P2.archive(c), expenses: () => P2.expenses(c), monthly: () => P2.monthly(c), sales: () => P3.sales(c), trash: () => P2.trash(c),
      settings: () => P2.settings(c, { lab: s.lab, set: (l) => { if (l === s.lab) return; off?.(); disposers.forEach((d) => d()); disposers = []; s = { ...s, lab: l }; st = emptyState(); first = true; prevJobs = {}; Object.keys(ps).forEach((k) => delete ps[k]); prefill = undefined; start(); toast(`Çalışma alanı: ${l}`); } }),
    };
    try { mount(main, view[page]()); } catch (e) { mount(main, h('div', { class: 'card' }, h('h2', null, 'Sayfa yüklenemedi'), h('p', null, (e as Error).message))); console.error(e); }
    dirty = false;
  }

  /** Veri geldiğinde: açık pencere (modal) varsa bitince yenile; kullanıcı girdisi olan sayfada yeniden çizme. */
  function refresh(): void {
    if (stopped) return;
    const ae = document.activeElement; // kullanıcı bir alana yazıyor/seçim yapıyorsa yeniden çizme (odak kaybolmasın); alan bırakılınca yenilenir
    if (document.querySelector('.modal-back') || (ae && main.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !STATEFUL.has(page))) { dirty = true; drawNav(); return; }
    if (STATEFUL.has(page)) { drawNav(); dataFns.forEach((f) => f()); return; }
    render();
  }
  const modalWatcher = new MutationObserver(() => { if (dirty && !document.querySelector('.modal-back')) refresh(); });
  modalWatcher.observe(document.body, { childList: true });
  main.addEventListener('focusout', () => setTimeout(() => { if (dirty) refresh(); }, 200));

  function notify(): void {
    const cur: Record<string, { status: string; design: string }> = {};
    live(st.jobs).forEach((j) => { cur[j.id] = { status: String(j.status), design: String(j.designFilesUpdatedAt ?? '') }; });
    if (!first) live(st.jobs).forEach((j) => { const p = prevJobs[j.id]; const c = cur[j.id]; if (!p) return;
      if (p.status !== c.status && c.status === 'Tamamlandı') toast(`✅ Tamamlandı: ${j.patient} (${j.type})`);
      if (p.status !== c.status && c.status === 'Tamamlama Onayı') toast(`📨 Onay bekliyor: ${j.patient} (${j.type})`);
      if (p.design !== c.design && c.design) toast(`🎨 Tasarım yüklendi: ${j.patient} (${j.type})`); });
    prevJobs = cur; first = false;
  }
  function start(): void {
    stopped = false;
    off = connect(s, st, () => { notify(); clearTimeout(timer); timer = setTimeout(refresh, DATA_DEBOUNCE_MS); },
      (coll, e) => { if (!shown.has(coll)) { shown.add(coll); toast(`Veri hatası (${coll}): ${e.message}`, 'err'); } }); // aynı koleksiyon için tekrar tekrar toast yok
    render();
  }
  function stop(): void { stopped = true; unsubAuth?.(); unsubAuth = undefined; clearTimeout(timer); off?.(); off = undefined; disposers.forEach((d) => d()); disposers = []; modalWatcher.disconnect(); st = emptyState(); mount(main); stopAll = undefined; }
  stopAll = stop;
  // Oturum sona erdiğinde (çıkış, token iptali, başka sekme) dinleyiciler ve bellekteki hasta verisi temizlenir.
  unsubAuth = onAuthStateChanged(auth, (u) => { if (!u) stop(); });
  start();
});
