// Kare başına toplu DOM yazımı. Bileşenler `render()` fonksiyonu kaydeder;
// olaylar yalnızca "kirli" işaretler, gerçek DOM yazımı rAF içinde kare başına bir kez olur.
export function createFrameLoop() {
  const tasks = [];
  let raf = 0;
  let running = false;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    for (let i = 0; i < tasks.length; i++) {
      try { tasks[i](t); } catch (e) { console.error('[ui] frame', e); }
    }
  };
  return {
    add(fn) { tasks.push(fn); },
    start() { if (!running) { running = true; raf = requestAnimationFrame(loop); } },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}

/** Değer değiştiyse textContent yazar (aynı metni tekrar yazmaz). */
export function setText(el, text) {
  if (el.__t !== text) { el.__t = text; el.textContent = text; }
}

/** Basit eleman üretici. */
export function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}
