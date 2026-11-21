/** DEMO — `firebase/firestore` taklidi: uygulamanın kullandığı API yüzeyi, bellek içi depo üzerinde. */
import { store, Timestamp, sentinel, splitPath, parentOf, DemoError, clone, type Constraint, type Data, type QueryDef } from './store';

export { Timestamp };
export type DocumentData = Data;
export type QueryConstraint = Constraint;

const DB = { type: 'firestore' as const, app: {} };
export const initializeFirestore = (): typeof DB => DB;
export const getFirestore = (): typeof DB => DB;
export const memoryLocalCache = (): object => ({});
export const persistentLocalCache = (): object => ({});
export const persistentMultipleTabManager = (): object => ({});
export const connectFirestoreEmulator = (): void => undefined;
/** Çıkışta çağrılır; demo'da dinleyicileri kapatmaz (sayfa zaten yeniden yüklenir). */
export const terminate = async (): Promise<void> => undefined;
export const clearIndexedDbPersistence = async (): Promise<void> => undefined;

/* ---------- Referanslar ---------- */
export interface CollRef { type: 'collection'; id: string; path: string; firestore: typeof DB }
export interface DocRef { type: 'document'; id: string; path: string; firestore: typeof DB; parent: CollRef }
export interface QueryRef { type: 'query'; def: QueryDef; firestore: typeof DB }
const mkColl = (path: string): CollRef => ({ type: 'collection', id: splitPath(path).pop() as string, path, firestore: DB });
const mkDoc = (path: string): DocRef => ({ type: 'document', id: splitPath(path).pop() as string, path, firestore: DB, parent: mkColl(parentOf(path).coll) });
const join = (base: unknown, segs: string[]): string => [typeof base === 'object' && base && 'path' in base ? String((base as { path: string }).path) : '', ...segs].filter(Boolean).join('/');

export function collection(base: unknown, ...segs: string[]): CollRef { const p = join(base, segs); if (splitPath(p).length % 2 !== 1) throw new DemoError('invalid-argument', `Geçersiz koleksiyon yolu: ${p}`); return mkColl(p); }
const autoId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
export function doc(base: unknown, ...segs: string[]): DocRef {
  const isColl = typeof base === 'object' && base !== null && (base as { type?: string }).type === 'collection';
  const p = join(base, isColl && !segs.length ? [autoId()] : segs);
  if (splitPath(p).length % 2 !== 0) throw new DemoError('invalid-argument', `Geçersiz belge yolu: ${p}`);
  return mkDoc(p);
}

/* ---------- Sorgu ---------- */
const defOf = (q: CollRef | QueryRef): QueryDef => (q.type === 'collection' ? { path: q.path, constraints: [] } : q.def);
export function query(q: CollRef | QueryRef, ...cs: Constraint[]): QueryRef { const d = defOf(q); return { type: 'query', def: { path: d.path, constraints: [...d.constraints, ...cs] }, firestore: DB }; }
export const where = (field: string, op: string, value: unknown): Constraint => ({ kind: 'where', field, op, value });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });
export const limitToLast = (n: number): Constraint => ({ kind: 'limitToLast', n });

/* ---------- Anlık görüntüler ---------- */
export class DocumentSnapshot {
  constructor(public id: string, public ref: DocRef, private d: Data | undefined) {}
  exists(): boolean { return this.d !== undefined; }
  data(): Data | undefined { return this.d ? clone(this.d) : undefined; }
  get(f: string): unknown { return this.d ? f.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), this.d) : undefined; }
}
export class QuerySnapshot {
  docs: DocumentSnapshot[];
  constructor(rows: { id: string; data: Data }[], path: string) { this.docs = rows.map((r) => new DocumentSnapshot(r.id, mkDoc(`${path}/${r.id}`), r.data)); }
  get size(): number { return this.docs.length; }
  get empty(): boolean { return this.docs.length === 0; }
  forEach(fn: (d: DocumentSnapshot) => void): void { this.docs.forEach(fn); }
}

/* ---------- Okuma ---------- */
export const getDoc = async (r: DocRef): Promise<DocumentSnapshot> => new DocumentSnapshot(r.id, r, store().getDoc(r.path));
export const getDocs = async (q: CollRef | QueryRef): Promise<QuerySnapshot> => { const d = defOf(q); return new QuerySnapshot(store().rows(d), d.path); };

export function onSnapshot(target: DocRef | CollRef | QueryRef, a: unknown, b?: unknown, c?: unknown): () => void {
  const next = (typeof a === 'function' ? a : b) as (s: any) => void; const errCb = (typeof a === 'function' ? b : c) as ((e: Error) => void) | undefined;
  const guarded = <T,>(fn: (x: T) => void) => (x: T): void => { try { fn(x); } catch (e) { if (errCb) errCb(e as Error); else console.error(e); } };
  if (target.type === 'document') return store().listen({ docPath: target.path }, guarded((rows) => next(new DocumentSnapshot(target.id, target, rows[0]?.data))));
  const d = defOf(target);
  return store().listen(d, guarded((rows) => next(new QuerySnapshot(rows, d.path))));
}

/* ---------- Yazma ---------- */
export async function setDoc(r: DocRef, data: Data, opts?: { merge?: boolean }): Promise<void> { store().setDoc(r.path, data, !!opts?.merge); }
export async function updateDoc(r: DocRef, data: Data): Promise<void> { store().updateDoc(r.path, data); }
export async function deleteDoc(r: DocRef): Promise<void> { store().deleteDoc(r.path); }
export async function addDoc(c: CollRef, data: Data): Promise<DocRef> { const r = mkDoc(`${c.path}/${autoId()}`); store().setDoc(r.path, data); return r; }

export class WriteBatch {
  private ops: { kind: 'set' | 'update' | 'delete'; path: string; data?: Data; merge?: boolean }[] = [];
  set(r: DocRef, data: Data, opts?: { merge?: boolean }): this { this.ops.push({ kind: 'set', path: r.path, data, merge: !!opts?.merge }); return this; }
  update(r: DocRef, data: Data): this { this.ops.push({ kind: 'update', path: r.path, data }); return this; }
  delete(r: DocRef): this { this.ops.push({ kind: 'delete', path: r.path }); return this; }
  async commit(): Promise<void> { store().commit(this.ops); }
}
export const writeBatch = (): WriteBatch => new WriteBatch();

export async function runTransaction<T>(_db: unknown, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = new Transaction(); const result = await fn(tx); store().commit(tx.ops); return result;
}
export class Transaction {
  ops: { kind: 'set' | 'update' | 'delete'; path: string; data?: Data; merge?: boolean }[] = [];
  async get(r: DocRef): Promise<DocumentSnapshot> { return getDoc(r); }
  set(r: DocRef, data: Data, opts?: { merge?: boolean }): this { this.ops.push({ kind: 'set', path: r.path, data, merge: !!opts?.merge }); return this; }
  update(r: DocRef, data: Data): this { this.ops.push({ kind: 'update', path: r.path, data }); return this; }
  delete(r: DocRef): this { this.ops.push({ kind: 'delete', path: r.path }); return this; }
}

/* ---------- Özel değerler ---------- */
export const serverTimestamp = (): unknown => sentinel('serverTimestamp');
export const arrayUnion = (...xs: unknown[]): unknown => sentinel('arrayUnion', xs);
export const arrayRemove = (...xs: unknown[]): unknown => sentinel('arrayRemove', xs);
export const increment = (n: number): unknown => sentinel('increment', n);
export const deleteField = (): unknown => sentinel('deleteField');
