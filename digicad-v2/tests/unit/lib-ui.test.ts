// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { modal, errMsg, guard, withBusy, table, field, input, select } from '../../src/lib/ui';
import { h } from '../../src/lib/dom';

describe('ui', () => {
  it('modal Escape ile kapanır ve onClose bir kez çağrılır', () => {
    const onClose = vi.fn(); const m = modal('Başlık', 'gövde', null, onClose);
    expect(document.querySelector('.modal-back')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(document.querySelector('.modal-back')).toBeNull();
    m.close(); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('modal gövdesi HTML olarak yorumlanmaz', () => { modal('<img src=x onerror=1>', '<script>1</script>'); expect(document.querySelector('.modal img, .modal script')).toBeNull(); expect(document.querySelector('.modal-h b')!.textContent).toContain('<img'); document.querySelector('.modal-back')!.remove(); });
  it('errMsg Firebase kodlarını Türkçeleştirir', () => { expect(errMsg({ code: 'permission-denied' })).toMatch(/yetki/); expect(errMsg(new Error('x'))).toBe('x'); expect(errMsg('düz')).toBe('düz'); });
  it('guard hatayı toast olarak gösterir ve false döner', async () => {
    expect(await guard(() => Promise.reject(new Error('<b>bad</b>')))).toBe(false);
    const t = document.querySelector('#toasts .toast.err'); expect(t!.textContent).toBe('<b>bad</b>'); expect(t!.querySelector('b')).toBeNull();
  });
  it('withBusy düğmeyi işlem boyunca kilitler (çift gönderim yok)', async () => {
    const b = h('button', null, 'Gönder'); let resolve!: () => void; const fn = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const p = withBusy(b, fn); expect(b.disabled).toBe(true); resolve(); expect(await p).toBe(true); expect(b.disabled).toBe(false); expect(fn).toHaveBeenCalledTimes(1);
  });
  it('table değerleri metin olarak çizer; boşken mesaj gösterir', () => {
    const t = table([{ head: 'A', cell: (r: { a: string }) => r.a }], [{ a: '<i>x</i>' }]); expect(t.querySelector('i')).toBeNull(); expect(t.textContent).toContain('<i>x</i>');
    expect(table([{ head: 'A', cell: () => '' }], [], 'boş').textContent).toBe('boş');
  });
  it('field/input/select', () => { const i = input('n', 'text', '<x>'); expect(i.value).toBe('<x>'); const s = select('s', [['a', 'A'], ['b', 'B']], 'b'); expect(s.value).toBe('b'); expect(field('L', i).querySelector('span')!.textContent).toBe('L'); });
});
