import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ overrideConfigFile: new URL('../../eslint.config.js', import.meta.url).pathname, cwd: new URL('../..', import.meta.url).pathname });
const lint = async (code: string, file = 'src/pages/_x.ts') => (await eslint.lintText(code, { filePath: file }))[0].messages.filter((m) => m.severity === 2);

describe('ESLint güvenlik kuralları', () => {
  const bad: [string, string][] = [
    ['innerHTML ataması', "const e = document.body; e.innerHTML = 'x';"],
    ['innerHTML +=', "const e = document.body; e.innerHTML += 'x';"],
    ['outerHTML', "const e = document.body; e.outerHTML = 'x';"],
    ['köşeli parantezli innerHTML', "const e = document.body; e['innerHTML'] = 'x';"],
    ['srcdoc', "const e = document.body; (e as any).srcdoc = 'x';"],
    ['Object.assign innerHTML', "Object.assign(document.body, { innerHTML: 'x' });"],
    ['insertAdjacentHTML', "document.body.insertAdjacentHTML('beforeend', 'x');"],
    ['createContextualFragment', "document.createRange().createContextualFragment('x');"],
    ['document.write', "document.write('x');"],
    ['window.document.write', "window.document.write('x');"],
    ['document.writeln', "document.writeln('x');"],
    ['eval', "eval('1');"],
    ['window.eval', "window.eval('1');"],
    ['new Function', "new Function('return 1');"],
    ['Function()', "Function('return 1')();"],
    ['setTimeout(string)', "setTimeout('alert(1)', 10);"],
    ['setTimeout(template)', 'const a = 1; setTimeout(`x${a}`, 10);'],
    ['setInterval(string)', "setInterval('x()', 10);"],
    ['window.setTimeout(string)', "window.setTimeout('x()', 10);"],
    ['setAttribute onclick', "document.body.setAttribute('onclick', 'x');"],
    ['setAttribute style', "document.body.setAttribute('style', 'x');"],
    ['javascript: URL', "const u = 'javascript:alert(1)'; void u;"],
    ['h() onclick', "declare const h: any; h('a', { onclick: 'x' });"],
    ['h() style', "declare const h: any; h('a', { style: 'x' });"],
    ['execCommand insertHTML', "document.execCommand('insertHTML', false, 'x');"],
  ];
  for (const [name, code] of bad) it(`yasak: ${name}`, async () => { expect((await lint(code)).length, code).toBeGreaterThan(0); });

  it('güvenli kullanım temiz', async () => {
    expect(await lint("const e = document.createElement('div'); e.textContent = 'x'; setTimeout(() => e.remove(), 10); e.setAttribute('class', 'a');")).toEqual([]);
  });
  it('testlerde de eval/innerHTML yasak, ama h() ile yasaklı öznitelik denemesi serbest', async () => {
    expect((await lint("document.body.innerHTML = 'x';", 'tests/unit/a.test.ts')).length).toBeGreaterThan(0);
    expect((await lint("eval('1');", 'tests/unit/a.test.ts')).length).toBeGreaterThan(0);
    expect(await lint("declare const h: any; h('div', { onclick: 'x' });", 'tests/unit/a.test.ts')).toEqual([]);
  });
});
