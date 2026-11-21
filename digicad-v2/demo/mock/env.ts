/**
 * DEMO — tarayıcı ortamı: sabit demo şeridi, sahte ağ (gerçek ağ çağrıları engellenir), Gmail/Google taklidi,
 * sahte dosya adreslerinin indirilmesi ve demo sayfaları arası bağlantılar.
 */
import { DEMO_FILE_HOST, blobForUrl } from './storage';
import { store } from './store';
import { DOCTOR_EMAILS } from '../seed';

const PAGES: { id: string; label: string; file: string }[] = [
  { id: 'admin', label: 'Yönetim', file: 'DigiCAD-Demo-Admin.html' },
  { id: 'gelen-isler', label: 'Gelen İşler', file: 'DigiCAD-Demo-GelenIsler.html' },
  { id: 'hekim', label: 'Hekim Portalı', file: 'DigiCAD-Demo-Hekim.html' },
  { id: 'teknisyen', label: 'Teknisyen Paneli', file: 'DigiCAD-Demo-Teknisyen.html' },
];
const WHO: Record<string, string> = { admin: 'Yönetici', 'gelen-isler': 'Yönetici', hekim: 'Hekim (Dr. Elif Yılmaz)', teknisyen: 'Teknisyen (Murat Aydın)' };

const CSS = `
body{padding-top:44px}
.demo-bar{position:fixed;top:0;left:0;right:0;z-index:100000;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:7px 14px;background:#7a2e00;color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.demo-bar b{background:#ffd34d;color:#4a1b00;padding:2px 8px;border-radius:5px;letter-spacing:.5px}
.demo-bar .grow{flex:1}
.demo-bar a,.demo-bar button{color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:3px 9px;font:inherit;text-decoration:none;cursor:pointer}
.demo-bar a:hover,.demo-bar button:hover{background:rgba(255,255,255,.28)}
.demo-bar a.cur{background:#fff;color:#7a2e00;border-color:#fff}
@media (max-width:700px){body{padding-top:84px}}
/* Uygulamadaki menü sarmalayıcısı (div) sütun değil satır içi akıyor: iki menü öğesi yan yana düşüp üzerine gelince titriyor. Yalnızca demoda düzeltilir. */
.side>div{display:flex;flex-direction:column;gap:2px}
@media (max-width:800px){.side>div{flex-direction:row}}
`;

function banner(): void {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const bar = document.createElement('div'); bar.className = 'demo-bar'; bar.setAttribute('role', 'note');
  const tag = document.createElement('b'); tag.textContent = 'DEMO'; bar.appendChild(tag);
  const msg = document.createElement('span'); msg.textContent = '— örnek verilerdir, gerçek veri değildir'; bar.appendChild(msg);
  const who = document.createElement('span'); who.textContent = `· Oturum: ${WHO[__DEMO_PAGE__] ?? ''}`; who.style.opacity = '.8'; bar.appendChild(who);
  const grow = document.createElement('span'); grow.className = 'grow'; bar.appendChild(grow);
  for (const p of PAGES) { const a = document.createElement('a'); a.href = p.file; a.textContent = p.label; if (p.id === __DEMO_PAGE__) a.className = 'cur'; bar.appendChild(a); }
  const start = document.createElement('a'); start.href = 'BASLA.html'; start.textContent = 'Başlangıç'; bar.appendChild(start);
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Verileri sıfırla';
  reset.addEventListener('click', () => { if (window.confirm('Demo verileri ilk haline döndürülsün mü?')) { store().reset(); window.location.reload(); } });
  bar.appendChild(reset);
  document.body.prepend(bar);
}

/* ---------- Gmail taklidi (Mail Kutusu sayfası) ---------- */
const b64u = (s: string): string => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
function mails(): { id: string; from: string; subject: string; daysAgo: number; text: string; attach?: string }[] {
  const d = (i: number) => DOCTOR_EMAILS[i];
  return [
    { id: 'g1', from: `${d(0).name} <${d(0).email}>`, subject: 'Yeni sipariş: zirkonyum kron', daysAgo: 0, text: `Merhaba,\r\nHekim: ${d(0).name}\r\nHasta: Derya Koç\r\nİş: Zirkonyum Kron\r\nDiş: 24, 25\r\nRenk: A2\r\nTaramalar ekte. Cuma gününe kadar rica ederim.`, attach: 'koc_tarama.stl' },
    { id: 'g2', from: `${d(5).name} <${d(5).email}>`, subject: 'Order: e.max crown', daysAgo: 1, text: `Hello,\r\nHekim: ${d(5).name}\r\nHasta: Lukas Fischer\r\nİş: E.max Kron\r\nDiş: 21\r\nRenk: A1\r\nPlease confirm the date.` },
    { id: 'g3', from: `${d(2).name} <${d(2).email}>`, subject: 'Veneer vakası', daysAgo: 2, text: `Selam,\r\nHekim: ${d(2).name}\r\nHasta: Alara Kılıç\r\nİş: Laminate Veneer\r\nDiş: 13, 12, 11, 21, 22, 23\r\nRenk: BL2\r\nFotoğraflar ekte.` },
    { id: 'g4', from: 'Örnek Tedarik <satis@ornek-tedarik.example>', subject: 'Haziran fiyat listesi', daysAgo: 4, text: 'Güncel malzeme fiyat listemiz ektedir (demo e-postası).' },
  ];
}
function gmailMock(url: string): Response {
  const u = new URL(url); const path = u.pathname.replace('/gmail/v1/users/me/', '');
  const json = (o: unknown): Response => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path === 'messages') return json({ messages: mails().map((m) => ({ id: m.id })) });
  const att = path.match(/^messages\/([^/]+)\/attachments\//); if (att) return json({ data: b64u('DigiCAD DEMO ek dosyası (örnek).') });
  const m = mails().find((x) => path === `messages/${x.id}`); if (!m) return new Response('{}', { status: 404 });
  const at = Date.now() - m.daysAgo * 86_400_000;
  const parts: object[] = [{ mimeType: 'text/plain', body: { data: b64u(m.text) } }];
  if (m.attach) parts.push({ mimeType: 'application/octet-stream', filename: m.attach, body: { attachmentId: `att-${m.id}` } });
  return json({ id: m.id, internalDate: String(at), payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'Date', value: new Date(at).toUTCString() }], parts } });
}

function installNetwork(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(DEMO_FILE_HOST)) return new Response(blobForUrl(url), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) return gmailMock(url);
    if (/^(https?|wss?):/i.test(url)) throw new TypeError('DEMO: ağ erişimi kapalı (gerçek sunuculara istek gönderilmez).');
    return real(input, init);
  };
  // Google Identity Services yerine sahte jeton istemcisi
  (window as unknown as { google: unknown }).google = { accounts: { oauth2: { initTokenClient: (o: { callback: (r: { access_token: string }) => void }) => ({ requestAccessToken: () => { setTimeout(() => o.callback({ access_token: 'demo-gmail-token' }), 250); } }) } } };
}

/** Sahte dosya adreslerini (blob) indirir; sayfalar arası kök bağlantıları (/admin.html …) demo dosyalarına çevirir. */
function installLinks(): void {
  const saveFromUrl = (url: string): void => {
    const blob = blobForUrl(url); if (!blob) return;
    const name = decodeURIComponent(url.split('/').pop() ?? 'dosya').replace(/^\d+_[0-9a-f]{8}_/, '');
    const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = name;
    document.body.appendChild(a); origClick.call(a); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 20000);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    const raw = this.getAttribute('href') ?? '';
    if (raw.startsWith(DEMO_FILE_HOST)) { saveFromUrl(raw); return; }
    origClick.call(this);
  };
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a'); if (!a) return;
    const raw = a.getAttribute('href') ?? '';
    if (raw.startsWith(DEMO_FILE_HOST)) { e.preventDefault(); saveFromUrl(raw); return; }
    const m = raw.match(/^\/(admin|hekim|teknisyen|gelen-isler)\.html$/); const page = m && PAGES.find((p) => p.id === m[1]);
    if (page) { e.preventDefault(); window.location.href = page.file; }
  }, true);
}

let installed = false;
export function installDemoEnv(): void {
  if (installed) return; installed = true;
  installNetwork(); installLinks();
  if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
}
