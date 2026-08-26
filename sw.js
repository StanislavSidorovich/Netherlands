// Service worker: Нидерландский с нуля (Фландрия)
//
// Стратегия:
//  - Весь курс лежит внутри index.html (HTML+CSS+JS одним файлом), поэтому
//    документ отдаётся NETWORK-FIRST: у онлайн-пользователя всегда свежие
//    темы и задания, без ручного бампа версии кеша. Офлайн — откат на
//    последнюю успешно загруженную копию.
//  - Статика (шрифты, иконки, манифест) — CACHE-FIRST: мгновенный офлайн
//    и меньше сетевых запросов.
//
// CACHE_NAME НЕ надо бампать при изменении контента. Бампай только когда
// меняется сам список STATIC_ASSETS (добавил/переименовал шрифт или иконку)
// или содержимое одного из статических файлов (например manifest.json) —
// именно это заставляет сбросить старые статические файлы на activate.
const CACHE_NAME = 'nederlands-grammatica-v1';

const HTML_URLS = ['./', './index.html'];

const STATIC_ASSETS = [
  './manifest.json',
  './assets/fonts/golos-cyrillic.woff2',
  './assets/fonts/golos-latin.woff2',
  './assets/fonts/manrope-latin.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512-maskable.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
  './assets/icons/favicon-16.png'
];

const ASSETS_TO_CACHE = HTML_URLS.concat(STATIC_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const request = event.request;

  if (isHtmlRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok && request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
