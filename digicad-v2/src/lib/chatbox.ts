import { addDoc, collection, doc, onSnapshot, orderBy, query, setDoc, limitToLast } from 'firebase/firestore';
import { db } from './firebase';
import { colPath } from './store';
import { h, type Child } from './dom';
import { fmtDateTime } from './format';
import { upload, openFile, MAX_CHAT_MB } from './files';
import { btn, errMsg, guard, withBusy } from './ui';
import type { Session } from './auth';

/** Hekim/teknisyen mesajlaşma kutusu. Mesajlar yalnızca textContent ile çizilir; son 300 mesaj izlenir. */
export function chatBox(s: Session, threadId: string, who: string): { el: HTMLElement; stop: () => void } {
  const msgs = h('div', { class: 'chat-msgs', role: 'log', 'aria-live': 'polite' });
  const inp = h('input', { type: 'text', maxlength: 4000, placeholder: 'Mesajınız…', 'aria-label': 'Mesaj' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf', 'aria-label': 'Ek dosya' });
  const msgPath = `${colPath(s.lab, 'threads')}/${threadId}/messages`;
  const stop = onSnapshot(query(collection(db, msgPath), orderBy('timestamp'), limitToLast(300)), (sn) => {
    const rows = sn.docs.filter((d) => !d.data().deletedAt);
    msgs.replaceChildren(...(rows.length ? rows.map((d) => {
      const m = d.data();
      const kids: Child[] = [h('small', { class: 'muted' }, `${m.senderName ?? m.senderRole} · ${fmtDateTime(m.timestamp)}`), h('div', null, String(m.text ?? ''))];
      if (m.filePath) kids.push(btn(`📎 ${m.fileName ?? 'ek'}`, () => void guard(() => openFile(String(m.filePath))), 'btn ghost'));
      return h('div', { class: `msg ${m.senderUid === s.user.uid ? 'me' : ''}` }, kids);
    }) : [h('p', { class: 'muted' }, 'Henüz mesaj yok.')]));
    msgs.scrollTop = msgs.scrollHeight;
  }, (e) => { msgs.replaceChildren(h('p', { class: 'muted' }, `Mesajlar yüklenemedi: ${errMsg(e)}`)); });
  const sendBtn = btn('Gönder', () => void withBusy(sendBtn, async () => {
    const text = inp.value.trim(); const f = file.files?.[0]; if (!text && !f) return;
    const extra = f ? await upload(`labs/${s.lab}/chat/${threadId}`, f, s.user.uid, MAX_CHAT_MB, { kind: 'chat' }).then((r) => ({ filePath: r.path, fileName: r.name })) : {};
    const now = new Date().toISOString();
    await addDoc(collection(db, msgPath), { text: text || '(ek)', senderUid: s.user.uid, senderRole: s.role, senderName: who, timestamp: now, ...extra });
    await setDoc(doc(db, colPath(s.lab, 'threads'), threadId), { updatedAt: now }, { merge: true });
    inp.value = ''; file.value = '';
  }), 'btn primary');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
  return { el: h('div', { class: 'chat-conv' }, msgs, h('div', { class: 'row' }, inp, file, sendBtn)), stop };
}
