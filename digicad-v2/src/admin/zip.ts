import { downloadUrl } from '../lib/files';
import { h } from '../lib/dom';
import { jobInfoText, safeName, uniqueNames, type R } from './calc';

export type ZipKind = 'scan' | 'design' | 'both';
interface FileEntry { name?: string; path?: string; url?: string; size?: number }
const listOf = (v: unknown): FileEntry[] => (Array.isArray(v) ? (v as FileEntry[]) : []);

/** Bir blob'u tarayıcıya indirtir (blob: URL; CSP img/connect gerektirmez). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: safeName(name, 120) }); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
async function fetchBlob(f: FileEntry): Promise<Blob> {
  // Yeni dosyalar Storage yolu (path) ile, eski göç dosyaları yalnızca https URL ile gelir.
  const url = f.path ? await downloadUrl(f.path) : f.url && /^https:\/\//i.test(f.url) ? f.url : '';
  if (!url) throw new Error('Adres yok');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}
/** Seçili işlerin dosyalarını TEK zip'te toplar (iş başına klasör + iş bilgisi metni). Başarısız dosya, nedeniyle birlikte *_INDIRILEMEDI.txt olarak eklenir.
 *  Storage CORS: indirme fetch ile yapılır; bucket'ta CORS tanımı gerekir (README/rapor). */
export async function downloadJobsZip(jobs: R[], kind: ZipKind, onProgress?: (done: number, total: number) => void): Promise<{ ok: number; fail: number }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip(); const folders = uniqueNames(jobs.map((j) => safeName(`${j.drName ?? 'Hekim'}_${j.patient ?? 'Hasta'}${j.toothColor ? `_${j.toothColor}` : ''}`)));
  const tasks: { folder: string; sub: string; f: FileEntry }[] = [];
  jobs.forEach((j, i) => {
    const groups: [string, FileEntry[], 'scan' | 'design'][] = [];
    if (kind !== 'design') groups.push(['Tarama', listOf(j.files), 'scan']);
    if (kind !== 'scan') groups.push(['Tasarim', listOf(j.designFiles), 'design']);
    const f = zip.folder(folders[i])!;
    f.file(kind === 'design' ? 'Tasarim_Bilgisi.txt' : 'Is_Bilgisi.txt', jobInfoText(j, kind === 'design' ? 'design' : 'scan'));
    for (const [sub, list] of groups) { const names = uniqueNames(list.map((x) => safeName(x.name))); list.forEach((x, k) => tasks.push({ folder: folders[i], sub, f: { ...x, name: names[k] } })); }
  });
  if (!tasks.length) throw new Error('İndirilecek dosya yok.');
  let ok = 0; let fail = 0; let done = 0; let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const t = tasks[next++]; const dir = zip.folder(t.folder)!.folder(t.sub)!;
      try { dir.file(t.f.name ?? 'dosya', await fetchBlob(t.f)); ok++; } catch (e) { fail++; dir.file(`${t.f.name ?? 'dosya'}_INDIRILEMEDI.txt`, `Bu dosya paketlenemedi.\nHata: ${(e as Error).message}\n(Storage CORS ayarını ve yetkiyi kontrol edin.)`); }
      onProgress?.(++done, tasks.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  saveBlob(blob, `${jobs.length === 1 ? folders[0] : `DigiCAD_${jobs.length}_is`}.zip`);
  return { ok, fail };
}
export async function downloadFilesZip(name: string, files: FileEntry[], info: string): Promise<{ ok: number; fail: number }> {
  return downloadJobsZip([{ drName: name, patient: '', files, note: info, status: '' } as R], 'scan');
}
