/* Сервис-воркер «Сириус»: push-уведомления + кэш оболочки приложения, чтобы при открытии без
   интернета показывался наш экран загрузки/переподключения, а не системная страница браузера
   «нет соединения». */
const SHELL = 'sirius-shell-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.add('/')).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => self.clients.claim());

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // только главная HTML-страница, API/медиа не трогаем
  e.respondWith(
    fetch(e.request).then(r => {
      caches.open(SHELL).then(c => c.put('/', r.clone())).catch(() => {});
      return r;
    }).catch(() => caches.match('/'))
  );
});

self.addEventListener('push', e => {
  e.waitUntil(self.registration.showNotification('Сириус', {
    body: 'Новое уведомление — откройте приложение',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'sirius-update',
    renotify: true
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
