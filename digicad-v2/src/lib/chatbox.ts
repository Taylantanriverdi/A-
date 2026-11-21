import { addDoc, collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { colPath } from './store';
import { h, type Child } from './dom';
import { fmtDate } from './format';
import { upload, downloadUrl } from './files';
import { btn, guard } from './ui';
import type { Session } from './auth';

/** Hekim/teknisyen mesajlaşma kutusu. Mesajlar yalnızca textContent ile çizilir. */
export function chatBox(s: Session, threadId: string, who: string): { el: HTMLElement; stop: () => void } {
  const msgs = h('div', { class: 'chat-msgs' }); const inp = h('input', { type: 'text', maxlength: 4000, placeholder: 'Mesajınız…' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf' });
  const stop = onSnapshot(query(collection(db, `${colPath(s.lab, 'threads')}/${threadId}/messages`), orderBy('timestamp')), (sn) => {
    msgs.replaceChildren(...sn.docs.filter((d) => !d.data().deletedAt).map((d) => { const m = d.data(); const kids: Child[] = [h('small', null, `${m.senderName ?? m.senderRole} · ${fmtDate(m.timestamp)}`), h('div', null, String(m.text ?? ''))];
      if (m.filePath) kids.push(h('button', { class: 'btn ghost', on: { click: () => void guard(async () => { window.open(await downloadUrl(String(m.filePath)), '_blank', 'noopener'); }) } }, `📎 ${m.fileName ?? 'ek'}`));
      return h('div', { class: `msg ${m.senderUid === s.user.uid ? 'me' : ''}` }, kids); }));
    msgs.scrollTop = msgs.scrollHeight;
  }, () => { /* izin yoksa boş kalır */ });
  const send = () => void guard(async () => {
    const text = inp.value.trim(); const f = file.files?.[0]; if (!text && !f) return;
    const extra = f ? await upload(`labs/${s.lab}/chat/${threadId}`, f, s.user.uid, 25).then((r) => ({ filePath: r.path, fileName: r.name })) : {};
    await addDoc(collection(db, `${colPath(s.lab, 'threads')}/${threadId}/messages`), { text: text || '(ek)', senderUid: s.user.uid, senderRole: s.role, senderName: who, timestamp: new Date().toISOString(), ...extra });
    await setDoc(doc(db, colPath(s.lab, 'threads'), threadId), { updatedAt: new Date().toISOString() }, { merge: true });
    inp.value = ''; file.value = '';
  });
  return { el: h('div', { class: 'chat-conv' }, msgs, h('div', { class: 'row' }, inp, file, btn('Gönder', send, 'btn primary'))), stop };
}
