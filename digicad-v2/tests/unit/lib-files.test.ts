import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn() }));
import { validateFile, matchesMagic } from '../../src/lib/files';

const f = (name: string, size: number, type: string) => ({ name, size, type });
const MB = 1024 * 1024;

describe('validateFile', () => {
  it('geçerli tarama dosyaları kabul edilir (boş MIME = octet-stream)', () => {
    expect(validateFile(f('a.stl', 5 * MB, ''), 200)).toBeNull();
    expect(validateFile(f('a.zip', 5 * MB, 'application/zip'), 200)).toBeNull();
    expect(validateFile(f('a.png', 5, 'image/png'), 200)).toBeNull();
    expect(validateFile(f('a.glb', 5, 'model/gltf-binary'), 200)).toBeNull();
  });
  it('boyut: kurallar `<` kullandığı için tam sınır reddedilir; boş dosya reddedilir', () => {
    expect(validateFile(f('a.stl', 200 * MB, ''), 200)).toMatch(/büyük/);
    expect(validateFile(f('a.stl', 200 * MB - 1, ''), 200)).toBeNull();
    expect(validateFile(f('a.stl', 0, ''), 200)).toMatch(/boş/);
  });
  it('etkin içerik/çalıştırılabilir uzantılar octet-stream olsa da reddedilir (çift uzantı dahil)', () => {
    for (const n of ['x.html', 'x.HTM', 'x.svg', 'x.js', 'x.exe', 'x.bat', 'x.sh', 'x.ps1', 'x.php', 'a.html.stl', 'x.jar', 'x.hta'])
      expect(validateFile(f(n, 10, 'application/octet-stream'), 200), n).toMatch(/uzantı/);
  });
  it('MIME beyaz listesi: html/js/svg türleri reddedilir', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload', 'text/plain'])
      expect(validateFile(f('x.dat', 10, t), 200), t).toMatch(/türüne/);
  });
  it('sohbet eki yalnızca görsel/PDF ve 25 MB altı (Storage chatType ile aynı)', () => {
    expect(validateFile(f('a.pdf', 10, 'application/pdf'), 25, 'chat')).toBeNull();
    expect(validateFile(f('a.zip', 10, 'application/zip'), 25, 'chat')).toMatch(/türüne/);
    expect(validateFile(f('a.stl', 10, ''), 25, 'chat')).toMatch(/türüne/);
    expect(validateFile(f('a.png', 30 * MB, 'image/png'), 25, 'chat')).toMatch(/büyük/);
  });
  it('hata iletisindeki dosya adı temizlenir', () => {
    expect(validateFile(f('../../x‮.exe', 10, ''), 200)).not.toMatch(/[\\/‮]/);
  });
});

describe('matchesMagic', () => {
  const b = (...x: number[]) => Uint8Array.from([...x, ...new Array(16).fill(0)]);
  it('png/jpeg/pdf/zip/webp imzaları', () => {
    expect(matchesMagic('image/png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesMagic('image/jpeg', b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesMagic('application/pdf', b(0x25, 0x50, 0x44, 0x46))).toBe(true);
    expect(matchesMagic('application/zip', b(0x50, 0x4b, 3, 4))).toBe(true);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(matchesMagic('image/webp', webp)).toBe(true);
  });
  it('uyuşmayan içerik reddedilir (HTML, png diye yüklenirse)', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    for (const t of ['image/png', 'image/jpeg', 'application/pdf', 'application/zip', 'image/webp']) expect(matchesMagic(t, html), t).toBe(false);
  });
  it('bilinmeyen/ikili türlerde (STL vb.) engellemez', () => { expect(matchesMagic('application/octet-stream', new Uint8Array(4))).toBe(true); expect(matchesMagic('model/stl', new Uint8Array(4))).toBe(true); });
});
