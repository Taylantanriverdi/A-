'use strict';
// ═══════════════════════════════════════════════════════════════════
//  TASARIM ONAYI AKIŞI
//
//  1) Teknisyen tasarımın ÖNİZLEMESİNİ yükler (STL ve/veya resim).
//  2) Hekim portalında önizlemeyi görür: "Onaylıyorum" ya da "Revizyon
//     istiyorum" der (notuyla birlikte). Her karar kim/ne zaman bilgisiyle
//     saklanır.
//  3) Revizyon istenirse teknisyen yeni önizleme (2, 3, …) yükler.
//  4) Hekim onayladıktan SONRA teknisyen nihai STL dosyasını yükler; nihai
//     dosya hem laboratuvara (üretim) hem hekime açılır.
//
//  Kayıtlar db/digicad/designReviews/{işNo} altında durur ve YALNIZCA bu
//  dosyadaki işlemlerle değişir (paneller doğrudan yazamaz); böylece bir
//  panelin eski kopyası onay kayıtlarını bozamaz.
// ═══════════════════════════════════════════════════════════════════
const agac = require('./agac');

const ALAN = 'digicad';
const ayni = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const hata = (durum, mesaj) => Object.assign(new Error(mesaj), { durum });
const DOSYA_ADRESI = /^\/dosya\/[A-Za-z0-9_-]{20,}\/[^/?#]+$/;

function isBul(kok, isId) {
  const isler = agac.al(kok, ['db', ALAN, 'jobs']) || {};
  const dogrudan = agac.al(isler, [String(isId)]);
  if (dogrudan) return { anahtar: String(isId), is: dogrudan };
  for (const [k, j] of Object.entries(isler)) if (j && ayni(j.id, isId)) return { anahtar: k, is: j };
  return null;
}
function kayitAl(kok, isId) { return agac.al(kok, ['db', ALAN, 'designReviews', String(isId)]); }

// Bu iş için hekim onayı şart mı?
//  - Hekim portalından gelmiş ve tasarımı laboratuvar yapacaksa: evet
//  - Teknisyen bir kez önizleme yüklediyse: evet
//  - Laboratuvar "onay gerekmez" dediyse: hayır
function onayGerekli(is, kayit) {
  if (kayit && kayit.muaf) return false;
  if (kayit && kayit.previews && Object.keys(kayit.previews).length) return true;
  return !!(is && is.sourceDoctorSubmissionId && is.designSource !== 'doctor');
}
const onaylandi = kayit => !!(kayit && kayit.state === 'onaylandi');
// Teknisyen nihai dosyayı yükleyebilir / işi tamamlayabilir mi?
function uretimeHazir(is, kayit) { return !onayGerekli(is, kayit) || onaylandi(kayit); }

function dosyalariDenetle(liste) {
  if (!Array.isArray(liste) || !liste.length) throw hata(400, 'En az bir dosya ekleyin');
  if (liste.length > 20) throw hata(400, 'Bir seferde en fazla 20 dosya yüklenebilir');
  return liste.map(f => {
    if (!f || typeof f.url !== 'string' || !DOSYA_ADRESI.test(f.url)) throw hata(400, 'Geçersiz dosya');
    return { name: String(f.name || 'dosya').slice(0, 200), url: f.url, size: Number(f.size) || 0 };
  });
}
const simdi = () => new Date().toISOString();
const not = v => String(v == null ? '' : v).trim().slice(0, 2000);

function kisiAdi(kok, oturum) {
  if (oturum.rol === 'yonetici') return 'Laboratuvar';
  const kol = oturum.rol === 'hekim' ? 'doctors' : 'technicians';
  const k = Object.values(agac.al(kok, ['db', ALAN, kol]) || {}).find(x => x && ayni(x.id, oturum.id));
  return (k && k.name) || '';
}

// İş sohbetine laboratuvar adına bilgi mesajı (hekim ve teknisyen aynı dizide görür)
let _sonMesajNo = 0;
function sohbetMesaji(isId, metin) {
  // Panellerdeki mesajlar gibi zaman damgası kimlik olur; aynı milisaniyede çakışmasın
  const id = _sonMesajNo = Math.max(Date.now(), _sonMesajNo + 1);
  return {
    parcalar: ['db', ALAN, 'chats', 'job_' + isId, 'messages', String(id)],
    deger: { id, senderRole: 'admin', senderId: 'sistem', senderName: 'Sistem', text: metin, timestamp: simdi(), system: true },
  };
}

function yetkiDenetle(oturum, is, roller) {
  if (!oturum) throw hata(401, 'Giriş yapmanız gerekiyor');
  if (!roller.includes(oturum.rol)) throw hata(403, 'Bu işlem için yetkiniz yok');
  if (oturum.rol === 'hekim' && !ayni(is.drId, oturum.id)) throw hata(403, 'Bu iş size ait değil');
  if (oturum.rol === 'teknisyen' && !ayni(is.techId, oturum.id)) throw hata(403, 'Bu iş size atanmamış');
}

// İşlemler: her biri { islemler: [depo işlemleri], bildirim: {tur, is, ...} } döner.
// Sunucu islemleri uygular, bildirimi (e-posta) gönderir.
function calistir(kok, oturum, islem, g) {
  const bulunan = isBul(kok, g && g.isId);
  if (!bulunan || bulunan.is.deleted) throw hata(404, 'İş bulunamadı');
  const { anahtar, is } = bulunan;
  const isId = is.id !== undefined && is.id !== null ? is.id : anahtar;
  const yol = ['db', ALAN, 'designReviews', String(isId)];
  const kayit = kayitAl(kok, isId) || {};
  const onizlemeler = kayit.previews || {};
  const sonNo = Object.values(onizlemeler).reduce((m, p) => Math.max(m, Number(p && p.no) || 0), 0);
  const etiket = `${is.patient || 'Hasta'}${is.type ? ' — ' + is.type : ''}`;

  if (islem === 'onizleme') {
    yetkiDenetle(oturum, is, ['teknisyen', 'yonetici']);
    if (is.status === 'Tamamlandı') throw hata(409, 'Tamamlanmış işe önizleme yüklenemez');
    const dosyalar = dosyalariDenetle(g.dosyalar);
    const no = sonNo + 1, id = 'p' + no;
    const onizleme = { id, no, files: dosyalar, note: not(g.not), createdAt: simdi(), by: { rol: oturum.rol, id: oturum.id, name: kisiAdi(kok, oturum) } };
    return {
      islemler: [
        { parcalar: [...yol, 'previews', id], deger: onizleme },
        { parcalar: [...yol, 'jobId'], deger: isId },
        { parcalar: [...yol, 'state'], deger: 'hekim-onayi-bekliyor' },
        { parcalar: [...yol, 'muaf'], deger: null },
        { parcalar: [...yol, 'updatedAt'], deger: simdi() },
        sohbetMesaji(isId, `🦷 Önizleme ${no} yüklendi — hekim onayı bekleniyor.${onizleme.note ? '\nTeknisyen notu: ' + onizleme.note : ''}`),
      ],
      bildirim: { tur: 'onizleme', is, no, not: onizleme.note },
    };
  }

  if (islem === 'onizleme-sil') {
    yetkiDenetle(oturum, is, ['teknisyen', 'yonetici']);
    const p = onizlemeler[String(g.onizlemeId)];
    if (!p) throw hata(404, 'Önizleme bulunamadı');
    if (p.karar) throw hata(409, 'Hekimin karar verdiği önizleme silinemez');
    if (p.no !== sonNo) throw hata(409, 'Yalnızca son önizleme silinebilir');
    const kalan = Object.values(onizlemeler).filter(x => x && x.id !== p.id);
    const onceki = kalan.sort((a, b) => b.no - a.no)[0];
    const durum = !onceki ? null : onceki.karar === 'onay' ? 'onaylandi' : onceki.karar === 'revizyon' ? 'revizyon-istendi' : 'hekim-onayi-bekliyor';
    return {
      islemler: [
        { parcalar: [...yol, 'previews', p.id], deger: null },
        { parcalar: [...yol, 'state'], deger: durum },
        { parcalar: [...yol, 'updatedAt'], deger: simdi() },
        sohbetMesaji(isId, `🗑️ Önizleme ${p.no} teknisyen tarafından geri çekildi.`),
      ],
    };
  }

  if (islem === 'karar') {
    yetkiDenetle(oturum, is, ['hekim', 'yonetici']);
    const p = onizlemeler[String(g.onizlemeId)];
    if (!p) throw hata(404, 'Önizleme bulunamadı');
    if (p.no !== sonNo) throw hata(409, 'Yalnızca en son önizleme için karar verilebilir. Sayfayı yenileyin.');
    if (p.karar) throw hata(409, 'Bu önizleme için karar zaten verilmiş');
    if (!['onay', 'revizyon'].includes(g.karar)) throw hata(400, 'Geçersiz karar');
    const aciklama = not(g.not);
    if (g.karar === 'revizyon' && !aciklama) throw hata(400, 'Revizyon için ne istediğinizi yazın');
    const veren = oturum.rol === 'hekim' ? 'hekim' : 'laboratuvar';
    if (veren === 'laboratuvar' && !aciklama) throw hata(400, 'Hekim adına karar verirken açıklama yazın (ör. "telefonla onay alındı")');
    const onay = g.karar === 'onay';
    return {
      islemler: [
        { parcalar: [...yol, 'previews', p.id, 'karar'], deger: g.karar },
        { parcalar: [...yol, 'previews', p.id, 'kararNotu'], deger: aciklama || null },
        { parcalar: [...yol, 'previews', p.id, 'kararZamani'], deger: simdi() },
        { parcalar: [...yol, 'previews', p.id, 'kararVeren'], deger: veren },
        { parcalar: [...yol, 'previews', p.id, 'kararVerenAd'], deger: kisiAdi(kok, oturum) },
        { parcalar: [...yol, 'state'], deger: onay ? 'onaylandi' : 'revizyon-istendi' },
        { parcalar: [...yol, 'updatedAt'], deger: simdi() },
        sohbetMesaji(isId, onay
          ? `✅ Önizleme ${p.no} ${veren === 'hekim' ? 'hekim tarafından' : 'laboratuvar tarafından hekim adına'} ONAYLANDI. Nihai dosya hazırlanabilir.${aciklama ? '\nNot: ' + aciklama : ''}`
          : `✏️ Önizleme ${p.no} için REVİZYON istendi${veren === 'hekim' ? '' : ' (laboratuvar, hekim adına)'}:\n${aciklama}`),
      ],
      bildirim: { tur: 'karar', is, no: p.no, karar: g.karar },
    };
  }

  if (islem === 'muaf') {
    yetkiDenetle(oturum, is, ['yonetici']);
    const muaf = !!g.muaf;
    return {
      islemler: [
        { parcalar: [...yol, 'jobId'], deger: isId },
        { parcalar: [...yol, 'muaf'], deger: muaf ? true : null },
        { parcalar: [...yol, 'updatedAt'], deger: simdi() },
        sohbetMesaji(isId, muaf ? 'ℹ️ Laboratuvar bu iş için hekim onayı aranmayacağını belirtti.' : 'ℹ️ Bu iş için yeniden hekim onayı aranacak.'),
      ],
    };
  }

  if (islem === 'nihai') {
    yetkiDenetle(oturum, is, ['teknisyen', 'yonetici']);
    if (!uretimeHazir(is, kayit) && oturum.rol !== 'yonetici') {
      throw hata(409, 'Nihai dosya yüklenmeden önce hekimin önizlemeyi onaylaması gerekiyor');
    }
    const yeni = dosyalariDenetle(g.dosyalar).map(f => ({ ...f, uploadedBy: kisiAdi(kok, oturum), uploadedAt: simdi(), final: true }));
    const mevcut = Array.isArray(is.designFiles) ? is.designFiles.filter(Boolean) : [];
    const isYolu = ['db', ALAN, 'jobs', anahtar];
    const islemler = [
      { parcalar: [...isYolu, 'designFiles'], deger: mevcut.concat(yeni) },
      { parcalar: [...isYolu, 'designFilesUpdatedAt'], deger: simdi() },
      sohbetMesaji(isId, `📦 Nihai tasarım dosyası yüklendi (${yeni.length} dosya). Üretime hazır.`),
    ];
    if (is.status === 'Bekliyor' || is.status === 'Tasarımda') islemler.push({ parcalar: [...isYolu, 'status'], deger: 'Üretimde' });
    return { islemler, bildirim: { tur: 'nihai', is, adet: yeni.length } };
  }

  throw hata(404, 'Bilinmeyen işlem');
}

// Hekime gidecek e-postanın konusu ve metni
function epostaMetni(bildirim, portalAdresi) {
  const is = bildirim.is;
  const hasta = is.patient || 'hastanız';
  const baglanti = portalAdresi ? `\n\nHekim portalı: ${portalAdresi}/HekimPortali.html` : '';
  if (bildirim.tur === 'onizleme') {
    return {
      konu: `Tasarım önizlemesi hazır — ${hasta}`,
      metin: `Sayın hekimimiz,\n\n${hasta}${is.type ? ' (' + is.type + ')' : ''} için tasarım önizlemesi ${bildirim.no} hazır.\n` +
        'Hekim portalında "Tasarım Onayı" bölümünden 3 boyutlu inceleyip onaylayabilir ya da revizyon isteyebilirsiniz.' +
        (bildirim.not ? `\n\nTeknisyen notu: ${bildirim.not}` : '') + baglanti + '\n\nDIGICAD Dental Studio',
    };
  }
  if (bildirim.tur === 'nihai') {
    return {
      konu: `Nihai tasarım dosyası hazır — ${hasta}`,
      metin: `Sayın hekimimiz,\n\n${hasta}${is.type ? ' (' + is.type + ')' : ''} için onayladığınız tasarımın nihai dosyası hazırlandı ve üretime alındı.\n` +
        'Dosyayı hekim portalında "Tasarım Onayı" bölümünden indirebilirsiniz.' + baglanti + '\n\nDIGICAD Dental Studio',
    };
  }
  return null;
}

module.exports = { calistir, onayGerekli, onaylandi, uretimeHazir, isBul, kayitAl, epostaMetni, ALAN };
