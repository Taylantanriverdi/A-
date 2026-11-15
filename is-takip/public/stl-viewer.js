// STL 3D görüntüleyici — three.js yalnızca gerektiğinde yüklenir.
let THREE = null;
let OrbitControls = null;

async function loadThree() {
  if (THREE) return;
  THREE = await import('three');
  ({ OrbitControls } = await import('./vendor/OrbitControls.js'));
}

/** Hem ikili (binary) hem ASCII STL dosyalarını okur. */
export function parseSTL(buffer) {
  const dv = new DataView(buffer);
  const isBinary = () => {
    if (buffer.byteLength < 84) return false;
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buffer.byteLength) return true;
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
    return !/^\s*solid[\s\S]*facet/.test(head);
  };
  if (isBinary()) {
    const n = dv.getUint32(80, true);
    const pos = new Float32Array(n * 9);
    let o = 84;
    for (let i = 0; i < n; i++) {
      o += 12; // normal: yeniden hesaplanacak
      for (let v = 0; v < 9; v++) { pos[i * 9 + v] = dv.getFloat32(o, true); o += 4; }
      o += 2;
    }
    return pos;
  }
  const text = new TextDecoder().decode(buffer);
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const arr = [];
  let m;
  while ((m = re.exec(text))) arr.push(+m[1], +m[2], +m[3]);
  return new Float32Array(arr);
}

/**
 * Bir kapsayıcıya STL görüntüleyici yerleştirir.
 * @returns {Promise<{dispose: Function, setWire: Function, setColor: Function, reset: Function, snapshot: Function, info: object}>}
 */
export async function mountViewer(container, buffer, ext = 'stl') {
  await loadThree();
  let geom;
  if (ext === 'ply') {
    // Agiz ici tarayici PLY dosyalari (renkli olabilir)
    const { PLYLoader } = await import('./vendor/PLYLoader.js');
    geom = new PLYLoader().parse(buffer);
    if (!geom.attributes.position || !geom.attributes.position.count) throw new Error('PLY içinde nokta bulunamadı');
  } else {
    const positions = parseSTL(buffer);
    if (!positions.length) throw new Error('STL içinde üçgen bulunamadı');
    geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  }
  const hasFaces = ext !== 'ply' || !!geom.index;
  const hasColor = !!geom.attributes.color;
  if (hasFaces) geom.computeVertexNormals();
  geom.computeBoundingBox();
  const box = geom.boundingBox;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  geom.translate(-center.x, -center.y, -center.z);
  const radius = size.length() / 2 || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1.5, 2); camera.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2, -1, 1); camera.add(fill);
  scene.add(camera);

  const material = hasFaces
    ? new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xf1e9dc, vertexColors: hasColor, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide })
    : new THREE.PointsMaterial({ size: radius / 300, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xf1e9dc });
  const mesh = hasFaces ? new THREE.Mesh(geom, material) : new THREE.Points(geom, material);
  scene.add(mesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const reset = () => {
    camera.position.set(0, -radius * 0.6, radius * 2.6);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  };
  reset();

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf;
  const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();

  return {
    info: { triangles: hasFaces ? (geom.index ? geom.index.count : geom.attributes.position.count) / 3 : 0, points: geom.attributes.position.count, size: { x: size.x, y: size.y, z: size.z } },
    setWire: (on) => { material.wireframe = on; },
    // Renk secilince taramanin kendi renkleri kapatilir; "Orijinal" ile geri gelir
    setColor: (hex) => { if (hex === 'orig') { material.vertexColors = hasColor; material.color.set(hasColor ? 0xffffff : 0xf1e9dc); } else { material.vertexColors = false; material.color.set(hex); } material.needsUpdate = true; },
    reset,
    snapshot: () => renderer.domElement.toDataURL('image/png'),
    dispose: () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      geom.dispose(); material.dispose(); renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
