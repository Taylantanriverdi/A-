import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { h, safeFileName } from './dom';

export interface FileRef { name: string; path: string; size: number; uploadedBy: string; uploadedAt: string }
export type UploadKind = 'scan' | 'chat';

// Storage kurallarıyla aynı beyaz liste (asıl denetim kurallardadır; burada erken ve anlaşılır hata verilir).
const SCAN_TYPES = /^(application\/(octet-stream|zip|x-zip-compressed|pdf|sla)|model\/.+|image\/(png|jpeg|webp))$/;
const CHAT_TYPES = /^(image\/(png|jpeg|webp)|application\/pdf)$/;
/** `application/octet-stream` kurallardan geçtiği için çalıştırılabilir/etkin içerik uzantıları istemcide de reddedilir. */
const DANGEROUS_EXT = /\.(html?|xhtml|xht|svgz?|js|mjs|cjs|jsx|exe|dll|bat|cmd|com|msi|scr|jar|sh|bash|ps1|psm1|vbs|vbe|wsf|hta|lnk|apk|php\d?|phtml|asp|aspx|jsp|cgi|swf|xml|xsl)(\.|$)/i;

export const MAX_SCAN_MB = 200;
export const MAX_CHAT_MB = 25;

/** Saf dosya denetimi: hata iletisi ya da null. Rules `size < n MB` kullandığı için `>=` reddedilir. */
export function validateFile(file: { name: string; size: number; type: string }, maxMB: number, kind: UploadKind = 'scan'): string | null {
  const nm = safeFileName(file.name);
  if (file.size <= 0) return `${nm}: dosya boş.`;
  if (file.size >= maxMB * 1024 * 1024) return `${nm} çok büyük (en fazla ${maxMB} MB).`;
  if (DANGEROUS_EXT.test(nm)) return `${nm}: bu dosya uzantısına izin verilmiyor.`;
  const type = file.type || 'application/octet-stream';
  if (!(kind === 'chat' ? CHAT_TYPES : SCAN_TYPES).test(type)) return `${nm}: bu dosya türüne izin verilmiyor.`;
  return null;
}

/** Bildirilen tür ile içerik imzası (magic bytes) uyuşuyor mu? Bilinmeyen türlerde true. */
export function matchesMagic(type: string, b: Uint8Array): boolean {
  const eq = (off: number, sig: number[]) => sig.every((v, i) => b[off + i] === v);
  switch (type) {
    case 'image/png': return eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return eq(0, [0xff, 0xd8, 0xff]);
    case 'image/webp': return eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50]);
    case 'application/pdf': return eq(0, [0x25, 0x50, 0x44, 0x46]);
    case 'application/zip': case 'application/x-zip-compressed': return eq(0, [0x50, 0x4b]);
    default: return true;
  }
}

async function sniff(file: File, type: string): Promise<boolean> {
  if (typeof file.slice !== 'function') return true;
  const part = file.slice(0, 16) as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof part.arrayBuffer !== 'function') return true;
  return matchesMagic(type, new Uint8Array(await part.arrayBuffer()));
}

const rand = (): string => Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');

/** Yükleme: ad temizlenir; tür/boyut/uzantı/içerik imzası istemcide de denetlenir (asıl denetim Storage kurallarındadır). */
export async function upload(
  basePath: string, file: File, uid: string, maxMB = MAX_SCAN_MB, opts: { kind?: UploadKind; onProgress?: (pct: number) => void } = {},
): Promise<FileRef> {
  const err = validateFile(file, maxMB, opts.kind ?? 'scan');
  if (err) throw new Error(err);
  const type = file.type || 'application/octet-stream';
  if (!(await sniff(file, type))) throw new Error(`${safeFileName(file.name)}: dosya içeriği bildirilen türle uyuşmuyor.`);
  const name = safeFileName(file.name);
  const path = `${basePath}/${Date.now()}_${rand()}_${name}`;
  const task = uploadBytesResumable(ref(storage, path), file, { contentType: type });
  await new Promise<void>((res, rej) => task.on('state_changed', (s) => opts.onProgress?.(s.totalBytes ? Math.round((100 * s.bytesTransferred) / s.totalBytes) : 0), rej, () => res()));
  return { name, path, size: file.size, uploadedBy: uid, uploadedAt: new Date().toISOString() };
}
export const downloadUrl = (path: string): Promise<string> => getDownloadURL(ref(storage, path));

/** Dosyayı yeni sekmede açar (yalnızca https indirme adresi; açılır pencere engelini azaltmak için bağlantı tıklaması). */
export async function openFile(path: string): Promise<void> {
  const url = await downloadUrl(path);
  h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }).click();
}
