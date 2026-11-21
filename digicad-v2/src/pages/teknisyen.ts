import '../style.css';
import { array } from './_util';
import { gate } from '../lib/gate';
import { h, mount } from '../lib/dom';
import { logout, type Session } from '../lib/auth';
import { listen, newId, patch, put, type Rec } from '../lib/store';
import { shell, table, field, input, textarea, select, btn, guard, val } from '../lib/ui';
import { fmtDate, TECH_STATUSES, STATUS_ICONS } from '../lib/format';
import { upload } from '../lib/files';
import { chatBox } from '../lib/chatbox';

gate(['tech'], 'Teknisyen Paneli', (s: Session, root) => {
  const tid = s.techId as string; let jobs: Rec[] = []; let tab = 'jobs'; let stop: (() => void) | undefined;
  const nav = h('div'); const { root: ui, main } = shell('Teknisyen Paneli', nav, () => void logout(), s.user.email ?? ''); mount(root, ui);
  const TABS: [string, string][] = [['jobs', '📋 İşlerim'], ['quick', '➕ Hızlı iş talebi'], ['chat', '💬 Laboratuvarla yaz']];
  const statusCell = (j: Rec) => { const sel = select('st', TECH_STATUSES.map((x): [string, string] => [x, `${STATUS_ICONS[x]} ${x}`]), String(j.status)); sel.disabled = j.status === 'Tamamlandı';
    sel.addEventListener('change', () => void guard(() => patch(s, 'jobs', j.id, { status: sel.value }), 'Durum güncellendi')); return sel; };
  const designCell = (j: Rec) => { const f = h('input', { type: 'file', multiple: true });
    return h('span', null, f, btn('Yükle', () => void guard(async () => { const list = Array.from(f.files ?? []); if (!list.length) return; const up = []; for (const x of list) up.push(await upload(`labs/${s.lab}/jobFiles/${j.id}`, x, s.user.uid));
      await patch(s, 'jobs', j.id, { designFiles: [...array(j.designFiles), ...up], designFilesUpdatedAt: new Date().toISOString() }); }, 'Dosyalar yüklendi'))); };
  const noteCell = (j: Rec) => { const i = input('techNote', 'text', j.techNote ?? '', { maxlength: 2000 }); return h('span', null, i, btn('Kaydet', () => void guard(() => patch(s, 'jobs', j.id, { techNote: i.value }), 'Not kaydedildi'), 'btn ghost')); };
  function quick(): HTMLElement {
    const f = h('div', { class: 'card' }, field('Hekim adı', input('drName')), field('Hasta', input('patient', 'text', '', { maxlength: 300 })), field('İş türü', input('type')), field('Adet', input('qty', 'number', '1')), field('Teslim', input('dateout', 'date')), field('Not', textarea('note')));
    f.append(btn('Onaya gönder', () => void guard(async () => { const patient = val(f, 'patient'); if (!patient) throw new Error('Hasta adı girin.'); const id = newId();
      await put(s, 'pendingJobs', id, { id, drName: val(f, 'drName'), patient, type: val(f, 'type'), qty: Number(val(f, 'qty')) || 1, dateout: val(f, 'dateout'), note: val(f, 'note'), techId: tid, status: 'Onay Bekliyor', submittedBy: 'tech', submittedAt: new Date().toISOString() }, true);
    }, 'Talep gönderildi'), 'btn primary')); return f;
  }
  function render(): void {
    stop?.(); stop = undefined;
    mount(nav, TABS.map(([id, l]) => h('button', { class: `nav-item ${id === tab ? 'active' : ''}`, on: { click: () => { tab = id; render(); } } }, l)));
    if (tab === 'jobs') mount(main, h('h2', null, 'Bana atanan işler'), table([{ head: 'Hasta', cell: (j: Rec) => j.patient }, { head: 'İş', cell: (j: Rec) => `${j.type} ×${j.qty ?? 1}` }, { head: 'Renk', cell: (j: Rec) => j.toothColor }, { head: 'Teslim', cell: (j: Rec) => fmtDate(j.dateout) }, { head: 'Durum', cell: statusCell }, { head: 'Tasarım dosyası', cell: designCell }, { head: 'Not', cell: noteCell }], jobs.filter((j) => !j.deleted)));
    else if (tab === 'quick') mount(main, h('h2', null, 'Hızlı iş talebi'), quick());
    else { const c = chatBox(s, `tech_${tid}`, s.user.email ?? 'Teknisyen'); stop = c.stop; mount(main, h('h2', null, 'Laboratuvarla mesajlaşma'), c.el); }
  }
  import('firebase/firestore').then(({ where }) => listen(s.lab, 'jobs', (r) => { jobs = r; if (tab === 'jobs' && !document.activeElement?.matches('input')) render(); }, [where('techIds', 'array-contains', tid)]));
  render();
});
