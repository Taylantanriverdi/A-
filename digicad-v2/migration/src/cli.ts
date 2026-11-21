import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { run } from './runner';
import { firestoreSinks } from './sinks';
import { sha256 } from './canonical';

const FORBIDDEN_PROJECTS = ['primer-dental'];
const HELP = `Kullanım: npm run migrate -- --input yedek.json [--project YENI-PROJE-ID --execute] [--accounts-csv dosya.csv] [--files-dir klasor]
  Varsayılan DRY-RUN'dır: hiçbir şey yazılmaz, hiçbir ağ bağlantısı kurulmaz.
  --execute  gerçekten yazar (yalnızca YENİ projeye; eski projeye asla bağlanılmaz). Kimlik: GOOGLE_APPLICATION_CREDENTIALS.
  Çıkış kodları: 0 başarılı, 1 doğrulama/şema hatası, 2 kayıp veya farklılık, 3 kullanım hatası.`;

function walk(dir: string): string[] { return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }); }

async function main(): Promise<number> {
  const { values: v } = parseArgs({ options: { input: { type: 'string' }, project: { type: 'string' }, execute: { type: 'boolean', default: false }, 'accounts-csv': { type: 'string' }, 'files-dir': { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (v.help || !v.input) { console.log(HELP); return v.help ? 0 : 3; }
  if (v.execute) {
    if (!v.project) { console.error('--execute için --project (YENİ proje kimliği) zorunlu.'); return 3; }
    if (FORBIDDEN_PROJECTS.includes(v.project.toLowerCase())) { console.error('REDDEDİLDİ: eski canlı projeye yazılamaz.'); return 3; }
  }
  const sourceText = readFileSync(resolve(v.input), 'utf8');
  const outDir = resolve(v.out ?? 'migration/out'); mkdirSync(outDir, { recursive: true });
  const csvPath = resolve(v['accounts-csv'] ?? join(outDir, 'hesaplar.csv'));
  const sinks = v.execute ? await firestoreSinks(v.project as string) : undefined;
  const { report } = await run({
    sourceText, execute: !!v.execute, project: v.project, docs: sinks?.docs, auth: sinks?.auth,
    accountsCsv: (rows) => { writeFileSync(csvPath, rows.map((r) => r.join(',')).join('\n') + '\n', { mode: 0o600 }); console.log(`Hesap listesi (geçici şifreler) yazıldı: ${csvPath}  -- DEPOYA EKLEMEYİN`); },
  });
  if (v['files-dir']) {
    const dir = resolve(v['files-dir']); const files = existsSync(dir) ? walk(dir) : [];
    const manifest = files.map((f) => ({ path: relative(dir, f), size: statSync(f).size, sha256: sha256(readFileSync(f)) }));
    writeFileSync(join(outDir, 'dosya-manifesti.json'), JSON.stringify(manifest, null, 2));
    console.log(`Dosya manifesti: ${manifest.length} dosya (Storage yüklemesi için GOC_REHBERI.md'ye bakın).`);
  }
  const reportPath = join(outDir, `rapor-${report.mode}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nKaynak SHA-256: ${report.sourceSha256}\nMod: ${report.mode}`);
  console.table(Object.fromEntries(Object.entries(report.collections).map(([k, c]) => [k, { kaynak: c.sourceCount, plan: c.planned, yazılan: c.written, değişmemiş: c.unchanged, doğrulanan: c.verifiedOk, kayıp: c.missing.length, farklı: c.mismatched.length }])));
  console.log(`Gizli alan temizlendi: ${report.strippedSecretFields}; e-postasız hesap: ${report.accounts.skippedNoEmail.length}`);
  report.warnings.forEach((w) => console.log('UYARI:', w)); report.validationErrors.forEach((e) => console.error('HATA:', e));
  console.log(report.ok ? (v.execute ? 'SONUÇ: BAŞARILI — tüm kayıtlar doğrulandı.' : 'SONUÇ: DRY-RUN temiz (hiçbir şey yazılmadı).') : 'SONUÇ: BAŞARISIZ');
  console.log('Rapor:', reportPath);
  if (report.validationErrors.length) return 1;
  return report.totals.missing || report.totals.mismatched ? 2 : report.ok ? 0 : 1;
}
main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(3); });
