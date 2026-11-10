'use strict';
// SUNUCU TARAFI YETKİ KURALLARI
// Eski sistemde hekim/teknisyen portalları TÜM veriyi indirip tarayıcıda
// süzüyordu (ve hekim şifreleri de buna dahildi). Artık süzme burada,
// sunucuda yapılır: tarayıcıya yalnızca o kişinin görmeye yetkili olduğu
// kayıtlar gönderilir.
//
// Roller:
//   yonetici  — Yönetim paneli (PrimerLab) ve Gelen İşler paneli. Her şey.
//   hekim     — Sadece kendi işleri, kendi gönderimleri, kendi iş sohbetleri.
//   teknisyen — Sadece kendisine atanmış işler, kendi girdiği kayıtlar.

const agac = require('./agac');

const CALISMA_ALANI = 'digicad'; // Hekim/teknisyen portalları yalnızca bu alana erişir
const sahip = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ayni = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

class YetkiHatasi extends Error {
  constructor(m) { super(m || 'Bu işlem için yetkiniz yok'); this.durum = 403; }
}

// Kayıtlardaki gizli alanları ayıklar
function sifresiz(kayit) {
  if (!kayit || typeof kayit !== 'object') return kayit;
  const k = { ...kayit };
  delete k.password;
  delete k.passwordHash;
  return k;
}
function haritala(nesne, fn) {
  if (!nesne || typeof nesne !== 'object') return null;
  const sonuc = {};
  for (const [anahtar, v] of Object.entries(nesne)) {
    if (v === null || v === undefined) continue;
    const t = fn(v, anahtar);
    if (t !== undefined && t !== null) sonuc[anahtar] = t;
  }
  return Object.keys(sonuc).length ? sonuc : null;
}
function sahibine(nesne, alan, id) { return haritala(nesne, v => (ayni(v[alan], id) ? v : undefined)); }

function isSohbetiIsId(anahtar) {
  const m = /^job_(.+)$/.exec(anahtar || '');
  return m ? m[1] : null;
}
function isBul(kok, isId) {
  const isler = agac.al(kok, ['db', CALISMA_ALANI, 'jobs']) || {};
  if (sahip(isler, isId) && isler[isId]) return isler[isId];
  return Object.values(isler).find(j => j && ayni(j.id, isId)) || null;
}

// ── OKUMA GÖRÜNÜMLERİ ───────────────────────────────────────────────
// Her koleksiyon için "bu kişi bu koleksiyondan neyi görebilir" fonksiyonu
const gorunumler = {
  hekim: {
    doctors: (v, o) => haritala(v, d => (ayni(d.id, o.id) ? sifresiz(d) : undefined)),
    jobs: (v, o) => sahibine(v, 'drId', o.id),
    pendingJobs: (v, o) => sahibine(v, 'drId', o.id),
    doctorSubmissions: (v, o) => sahibine(v, 'drId', o.id),
    chats: (v, o, kok) => haritala(v, (sohbet, anahtar) => {
      const isId = isSohbetiIsId(anahtar);
      const is = isId && isBul(kok, isId);
      return is && ayni(is.drId, o.id) ? sohbet : undefined;
    }),
  },
  teknisyen: {
    technicians: (v, o) => haritala(v, t => (ayni(t.id, o.id)
      ? sifresiz(t)
      : { id: t.id, name: t.name, spec: t.spec, type: t.type })),
    doctors: v => haritala(v, d => { const k = sifresiz(d); delete k.username; return k; }),
    jobs: (v, o) => sahibine(v, 'techId', o.id),
    pendingJobs: (v, o) => sahibine(v, 'techId', o.id),
    orderForms: (v, o) => sahibine(v, 'submittedByTechId', o.id),
    chats: (v, o, kok) => haritala(v, (sohbet, anahtar) => {
      const isId = isSohbetiIsId(anahtar);
      const is = isId && isBul(kok, isId);
      return is && ayni(is.techId, o.id) ? sohbet : undefined;
    }),
  },
};

// Bir yolun bu oturum için görünen değerini döndürür.
// Oturum yoksa null döner (sayfalar giriş ekranını gösterebilsin diye hata vermez).
function oku(kok, oturum, parcalar) {
  if (!oturum) return null;
  if (oturum.rol === 'yonetici') return agac.al(kok, parcalar);
  const g = sahip(gorunumler, oturum.rol) ? gorunumler[oturum.rol] : null;
  if (!g) return null;
  if (parcalar[0] !== 'db' || parcalar[1] !== CALISMA_ALANI || parcalar.length < 3) throw new YetkiHatasi();
  const koleksiyon = parcalar[2];
  const fn = sahip(g, koleksiyon) ? g[koleksiyon] : null;
  if (typeof fn !== 'function') throw new YetkiHatasi();
  const gorunum = fn(agac.al(kok, ['db', CALISMA_ALANI, koleksiyon]), oturum, kok);
  return agac.al(gorunum, parcalar.slice(3));
}

// ── YAZMA KURALLARI ─────────────────────────────────────────────────
// Kayıt düzeyinde kontrol: yazımdan ÖNCEKİ ve SONRAKİ kayıt birlikte
// değerlendirilir; böylece "başkasının kaydını kendime çevireyim" ya da
// "kendi kaydımı başkasınınmış gibi göstereyim" türü hileler engellenir.
const kurallar = {
  hekim: {
    doctorSubmissions: (once, sonra, o) =>
      (once === null || ayni(once.drId, o.id)) && (sonra === null || ayni(sonra.drId, o.id)),
    pendingJobs: (once, sonra, o) =>
      once !== null && sonra !== null && ayni(once.drId, o.id) && ayni(sonra.drId, o.id),
  },
  teknisyen: {
    jobs: (once, sonra, o) =>
      once !== null && sonra !== null && ayni(once.techId, o.id) && ayni(sonra.techId, o.id) &&
      String(once.drId) === String(sonra.drId),
    pendingJobs: (once, sonra, o) =>
      (once === null || ayni(once.techId, o.id)) && (sonra === null || ayni(sonra.techId, o.id)),
    orderForms: (once, sonra, o) =>
      (once === null || ayni(once.submittedByTechId, o.id)) && sonra !== null && ayni(sonra.submittedByTechId, o.id),
  },
};

// Yöneticinin yazımlarından eski düz metin PIN alanlarını ayıklar
// (PIN artık sunucu ayarlarında, şifrelenmiş olarak tutulur).
function pinAlanlariniAyikla(islemler) {
  const sonuc = [];
  for (const is of islemler) {
    const p = is.parcalar;
    if ((p[0] === 'meta' && p[1] === 'pass') || (p[0] === 'db' && p.length === 3 && p[2] === 'pass')) continue;
    let deger = is.deger;
    if (deger && typeof deger === 'object' && !Array.isArray(deger)) {
      if (p.length === 2 && p[0] === 'db' && 'pass' in deger) { deger = { ...deger }; delete deger.pass; }
      if (p.length === 1 && p[0] === 'meta' && 'pass' in deger) { deger = { ...deger }; delete deger.pass; }
    }
    sonuc.push({ parcalar: p, deger });
  }
  return sonuc;
}

// Yazım isteğini denetler; izin verilen işlem listesini döner ya da YetkiHatasi fırlatır.
function yazimDenetle(kok, oturum, islemler) {
  if (!oturum) throw new YetkiHatasi('Oturum açmanız gerekiyor');
  if (oturum.rol === 'yonetici') return pinAlanlariniAyikla(islemler);

  const rolKurallari = sahip(kurallar, oturum.rol) ? kurallar[oturum.rol] : {};
  const kayitlar = new Map(); // "koleksiyon/anahtar" -> [islem]
  for (const is of islemler) {
    const p = is.parcalar;
    if (p.length < 4 || p[0] !== 'db' || p[1] !== CALISMA_ALANI) throw new YetkiHatasi();
    const anahtar = p[2] + '/' + p[3];
    if (!kayitlar.has(anahtar)) kayitlar.set(anahtar, []);
    kayitlar.get(anahtar).push(is);
  }

  for (const [anahtar, liste] of kayitlar) {
    const koleksiyon = liste[0].parcalar[2], kayitId = liste[0].parcalar[3];

    if (koleksiyon === 'chats') {
      // Sadece kendi işlerinin sohbetine mesaj yazabilir: chats/job_X/messages/M
      const isId = isSohbetiIsId(kayitId);
      const is = isId && isBul(kok, isId);
      const alan = oturum.rol === 'hekim' ? 'drId' : 'techId';
      if (!is || !ayni(is[alan], oturum.id)) throw new YetkiHatasi();
      for (const y of liste) {
        if (y.parcalar.length < 6 || y.parcalar[4] !== 'messages') throw new YetkiHatasi();
        const mesaj = y.parcalar.length === 6 ? y.deger : null;
        if (mesaj && typeof mesaj === 'object' && mesaj.senderRole && mesaj.senderRole !== (oturum.rol === 'hekim' ? 'doctor' : 'technician')) {
          throw new YetkiHatasi('Başkası adına mesaj gönderilemez');
        }
      }
      continue;
    }

    const kural = sahip(rolKurallari, koleksiyon) ? rolKurallari[koleksiyon] : null;
    if (typeof kural !== 'function') throw new YetkiHatasi();
    const kayitYolu = ['db', CALISMA_ALANI, koleksiyon, kayitId];
    const once = agac.al(kok, kayitYolu);
    let sonra = { kok: agac.kopya(once) };
    for (const y of liste) sonra = agac.yaz(sonra, ['kok', ...y.parcalar.slice(4)], agac.kopya(y.deger));
    const sonraKayit = agac.al(sonra, ['kok']);
    if (!kural(once, sonraKayit, oturum)) throw new YetkiHatasi();
  }
  return islemler;
}

// Bir değişiklik, bu oturumun aboneliğini etkileyebilir mi?
function etkilerMi(oturum, aboneYolu, degisenYollar) {
  if (!oturum) return false;
  if (oturum.rol === 'yonetici') return degisenYollar.some(d => agac.kesisir(aboneYolu, d));
  // Hekim/teknisyen görünümleri diğer koleksiyonlara bağlı olabilir (ör. sohbet
  // yetkisi iş kaydına bağlı) — alan içindeki her değişiklikte yeniden hesapla.
  return degisenYollar.some(d => agac.kesisir(['db', CALISMA_ALANI], d));
}

module.exports = { oku, yazimDenetle, etkilerMi, sifresiz, YetkiHatasi, CALISMA_ALANI, ayni };
