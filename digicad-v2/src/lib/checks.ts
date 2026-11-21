/** Saf (Firebase'siz) doğrulama ve ileti yardımcıları. */

/** Yeni şifre kuralı: en az 10 karakter, en az 2 farklı karakter sınıfı, tek karakter tekrarı değil. */
export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return 'Şifre en az 10 karakter olmalı.';
  if (pw.length > 128) return 'Şifre en fazla 128 karakter olabilir.';
  if (new Set(pw).size < 5) return 'Şifre çok basit: daha çeşitli karakterler kullanın.';
  const classes = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /[0-9]/, /[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]/].filter((r) => r.test(pw)).length;
  if (classes < 2) return 'Şifre harf, rakam veya simgeden en az ikisini içermeli.';
  return null;
}

export const isTotpCode = (c: string): boolean => /^[0-9]{6}$/.test(c);

/** Firebase hata kodunu kullanıcıya gösterilecek Türkçe iletiye çevirir (kullanıcı numaralandırması için hesap varlığı sızdırılmaz). */
export function firebaseErrorMessage(e: unknown): string | null {
  const code = (e as { code?: string } | null)?.code;
  if (typeof code !== 'string') return null;
  switch (code) {
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': case 'auth/invalid-email': return 'E-posta veya şifre hatalı.';
    case 'auth/too-many-requests': return 'Çok fazla deneme yapıldı; bir süre sonra tekrar deneyin.';
    case 'auth/user-disabled': return 'Bu hesap devre dışı bırakılmış.';
    case 'auth/network-request-failed': return 'Ağ bağlantısı kurulamadı.';
    case 'auth/invalid-verification-code': return 'Doğrulama kodu hatalı.';
    case 'auth/code-expired': return 'Doğrulama kodunun süresi doldu.';
    case 'auth/requires-recent-login': return 'Güvenlik için yeniden giriş yapmanız gerekiyor.';
    case 'auth/weak-password': return 'Şifre yeterince güçlü değil.';
    case 'permission-denied': case 'storage/unauthorized': return 'Bu işlem için yetkiniz yok.';
    case 'unauthenticated': case 'storage/unauthenticated': return 'Oturum süresi dolmuş; yeniden giriş yapın.';
    case 'unavailable': return 'Sunucuya ulaşılamıyor; bağlantınızı kontrol edin.';
    case 'storage/canceled': return 'Yükleme iptal edildi.';
    case 'storage/quota-exceeded': return 'Depolama kotası aşıldı.';
    case 'failed-precondition': return 'İşlem şu an yapılamıyor (gerekli dizin veya koşul eksik).';
    default: return null;
  }
}
