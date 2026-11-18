// Çırak portresi — baş-omuz SVG (string). Sahnedeki karakterle aynı tarif (PLAN §11): yana taranmış koyu kahverengi saç, kalın koyu kaşlar,
// iri kahverengi gözler, açık buğday ten, pembe yanaklar, hafif yana çekik gülümseme, gri-lacivert-lila kamuflaj kapüşonlu sweatshirt,
// göğüste kırmızı desen. Sıcak arka plan dairesi. Harici dosya yok; id'ler çağrı başına benzersizdir (aynı sayfada birden çok portre güvenli).
let seq = 0;

/** @param {number} [size] piksel (kare) @returns {string} SVG işaretlemesi */
export function portraitSVG(size = 96) {
  const n = ++seq, id = (s) => `ptr${n}${s}`;
  const px = Math.max(8, Math.round(Number(size) || 96));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 96 96" role="img" aria-label="Çırak portresi">
<defs>
<radialGradient id="${id('bg')}" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#ffe3a8"/><stop offset="0.6" stop-color="#f0b868"/><stop offset="1" stop-color="#d98a4a"/></radialGradient>
<clipPath id="${id('clip')}"><circle cx="48" cy="48" r="46"/></clipPath>
<linearGradient id="${id('skin')}" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#f8dbb0"/><stop offset="0.55" stop-color="#edc99c"/><stop offset="1" stop-color="#cf9c6e"/></linearGradient>
<linearGradient id="${id('hair')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a3a26"/><stop offset="0.55" stop-color="#3a2216"/><stop offset="1" stop-color="#24130a"/></linearGradient>
<radialGradient id="${id('chk')}"><stop offset="0" stop-color="#f07878" stop-opacity="0.55"/><stop offset="1" stop-color="#f07878" stop-opacity="0"/></radialGradient>
<radialGradient id="${id('iris')}" cx="0.5" cy="0.35" r="0.7"><stop offset="0" stop-color="#7a4a2a"/><stop offset="0.7" stop-color="#4a2c1a"/><stop offset="1" stop-color="#2a170e"/></radialGradient>
<linearGradient id="${id('shade')}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff4dc" stop-opacity="0.22"/><stop offset="0.25" stop-color="#fff4dc" stop-opacity="0"/><stop offset="0.7" stop-color="#0a0c1c" stop-opacity="0.04"/><stop offset="1" stop-color="#0a0c1c" stop-opacity="0.34"/></linearGradient>
<pattern id="${id('camo')}" width="30" height="30" patternUnits="userSpaceOnUse">
<rect width="30" height="30" fill="#7d869b"/>
<ellipse cx="6" cy="7" rx="7" ry="4" fill="#27325a" transform="rotate(-20 6 7)"/><ellipse cx="22" cy="5" rx="5" ry="3" fill="#a99bd6" transform="rotate(30 22 5)"/>
<ellipse cx="15" cy="16" rx="6" ry="3.4" fill="#c5c9d4" transform="rotate(10 15 16)"/><ellipse cx="4" cy="22" rx="5" ry="3" fill="#a99bd6" transform="rotate(-40 4 22)"/>
<ellipse cx="25" cy="21" rx="6.5" ry="3.6" fill="#1d2548" transform="rotate(25 25 21)"/><ellipse cx="14" cy="27" rx="4.5" ry="2.6" fill="#4d5a86"/>
<ellipse cx="28" cy="12" rx="3.4" ry="2.2" fill="#4d5a86"/><ellipse cx="9" cy="14" rx="3" ry="2" fill="#4d5a86"/>
</pattern>
</defs>
<circle cx="48" cy="48" r="46" fill="url(#${id('bg')})"/>
<g clip-path="url(#${id('clip')})">
<ellipse cx="48" cy="52" rx="40" ry="40" fill="#fff3d0" opacity="0.12"/>
<!-- kapüşon (boyun arkası) -->
<ellipse cx="48" cy="70" rx="23" ry="9" fill="url(#${id('camo')})"/><ellipse cx="48" cy="70" rx="23" ry="9" fill="#0a0c1c" opacity="0.34"/>
<!-- omuzlar / gövde -->
<path d="M6 100 C8 80 24 71 38 68.5 L58 68.5 C72 71 88 80 90 100 Z" fill="url(#${id('camo')})"/>
<path d="M6 100 C8 80 24 71 38 68.5 L58 68.5 C72 71 88 80 90 100 Z" fill="url(#${id('shade')})"/>
<path d="M40 68.5 C44 74 52 74 56 68.5" fill="none" stroke="#566083" stroke-width="3" stroke-linecap="round"/>
<!-- göğüste kırmızı desen -->
<g fill="#e0323a"><rect x="39" y="81" width="4.6" height="10" rx="1.8"/><rect x="39" y="81" width="10" height="3.8" rx="1.8"/><rect x="50" y="81" width="4.4" height="10" rx="1.8"/><rect x="50" y="87.4" width="11" height="3.8" rx="1.8"/><circle cx="64.4" cy="89.4" r="2.2"/></g>
<rect x="39.6" y="81.4" width="9" height="1.2" rx="0.6" fill="#ffc8bd" opacity="0.5"/>
<!-- ip uçları -->
<path d="M42 71 L41.4 84 M54 71 L54.8 82" stroke="#d9dce6" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.9"/>
<ellipse cx="41.4" cy="85" rx="1.5" ry="1.9" fill="#aab0c4"/><ellipse cx="54.8" cy="83.4" rx="1.5" ry="1.9" fill="#aab0c4"/>
<!-- boyun -->
<path d="M40.5 56 L55.5 56 L56 70 C52 74 44 74 40 70 Z" fill="#cf9c6e"/><path d="M40.5 56 L55.5 56 L55.8 63 C51 66 45 66 40.3 63 Z" fill="#a8744c" opacity="0.4"/>
<!-- kulaklar -->
<ellipse cx="30.4" cy="45.6" rx="3.6" ry="5.2" fill="url(#${id('skin')})"/><ellipse cx="30.8" cy="46" rx="1.6" ry="2.8" fill="#c0705a" opacity="0.5"/>
<ellipse cx="65.6" cy="45.6" rx="3.6" ry="5.2" fill="#d9a87a"/><ellipse cx="65.2" cy="46" rx="1.6" ry="2.8" fill="#c0705a" opacity="0.45"/>
<!-- yüz -->
<path d="M30 42 C29 25 38.5 20 48 20 C58.5 20 67 26 66.5 42 C66 56 57 64.5 48 64.5 C39 64.5 30.6 56 30 42 Z" fill="url(#${id('skin')})"/>
<ellipse cx="38.4" cy="52" rx="7.6" ry="6.4" fill="url(#${id('chk')})"/><ellipse cx="58.2" cy="52" rx="7.6" ry="6.4" fill="url(#${id('chk')})"/>
<!-- gözler -->
<ellipse cx="40.2" cy="44.4" rx="4.6" ry="5.5" fill="#fbf6ee"/><ellipse cx="56.2" cy="44.4" rx="4.6" ry="5.5" fill="#fbf6ee"/>
<clipPath id="${id('eL')}"><ellipse cx="40.2" cy="44.4" rx="4.6" ry="5.5"/></clipPath><clipPath id="${id('eR')}"><ellipse cx="56.2" cy="44.4" rx="4.6" ry="5.5"/></clipPath>
<g clip-path="url(#${id('eL')})"><ellipse cx="41" cy="45.2" rx="3.6" ry="4.4" fill="url(#${id('iris')})"/><ellipse cx="41.1" cy="45.4" rx="2" ry="2.6" fill="#140a06"/><rect x="34" y="38.5" width="14" height="4.4" fill="#2a170e" opacity="0.32"/></g>
<g clip-path="url(#${id('eR')})"><ellipse cx="57" cy="45.2" rx="3.6" ry="4.4" fill="url(#${id('iris')})"/><ellipse cx="57.1" cy="45.4" rx="2" ry="2.6" fill="#140a06"/><rect x="50" y="38.5" width="14" height="4.4" fill="#2a170e" opacity="0.32"/></g>
<circle cx="39.4" cy="42.6" r="1.7" fill="#fff"/><circle cx="55.4" cy="42.6" r="1.7" fill="#fff"/><circle cx="42.4" cy="47.4" r="0.9" fill="#fff" opacity="0.8"/><circle cx="58.4" cy="47.4" r="0.9" fill="#fff" opacity="0.8"/>
<path d="M35.4 43.2 C36 39 44.4 38.4 45 43.2 M51.4 43.2 C52 38.4 60.4 39 61 43.2" fill="none" stroke="#2a1810" stroke-width="1.5" stroke-linecap="round"/>
<!-- kalın koyu kaşlar -->
<path d="M34.4 36.8 Q40 33.6 46.2 35.4" fill="none" stroke="#25150d" stroke-width="3.8" stroke-linecap="round"/><path d="M50.4 35.2 Q56.4 33.4 62 36.6" fill="none" stroke="#25150d" stroke-width="3.8" stroke-linecap="round"/>
<!-- burun -->
<ellipse cx="48.6" cy="52.4" rx="2.4" ry="1.7" fill="#b9754e" opacity="0.5"/><ellipse cx="48" cy="51.4" rx="1.2" ry="0.8" fill="#fff4dc" opacity="0.4"/>
<!-- gülümseme: sağa doğru hafif çekik -->
<path d="M40.4 57.6 Q47 61.8 55.8 56.4" fill="none" stroke="#9c4a3a" stroke-width="1.9" stroke-linecap="round"/>
<path d="M56.6 55.4 Q58.2 55.8 58.6 57.4" fill="none" stroke="#b9754e" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>
<path d="M43.6 59.2 Q48 61.6 53.4 58.4 Q48 60 43.6 59.2 Z" fill="#fff" opacity="0.85"/>
<!-- saç: kısa, yana taranmış, uçları dağınık -->
<path d="M28.4 44 C26.4 22 37 14.6 49 15 C60 15.4 68.6 22.6 67.4 38 L66 33.4 Q68.4 31.6 67.6 29.6 Q60 30.4 55 25.4 Q48 31 38 31.4 Q33.4 32 32.8 38.4 L31.8 49 Q29 47.6 28.4 44 Z" fill="url(#${id('hair')})"/>
<path d="M32 26 Q41 17.6 50 18.6 M36 30.4 Q50 25 62 21.6 M44 17.2 Q58 18 65 27" fill="none" stroke="#8a5a3a" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>
<path d="M66.6 29 L71.8 31 L66.4 35.4 Z M55 15.8 L58.6 13 L58.8 18.2 Z M28.8 38 L26 41.4 L29.2 42.6 Z" fill="#3a2216"/>
<path d="M30.6 38 Q29.8 24 40 18.2" fill="none" stroke="#fff0d8" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
</g>
</svg>`;
}
