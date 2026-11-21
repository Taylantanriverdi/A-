import '../style.css';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { byField, listen, newId, put, type Rec } from '../lib/store';
import { shell, table, field, input, textarea, select, btn, guard, badge, val } from '../lib/ui';
import { fmtDate, STATUS_ICONS } from '../lib/format';
import { upload, type FileRef } from '../lib/files';
import { chatBox } from '../lib/chatbox';

gate(['doctor'], 'Hekim Portalı', (s: Session, root) => {
  const did = s.doctorId as string; let jobs: Rec[] = []; let subs: Rec[] = []; let tab = 'jobs'; let stopChat: (() => void) | undefined;
  const nav = h('div'); const { root: ui, main } = shell('Hekim Portalı', nav, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const TABS: [string, string][] = [['jobs', '📋 İşlerim'], ['new', '➕ Yeni gönderim'], ['subs', '📥 Gönderimlerim'], ['chat', '💬 Laboratuvarla yaz']];

  function newForm(): HTMLElement {
    const f = h('form', { class: 'card', on: { submit: (e) => e.preventDefault() } }, field('Hasta adı', input('patient', 'text', '', { required: true, maxlength: 300 })),
      field('İş türü', input('jobType', 'text', '', { required: true, maxlength: 200 })), field('Dişler (örn. 11,12,21)', input('teeth')), field('Diş rengi', input('color', 'text', '', { maxlength: 40 })),
      field('Çene', select('jaw', [['ust', 'Üst'], ['alt', 'Alt'], ['her', 'Her ikisi']])), field('Notlar', textarea('notes')), field('Tarama dosyaları (STL/ZIP/PDF/görsel)', h('input', { type: 'file', name: 'files', multiple: true })));
    f.append(btn('Gönder', () => void guard(async () => {
      const patient = val(f, 'patient'), jobType = val(f, 'jobType'); const picked = Array.from((f.querySelector('input[name=files]') as HTMLInputElement).files ?? []);
      if (!patient || !jobType) throw new Error('Hasta adı ve iş türü zorunlu.'); if (!picked.length) throw new Error('En az bir tarama dosyası ekleyin.');
      const up: FileRef[] = []; for (const file of picked) up.push(await upload(`labs/${s.lab}/submissions/${did}`, file, s.user.uid));
      const id = newId(); const teeth = val(f, 'teeth').split(',').map((x) => x.trim()).filter(Boolean);
      await put(s, 'doctorSubmissions', id, { id, doctorId: did, drId: did, patient, jobType, teeth, jaw: val(f, 'jaw'), color: val(f, 'color'), notes: val(f, 'notes'), files: up, status: 'Yeni', source: 'hekim-portal' }, true);
      f.reset(); tab = 'subs'; render();
    }, 'Gönderildi'), 'btn primary'));
    return f;
  }
  function render(): void {
    stopChat?.(); stopChat = undefined;
    mount(nav, TABS.map(([id, l]) => h('button', { class: `nav-item ${id === tab ? 'active' : ''}`, on: { click: () => { tab = id; render(); } } }, l)));
    if (tab === 'jobs') mount(main, h('h2', null, 'İşlerim'), table([{ head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => j.type }, { head: 'Teslim', cell: (j: Rec) => fmtDate(j.dateout) }, { head: 'Durum', cell: (j: Rec) => `${STATUS_ICONS[j.status] ?? ''} ${j.status}` }], jobs.filter((j) => !j.deleted)));
    else if (tab === 'new') mount(main, h('h2', null, 'Yeni gönderim'), newForm());
    else if (tab === 'subs') mount(main, h('h2', null, 'Gönderimlerim'), table([{ head: 'Tarih', cell: (r: Rec) => fmtDate(r.createdAt) }, { head: 'Hasta', cell: (r: Rec) => r.patient }, { head: 'İş', cell: (r: Rec) => r.jobType }, { head: 'Durum', cell: (r: Rec) => badge(String(r.status)) }], subs));
    else { const c = chatBox(s, `dr_${did}`, s.user.email ?? 'Hekim'); stopChat = c.stop; mount(main, h('h2', null, 'Laboratuvarla mesajlaşma'), c.el); }
  }
  listen(s.lab, 'jobs', (r) => { jobs = r; if (tab === 'jobs') render(); }, [byField('doctorId', did)]);
  listen(s.lab, 'doctorSubmissions', (r) => { subs = r; if (tab === 'subs') render(); }, [byField('doctorId', did)]);
  render();
});
