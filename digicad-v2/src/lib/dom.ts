/**
 * Güvenli DOM oluşturucu. Veriler ASLA HTML olarak yorumlanmaz:
 * metinler TextNode, öznitelikler setAttribute ile yazılır.
 * on* öznitelikleri ve javascript:/data: URL'leri engellenir; olaylar `on` ile addEventListener'a bağlanır.
 */
export type Child = Node | string | number | boolean | null | undefined | Child[];
export interface Props {
  class?: string;
  on?: { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };
  [attr: string]: unknown;
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

/** Yalnızca https:, blob: ve göreli adreslere izin verir. */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string') return '#';
  const t = u.trim();
  if (/^https:\/\//i.test(t) || /^blob:/i.test(t)) return t;
  if (/^[./#?]/.test(t) && !/^\/\//.test(t)) return t;
  return '#';
}

/** Dosya adını gösterim/indirme için temizler (yol ayırıcı ve kontrol karakterleri çıkar). */
export function safeFileName(n: unknown): string {
   
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f\\/]+/g, '_').replace(/^\.+/, '_').slice(0, 180);
  return s || 'dosya';
}

function append(parent: Node, c: Child): void {
  if (c === null || c === undefined || c === false || c === true) return;
  if (Array.isArray(c)) { c.forEach((x) => append(parent, x)); return; }
  parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (/^on/i.test(k) || k.toLowerCase() === 'style' || k.toLowerCase() === 'srcdoc') {
        throw new Error(`h(): '${k}' özniteliği yasak (CSP/XSS).`);
      } else if (URL_ATTRS.has(k.toLowerCase())) {
        el.setAttribute(k, safeUrl(v));
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }
export function mount(el: Element, ...children: Child[]): void { clear(el); append(el, children); }

/** Bağlantı hedefi dışarıya açılıyorsa güvenli rel ekler. */
export function link(href: string, text: string, cls = ''): HTMLAnchorElement {
  return h('a', { href, class: cls, target: '_blank', rel: 'noopener noreferrer' }, text);
}
