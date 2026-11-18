// Toast kuyruğu: üst orta, en fazla 3 görünür, her biri ~3.5 sn.
import { h } from './frame.js';
import { shield } from './touch.js';

const MAX_VISIBLE = 3;
const LIFE_MS = 3500;
const OUT_MS = 260;
const MAX_QUEUE = 30;
const KINDS = new Set(['info', 'good', 'bad', 'event']);

export function createToasts(root) {
  const box = h('div', 'toasts');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  root.appendChild(box);
  const queue = [];
  const live = []; // {el, timer}

  function dismiss(item) {
    if (item.out) return;
    item.out = true;
    clearTimeout(item.timer);
    item.el.classList.add('out');
    setTimeout(() => {
      item.el.remove();
      const i = live.indexOf(item);
      if (i >= 0) live.splice(i, 1);
      pump();
    }, OUT_MS);
  }

  function show(t) {
    const el = h('div', `toast glass k-${t.kind}`);
    el.textContent = t.text;
    shield(el);
    const item = { el, timer: 0, out: false };
    el.addEventListener('click', () => dismiss(item));
    box.appendChild(el);
    live.push(item);
    // Kuyrukta bekleyen varsa biraz daha kısa göster
    item.timer = setTimeout(() => dismiss(item), queue.length > 2 ? LIFE_MS * 0.7 : LIFE_MS);
  }

  function pump() {
    while (queue.length && live.length < MAX_VISIBLE) show(queue.shift());
  }

  return {
    push(p) {
      if (!p || p.text == null || p.text === '') return;
      const kind = KINDS.has(p.kind) ? p.kind : 'info';
      const text = String(p.text);
      // Art arda aynı mesajı yığma
      const last = queue[queue.length - 1];
      if (last && last.text === text && last.kind === kind) return;
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({ text, kind });
      pump();
    },
    destroy() { for (const i of live) clearTimeout(i.timer); queue.length = 0; },
  };
}
