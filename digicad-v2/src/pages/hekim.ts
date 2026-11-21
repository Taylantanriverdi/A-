import '../style.css';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { byField, listen, listenDoc, newId, put, type Rec } from '../lib/store';
import { shell, table, field, input, textarea, select, btn, guard, badge, val, modal, printNode, withBusy } from '../lib/ui';
import { fmtDate, fmtDateTime, fmtSize, isOverdue, trUpper, STATUS_ICONS } from '../lib/format';
import { upload, validateFile, MAX_SCAN_MB, type FileRef } from '../lib/files';
import { chatBox } from '../lib/chatbox';
import { toothPicker, jawOf, jawLabel } from '../lib/teeth';
import { fileChips, stageStepper, tabBar, empty } from '../lib/widgets';
import { array, filterRows, splitJobs, stageOf, linkedJobs, live, type Row } from './_util';

const SHADES = ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'BL1', 'BL2', 'BL3', 'BL4'];

gate(['doctor'], 'Hekim Portalı', (s: Session, root) => {
  const did = s.doctorId as string;
  let me: Rec | null = null; let jobs: Rec[] = []; let subs: Rec[] = []; let tab = 'jobs'; let jobsTab: 'ongoing' | 'done' = 'ongoing';
  let stopChat: (() => void) | undefined; const flt = { q: '', from: '', to: '' };
  const nav = h('div'); const { root: ui, main } = shell('Hekim Portalı', nav, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const TABS: [string, string][] = [['jobs', '📋 İşlerim'], ['new', '➕ Yeni gönderim'], ['subs', '📥 Gönderimlerim'], ['chat', '💬 Laboratuvarla yaz']];

  // ---------- Yeni gönderim ----------
  const picked: File[] = []; const teeth = new Set<number>();
  function priceNames(): string[] {
    const p = me?.prices; const list: unknown[] = Array.isArray(p) ? p : p && typeof p === 'object' ? Object.values(p) : [];
    return list.map((x) => String((x as Rec)?.name ?? '')).filter(Boolean);
  }
  function newForm(): HTMLElement {
    const names = priceNames();
    const jobType = names.length ? select('jobType', [['', '— Seçiniz —'], ...names.map((n): [string, string] => [n, trUpper(n)])]) : input('jobType', 'text', '', { required: true, maxlength: 200, placeholder: 'Örn. Zirkonya Kron' });
    const summary = h('p', { class: 'muted' }); const fileList = h('div');
    const f = h('form', { class: 'card', on: { submit: (e) => e.preventDefault() } });
    const upd = () => { summary.textContent = teeth.size ? `Seçili dişler: ${[...teeth].sort((a, b) => a - b).join(', ')} · ${jawLabel(jawOf(teeth))}` : 'Diş seçilmedi'; };
    const drawFiles = () => {
      mount(fileList, picked.length ? picked.map((x, i) => h('div', { class: 'row' }, `📎 ${x.name} (${fmtSize(x.size)})`, btn('✕', () => { picked.splice(i, 1); drawFiles(); }, 'btn ghost'))) : h('p', { class: 'muted' }, 'Henüz dosya eklenmedi.'));
    };
    const picker = h('input', { type: 'file', multiple: true, 'aria-label': 'Tarama dosyaları', on: { change: () => {
      for (const x of Array.from(picker.files ?? [])) { const err = validateFile(x, MAX_SCAN_MB); if (err) void guard(() => Promise.reject(new Error(err))); else if (picked.length < 50) picked.push(x); }
      picker.value = ''; drawFiles(); } } });
    f.append(field('Hasta adı', input('patient', 'text', '', { required: true, maxlength: 300 })), field('İş türü', jobType),
      h('h4', null, 'Dişler'), toothPicker(teeth, upd), summary,
      field('Diş rengi', input('color', 'text', '', { maxlength: 40, list: 'shades', placeholder: 'A2, B1 …' })), h('datalist', { id: 'shades' }, SHADES.map((x) => h('option', { value: x }))),
      field('Notlar', textarea('notes')), h('h4', null, 'Tarama dosyaları (STL/ZIP/PDF/görsel, en fazla 200 MB)'), picker, fileList);
    const submit = btn('Laboratuvara gönder', () => void withBusy(submit, async () => {
      const patient = trUpper(val(f, 'patient')).trim(), type = val(f, 'jobType'), color = trUpper(val(f, 'color'));
      const missing = [!patient && 'Hasta adı', !type && 'İş türü', !teeth.size && 'Diş seçimi', !color && 'Diş rengi', !picked.length && 'Tarama dosyası'].filter(Boolean);
      if (missing.length) throw new Error(`Eksik alanlar: ${missing.join(', ')}`);
      const up: FileRef[] = [];
      for (const [i, file] of picked.entries()) up.push(await upload(`labs/${s.lab}/submissions/${did}`, file, s.user.uid, MAX_SCAN_MB, { onProgress: (p) => { summary.textContent = `Yükleniyor ${i + 1}/${picked.length} (%${p})…`; } }));
      const id = newId(); const tl = [...teeth].sort((a, b) => a - b);
      await put(s, 'doctorSubmissions', id, { id, doctorId: did, drId: did, patient, jobType: type, teeth: tl, jaw: jawOf(tl), color, notes: val(f, 'notes'), files: up, status: 'Yeni', source: 'hekim-portal' }, true);
      f.reset(); picked.length = 0; teeth.clear(); tab = 'subs'; render();
    }, 'Gönderildi — laboratuvar inceleyecek'), 'btn primary');
    f.append(h('p', null, submit)); upd(); drawFiles();
    return f;
  }

  // ---------- İşlerim ----------
  function jobDetail(j: Rec): void {
    const sub = subs.find((x) => String(x.id) === String(j.sourceDoctorSubmissionId));
    modal(`${j.patient} — ${j.type ?? ''}`, h('dl', { class: 'detail' },
      h('dt', null, 'Durum'), h('dd', null, `${STATUS_ICONS[j.status] ?? ''} ${j.status}`), h('dt', null, 'Adet'), h('dd', null, String(j.qty ?? 1)),
      h('dt', null, 'Teslim tarihi'), h('dd', null, fmtDate(j.dateout) || '—'), h('dt', null, 'Renk'), h('dd', null, String(j.toothColor ?? '') || '—'),
      h('dt', null, 'Notlar'), h('dd', null, String(j.note ?? '') || '—'),
      sub ? [h('dt', null, 'Gönderdiğim dosyalar'), h('dd', null, fileChips(sub.files))] : null));
  }
  function jobsList(): HTMLElement {
    const { ongoing, done } = splitJobs(jobs);
    const rows = filterRows(jobsTab === 'done' ? done : ongoing, { ...flt, dateKey: 'dateout' }); const today = new Date().toISOString().slice(0, 10);
    const box = h('div');
    box.append(table([
      { head: 'Hasta', cell: (j: Rec) => h('b', null, String(j.patient ?? '')) }, { head: 'İş', cell: (j: Rec) => `${j.type ?? ''}${j.qty > 1 ? ` ×${j.qty}` : ''}` },
      { head: 'Teslim', cell: (j: Rec) => (jobsTab === 'ongoing' && isOverdue(j.dateout, today) ? h('span', { class: 'late' }, `⚠️ ${fmtDate(j.dateout)}`) : fmtDate(j.dateout)) },
      { head: jobsTab === 'done' ? 'Tamamlanma' : 'Durum', cell: (j: Rec) => (jobsTab === 'done' ? `✅ ${fmtDate(j.completedAt) || '—'}` : `${STATUS_ICONS[j.status] ?? ''} ${j.status}`) },
      { head: '', cell: (j: Rec) => btn('Detay', () => jobDetail(j), 'btn ghost') },
    ], rows, flt.q || flt.from || flt.to ? 'Kriterlere uyan iş yok' : jobsTab === 'done' ? 'Tamamlanmış iş yok' : 'Devam eden iş yok'));
    box.append(btn('🖨️ Listeyi yazdır / PDF', () => printNode(h('div', null, h('h2', null, `İş listesi — ${jobsTab === 'done' ? 'Tamamlanan' : 'Devam eden'}`), table([
      { head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Teslim', cell: (j: Rec) => fmtDate(j.dateout) }, { head: 'Durum', cell: (j: Rec) => j.status }], rows)))));
    return box;
  }
  function jobsView(): HTMLElement {
    const { ongoing, done } = splitJobs(jobs); const results = h('div');
    const redraw = () => mount(results, jobsList());
    const filt = (name: 'q' | 'from' | 'to', type: string, label: string) => field(label, h('input', { type, value: flt[name], on: { input: (e) => { flt[name] = (e.target as HTMLInputElement).value; redraw(); } } }));
    redraw();
    return h('div', null, h('h2', null, 'İşlerim'), tabBar([['ongoing', `Devam eden (${ongoing.length})`], ['done', `Tamamlanan (${done.length})`]], jobsTab, (id) => { jobsTab = id as typeof jobsTab; render(); }),
      h('div', { class: 'filters' }, filt('q', 'search', 'Ara (hasta / iş)'), filt('from', 'date', 'Teslim: başlangıç'), filt('to', 'date', 'Teslim: bitiş')), results);
  }

  // ---------- Gönderimlerim ----------
  function subDetail(r: Rec): void {
    const st = stageOf(r as Row, jobs); const tl = array(r.teeth).map(String);
    modal(`${r.patient} — ${r.jobType ?? ''}`, h('div', null,
      st.stage === 'rejected' ? h('p', null, badge('Reddedildi')) : stageStepper(st.stage, st.sub),
      h('dl', { class: 'detail' }, h('dt', null, 'Dişler'), h('dd', null, tl.join(', ') || '—'), h('dt', null, 'Çene'), h('dd', null, jawLabel(r.jaw) || '—'),
        h('dt', null, 'Renk'), h('dd', null, String(r.color ?? '') || '—'), h('dt', null, 'Notlar'), h('dd', null, String(r.notes ?? '') || '—'),
        h('dt', null, 'Tarama dosyaları'), h('dd', null, fileChips(r.files)), h('dt', null, 'Gönderim tarihi'), h('dd', null, fmtDateTime(r.createdAt)),
        linkedJobs(r as Row, jobs).length ? [h('dt', null, 'Bağlı işler'), h('dd', null, linkedJobs(r as Row, jobs).map((j) => h('div', null, `${j.type} — ${STATUS_ICONS[j.status] ?? ''} ${j.status}`)))] : null)));
  }
  function subsView(): HTMLElement {
    const rows = live(subs as Row[]).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return h('div', null, h('h2', null, 'Gönderimlerim'), table([
      { head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.jobType },
      { head: 'Aşama', cell: (r: Rec) => { const st = stageOf(r as Row, jobs); return badge({ approval: '📨 Onay bekliyor', production: '🔧 Üretimde', done: '✅ Tamamlandı', rejected: '❌ Reddedildi' }[st.stage], st.stage === 'done' ? 'ok' : ''); } },
      { head: '', cell: (r: Rec) => btn('Detay', () => subDetail(r), 'btn ghost') }], rows, 'Henüz gönderiminiz yok'));
  }

  function render(): void {
    stopChat?.(); stopChat = undefined;
    mount(nav, TABS.map(([id, l]) => h('button', { class: `nav-item ${id === tab ? 'active' : ''}`, on: { click: () => { tab = id; render(); } } }, l)));
    if (tab === 'jobs') mount(main, jobsView());
    else if (tab === 'new') mount(main, h('h2', null, 'Yeni gönderim'), newForm());
    else if (tab === 'subs') mount(main, subsView());
    else { const c = chatBox(s, `dr_${did}`, me?.name ? String(me.name) : s.user.email ?? 'Hekim'); stopChat = c.stop; mount(main, h('h2', null, 'Laboratuvarla mesajlaşma'), c.el); }
  }
  const onErr = (e: Error) => { mount(main, empty(`Veriler yüklenemedi: ${e.message}`)); };
  // Aktif filtre alanı odaktayken liste yenilenmesin (yazarken odak kaybolmasın).
  const typing = () => !!document.activeElement?.closest('.filters');
  listenDoc(s.lab, 'doctors', did, (r) => { const first = me === null; me = r; if (first && tab === 'new') render(); });
  listen(s.lab, 'jobs', (r) => { jobs = r; if ((tab === 'jobs' && !typing()) || tab === 'subs') render(); }, [byField('doctorId', did)], onErr);
  listen(s.lab, 'doctorSubmissions', (r) => { subs = r; if (tab === 'subs') render(); }, [byField('doctorId', did)], onErr);
  render();
});
