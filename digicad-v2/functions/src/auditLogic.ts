import { gzipSync } from 'node:zlib';

/** Geçmişi tutulan koleksiyonlar (klinik + finans + yönetim). `threads` ayrı (messages) tetikleyicide izlenir. */
export const AUDITED = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures', 'settings', 'mailFilters', 'threads'];

export type Kind = 'create' | 'update' | 'DELETE-ALERT';
type Rec = Record<string, unknown> | null | undefined;

export function kindOf(before: Rec, after: Rec): Kind {
  return !before ? 'create' : !after ? 'DELETE-ALERT' : 'update';
}

const millis = (v: unknown): number | null => {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') return (v as { toMillis(): number }).toMillis();
  if (v instanceof Date) return v.getTime();
  return typeof v === 'number' ? v : null;
};

/** Bu yazımı kimin yaptığı (istemci beyanı). Silme alanı bu yazımda değiştiyse deletedBy öncelikli. */
export function actorOf(before: Rec, after: Rec): string | null {
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const src = after ?? before;
  if (!src) return null;
  const deletionChanged = !!after && (!!after.deletedAt !== !!before?.deletedAt || millis(after.deletedAt) !== millis(before?.deletedAt));
  if (deletionChanged) return pick(src.deletedBy) ?? pick(src.updatedBy) ?? pick(src.createdBy);
  return pick(src.updatedBy) ?? pick(src.createdBy) ?? pick(src.deletedBy);
}

const SOFT_LIMIT = 600_000; // Firestore belge sınırı 1 MiB; ek alanlara pay bırak.
const approxSize = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null));

export interface Packed { before: unknown; after: unknown; compressed?: { before?: Buffer; after?: Buffer }; oversize?: boolean }

/**
 * Büyük belgelerde 1 MiB sınırına takılmamak için: boyut eşiği aşılırsa JSON'u gzip'leyip Bytes olarak saklar.
 * Gzip sonrası da sığmazsa `oversize` işaretlenir (veri atılmaz; çağıran ayrıca hata loglar).
 */
export function pack(before: Rec, after: Rec, withAfter: boolean): Packed {
  const total = approxSize(before) + (withAfter ? approxSize(after) : 0);
  if (total <= SOFT_LIMIT) return { before: before ?? null, after: withAfter ? after ?? null : undefined };
  const compressed: { before?: Buffer; after?: Buffer } = {};
  if (before) compressed.before = gzipSync(JSON.stringify(before));
  if (withAfter && after) compressed.after = gzipSync(JSON.stringify(after));
  const gz = (compressed.before?.length ?? 0) + (compressed.after?.length ?? 0);
  return { before: null, after: null, compressed, oversize: gz > SOFT_LIMIT };
}
