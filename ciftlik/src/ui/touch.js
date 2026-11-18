// Dokunmatik / işaretçi kalkanı: UI elemanlarına gelen olayların canvas'a
// (ve Phaser'ın window dinleyicilerine) sızmasını engeller.
// Yalnızca "başlangıç" olayları durdurulur. up/end olayları BİLEREK yayılır:
// canvas'ta başlayan bir sürükleme UI üzerinde biterse Phaser'ın window dinleyicisi
// bırakmayı yine görür (takılı kalan pan olmaz).
const STOP = ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'contextmenu', 'dblclick'];

const stop = (e) => { e.stopPropagation(); };
const stopWheel = (e) => {
  e.stopPropagation();
  // Kaydırılabilir bir panel değilse sayfanın zoom/scroll yapmasını önle
  const t = e.target;
  if (!(t && t.closest && t.closest('.scrollable'))) e.preventDefault();
};
const noCtx = (e) => { e.preventDefault(); e.stopPropagation(); };

/** el üzerindeki işaretçi/dokunma/teker olaylarını kapsüller. */
export function shield(el) {
  for (const n of STOP) {
    const fn = n === 'wheel' ? stopWheel : n === 'contextmenu' ? noCtx : stop;
    el.addEventListener(n, fn, { passive: n !== 'wheel' && n !== 'contextmenu' });
  }
  // iOS çift dokunma / pinch zoom'unu UI üzerinde engelle
  el.addEventListener('dblclick', (e) => e.preventDefault());
  el.addEventListener('gesturestart', (e) => e.preventDefault());
  return el;
}

/** Düğmeye hızlı dokunma davranışı: fare tıklamasından sonra odak halkası kalmasın. */
export function tap(btn, fn) {
  btn.addEventListener('click', (e) => {
    fn(e);
    if (e.detail > 0) btn.blur();
  });
  return btn;
}
