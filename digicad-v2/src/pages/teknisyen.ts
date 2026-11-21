import '../style.css';
import { array, filterRows, splitJobs, techStats, composeQuickNote } from './_util';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { listen, newId, notDeleted, patch, put, byField, hasItem, type Rec } from '../lib/store';
import { shell, table, field, input, textarea, select, btn, guard, val, badge, withBusy } from '../lib/ui';
import { fmtDate, fmtDateTime, isOverdue, todayLocal, trUpper, TECH_STATUSES, statusLabel, statusOptions } from '../lib/format';
import { upload, validateFile, MAX_SCAN_MB, type FileRef } from '../lib/files';
import { chatBox, openJobChat } from '../lib/chatbox';
import { toothPicker, jawLabel, jawOf } from '../lib/teeth';
import { fileChips, tabBar, empty } from '../lib/widgets';

gate(['tech'], 'Teknisyen Paneli', (s: Session, root) => {
  const tid = s.techId as string;
  let jobs: Rec[] = []; let pend: Rec[] = []; let tab = 'jobs'; let jobsTab: 'ongoing' | 'done' = 'ongoing'; let stop: (() => void) | undefined; const flt = { q: '', from: '', to: '' };
  const nav = h('div'); const { root: ui, main } = shell('Teknisyen Paneli', nav, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const TABS: [string, string][] = [['jobs', '📋 İşlerim'], ['quick', '➕ Hızlı iş talebi'], ['chat', '💬 Laboratuvarla yaz']];
  const today = () => todayLocal();
  /** Kurallar: teknisyen yalnızca atandığı, çöpte olmayan ve Tamamlandı olmayan işi değiştirebilir. */
  const editable = (j: Rec) => j.status !== 'Tamamlandı' && !j.deleted;

  const statusCell = (j: Rec) => {
    if (!editable(j)) return badge(statusLabel(j.status), j.status === 'Tamamlandı' ? 'ok' : '');
    const sel = select('st', statusOptions(j.status, TECH_STATUSES), String(j.status));
    sel.setAttribute('aria-label', 'Durum');
    sel.addEventListener('change', () => void guard(() => patch(s, 'jobs', j.id, { status: sel.value }), 'Durum güncellendi').then((ok) => { if (!ok) sel.value = String(j.status); }));
    return sel;
  };
  const designCell = (j: Rec) => {
    const files = array(j.designFiles) as FileRef[]; const list = fileChips(files, 'Henüz tasarım dosyası yok');
    if (!editable(j)) return list;
    const f = h('input', { type: 'file', multiple: true, 'aria-label': 'Tasarım dosyası' }); const prog = h('progress', { max: 100, value: 0, hidden: true });
    const up = btn('Yükle', () => void withBusy(up, async () => {
      const picked = Array.from(f.files ?? []); if (!picked.length) return;
      for (const x of picked) { const err = validateFile(x, MAX_SCAN_MB); if (err) throw new Error(err); }
      const done: FileRef[] = []; prog.hidden = false;
      try {
        for (const x of picked) done.push(await upload(`labs/${s.lab}/jobFiles/${j.id}`, x, s.user.uid, MAX_SCAN_MB, { onProgress: (p) => { prog.value = p; } }));
      } finally {
        // Kısmen yüklenenler de işe eklensin (aksi halde Storage'da sahipsiz kalır).
        if (done.length) await patch(s, 'jobs', j.id, { designFiles: [...array(j.designFiles), ...done], designFilesUpdatedAt: new Date().toISOString() });
        prog.hidden = true; f.value = '';
      }
    }, 'Dosyalar yüklendi'));
    return h('div', null, list, h('div', { class: 'row' }, f, up), prog);
  };
  const noteCell = (j: Rec) => {
    if (!editable(j)) return String(j.techNote ?? '');
    const i = input('techNote', 'text', j.techNote ?? '', { maxlength: 2000, 'aria-label': 'Teknisyen notu' });
    const sv = btn('Kaydet', () => void withBusy(sv, () => patch(s, 'jobs', j.id, { techNote: i.value }), 'Not kaydedildi'), 'btn ghost');
    return h('span', null, i, sv);
  };
  const infoCell = (j: Rec) => h('div', null, h('div', null, `${j.type ?? ''}${j.qty > 1 ? ` ×${j.qty}` : ''}`), h('small', { class: 'muted' }, `Hekim: ${j.drName ?? '—'}${j.toothColor ? ` · Renk: ${j.toothColor}` : ''}`),
    j.note ? h('div', { class: 'muted' }, String(j.note)) : null, (j.files as unknown[] | undefined)?.length ? fileChips(j.files) : null);

  function jobsView(): HTMLElement {
    const { ongoing, done } = splitJobs(jobs); const st = techStats(jobs, today()); const results = h('div');
    const redraw = () => {
      const rows = filterRows(jobsTab === 'done' ? done : ongoing, { ...flt, dateKey: 'dateout' });
      mount(results, table([
        { head: 'Hasta', cell: (j: Rec) => h('b', null, String(j.patient ?? '')) }, { head: 'İş', cell: infoCell },
        { head: 'Teslim', cell: (j: Rec) => (jobsTab === 'ongoing' && isOverdue(j.dateout, today()) ? h('span', { class: 'late' }, `⚠️ ${fmtDate(j.dateout)}`) : fmtDate(j.dateout)) },
        { head: 'Durum', cell: statusCell }, { head: 'Tasarım dosyası', cell: designCell }, { head: 'Not', cell: noteCell }, { head: 'Sohbet', cell: (j: Rec) => btn('💬', () => openJobChat(s, j), 'btn ghost') },
      ], rows, flt.q || flt.from || flt.to ? 'Kriterlere uyan iş yok' : 'Kayıt yok'));
    };
    const filt = (name: 'q' | 'from' | 'to', type: string, label: string) => field(label, h('input', { type, value: flt[name], on: { input: (e) => { flt[name] = (e.target as HTMLInputElement).value; redraw(); } } }));
    redraw();
    return h('div', null, h('h2', null, 'Bana atanan işler'),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('small', null, 'Devam eden'), h('b', null, st.total)), h('div', { class: 'stat' }, h('small', null, 'Bugün teslim'), h('b', null, st.today)),
        h('div', { class: 'stat' }, h('small', null, 'Geciken'), h('b', { class: st.overdue ? 'late' : '' }, st.overdue)), h('div', { class: 'stat' }, h('small', null, 'Tamamlanan'), h('b', null, st.done))),
      tabBar([['ongoing', `Devam eden (${ongoing.length})`], ['done', `Tamamlanan (${done.length})`]], jobsTab, (id) => { jobsTab = id as typeof jobsTab; render(); }),
      h('div', { class: 'filters' }, filt('q', 'search', 'Ara (hasta / iş / hekim)'), filt('from', 'date', 'Teslim: başlangıç'), filt('to', 'date', 'Teslim: bitiş')), results);
  }

  const picked = new Set<number>();
  function quick(): HTMLElement {
    const f = h('div', { class: 'card' }, field('Hekim adı', input('drName', 'text', '', { maxlength: 300 })), field('Hasta', input('patient', 'text', '', { maxlength: 300, required: true })), field('İş türü', input('type', 'text', '', { maxlength: 300 })),
      field('Adet', input('qty', 'number', '1', { min: 1, max: 999 })), h('h4', null, 'Dişler'), toothPicker(picked, () => undefined), field('Renk', input('color', 'text', '', { maxlength: 40 })),
      field('Teslim', input('dateout', 'date')), field('Not', textarea('note')));
    const send = btn('Onaya gönder', () => void withBusy(send, async () => {
      const patient = trUpper(val(f, 'patient')).trim(); if (!patient) throw new Error('Hasta adı girin.');
      const tl = [...picked].sort((a, b) => a - b); const id = newId();
      const note = composeQuickNote({ note: val(f, 'note'), teeth: tl, color: trUpper(val(f, 'color')) }) + (tl.length ? ` (${jawLabel(jawOf(tl))})` : '');
      await put(s, 'pendingJobs', id, { id, drName: val(f, 'drName'), patient, type: val(f, 'type'), qty: Math.min(999, Math.max(1, Math.floor(Number(val(f, 'qty'))) || 1)), dateout: val(f, 'dateout'), note: note.slice(0, 5000), techId: tid, status: 'Onay Bekliyor', submittedBy: 'tech', submittedAt: new Date().toISOString(), deleted: false }, true);
      picked.clear(); tab = 'quick'; render();
    }, 'Talep gönderildi — yönetici onayı bekleniyor'), 'btn primary');
    f.append(send);
    const mine = [...pend].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return h('div', null, f, h('h3', null, 'Taleplerim'), table([{ head: 'Gönderim', cell: (r: Rec) => fmtDateTime(r.submittedAt) }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.type }, { head: 'Durum', cell: (r: Rec) => badge(String(r.status)) }], mine, 'Henüz talebiniz yok'));
  }

  function render(): void {
    stop?.(); stop = undefined;
    mount(nav, TABS.map(([id, l]) => h('button', { class: `nav-item ${id === tab ? 'active' : ''}`, on: { click: () => { tab = id; render(); } } }, l)));
    if (tab === 'jobs') mount(main, jobsView());
    else if (tab === 'quick') mount(main, h('h2', null, 'Hızlı iş talebi'), quick());
    else { const c = chatBox(s, `tech_${tid}`, s.user.email ?? 'Teknisyen'); stop = c.stop; mount(main, h('h2', null, 'Laboratuvarla mesajlaşma'), c.el); }
  }
  const onErr = (e: Error) => mount(main, empty(`Veriler yüklenemedi: ${e.message}`));
  // Yazı/dosya seçimi sürerken liste yenilenip girdiyi silmesin.
  const busy = () => { const a = document.activeElement; return !!a && (a.matches('input, textarea, select') && !!a.closest('main')); };
  listen(s.lab, 'jobs', (r) => { jobs = r; if (tab === 'jobs' && !busy()) render(); }, [hasItem('techIds', tid), notDeleted()], onErr);
  listen(s.lab, 'pendingJobs', (r) => { pend = r; if (tab === 'quick' && !busy()) render(); }, [byField('techId', tid), notDeleted()], onErr);
  render();
});
