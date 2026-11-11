'use strict';
// ═══════════════════════════════════════════════════════════════════
//  İŞ AKIŞI (AŞAMALAR, PROVA DÖNGÜLERİ, RANDEVU) — sunucu tarafı
//
//  Kayıtlar db/digicad/workflows/{işNo} altında durur ve YALNIZCA bu
//  dosyadaki işlemlerle değişir (paneller doğrudan yazamaz). İşin kendi
//  kaydına (fiyat, durum vb.) dokunulmaz; tek istisna "Teslim edildi"
//  aşamasının işi "Tamamlandı" yapmasıdır.
//  Kurallar (aşamalar, izinli geçişler, son tarih) public/is-akisi-kural.js
//  dosyasında; paneller de aynı dosyayı kullanır.
// ═══════════════════════════════════════════════════════════════════
const agac = require('./agac');
const tasarim = require('./tasarim');
const K = require('../public/is-akisi-kural');

const ALAN = 'digicad';
const ayni = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const hata = (durum, mesaj) => Object.assign(new Error(mesaj), { durum });
const simdi = () => new Date().toISOString();
const not = v => String(v == null ? '' : v).trim().slice(0, 2000);
const tarihGecerli = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

function ayarAl(kok) { return agac.al(kok, ['db', ALAN, 'workflowSettings']) || {}; }
function seedAl(kok, is) {
  if (!is || is.sourceDoctorSubmissionId == null) return null;
  return agac.al(kok, ['db', ALAN, 'workflowSeeds', String(is.sourceDoctorSubmissionId)]);
}
function kayitAl(kok, isId) { return agac.al(kok, ['db', ALAN, 'workflows', String(isId)]); }
function etkinAl(kok, is, isId) { return K.etkin(is, kayitAl(kok, isId), seedAl(kok, is)); }

function kisiAdi(kok, oturum) {
  if (oturum.rol === 'yonetici') return 'Laboratuvar';
  const kol = oturum.rol === 'hekim' ? 'doctors' : 'technicians';
  const k = Object.values(agac.al(kok, ['db', ALAN, kol]) || {}).find(x => x && ayni(x.id, oturum.id));
  return (k && k.name) || '';
}
function yetkiDenetle(oturum, is, roller) {
  if (!oturum) throw hata(401, 'Giriş yapmanız gerekiyor');
  if (!roller.includes(oturum.rol)) throw hata(403, 'Bu işlem için yetkiniz yok');
  if (oturum.rol === 'hekim' && !ayni(is.drId, oturum.id)) throw hata(403, 'Bu iş size ait değil');
  if (oturum.rol === 'teknisyen' && !ayni(is.techId, oturum.id)) throw hata(403, 'Bu iş size atanmamış');
}

let _sonMesajNo = 0;
function sohbetMesaji(isId, metin) {
  const id = _sonMesajNo = Math.max(Date.now(), _sonMesajNo + 1);
  return { parcalar: ['db', ALAN, 'chats', 'job_' + isId, 'messages', String(id)],
    deger: { id, senderRole: 'admin', senderId: 'sistem', senderName: 'Sistem', text: metin, timestamp: simdi(), system: true } };
}

// Yeni bir hekim gönderimi geldiğinde tercihleri sakla (gönderim, işe aktarılınca silinir)
function seedIslemi(kayit, subId) {
  if (!kayit || typeof kayit !== 'object') return null;
  const pmma = ['lab', 'hekim', 'yok'].includes(kayit.pmmaUretici) ? kayit.pmmaUretici : null;
  return { parcalar: ['db', ALAN, 'workflowSeeds', String(subId)],
    deger: { subId: String(subId), drId: kayit.drId, pmmaUretici: pmma, dateout: kayit.dateout || null, labOnerisi: !!kayit.dateoutLabOnerisi, at: simdi() } };
}

// İşlemler: { islemler, bildirim? } döner; sunucu uygular, bildirimi e-postayla gönderir
function calistir(kok, oturum, islem, g) {
  g = g || {};
  if (islem === 'ayar') return ayarIslemi(oturum, g);
  const b = tasarim.isBul(kok, g.isId);
  if (!b || b.is.deleted) throw hata(404, 'İş bulunamadı');
  const { anahtar, is } = b;
  const isId = is.id !== undefined && is.id !== null ? is.id : anahtar;
  const yol = ['db', ALAN, 'workflows', String(isId)];
  const mevcut = kayitAl(kok, isId) || {};
  const e = etkinAl(kok, is, isId);
  const kim = { rol: oturum ? oturum.rol : '', id: oturum ? oturum.id : null, name: oturum ? kisiAdi(kok, oturum) : '' };
  const islemler = [];
  const yaz = (alt, deger) => islemler.push({ parcalar: [...yol, ...alt], deger });
  const sonGecmisNo = Object.values(mevcut.history || {}).reduce((m, h) => Math.max(m, Number(h && h.no) || 0), 0);
  let gecmisNo = sonGecmisNo;
  const gecmisEkle = h => { gecmisNo++; yaz(['history', 'h' + gecmisNo], { no: gecmisNo, at: simdi(), by: kim, ...h }); };
  // Kayıt ilk kez oluşuyorsa eski işin hesaplanan durumunu sabitle
  if (!e.kayitVar) {
    yaz(['jobId'], isId);
    yaz(['stage'], e.asama);
    yaz(['stageSince'], simdi());
    if (e.pmmaUretici) yaz(['pmmaUretici'], e.pmmaUretici);
  }
  yaz(['updatedAt'], simdi());
  const etiket = `${is.patient || 'Hasta'}${is.type ? ' — ' + is.type : ''}`;
  let bildirim = null;

  // Aşama değişikliğinin ortak kısmı (revizyon kayıtları, teslim, prova e-postası)
  function asamaDegistir(hedef, ek) {
    const from = e.asama;
    yaz(['stage'], hedef);
    yaz(['stageSince'], simdi());
    // Açık revizyon, revizyon aşamasından çıkılınca kapanır
    if (e.acikRevizyon && K.ASAMA[from].tur === 'revizyon' && hedef !== from) {
      const r = e.acikRevizyon;
      yaz(['revisions', 'r' + r.no, 'bitis'], simdi());
      yaz(['revisions', 'r' + r.no, 'bitiren'], kim.name || null);
    }
    // Revizyon aşamasına girildi: numaralı yeni revizyon kaydı
    if (K.ASAMA[hedef].tur === 'revizyon') {
      const no = e.revizyonlar.reduce((m, r) => Math.max(m, Number(r.no) || 0), 0) + 1;
      const tur = hedef === 'pmma_revizyon' ? 'pmma' : (from === 'zirkon_prova' ? 'zirkon' : 'ilave');
      const turNo = e.revizyonlar.filter(r => r.tur === tur).length + 1;
      yaz(['revisions', 'r' + no], {
        no, tur, turNo, talep: (ek && ek.talep) || '', baslangic: simdi(),
        teknisyenId: is.techId != null ? is.techId : null, teknisyenAd: is.techName || null,
        yeniTarih: (ek && ek.randevu) || null,
        pmmaUretici: tur === 'pmma' ? ((ek && ek.pmmaUretici) || e.pmmaUretici || null) : null,
        acan: kim.name || null,
      });
      if (tur === 'pmma' && ek && ek.pmmaUretici) yaz(['pmmaUretici'], ek.pmmaUretici);
    }
    if (K.ASAMA[hedef].tur === 'prova') { yaz(['provaUygun'], null); bildirim = { tur: 'prova', is, asama: hedef }; }
    // Teslim edildi ⇄ işin durumu
    const isYolu = ['db', ALAN, 'jobs', anahtar];
    if (hedef === 'teslim' && is.status !== 'Tamamlandı') {
      islemler.push({ parcalar: [...isYolu, 'status'], deger: 'Tamamlandı' });
      if (!is.completedAt) islemler.push({ parcalar: [...isYolu, 'completedAt'], deger: simdi() });
    }
    if (from === 'teslim' && hedef !== 'teslim' && is.status === 'Tamamlandı') {
      islemler.push({ parcalar: [...isYolu, 'status'], deger: 'Üretimde' });
    }
  }

  if (islem === 'gecis') {
    yetkiDenetle(oturum, is, ['yonetici', 'teknisyen']);
    const hedef = String(g.hedef || '');
    if (!K.ASAMA[hedef]) throw hata(400, 'Geçersiz aşama');
    if (hedef === e.asama) throw hata(409, 'İş zaten bu aşamada');
    if (!K.gecisIzinli(oturum.rol, e.asama, hedef)) {
      throw hata(403, oturum.rol === 'teknisyen'
        ? `“${K.ASAMA[e.asama].ad}” aşamasından “${K.ASAMA[hedef].ad}” aşamasına geçemezsiniz (prova sonucu ve teslim laboratuvar/hekim tarafından girilir)`
        : 'Bu geçiş yapılamaz');
    }
    const aciklama = not(g.not);
    if (K.ASAMA[hedef].tur === 'revizyon' && !aciklama) throw hata(400, 'Revizyon / düzeltme talebini (ne değişecek) yazın');
    const randevu = g.randevu ? String(g.randevu) : null;
    if (randevu && !tarihGecerli(randevu)) throw hata(400, 'Geçersiz tarih');
    const pmma = ['lab', 'hekim', 'yok'].includes(g.pmmaUretici) ? g.pmmaUretici : null;
    asamaDegistir(hedef, { talep: aciklama, randevu, pmmaUretici: pmma });
    if (randevu) yaz(['randevu'], { tarih: randevu, by: kim, at: simdi() });
    const geri = !K.normalGecis(e.asama, hedef);
    gecmisEkle({ tur: geri ? 'duzeltme' : 'gecis', from: e.asama, to: hedef, not: aciklama || null, ic: !!g.ic,
      atlanan: geri ? null : K.atlananlar(e.asama, hedef, e.pmmaUretici) });
    islemler.push(sohbetMesaji(isId, `🧭 Aşama: ${K.ASAMA[e.asama].ad} → ${K.ASAMA[hedef].ad}` + (aciklama && !g.ic ? `\nNot: ${aciklama}` : '')));
    return { islemler, bildirim };
  }

  if (islem === 'prova') {
    yetkiDenetle(oturum, is, ['hekim', 'yonetici']);
    if (K.ASAMA[e.asama].tur !== 'prova') throw hata(409, 'İş şu an prova aşamasında değil');
    if (e.asama === 'zirkon_prova' && e.provaUygun && g.sonuc === 'uygun') throw hata(409, 'Bu prova sonucu zaten bildirildi');
    const sonuc = g.sonuc;
    if (!['uygun', 'revizyon'].includes(sonuc)) throw hata(400, 'Geçersiz prova sonucu');
    const aciklama = not(g.not);
    if (sonuc === 'revizyon' && !aciklama) throw hata(400, 'Neyin düzeltilmesini istediğinizi yazın');
    const randevu = String(g.randevu || '');
    if (!tarihGecerli(randevu)) throw hata(400, sonuc === 'revizyon' ? 'Bir sonraki prova randevu tarihini seçin' : 'Bir sonraki randevu / teslim tarihini seçin');
    if (K.gun(randevu) < K.bugunGun() - 1) throw hata(400, 'Randevu tarihi geçmişte olamaz');
    const pmma = ['lab', 'hekim', 'yok'].includes(g.pmmaUretici) ? g.pmmaUretici : null;
    const adina = oturum.rol === 'yonetici';
    let hedef = null;
    if (e.asama === 'pmma_prova') hedef = sonuc === 'uygun' ? 'zirkon' : 'pmma_revizyon';
    else hedef = sonuc === 'uygun' ? null : 'ilave';
    if (hedef) asamaDegistir(hedef, { talep: aciklama, randevu, pmmaUretici: pmma });
    else yaz(['provaUygun'], true);
    yaz(['randevu'], { tarih: randevu, by: kim, at: simdi() });
    if (!adina) yaz(['labGormedi'], true);
    gecmisEkle({ tur: 'prova-sonucu', sonuc, from: e.asama, to: hedef || e.asama, not: aciklama || null, randevu, adina });
    const provaAdi = e.asama === 'pmma_prova' ? 'PMMA' : 'Zirkonyum';
    const rno = hedef && K.ASAMA[hedef].tur === 'revizyon' ? e.revizyonlar.filter(r => r.tur === (hedef === 'pmma_revizyon' ? 'pmma' : 'zirkon')).length + 1 : 0;
    islemler.push(sohbetMesaji(isId, sonuc === 'uygun'
      ? `✅ ${provaAdi} provası UYGUN${adina ? ' (laboratuvar, hekim adına)' : ''}. ${hedef ? 'İş ' + K.ASAMA[hedef].ad + ' aşamasına geçti.' : 'Teslim için hazırlanabilir.'}\nSonraki randevu / teslim: ${randevu.split('-').reverse().join('.')}${aciklama ? '\nNot: ' + aciklama : ''}`
      : `✏️ ${provaAdi} provası: ${hedef === 'pmma_revizyon' ? 'PMMA Revizyon ' + rno : 'Zirkonyum düzeltme ' + rno} istendi${adina ? ' (laboratuvar, hekim adına)' : ''}:\n${aciklama}\nSonraki prova randevusu: ${randevu.split('-').reverse().join('.')}`));
    return { islemler, bildirim, labBildirim: !adina ? { tur: 'prova-sonucu', is, sonuc } : null };
  }

  if (islem === 'randevu') {
    yetkiDenetle(oturum, is, ['hekim', 'yonetici']);
    if (e.asama === 'teslim') throw hata(409, 'Teslim edilmiş işin randevusu değiştirilemez');
    const tarih = String(g.tarih || '');
    if (!tarihGecerli(tarih)) throw hata(400, 'Geçerli bir tarih seçin');
    if (K.gun(tarih) < K.bugunGun() - 1) throw hata(400, 'Randevu tarihi geçmişte olamaz');
    const aciklama = not(g.not);
    const eski = e.hedefTarih;
    yaz(['randevu'], { tarih, by: kim, at: simdi() });
    if (oturum.rol === 'hekim') yaz(['labGormedi'], true);
    gecmisEkle({ tur: 'randevu', from: e.asama, to: e.asama, eskiTarih: eski || null, randevu: tarih, not: aciklama || null });
    islemler.push(sohbetMesaji(isId, `📅 Randevu / teslim tarihi ${oturum.rol === 'hekim' ? 'hekim tarafından ' : ''}değiştirildi: ${eski ? eski.split('-').reverse().join('.') + ' → ' : ''}${tarih.split('-').reverse().join('.')}${aciklama ? '\nNot: ' + aciklama : ''}`));
    return { islemler, labBildirim: oturum.rol === 'hekim' ? { tur: 'randevu', is } : null };
  }

  if (islem === 'pmma') {
    yetkiDenetle(oturum, is, ['yonetici']);
    if (!['lab', 'hekim', 'yok'].includes(g.uretici)) throw hata(400, 'Geçersiz PMMA tercihi');
    yaz(['pmmaUretici'], g.uretici);
    gecmisEkle({ tur: 'pmma', from: e.asama, to: e.asama, not: 'PMMA üretimi: ' + K.PMMA_URETICI[g.uretici] });
    return { islemler };
  }

  if (islem === 'goruldu') {
    yetkiDenetle(oturum, is, ['yonetici']);
    return { islemler: [{ parcalar: [...yol, 'labGormedi'], deger: null }] };
  }

  throw hata(404, 'Bilinmeyen işlem');
}

function ayarIslemi(oturum, g) {
  if (!oturum || oturum.rol !== 'yonetici') throw hata(403, 'Bu işlem için yetkiniz yok');
  const sayi = v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 120) throw hata(400, 'Süreler 0 ile 120 gün arasında olmalı'); return Math.round(n * 2) / 2; };
  const asamaSureleri = {};
  for (const k of Object.keys(K.VARSAYILAN_SURELER)) if (g.asamaSureleri && g.asamaSureleri[k] !== undefined && g.asamaSureleri[k] !== '') asamaSureleri[k] = sayi(g.asamaSureleri[k]);
  const isTipiSureleri = {};
  for (const [tur, gunSayisi] of Object.entries(g.isTipiSureleri || {}).slice(0, 200)) {
    const ad = String(tur).trim().slice(0, 100);
    if (ad && !/[/.#$[\]]/.test(ad) && gunSayisi !== '' && gunSayisi !== null) isTipiSureleri[ad] = sayi(gunSayisi);
  }
  const deger = { asamaSureleri, isTipiSureleri, varsayilanIsSuresi: g.varsayilanIsSuresi === '' || g.varsayilanIsSuresi == null ? K.VARSAYILAN_IS_SURESI : sayi(g.varsayilanIsSuresi), updatedAt: simdi() };
  return { islemler: [{ parcalar: ['db', ALAN, 'workflowSettings'], deger }] };
}

// Hekime gidecek e-posta (iş prova aşamasına geldiğinde)
function epostaMetni(b, portalAdresi) {
  if (!b || b.tur !== 'prova') return null;
  const is = b.is, hasta = is.patient || 'hastanız';
  const tur = b.asama === 'pmma_prova' ? 'PMMA (geçici)' : 'Zirkonyum';
  return {
    konu: `${tur} prova aşaması — ${hasta}`,
    metin: `Sayın hekimimiz,\n\n${hasta}${is.type ? ' (' + is.type + ')' : ''} için ${tur} prova aşamasına geçildi.\n` +
      'Prova sonrası hekim portalındaki "İş Akışı" bölümünden sonucu (uygun / düzeltme gerekli) ve bir sonraki randevu tarihini bildirin. ' +
      'Randevunuz değişirse aynı yerden güncelleyebilirsiniz.' +
      (portalAdresi ? `\n\nHekim portalı: ${portalAdresi}/HekimPortali.html` : '') + '\n\nDIGICAD Dental Studio',
  };
}

module.exports = { calistir, seedIslemi, epostaMetni, etkinAl, kayitAl, seedAl, ayarAl, ALAN };
