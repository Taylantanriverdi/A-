#!/usr/bin/env node
// Detaylı kazıma raporu (komut satırı)
//
// Kullanım: node tools/report.mjs is.nc [--tools 5:ball:2.5,4:ball:1.0] [--H 14] [--disc 98.5] [--res 0.1]
//           [--html rapor.html] [--json rapor.json] [--csv rapor.csv] [--quiet]
// --tools verilmezse çaplar NC yorumlarından okunur; okunamazsa varsayılan kullanılır ve raporda uyarılır.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NCReport = require('../src/report.js');

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--') || argv[i - 1] === '--quiet'));
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
if (!file) { console.error('Kullanım: node tools/report.mjs is.nc [--tools T:tip:çap,...] [--H mm] [--html f] [--json f] [--csv f]'); process.exit(2); }

let tools;
if (opt('tools')) {
  tools = {};
  for (const s of opt('tools').split(',')) { const [t, type, d] = s.split(':'); tools[+t] = { type, d: +d }; }
}
const settings = {};
if (opt('H')) settings.H = +opt('H');
if (opt('disc')) settings.discD = +opt('disc');
if (opt('res')) settings.res = +opt('res');

const R = NCReport.buildReport(fs.readFileSync(file, 'utf8'), file.split(/[\\/]/).pop(), { tools, settings });
if (opt('html')) fs.writeFileSync(opt('html'), NCReport.toHTML(R));
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(R, null, 1));
if (opt('csv')) fs.writeFileSync(opt('csv'), NCReport.toCSV(R));
if (!argv.includes('--quiet')) console.log(NCReport.toText(R));
