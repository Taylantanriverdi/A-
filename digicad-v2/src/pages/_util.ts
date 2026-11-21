/** Sayfaların saf (DOM'suz, Firebase'siz) mantığı: filtreleme, aşama, istatistik. */
import { isOverdue } from '../lib/format';

export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export type Row = { id: string; [k: string]: any };

const lower = (s: unknown): string => String(s ?? '').toLocaleLowerCase('tr-TR');

export const isDone = (j: Row): boolean => j.status === 'Tamamlandı';
export const live = (rows: Row[]): Row[] => rows.filter((r) => !r.deleted);

/** Arama (hasta/iş türü/hekim) + teslim tarihi aralığı. `dateKey` karşılaştırılacak alan (ör. 'dateout'). */
export function filterRows(rows: Row[], f: { q?: string; from?: string; to?: string; dateKey?: string }): Row[] {
  const q = lower(f.q).trim(); const key = f.dateKey ?? 'dateout';
  return rows.filter((r) => {
    if (q && ![r.patient, r.type, r.jobType, r.drName, r.doctorName].some((x) => lower(x).includes(q))) return false;
    if (f.from || f.to) {
      const d = String(r[key] ?? '').slice(0, 10); if (!d) return false;
      if (f.from && d < f.from) return false; if (f.to && d > f.to) return false;
    }
    return true;
  });
}

/** Devam eden (teslim tarihine göre artan) ve tamamlanan (en yeni önce) işler. */
export function splitJobs(jobs: Row[]): { ongoing: Row[]; done: Row[] } {
  const l = live(jobs);
  return {
    ongoing: l.filter((j) => !isDone(j)).sort((a, b) => String(a.dateout || '9999').localeCompare(String(b.dateout || '9999'))),
    done: l.filter(isDone).sort((a, b) => String(b.completedAt || b.dateout || '').localeCompare(String(a.completedAt || a.dateout || ''))),
  };
}

/** Bir gönderime bağlı işler (admin siparişe aktarınca `sourceDoctorSubmissionId` yazar). */
export const linkedJobs = (sub: Row, jobs: Row[]): Row[] => live(jobs).filter((j) => j.sourceDoctorSubmissionId != null && String(j.sourceDoctorSubmissionId) === String(sub.id));

export type SubStage = { stage: 'approval' | 'production' | 'done' | 'rejected'; sub?: string };
/** Gönderimin hekime gösterilen aşaması. Hekim onay bekleyen kayıtları (pendingJobs) okuyamaz; bağlı iş yoksa "onay bekliyor". */
export function stageOf(sub: Row, jobs: Row[]): SubStage {
  if (sub.status === 'Reddedildi') return { stage: 'rejected' };
  if (sub.status !== 'Aktarıldı') return { stage: 'approval' };
  const lj = linkedJobs(sub, jobs);
  if (!lj.length) return { stage: 'approval' };
  const done = lj.filter(isDone).length;
  if (done === lj.length) return { stage: 'done', sub: lj.length > 1 ? `${lj.length} kalem tamamlandı` : undefined };
  const rep = lj.find((j) => !isDone(j))!;
  return { stage: 'production', sub: `${rep.status}${lj.length > 1 ? ` — ${done}/${lj.length} tamam` : ''}` };
}

export interface TechStats { total: number; overdue: number; today: number; done: number }
export function techStats(jobs: Row[], today: string): TechStats {
  const { ongoing, done } = splitJobs(jobs);
  return { total: ongoing.length, overdue: ongoing.filter((j) => isOverdue(j.dateout, today)).length, today: ongoing.filter((j) => String(j.dateout ?? '').slice(0, 10) === today).length, done: done.length };
}

/** Teknisyen hızlı talebi: pendingJobs şeması dişleri/rengi ayrı alan olarak kabul etmediği için nota eklenir. */
export function composeQuickNote(o: { note?: string; teeth?: number[]; color?: string }): string {
  const parts = [o.teeth?.length ? `Dişler: ${o.teeth.join(',')}` : '', o.color ? `Renk: ${o.color}` : '', o.note?.trim() ?? ''].filter(Boolean);
  return parts.join(' | ').slice(0, 5000);
}

/** Gelen işler: durum süzgeci; `seen` bayrağı seenAt ile tutulur. */
export function subStatusLabel(s: Row): string {
  if (s.status === 'Yeni') return s.seenAt ? 'Yeni (incelendi)' : 'Yeni';
  return String(s.status ?? '');
}
export const uniqueSorted = (xs: unknown[]): string[] => [...new Set(xs.map((x) => String(x ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
