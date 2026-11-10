'use strict';
// Veritabanı: bellekte tutulan tek bir JSON ağacı, diske atomik olarak yazılır.
// - Her değişiklikten kısa süre sonra veri/veritabani.json güncellenir
//   (önce .tmp dosyasına yazılır, sonra yeniden adlandırılır — elektrik
//   kesilse bile dosya yarım kalmaz).
// - Her gün veri/yedekler/ altına bir kopya alınır (son 60 gün saklanır).

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const agac = require('./agac');

class Depo extends EventEmitter {
  constructor(klasor) {
    super();
    this.klasor = klasor;
    this.dosya = path.join(klasor, 'veritabani.json');
    this.yedekKlasoru = path.join(klasor, 'yedekler');
    fs.mkdirSync(this.yedekKlasoru, { recursive: true });
    this.kok = {};
    if (fs.existsSync(this.dosya)) this.kok = this._yukle();
    this._kayitZamanlayici = null;
    if (this._kirli) this.kaydet(); else this._kirli = false;
  }

  // Veritabanı dosyasını okur. Dosya bozulmuşsa (disk hatası vb.) sunucu açılmaz
  // hâle gelmesin diye bozuk dosya saklanır ve en yeni sağlam yedek yüklenir.
  _yukle() {
    const oku = dosya => {
      const metin = fs.readFileSync(dosya, 'utf8');
      const v = metin.trim() ? JSON.parse(metin) : {};
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('beklenmeyen içerik');
      return v;
    };
    try { return oku(this.dosya); } catch (e) {
      const bozuk = this.dosya.replace(/\.json$/, `-BOZUK-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      try { fs.copyFileSync(this.dosya, bozuk); } catch (x) { /* yoksay */ }
      console.error(`[veritabanı] UYARI: veritabani.json okunamadı (${e.message}). Bozuk dosya saklandı: ${bozuk}`);
      const yedekler = fs.readdirSync(this.yedekKlasoru).filter(f => /^veritabani-.*\.json$/.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(this.yedekKlasoru, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const y of yedekler) {
        try {
          const v = oku(path.join(this.yedekKlasoru, y.f));
          console.error(`[veritabanı] UYARI: en yeni sağlam yedek yüklendi: ${y.f} — bu yedekten sonraki değişiklikler eksik olabilir.`);
          this._kirli = true; // sağlam kopya ana dosyanın yerine yazılsın
          return v;
        } catch (x) { /* sıradaki yedeği dene */ }
      }
      throw new Error('veritabani.json bozuk ve sağlam bir yedek bulunamadı. Bozuk dosya: ' + bozuk);
    }
  }

  oku(yol) { return agac.al(this.kok, agac.parcala(yol)); }

  // islemler: [{ parcalar, deger }]
  uygula(islemler) {
    if (!islemler.length) return;
    for (const is of islemler) this.kok = agac.yaz(this.kok, is.parcalar, agac.kopya(is.deger));
    this._kirli = true;
    this._kayitPlanla();
    this.emit('degisti', islemler.map(i => i.parcalar));
  }

  _kayitPlanla() {
    if (this._kayitZamanlayici) return;
    this._kayitZamanlayici = setTimeout(() => {
      this._kayitZamanlayici = null;
      try { this.kaydet(); this._kayitHatasi = 0; }
      catch (e) {
        // Disk dolu / dosya kilitli: veri bellekte durur, kısa süre sonra yeniden denenir
        this._kayitHatasi = (this._kayitHatasi || 0) + 1;
        console.error(`[veritabanı] KAYIT HATASI (${this._kayitHatasi}. deneme): ${e.message} — yeniden denenecek`);
        setTimeout(() => this._kayitPlanla(), Math.min(60e3, 2000 * this._kayitHatasi)).unref();
      }
    }, 300);
  }

  kaydet() {
    if (!this._kirli) return;
    const gecici = this.dosya + '.tmp';
    const metin = JSON.stringify(this.kok);
    const fd = fs.openSync(gecici, 'w');
    try {
      fs.writeSync(fd, metin);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(gecici, this.dosya);
    this._kirli = false; // ancak dosya gerçekten yazıldıysa "kaydedildi" say
  }

  gunlukYedek(saklanacakGun = 60) {
    this.kaydet();
    if (!fs.existsSync(this.dosya)) return null;
    const bugun = new Date().toISOString().slice(0, 10);
    const hedef = path.join(this.yedekKlasoru, `veritabani-${bugun}.json`);
    fs.copyFileSync(this.dosya, hedef);
    const eskiler = fs.readdirSync(this.yedekKlasoru)
      .filter(f => /^veritabani-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (eskiler.length > saklanacakGun) fs.unlinkSync(path.join(this.yedekKlasoru, eskiler.shift()));
    return hedef;
  }
}

module.exports = Depo;
