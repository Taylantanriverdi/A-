// Kodla çizilmiş inline SVG ikonlar (currentColor + birkaç sabit sıcak ton).
const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((a) => {
    const r = (a * Math.PI) / 180;
    const x1 = 12 + Math.cos(r) * 7.2, y1 = 12 + Math.sin(r) * 7.2;
    const x2 = 12 + Math.cos(r) * 9.6, y2 = 12 + Math.sin(r) * 9.6;
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  })
  .join('');

const sunBody = `<circle cx="12" cy="12" r="4.4" fill="#f7c65a" stroke="#f7c65a"/><path d="${SUN_RAYS}" stroke="#f7c65a"/>`;
const moonBody = `<path d="M15.8 15.6A6.6 6.6 0 0 1 9.2 6a6.8 6.8 0 1 0 8.6 9.1 6.6 6.6 0 0 1-2 .5z" fill="#dfe6ff" stroke="#dfe6ff" stroke-width="1.2"/>`;
const cloudPath = 'M7.2 18.5h9.6a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.1 3.1 3.1 0 0 0-.4 6.1z';
const cloudFill = (dy = 0) =>
  `<path transform="translate(0 ${dy})" d="${cloudPath}" fill="rgba(235,238,248,0.92)" stroke="rgba(235,238,248,0.92)" stroke-width="1"/>`;
const cloudDark = (dy = 0) =>
  `<path transform="translate(0 ${dy})" d="${cloudPath}" fill="#9aa3b8" stroke="#9aa3b8" stroke-width="1"/>`;

export const WEATHER_ICON = {
  clear: (night) => svg(night ? moonBody : sunBody),
  cloudy: (night) =>
    svg(
      `<g transform="translate(4 -4) scale(.62)">${night ? moonBody : sunBody}</g>${cloudFill(1)}`
    ),
  rain: () =>
    svg(`${cloudFill(-3)}<path d="M8.5 18.5l-1 2.6M12.5 18.5l-1 2.6M16.5 18.5l-1 2.6" stroke="#8cc8ff" stroke-width="1.7"/>`),
  storm: () =>
    svg(`${cloudDark(-3)}<path d="M12.6 15.2l-2.4 3.9h2.6l-1.6 3.6 4-5h-2.7l1.4-2.5z" fill="#f2b84b" stroke="#f2b84b" stroke-width="1"/>`),
  snow: () =>
    svg(`${cloudFill(-3)}<g stroke="#ffffff" stroke-width="1.5"><path d="M8 18.6v3M6.7 19.4l2.6 1.4M6.7 20.8l2.6-1.4"/><path d="M15.5 18.6v3M14.2 19.4l2.6 1.4M14.2 20.8l2.6-1.4"/></g>`),
  fog: () =>
    svg(`<path d="M4 8.5h13M6.5 12h14M3.5 15.5h12M7 19h11" stroke="rgba(225,230,240,0.9)" stroke-width="2"/>`),
};

export const ICON = {
  pause: svg('<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>'),
  play: svg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>'),
  fast: svg('<path d="M3.5 6.2v11.6a.7.7 0 0 0 1.1.6l8.3-5.8a.7.7 0 0 0 0-1.2L4.6 5.6a.7.7 0 0 0-1.1.6zM12 6.2v11.6a.7.7 0 0 0 1.1.6l8.3-5.8a.7.7 0 0 0 0-1.2l-8.3-5.8a.7.7 0 0 0-1.1.6z" fill="currentColor" stroke="none"/>'),
  faster: svg('<path d="M2 7v10a.6.6 0 0 0 .95.5L9.6 12.5a.6.6 0 0 0 0-1L2.95 6.5A.6.6 0 0 0 2 7zM9.4 7v10a.6.6 0 0 0 .95.5L17 12.5a.6.6 0 0 0 0-1l-6.65-5A.6.6 0 0 0 9.4 7z" fill="currentColor" stroke="none"/><rect x="18.6" y="6.2" width="2.8" height="11.6" rx="1" fill="currentColor" stroke="none"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  moonSmall: svg(moonBody),
  sunSmall: svg(sunBody),
  bed: svg('<path d="M3 18V7M3 14h18v4M21 14v-2.5a2.5 2.5 0 0 0-2.5-2.5H11v5"/><circle cx="7" cy="11" r="1.8"/>'),
  coin: svg('<circle cx="12" cy="12" r="8.2" fill="#f2b84b" stroke="#c98a22" stroke-width="1.4"/><circle cx="12" cy="12" r="5.6" stroke="#fff2c8" stroke-width="1.1" opacity=".7"/>'),
  bag: svg('<path d="M6 9h12l-.8 10.2A2 2 0 0 1 15.2 21H8.8a2 2 0 0 1-2-1.8z" fill="currentColor" fill-opacity=".2"/><path d="M9 9V7.5a3 3 0 0 1 6 0V9"/><path d="M9.5 13.5h5"/>'),
  stall: svg('<path d="M3.5 9.5L5 4.5h14l1.5 5" fill="currentColor" fill-opacity=".2"/><path d="M3.5 9.5c0 1.4 1.1 2.2 2.4 2.2s2.3-.8 2.3-2.2c0 1.4 1.2 2.2 2.4 2.2S13 10.9 13 9.5c0 1.4 1.1 2.2 2.3 2.2s2.4-.8 2.4-2.2c0 1.4 1 2.2 2.4 2.2s.4 0 .4 0"/><path d="M5 12v8.5h14V12M9 20.5v-4.5h6v4.5"/>'),
  shop: svg('<path d="M4 7.5h16l-1.6 7.2a2 2 0 0 1-2 1.6H8.2a2 2 0 0 1-2-1.6z" fill="currentColor" fill-opacity=".2"/><path d="M4 7.5L3 4H1.8M9 19.5h.01M16 19.5h.01" stroke-width="2.2"/><path d="M9.5 11h5"/>'),
  leaf: svg('<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" fill="#8fd16a" stroke="#2f5a1c" stroke-width="1.4"/><path d="M5.5 18.5L13 11" stroke="#2f5a1c" stroke-width="1.3"/>'),
  lock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 14.2v2.4"/>'),
  minus: svg('<path d="M6 12h12" stroke-width="2.2"/>'),
  plus: svg('<path d="M6 12h12M12 6v12" stroke-width="2.2"/>'),
  trophy: svg('<path d="M8 4.5h8v5a4 4 0 0 1-8 0z" fill="currentColor" fill-opacity=".25"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5"/>'),
  chart: svg('<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12.5 16V8M17 16v-6" stroke-width="2.4"/><path d="M7 8.5l4-3 3 2 5-4" stroke-width="1.5"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
};

// Alet ikonları (araç çubuğu) — currentColor; aktif düğmede koyu, pasifte krem.
export const TOOL_ICON = {
  hand: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5" stroke-width="2.6"/><path d="M8 8.6a3.2 3.2 0 0 1 2.6-1.4" opacity=".6"/>'),
  hoe: svg('<path d="M5 20.5L15.5 10" stroke-width="2.2"/><path d="M13.2 7.6l3.6-3.4c.8-.7 2-.6 2.6.2l1.5 1.8c.6.8.4 1.9-.4 2.4l-4.3 2.8z" fill="currentColor" fill-opacity=".25"/><path d="M14 9l3 3"/>'),
  seed: svg('<path d="M12 21v-7"/><path d="M12 14c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z" fill="currentColor" fill-opacity=".25"/><path d="M12 15.5c0-3-2.3-5-5.5-5 0 3 2.3 5 5.5 5z" fill="currentColor" fill-opacity=".25"/><path d="M6 21h12"/>'),
  water: svg('<path d="M4.5 10h11v7.5a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5z" fill="currentColor" fill-opacity=".22"/><path d="M15.5 12.5l4.5-4M20 8.5l1.6 1.6M7.5 10V8a2.5 2.5 0 0 1 5 0v2"/><path d="M20.6 13.6v.01M19 16v.01M21.6 17.2v.01" stroke-width="2.4"/>'),
  fertilize: svg('<path d="M6.5 8c0-1.5 1.5-2.5 5.5-2.5s5.5 1 5.5 2.5l1 11c0 1.4-2.5 2-6.5 2s-6.5-.6-6.5-2z" fill="currentColor" fill-opacity=".22"/><path d="M7 8.3c1.5.8 3.2 1.1 5 1.1s3.5-.3 5-1.1"/><path d="M12 17.5c-2.2 0-3-1.5-3-3 1.6 0 3 .9 3 3zm0 0c0-2.2 1.4-3.6 3.2-3.6 0 2.1-1.2 3.6-3.2 3.6z"/>'),
  treat: svg('<path d="M9 4.5h4v3H9zM13 5.5h3.5l-.8 1.6"/><path d="M8.5 7.5h5l1.5 2.5v9.5A1.5 1.5 0 0 1 13.5 21h-5A1.5 1.5 0 0 1 7 19.5V10z" fill="currentColor" fill-opacity=".22"/><path d="M18.5 4.5v.01M20.5 6.5v.01M18.8 8.4v.01" stroke-width="2.3"/>'),
  weed: svg('<path d="M12 13.5V4"/><path d="M12 9c-1.5-2.5-4-3-6-2.5.5 2.5 3 3.5 6 2.5zM12 7.5c1.5-2.5 4-3 6-2.5-.5 2.5-3 3.5-6 2.5z" fill="currentColor" fill-opacity=".25"/><path d="M12 13.5c-1 2-3 3-5 3M12 13.5c0 2.5.5 4.5 2 6M12 13.5c1.5 1.5 3.5 2 5.5 1.5"/><path d="M4 20.5h16" opacity=".55" stroke-dasharray="1.5 2.2"/>'),
  harvest: svg('<path d="M3.5 11h17l-1.8 8.2a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6z" fill="currentColor" fill-opacity=".22"/><path d="M7.5 11c0-3.5 2-6 4.5-6s4.5 2.5 4.5 6"/><path d="M9 14.5v3.5M12 14.5v3.5M15 14.5v3.5"/>'),
  chevron: svg('<path d="M7 14l5-5 5 5"/>'),
  spark: svg('<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" fill="currentColor" stroke="none"/>'),
  bug: svg('<ellipse cx="12" cy="13.5" rx="4.2" ry="5.5" fill="currentColor" fill-opacity=".25"/><path d="M12 8V19M9.5 6.5L8 4.5M14.5 6.5L16 4.5M7.8 11H4.5M7.8 15H4.8M16.2 11h3.3M16.2 15h3"/>'),
  drop: svg('<path d="M12 3.5c3.5 4.5 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.5-6.3 6-10.8z" fill="currentColor" fill-opacity=".25"/>'),
  alert: svg('<path d="M12 4l9 15.5H3z" fill="currentColor" fill-opacity=".2"/><path d="M12 10v4M12 17v.01" stroke-width="2.2"/>'),
  clock: svg('<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".18"/><path d="M12 7.5V12l3 2"/>'),
  calendar: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="2.2" fill="currentColor" fill-opacity=".18"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M12 13.5v3.2M12 16.7l2-1.4"/>'),
  grass: svg('<path d="M4 20h16"/><path d="M7 20c0-3-1-5-2.5-6.5M10 20c0-4 .5-7 2-9.5M13.5 20c0-3.5 1-6 3-8M17 20c0-2 .8-3.6 2-4.6"/>'),
};
