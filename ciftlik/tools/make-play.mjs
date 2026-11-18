// make-play.mjs — claude.ai Artifact olarak yayınlanacak oynanabilir sürüm paketi (PLAN §9, engine-dev).
// Kullanım: npm run play  →  play/page.html (iskeletsiz sayfa gövdesi) + play/game.js (tek ES modülü paketi)
// vite build geçici klasöre alınır; tek chunk'a zorlanır, CSS satır içi <style> olur, tüm varlıklar data: URI.
import { build } from 'vite';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'play');
const TITLE = 'Altın Saat Çiftliği';

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p))); else out.push(p);
  }
  return out;
}

/** index.html'deki data: favicon'u base64'e çevirir (içindeki xmlns URL'si sayfada düz metin kalmasın). */
async function faviconTag() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<link[^>]+rel="icon"[^>]+href="(data:[^"]+)"/i);
  if (!m) return '';
  const uri = m[1];
  const comma = uri.indexOf(',');
  const head = uri.slice(5, comma); // ör. image/svg+xml veya image/svg+xml;base64
  if (/;base64$/i.test(head)) return `<link rel="icon" href="${uri}">`;
  const mime = head.split(';')[0] || 'image/svg+xml';
  const b64 = Buffer.from(decodeURIComponent(uri.slice(comma + 1)), 'utf8').toString('base64');
  return `<link rel="icon" href="data:${mime};base64,${b64}">`;
}

const EXTERNAL_RE = /\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i;

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), 'ciftlik-play-'));
  try {
    await build({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.js'),
      logLevel: 'warn',
      esbuild: { legalComments: 'eof' }, // lisans yorumları dosya sonunda tekilleşir (boyut)
      build: {
        outDir: tmp,
        emptyOutDir: true,
        copyPublicDir: false,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER, // tüm varlıklar data: URI
        modulePreload: false,
        reportCompressedSize: false,
        rollupOptions: {
          output: {
            inlineDynamicImports: true, // yalnızca bu derlemede: tek JS dosyası
            entryFileNames: 'game.js',
            assetFileNames: 'assets/[name][extname]',
          },
        },
      },
    });

    const files = await listFiles(tmp);
    const js = files.filter((f) => f.endsWith('.js'));
    const css = files.filter((f) => f.endsWith('.css'));
    const other = files.filter((f) => !/\.(js|css|html)$/.test(f));
    if (js.length !== 1) throw new Error(`tek JS paketi bekleniyordu, bulunan: ${js.length} (${js.join(', ')})`);
    if (other.length) throw new Error(`satır içine alınamayan varlık(lar): ${other.join(', ')}`);

    let gameJs = await readFile(js[0], 'utf8');
    if (/\bimport\s*\(\s*["'`]\.|from\s*["']\.\//.test(gameJs)) throw new Error('game.js göreli import içeriyor (tek dosya değil)');
    let cssText = '';
    for (const f of css) cssText += (await readFile(f, 'utf8')).trim() + '\n';
    cssText = cssText.replace(/<\/style/gi, '<\\/style');
    if (/url\(\s*["']?(?!data:)[^)"']+/i.test(cssText)) throw new Error('CSS harici url() içeriyor');

    const page = `<title>${TITLE}</title>
<meta name="theme-color" content="#0b1026">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${await faviconTag()}
<style>
:root{color-scheme:dark}
html,body{margin:0;height:100%;background:#05060c;overflow:hidden;touch-action:none;overscroll-behavior:none}
#game{position:fixed;inset:0}
#ui{position:fixed;inset:0;pointer-events:none}
#play-loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#f5ecd9;font:16px Georgia,"Times New Roman",serif;letter-spacing:.04em;opacity:.85;pointer-events:none;z-index:1}
#game:has(canvas)~#play-loading{display:none}
</style>
<style>
${cssText}</style>
<div id="game"></div>
<div id="ui"></div>
<div id="play-loading">Çiftlik yükleniyor…</div>
<script>
(function(){var g=document.getElementById('game'),l=document.getElementById('play-loading');if(!g||!l)return;
function c(){if(g.querySelector('canvas')){l.remove();o.disconnect();}}var o=new MutationObserver(c);o.observe(g,{childList:true,subtree:true});c();})();
</script>
<script type="module" src="game.js"></script>
`;

    if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(page)) throw new Error('page.html iskelet etiketi içeriyor');
    if (EXTERNAL_RE.test(page)) throw new Error(`page.html harici URL içeriyor: ${page.match(EXTERNAL_RE)[0]}`);

    if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    const pagePath = join(OUT, 'page.html');
    const jsPath = join(OUT, 'game.js');
    await writeFile(pagePath, page, 'utf8');
    await writeFile(jsPath, gameJs, 'utf8');
    gameJs = null;

    const kb = async (p) => `${((await stat(p)).size / 1024).toFixed(1)} KB`;
    console.log('Oynanabilir sürüm hazır:');
    console.log(`  ${pagePath}  ${await kb(pagePath)}`);
    console.log(`  ${jsPath}  ${await kb(jsPath)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('[make-play] başarısız:', e && e.message ? e.message : e);
  process.exit(1);
});
