import { listen, type Rec } from '../lib/store';
import type { Session } from '../lib/auth';
import { jobCents, techIdsOf } from './calc';

export { withIds } from './calc';
export const COLLECTIONS = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures', 'settings', 'mailFilters'] as const;
export type CollName = (typeof COLLECTIONS)[number];
export type State = Record<CollName, Rec[]>;

export function emptyState(): State { return Object.fromEntries(COLLECTIONS.map((c) => [c, [] as Rec[]])) as unknown as State; }

/** Tüm koleksiyonları dinler; dönen işlev HEPSİNİ kapatır (çıkış/çalışma alanı değişiminde çağrılmalı). */
export function connect(s: Session, st: State, onChange: () => void, onErr: (coll: string, e: Error) => void): () => void {
  const offs = COLLECTIONS.map((c) => listen(s.lab, c, (rows) => { st[c] = rows; onChange(); }, [], (e) => onErr(c, e)));
  return () => offs.forEach((o) => o());
}

export const live = (rows: Rec[]): Rec[] => rows.filter((r) => !r.deleted);
export const doctorOf = (st: State, id: unknown): Rec | undefined => st.doctors.find((d) => String(d.id) === String(id));
export const techOf = (st: State, id: unknown): Rec | undefined => st.technicians.find((t) => String(t.id) === String(id));
export const isOpen = (j: Rec): boolean => !j.deleted && j.status !== 'Tamamlandı';
export const unassigned = (j: Rec): boolean => techIdsOf(j).length === 0;
/** Tek iş tutarı (TL, kuruş yuvarlamalı). */
export const jobTotal = (j: Rec): number => jobCents(j) / 100;
