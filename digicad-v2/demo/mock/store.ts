/**
 * DEMO — bellek içi belge deposu (Firestore'un yerine). Gerçek Firebase'e hiçbir çağrı yapmaz.
 * Veri yolu → belge eşlemesi tutar; değişiklikte tüm dinleyicileri (onSnapshot) yeniden değerlendirir.
 * İsteğe bağlı olarak yalnızca DEMO verisini localStorage'a yazar (sayfalar arası paylaşım için).
 */
import { buildSeed, SEED_VERSION } from '../seed';

import { Timestamp } from './timestamp';
export { Timestamp };

export type Sentinel = { __sentinel: 'serverTimestamp' | 'arrayUnion' | 'arrayRemove' | 'increment' | 'deleteField'; arg?: unknown };
const isSentinel = (v: unknown): v is Sentinel => !!v && typeof v === 'object' && '__sentinel' in (v as object);
const DELETE = Symbol('delete');
export type Data = Record<string, any>;
const isPlain = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !isSentinel(v);

export function clone<T>(v: T): T {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds) as unknown as T;
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T;
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  if (v && typeof v === 'object') { const o: Data = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = clone(x); return o as T; }
  return v;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function resolveValue(prev: unknown, v: unknown, now: Timestamp): unknown {
  if (isSentinel(v)) {
    switch (v.__sentinel) {
      case 'serverTimestamp': return now;
      case 'deleteField': return DELETE;
      case 'increment': return (typeof prev === 'number' ? prev : 0) + Number(v.arg);
      case 'arrayUnion': { const base = Array.isArray(prev) ? [...prev] : []; for (const x of v.arg as unknown[]) if (!base.some((y) => same(y, x))) base.push(clone(x)); return base; }
      case 'arrayRemove': return (Array.isArray(prev) ? prev : []).filter((y) => !(v.arg as unknown[]).some((x) => same(y, x)));
    }
  }
  if (isPlain(v)) return mergeObject(isPlain(prev) ? prev : {}, v, now, false);
  return clone(v);
}
/** `merge:false` iken yalnızca gelen anahtarlar; `merge:true` iken mevcut alanlar korunur. */
function mergeObject(prev: Data, incoming: Data, now: Timestamp, keepPrev: boolean): Data {
  const out: Data = keepPrev ? clone(prev) : {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    const r = resolveValue(keepPrev || isPlain(v) ? prev[k] : undefined, v, now);
    if (r === DELETE) delete out[k];
    else if (isPlain(v) && keepPrev && isPlain(prev[k])) out[k] = mergeObject(prev[k], v, now, true);
    else out[k] = r;
  }
  return out;
}

export const splitPath = (p: string): string[] => p.split('/').filter(Boolean);
export const parentOf = (docPath: string): { coll: string; id: string } => { const s = splitPath(docPath); return { coll: s.slice(0, -1).join('/'), id: s[s.length - 1] }; };

export class DemoError extends Error { constructor(public code: string, message: string) { super(message); } }

type Constraint = { kind: 'where'; field: string; op: string; value: unknown } | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' } | { kind: 'limit'; n: number } | { kind: 'limitToLast'; n: number };
export interface QueryDef { path: string; constraints: Constraint[] }

const fieldOf = (d: Data, f: string): unknown => f.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), d);
const rank = (v: unknown): number => (v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : v instanceof Timestamp ? 3 : typeof v === 'string' ? 4 : 5);
function cmp(a: unknown, b: unknown): number {
  const ra = rank(a); const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a instanceof Timestamp && b instanceof Timestamp) return a.toMillis() - b.toMillis();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return 0;
}
const eq = (a: unknown, b: unknown): boolean => (a instanceof Timestamp && b instanceof Timestamp ? a.toMillis() === b.toMillis() : same(a, b));

function matches(d: Data, c: Extract<Constraint, { kind: 'where' }>): boolean {
  const v = fieldOf(d, c.field);
  if (v === undefined) return false; // alanı olmayan belge, o alana göre süzülen sorguda çıkmaz (Firestore ile aynı)
  switch (c.op) {
    case '==': return eq(v, c.value);
    case '!=': return !eq(v, c.value);
    case '<': return rank(v) === rank(c.value) && cmp(v, c.value) < 0;
    case '<=': return rank(v) === rank(c.value) && cmp(v, c.value) <= 0;
    case '>': return rank(v) === rank(c.value) && cmp(v, c.value) > 0;
    case '>=': return rank(v) === rank(c.value) && cmp(v, c.value) >= 0;
    case 'in': return (c.value as unknown[]).some((x) => eq(v, x));
    case 'not-in': return !(c.value as unknown[]).some((x) => eq(v, x));
    case 'array-contains': return Array.isArray(v) && v.some((x) => eq(x, c.value));
    case 'array-contains-any': return Array.isArray(v) && v.some((x) => (c.value as unknown[]).some((y) => eq(x, y)));
    default: throw new DemoError('invalid-argument', `Desteklenmeyen operatör: ${c.op}`);
  }
}

const KEY = 'digicad-demo-data';
interface Listener { def: QueryDef | { docPath: string }; cb: (rows: { id: string; data: Data }[]) => void; last: string }

class DemoStore {
  private colls = new Map<string, Map<string, Data>>();
  private listeners = new Set<Listener>();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Başlangıç tohumu yüklenirken denetim/geçmiş kaydı üretme. */
  hooks = false;

  constructor() {
    let loaded = false;
    try { const raw = localStorage.getItem(KEY); if (raw) loaded = this.load(raw); } catch { /* localStorage kapalı olabilir */ }
    if (!loaded) this.seed();
    this.hooks = true;
    try { window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { try { if (this.load(e.newValue)) this.scheduleNotify(); } catch { /* yok say */ } } }); } catch { /* yok say */ }
  }

  seed(): void {
    this.colls.clear();
    for (const [path, id, data] of buildSeed()) this.coll(path).set(id, data);
  }
  private load(raw: string): boolean {
    const j = JSON.parse(raw, (_k, v) => (v && typeof v === 'object' && '__ts' in v && Object.keys(v).length === 1 ? Timestamp.fromMillis(v.__ts) : v)) as { v: string; colls: [string, [string, Data][]][] };
    if (j.v !== SEED_VERSION) return false;
    this.colls = new Map(j.colls.map(([p, rows]) => [p, new Map(rows)]));
    return true;
  }
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify({ v: SEED_VERSION, colls: [...this.colls].map(([p, m]) => [p, [...m]]) })); } catch { /* kota/yasak: bellekte devam */ }
    }, 250);
  }
  /** Demo verisini başlangıç haline döndürür (kayıtlı kopya silinir). */
  reset(): void { try { localStorage.removeItem(KEY); } catch { /* yok say */ } clearTimeout(this.saveTimer); this.seed(); this.scheduleNotify(); }

  private coll(path: string): Map<string, Data> { let m = this.colls.get(path); if (!m) { m = new Map(); this.colls.set(path, m); } return m; }
  getDoc(docPath: string): Data | undefined { const { coll, id } = parentOf(docPath); const d = this.colls.get(coll)?.get(id); return d ? clone(d) : undefined; }

  /** Tek belge yazımı (set/update/delete sonrası ortak). */
  private put(docPath: string, next: Data | null, kind: 'create' | 'update' | 'delete'): void {
    const { coll, id } = parentOf(docPath); const before = this.colls.get(coll)?.get(id);
    if (next === null) this.coll(coll).delete(id); else this.coll(coll).set(id, next);
    if (this.hooks && next) this.audit(coll, id, before, next, kind);
  }
  private audit(coll: string, id: string, before: Data | undefined, after: Data, kind: string): void {
    const s = splitPath(coll); if (s.length !== 3 || s[0] !== 'labs' || ['auditLog', 'threads'].includes(s[2])) return;
    const lab = s[1]; const now = Timestamp.now(); const actor = String(after.updatedBy ?? 'demo');
    const aid = `a${now.toMillis()}${Math.floor(Math.random() * 1000)}`;
    this.coll(`labs/${lab}/auditLog`).set(aid, { id: aid, at: now, coll: s[2], docId: id, kind, actor, ...(after.status ? { status: String(after.status) } : {}) });
    if (s[2] === 'jobs') this.coll(`${coll}/${id}/history`).set(aid, { id: aid, at: now, kind, actor, before: { status: before?.status ?? '', techName: before?.techName ?? '' } });
  }

  setDoc(path: string, data: Data, merge = false): void {
    const now = Timestamp.now(); const prev = this.getDoc(path);
    this.put(path, merge && prev ? mergeObject(prev, data, now, true) : mergeObject({}, data, now, false), prev ? 'update' : 'create');
    this.afterWrite();
  }
  updateDoc(path: string, data: Data): void {
    const prev = this.getDoc(path); if (!prev) throw new DemoError('not-found', `No document to update: ${path}`);
    this.put(path, this.applyUpdate(prev, data), 'update'); this.afterWrite();
  }
  private applyUpdate(prev: Data, data: Data): Data {
    const now = Timestamp.now(); let cur = clone(prev);
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      const parts = k.split('.'); const last = parts.pop() as string; let o = cur;
      for (const p of parts) { if (!isPlain(o[p])) o[p] = {}; o = o[p]; }
      const r = resolveValue(o[last], v, now);
      if (r === DELETE) delete o[last]; else o[last] = r;
    }
    cur = clone(cur); return cur;
  }
  deleteDoc(path: string): void { this.put(path, null, 'delete'); this.afterWrite(); }
  /** Toplu yazım: tümü uygulanır, sonra tek bildirim. İşlemler önce doğrulanır (update: belge yoksa hiçbiri uygulanmaz). */
  commit(ops: { kind: 'set' | 'update' | 'delete'; path: string; data?: Data; merge?: boolean }[]): void {
    const snapshot = new Map([...this.colls].map(([p, m]) => [p, new Map(m)]));
    try {
      for (const o of ops) {
        if (o.kind === 'set') { const prev = this.getDoc(o.path); const now = Timestamp.now(); this.put(o.path, o.merge && prev ? mergeObject(prev, o.data ?? {}, now, true) : mergeObject({}, o.data ?? {}, now, false), prev ? 'update' : 'create'); }
        else if (o.kind === 'update') { const prev = this.getDoc(o.path); if (!prev) throw new DemoError('not-found', `No document to update: ${o.path}`); this.put(o.path, this.applyUpdate(prev, o.data ?? {}), 'update'); }
        else this.put(o.path, null, 'delete');
      }
    } catch (e) { this.colls = snapshot; throw e; }
    this.afterWrite();
  }

  rows(def: QueryDef): { id: string; data: Data }[] {
    let rows = [...(this.colls.get(def.path) ?? new Map<string, Data>())].map(([id, d]) => ({ id, data: d }));
    const orders: { field: string; dir: 'asc' | 'desc' }[] = [];
    let lim: number | undefined; let limLast: number | undefined;
    for (const c of def.constraints) {
      if (c.kind === 'where') { rows = rows.filter((r) => matches(r.data, c)); orders.push(...(['<', '<=', '>', '>=', '!='].includes(c.op) && !orders.length ? [{ field: c.field, dir: 'asc' as const }] : [])); }
      else if (c.kind === 'orderBy') orders.push({ field: c.field, dir: c.dir });
      else if (c.kind === 'limit') lim = c.n; else limLast = c.n;
    }
    const explicit = def.constraints.filter((c): c is Extract<Constraint, { kind: 'orderBy' }> => c.kind === 'orderBy');
    for (const o of explicit) rows = rows.filter((r) => fieldOf(r.data, o.field) !== undefined);
    rows.sort((a, b) => { for (const o of orders) { const x = cmp(fieldOf(a.data, o.field), fieldOf(b.data, o.field)); if (x) return o.dir === 'desc' ? -x : x; } return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    if (limLast !== undefined) rows = rows.slice(Math.max(0, rows.length - limLast));
    if (lim !== undefined) rows = rows.slice(0, lim);
    return rows.map((r) => ({ id: r.id, data: clone(r.data) }));
  }

  listen(def: QueryDef | { docPath: string }, cb: (rows: { id: string; data: Data }[]) => void): () => void {
    const l: Listener = { def, cb, last: '' }; this.listeners.add(l);
    setTimeout(() => { if (this.listeners.has(l)) this.fire(l, true); }, 0); // ağ gecikmesi taklidi: ilk veri her zaman eşzamansız
    return () => { this.listeners.delete(l); };
  }
  private current(l: Listener): { id: string; data: Data }[] {
    if ('docPath' in l.def) { const d = this.getDoc(l.def.docPath); return d ? [{ id: parentOf(l.def.docPath).id, data: d }] : []; }
    return this.rows(l.def);
  }
  private fire(l: Listener, force = false): void {
    const rows = this.current(l); const sig = JSON.stringify(rows);
    if (!force && sig === l.last) return;
    l.last = sig; l.cb(rows);
  }
  private afterWrite(): void { this.persist(); this.scheduleNotify(); }
  private scheduleNotify(): void {
    if (this.dirty) return; this.dirty = true;
    queueMicrotask(() => { this.dirty = false; for (const l of [...this.listeners]) if (this.listeners.has(l)) this.fire(l); });
  }
}

let instance: DemoStore | undefined;
export const store = (): DemoStore => (instance ??= new DemoStore());
export const sentinel = (kind: Sentinel['__sentinel'], arg?: unknown): Sentinel => ({ __sentinel: kind, arg });
export type { Constraint };
