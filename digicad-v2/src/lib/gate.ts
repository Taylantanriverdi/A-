import { h, mount } from './dom';
import { login, logout, watchSession, changePassword, readSession, claimsKey, reloadPage, startTotpEnrollment, finishTotpEnrollment, hasMfa, type Session, type Role } from './auth';
import { field, input, toast, modal, btn, errMsg, withBusy } from './ui';
import { isTotpCode, validatePassword } from './checks';
import { startIdleWatch, IDLE_LIMITS } from './idle';

const useEmu = import.meta.env.VITE_USE_EMULATORS === 'true';

/** Sayfa içi TOTP kodu isteme (window.prompt yerine; iptal edilirse giriş reddedilir). */
function askCode(): Promise<string> {
  return new Promise((res, rej) => {
    const code = input('code', 'text', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', 'aria-label': '6 haneli kod' });
    let done = false;
    const m = modal('İki adımlı doğrulama', h('div', null, h('p', { class: 'muted' }, 'Kimlik doğrulayıcı uygulamanızdaki 6 haneli kodu girin.'), field('Kod', code)),
      h('span', null, btn('İptal', () => m.close(), 'btn ghost'), btn('Doğrula', () => submit(), 'btn primary')), () => { if (!done) { done = true; rej(new Error('Doğrulama iptal edildi.')); } });
    function submit(): void { const c = code.value.trim(); if (!isTotpCode(c)) { toast('Kod 6 haneli olmalı.', 'err'); return; } done = true; m.close(); res(c); }
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    code.focus();
  });
}

function box(root: HTMLElement, ...kids: (Node | string)[]): void { mount(root, h('div', { class: 'card login' }, ...kids)); }
const signOutBtn = (label = 'Çıkış') => btn(label, () => void logout());

function loginView(root: HTMLElement, title: string): void {
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const pw = (form.elements.namedItem('password') as HTMLInputElement).value;
    void withBusy(submitBtn, () => login(email, pw, askCode));
  } } },
  h('h1', null, title), field('E-posta', input('email', 'email', '', { autocomplete: 'username', required: true })),
  field('Şifre', input('password', 'password', '', { autocomplete: 'current-password', required: true })));
  const submitBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Giriş yap');
  form.append(submitBtn);
  mount(root, form);
}

function passwordView(root: HTMLElement, onDone: () => void): void {
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const pw = (form.elements.namedItem('pw') as HTMLInputElement).value;
    const pw2 = (form.elements.namedItem('pw2') as HTMLInputElement).value;
    void withBusy(save, async () => {
      if (pw !== pw2) throw new Error('Şifreler aynı değil.');
      const bad = validatePassword(pw); if (bad) throw new Error(bad);
      await changePassword(pw); onDone();
    }, 'Şifre güncellendi');
  } } }, h('h1', null, 'Şifrenizi değiştirin'), h('p', { class: 'muted' }, 'İlk giriş: geçici şifre yerine en az 10 karakterli (harf + rakam/simge) yeni şifre belirleyin.'),
  field('Yeni şifre', input('pw', 'password', '', { autocomplete: 'new-password', minlength: 10, required: true })),
  field('Yeni şifre (tekrar)', input('pw2', 'password', '', { autocomplete: 'new-password', minlength: 10, required: true })));
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Kaydet');
  form.append(save, signOutBtn('Vazgeç'));
  mount(root, form);
}

async function mfaEnrollView(root: HTMLElement, s: Session): Promise<void> {
  let enr: Awaited<ReturnType<typeof startTotpEnrollment>>;
  try { enr = await startTotpEnrollment(s.user); } catch (e) {
    box(root, h('h1', null, 'Doğrulama kurulumu başlatılamadı'), h('p', null, errMsg(e)), h('p', { class: 'muted' }, 'Güvenlik için yeniden giriş yapmanız gerekebilir.'), signOutBtn('Çıkış ve yeniden giriş'));
    return;
  }
  const { secret, otpauth } = enr;
  const form = h('form', { class: 'card login', on: { submit: (e) => {
    e.preventDefault();
    const code = (form.elements.namedItem('code') as HTMLInputElement).value.trim();
    void withBusy(go, async () => { await finishTotpEnrollment(s.user, secret, code); toast('Çok faktörlü doğrulama etkin. Lütfen yeniden giriş yapın.'); await logout(); });
  } } },
  h('h1', null, 'Çok faktörlü doğrulama kurulumu'),
  h('p', null, 'Yönetici hesapları için zorunludur. Kimlik doğrulayıcı uygulamanızda (Google Authenticator, vb.) yeni hesap ekleyin:'),
  h('p', null, 'Gizli anahtar: ', h('code', { class: 'wrap' }, secret.secretKey)),
  h('p', { class: 'muted' }, 'Ya da bu bağlantıyı uygulamada açın: ', h('code', { class: 'wrap' }, otpauth)),
  field('Uygulamadaki 6 haneli kod', input('code', 'text', '', { inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code', required: true })));
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Etkinleştir');
  form.append(go, signOutBtn('Vazgeç'));
  mount(root, form);
}

/**
 * Sayfa girişi: oturum + rol denetimi. Yetkisiz rolde sayfa açılmaz.
 * (Asıl koruma Firestore/Storage kurallarıdır; arayüz onlarla tutarlı davranır.)
 *  - yönetici: TOTP kaydı zorunlu ve oturum ikinci faktörle açılmış olmalı
 *  - hekim/teknisyen: doctorId/techId claim'i zorunlu
 *  - ilk girişte şifre değişimi zorunlu
 *  - hareketsizlikte otomatik çıkış; rol/claim değişirse sayfa yenilenir
 */
export function gate(allowed: Role[], title: string, start: (s: Session, root: HTMLElement) => void): void {
  const root = document.getElementById('app') as HTMLElement;
  let started: string | null = null; let stopIdle: (() => void) | undefined; let pwChanged = false;
  const launch = (s: Session) => {
    started = claimsKey(s) + '|' + s.user.uid;
    stopIdle?.();
    stopIdle = startIdleWatch({
      limitMs: s.role === 'admin' ? IDLE_LIMITS.admin : IDLE_LIMITS.other, warnMs: 60_000,
      onWarn: () => toast('Hareketsizlik nedeniyle 1 dakika içinde oturum kapanacak.', 'err'),
      onTimeout: () => { toast('Hareketsizlik nedeniyle oturum kapatıldı.', 'err'); void logout(); },
    });
    start(s, root);
  };
  watchSession(async (s, u) => {
    if (!u) { stopIdle?.(); stopIdle = undefined; started = null; pwChanged = false; loginView(root, title); return; }
    if (!s) {
      box(root, h('h1', null, 'Hesap yetkisiz'), h('p', null, 'Hesabınıza henüz rol atanmamış. Laboratuvar yöneticisiyle görüşün.'),
        btn('Yeniden dene', () => void u.getIdToken(true).then(() => reloadPage()), 'btn primary'), signOutBtn());
      return;
    }
    if (started && started !== claimsKey(s) + '|' + s.user.uid) { reloadPage(); return; } // yetki değişti
    if (!allowed.includes(s.role)) { box(root, h('h1', null, 'Bu sayfaya erişiminiz yok'), h('p', null, `Rolünüz: ${s.role}.`), signOutBtn()); return; }
    if ((s.role === 'doctor' && !s.doctorId) || (s.role === 'tech' && !s.techId)) {
      box(root, h('h1', null, 'Hesap eksik tanımlı'), h('p', null, 'Hesabınız bir hekim/teknisyen kaydına bağlanmamış. Laboratuvar yöneticisiyle görüşün.'), signOutBtn()); return;
    }
    if (s.mustChangePassword && !pwChanged) {
      passwordView(root, () => { pwChanged = true; void readSession(u, true).then((n) => { if (n && !started) launch(n); }); });
      return;
    }
    if (s.role === 'admin') {
      if (!hasMfa(u)) { await mfaEnrollView(root, s); return; }
      if (!s.mfa && !useEmu) { // TOTP kayıtlı ama oturum ikinci faktörsüz açılmış: kabul etme
        toast('Oturum ikinci faktör olmadan açılmış; yeniden giriş yapın.', 'err'); await logout(); return;
      }
    }
    if (started) return;
    launch(s);
  }, (e) => { box(root, h('h1', null, 'Oturum okunamadı'), h('p', null, errMsg(e)), btn('Yeniden dene', () => reloadPage(), 'btn primary'), signOutBtn()); });
}

