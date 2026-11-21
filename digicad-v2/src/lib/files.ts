import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { safeFileName } from './dom';

export interface FileRef { name: string; path: string; size: number; uploadedBy: string; uploadedAt: string }
const ALLOWED = /^(application\/(octet-stream|zip|x-zip-compressed|pdf|sla)|model\/.+|image\/(png|jpeg|webp))$/;

/** Yükleme: ad temizlenir, tür/boyut istemcide de denetlenir (asıl denetim Storage kurallarındadır). */
export async function upload(basePath: string, file: File, uid: string, maxMB = 200): Promise<FileRef> {
  if (file.size > maxMB * 1024 * 1024) throw new Error(`${safeFileName(file.name)} çok büyük (en fazla ${maxMB} MB).`);
  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.test(type)) throw new Error(`${safeFileName(file.name)}: bu dosya türüne izin verilmiyor.`);
  const name = safeFileName(file.name);
  const path = `${basePath}/${Date.now()}_${name}`;
  await uploadBytes(ref(storage, path), file, { contentType: type });
  return { name, path, size: file.size, uploadedBy: uid, uploadedAt: new Date().toISOString() };
}
export const downloadUrl = (path: string): Promise<string> => getDownloadURL(ref(storage, path));
