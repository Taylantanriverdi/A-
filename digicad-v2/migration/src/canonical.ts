import { createHash } from 'node:crypto';

/** Anahtarları sıralı, undefined'ları atılmış kanonik JSON. */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => canonical(x === undefined ? null : x)).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const hashRecord = (v: unknown): string => sha256(canonical(v));
