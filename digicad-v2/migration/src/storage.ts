import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isObj } from './transform';

export interface FileRef { sourcePath: string; url: string; bucket: string; object: string; token?: string }
const FB = /https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/\s"']+)\/o\/([^?#\s"']+)(?:\?([^\s"'#]*))?/g;
const GCS = /https?:\/\/storage\.googleapis\.com\/([^/\s"']+)\/([^?#\s"']+)/g;
const GS = /gs:\/\/([^/\s"']+)\/([^\s"']+)/g;
const dec = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/** Kaynak JSON'un TAMAMINI (bilinmeyen alanlar dahil) tarar; Storage'a işaret eden her metni döndürür. Ağ çağrısı yapmaz. */
export function collectFileRefs(root: unknown): FileRef[] {
  const out: FileRef[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (v.length < 12) return;
      for (const m of v.matchAll(FB)) out.push({ sourcePath: path, url: m[0], bucket: m[1], object: dec(m[2]), token: new URLSearchParams(m[3] ?? '').get('token') ?? undefined });
      for (const m of v.matchAll(GCS)) out.push({ sourcePath: path, url: m[0], bucket: m[1], object: dec(m[2]) });
      for (const m of v.matchAll(GS)) out.push({ sourcePath: path, url: m[0], bucket: m[1], object: dec(m[2]) });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}/${k}` : k);
  };
  walk(root, '');
  return out;
}

export interface LocalFile { path: string; size: number; sha256: string; md5: string }
export interface ManifestEntry { bucket: string; object: string; tokens: string[]; urls: string[]; referencedBy: string[]; local?: LocalFile }
export interface FileManifest { generatedAt: string; referenced: number; foundLocally: number; missingLocally: number; unreferencedLocal: LocalFile[]; entries: ManifestEntry[] }

export function walkFiles(dir: string): string[] { return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walkFiles(p) : [p]; }); }
export function hashFile(path: string): LocalFile {
  const b = readFileSync(path);
  return { path, size: b.length, sha256: createHash('sha256').update(b).digest('hex'), md5: createHash('md5').update(b).digest('base64') };
}

export function buildManifest(refs: FileRef[], filesDir?: string): FileManifest {
  const byKey = new Map<string, ManifestEntry>();
  for (const r of refs) {
    const k = `${r.bucket}\u0000${r.object}`;
    const e = byKey.get(k) ?? { bucket: r.bucket, object: r.object, tokens: [], urls: [], referencedBy: [] };
    if (r.token && !e.tokens.includes(r.token)) e.tokens.push(r.token);
    if (!e.urls.includes(r.url)) e.urls.push(r.url);
    e.referencedBy.push(r.sourcePath); byKey.set(k, e);
  }
  const entries = [...byKey.values()];
  const used = new Set<string>(); let all: string[] = [];
  if (filesDir && existsSync(filesDir)) {
    all = walkFiles(filesDir);
    const rel = new Map(all.map((f) => [relative(filesDir, f).split('\\').join('/'), f]));
    for (const e of entries) {
      const f = rel.get(e.object) ?? rel.get(`${e.bucket}/${e.object}`) ?? [...rel.entries()].find(([k]) => k.endsWith('/' + e.object))?.[1];
      if (f) { e.local = hashFile(f); used.add(f); }
    }
  }
  const unreferencedLocal = all.filter((f) => !used.has(f)).map(hashFile);
  const found = entries.filter((e) => e.local).length;
  return { generatedAt: new Date().toISOString(), referenced: entries.length, foundLocally: found, missingLocally: filesDir ? entries.length - found : 0, unreferencedLocal, entries };
}

// ---- Yeni bucket'a kopyalama (yerelden; eski projeye bağlanmaz) -----------------
export interface BucketSink {
  head(object: string): Promise<{ md5: string } | undefined>;
  upload(localPath: string, object: string, meta: { contentType?: string; token?: string }): Promise<void>;
}
export interface CopyResult { copied: string[]; skippedSame: string[]; conflicts: string[]; missingLocal: string[]; failed: string[]; verified: number; urlMap: { oldUrl: string; newObject: string; newUrl: string }[] }
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip', stl: 'model/stl', obj: 'model/obj', ply: 'application/octet-stream', dcm: 'application/dicom', txt: 'text/plain' };
export const contentTypeOf = (name: string): string => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
export const newObjectName = (prefix: string, object: string): string => `${prefix.replace(/\/+$/, '')}/${object}`;

/** Aynı nesne adına, eski indirme belirteci korunarak yazar: eski URL'nin yeni bucket karşılığı üretilir. Var olan farklı içerik ASLA ezilmez. */
export async function copyToBucket(manifest: FileManifest, bucketName: string, prefix: string, sink: BucketSink | undefined, execute: boolean): Promise<CopyResult> {
  const res: CopyResult = { copied: [], skippedSame: [], conflicts: [], missingLocal: [], failed: [], verified: 0, urlMap: [] };
  for (const e of manifest.entries) {
    if (!e.local) { res.missingLocal.push(`${e.bucket}/${e.object}`); continue; }
    const dest = newObjectName(prefix, e.object); const token = e.tokens[0];
    const newUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(dest)}?alt=media${token ? `&token=${token}` : ''}`;
    for (const u of e.urls) res.urlMap.push({ oldUrl: u, newObject: dest, newUrl });
    if (!execute) { res.copied.push(dest); continue; }
    try {
      const ex = await sink!.head(dest);
      if (ex) { if (ex.md5 === e.local.md5) { res.skippedSame.push(dest); res.verified++; } else res.conflicts.push(dest); continue; }
      await sink!.upload(e.local.path, dest, { contentType: contentTypeOf(e.object), token });
      const back = await sink!.head(dest);
      if (back && back.md5 === e.local.md5) { res.copied.push(dest); res.verified++; } else res.failed.push(`${dest} (doğrulama: MD5 uyuşmuyor)`);
    } catch (err) { res.failed.push(`${dest}: ${(err as Error).message}`); }
  }
  return res;
}
