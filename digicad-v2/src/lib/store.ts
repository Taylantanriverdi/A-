import {
  collection, doc, onSnapshot, setDoc, updateDoc, query, where, serverTimestamp, writeBatch, orderBy, limit,
  type QueryConstraint, type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Session } from './auth';

export type Rec = { id: string; [k: string]: any };  

export const colPath = (lab: string, name: string): string => `labs/${lab}/${name}`;

/** Canlı dinleyici; `where` ile hekim/teknisyen kısıtları (kurallar da zorunlu kılar). */
export function listen(lab: string, name: string, cb: (rows: Rec[]) => void, constraints: QueryConstraint[] = [], onErr?: (e: Error) => void): () => void {
  const q = query(collection(db, colPath(lab, name)), ...constraints);
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ ...(d.data() as DocumentData), id: d.id }))), (e) => onErr?.(e));
}
export const byField = (f: string, v: unknown): QueryConstraint => where(f, '==', v);
export const recent = (f: string, n = 200): QueryConstraint[] => [orderBy(f, 'desc'), limit(n)];

const clean = <T extends Record<string, unknown>>(o: T): T => JSON.parse(JSON.stringify(o)); // undefined alanlarını at

/** Kayıt yaz/güncelle (merge). Fiziksel silme YOKTUR. */
export async function put(s: Session, name: string, id: string | number, data: Record<string, unknown>, isNew = false): Promise<void> {
  const body = { ...clean(data), updatedAt: new Date().toISOString(), updatedBy: s.user.uid, ...(isNew ? { createdAt: new Date().toISOString(), createdBy: s.user.uid } : {}) };
  await setDoc(doc(db, colPath(s.lab, name), String(id)), body, { merge: true });
}
export async function patch(s: Session, name: string, id: string | number, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, colPath(s.lab, name), String(id)), { ...clean(data), updatedAt: new Date().toISOString(), updatedBy: s.user.uid });
}
export async function softDelete(s: Session, name: string, id: string | number): Promise<void> {
  await updateDoc(doc(db, colPath(s.lab, name), String(id)), { deleted: true, deletedAt: new Date().toISOString(), deletedBy: s.user.uid, updatedAt: new Date().toISOString(), updatedBy: s.user.uid });
}
export async function restore(s: Session, name: string, id: string | number): Promise<void> {
  await updateDoc(doc(db, colPath(s.lab, name), String(id)), { deleted: false, deletedAt: null, deletedBy: null, updatedAt: new Date().toISOString(), updatedBy: s.user.uid });
}
export async function putMany(s: Session, ops: { name: string; id: string | number; data: Record<string, unknown> }[]): Promise<void> {
  const b = writeBatch(db);
  for (const o of ops) b.set(doc(db, colPath(s.lab, o.name), String(o.id)), { ...clean(o.data), updatedAt: new Date().toISOString(), updatedBy: s.user.uid, createdAt: new Date().toISOString(), createdBy: s.user.uid }, { merge: true });
  await b.commit();
}
export const newId = (): string => String(Date.now()) + String(Math.floor(Math.random() * 900 + 100));
export const stamp = serverTimestamp;
