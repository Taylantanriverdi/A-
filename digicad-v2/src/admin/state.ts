import { listen, type Rec } from '../lib/store';
import type { Session } from '../lib/auth';

export const COLLECTIONS = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures', 'settings', 'mailFilters', 'threads'] as const;
export type CollName = (typeof COLLECTIONS)[number];
export type State = Record<CollName, Rec[]>;

export function emptyState(): State { return Object.fromEntries(COLLECTIONS.map((c) => [c, [] as Rec[]])) as unknown as State; }

export function connect(s: Session, st: State, onChange: () => void, onErr: (e: Error) => void): () => void {
  const offs = COLLECTIONS.map((c) => listen(s.lab, c, (rows) => { st[c] = rows; onChange(); }, [], onErr));
  return () => offs.forEach((o) => o());
}

export const live = (rows: Rec[]): Rec[] => rows.filter((r) => !r.deleted);
export const doctorOf = (st: State, id: unknown): Rec | undefined => st.doctors.find((d) => String(d.id) === String(id));
export const techOf = (st: State, id: unknown): Rec | undefined => st.technicians.find((t) => String(t.id) === String(id));
export const isOpen = (j: Rec): boolean => !j.deleted && j.status !== 'Tamamlandı';

/** Eski alan adlarını (drId/techId) koruyarak v2 erişim alanlarını (doctorId/techIds) tamamlar. */
export function withIds<T extends Record<string, unknown>>(j: T): T & { doctorId: string; techIds: string[] } {
  const techIds = Array.isArray(j.techIds) ? (j.techIds as unknown[]).map(String) : j.techId != null && j.techId !== '' ? [String(j.techId)] : [];
  return { ...j, doctorId: String(j.doctorId ?? j.drId ?? ''), techIds };
}

export const jobTotal = (j: Rec): number => (Number(j.price) || 0) * (Number(j.qty) || 1);
export function balanceOf(st: State, doctorId: string): { charged: number; paid: number; balance: number } {
  const charged = live(st.jobs).filter((j) => String(j.doctorId ?? j.drId) === doctorId && j.status === 'Tamamlandı').reduce((a, j) => a + jobTotal(j), 0);
  const paid = live(st.payments).filter((p) => String(p.doctorId ?? p.drId) === doctorId).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return { charged, paid, balance: charged - paid };
}
