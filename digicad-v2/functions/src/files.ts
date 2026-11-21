/**
 * Hekim gönderim dosyalarının (labs/{lab}/submissions/{doctorId}/...) siparişe aktarılan işe
 * (labs/{lab}/jobFiles/{jobId}/...) kopyalanması için SAF planlama. Teknisyen yalnızca jobFiles'ı okuyabilir.
 */
export interface FileLike { path?: unknown; name?: unknown; [k: string]: unknown }
export interface CopyStep { index: number; from: string; to: string }

const SEG = /^[A-Za-z0-9_-]{1,64}$/;

/** Dosya adı (son yol parçası) güvenli mi? Üst dizine kaçış/gizli ad yok. */
export const safeBase = (p: string): string | null => {
  const b = p.split('/').pop() ?? '';
  return b && b !== '.' && b !== '..' && b.length <= 300 && !b.includes('\\') ? b : null;
};

/** Kopyalanacak dosyalar: yalnızca bu lab'ın bu işin hekimine ait submissions yolları; diğerleri (jobFiles, eski url) dokunulmaz. */
export function planFileCopies(lab: string, jobId: string, doctorId: string, files: unknown): CopyStep[] {
  if (!Array.isArray(files) || !SEG.test(jobId) || !SEG.test(lab)) return [];
  const prefix = `labs/${lab}/submissions/${doctorId}/`;
  const steps: CopyStep[] = [];
  files.slice(0, 200).forEach((f, index) => {
    const path = f && typeof f === 'object' ? (f as FileLike).path : undefined;
    if (typeof path !== 'string' || !SEG.test(doctorId) || !path.startsWith(prefix)) return;
    const rest = path.slice(prefix.length);
    if (rest.includes('/')) return;
    const base = safeBase(path);
    if (!base) return;
    steps.push({ index, from: path, to: `labs/${lab}/jobFiles/${jobId}/${base}` });
  });
  return steps;
}

/** Kopyalanan yollar için dosya listesini günceller (kaynak yol `copiedFrom` olarak korunur). Diğer girdiler aynen kalır. */
export function applyCopies(files: unknown[], done: Map<string, string>): unknown[] {
  return files.map((f) => {
    const path = f && typeof f === 'object' ? (f as FileLike).path : undefined;
    const to = typeof path === 'string' ? done.get(path) : undefined;
    return to ? { ...(f as object), path: to, copiedFrom: path } : f;
  });
}
