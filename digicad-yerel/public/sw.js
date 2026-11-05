// DIGICAD Dental — Paylaşılan Service Worker
// Amaç: (1) sayfanın "Ana Ekrana Ekle" ile gerçek bir uygulama gibi
// kurulabilmesini sağlamak, (2) bildirime tıklanınca ilgili sekmeye
// odaklanmak/açmak. Bu dosya, ekran tamamen kapalıyken veya tarayıcı
// tamamen kapatılmışken bildirim GÖNDEREMEZ — gerçek "arka planda push"
// için sunucu tarafında bir itme (push) servisi (ör. Firebase Cloud
// Messaging) gerekir. Bu dosya sadece SAYFA/UYGULAMA açıkken/arka
// planda çalışırken bildirimleri güvenilir şekilde göstermeye yardımcı olur.

const CACHE_NAME = 'digicad-dental-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Bildirime tıklanınca: açık bir sekme varsa ona odaklan, yoksa yeni aç
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data?.url || '/');
      }
    })
  );
});

// Sayfadan gelen "bildirim göster" isteğini işler (arka plan sekmesinde
// bile Service Worker üzerinden gösterilen bildirimler daha güvenilir
// çalışır, tarayıcı sekmeyi askıya alsa bile OS bildirim merkezi
// üzerinden görünmeye devam edebilir).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = event.data;
    self.registration.showNotification(title, {
      body,
      tag,
      icon: undefined,
      badge: undefined,
      vibrate: [200, 100, 200],
      data: { url },
      requireInteraction: false
    });
  }
});
