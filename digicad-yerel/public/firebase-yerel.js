/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — firebase-yerel.js
   Sayfalardaki Firebase (compat) çağrılarının YERİNE geçer. Aynı arayüzü
   (firebase.database().ref(...).on/set/update/remove/push, firebase.storage()
   .ref(...).put/getDownloadURL, firebase.auth()) sunar ama her şeyi bu
   bilgisayardaki yerel sunucuya gönderir. Hiçbir veri Google'a gitmez.

   Sayfa, hangi panel olduğunu window.DL_PANEL ile bildirir:
   'yonetici' | 'hekim' | 'teknisyen'
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var PANEL = window.DL_PANEL || 'yonetici';
  // Bu pencerenin kimliği: sunucu, pencerenin en son gördüğü veriyi bununla izler
  // (eski bir kopyayla başkasının değişikliğinin üzerine yazılmasını önlemek için).
  var ISTEMCI = (function () {
    var h = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '', i, r;
    try { r = new Uint8Array(20); (window.crypto || window.msCrypto).getRandomValues(r); for (i = 0; i < 20; i++) s += h.charAt(r[i] % h.length); }
    catch (e) { for (i = 0; i < 20; i++) s += h.charAt(Math.floor(Math.random() * h.length)); }
    return s;
  })();

  function parcala(yol) { return String(yol == null ? '' : yol).split('/').filter(Boolean); }
  function birlestir(p) { return p.join('/'); }
  function al(v, parcalar) {
    for (var i = 0; i < parcalar.length; i++) {
      if (v === null || typeof v !== 'object') return null;
      v = v[parcalar[i]];
    }
    return v === undefined ? null : v;
  }

  // ── HTTP ─────────────────────────────────────────────────────────
  function istek(yontem, adres, govde) {
    var secenek = { method: yontem, credentials: 'same-origin', headers: { 'X-DL-Panel': PANEL, 'X-DL-Istemci': ISTEMCI } };
    if (govde !== undefined) {
      secenek.headers['Content-Type'] = 'application/json';
      secenek.body = JSON.stringify(govde, function (k, v) { return v === undefined ? null : v; });
    }
    return fetch(adres, secenek).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var h = new Error(j.hata || ('Sunucu hatası (' + r.status + ')'));
          h.code = r.status === 403 ? 'PERMISSION_DENIED' : (r.status === 401 ? 'UNAUTHENTICATED' : 'ERROR');
          h.durum = r.status;
          throw h;
        }
        return j;
      });
    });
  }

  // ── CANLI BAĞLANTI ───────────────────────────────────────────────
  var akis = null, baglantiId = null, bagli = false;
  var oturumAcik = false; // bu sayfada giriş yapıldı mı
  var abonelikler = {};        // id -> { yol, sorgu, cb, hataCb, ref }
  var baglantiDinleyicileri = [];
  var sayac = 0;

  function bagliAyarla(d) {
    if (bagli === d) return;
    bagli = d;
    baglantiDinleyicileri.slice().forEach(function (f) { try { f(d); } catch (e) { console.error(e); } });
  }
  function aboneKaydet(id) {
    var a = abonelikler[id];
    if (!a) return;
    if (yoklamaModu) { yoklaBir(id); return; }
    if (!baglantiId) return;
    istek('POST', '/api/abone', { baglanti: baglantiId, abone: id, yol: a.yol, sorgu: a.sorgu })
      .catch(function (e) { console.warn('[yerel] abonelik hatası', e); });
  }

  // ── CANLI BAĞLANTI SAYISI SINIRI ─────────────────────────────────
  // Tarayıcılar aynı adrese en fazla 6 bağlantı açar. Her pencere bir "canlı
  // bağlantı" tuttuğu için 6 pencere açılınca hiçbir pencere sunucuya ulaşamaz
  // hâle gelirdi. Bu yüzden aynı anda en fazla 4 pencere canlı bağlantı kullanır;
  // sonraki pencereler veriyi birkaç saniyede bir sorarak (yoklama) çalışır.
  var akisIstegi = 0;
  var YUVA_SAYISI = 4, yuvaVar = false, yoklamaModu = false, yoklamaZamanlayici = null, yoklamaTuru = 0;
  var yuvaIstegi = null;
  function yuvaAl() {
    if (yuvaVar || !(navigator.locks && navigator.locks.request)) return Promise.resolve(true);
    if (yuvaIstegi) return yuvaIstegi; // aynı anda iki kez istenirse tek yuva alınsın
    yuvaIstegi = yuvaAra();
    yuvaIstegi.then(function () { yuvaIstegi = null; });
    return yuvaIstegi;
  }
  function yuvaAra() {
    return new Promise(function (coz) {
      var i = 0;
      (function dene() {
        if (i >= YUVA_SAYISI) { coz(false); return; }
        var ad = 'dl-canli-baglanti-' + (i++);
        navigator.locks.request(ad, { ifAvailable: true }, function (kilit) {
          if (!kilit) { dene(); return undefined; }
          yuvaVar = true; coz(true);
          return new Promise(function () {}); // pencere kapanana kadar yuvayı tut
        }).catch(function () { coz(true); });
      })();
    });
  }
  function yoklaBir(id) {
    var a = abonelikler[id];
    if (!a || a.yoklaniyor) return Promise.resolve();
    a.yoklaniyor = true;
    return istek('POST', '/api/oku', { yol: a.yol, sorgu: a.sorgu }).then(function (j) {
      a.yoklaniyor = false;
      bagliAyarla(true);
      if (abonelikler[id] !== a) return;
      var metin = JSON.stringify(j.deger === undefined ? null : j.deger);
      if (metin === a.sonMetin) return;
      a.sonMetin = metin;
      try { a.cb(new AnlikGoruntu(a.ref, j.deger)); } catch (x) { console.error(x); }
    }, function (e) {
      a.yoklaniyor = false;
      if (e && e.durum === 403 && a.hataCb) { try { a.hataCb(e); } catch (x) { console.error(x); } }
      else if (!e || !e.durum) bagliAyarla(false);
    });
  }
  function yoklamaDongusu() {
    if (!yoklamaModu) return;
    yoklamaTuru++;
    // Arada bir canlı bağlantı yuvası boşalmış mı diye bak
    if (yoklamaTuru % 8 === 0) {
      yuvaAl().then(function (oldu) { if (oldu && yoklamaModu) akisBaslat(); });
    }
    var bekleyen = [];
    Object.keys(abonelikler).forEach(function (id) { bekleyen.push(yoklaBir(id)); });
    if (oturumAcik) {
      bekleyen.push(istek('GET', '/api/ben').then(function (r) {
        if (oturumAcik && !(r && r.kullanici)) location.reload(); // oturum bitti → giriş ekranı
      }, function () {}));
    }
    Promise.all(bekleyen).then(function () {
      if (yoklamaModu) yoklamaZamanlayici = setTimeout(yoklamaDongusu, 4000);
    });
  }
  function yoklamaBaslat() {
    if (yoklamaZamanlayici) clearTimeout(yoklamaZamanlayici);
    yoklamaModu = true;
    Object.keys(abonelikler).forEach(function (id) { abonelikler[id].sonMetin = undefined; });
    yoklamaDongusu();
  }

  function akisBaslat() {
    if (akis) { try { akis.close(); } catch (e) {} akis = null; }
    baglantiId = null;
    if (!yuvaVar) {
      var buIstek = ++akisIstegi;
      yuvaAl().then(function (oldu) {
        if (buIstek !== akisIstegi) return; // bu arada yeni bir bağlanma isteği geldi
        if (oldu) { yuvaVar = true; akisBaslat(); } else yoklamaBaslat();
      });
      return;
    }
    yoklamaModu = false;
    if (yoklamaZamanlayici) { clearTimeout(yoklamaZamanlayici); yoklamaZamanlayici = null; }
    akis = new EventSource('/api/akis?panel=' + encodeURIComponent(PANEL) + '&istemci=' + ISTEMCI);
    akis.addEventListener('merhaba', function (e) {
      var m = JSON.parse(e.data);
      // Sayfa giriş yapılmış sanıyor ama sunucuda oturum yok (süresi doldu,
      // şifre değişti vb.) — sayfayı yenile ki giriş ekranı gelsin.
      if (oturumAcik && !m.oturum) { try { akis.close(); } catch (x) {} location.reload(); return; }
      baglantiId = m.baglanti;
      bagliAyarla(true);
      Object.keys(abonelikler).forEach(aboneKaydet);
    });
    akis.addEventListener('veri', function (e) {
      var m = JSON.parse(e.data);
      var a = abonelikler[m.abone];
      if (!a) return;
      if (m.hata && a.hataCb) { try { a.hataCb(new Error(m.hata)); } catch (x) { console.error(x); } }
      try { a.cb(new AnlikGoruntu(a.ref, m.deger)); } catch (x) { console.error(x); }
    });
    akis.addEventListener('oturum-bitti', function () {
      // Oturum süresi doldu ya da şifre değişti — sayfayı yenile, giriş ekranı gelsin
      try { akis.close(); } catch (e) {}
      location.reload();
    });
    akis.onerror = function () { baglantiId = null; bagliAyarla(false); };
  }

  // ── ANLIK GÖRÜNTÜ (DataSnapshot) ─────────────────────────────────
  function AnlikGoruntu(ref, deger) {
    this.ref = ref;
    this.key = ref.key;
    this._d = deger === undefined ? null : deger;
  }
  AnlikGoruntu.prototype.val = function () { return this._d; };
  AnlikGoruntu.prototype.exportVal = function () { return this._d; };
  AnlikGoruntu.prototype.toJSON = function () { return this._d; };
  AnlikGoruntu.prototype.exists = function () { return this._d !== null; };
  AnlikGoruntu.prototype.child = function (p) { return new AnlikGoruntu(this.ref.child(p), al(this._d, parcala(p))); };
  AnlikGoruntu.prototype.hasChild = function (p) { return al(this._d, parcala(p)) !== null; };
  AnlikGoruntu.prototype.hasChildren = function () { return !!this._d && typeof this._d === 'object' && Object.keys(this._d).length > 0; };
  AnlikGoruntu.prototype.numChildren = function () { return this._d && typeof this._d === 'object' ? Object.keys(this._d).length : 0; };
  AnlikGoruntu.prototype.forEach = function (fn) {
    if (!this._d || typeof this._d !== 'object') return false;
    var anahtarlar = Object.keys(this._d);
    for (var i = 0; i < anahtarlar.length; i++) {
      var k = anahtarlar[i];
      if (this._d[k] === null || this._d[k] === undefined) continue;
      if (fn(new AnlikGoruntu(this.ref.child(k), this._d[k])) === true) return true;
    }
    return false;
  };

  // ── PUSH ANAHTARI (Firebase ile aynı mantık: zamana göre sıralanır) ──
  var PUSH_HARFLER = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var sonZaman = 0, sonRastgele = [];
  function pushAnahtari() {
    var simdi = Date.now(), ayni = simdi === sonZaman; sonZaman = simdi;
    var z = new Array(8), i;
    for (i = 7; i >= 0; i--) { z[i] = PUSH_HARFLER.charAt(simdi % 64); simdi = Math.floor(simdi / 64); }
    var id = z.join('');
    if (!ayni) { for (i = 0; i < 12; i++) sonRastgele[i] = Math.floor(Math.random() * 64); }
    else { for (i = 11; i >= 0 && sonRastgele[i] === 63; i--) sonRastgele[i] = 0; sonRastgele[i]++; }
    for (i = 0; i < 12; i++) id += PUSH_HARFLER.charAt(sonRastgele[i]);
    return id;
  }

  function tamamlaninca(p, onComplete) {
    if (typeof onComplete === 'function') p.then(function () { onComplete(null); }, function (e) { onComplete(e); });
    return p;
  }

  // ── REFERANS (Reference / Query) ─────────────────────────────────
  function Referans(parcalar, sorgu) {
    this._p = parcalar;
    this._sorgu = sorgu || null;
    this.key = parcalar.length ? parcalar[parcalar.length - 1] : null;
    this.path = { toString: function () { return '/' + birlestir(parcalar); } };
  }
  Object.defineProperty(Referans.prototype, 'parent', { get: function () { return this._p.length ? new Referans(this._p.slice(0, -1)) : null; } });
  Object.defineProperty(Referans.prototype, 'root', { get: function () { return new Referans([]); } });
  Object.defineProperty(Referans.prototype, 'ref', { get: function () { return new Referans(this._p); } });
  Referans.prototype.toString = function () { return location.origin + '/' + birlestir(this._p); };
  Referans.prototype.child = function (p) { return new Referans(this._p.concat(parcala(p))); };
  Referans.prototype._s = function (ek) {
    var s = {}, k; for (k in this._sorgu) s[k] = this._sorgu[k]; for (k in ek) s[k] = ek[k];
    return new Referans(this._p, s);
  };
  Referans.prototype.orderByChild = function (c) { return this._s({ orderByChild: c }); };
  Referans.prototype.orderByKey = function () { return this._s({ orderByKey: true }); };
  Referans.prototype.orderByValue = function () { return this._s({ orderByValue: true }); };
  Referans.prototype.equalTo = function (v) { return this._s({ equalTo: v }); };
  Referans.prototype.limitToFirst = function (n) { return this._s({ limitToFirst: n }); };
  Referans.prototype.limitToLast = function (n) { return this._s({ limitToLast: n }); };
  Referans.prototype.startAt = function () { console.warn('[yerel] startAt desteklenmiyor'); return this; };
  Referans.prototype.endAt = function () { console.warn('[yerel] endAt desteklenmiyor'); return this; };
  Referans.prototype.isEqual = function (o) { return o && birlestir(o._p) === birlestir(this._p); };

  Referans.prototype.on = function (olay, cb, hataCb) {
    if (typeof hataCb !== 'function') hataCb = null;
    if (olay !== 'value') { console.warn('[yerel] Sadece "value" olayı destekleniyor:', olay); return cb; }
    var yol = birlestir(this._p);
    if (yol === '.info/connected') {
      var ref = this;
      var f = function (d) { cb(new AnlikGoruntu(ref, d)); };
      f._asil = cb;
      baglantiDinleyicileri.push(f);
      setTimeout(function () { f(bagli); }, 0);
      return cb;
    }
    var id = 'a' + (++sayac);
    abonelikler[id] = { yol: yol, sorgu: this._sorgu, cb: cb, hataCb: hataCb, ref: this };
    aboneKaydet(id);
    return cb;
  };
  Referans.prototype.off = function (olay, cb) {
    var yol = birlestir(this._p), sorgu = JSON.stringify(this._sorgu);
    if (yol === '.info/connected') {
      baglantiDinleyicileri = baglantiDinleyicileri.filter(function (f) { return cb && f._asil !== cb; });
      return;
    }
    Object.keys(abonelikler).forEach(function (id) {
      var a = abonelikler[id];
      if (a.yol !== yol || JSON.stringify(a.sorgu) !== sorgu) return;
      if (cb && a.cb !== cb) return;
      delete abonelikler[id];
      if (baglantiId) istek('POST', '/api/abonelik-iptal', { baglanti: baglantiId, abone: id }).catch(function () {});
    });
  };
  Referans.prototype.once = function (olay, cb, hataCb) {
    var ref = this;
    if (birlestir(this._p) === '.info/connected') {
      var s = new AnlikGoruntu(ref, bagli); if (typeof cb === 'function') cb(s); return Promise.resolve(s);
    }
    var p = istek('POST', '/api/oku', { yol: birlestir(this._p), sorgu: this._sorgu })
      .then(function (j) { return new AnlikGoruntu(ref, j.deger); });
    if (typeof cb === 'function') p.then(cb, typeof hataCb === 'function' ? hataCb : function (e) { console.error(e); });
    return p;
  };
  Referans.prototype.get = function () { return this.once('value'); };
  Referans.prototype.set = function (deger, onComplete) {
    return tamamlaninca(istek('POST', '/api/yaz', { islem: 'set', yol: birlestir(this._p), deger: deger === undefined ? null : deger }), onComplete);
  };
  Referans.prototype.update = function (deger, onComplete) {
    return tamamlaninca(istek('POST', '/api/yaz', { islem: 'update', yol: birlestir(this._p), deger: deger }), onComplete);
  };
  Referans.prototype.remove = function (onComplete) {
    return tamamlaninca(istek('POST', '/api/yaz', { islem: 'remove', yol: birlestir(this._p) }), onComplete);
  };
  Referans.prototype.push = function (deger, onComplete) {
    var r = this.child(pushAnahtari());
    var p = deger === undefined ? Promise.resolve() : r.set(deger, onComplete);
    r.then = function (a, b) { return p.then(function () { return r; }).then(a, b); };
    r.catch = function (b) { return p.catch(b); };
    return r;
  };
  Referans.prototype.transaction = function (fn, onComplete) {
    var ref = this;
    var p = this.once('value').then(function (s) {
      var yeni = fn(s.val());
      if (yeni === undefined) return { committed: false, snapshot: s };
      return ref.set(yeni).then(function () { return { committed: true, snapshot: new AnlikGoruntu(ref, yeni) }; });
    });
    if (typeof onComplete === 'function') p.then(function (r) { onComplete(null, r.committed, r.snapshot); }, function (e) { onComplete(e, false, null); });
    return p;
  };
  Referans.prototype.onDisconnect = function () {
    var bos = function () { return Promise.resolve(); };
    return { set: bos, update: bos, remove: bos, cancel: bos, setWithPriority: bos };
  };

  // ── DOSYA DEPOLAMA (Storage) ─────────────────────────────────────
  function DepoReferans(yol) {
    this.fullPath = birlestir(parcala(yol));
    this.name = parcala(yol).pop() || '';
    this._url = null;
  }
  DepoReferans.prototype.child = function (p) { return new DepoReferans(this.fullPath + '/' + p); };
  DepoReferans.prototype.toString = function () { return this.fullPath; };
  DepoReferans.prototype.put = function (dosya) { return new YuklemeGorevi(this, dosya); };
  DepoReferans.prototype.putString = function (metin) { return new YuklemeGorevi(this, new Blob([metin])); };
  DepoReferans.prototype.getDownloadURL = function () {
    if (this._url) return Promise.resolve(this._url);
    var ref = this;
    return istek('GET', '/api/dosya-adresi?yol=' + encodeURIComponent(this.fullPath))
      .then(function (j) { ref._url = j.url; return ref._url; });
  };
  DepoReferans.prototype.delete = function () { return Promise.resolve(); };

  function YuklemeGorevi(ref, dosya) {
    var gorev = this;
    this._gozlemciler = [];
    this.snapshot = { ref: ref, bytesTransferred: 0, totalBytes: dosya.size || 0, state: 'running', task: this };
    this._p = new Promise(function (coz, reddet) {
      var x = new XMLHttpRequest();
      gorev._xhr = x;
      x.open('POST', '/api/yukle?yol=' + encodeURIComponent(ref.fullPath) + '&ad=' + encodeURIComponent(dosya.name || ref.name));
      x.setRequestHeader('X-DL-Panel', PANEL);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = function (e) {
        gorev.snapshot.bytesTransferred = e.loaded;
        if (e.lengthComputable) gorev.snapshot.totalBytes = e.total;
        gorev._bildir('next', gorev.snapshot);
      };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) {
          ref._url = j.url;
          gorev.snapshot.bytesTransferred = gorev.snapshot.totalBytes;
          gorev.snapshot.state = 'success';
          gorev._bildir('next', gorev.snapshot);
          gorev._bildir('complete');
          coz(gorev.snapshot);
        } else {
          var h = new Error(j.hata || ('Yükleme hatası (' + x.status + ')'));
          h.code = x.status === 401 ? 'storage/unauthenticated' : (x.status === 413 ? 'storage/quota-exceeded' : 'storage/unknown');
          gorev.snapshot.state = 'error';
          gorev._bildir('error', h);
          reddet(h);
        }
      };
      x.onerror = function () {
        var h = new Error('Bağlantı hatası — dosya yüklenemedi'); h.code = 'storage/retry-limit-exceeded';
        gorev.snapshot.state = 'error'; gorev._bildir('error', h); reddet(h);
      };
      x.onabort = function () {
        var h = new Error('Yükleme iptal edildi'); h.code = 'storage/canceled';
        gorev.snapshot.state = 'canceled'; gorev._bildir('error', h); reddet(h);
      };
      x.send(dosya);
    });
    this._p.catch(function () {}); // yakalanmamış hata uyarısını önle
  }
  YuklemeGorevi.prototype._bildir = function (tur, arg) {
    this._gozlemciler.forEach(function (g) { if (typeof g[tur] === 'function') { try { g[tur](arg); } catch (e) { console.error(e); } } });
  };
  YuklemeGorevi.prototype.on = function (olay, next, error, complete) {
    var g = (next && typeof next === 'object') ? next : { next: next, error: error, complete: complete };
    this._gozlemciler.push(g);
    var liste = this._gozlemciler;
    return function () { var i = liste.indexOf(g); if (i >= 0) liste.splice(i, 1); };
  };
  YuklemeGorevi.prototype.then = function (a, b) { return this._p.then(a, b); };
  YuklemeGorevi.prototype.catch = function (b) { return this._p.catch(b); };
  YuklemeGorevi.prototype.cancel = function () { if (this._xhr) this._xhr.abort(); return true; };
  YuklemeGorevi.prototype.pause = function () { return false; };
  YuklemeGorevi.prototype.resume = function () { return false; };

  // ── FIREBASE ARAYÜZÜ ─────────────────────────────────────────────
  var veritabani = { ref: function (y) { return new Referans(parcala(y)); }, goOnline: function () {}, goOffline: function () {} };
  veritabani.refFromURL = function (u) { return new Referans(parcala(new URL(u, location.origin).pathname)); };
  var depolama = { ref: function (y) { return new DepoReferans(y || ''); } };
  var kullanici = { uid: 'yerel-' + PANEL, isAnonymous: true };
  var kimlik = {
    currentUser: kullanici,
    signInAnonymously: function () { return Promise.resolve({ user: kullanici }); },
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(kullanici); }, 0); return function () {}; },
    signOut: function () { return Promise.resolve(); },
  };
  function database() { return veritabani; }
  database.ServerValue = {};
  Object.defineProperty(database.ServerValue, 'TIMESTAMP', { enumerable: true, get: function () { return Date.now(); } });
  window.firebase = {
    apps: [],
    initializeApp: function () { if (!this.apps.length) this.apps.push({}); return this.apps[0]; },
    database: database,
    storage: function () { return depolama; },
    auth: function () { return kimlik; },
  };

  // ── GİRİŞ / OTURUM YARDIMCILARI (sayfalar kullanır) ──────────────
  window.DL = {
    panel: PANEL,
    giris: function (bilgi) { return istek('POST', '/api/giris', bilgi).then(function (r) { oturumAcik = true; return r; }); },
    cikis: function () { oturumAcik = false; return istek('POST', '/api/cikis', {}); },
    ben: function () { return istek('GET', '/api/ben').then(function (r) { oturumAcik = !!(r && r.kullanici); return r; }); },
    pinDegistir: function (eski, yeni) { return istek('POST', '/api/pin-degistir', { eski: eski, yeni: yeni }); },
    // Giriş/çıkıştan sonra canlı bağlantıyı yeni oturumla yeniden kurar
    yenidenBaglan: function () { akisBaslat(); },
  };

  akisBaslat();
})();
