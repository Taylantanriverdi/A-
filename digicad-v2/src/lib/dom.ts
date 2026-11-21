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

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'ping', 'cite', 'background', 'srcset', 'manifest', 'codebase', 'longdesc', 'usemap', 'profile']);
/** Hiçbir koşulda üretilmeyecek etiketler (betik/çerçeve/stil/gömme enjeksiyonu). */
const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link', 'applet', 'noscript', 'template', 'portal']);
/** Geçerli öznitelik adı: harf/altçizgi/iki nokta ile başlar; yalnızca güvenli karakterler. */
const ATTR_NAME = /^[a-zA-Z_][a-zA-Z0-9_:.-]*$/;
const CTRL_OR_BACKSLASH = /[\u0000-\u0020\u007f-\u009f\\]/;

/**
 * Yalnızca https:, blob: ve göreli adreslere izin verir.
 * Tarayıcıların URL ayrıştırıcısı sekme/satır sonu atar ve `\` karakterini `/` sayar:
 * `/\evil.com` veya `/<TAB>/evil.com` protokol-göreli (açık yönlendirme) olur; bu yüzden
 * kontrol karakteri / boşluk / ters eğik çizgi içeren adresler reddedilir.
 */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string') return '#';
  const t = u.trim();
  if (!t || CTRL_OR_BACKSLASH.test(t)) return '#';
  if (/^https:\/\/[^/?#]/i.test(t) || /^blob:https?:\/\//i.test(t)) return t;
  if (/^(\.{1,2}\/|#|\?)/.test(t) || (/^\/[^/]/.test(t))) return t;
  return t === '/' ? t : '#';
}

/** Dosya adını gösterim/indirme için temizler (yol ayırıcı ve kontrol karakterleri çıkar). */
export function safeFileName(n: unknown): string {
  // Kontrol karakterleri, yol ayırıcılar ve Unicode yön değiştirme karakterleri (RLO ile uzantı sahteciliği) temizlenir.
    const s = String(n ?? '').replace(/[\u0000-\u001f\u007f-\u009f\\/\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, '_').replace(/^\.+/, '_').trim().slice(0, 180);
  return s || 'dosya';
}

function append(parent: Node, c: Child): void {
  if (c === null || c === undefined || c === false || c === true) return;
  if (Array.isArray(c)) { c.forEach((x) => append(parent, x)); return; }
  parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  if (FORBIDDEN_TAGS.has(String(tag).toLowerCase())) throw new Error(`h(): '${tag}' etiketi yasak (CSP/XSS).`);
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
      } else if (/^on/i.test(k) || k.toLowerCase() === 'style' || k.toLowerCase() === 'srcdoc' || k.toLowerCase() === 'is' || /^xmlns/i.test(k)) {
        throw new Error(`h(): '${k}' özniteliği yasak (CSP/XSS).`);
      } else if (!ATTR_NAME.test(k)) {
        throw new Error(`h(): geçersiz öznitelik adı '${k}'.`);
      } else if (URL_ATTRS.has(k.toLowerCase())) {
        el.setAttribute(k, safeUrl(v));
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
    // target=_blank ile açılan bağlantılar window.opener erişimi vermesin.
    if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
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
