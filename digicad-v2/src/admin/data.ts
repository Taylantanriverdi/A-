/**
 * Yazma işlemleri: yarış durumu olan her akış transaction ile (durum yeniden okunup doğrulanır),
 * çok kayıtlı akışlar atomik batch ile. Fiziksel silme YOK (kurallar da reddeder).
 * Yazılan her alan firestore.rules ile uyumludur: jobs → validJob (doctorId, geçerli status), threads/messages → senderUid/senderRole, mesaj silme → yalnızca deletedAt/deletedBy.
 */
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { colPath, type Rec } from '../lib/store';
import type { Session } from '../lib/auth';
import { doctorIdOf, type ClosurePlan, type Op, type R } from './calc';

const nowIso = (): string => new Date().toISOString();
const clean = <T extends Record<string, unknown>>(o: T): T => JSON.parse(JSON.stringify(o)); // undefined alanları atılır, null korunur
const stamp = (s: Session) => ({ updatedAt: nowIso(), updatedBy: s.user.uid });
const ref = (s: Session, name: string, id: string | number) => doc(db, colPath(s.lab, name), String(id));

/** Firestore batch sınırı 500; güvenli parçalara bölünür. Her parça atomiktir. */
async function runBatches(items: ((b: ReturnType<typeof writeBatch>) => void)[]): Promise<void> {
  for (let i = 0; i < items.length; i += 400) { const b = writeBatch(db); items.slice(i, i + 400).forEach((f) => f(b)); await b.commit(); }
}

/** Sipariş kayıtlarını yazar. Hekim gönderiminden aktarılıyorsa gönderim durumu 'Yeni' olduğu doğrulanarak AYNI transaction'da 'Aktarıldı' yapılır (çift aktarım olmaz). */
export async function createOrder(s: Session, ops: Op[], submissionId: string | null): Promise<void> {
  const create = { createdAt: nowIso(), createdBy: s.user.uid, ...stamp(s) };
  if (!submissionId) { await runBatches(ops.map((o) => (b) => b.set(ref(s, o.name, o.id), { ...clean(o.data), ...create }))); return; }
  await runTransaction(db, async (tx) => {
    const sref = ref(s, 'doctorSubmissions', submissionId); const sn = await tx.get(sref);
    if (!sn.exists() || sn.data().status !== 'Yeni') throw new Error('Bu hekim gönderimi zaten işlenmiş (aktarılmış veya reddedilmiş).');
    for (const o of ops) tx.set(ref(s, o.name, o.id), { ...clean(o.data), ...create });
    tx.update(sref, { status: 'Aktarıldı', transferredAt: nowIso(), transferredJobIds: ops.filter((o) => o.name !== 'orderForms').map((o) => o.id), ...stamp(s) });
  });
}

/** Durum denetimli kayıt geçişi (Yeni→Reddedildi, Onay Bekliyor→Reddedildi vb.). */
export async function transition(s: Session, name: string, id: string, from: string, to: string, extra: R = {}): Promise<void> {
  await runTransaction(db, async (tx) => {
    const r = ref(s, name, id); const sn = await tx.get(r);
    if (!sn.exists()) throw new Error('Kayıt bulunamadı.');
    if (sn.data().status !== from) throw new Error(`Kayıt artık "${from}" durumunda değil (başka biri işlemiş olabilir).`);
    tx.update(r, { status: to, ...clean(extra), ...stamp(s) });
  });
}

/** Onay Bekleyen → iş. Pending'in güncel hali transaction içinde okunur; zaten onaylandıysa/reddedildiyse hata. */
export async function approvePending(s: Session, id: string, build: (p: Rec) => R): Promise<void> {
  await runTransaction(db, async (tx) => {
    const pref = ref(s, 'pendingJobs', id); const jref = ref(s, 'jobs', id);
    const [ps, js] = await Promise.all([tx.get(pref), tx.get(jref)]);
    if (!ps.exists()) throw new Error('Kayıt bulunamadı.');
    if (ps.data().status !== 'Onay Bekliyor') throw new Error('Kayıt artık "Onay Bekliyor" durumunda değil.');
    if (js.exists()) throw new Error('Bu kayıttan zaten bir iş oluşturulmuş.');
    const job = build({ ...(ps.data() as DocumentData), id });
    tx.set(jref, { ...clean(job), createdAt: nowIso(), createdBy: s.user.uid, ...stamp(s) });
    tx.update(pref, { status: 'Onaylandı', approvedJobId: id, approvedAt: nowIso(), ...stamp(s) });
  });
}

/** İşi transaction içinde okuyup `fn`'nin döndürdüğü yamayı uygular (null → değişiklik yok). */
export async function mutateJob(s: Session, id: string, fn: (job: R) => R | null): Promise<R | null> {
  return runTransaction(db, async (tx) => {
    const r = ref(s, 'jobs', id); const sn = await tx.get(r);
    if (!sn.exists()) throw new Error('İş bulunamadı.');
    const job = { ...(sn.data() as DocumentData), id } as R;
    const patch = fn(job); if (!patch) return null;
    tx.update(r, { ...clean(patch), ...(job.doctorId ? {} : { doctorId: doctorIdOf(job) }), ...stamp(s) });
    return patch;
  });
}

/** Dönem kapatma: kapanış kaydı + işaretlenen iş/tahsilatlar + devreden bakiye satırları. */
export async function closeStatement(s: Session, plan: ClosurePlan): Promise<void> {
  const t = { createdAt: nowIso(), createdBy: s.user.uid, ...stamp(s) };
  await runBatches([
    (b) => b.set(ref(s, 'statementClosures', String(plan.closure.id)), { ...clean(plan.closure), ...t }),
    ...plan.jobIds.map((id) => (b: ReturnType<typeof writeBatch>) => b.update(ref(s, 'jobs', id), { closureId: String(plan.closure.id), ...stamp(s) })),
    ...plan.payIds.map((id) => (b: ReturnType<typeof writeBatch>) => b.update(ref(s, 'payments', id), { closureId: String(plan.closure.id), ...stamp(s) })),
    ...plan.carryJobs.map((j) => (b: ReturnType<typeof writeBatch>) => b.set(ref(s, 'jobs', String(j.id)), { ...clean(j), ...t })),
  ]);
}
/** Dönem kapatmayı geri alır (kayıt silinmez: kapanış 'deleted', devreden satırlar yumuşak silinir). */
export async function undoClosure(s: Session, closure: Rec, carryJobIds: string[]): Promise<void> {
  const cid = String(closure.id); const del = { deleted: true, deletedAt: nowIso(), deletedBy: s.user.uid, ...stamp(s) };
  await runBatches([
    ...((closure.jobIds ?? []) as string[]).map((id) => (b: ReturnType<typeof writeBatch>) => b.update(ref(s, 'jobs', id), { closureId: null, ...stamp(s) })),
    ...((closure.paymentIds ?? []) as string[]).map((id) => (b: ReturnType<typeof writeBatch>) => b.update(ref(s, 'payments', id), { closureId: null, ...stamp(s) })),
    ...carryJobIds.map((id) => (b: ReturnType<typeof writeBatch>) => b.update(ref(s, 'jobs', id), del)),
    (b) => b.update(ref(s, 'statementClosures', cid), del),
  ]);
}

/** Dosya listesi güncelle (iş belgesinde); Storage nesnesi silinmez. */
export const setJobFiles = (s: Session, id: string, field: 'files' | 'designFiles', files: unknown[]): Promise<void> =>
  updateDoc(ref(s, 'jobs', id), { [field]: clean({ v: files }).v, ...(field === 'designFiles' ? { designFilesUpdatedAt: nowIso() } : {}), ...stamp(s) });

/** Hekim fiyat listesi (doctors/{id}.prices) */
export const setDoctorPrices = (s: Session, id: string, prices: unknown[]): Promise<void> => updateDoc(ref(s, 'doctors', id), { prices: clean({ v: prices }).v, ...stamp(s) });

export async function jobHistory(s: Session, id: string): Promise<R[]> {
  const sn = await getDocs(query(collection(db, `${colPath(s.lab, 'jobs')}/${id}/history`), orderBy('at', 'desc'), limit(40)));
  return sn.docs.map((d) => ({ ...(d.data() as DocumentData), id: d.id }));
}

/* ---------- Sohbet ---------- */
const msgCol = (s: Session, tid: string) => collection(db, `${colPath(s.lab, 'threads')}/${tid}/messages`);
export function watchMessages(s: Session, tid: string, cb: (rows: Rec[]) => void, onErr: (e: Error) => void): () => void {
  return onSnapshot(query(msgCol(s, tid), orderBy('timestamp'), limit(300)), (sn) => cb(sn.docs.map((d) => ({ ...(d.data() as DocumentData), id: d.id }))), onErr);
}
export async function postMessage(s: Session, tid: string, text: string, file?: { path: string; name: string }): Promise<void> {
  await addDoc(msgCol(s, tid), { text: text || '(ek)', senderUid: s.user.uid, senderRole: 'admin', senderName: 'Laboratuvar', timestamp: nowIso(), ...(file ? { filePath: file.path, fileName: file.name } : {}) });
  await setDoc(doc(db, colPath(s.lab, 'threads'), tid), { updatedAt: nowIso() }, { merge: true });
}
/** Kurallar: yalnızca deletedAt/deletedBy alanları değişebilir (updatedAt YAZILMAZ). */
export const hideMessage = (s: Session, tid: string, mid: string): Promise<void> => updateDoc(doc(db, `${colPath(s.lab, 'threads')}/${tid}/messages`, mid), { deletedAt: nowIso(), deletedBy: s.user.uid });

/* ---------- Mail filtreleri: arrayUnion/arrayRemove ile atomik (iki yönetici aynı anda eklerse biri ezilmez) ---------- */
export const addMailFilter = (s: Session, v: string): Promise<void> => setDoc(ref(s, 'mailFilters', 'main'), { id: 'main', items: arrayUnion(v), ...stamp(s) }, { merge: true });
export const removeMailFilter = (s: Session, v: string): Promise<void> => setDoc(ref(s, 'mailFilters', 'main'), { id: 'main', items: arrayRemove(v), ...stamp(s) }, { merge: true });
