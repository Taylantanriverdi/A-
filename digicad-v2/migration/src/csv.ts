import { appendFileSync, openSync, closeSync, fchmodSync, fstatSync, chmodSync } from 'node:fs';

/** 0600 izinli dosyaya ekler (asla ezmez); dosya yeni/boşsa önce başlık yazılır. */
export function secureAppend(path: string, text: string, header?: string): void {
  const fd = openSync(path, 'a', 0o600);
  try { fchmodSync(fd, 0o600); if (header && fstatSync(fd).size === 0) appendFileSync(fd, header); appendFileSync(fd, text); } finally { closeSync(fd); }
  chmodSync(path, 0o600);
}
/** CSV hücresi; elektronik tablo formül enjeksiyonuna (=,+,-,@) karşı kesme işareti ekler. */
export const csvCell = (s: string): string => { const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return `"${t.replace(/"/g, '""')}"`; };
