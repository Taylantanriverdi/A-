import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const cfg = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
type H = { source: string; headers: { key: string; value: string }[] };
const rules: H[] = cfg.hosting.headers;
const headersFor = (src: string): Record<string, string> => Object.fromEntries(rules.filter((r) => r.source === '**' || r.source === src).flatMap((r) => r.headers.map((h) => [h.key, h.value])));
const dir = (csp: string, name: string): string[] => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(name + ' ')) ?? '').split(/\s+/).slice(1);
const PAGES = ['/', '/index.html', '/hekim.html', '/teknisyen.html', '/gelen-isler.html', '/admin.html'];

describe('firebase.json Hosting başlıkları', () => {
  it('her sayfada CSP, COOP ve no-store var; ortak güvenlik başlıkları tüm yollarda', () => {
    for (const p of PAGES) { const h = headersFor(p); expect(h['Content-Security-Policy'], p).toBeTruthy(); expect(h['Cross-Origin-Opener-Policy'], p).toBeTruthy(); expect(h['Cache-Control'], p).toBe('no-store'); }
    const all = headersFor('/assets/x.js');
    expect(all['Strict-Transport-Security']).toMatch(/max-age=(\d+)/); expect(Number(/max-age=(\d+)/.exec(all['Strict-Transport-Security'])![1])).toBeGreaterThanOrEqual(31536000);
    expect(all['Strict-Transport-Security']).toMatch(/includeSubDomains/); expect(all['Strict-Transport-Security']).toMatch(/preload/);
    expect(all['X-Content-Type-Options']).toBe('nosniff'); expect(all['X-Frame-Options']).toBe('DENY'); expect(all['Referrer-Policy']).toBeTruthy();
    expect(all['Permissions-Policy']).toMatch(/camera=\(\)/); expect(all['Permissions-Policy']).toMatch(/microphone=\(\)/); expect(all['Permissions-Policy']).toMatch(/geolocation=\(\)/);
    expect(headersFor('/assets/**')['Cache-Control']).toMatch(/immutable/);
  });
  it('CSP: script-src satır içi/eval içermez; object-src none; base-uri none; frame-ancestors none', () => {
    for (const p of PAGES) {
      const csp = headersFor(p)['Content-Security-Policy'];
      const script = dir(csp, 'script-src'); expect(script[0], p).toBe("'self'");
      for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'http:', 'https:', "'unsafe-hashes'"]) { expect(script, p + bad).not.toContain(bad); expect(dir(csp, 'style-src'), p + bad).not.toContain(bad); }
      expect(dir(csp, 'object-src')).toEqual(["'none'"]); expect(dir(csp, 'base-uri')).toEqual(["'none'"]); expect(dir(csp, 'frame-ancestors')).toEqual(["'none'"]);
      expect(dir(csp, 'form-action')).toEqual(["'self'"]); expect(csp).toMatch(/upgrade-insecure-requests/);
      expect(dir(csp, 'default-src')).not.toContain('*');
    }
  });
  it('connect-src yalnızca gerekli Firebase/Google alanları (genel *.googleapis.com / *.firebaseio.com yok)', () => {
    for (const p of PAGES) {
      const c = dir(headersFor(p)['Content-Security-Policy'], 'connect-src');
      expect(c).not.toContain('https://*.googleapis.com'); expect(c).not.toContain('https://*.firebaseio.com'); expect(c).not.toContain('https://*.run.app'); expect(c).not.toContain('*');
      for (const need of ['https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firebasestorage.googleapis.com', 'https://firebaseappcheck.googleapis.com']) expect(c, need).toContain(need);
    }
  });
  it('Google Identity Services / Gmail yalnızca admin sayfasına açık', () => {
    const adm = headersFor('/admin.html'); const csp = adm['Content-Security-Policy'];
    expect(dir(csp, 'script-src')).toContain('https://accounts.google.com/gsi/client'); expect(dir(csp, 'connect-src')).toContain('https://gmail.googleapis.com');
    expect(dir(csp, 'frame-src')).toContain('https://accounts.google.com/gsi/'); expect(dir(csp, 'style-src')).toContain('https://accounts.google.com/gsi/style');
    expect(adm['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
    for (const p of PAGES.filter((x) => x !== '/admin.html')) { const c = headersFor(p)['Content-Security-Policy']; expect(c, p).not.toMatch(/accounts\.google\.com|gmail\.googleapis/); expect(headersFor(p)['Cross-Origin-Opener-Policy']).toBe('same-origin'); }
  });
  it('reCAPTCHA Enterprise (App Check) için gerekli alanlar açık', () => {
    const csp = headersFor('/hekim.html')['Content-Security-Policy'];
    expect(dir(csp, 'script-src')).toEqual(expect.arrayContaining(['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'])); expect(dir(csp, 'frame-src')).toContain('https://www.google.com/recaptcha/');
  });
  it('kaynak haritası yayınlanmaz', () => { expect(cfg.hosting.ignore).toContain('**/*.map'); expect(readFileSync(resolve(root, 'vite.config.ts'), 'utf8')).toMatch(/sourcemap:\s*false/); });
});

describe('HTML kaynakları CSP ile uyumlu (satır içi betik/stil/olay yok)', () => {
  for (const f of ['index.html', 'hekim.html', 'teknisyen.html', 'gelen-isler.html', 'admin.html']) {
    it(f, () => {
      const html = readFileSync(resolve(root, f), 'utf8');
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      for (const [, attrs, body] of scripts) { expect(body.trim(), 'satır içi betik').toBe(''); expect(attrs).toMatch(/\bsrc=/); }
      expect(html).not.toMatch(/<style\b/i); expect(html).not.toMatch(/\son[a-z]+\s*=/i); expect(html).not.toMatch(/\sstyle\s*=/i); expect(html).not.toMatch(/javascript:/i);
      for (const [, attrs] of scripts) { const src = /src="([^"]+)"/.exec(attrs)![1]; expect(/^\/src\//.test(src) || /^https:\/\/accounts\.google\.com\/gsi\/client$/.test(src), src).toBe(true); }
    });
  }
});
