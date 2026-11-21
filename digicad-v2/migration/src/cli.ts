import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from './runner';
import { firestoreSinks } from './sinks';
import { assertSafeTarget } from './guard';
import { buildManifest } from './storage';
import { secureAppend, csvCell } from './csv';

const HELP = `Kullanım: npm run migrate -- --input yedek.json [--project YENI-PROJE-ID --execute] [--accounts-csv dosya.csv] [--files-dir klasor]
  Varsayılan DRY-RUN'dır: Firestore/Auth'a hiçbir şey yazılmaz, hiçbir ağ bağlantısı kurulmaz.
  --execute                  gerçekten yazar (yalnızca YENİ projeye; eski projeye asla bağlanılmaz). Kimlik: GOOGLE_APPLICATION_CREDENTIALS.
  --include-legacy-root      eski kök db/doctors... içinde olup db/digicad'da OLMAYAN kayıtları da taşır
  --ignore-legacy-root       o kayıtları bilerek yok sayar (uyarı olarak raporlanır)
  --ignore-unknown           tanınmayan üst düzey anahtarları bilerek yok sayar (uyarı olarak raporlanır)
  --overwrite-new-system-docs  yeni sistemde sonradan oluşmuş (göç işaretsiz) belgelerin ÜZERİNE yazmaya izin verir (varsayılan: reddeder)
  --files-dir klasor         indirilmiş Storage dosyalarından manifest (SHA-256/MD5) üretir
  Çıkış kodları: 0 başarılı, 1 doğrulama/şema hatası, 2 kayıp/farklılık/çakışma/yazma hatası, 3 kullanım hatası.`;

export async function main(argv: string[]): Promise<number> {
  let v;
  try {
    v = parseArgs({ args: argv, options: { input: { type: 'string' }, project: { type: 'string' }, execute: { type: 'boolean', default: false }, 'accounts-csv': { type: 'string' }, 'files-dir': { type: 'string' }, out: { type: 'string' },
      'include-legacy-root': { type: 'boolean' }, 'ignore-legacy-root': { type: 'boolean' }, 'ignore-unknown': { type: 'boolean' }, 'overwrite-new-system-docs': { type: 'boolean' }, 'allow-emulator': { type: 'boolean' }, help: { type: 'boolean' } } }).values;
  } catch (e) { console.error((e as Error).message); console.log(HELP); return 3; }
  if (v.help || !v.input) { console.log(HELP); return v.help ? 0 : 3; }
  if (v.execute) { try { assertSafeTarget(v.project, process.env, { allowEmulator: !!v['allow-emulator'] }); } catch (e) { console.error((e as Error).message); return 3; } }
  let sourceText: string;
  try { sourceText = readFileSync(resolve(v.input), 'utf8'); } catch (e) { console.error('Girdi okunamadı: ' + (e as Error).message); return 3; }
  const outDir = resolve(v.out ?? 'migration/out'); mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = resolve(v['accounts-csv'] ?? join(outDir, 'hesaplar.csv'));
  const backupPath = join(outDir, `yedek-ezilen-${stamp}.jsonl`);
  const sinks = v.execute ? await firestoreSinks(v.project as string, !!v['allow-emulator']) : undefined;
  let csvWritten = 0, overwritten = 0;
  let result;
  try {
    result = await run({
      sourceText, execute: !!v.execute, project: v.project, docs: sinks?.docs, auth: sinks?.auth, allowEmulator: !!v['allow-emulator'],
      plan: { includeLegacyRoot: !!v['include-legacy-root'], ignoreLegacyRoot: !!v['ignore-legacy-root'], ignoreUnknown: !!v['ignore-unknown'] },
      overwriteNewSystemDocs: !!v['overwrite-new-system-docs'],
      onAccountRow: (r) => { secureAppend(csvPath, r.map(csvCell).join(',') + '\n', ['email', 'rol', 'laboratuvar', 'kayit_id', 'ad', 'gecici_sifre'].map(csvCell).join(',') + '\n'); csvWritten++; },
      onOverwrite: (p, before) => { secureAppend(backupPath, JSON.stringify({ path: p, before }) + '\n'); overwritten++; },
    });
  } catch (e) { console.error(e instanceof Error ? e.message : e); return 3; }
  const { report, fileRefs } = result;
  if (csvWritten) console.log(`Hesap listesi (geçici şifreler, 0600) ${csvWritten} satır eklendi: ${csvPath}  -- DEPOYA EKLEMEYİN`);
  if (overwritten) console.log(`${overwritten} mevcut (farklı) belge ezilmeden önce yerel dosyaya yedeklendi: ${backupPath}`);
  if (fileRefs.length || v['files-dir']) {
    const manifest = buildManifest(fileRefs, v['files-dir'] ? resolve(v['files-dir']) : undefined);
    writeFileSync(join(outDir, 'dosya-manifesti.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(`Dosya manifesti: ${manifest.referenced} benzersiz Storage dosyası kayıtlarda geçiyor` + (v['files-dir'] ? `; ${manifest.foundLocally} yerelde bulundu, ${manifest.missingLocally} EKSİK, ${manifest.unreferencedLocal.length} kayıtsız dosya.` : ' (--files-dir verilmedi).'));
    if (v['files-dir'] && manifest.missingLocally) report.warnings.push(`${manifest.missingLocally} Storage dosyası indirilen klasörde bulunamadı (dosya-manifesti.json).`);
  }
  const reportPath = join(outDir, `rapor-${report.mode}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`\nKaynak SHA-256: ${report.sourceSha256}\nMod: ${report.mode}`);
  console.table(Object.fromEntries(Object.entries(report.collections).map(([k, c]) => [k, { kaynak: c.sourceCount, plan: c.planned, yazılan: c.written, değişmemiş: c.unchanged, ezilen: c.overwritten, doğrulanan: c.verifiedOk, kayıp: c.missing.length, farklı: c.mismatched.length, eksikAlan: c.lost.length, çakışma: c.conflicts.length, hata: c.writeErrors.length }])));
  console.log(`Gizli alan temizlendi: ${report.strippedSecretFields}; e-postasız hesap: ${report.accounts.skippedNoEmail.length}; ortak/geçersiz e-posta: ${report.accounts.duplicateEmails.length}/${report.accounts.invalidEmail.length}; değer muhasebesi: ${report.leafAccounting.accounted}/${report.leafAccounting.total}`);
  for (const c of Object.values(report.collections)) for (const l of [...c.lost, ...c.writeErrors, ...c.conflicts.map((x) => 'ÇAKIŞMA (yeni sistemde oluşmuş belge, ezilmedi): ' + x)]) console.error('HATA:', l);
  report.warnings.forEach((w) => console.log('UYARI:', w)); report.validationErrors.forEach((e) => console.error('HATA:', e)); if (report.fatalError) console.error('HATA:', report.fatalError);
  console.log(report.ok ? (v.execute ? 'SONUÇ: BAŞARILI — tüm kayıtlar geri okunup doğrulandı.' : 'SONUÇ: DRY-RUN temiz (hiçbir şey yazılmadı).') : 'SONUÇ: BAŞARISIZ');
  console.log('Rapor:', reportPath);
  if (report.validationErrors.length) return 1;
  const t = report.totals;
  if (t.missing || t.mismatched || t.lost || t.conflicts || t.writeErrors) return 2;
  return report.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(3); });
}
