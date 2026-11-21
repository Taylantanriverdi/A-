import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Geçmişi tutulan koleksiyonlar (klinik + finans + yönetim). */
const AUDITED = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures', 'settings', 'mailFilters'];

export const onRecordWritten = onDocumentWritten({ document: 'labs/{lab}/{coll}/{id}', region: 'europe-west1' }, async (event) => {
  const { lab, coll, id } = event.params;
  if (!AUDITED.includes(coll)) return;
  const before = event.data?.before.exists ? event.data.before.data() ?? null : null;
  const after = event.data?.after.exists ? event.data.after.data() ?? null : null;
  const kind = !before ? 'create' : !after ? 'DELETE-ALERT' : 'update';
  const actor = (after?.deletedBy ?? after?.updatedBy ?? after?.createdBy ?? null) as string | null;
  const db = getFirestore();
  const eventId = event.id; // yeniden denemelerde idempotent
  const batch = db.batch();
  batch.set(db.doc(`labs/${lab}/${coll}/${id}/history/${eventId}`), { at: FieldValue.serverTimestamp(), kind, before, actor });
  batch.set(db.doc(`labs/${lab}/auditLog/${eventId}`), { at: FieldValue.serverTimestamp(), coll, id, kind, actor, actorNote: 'actor istemci beyanıdır; kesin kimlik için Cloud Audit Logs', before, after });
  await batch.commit();
});
