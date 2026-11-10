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
const tasarim = require('./tasarim');

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

// ── DIŞ (FASON) TEKNİSYEN: hekim ve teknisyen birbirinin adını öğrenmez ──
// Gizleme tarayıcıda değil burada yapılır; ad dış teknisyenin bilgisayarına hiç gitmez.
function teknisyenBul(kok, id) {
  return Object.values(agac.al(kok, ['db', CALISMA_ALANI, 'technicians']) || {}).find(t => t && ayni(t.id, id)) || null;
}
function disTeknisyenMi(kok, id) { const t = teknisyenBul(kok, id); return !!(t && t.type === 'dis'); }
// "Ali Veli Kaya" → "A. V. K." (teknisyen panelinin gösterdiği kısaltmayla uyumlu)
function adKisalt(ad) {
  return String(ad || '').trim().split(/\s+/).filter(Boolean).map(p => p.charAt(0).toLocaleUpperCase('tr-TR') + '.').join(' ');
}
// Sohbet mesajlarında karşı tarafın adını rol adıyla değiştirir
function sohbetAdlariniGizle(sohbet, gizlenecekRol, yerine) {
  if (!sohbet || typeof sohbet !== 'object' || !sohbet.messages) return sohbet;
  const mesajlar = {};
  for (const [k, m] of Object.entries(sohbet.messages)) {
    mesajlar[k] = m && m.senderRole === gizlenecekRol ? { ...m, senderName: yerine, senderId: null } : m;
  }
  return { ...sohbet, messages: mesajlar };
}
// Önizleme kayıtlarında yükleyen / karar veren adlarını gizler
function onizlemeAdlariniGizle(kayit, alan) {
  if (!kayit || !kayit.previews) return kayit;
  const p = {};
  for (const [k, v] of Object.entries(kayit.previews)) {
    if (!v) continue;
    const n = { ...v };
    if (alan === 'yukleyen' && n.by) n.by = { rol: n.by.rol };
    if (alan === 'karar') delete n.kararVerenAd;
    p[k] = n;
  }
  return { ...kayit, previews: p };
}

// ── OKUMA GÖRÜNÜMLERİ ───────────────────────────────────────────────
// Her koleksiyon için "bu kişi bu koleksiyondan neyi görebilir" fonksiyonu
const gorunumler = {
  hekim: {
    doctors: (v, o) => haritala(v, d => (ayni(d.id, o.id) ? sifresiz(d) : undefined)),
    // Dış teknisyenin adı hekime gösterilmez
    jobs: (v, o, kok) => haritala(v, j => {
      if (!ayni(j.drId, o.id)) return undefined;
      return j.techId && disTeknisyenMi(kok, j.techId) ? { ...j, techName: 'Teknisyen', acceptedByTechName: j.acceptedByTechName ? 'Teknisyen' : undefined } : j;
    }),
    pendingJobs: (v, o) => sahibine(v, 'drId', o.id),
    doctorSubmissions: (v, o) => sahibine(v, 'drId', o.id),
    chats: (v, o, kok) => haritala(v, (sohbet, anahtar) => {
      const isId = isSohbetiIsId(anahtar);
      const is = isId && isBul(kok, isId);
      if (!is || !ayni(is.drId, o.id)) return undefined;
      return is.techId && disTeknisyenMi(kok, is.techId) ? sohbetAdlariniGizle(sohbet, 'technician', 'Teknisyen') : sohbet;
    }),
    // Tasarım önizlemeleri ve onay kayıtları: yalnızca kendi işleri
    designReviews: (v, o, kok) => haritala(v, (kayit, anahtar) => {
      const b = tasarim.isBul(kok, kayit.jobId !== undefined ? kayit.jobId : anahtar);
      if (!b || !ayni(b.is.drId, o.id)) return undefined;
      return b.is.techId && disTeknisyenMi(kok, b.is.techId) ? onizlemeAdlariniGizle(kayit, 'yukleyen') : kayit;
    }),
  },
  teknisyen: {
    technicians: (v, o) => haritala(v, t => (ayni(t.id, o.id)
      ? sifresiz(t)
      : { id: t.id, name: t.name, spec: t.spec, type: t.type })),
    // İç teknisyen hekim kartını (şifresiz) görür; dış teknisyen yalnızca kısaltılmış adı
    doctors: (v, o, kok) => {
      const dis = disTeknisyenMi(kok, o.id);
      return haritala(v, d => {
        if (dis) return { id: d.id, name: adKisalt(d.name), prices: d.prices };
        const k = sifresiz(d); delete k.username; return k;
      });
    },
    jobs: (v, o, kok) => {
      const dis = disTeknisyenMi(kok, o.id);
      return haritala(v, j => {
        if (!ayni(j.techId, o.id)) return undefined;
        return dis ? { ...j, drName: adKisalt(j.drName) } : j;
      });
    },
    pendingJobs: (v, o, kok) => {
      const dis = disTeknisyenMi(kok, o.id);
      return haritala(v, j => {
        if (!ayni(j.techId, o.id)) return undefined;
        return dis && j.drName ? { ...j, drName: adKisalt(j.drName) } : j;
      });
    },
    designReviews: (v, o, kok) => {
      const dis = disTeknisyenMi(kok, o.id);
      return haritala(v, (kayit, anahtar) => {
        const b = tasarim.isBul(kok, kayit.jobId !== undefined ? kayit.jobId : anahtar);
        if (!b || !ayni(b.is.techId, o.id)) return undefined;
        return dis ? onizlemeAdlariniGizle(kayit, 'karar') : kayit;
      });
    },
    orderForms: (v, o) => sahibine(v, 'submittedByTechId', o.id),
    chats: (v, o, kok) => haritala(v, (sohbet, anahtar) => {
      const isId = isSohbetiIsId(anahtar);
      const is = isId && isBul(kok, isId);
      if (!is || !ayni(is.techId, o.id)) return undefined;
      return disTeknisyenMi(kok, o.id) ? sohbetAdlariniGizle(sohbet, 'doctor', 'Hekim') : sohbet;
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
const TEKNISYEN_IS_ALANLARI = new Set(['status', 'completedAt', 'acceptedByTech', 'acceptedAt', 'acceptedByTechName',
  'files', 'designFiles', 'designFilesUpdatedAt', 'implantParts']);
const kurallar = {
  hekim: {
    doctorSubmissions: (once, sonra, o) =>
      (once === null || ayni(once.drId, o.id)) && (sonra === null || ayni(sonra.drId, o.id)),
    pendingJobs: (once, sonra, o) =>
      once !== null && sonra !== null && ayni(once.drId, o.id) && ayni(sonra.drId, o.id),
  },
  teknisyen: {
    // Teknisyen kendi işinde yalnızca kendi alanlarını değiştirebilir (fiyat, hekim,
    // hasta, teslim tarihi gibi alanlara dokunamaz). Hekim onayı gereken işte onay
    // gelmeden nihai tasarım dosyası ekleyemez ve işi tamamlayamaz.
    jobs: (once, sonra, o, kok) => {
      if (once === null || sonra === null || !ayni(once.techId, o.id) || !ayni(sonra.techId, o.id)) return false;
      for (const k of new Set([...Object.keys(once), ...Object.keys(sonra)])) {
        if (TEKNISYEN_IS_ALANLARI.has(k)) continue;
        if (JSON.stringify(once[k]) !== JSON.stringify(sonra[k])) throw new YetkiHatasi('Teknisyen bu alanı değiştiremez: ' + k);
      }
      const kayit = tasarim.kayitAl(kok, once.id !== undefined && once.id !== null ? once.id : '');
      if (!tasarim.uretimeHazir(once, kayit)) {
        const say = j => (Array.isArray(j.designFiles) ? j.designFiles.filter(Boolean).length : 0);
        if (say(sonra) > say(once)) throw new YetkiHatasi('Önce önizleme yükleyip hekim onayı alın: nihai tasarım dosyası hekim onayından sonra yüklenebilir ("Tasarım Onayı" penceresini kullanın)');
        if (sonra.status === 'Tamamlandı' && once.status !== 'Tamamlandı') throw new YetkiHatasi('Hekim tasarımı onaylamadan iş tamamlanamaz');
      }
      return true;
    },
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
    if (!kural(once, sonraKayit, oturum, kok)) throw new YetkiHatasi();
  }
  // Dış teknisyen hekim adlarını kısaltılmış görür; oluşturduğu kayıtlara (iş talebi,
  // sipariş formu) kısaltma değil hekimin gerçek adı yazılır.
  if (oturum.rol === 'teknisyen' && disTeknisyenMi(kok, oturum.id)) {
    const hekimler = Object.values(agac.al(kok, ['db', CALISMA_ALANI, 'doctors']) || {});
    return islemler.map(is => {
      const p = is.parcalar, d = is.deger;
      if (p.length !== 4 || !['pendingJobs', 'orderForms'].includes(p[2]) || !d || typeof d !== 'object') return is;
      const hekim = hekimler.find(h => h && ayni(h.id, d.drId));
      if (!hekim) return is;
      const n = { ...d };
      for (const alan of ['drName', 'doctorName']) if (typeof n[alan] === 'string' && n[alan]) n[alan] = hekim.name;
      return { parcalar: p, deger: n };
    });
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
