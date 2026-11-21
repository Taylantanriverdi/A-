// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytesResumable: vi.fn(), getDownloadURL: vi.fn() }));
import { fileChips, stageStepper, tabBar, empty } from '../../src/lib/widgets';
import { h } from '../../src/lib/dom';

const host = (c: unknown) => h('div', null, c as Node);
describe('widgets', () => {
  it('fileChips: path → düğme, eski url → güvenli bağlantı; javascript: URL ve HTML adı etkisiz', () => {
    const el = host(fileChips([{ name: '<img src=x onerror=1>', path: 'labs/x/a.stl', size: 2048 }, { name: 'eski', url: 'javascript:alert(1)' }, { name: 'ok', url: 'https://ok.example/a' }]));
    expect(el.querySelectorAll('button').length).toBe(1); expect(el.querySelector('img')).toBeNull();
    const links = [...el.querySelectorAll('a')]; expect(links[0].getAttribute('href')).toBe('#'); expect(links[1].getAttribute('href')).toBe('https://ok.example/a'); expect(links[1].rel).toContain('noopener');
    expect(el.textContent).toContain('2 KB');
  });
  it('fileChips boş/geçersiz girdi', () => { expect(host(fileChips(undefined)).textContent).toBe('—'); expect(host(fileChips('x', 'yok')).textContent).toBe('yok'); });
  it('stageStepper aşamayı işaretler', () => {
    const el = stageStepper('production', 'Üretimde'); expect(el.querySelector('.step.cur')!.getAttribute('data-stage')).toBe('production'); expect(el.querySelectorAll('.step.done').length).toBe(1);
    expect(stageStepper('done').querySelectorAll('.step.done').length).toBe(2);
  });
  it('tabBar tıklamada id verir', () => { const f = vi.fn(); const el = tabBar([['a', 'A'], ['b', 'B']], 'a', f); (el.querySelectorAll('button')[1] as HTMLButtonElement).click(); expect(f).toHaveBeenCalledWith('b'); expect(el.querySelector('.active')!.textContent).toBe('A'); });
  it('empty', () => { expect(empty('x').textContent).toBe('x'); });
});
