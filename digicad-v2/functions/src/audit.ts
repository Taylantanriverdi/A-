import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './util';
import { AUDITED, kindOf, actorOf, pack } from './auditLogic';

/**
 * labs/{lab}/{coll}/{id} (4 segment). history alt koleksiyonu 6 segmenttir ve auditLog AUDITED dışındadır,
 * bu yüzden tetikleyicinin kendi yazdıkları onu yeniden tetiklemez (sonsuz döngü yok).
 * retry:true: geçici hatada olay yeniden denenir; belge kimliği = event.id olduğu için idempotent.
 */
export const onRecordWritten = onDocumentWritten({ document: 'labs/{lab}/{coll}/{id}', region: REGION, retry: true, maxInstances: 20 }, async (event) => {
  const { lab, coll, id } = event.params;
  if (!AUDITED.includes(coll)) return;
  const before = event.data?.before.exists ? event.data.before.data() ?? null : null;
  const after = event.data?.after.exists ? event.data.after.data() ?? null : null;
  const kind = kindOf(before, after);
  const actor = actorOf(before, after);
  const at = event.time ? Timestamp.fromDate(new Date(event.time)) : FieldValue.serverTimestamp();
  const db = getFirestore();
  const eventId = event.id;
  const hist = pack(before, null, false);
  const aud = pack(before, after, true);
  if (hist.oversize || aud.oversize) console.error('Geçmiş kaydı 1 MiB sınırına yakın/aşıyor', lab, coll, id, eventId);
  const batch = db.batch();
  batch.set(db.doc(`labs/${lab}/${coll}/${id}/history/${eventId}`), {
    at, kind, before: hist.before, actor,
    ...(hist.compressed?.before ? { beforeGz: hist.compressed.before } : {}), ...(hist.oversize ? { oversize: true } : {}),
  });
  batch.set(db.doc(`labs/${lab}/auditLog/${eventId}`), {
    at, coll, id, kind, actor, actorNote: 'actor istemci beyanıdır; kesin kimlik için Cloud Audit Logs',
    before: aud.before, after: aud.after,
    ...(aud.compressed?.before ? { beforeGz: aud.compressed.before } : {}), ...(aud.compressed?.after ? { afterGz: aud.compressed.after } : {}),
    ...(aud.oversize ? { oversize: true } : {}),
  });
  await batch.commit();
});

/** Sohbet mesajları: yalnızca değişiklik/silme olayları auditLog'a (create gürültü olduğu için atlanır). */
export const onMessageWritten = onDocumentWritten({ document: 'labs/{lab}/threads/{tid}/messages/{mid}', region: REGION, retry: true, maxInstances: 10 }, async (event) => {
  const { lab, tid, mid } = event.params;
  const before = event.data?.before.exists ? event.data.before.data() ?? null : null;
  const after = event.data?.after.exists ? event.data.after.data() ?? null : null;
  const kind = kindOf(before, after);
  if (kind === 'create') return;
  const p = pack(before, after, true);
  const at = event.time ? Timestamp.fromDate(new Date(event.time)) : FieldValue.serverTimestamp();
  await getFirestore().doc(`labs/${lab}/auditLog/${event.id}`).set({
    at, coll: 'threads/messages', id: `${tid}/${mid}`, kind, actor: actorOf(before, after),
    actorNote: 'actor istemci beyanıdır; kesin kimlik için Cloud Audit Logs', before: p.before, after: p.after,
    ...(p.compressed?.before ? { beforeGz: p.compressed.before } : {}), ...(p.compressed?.after ? { afterGz: p.compressed.after } : {}),
  });
});
