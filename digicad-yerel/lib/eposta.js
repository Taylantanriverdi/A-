'use strict';
// ═══════════════════════════════════════════════════════════════════
//  E-POSTA BİLDİRİMİ — ek paket gerektirmeyen küçük bir SMTP istemcisi
//  Laboratuvarın kendi posta hesabından (ör. Gmail "uygulama şifresi" ile)
//  hekime "önizlemeniz hazır" gibi kısa bildirimler gönderir.
//  Bağlantı baştan sona şifrelidir (TLS, 465 numaralı kapı).
//  Testlerde DIGICAD_EPOSTA_KLASORU verilirse posta gönderilmez; her ileti
//  o klasöre bir dosya olarak yazılır.
// ═══════════════════════════════════════════════════════════════════
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const adresGecerli = a => typeof a === 'string' && a.length <= 200 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(a);
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
// Başlıklarda Türkçe karakter (RFC 2047); satır sonu karakterleri başlığa sızamaz
const baslik = s => '=?UTF-8?B?' + b64(String(s).replace(/[\r\n]+/g, ' ').slice(0, 150)) + '?=';

function ileti({ gonderen, gonderenAd, alici, konu, metin }) {
  const govde = b64(metin).replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${baslik(gonderenAd || 'DIGICAD Dental')} <${gonderen}>`,
    `To: <${alici}>`,
    `Subject: ${baslik(konu)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${gonderen.split('@')[1] || os.hostname()}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    govde,
  ].join('\r\n');
}

// Tek bir iletiyi gönderir. ayar: { sunucu, port, kullanici, sifre, gonderenAd }
function gonder(ayar, { alici, konu, metin }) {
  if (!adresGecerli(alici)) return Promise.reject(new Error('Alıcı e-posta adresi geçersiz'));
  if (!adresGecerli(ayar.kullanici) || !ayar.sifre) return Promise.reject(new Error('E-posta hesabı ayarlanmamış'));
  const ham = ileti({ gonderen: ayar.kullanici, gonderenAd: ayar.gonderenAd, alici, konu, metin });

  const klasor = process.env.DIGICAD_EPOSTA_KLASORU;
  if (klasor) { // test kipi
    fs.mkdirSync(klasor, { recursive: true });
    fs.writeFileSync(path.join(klasor, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json'), JSON.stringify({ alici, konu, metin }, null, 1));
    return Promise.resolve();
  }

  return new Promise((coz, reddet) => {
    let bitti = false, tampon = '', adim = 0;
    const s = tls.connect({ host: ayar.sunucu || 'smtp.gmail.com', port: Number(ayar.port) || 465, servername: ayar.sunucu || 'smtp.gmail.com' });
    const bitir = hata => {
      if (bitti) return;
      bitti = true;
      clearTimeout(sure);
      try { s.destroy(); } catch (e) { /* yoksay */ }
      if (hata) reddet(hata); else coz();
    };
    const sure = setTimeout(() => bitir(new Error('Posta sunucusu yanıt vermedi (zaman aşımı)')), 30e3);
    // Her adım: [gönderilecek komut, beklenen yanıt kodu]
    const adimlar = [
      [null, 220],
      ['EHLO digicad.local', 250],
      ['AUTH LOGIN', 334],
      [b64(ayar.kullanici), 334],
      [b64(ayar.sifre), 235],
      [`MAIL FROM:<${ayar.kullanici}>`, 250],
      [`RCPT TO:<${alici}>`, 250],
      ['DATA', 354],
      [ham.replace(/^\./gm, '..') + '\r\n.', 250],
      ['QUIT', 221],
    ];
    s.setEncoding('utf8');
    s.on('error', e => bitir(new Error('Posta sunucusuna bağlanılamadı: ' + e.message)));
    s.on('close', () => bitir(new Error('Posta sunucusu bağlantıyı kapattı')));
    s.on('data', veri => {
      tampon += veri;
      // Yanıt, "250 " gibi (kod + boşluk) ile başlayan satırla biter; "250-" devam satırıdır
      const satirlar = tampon.split('\r\n');
      const son = satirlar.length >= 2 ? satirlar[satirlar.length - 2] : '';
      if (!tampon.endsWith('\r\n') || !/^\d{3} /.test(son)) return;
      tampon = '';
      const kod = Number(son.slice(0, 3));
      if (kod !== adimlar[adim][1]) {
        const neden = adim === 4 ? 'Kullanıcı adı ya da uygulama şifresi kabul edilmedi' : (son.slice(4) || 'bilinmeyen yanıt');
        return bitir(new Error('Posta gönderilemedi: ' + neden));
      }
      adim++;
      if (adim >= adimlar.length) return bitir();
      s.write(adimlar[adim][0] + '\r\n');
    });
  });
}

// ── Kuyruk: bildirimler sırayla, başarısız olursa birkaç kez yeniden denenerek gönderilir ──
const gecmis = []; // son 30 gönderim { zaman, alici, konu, durum }
let kuyruk = Promise.resolve();
function sirayaKoy(ayarAl, posta) {
  kuyruk = kuyruk.then(async () => {
    let sonHata = null;
    for (let deneme = 1; deneme <= 3; deneme++) {
      try { await gonder(ayarAl(), posta); sonHata = null; break; }
      catch (e) {
        sonHata = e;
        if (/kabul edilmedi|geçersiz|ayarlanmamış/.test(e.message)) break; // yeniden denemenin yararı yok
        await new Promise(c => setTimeout(c, 5000 * deneme));
      }
    }
    gecmis.unshift({ zaman: new Date().toISOString(), alici: posta.alici, konu: posta.konu, durum: sonHata ? 'HATA: ' + sonHata.message : 'gönderildi' });
    gecmis.length = Math.min(gecmis.length, 30);
    if (sonHata) console.error(`[e-posta] ${posta.alici} — ${sonHata.message}`);
    else console.log(`[e-posta] ${posta.alici} — ${posta.konu}`);
  }).catch(() => {});
  return kuyruk;
}

module.exports = { gonder, sirayaKoy, gecmis, adresGecerli };
