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
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
};
