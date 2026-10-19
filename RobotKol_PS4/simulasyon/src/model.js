// Robot kolun gerçekçi 3D modeli (ölçüler mm). Y yukarı, Z ileri (kolun baktığı yön).
// Eklem hiyerarşisi: kok -> eksen1 (taban, Y) -> eksen2 (omuz, X) -> eksen3 (dirsek, X)
//                    -> eksen4 (bilek eğim, X) -> eksen5 (bilek dönüş, Z) -> parmaklar
// Her parçanın userData.adim değeri, kılavuzdaki montaj adımıdır (1..7, 8 = elektronik/kablo).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- dokular
function tuval(w, h, ciz) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  ciz(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function servoEtiketi(model, alt) {
  return tuval(512, 300, (g, w, h) => {
    g.fillStyle = '#0d0e10'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f2f2';
    g.font = 'bold 120px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText(model, w / 2, 150);
    g.font = '42px Arial, sans-serif'; g.fillStyle = '#c7c9cc';
    g.fillText(alt, w / 2, 220);
    g.strokeStyle = '#3a3d42'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
  });
}

function ahsapDokusu() {
  return tuval(1024, 1024, (g, w, h) => {
    g.fillStyle = '#b98a5a'; g.fillRect(0, 0, w, h);
    let tohum = 7;
    const rnd = () => (tohum = (tohum * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 220; i++) {
      const y = rnd() * h, a = 4 + rnd() * 14, k = 0.004 + rnd() * 0.01;
      g.strokeStyle = `rgba(${90 + rnd() * 40},${55 + rnd() * 25},${25 + rnd() * 15},${0.12 + rnd() * 0.22})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * k + i) * a);
      g.stroke();
    }
  });
}

function masaDokusu() {
  return tuval(512, 512, (g, w, h) => {
    g.fillStyle = '#d7d9dc'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    let tohum = 3;
    for (let i = 0; i < img.data.length; i += 4) {
      tohum = (tohum * 16807) % 2147483647;
      const n = (tohum / 2147483647 - 0.5) * 10;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

function spiralDokusu() {
  return tuval(64, 64, (g, w, h) => {
    g.fillStyle = '#1b1d21'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3b3f46'; g.lineWidth = 10;
    g.beginPath(); g.moveTo(-10, h + 10); g.lineTo(w + 10, -10); g.stroke();
  });
}

function pcaDokusu() {
  return tuval(1024, 420, (g, w, h) => {
    g.fillStyle = '#1f3f9a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9b44a';
    for (let k = 0; k < 16; k++) for (let r = 0; r < 3; r++) {
      g.beginPath(); g.arc(220 + k * 46, 70 + r * 46, 13, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#111'; g.fillRect(420, 230, 140, 110);
    g.fillStyle = '#ddd'; g.font = 'bold 34px Arial'; g.fillText('PCA9685', 600, 300);
    g.font = '24px Arial'; g.fillText('16-CH 12-BIT PWM', 600, 340);
    g.fillStyle = '#d9b44a';
    for (let k = 0; k < 6; k++) { g.fillRect(30, 60 + k * 50, 50, 30); g.fillRect(w - 80, 60 + k * 50, 50, 30); }
  });
}

function espDokusu() {
  return tuval(1024, 560, (g, w, h) => {
    g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9a54a';
    for (let k = 0; k < 15; k++) { g.beginPath(); g.arc(70 + k * 60, 30, 12, 0, 7); g.fill(); g.beginPath(); g.arc(70 + k * 60, h - 30, 12, 0, 7); g.fill(); }
    g.fillStyle = '#e8e8e8'; g.font = 'bold 30px Arial'; g.fillText('ESP32 DEVKIT V1', 300, 300);
    g.fillStyle = '#2c2c2c'; g.fillRect(620, 220, 90, 90);
  });
}

// ---------------------------------------------------------------- malzemeler
export function malzemeler() {
  const m = {
    turuncu: new THREE.MeshPhysicalMaterial({ color: 0xf06a1d, roughness: 0.55, clearcoat: 0.12, clearcoatRoughness: 0.6 }),
    koyu: new THREE.MeshPhysicalMaterial({ color: 0x2c3036, roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
    beyazPlastik: new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.5 }),
    servo: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 }),
    servoMavi: new THREE.MeshPhysicalMaterial({ color: 0x1f2125, roughness: 0.35, clearcoat: 0.3 }),
    aluminyum: new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 1, roughness: 0.32 }),
    pirinc: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.35 }),
    celik: new THREE.MeshStandardMaterial({ color: 0x8e949b, metalness: 1, roughness: 0.3 }),
    lastik: new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.95 }),
    ahsap: new THREE.MeshStandardMaterial({ map: ahsapDokusu(), roughness: 0.75 }),
    masa: new THREE.MeshStandardMaterial({ map: masaDokusu(), roughness: 0.92 }),
    spiral: new THREE.MeshStandardMaterial({ map: spiralDokusu(), roughness: 0.6 }),
    pca: new THREE.MeshStandardMaterial({ map: pcaDokusu(), roughness: 0.5 }),
    esp: new THREE.MeshStandardMaterial({ map: espDokusu(), roughness: 0.45 }),
    pcbKenar: new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: 0.6 }),
    kalkan: new THREE.MeshStandardMaterial({ color: 0xd0d3d8, metalness: 1, roughness: 0.25 }),
    kablo: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 }),
    pin: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
  };
  m.spiral.map.wrapS = m.spiral.map.wrapT = THREE.RepeatWrapping;
  m.masa.map.wrapS = m.masa.map.wrapT = THREE.RepeatWrapping;
  m.masa.map.repeat.set(8, 8);
  return m;
}

// ---------------------------------------------------------------- geometri yardımcıları
function yonlendir(geo, xEks, yEks) {         // geo yerel X->xEks, Y->yEks (sağ el kuralı korunur)
  const z = new THREE.Vector3().crossVectors(xEks, yEks);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(xEks, yEks, z));
  return geo;
}

function stadyumSekli(uz, gen, delikler = [], yuvalar = []) {   // 0..uz boyunca, genişlik gen
  const r = gen / 2, s = new THREE.Shape();
  s.moveTo(0, -r); s.lineTo(uz, -r);
  s.absarc(uz, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(0, r);
  s.absarc(0, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  for (const [x, y, rr] of delikler) { const h = new THREE.Path(); h.absarc(x, y, rr, 0, Math.PI * 2, true); s.holes.push(h); }
  for (const [x1, x2, rr] of yuvalar) {
    const h = new THREE.Path();
    h.moveTo(x1, -rr); h.lineTo(x2, -rr); h.absarc(x2, 0, rr, -Math.PI / 2, Math.PI / 2, false);
    h.lineTo(x1, rr); h.absarc(x1, 0, rr, Math.PI / 2, Math.PI * 1.5, false);
    s.holes.push(h);
  }
  return s;
}

function cikar(sekil, kalinlik, pah = 0.8) {
  const g = new THREE.ExtrudeGeometry(sekil, {
    depth: kalinlik - 2 * pah, bevelEnabled: true, bevelThickness: pah, bevelSize: pah, bevelSegments: 2, curveSegments: 32,
  });
  g.translate(0, 0, -(kalinlik - 2 * pah) / 2);
  return g;
}

function disliSekli(r, dis, merkez = 2.2) {
  const s = new THREE.Shape(), n = dis * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, f = i % 4;
    const rr = f === 0 || f === 1 ? r : r - 1.6;
    if (i === 0) s.moveTo(rr * Math.cos(a), rr * Math.sin(a)); else s.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  }
  const h = new THREE.Path(); h.absarc(0, 0, merkez, 0, Math.PI * 2, true); s.holes.push(h);
  return s;
}

const kutuGeo = (w, h, d, r = 1.2) => new RoundedBoxGeometry(w, h, d, 3, r);

function silindir(r, uz, eksen = 'y', seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, uz, seg);
  if (eksen === 'x') g.rotateZ(-Math.PI / 2);
  if (eksen === 'z') g.rotateX(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------- model
export function kolOlustur(M) {
  const kok = new THREE.Group();
  const parcalar = [];
  const ekle = (ebeveyn, geo, mat, adim, konum, ad = '') => {
    const m = new THREE.Mesh(geo, mat);
    if (konum) m.position.copy(konum);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.adim = adim; m.userData.ad = ad;
    ebeveyn.add(m); parcalar.push(m);
    return m;
  };

  // Servo: yerel çerçevede mil +Y yönünde, mil ucu orijinde, gövde -X ve -Y yönünde uzanır.
  function servo(tip, adim) {
    const g = new THREE.Group();
    const buyuk = tip === 'MG996R';
    const L = buyuk ? 40.7 : 22.8, W = buyuk ? 19.7 : 12.2, H = buyuk ? 37 : 22.7;
    const ust = buyuk ? 6 : 4.3, ofs = buyuk ? 10 : 5.9, flansL = buyuk ? 54 : 32.3, flansY = buyuk ? 26.7 : 15.9;
    const govdeMat = buyuk ? M.servo : M.servoMavi;
    const cx = ofs - L / 2, alt = -ust - H;
    ekle(g, kutuGeo(L, H, W, 1), govdeMat, adim, V(cx, alt + H / 2, 0), tip);
    ekle(g, kutuGeo(flansL, 2.5, W, 0.6), govdeMat, adim, V(cx, alt + flansY, 0));
    ekle(g, silindir(buyuk ? 6.5 : 3.6, ust * 0.5), govdeMat, adim, V(0, -ust * 0.75, 0));
    ekle(g, silindir(buyuk ? 4 : 2.4, 1.2), govdeMat, adim, V(buyuk ? -11 : -6, -ust + 0.6, 0));
    ekle(g, silindir(buyuk ? 2.9 : 2.3, ust * 0.5), M.pirinc, adim, V(0, -ust * 0.25, 0));
    for (const sx of [-1, 1]) {
      ekle(g, silindir(buyuk ? 2.2 : 1.5, 1.6), M.celik, adim, V(cx + sx * (flansL / 2 - (buyuk ? 4 : 2.5)), alt + flansY + 2, W * 0.25));
      ekle(g, silindir(buyuk ? 2.2 : 1.5, 1.6), M.celik, adim, V(cx + sx * (flansL / 2 - (buyuk ? 4 : 2.5)), alt + flansY + 2, -W * 0.25));
    }
    const etiket = new THREE.MeshStandardMaterial({ map: servoEtiketi(tip, buyuk ? 'DIGI HI TORQUE' : 'METAL GEAR'), roughness: 0.4 });
    for (const sz of [1, -1]) {
      const p = ekle(g, new THREE.PlaneGeometry(L * 0.72, H * 0.42), etiket, adim, V(cx, alt + H * 0.45, sz * (W / 2 + 0.05)));
      if (sz < 0) p.rotation.y = Math.PI;
      p.castShadow = false;
    }
    // kablo çıkışı
    const cikis = ekle(g, kutuGeo(4, 5, 7, 0.8), M.servo, adim, V(cx - L / 2 - 1.5, alt + 4, 0));
    ['#6b3b1f', '#c62828', '#f59e0b'].forEach((renk, k) => {
      const tel = ekle(g, silindir(0.8, 14, 'x', 10), new THREE.MeshStandardMaterial({ color: renk, roughness: 0.5 }), adim,
        V(cx - L / 2 - 9, alt + 3, (k - 1) * 1.7));
      tel.castShadow = false;
    });
    g.userData.cikis = cikis;
    return g;
  }

  function servoYerlestir(s, ebeveyn, milUcu, milYonu, govdeYonu) {
    const x = govdeYonu.clone().negate(), y = milYonu.clone(), z = new THREE.Vector3().crossVectors(x, y);
    s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    s.position.copy(milUcu);
    ebeveyn.add(s);
    return s;
  }

  function metalKol(ebeveyn, konum, eksen, adim) {        // MG996R 25T alüminyum disk kol
    const g = new THREE.Group();
    ekle(g, silindir(12.5, 2.5, 'y', 48), M.aluminyum, adim, V(0, 1.25, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      ekle(g, silindir(1.6, 0.6, 'y', 16), M.celik, adim, V(Math.cos(a) * 8, 2.6, Math.sin(a) * 8));
    }
    ekle(g, silindir(2.6, 1.2, 'y', 16), M.celik, adim, V(0, 3, 0));
    yonEkseni(g, eksen); g.position.copy(konum); ebeveyn.add(g);
    return g;
  }
  function plastikKol(ebeveyn, konum, eksen, adim) {      // MG90S plastik kol
    const g = new THREE.Group();
    const geo = cikar(stadyumSekli(15, 6.5, [[5, 0, 0.7], [10, 0, 0.7], [15, 0, 0.7]]), 1.8, 0.4);
    geo.rotateX(Math.PI / 2);
    ekle(g, geo, M.beyazPlastik, adim, V(0, 0.9, 0));
    ekle(g, silindir(3.6, 3, 'y', 24), M.beyazPlastik, adim, V(0, 1.5, 0));
    yonEkseni(g, eksen); g.position.copy(konum); ebeveyn.add(g);
    return g;
  }
  function yonEkseni(obj, eksen) {                         // nesnenin +Y'sini eksene çevir
    obj.quaternion.setFromUnitVectors(V(0, 1, 0), eksen.clone().normalize());
  }

  // ======================= zemin plakası ve taban (adım 1)
  // zemin plakası her adımda görünür ve hiç vurgulanmaz (adım 0)
  ekle(kok, kutuGeo(340, 12, 300, 2), M.ahsap, 0, V(-30, -6, 0), 'Zemin plakası');
  for (const [x, z] of [[-190, -140], [130, -140], [-190, 140], [130, 140]]) ekle(kok, silindir(4, 1.5), M.celik, 0, V(x, 0.75, z));

  const govde = new THREE.Group(); kok.add(govde);
  const govdeMeshleri = [
    ekle(govde, silindir(70, 6, 'y', 64), M.turuncu, 1, V(0, 3, 0), 'Taban gövdesi'),
    ekle(govde, silindir(58, 56, 'y', 64), M.turuncu, 1, V(0, 34, 0)),
    ekle(govde, new THREE.TorusGeometry(42, 2.2, 16, 64).rotateX(Math.PI / 2), M.celik, 1, V(0, 62.5, 0)),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ekle(govde, silindir(3, 2), M.celik, 1, V(Math.cos(a) * 64, 6.8, Math.sin(a) * 64));
  }
  const s1 = servo('MG996R', 1);
  servoYerlestir(s1, kok, V(0, 68, 0), V(0, 1, 0), V(0, 0, -1));

  // ======================= eksen 1: döner tabla (adım 2)
  const eksen1 = new THREE.Group(); eksen1.position.set(0, 68, 0); kok.add(eksen1);
  metalKol(eksen1, V(0, 0, 0), V(0, 1, 0), 2);
  ekle(eksen1, silindir(62, 8, 'y', 72), M.koyu, 2, V(0, 6.5, 0), 'Döner tabla');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    ekle(eksen1, silindir(2.8, 1.6), M.celik, 2, V(Math.cos(a) * 48, 11.3, Math.sin(a) * 48));
  }

  // ======================= omuz yatağı + omuz servosu (adım 3)
  const OMUZ_Y = 78;
  ekle(eksen1, kutuGeo(70, 6, 58, 1.5), M.turuncu, 3, V(0, 13.5, 0), 'Omuz yatağı');
  for (const z of [-14.5, 14.5]) ekle(eksen1, kutuGeo(50, 82, 5, 1.5), M.turuncu, 3, V(-1, 16.5 + 41, z));
  ekle(eksen1, kutuGeo(4, 28, 34, 1.5), M.turuncu, 3, V(-23, OMUZ_Y, 0));
  ekle(eksen1, silindir(4, 8, 'x', 24), M.celik, 3, V(-28, OMUZ_Y, 0));
  const s2 = servo('MG996R', 3);
  servoYerlestir(s2, eksen1, V(24, OMUZ_Y, 0), V(1, 0, 0), V(0, -1, 0));

  // ======================= eksen 2: üst kol + dirsek servosu (adım 4)
  const UST_KOL = 120;
  const eksen2 = new THREE.Group(); eksen2.position.set(0, OMUZ_Y, 0); eksen1.add(eksen2);
  metalKol(eksen2, V(24, 0, 0), V(1, 0, 0), 4);
  const ustKolGeo = () => yonlendir(cikar(stadyumSekli(UST_KOL, 38, [[0, 0, 4.5], [UST_KOL, 0, 4.5]], [[26, 92, 8]]), 5), V(0, 1, 0), V(0, 0, 1));
  ekle(eksen2, ustKolGeo(), M.turuncu, 4, V(29, 0, 0), 'Üst kol');
  ekle(eksen2, ustKolGeo(), M.turuncu, 4, V(-29, 0, 0));
  ekle(eksen2, kutuGeo(53, 8, 30, 1.5), M.turuncu, 4, V(0, 40, 0));
  ekle(eksen2, kutuGeo(53, 6, 30, 1.5), M.turuncu, 4, V(0, 76, 0));
  for (const x of [29, -29]) for (const y of [40, 76]) ekle(eksen2, silindir(2.8, 1.5, 'x', 16), M.celik, 4, V(x + Math.sign(x) * 3.2, y, 0));
  ekle(eksen2, silindir(4, 10, 'x', 24), M.celik, 4, V(-35, UST_KOL, 0));
  const s3 = servo('MG996R', 4);
  servoYerlestir(s3, eksen2, V(32, UST_KOL, 0), V(1, 0, 0), V(0, -1, 0));

  // ======================= eksen 3: ön kol + bilek eğim servosu (adım 5)
  const ON_KOL = 110;
  const eksen3 = new THREE.Group(); eksen3.position.set(0, UST_KOL, 0); eksen2.add(eksen3);
  metalKol(eksen3, V(32, 0, 0), V(1, 0, 0), 5);
  const yanGeo = () => yonlendir(cikar(stadyumSekli(36, 32, [[0, 0, 4.5]]), 4), V(0, 0, 1), V(0, 1, 0));
  ekle(eksen3, yanGeo(), M.turuncu, 5, V(36.5, 0, 0), 'Ön kol');
  ekle(eksen3, yanGeo(), M.turuncu, 5, V(-36.5, 0, 0));
  ekle(eksen3, kutuGeo(69, 20, 12, 2), M.turuncu, 5, V(0, 0, 34));
  const kiris = yonlendir(cikar(stadyumSekli(44, 22, [], [[12, 32, 5]]), 20, 1.5), V(0, 0, 1), V(1, 0, 0));
  ekle(eksen3, kiris, M.turuncu, 5, V(0, 0, 36));
  for (const y of [-9.5, 9.5]) ekle(eksen3, kutuGeo(26, 3, 32, 1), M.turuncu, 5, V(-1, y, 104));
  ekle(eksen3, kutuGeo(26, 22, 4, 1), M.turuncu, 5, V(-1, 0, 89));
  const s4 = servo('MG90S', 5);
  servoYerlestir(s4, eksen3, V(15, 0, ON_KOL), V(1, 0, 0), V(0, 0, -1));

  // ======================= eksen 4: bilek gövdesi + bilek dönüş servosu (adım 6)
  const eksen4 = new THREE.Group(); eksen4.position.set(0, 0, ON_KOL); eksen3.add(eksen4);
  plastikKol(eksen4, V(15, 0, 0), V(1, 0, 0), 6);
  const bilekYan = () => yonlendir(cikar(stadyumSekli(24, 18, [[0, 0, 2.5]]), 3), V(0, 0, 1), V(0, 1, 0));
  ekle(eksen4, bilekYan(), M.koyu, 6, V(18.5, 0, 0), 'Bilek gövdesi');
  ekle(eksen4, bilekYan(), M.koyu, 6, V(-16, 0, 0));
  ekle(eksen4, kutuGeo(38, 32, 4, 1.2), M.koyu, 6, V(1, -5, 27.5));
  const s5 = servo('MG90S', 6);
  servoYerlestir(s5, eksen4, V(0, 0, 57), V(0, 0, 1), V(0, -1, 0));

  // ======================= eksen 5: kıskaç (adım 7)
  const eksen5 = new THREE.Group(); eksen5.position.set(0, 0, 57); eksen4.add(eksen5);
  plastikKol(eksen5, V(0, 0, 0), V(0, 0, 1), 7);
  ekle(eksen5, kutuGeo(30, 22, 10, 1.5), M.koyu, 7, V(0, -3, 6.5), 'Kıskaç');
  ekle(eksen5, kutuGeo(60, 4, 42, 1.2), M.koyu, 7, V(0, -12, 31));
  const s6 = servo('MG90S', 7);
  servoYerlestir(s6, eksen5, V(-9.2, -9.5, 40), V(0, 1, 0), V(0, 0, -1));
  const parmaklar = [];
  for (const yon of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(yon * 9.2, -10, 40); eksen5.add(p);
    const disli = cikar(disliSekli(9.2, 14), 5, 0.4); disli.rotateX(-Math.PI / 2);
    ekle(p, disli, M.beyazPlastik, 7, V(0, 2.5, 0));
    const kolGeo = yonlendir(cikar(stadyumSekli(46, 9, [[0, 0, 2]]), 5, 0.6), V(0, 0, 1), V(1, 0, 0));
    ekle(p, kolGeo, M.koyu, 7, V(0, 7.5, 0));
    const ped = ekle(p, kutuGeo(5, 14, 16, 1.2), M.lastik, 7, V(-yon * 4.5, 4, 48));
    ped.userData.ped = true;
    p.userData.yon = yon;
    parmaklar.push(p);
  }
  const uc = new THREE.Object3D(); uc.position.set(0, -6, 88); eksen5.add(uc);

  // ======================= elektronik kutusu (adım 8)
  const kutu = new THREE.Group(); kutu.position.set(-128, 0, -92); kutu.rotation.y = 0.12; kok.add(kutu);
  ekle(kutu, kutuGeo(96, 4, 76, 1.5), M.koyu, 8, V(0, 2, 0), 'Elektronik kutusu');
  for (const [x, z, w, d] of [[0, -36.5, 96, 3], [0, 36.5, 96, 3], [-46.5, 0, 3, 76], [46.5, 0, 3, 76]]) ekle(kutu, kutuGeo(w, 26, d, 1), M.koyu, 8, V(x, 15, z));
  ekle(kutu, kutuGeo(62, 1.6, 25, 0.3), M.pca, 8, V(8, 9, -16), 'PCA9685');
  ekle(kutu, kutuGeo(14, 9, 7, 0.5), new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.5 }), 8, V(-30, 14, -16));
  for (let k = 0; k < 16; k++) ekle(kutu, kutuGeo(2.4, 8, 7.5, 0.2), M.pin, 8, V(-12 + k * 2.54, 14, -22));
  ekle(kutu, kutuGeo(51, 1.6, 28, 0.3), M.esp, 8, V(-6, 9, 18), 'ESP32');
  ekle(kutu, kutuGeo(18, 3, 25, 0.4), M.kalkan, 8, V(10, 11, 18));
  ekle(kutu, kutuGeo(8, 3, 7, 0.4), M.kalkan, 8, V(-33, 11.5, 18));
  // USB ve güç kabloları (sabit)
  const sabitKablo = (noktalar, r, mat) => {
    const e = ekle(kok, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(noktalar), 64, r, 10), mat, 8);
    return e;
  };
  // plaka kenarından masaya iner (masa üstü y = -12)
  sabitKablo([V(-165, 11, -74), V(-182, 4, -58), V(-198, 1.5, -40), V(-204, -4, -30), V(-210, -9.6, -18), V(-260, -9.8, 10), V(-340, -9.8, 40)], 2.2, M.kablo);
  sabitKablo([V(-150, 18, -122), V(-156, 6, -138), V(-160, 2.5, -147), V(-163, -4, -153), V(-168, -8.6, -162), V(-185, -8.8, -210), V(-215, -8.8, -320)], 3.2, M.kablo);

  // ======================= spiral kablo demeti (adım 8, her karede güncellenir)
  const capa = (ebeveyn, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); ebeveyn.add(o); return o; };
  const capalar = [
    capa(kok, -100, 24, -80), capa(kok, -55, 4, -55), capa(kok, -20, 8, -66),
    capa(eksen1, 0, 16, -30), capa(eksen1, 0, 45, -24),
    capa(eksen2, 0, 10, -24), capa(eksen2, 0, 62, -24), capa(eksen2, 0, UST_KOL + 6, -24),
    capa(eksen3, 0, 16, 18), capa(eksen3, 0, 16, 62), capa(eksen3, 0, 16, 98),
    capa(eksen4, 0, 14, 18), capa(eksen4, 0, 14, 44),
  ];
  const demet = ekle(kok, new THREE.BufferGeometry(), M.spiral, 8, null, 'Kablo demeti');
  demet.castShadow = true;
  const gecici = capalar.map(() => new THREE.Vector3());
  function demetGuncelle() {
    if (!demet.visible) return;
    kok.updateMatrixWorld(true);
    const ters = new THREE.Matrix4().copy(kok.matrixWorld).invert();
    capalar.forEach((c, i) => gecici[i].setFromMatrixPosition(c.matrixWorld).applyMatrix4(ters));
    const egri = new THREE.CatmullRomCurve3(gecici, false, 'centripetal');
    demet.geometry.dispose();
    demet.geometry = new THREE.TubeGeometry(egri, 160, 3.4, 10);
    M.spiral.map.repeat.set(egri.getLength() / 7, 1);
  }

  // ======================= eklem açıları
  const eklemler = [eksen1, eksen2, eksen3, eksen4, eksen5];
  function acilariUygula(a) {
    eksen1.rotation.y = rad(a[0] - 90);
    eksen2.rotation.x = rad(a[1] - 90);
    eksen3.rotation.x = rad(a[2] - 90);
    eksen4.rotation.x = rad(a[3] - 90);
    eksen5.rotation.z = rad(a[4] - 90);
    const fi = rad(((120 - a[5]) / 90) * 30);    // 120 = kapalı, 30 = tam açık
    for (const p of parmaklar) p.rotation.y = -p.userData.yon * fi;
    demetGuncelle();
  }

  const etiketNoktalari = [
    capa(kok, 80, 40, 0), capa(eksen1, 46, OMUZ_Y, 0), capa(eksen2, 54, UST_KOL, 0),
    capa(eksen3, 0, 26, ON_KOL), capa(eksen4, 0, 24, 46), capa(eksen5, 0, 14, 86),
  ];

  return { kok, parcalar, govdeMeshleri, eklemler, acilariUygula, uc, etiketNoktalari, demetGuncelle };
}

// ---------------------------------------------------------------- sahne
export function sahneKur(M) {
  const sahne = new THREE.Scene();
  sahne.background = new THREE.Color(0xe7ebf0);
  sahne.fog = new THREE.Fog(0xe7ebf0, 1400, 3200);
  const masa = new THREE.Mesh(new THREE.CircleGeometry(3000, 64).rotateX(-Math.PI / 2), M.masa);
  masa.position.y = -12; masa.receiveShadow = true;
  sahne.add(masa);
  sahne.add(new THREE.HemisphereLight(0xffffff, 0x8d8a85, 0.35));
  const gunes = new THREE.DirectionalLight(0xfff4e6, 2.6);
  gunes.position.set(320, 620, 380);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(2048, 2048);
  Object.assign(gunes.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 100, far: 1600 });
  gunes.shadow.bias = -0.0004; gunes.shadow.normalBias = 0.6; gunes.shadow.radius = 4;
  sahne.add(gunes);
  const dolgu = new THREE.DirectionalLight(0xdbe7ff, 0.6);
  dolgu.position.set(-400, 260, -200);
  sahne.add(dolgu);
  return sahne;
}
