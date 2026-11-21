/** DEMO — `firebase/app` + `firebase/app-check` taklidi. İlk yüklemede demo ortamını (şerit, sahte ağ) kurar. */
import { installDemoEnv } from './env';

export function initializeApp(): { name: string; options: object } {
  installDemoEnv();
  document.getElementById('boot-fallback')?.remove(); // "program başlatılamadı" uyarısı demo'da gösterilmez
  return { name: '[DEMO]', options: {} };
}
export const getApp = (): { name: string } => ({ name: '[DEMO]' });

// app-check
export class ReCaptchaEnterpriseProvider { constructor(public siteKey: string) {} }
export class ReCaptchaV3Provider { constructor(public siteKey: string) {} }
export const initializeAppCheck = (): object => ({});
export const getToken = async (): Promise<{ token: string }> => ({ token: 'demo' });
export const getLimitedUseToken = async (): Promise<{ token: string }> => ({ token: 'demo' });
