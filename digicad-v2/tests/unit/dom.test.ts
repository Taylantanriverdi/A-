// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h, safeUrl, safeFileName, mount, link } from '../../src/lib/dom';

describe('h() XSS koruması', () => {
  const evil = `x');alert(1)//`;
  it('eski açık: dosya adı metin olarak çizilir, öznitelik/olay üretmez', () => {
    const el = h('div', null, h('button', null, `📎 ${evil}`));
    expect(el.innerHTML).not.toContain('onclick');
    expect(el.querySelector('button')!.textContent).toContain(evil);
    expect(el.querySelectorAll('script').length).toBe(0);
  });
  it('HTML etiketi içeren veri etiket olmaz', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(el.querySelector('img')).toBeNull(); expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
  it('on* ve style öznitelikleri reddedilir', () => {
    expect(() => h('div', { onclick: 'alert(1)' })).toThrow();
    expect(() => h('div', { onerror: 'x' })).toThrow();
    expect(() => h('div', { style: 'x' })).toThrow();
    expect(() => h('iframe', { srcdoc: '<script>' })).toThrow();
  });
  it('olaylar addEventListener ile bağlanır', () => {
    let n = 0; const b = h('button', { on: { click: () => { n++; } } }, 'x'); b.click(); expect(n).toBe(1); expect(b.getAttribute('onclick')).toBeNull();
  });
  it('javascript:/data: URL engellenir', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#'); expect(safeUrl(' JaVaScRiPt:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#'); expect(safeUrl('//evil.com')).toBe('#');
    expect(safeUrl('https://ok.example/a')).toBe('https://ok.example/a');
    expect(h('a', { href: 'javascript:alert(1)' }).getAttribute('href')).toBe('#');
    expect(link('javascript:1', 'x').rel).toContain('noopener');
  });
  it('dosya adı temizlenir', () => {
    expect(safeFileName('../../etc/passwd')).not.toContain('/'); expect(safeFileName('a\u0000b\\c')).toBe('a_b_c'); expect(safeFileName('')).toBe('dosya');
  });
  it('mount eski içeriği temizler; null/false atlanır', () => {
    const r = h('div', null, 'eski'); mount(r, null, false, 'yeni', 0); expect(r.textContent).toBe('yeni0');
  });
  it('tehlikeli etiketler üretilemez', () => {
    for (const t of ['script', 'iframe', 'style', 'object', 'embed', 'base', 'meta', 'link']) expect(() => h(t as 'div')).toThrow();
  });
  it('geçersiz öznitelik adı (enjeksiyon) reddedilir; srcdoc/is/xmlns yasak', () => {
    expect(() => h('div', { 'a b=1 onload': 'x' })).toThrow();
    expect(() => h('div', { '"><img src=x': 'x' })).toThrow();
    expect(() => h('iframe' as 'div', { srcdoc: '<script>1</script>' })).toThrow();
    expect(() => h('div', { srcdoc: 'x' })).toThrow(); expect(() => h('div', { is: 'x-y' })).toThrow(); expect(() => h('svg' as 'div', { xmlns: 'x' })).toThrow();
    expect(h('div', { 'data-id': 5, 'aria-label': 'a' }).getAttribute('data-id')).toBe('5');
  });
  it('safeUrl: ters eğik çizgi / sekme ile protokol-göreli açık yönlendirme engellenir', () => {
    for (const u of ['/\\evil.com', '/\t/evil.com', '\\\\evil.com', '//evil.com', 'java\nscript:alert(1)', 'JAVASCRIPT:1', 'vbscript:x', 'data:text/html,x', 'file:///etc/passwd', 'blob:javascript:1', 'https://', 'https:evil.com', ' https://a b'])
      expect(safeUrl(u), u).toBe('#');
    for (const u of ['https://firebasestorage.googleapis.com/v0/b/x/o/a%20b?alt=media&token=1', '/admin.html', './a', '../a', '#x', '?q=1', 'blob:https://app.example/uuid'])
      expect(safeUrl(u), u).toBe(u);
    expect(safeUrl(null)).toBe('#'); expect(safeUrl(5)).toBe('#'); expect(safeUrl('')).toBe('#');
  });
  it('diğer URL öznitelikleri de süzülür', () => {
    expect(h('video', { poster: 'javascript:1' }).getAttribute('poster')).toBe('#');
    expect(h('form', { action: 'javascript:1' }).getAttribute('action')).toBe('#');
    expect(h('button', { formaction: 'data:text/html,1' }).getAttribute('formaction')).toBe('#');
    expect(h('a', { HREF: 'javascript:1' }).getAttribute('href')).toBe('#');
  });
  it('target=_blank otomatik noopener noreferrer alır', () => {
    expect(h('a', { href: 'https://a.example', target: '_blank' }).getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('safeFileName: yön değiştirme/sıfır genişlikli karakterler ve gizli dosya noktası temizlenir', () => {
    expect(safeFileName('gpj.‮txt')).not.toMatch(/‮/); expect(safeFileName('a​b')).toBe('a_b'); expect(safeFileName('.htaccess')).toBe('_htaccess');
    expect(safeFileName('x'.repeat(500)).length).toBe(180); expect(safeFileName(undefined)).toBe('dosya'); expect(safeFileName('   ')).toBe('dosya');
  });
  it('olay dinleyicisi on ile bağlanır ve çalışır', () => {
    let n = 0; const b = h('button', { on: { click: () => { n++; } } }, 'x'); b.click(); expect(n).toBe(1);
  });
});
