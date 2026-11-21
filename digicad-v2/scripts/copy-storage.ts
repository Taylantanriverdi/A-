/**
 * Eski Storage dosyalarını (önceden indirdiğiniz YEREL klasörden) YENİ bucket'a kopyalar. Eski projeye bağlanmaz.
 * Kullanım (önce dry-run):
 *   npx tsx scripts/copy-storage.ts --input yedek.json --files-dir migration/input/storage --project YENI-ID --bucket YENI-ID.firebasestorage.app [--prefix labs/digicad/legacy] [--execute]
 * - Nesne yolu korunur (prefix altında); eski indirme belirteci (token) yeni nesneye yazılır, böylece eski URL'nin yeni bucket karşılığı çalışır.
 * - Var olan farklı içerik ASLA ezilmez; her yükleme MD5 ile doğrulanır; tekrar çalıştırmak güvenlidir.
 * - Çıktı: migration/out/url-eslesme.json (eski URL -> yeni URL). Firestore kayıtları DEĞİŞTİRİLMEZ.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { collectFileRefs, buildManifest, copyToBucket } from '../migration/src/storage';
import { assertSafeTarget, isForbiddenProject } from '../migration/src/guard';
import { storageSink } from '../migration/src/sinks';

const { values: v } = parseArgs({ options: { input: { type: 'string' }, 'files-dir': { type: 'string' }, project: { type: 'string' }, bucket: { type: 'string' }, prefix: { type: 'string', default: 'labs/digicad/legacy' }, execute: { type: 'boolean', default: false }, out: { type: 'string' } } });
if (!v.input || !v['files-dir'] || !v.bucket) { console.error('Kullanım: copy-storage.ts --input yedek.json --files-dir klasor --bucket YENI-BUCKET [--project YENI-ID --execute]'); process.exit(3); }
if (isForbiddenProject(v.bucket)) { console.error('REDDEDİLDİ: eski projenin bucket\'ı.'); process.exit(3); }
if (v.execute) { try { assertSafeTarget(v.project); } catch (e) { console.error((e as Error).message); process.exit(3); } }
const manifest = buildManifest(collectFileRefs(JSON.parse(readFileSync(resolve(v.input), 'utf8').replace(/^﻿/, ''))), resolve(v['files-dir']));
const sink = v.execute ? await storageSink(v.project as string, v.bucket) : undefined;
const r = await copyToBucket(manifest, v.bucket, v.prefix as string, sink, !!v.execute);
const out = resolve(v.out ?? 'migration/out'); mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'url-eslesme.json'), JSON.stringify(r.urlMap, null, 2), { mode: 0o600 });
console.log(`${v.execute ? 'KOPYALANDI' : 'DRY-RUN planı'}: ${r.copied.length}; zaten aynı: ${r.skippedSame.length}; çakışma: ${r.conflicts.length}; yerelde eksik: ${r.missingLocal.length}; hata: ${r.failed.length}; doğrulanan: ${r.verified}`);
for (const x of r.conflicts) console.error('ÇAKIŞMA (farklı içerik var, ezilmedi):', x);
for (const x of r.missingLocal) console.error('EKSİK (yerelde yok):', x);
for (const x of r.failed) console.error('HATA:', x);
process.exit(r.conflicts.length || r.failed.length || r.missingLocal.length ? 2 : 0);
