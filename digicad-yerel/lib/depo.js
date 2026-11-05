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
    if (fs.existsSync(this.dosya)) {
      const metin = fs.readFileSync(this.dosya, 'utf8');
      this.kok = metin.trim() ? JSON.parse(metin) : {};
    }
    this._kayitZamanlayici = null;
    this._kirli = false;
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
    this._kayitZamanlayici = setTimeout(() => { this._kayitZamanlayici = null; this.kaydet(); }, 300);
  }

  kaydet() {
    if (!this._kirli) return;
    this._kirli = false;
    const gecici = this.dosya + '.tmp';
    const fd = fs.openSync(gecici, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(this.kok));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(gecici, this.dosya);
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
