/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — is-akisi-kural.js  ·  İŞ AKIŞI KURALLARI
   Sunucu (lib/is-akisi.js) ve paneller (is-akisi.js) AYNI kuralları kullanır:
   aşamalar, izinli geçişler, eski işler için varsayılan aşama, son tarihler.
   ═══════════════════════════════════════════════════════════════════ */
(function (kok, fabrika) {
  if (typeof module === 'object' && module.exports) module.exports = fabrika();
  else kok.IsAkisiKural = fabrika();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ASAMALAR = [
    { kod: 'kabul', ad: 'İş kabul', kisa: 'Kabul', simge: '📥', tur: 'uretim' },
    { kod: 'tasarim', ad: 'Tasarım', kisa: 'Tasarım', simge: '🎨', tur: 'uretim' },
    { kod: 'pmma_uretim', ad: 'PMMA geçici üretim', kisa: 'PMMA üretim', simge: '🖨️', tur: 'uretim', pmma: true },
    { kod: 'pmma_prova', ad: 'PMMA hekimde prova', kisa: 'PMMA prova', simge: '🦷', tur: 'prova', pmma: true },
    { kod: 'pmma_revizyon', ad: 'PMMA revizyon (düzenleme)', kisa: 'PMMA revizyon', simge: '✏️', tur: 'revizyon', pmma: true },
    { kod: 'zirkon', ad: 'Zirkonyum tasarım/üretim', kisa: 'Zirkonyum', simge: '💎', tur: 'uretim' },
    { kod: 'zirkon_prova', ad: 'Zirkonyum hekimde prova', kisa: 'Zirkon prova', simge: '🦷', tur: 'prova' },
    { kod: 'ilave', ad: 'İlave / düzeltme', kisa: 'İlave/düzeltme', simge: '🔧', tur: 'revizyon' },
    { kod: 'teslim', ad: 'Teslim edildi', kisa: 'Teslim', simge: '✅', tur: 'son' },
  ];
  const ASAMA = {};
  ASAMALAR.forEach((a, i) => { a.sira = i; ASAMA[a.kod] = a; });
  const KODLAR = ASAMALAR.map(a => a.kod);

  const PMMA_URETICI = { lab: 'Laboratuvar üretecek', hekim: 'Hekim kendisi basacak', yok: 'PMMA yok' };

  // Varsayılan aşama süreleri (gün) — ayarlardan değiştirilebilir
  const VARSAYILAN_SURELER = { kabul: 1, tasarim: 1, pmma_uretim: 1, pmma_revizyon: 1, zirkon: 2, ilave: 1 };
  // Hekim "laboratuvar önersin" derse: iş tipi süresi bulunamazsa kullanılacak gün
  const VARSAYILAN_IS_SURESI = 5;

  // ── Geçiş kuralları ──────────────────────────────────────────────
  // Döngüler: PMMA prova → PMMA revizyon → PMMA prova …  (sınırsız)
  //           Zirkon prova → İlave/düzeltme → Zirkon prova … (sınırsız)
  // İleri yönde ara aşamalar atlanabilir. Revizyon aşamalarına yalnızca
  // ilgili provadan girilir. Laboratuvar her aşamaya (geri dahil) alabilir.
  function geriDongu(from, to) {
    return (from === 'pmma_revizyon' && to === 'pmma_prova') || (from === 'ilave' && to === 'zirkon_prova');
  }
  function normalGecis(from, to) {
    if (!ASAMA[from] || !ASAMA[to] || from === to || from === 'teslim') return false;
    if (geriDongu(from, to)) return true;
    if (from === 'pmma_revizyon') return false; // revizyon bitince önce provaya döner
    if (to === 'pmma_revizyon') return from === 'pmma_prova';
    if (to === 'ilave') return ASAMA[from].sira >= ASAMA.zirkon.sira; // zirkonyumdan sonra ilave/düzeltme
    return ASAMA[to].sira > ASAMA[from].sira;
  }
  // Teknisyenin ilerletebileceği aşamalar (prova sonucu hekime/laboratuvara ait; teslim laboratuvarındır)
  const TEKNISYEN_HEDEF = new Set(['tasarim', 'pmma_uretim', 'pmma_prova', 'zirkon', 'zirkon_prova']);
  function gecisIzinli(rol, from, to) {
    if (rol === 'yonetici') return !!ASAMA[to] && from !== to;
    if (rol === 'teknisyen') return normalGecis(from, to) && TEKNISYEN_HEDEF.has(to) && ASAMA[from].tur !== 'prova';
    return false; // hekim aşamayı doğrudan değiştirmez; prova sonucu bildirir
  }
  // Bir aşamadan izinli hedefler (ekrandaki düğmeler için), önerilen önce
  function hedefler(rol, from, pmmaUretici) {
    const l = KODLAR.filter(to => gecisIzinli(rol, from, to));
    const pmmaYok = pmmaUretici === 'yok';
    const oneri = sonrakiOneri(from, pmmaUretici);
    return l.sort((a, b) => (b === oneri) - (a === oneri) || ASAMA[a].sira - ASAMA[b].sira)
      .map(kod => ({ kod, ad: ASAMA[kod].ad, oneri: kod === oneri,
        geri: !normalGecis(from, kod) && ASAMA[kod].sira < (ASAMA[from] ? ASAMA[from].sira : 0), // yalnızca laboratuvar: geri alma
        disiSira: !normalGecis(from, kod), // yalnızca laboratuvar: kural dışı ileri geçiş (düzeltme)
        atlanir: normalGecis(from, kod) && !geriDongu(from, kod) && atlananlar(from, kod, pmmaUretici).length > 0, pmmaDisi: pmmaYok && ASAMA[kod].pmma }));
  }
  // Doğal sıradaki bir sonraki aşama
  function sonrakiOneri(from, pmmaUretici) {
    if (from === 'pmma_revizyon') return 'pmma_prova';
    if (from === 'ilave') return 'zirkon_prova';
    if (from === 'pmma_prova') return 'zirkon';
    if (from === 'zirkon_prova') return 'teslim';
    const pmmaYok = pmmaUretici === 'yok';
    for (let i = (ASAMA[from] ? ASAMA[from].sira : -1) + 1; i < ASAMALAR.length; i++) {
      const a = ASAMALAR[i];
      if (a.tur === 'revizyon') continue;
      if (pmmaYok && a.pmma) continue;
      return a.kod;
    }
    return null;
  }
  function atlananlar(from, to, pmmaUretici) {
    if (!ASAMA[from] || !ASAMA[to] || ASAMA[to].sira <= ASAMA[from].sira) return [];
    return ASAMALAR.slice(ASAMA[from].sira + 1, ASAMA[to].sira)
      .filter(a => a.tur !== 'revizyon' && !(pmmaUretici === 'yok' && a.pmma)).map(a => a.kod);
  }

  // ── Eski işler için varsayılan (iş akışı kaydı yoksa) ─────────────
  function durumdanAsama(status) {
    return ({ Bekliyor: 'kabul', 'Tasarımda': 'tasarim', 'Üretimde': 'zirkon', Makyajda: 'zirkon', 'Tamamlama Onayı': 'zirkon', 'Tamamlandı': 'teslim' })[status] || 'kabul';
  }
  // job + workflows[id] + seed (hekim gönderiminden gelen tercih) → etkin iş akışı
  function etkin(job, kayit, seed) {
    const k = kayit && typeof kayit === 'object' ? kayit : null;
    let asama = k && ASAMA[k.stage] ? k.stage : durumdanAsama(job && job.status);
    if (job && job.status === 'Tamamlandı') asama = 'teslim';
    const gecmis = k && k.history ? Object.values(k.history).filter(Boolean).sort((a, b) => (a.no || 0) - (b.no || 0)) : [];
    const revizyonlar = k && k.revisions ? Object.values(k.revisions).filter(Boolean).sort((a, b) => (a.no || 0) - (b.no || 0)) : [];
    const pmmaUretici = (k && k.pmmaUretici) || (seed && seed.pmmaUretici) || (job && job.pmmaUretici) || null;
    const randevu = k && k.randevu && k.randevu.tarih ? k.randevu : null;
    return {
      kayitVar: !!k, asama, bilgi: ASAMA[asama], gecmis, revizyonlar, pmmaUretici,
      pmmaRevizyonSayisi: revizyonlar.filter(r => r.tur === 'pmma').length,
      zirkonRevizyonSayisi: revizyonlar.filter(r => r.tur === 'zirkon').length,
      ilaveSayisi: revizyonlar.filter(r => r.tur === 'ilave').length,
      acikRevizyon: revizyonlar.filter(r => !r.bitis).pop() || null,
      randevu, asamaBaslangic: (k && k.stageSince) || null,
      hekimGuncelledi: !!(k && k.labGormedi), provaUygun: !!(k && k.provaUygun),
      hedefTarih: (randevu && randevu.tarih) || (job && job.dateout) || null,
    };
  }

  // ── Son tarihler ─────────────────────────────────────────────────
  const gun = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
  const tarihYaz = g => new Date(g * 864e5).toISOString().slice(0, 10);
  function bugunGun(simdi) { const d = simdi ? new Date(simdi) : new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5; }
  function sureler(ayar) { return Object.assign({}, VARSAYILAN_SURELER, (ayar && ayar.asamaSureleri) || {}); }
  function asamaSuresi(kod, pmmaUretici, ayar) {
    if (kod === 'pmma_uretim' && pmmaUretici === 'hekim') return 0; // hekim basıyor: yalnızca dosya gönderilir
    const v = Number(sureler(ayar)[kod]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }
  // Mevcut aşamanın son tarihi: hedef tarihten (randevu / teslim) geriye doğru,
  // aradaki üretim aşamalarının süreleri düşülerek bulunur.
  function sonTarih(e, ayar) {
    if (!e || e.asama === 'teslim') return null;
    const hedef = gun(e.hedefTarih);
    if (hedef === null) return null;
    if (e.bilgi.tur === 'prova') return tarihYaz(hedef);
    let kalan = 0, a = e.asama;
    for (let i = 0; i < 10; i++) {
      const s = sonrakiOneri(a, e.pmmaUretici);
      if (!s || ASAMA[s].tur !== 'uretim') break; // bir sonraki adım prova ya da teslim: hedefe ulaşıldı
      kalan += asamaSuresi(s, e.pmmaUretici, ayar);
      a = s;
    }
    return tarihYaz(hedef - kalan);
  }
  // 'normal' | 'yakin' (1 gün ya da daha az kaldı) | 'gecikmis'
  function aciliyet(sonTarihStr, simdi) {
    const g = gun(sonTarihStr);
    if (g === null) return 'normal';
    const fark = g - bugunGun(simdi);
    return fark < 0 ? 'gecikmis' : fark <= 1 ? 'yakin' : 'normal';
  }
  // Hekim "laboratuvar önersin" derse önerilen teslim tarihi
  function oneriTarihi(isTuru, ayar, simdi) {
    const tablo = (ayar && ayar.isTipiSureleri) || {};
    const anahtar = Object.keys(tablo).find(k => k.toLocaleLowerCase('tr-TR') === String(isTuru || '').toLocaleLowerCase('tr-TR'));
    const v = Number(anahtar ? tablo[anahtar] : (ayar && ayar.varsayilanIsSuresi));
    let g = bugunGun(simdi) + (Number.isFinite(v) && v > 0 ? v : VARSAYILAN_IS_SURESI);
    // Pazar gününe denk gelirse pazartesiye kaydır
    if (new Date(g * 864e5).getUTCDay() === 0) g += 1;
    return tarihYaz(g);
  }

  return { ASAMALAR, ASAMA, KODLAR, PMMA_URETICI, VARSAYILAN_SURELER, VARSAYILAN_IS_SURESI,
    gecisIzinli, normalGecis, hedefler, sonrakiOneri, atlananlar, durumdanAsama, etkin, sonTarih, aciliyet, oneriTarihi, asamaSuresi, gun, tarihYaz, bugunGun };
});
