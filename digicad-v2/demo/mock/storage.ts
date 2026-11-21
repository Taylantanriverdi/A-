/** DEMO — `firebase/storage` taklidi: yüklenen dosyalar bellekte (blob) tutulur; adresler sahte bir https alan adına çözülür. */
export const DEMO_FILE_HOST = 'https://demo-dosya.invalid/';

export const blobs = new Map<string, Blob>();
export const getStorage = (): object => ({});
export const connectStorageEmulator = (): void => undefined;
export const ref = (_s: unknown, path: string): { fullPath: string; name: string } => ({ fullPath: path, name: path.split('/').pop() ?? path });

type Snap = { bytesTransferred: number; totalBytes: number; state: string };
export function uploadBytesResumable(r: { fullPath: string }, file: Blob): {
  on: (ev: string, next?: (s: Snap) => void, err?: (e: Error) => void, done?: () => void) => () => void;
} {
  blobs.set(r.fullPath, file);
  return {
    on(_ev, next, _err, done) {
      const total = file.size || 1; let step = 0;
      const t = setInterval(() => {
        step += 1; next?.({ bytesTransferred: Math.min(total, Math.round((total * step) / 4)), totalBytes: total, state: 'running' });
        if (step >= 4) { clearInterval(t); done?.(); }
      }, 60);
      return () => clearInterval(t);
    },
  };
}
export const getDownloadURL = async (r: { fullPath: string }): Promise<string> => `${DEMO_FILE_HOST}${r.fullPath.split('/').map(encodeURIComponent).join('/')}`;

/** Sahte adresin dosyasını döndürür: yüklenmiş blob ya da (tohum dosyaları için) açıklayıcı bir metin dosyası. */
export function blobForUrl(url: string): Blob | null {
  if (!url.startsWith(DEMO_FILE_HOST)) return null;
  const path = url.slice(DEMO_FILE_HOST.length).split('/').map(decodeURIComponent).join('/');
  return blobs.get(path) ?? new Blob([`DigiCAD DEMO\r\n\r\nBu dosya demo sürümünde örnek olarak üretilmiştir (gerçek tarama/tasarım içeriği yoktur).\r\nDosya yolu: ${path}\r\n`], { type: 'text/plain;charset=utf-8' });
}
