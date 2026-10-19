// Robot kol simülasyonu: 3D sahne, ESP32 ile aynı kontrol döngüsü, poz kaydedici ve
// gerçek kola USB ile bağlanınca "dijital ikiz" modu.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { malzemeler, kolOlustur, sahneKur } from './model.js';
import { KolDenetleyici, EKSENLER, cubukNorm, tetikNorm } from './kontrol.js';
import { SeriBaglanti } from './seri.js';

const $ = id => document.getElementById(id);
const RENDER_MODU = location.hash.includes('render');
if (RENDER_MODU) document.body.classList.add('render');

// ---------------------------------------------------------------- sahne
const kap = $('sahne');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: RENDER_MODU });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
kap.appendChild(renderer.domElement);
const etiketRenderer = new CSS2DRenderer();
etiketRenderer.domElement.className = 'etiket-katmani';
kap.appendChild(etiketRenderer.domElement);

const M = malzemeler();
const sahne = sahneKur(M);
const pmrem = new THREE.PMREMGenerator(renderer);
sahne.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
sahne.environmentIntensity = 0.55;

const kol = kolOlustur(M);
sahne.add(kol.kok);

const kamera = new THREE.PerspectiveCamera(35, 1, 5, 6000);
const KAMERALAR = {
  serbest: { poz: [560, 430, 600], hedef: [-10, 140, 70] },
  on: { poz: [0, 230, 980], hedef: [0, 150, 80] },
  yan: { poz: [980, 230, 70], hedef: [0, 150, 70] },
  ust: { poz: [0, 1150, 71], hedef: [0, 0, 70] },
};
kamera.position.set(...KAMERALAR.serbest.poz);
const yorunge = new OrbitControls(kamera, renderer.domElement);
yorunge.target.set(...KAMERALAR.serbest.hedef);
Object.assign(yorunge, { enableDamping: true, maxPolarAngle: Math.PI * 0.495, minDistance: 180, maxDistance: 2200 });

// eksen etiketleri
const etiketler = kol.etiketNoktalari.map((nokta, i) => {
  const d = document.createElement('div');
  d.className = 'eksen-etiketi';
  d.innerHTML = `<b>${i + 1}</b><span>${EKSENLER[i].ad}</span>`;
  const o = new CSS2DObject(d);
  nokta.add(o);
  return o;
});

// uç noktası izi
const IZ_MAX = 6000;
const izGeo = new THREE.BufferGeometry();
izGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(IZ_MAX * 3), 3));
izGeo.setDrawRange(0, 0);
const iz = new THREE.Line(izGeo, new THREE.LineBasicMaterial({ color: 0x2563eb }));
iz.frustumCulled = false;
sahne.add(iz);
let izSayisi = 0;
const sonIz = new THREE.Vector3(Infinity, 0, 0);

function boyutla() {
  const w = kap.clientWidth, h = kap.clientHeight;
  renderer.setSize(w, h);
  etiketRenderer.setSize(w, h);
  kamera.aspect = w / h;
  kamera.updateProjectionMatrix();
}
new ResizeObserver(boyutla).observe(kap);
boyutla();

// ---------------------------------------------------------------- durum
const den = new KolDenetleyici();
let ikiz = false;               // gerçek kola bağlı mı
let espAci = null;              // ESP32'den gelen anlık açılar
let hizSeviye = 1;
const basili = new Set();
const sonDokunma = new Array(6).fill(0);
let oynatiliyor = false;

const TUSLAR = { q: [0, 1], a: [0, -1], w: [1, 1], s: [1, -1], e: [2, 1], d: [2, -1],
                 r: [3, 1], f: [3, -1], t: [4, 1], g: [4, -1], y: [5, 1], h: [5, -1] };

const seri = new SeriBaglanti({
  satir: satirIsle,
  durum: (bagli, mesaj) => {
    ikiz = bagli;
    $('durum').textContent = mesaj;
    $('baglan').textContent = bagli ? 'Bağlantıyı kes' : 'Gerçek kola bağlan (USB)';
    $('mod').textContent = bagli ? 'Dijital ikiz: gerçek kol' : 'Simülasyon';
    $('mod').classList.toggle('ikiz', bagli);
    if (!bagli && espAci) { den.anlik = espAci.slice(); den.hedef = espAci.slice(); }
    if (bagli) { espAci = null; setTimeout(() => seri.gonder('?'), 1500); }
    logla(mesaj);
  },
});

function satirIsle(s) {
  const p = s.split(' ');
  if (p[0] === 'P' && p.length === 7) espAci = p.slice(1).map(Number);
  else if (p[0] === 'S') hizGoster(+p[1]);
  else if (p[0] === 'L' && p.length >= 5) {
    const k = kaydiricilar[+p[1]];
    if (k) { k.min = p[2]; k.max = p[3]; }
  } else {
    logla(s);
    if (s === 'HAZIR') seri.gonder('?');
  }
}

function logla(t) {
  const l = $('log');
  l.textContent = (l.textContent + t + '\n').slice(-4000);
  l.scrollTop = l.scrollHeight;
}

// ---------------------------------------------------------------- arayüz
const kaydiricilar = EKSENLER.map((e, i) => {
  const satir = document.createElement('div');
  satir.className = 'eksen';
  satir.innerHTML = `<label for="k${i}"><b>${i + 1}</b> ${e.ad}</label>
    <input type="range" id="k${i}" min="${e.min}" max="${e.max}" step="1" value="${e.home}">
    <output id="o${i}">${e.home}°</output>`;
  $('eksenler').appendChild(satir);
  const k = satir.querySelector('input');
  let son = 0;
  const gonderAci = () => {
    sonDokunma[i] = performance.now();
    oynatmayiDurdur();
    if (ikiz) seri.gonder(`A ${i} ${k.value}`); else den.ayarla(i, +k.value);
  };
  k.addEventListener('input', () => { if (performance.now() - son > 40) { son = performance.now(); gonderAci(); } });
  k.addEventListener('change', gonderAci);
  return k;
});

function hizGoster(n) {
  hizSeviye = n;
  document.querySelectorAll('#hizlar button').forEach(b => b.classList.toggle('secili', +b.dataset.s === n));
}
function hizAyarla(n) {
  n = Math.max(0, Math.min(2, n));
  if (ikiz) seri.gonder('S ' + n); else den.hiz(n);
  hizGoster(n);
}
function baslangic() { oynatmayiDurdur(); if (ikiz) seri.gonder('H'); else den.baslangic(); }
function durdur() { oynatmayiDurdur(); basili.clear(); if (ikiz) seri.gonder('X'); else den.durdur(); }

document.querySelectorAll('#hizlar button').forEach(b => b.addEventListener('click', () => hizAyarla(+b.dataset.s)));
$('home').addEventListener('click', baslangic);
$('dur').addEventListener('click', durdur);
hizGoster(1);

if (!SeriBaglanti.destekli()) { $('baglan').disabled = true; $('durum').textContent = 'USB için Chrome veya Edge gerekir'; }
$('baglan').addEventListener('click', async () => {
  try { if (seri.bagli) await seri.kes(); else await seri.baglan(); }
  catch (e) { logla('Bağlanılamadı: ' + e.message); }
});

// kamera
let kameraGecis = null;
function kameraSec(ad) {
  const k = KAMERALAR[ad];
  kameraGecis = { t: 0, p0: kamera.position.clone(), h0: yorunge.target.clone(), p1: new THREE.Vector3(...k.poz), h1: new THREE.Vector3(...k.hedef) };
  document.querySelectorAll('#kameralar button').forEach(b => b.classList.toggle('secili', b.dataset.k === ad));
}
document.querySelectorAll('#kameralar button').forEach(b => b.addEventListener('click', () => kameraSec(b.dataset.k)));

$('etiketGoster').addEventListener('change', e => etiketler.forEach(o => (o.visible = e.target.checked)));
$('izGoster').addEventListener('change', e => { iz.visible = e.target.checked; });
$('izTemizle').addEventListener('click', () => { izSayisi = 0; izGeo.setDrawRange(0, 0); });
$('panelAc').addEventListener('click', () => document.body.classList.toggle('panel-kapali'));
$('yardimKapat').addEventListener('click', () => $('yardim').classList.add('gizli'));

// ---------------------------------------------------------------- poz kaydedici
const depo = {
  oku() { try { return JSON.parse(localStorage.getItem('robotkol_pozlar') || '[]'); } catch { return []; } },
  yaz(v) { try { localStorage.setItem('robotkol_pozlar', JSON.stringify(v)); } catch {} },
};
let pozlar = depo.oku();

function pozlariCiz() {
  const ul = $('pozListe');
  ul.innerHTML = '';
  pozlar.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}.</span><code>${p.map(a => Math.round(a)).join(' · ')}</code>
      <button title="Bu poza git" data-git="${i}">▶</button><button title="Sil" data-sil="${i}">✕</button>`;
    ul.appendChild(li);
  });
  $('pozBos').style.display = pozlar.length ? 'none' : 'block';
}
$('pozListe').addEventListener('click', e => {
  const git = e.target.dataset.git, sil = e.target.dataset.sil;
  if (git !== undefined) { oynatmayiDurdur(); pozaGit(pozlar[+git]); }
  if (sil !== undefined) { pozlar.splice(+sil, 1); depo.yaz(pozlar); pozlariCiz(); }
});
$('pozKaydet').addEventListener('click', () => {
  pozlar.push(gosterilenAcilar().map(a => Math.round(a * 10) / 10));
  depo.yaz(pozlar); pozlariCiz();
});
$('pozTemizle').addEventListener('click', () => { oynatmayiDurdur(); pozlar = []; depo.yaz(pozlar); pozlariCiz(); });
$('pozOynat').addEventListener('click', () => (oynatiliyor ? oynatmayiDurdur() : oynat()));
pozlariCiz();

function pozaGit(p) {
  p.forEach((a, i) => { if (ikiz) seri.gonder(`A ${i} ${a}`); else den.ayarla(i, a); });
}
const bekle = ms => new Promise(r => setTimeout(r, ms));
async function oynat() {
  if (!pozlar.length) return;
  oynatiliyor = true;
  $('pozOynat').textContent = '■ Durdur';
  do {
    for (const p of pozlar) {
      if (!oynatiliyor) break;
      pozaGit(p);
      const bas = performance.now();
      while (oynatiliyor && performance.now() - bas < 10000) {
        const a = gosterilenAcilar();
        if (a.every((v, i) => Math.abs(v - p[i]) < (ikiz ? 1.5 : 0.6))) break;
        await bekle(40);
      }
      await bekle(350);
    }
  } while (oynatiliyor && $('pozDongu').checked);
  oynatmayiDurdur();
}
function oynatmayiDurdur() {
  oynatiliyor = false;
  $('pozOynat').textContent = '▶ Oynat';
}

// ---------------------------------------------------------------- klavye ve oyun kolu
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (TUSLAR[k]) { basili.add(k); oynatmayiDurdur(); e.preventDefault(); }
  else if (k === ' ') { durdur(); e.preventDefault(); }
  else if (k === '0') baslangic();
  else if (k >= '1' && k <= '3') hizAyarla(k - 1);
});
addEventListener('keyup', e => basili.delete(e.key.toLowerCase()));
addEventListener('blur', () => basili.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) basili.clear(); });

const gpOnceki = {};
const kenar = (ad, basildi) => { const ilk = basildi && !gpOnceki[ad]; gpOnceki[ad] = basildi; return ilk; };
function oyunKolu() {
  for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected) return g;
  return null;
}

// ESP32'deki ile aynı: çubuk değerleri -128..127, tetikler 0..255 ölçeğine çevrilip aynı eğriden geçer
function girdiHizlari() {
  const v = [0, 0, 0, 0, 0, 0];
  for (const k of basili) { const [i, yon] = TUSLAR[k]; v[i] += yon; }
  const g = oyunKolu();
  $('gp').textContent = g ? 'Oyun kolu: ' + g.id.slice(0, 40) : 'Oyun kolu yok (takıp bir tuşa basın)';
  $('gp').classList.toggle('acik', !!g);
  if (g) {
    const b = i => g.buttons[i] || { pressed: false, value: 0 };
    const ax = i => Math.round((g.axes[i] || 0) * 127);
    v[0] += cubukNorm(ax(0));
    v[1] += cubukNorm(-ax(1));
    v[2] += cubukNorm(-ax(3));
    v[4] += cubukNorm(ax(2));
    if (b(12).pressed) v[3] += 1;
    if (b(13).pressed) v[3] -= 1;
    v[5] += tetikNorm(Math.round(b(7).value * 255)) - tetikNorm(Math.round(b(6).value * 255));
    if (kenar('sol', b(14).pressed)) hizAyarla(hizSeviye - 1);
    if (kenar('sag', b(15).pressed)) hizAyarla(hizSeviye + 1);
    if (kenar('opt', b(9).pressed)) baslangic();
  }
  return v.map(x => Math.max(-1, Math.min(1, x)));
}

function gosterilenAcilar() { return ikiz && espAci ? espAci : den.anlik; }

// ---------------------------------------------------------------- döngü
let birikim = 0, sonZaman = performance.now(), sonGonderim = 0, sonHizBos = true;
const ucDunya = new THREE.Vector3();

function kontrolAdimi() {
  const v = girdiHizlari();
  const bos = v.every(x => x === 0);
  if (!bos) oynatmayiDurdur();
  if (ikiz) {
    const simdi = performance.now();
    if ((!bos || !sonHizBos) && simdi - sonGonderim >= 50) {
      seri.gonder('V ' + v.map(x => x.toFixed(2)).join(' '));
      sonGonderim = simdi;
      sonHizBos = bos;
    }
  } else {
    den.adim(den.dongu, v);
    sonHizBos = bos;
  }
}

function arayuzuGuncelle(a) {
  const simdi = performance.now();
  a.forEach((deg, i) => {
    if (simdi - sonDokunma[i] > 700) kaydiricilar[i].value = Math.round(deg);
    $('o' + i).textContent = Math.round(deg) + '°';
  });
  kol.uc.getWorldPosition(ucDunya);
  $('ucX').textContent = ucDunya.x.toFixed(0);
  $('ucY').textContent = ucDunya.y.toFixed(0);
  $('ucZ').textContent = ucDunya.z.toFixed(0);
  const uyarilar = [];
  if (ucDunya.y < 4) uyarilar.push('Kıskaç masaya değiyor!');
  EKSENLER.forEach((e, i) => { if (a[i] <= e.min + 0.5 || a[i] >= e.max - 0.5) uyarilar.push(`${e.ad} sınırda`); });
  $('uyari').textContent = uyarilar.join(' · ');
  $('uyari').classList.toggle('tehlike', ucDunya.y < 4);
  if (iz.visible && ucDunya.distanceTo(sonIz) > 1.5 && izSayisi < IZ_MAX) {
    izGeo.attributes.position.setXYZ(izSayisi++, ucDunya.x, ucDunya.y, ucDunya.z);
    izGeo.attributes.position.needsUpdate = true;
    izGeo.setDrawRange(0, izSayisi);
    sonIz.copy(ucDunya);
  }
}

function kare(zaman) {
  requestAnimationFrame(kare);
  const dt = Math.min(0.25, (zaman - sonZaman) / 1000);
  sonZaman = zaman;
  if (!RENDER_MODU) {
    birikim += dt;
    while (birikim >= den.dongu) { kontrolAdimi(); birikim -= den.dongu; }
    const a = gosterilenAcilar();
    kol.acilariUygula(a);
    arayuzuGuncelle(a);
  }
  if (kameraGecis) {
    kameraGecis.t = Math.min(1, kameraGecis.t + dt / 0.7);
    const t = 1 - Math.pow(1 - kameraGecis.t, 3);
    kamera.position.lerpVectors(kameraGecis.p0, kameraGecis.p1, t);
    yorunge.target.lerpVectors(kameraGecis.h0, kameraGecis.h1, t);
    if (kameraGecis.t >= 1) kameraGecis = null;
  }
  yorunge.update();
  renderer.render(sahne, kamera);
  etiketRenderer.render(sahne, kamera);
}
kol.acilariUygula(den.anlik);
requestAnimationFrame(kare);

// ---------------------------------------------------------------- kılavuz görselleri için çizim arayüzü
// Örnek: __cizim({ adim: 3, vurgu: 3, acilar: [...], kamera: { poz: [...], hedef: [...] }, etiket: true })
const vurguOnbellek = new Map(), seffafOnbellek = new Map();
function vurguMalzemesi(m) {
  if (!vurguOnbellek.has(m)) {
    const k = m.clone();
    // parçayı maviye boya (dokulu etiketler hariç), hafif ışıma ekle
    if (!k.map) k.color = new THREE.Color(0x1d5ff0);
    k.emissive = new THREE.Color(0x0b2a8a);
    k.emissiveIntensity = 0.3;
    vurguOnbellek.set(m, k);
  }
  return vurguOnbellek.get(m);
}
function seffafMalzeme(m) {
  if (!seffafOnbellek.has(m)) {
    const k = m.clone();
    Object.assign(k, { transparent: true, opacity: 0.22, depthWrite: false });
    seffafOnbellek.set(m, k);
  }
  return seffafOnbellek.get(m);
}
window.__cizim = async (o = {}) => {
  for (const m of kol.parcalar) {
    m.userData.orj ??= m.material;
    m.visible = o.adim == null || m.userData.adim <= o.adim;
    m.material = o.vurgu != null && m.userData.adim === o.vurgu ? vurguMalzemesi(m.userData.orj) : m.userData.orj;
  }
  for (const m of kol.govdeMeshleri) {
    if (o.seffafGovde) m.material = seffafMalzeme(m.userData.orj);
    m.castShadow = !o.seffafGovde;
  }
  etiketler.forEach(e => (e.visible = !!o.etiket));
  iz.visible = false;
  kol.acilariUygula(o.acilar || EKSENLER.map(e => e.home));
  if (o.kamera) {
    kamera.position.set(...o.kamera.poz);
    yorunge.target.set(...o.kamera.hedef);
    if (o.kamera.fov) { kamera.fov = o.kamera.fov; kamera.updateProjectionMatrix(); }
  }
  kameraGecis = null;
  yorunge.update();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
};
window.__hazir = true;
