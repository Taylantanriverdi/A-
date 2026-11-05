'use strict';
// Firebase Realtime Database'in veri modelini taklit eden JSON ağacı yardımcıları.
// Yollar "db/digicad/jobs/123" biçimindedir; boş değerler (null, {}, [])
// Firebase'deki gibi ağaçtan silinir.

function parcala(yol) {
  if (Array.isArray(yol)) return yol.slice();
  return String(yol == null ? '' : yol).split('/').filter(Boolean);
}

function al(agac, parcalar) {
  let v = agac;
  for (const p of parcalar) {
    if (v === null || typeof v !== 'object') return null;
    v = v[p];
  }
  return v === undefined ? null : v;
}

// Firebase gibi: null / boş nesne / boş dizi değerlerini temizler.
// Tamamen boşsa undefined döner.
function temizle(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const dizi = v.map(x => { const t = temizle(x); return t === undefined ? null : t; });
    return dizi.some(x => x !== null) ? dizi : undefined;
  }
  const n = {};
  let bos = true;
  for (const k of Object.keys(v)) {
    const t = temizle(v[k]);
    if (t !== undefined) { n[k] = t; bos = false; }
  }
  return bos ? undefined : n;
}

function bosMu(o) {
  if (o === null || o === undefined) return true;
  if (typeof o !== 'object') return false;
  if (Array.isArray(o)) return !o.some(x => x !== null && x !== undefined);
  return Object.keys(o).length === 0;
}

// Ağaçta bir yola değer yazar (null = sil). Kök nesneyi döner.
function yaz(kok, parcalar, deger) {
  deger = temizle(deger);
  if (!parcalar.length) return deger === undefined || typeof deger !== 'object' || Array.isArray(deger) ? {} : deger;
  if (kok === null || typeof kok !== 'object') kok = {};
  const zincir = [];
  let v = kok;
  for (let i = 0; i < parcalar.length - 1; i++) {
    const p = parcalar[i];
    if (v[p] === null || v[p] === undefined || typeof v[p] !== 'object') {
      if (deger === undefined) return kok; // silinecek bir şey yok
      v[p] = {};
    }
    zincir.push([v, p]);
    v = v[p];
  }
  const son = parcalar[parcalar.length - 1];
  if (deger === undefined) {
    if (Array.isArray(v) && /^\d+$/.test(son)) v[son] = null; else delete v[son];
    // Boşalan üst düğümleri temizle
    for (let i = zincir.length - 1; i >= 0; i--) {
      const [ust, anahtar] = zincir[i];
      if (bosMu(ust[anahtar])) delete ust[anahtar]; else break;
    }
  } else {
    v[son] = deger;
  }
  return kok;
}

// set / update / remove işlemlerini tek tek yaprak yazımlarına açar.
function islemleriAc(islem, yol, deger) {
  const p = parcala(yol);
  if (islem === 'set') return [{ parcalar: p, deger }];
  if (islem === 'remove') return [{ parcalar: p, deger: null }];
  if (islem === 'update') {
    if (deger === null || typeof deger !== 'object' || Array.isArray(deger)) {
      throw new Error('update için nesne gerekli');
    }
    return Object.keys(deger).map(k => ({ parcalar: p.concat(parcala(k)), deger: deger[k] }));
  }
  throw new Error('Bilinmeyen işlem: ' + islem);
}

function onEkMi(a, b) { // a, b'nin ön eki mi?
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function kesisir(a, b) { return onEkMi(a, b) || onEkMi(b, a); }

function kopya(v) { return v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)); }

// orderByChild / equalTo / limitToFirst / limitToLast sorguları
function sorguUygula(deger, sorgu) {
  if (!sorgu || deger === null || typeof deger !== 'object') return deger;
  let girdiler = Object.entries(deger).filter(([, v]) => v !== null && v !== undefined);
  const cocuk = sorgu.orderByChild;
  const anahtarDegeri = (k, v) => cocuk ? al(v, parcala(cocuk)) : (sorgu.orderByValue ? v : k);
  if (Object.prototype.hasOwnProperty.call(sorgu, 'equalTo')) {
    girdiler = girdiler.filter(([k, v]) => anahtarDegeri(k, v) === sorgu.equalTo);
  }
  if (cocuk || sorgu.orderByKey || sorgu.orderByValue) {
    girdiler.sort((x, y) => {
      const a = anahtarDegeri(x[0], x[1]), b = anahtarDegeri(y[0], y[1]);
      if (a === b) return x[0] < y[0] ? -1 : 1;
      if (a === null || a === undefined) return -1;
      if (b === null || b === undefined) return 1;
      return a < b ? -1 : 1;
    });
  }
  if (sorgu.limitToFirst) girdiler = girdiler.slice(0, sorgu.limitToFirst);
  if (sorgu.limitToLast) girdiler = girdiler.slice(-sorgu.limitToLast);
  if (!girdiler.length) return null;
  const sonuc = {};
  for (const [k, v] of girdiler) sonuc[k] = v;
  return sonuc;
}

module.exports = { parcala, al, temizle, yaz, islemleriAc, onEkMi, kesisir, kopya, sorguUygula, bosMu };
