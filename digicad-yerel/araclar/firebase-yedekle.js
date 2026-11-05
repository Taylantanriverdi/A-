#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════
//  ESKİ SİSTEMİN (FIREBASE) TAM YEDEĞİNİ ALIR — salt-okunur
//  Firebase'e yalnızca okuma isteği gönderilir; hiçbir veri değiştirilmez.
//  Yedek: veri\firebase-yedekleri\<tarih-saat>\
//  Aynı işlem yönetim panelindeki "Veri Aktarımı" sayfasından da yapılabilir.
//  Sunucu açıkken de çalıştırılabilir.
// ═══════════════════════════════════════════════════════════════════
const path = require('path');
const { yedekAl } = require('../lib/firebase-yedek');

const VERI = process.env.DIGICAD_VERI || path.join(__dirname, '..', 'veri');
const KOK = path.join(VERI, 'firebase-yedekleri');

(async () => {
  console.log('Firebase (eski sistem) yedeği alınıyor — yalnızca OKUMA yapılır, Firebase\'deki veriler değiştirilmez.\n');
  let son = '';
  const s = await yedekAl({
    kokKlasor: KOK,
    ilerleme: d => {
      if (d.asama !== son) { if (son) process.stdout.write('\n'); console.log(d.asama); son = d.asama; }
      if (d.dosya && d.dosya.toplam) process.stdout.write(`\r  ${d.dosya.biten}/${d.dosya.toplam} dosya`);
    },
  });
  console.log('\n\n✓ Yedek tamamlandı: ' + s.klasor);
  for (const [ws, say] of Object.entries(s.sayilar)) {
    console.log(`  ${ws === 'digicad' ? 'DIGICAD' : 'Primer'}: ` + Object.entries(say).map(([k, n]) => `${k} ${n}`).join(' · '));
  }
  console.log(`  Dosya: ${s.dosyalar.tamam}/${s.dosyalar.toplam} (${(s.dosyalar.toplamBoyut / 1048576).toFixed(1)} MB)`);
  if (s.hatali.length) console.log(`  İndirilemeyen ${s.hatali.length} dosya OZET.txt içinde listelendi.`);
  console.log('\nYeni sisteme yüklemek için: Yönetim paneli → Ayarlar → 🔄 Eski Sistemden Veri Aktar');
})().catch(e => { console.error('\nHATA: ' + e.message + '\n(Firebase\'de hiçbir şey değiştirilmedi; yarım kalan yedek silindi.)'); process.exit(1); });
