#!/usr/bin/env node
'use strict';
// GELİŞTİRİCİ ARACI — dağıtım paketi hazırlar.
// SURUM.txt ve paket-listesi.txt (her dosyanın SHA-256 özeti) üretir.
// DIGICAD-Guncelle.bat bu listeyle paketin eksiksiz olduğunu doğrular.
// Kullanım: node araclar/paketle.js   (ardından klasör ZIP'lenir)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const KOK = path.join(__dirname, '..');
const HARIC = new Set(['veri', 'paket-listesi.txt', '.gitignore', '.gitattributes']);
const d = new Date(), p = n => String(n).padStart(2, '0');
fs.writeFileSync(path.join(KOK, 'SURUM.txt'), `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}\r\n`);
const satirlar = [];
(function gez(k, goreli) {
  for (const g of fs.readdirSync(k, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!goreli && HARIC.has(g.name)) continue;
    const t = path.join(k, g.name), r = goreli ? goreli + '\\' + g.name : g.name;
    if (g.isDirectory()) gez(t, r);
    else satirlar.push(crypto.createHash('sha256').update(fs.readFileSync(t)).digest('hex') + '  ' + r);
  }
})(KOK, '');
fs.writeFileSync(path.join(KOK, 'paket-listesi.txt'), satirlar.join('\r\n') + '\r\n');
console.log(`SURUM.txt + paket-listesi.txt (${satirlar.length} dosya)`);
