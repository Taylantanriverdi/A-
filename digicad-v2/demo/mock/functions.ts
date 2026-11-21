/** DEMO — `firebase/functions` taklidi: sahte ama başarılı yanıtlar. */
export const getFunctions = (): object => ({});
export const connectFunctionsEmulator = (): void => undefined;

const rnd = (n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const grab = (text: string, re: RegExp): string => (text.match(re)?.[1] ?? '').trim();

/** Basit sahte ayrıştırma: "Hasta: …", "İş: …", "Diş: 11, 21", "Renk: A2", "Hekim: …" satırlarını okur. */
function parseOrderMail(text: string): Record<string, unknown> {
  const teeth = (grab(text, /di[şs]\w*\s*[:\-]\s*([0-9 ,;]+)/i).match(/\d{2}/g) ?? []).map(Number);
  return {
    doctorName: grab(text, /hekim\s*[:\-]\s*([^\n\r]+)/i), patient: (grab(text, /hasta\w*\s*[:\-]\s*([^\n\r,;]+)/i) || 'ÖRNEK HASTA').toLocaleUpperCase('tr-TR'),
    jobType: grab(text, /(?:i[şs]|tedavi)\s*(?:türü)?\s*[:\-]\s*([^\n\r]+)/i) || 'Zirkonyum Kron', color: grab(text, /renk\s*[:\-]\s*([A-Za-z0-9.]+)/i), teeth,
    notes: 'Demo: e-posta metninden otomatik ayrıştırıldı (taslak). Kaydetmeden önce kontrol edin.',
  };
}

const handlers: Record<string, (d: any) => unknown> = {
  adminCreateUser: (d) => ({ uid: `demo-${rnd(10)}`, email: String(d?.email ?? ''), tempPassword: `Demo-${rnd(4)}-${rnd(4)}9` }),
  adminResetPassword: () => ({ tempPassword: `Demo-${rnd(4)}-${rnd(4)}9` }),
  adminDisableUser: () => ({ ok: true }),
  clearMustChangePassword: () => ({ ok: true }),
  copyJobFiles: (d) => ({ jobId: d?.jobId, copied: 1, failed: 0 }),
  parseOrderMail: (d) => parseOrderMail(String(d?.text ?? '')),
};
export const httpsCallable = (_f: unknown, name: string) => async (data?: unknown): Promise<{ data: unknown }> => {
  await new Promise((r) => setTimeout(r, 150));
  const h = handlers[name]; return { data: h ? h(data) : { ok: true } };
};
