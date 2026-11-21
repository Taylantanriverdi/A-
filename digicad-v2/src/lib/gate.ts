import { h, mount } from './dom';
import { login, logout, watchSession, changePassword, readSession, startTotpEnrollment, finishTotpEnrollment, hasMfa, type Session, type Role } from './auth';
import { field, input, guard, toast } from './ui';
import { auth } from './firebase';

const askCode = (): Promise<string> => new Promise((res) => {
  const c = window.prompt('Kimlik doğrulayıcı uygulamasındaki 6 haneli kodu girin:') ?? '';
  res(c.trim());
});

function loginView(root: HTMLElement, title: string): void {
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const pw = (form.elements.namedItem('password') as HTMLInputElement).value;
    void guard(() => login(email, pw, askCode));
  } } },
  h('h1', null, title), field('E-posta', input('email', 'email', '', { autocomplete: 'username', required: true })),
  field('Şifre', input('password', 'password', '', { autocomplete: 'current-password', required: true })),
  h('button', { class: 'btn primary', type: 'submit' }, 'Giriş yap'));
  mount(root, form);
}

function passwordView(root: HTMLElement, onDone: () => void): void {
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const pw = (form.elements.namedItem('pw') as HTMLInputElement).value;
    void guard(async () => { await changePassword(pw); onDone(); }, 'Şifre güncellendi');
  } } }, h('h1', null, 'Şifrenizi değiştirin'), h('p', { class: 'muted' }, 'İlk giriş: geçici şifre yerine en az 10 karakterli yeni şifre belirleyin.'),
  field('Yeni şifre', input('pw', 'password', '', { autocomplete: 'new-password', minlength: 10, required: true })), h('button', { class: 'btn primary', type: 'submit' }, 'Kaydet'));
  mount(root, form);
}

async function mfaEnrollView(root: HTMLElement, s: Session): Promise<void> {
  const { secret, otpauth } = await startTotpEnrollment(s.user);
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const code = (form.elements.namedItem('code') as HTMLInputElement).value.trim();
    void guard(async () => { await finishTotpEnrollment(s.user, secret, code); toast('Çok faktörlü doğrulama etkin. Lütfen yeniden giriş yapın.'); await logout(); }, undefined);
  } } },
  h('h1', null, 'Çok faktörlü doğrulama kurulumu'),
  h('p', null, 'Yönetici hesapları için zorunludur. Kimlik doğrulayıcı uygulamanızda (Google Authenticator, vb.) yeni hesap ekleyin:'),
  h('p', null, 'Gizli anahtar: ', h('code', null, secret.secretKey)),
  h('p', { class: 'muted' }, 'Ya da bu bağlantıyı uygulamada açın: ', h('code', { class: 'wrap' }, otpauth)),
  field('Uygulamadaki 6 haneli kod', input('code', 'text', '', { inputmode: 'numeric', pattern: '[0-9]{6}', required: true })),
  h('button', { class: 'btn primary', type: 'submit' }, 'Etkinleştir'));
  mount(root, form);
}

/** Sayfa girişi: oturum + rol denetimi. Yetkisiz rolde sayfa açılmaz. */
export function gate(allowed: Role[], title: string, start: (s: Session, root: HTMLElement) => void): void {
  const root = document.getElementById('app') as HTMLElement;
  let started: string | null = null;
  watchSession(async (s, u) => {
    if (!u) { started = null; loginView(root, title); return; }
    if (!s) { mount(root, h('div', { class: 'card login' }, h('h1', null, 'Hesap yetkisiz'), h('p', null, 'Hesabınıza henüz rol atanmamış. Laboratuvar yöneticisiyle görüşün.'), h('button', { class: 'btn', on: { click: () => void logout() } }, 'Çıkış'))); return; }
    if (!allowed.includes(s.role)) { mount(root, h('div', { class: 'card login' }, h('h1', null, 'Bu sayfaya erişiminiz yok'), h('p', null, `Rolünüz: ${s.role}.`), h('button', { class: 'btn', on: { click: () => void logout() } }, 'Çıkış'))); return; }
    if (s.mustChangePassword) { passwordView(root, () => { started = null; void readSession(auth.currentUser!, true).then((n) => n && start(n, root)); }); return; }
    if (s.role === 'admin' && !hasMfa(u)) { await mfaEnrollView(root, s); return; }
    if (started === s.user.uid) return;
    started = s.user.uid;
    start(s, root);
  });
}
