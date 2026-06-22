/* =============================================================================
 * sw.js — Service worker for "كابينة مونديال".
 * Cache-first app shell so the tool installs and runs fully offline.
 * NOTE: service workers only run over http(s); opening via file:// silently
 * skips registration (handled in app.js).
 * ========================================================================== */
var CACHE = 'km-shell-v11';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './fonts/fonts.css',
  './css/base.css',
  './css/dashboard.css',
  './css/editor.css',
  './css/teamview.css',
  './css/ai.css',
  './css/poster.css',
  './css/gallery.css',
  './js/store.js',
  './js/worldcup-data.js',
  './js/app.js',
  './js/dashboard.js',
  './js/editor.js',
  './js/teamview.js',
  './js/ai.js',
  './js/poster.js',
  './js/gallery.js',
  './vendor/html2canvas.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable.svg',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.ico',
  // Self-hosted woff2 fonts (f0–f29) so text renders offline on a cold first load.
  './fonts/f0-J7afnpd8CGxBHpUrhLQY66NL.woff2',
  './fonts/f1-J7afnpd8CGxBHpUrhL8Y66NL.woff2',
  './fonts/f2-J7afnpd8CGxBHpUrhLEY6w.woff2',
  './fonts/f3-J7aRnpd8CGxBHpUrtLMA7w.woff2',
  './fonts/f4-J7aRnpd8CGxBHpUgtLMA7w.woff2',
  './fonts/f5-J7aRnpd8CGxBHpUutLM.woff2',
  './fonts/f6-J7acnpd8CGxBHp2VkaY6zp5yGw.woff2',
  './fonts/f7-J7acnpd8CGxBHp2VkaYxzp5yGw.woff2',
  './fonts/f8-J7acnpd8CGxBHp2VkaY_zp4.woff2',
  './fonts/f9-WwkbxPW1E165rajQKDulIIIoVeo5.woff2',
  './fonts/f10-WwkbxPW1E165rajQKDulIIkoVeo5.woff2',
  './fonts/f11-WwkbxPW1E165rajQKDulIIcoVQ.woff2',
  './fonts/f12-WwkYxPW1E165rajQKDulKDwNQNAY2e_7.woff2',
  './fonts/f13-WwkYxPW1E165rajQKDulKDwNQNsY2e_7.woff2',
  './fonts/f14-WwkYxPW1E165rajQKDulKDwNQNUY2Q.woff2',
  './fonts/f15-SLXVc1nY6HkvangtZmpQdkhzfH5lkSscQyyS4J0.woff2',
  './fonts/f16-SLXVc1nY6HkvangtZmpQdkhzfH5lkSscSCyS4J0.woff2',
  './fonts/f17-SLXVc1nY6HkvangtZmpQdkhzfH5lkSscRiyS.woff2',
  './fonts/f18-Iurf6YBj_oCad4k1l5qjHrRpiYlJ.woff2',
  './fonts/f19-Iurf6YBj_oCad4k1l5qjHrFpiQ.woff2',
  './fonts/f20-Iura6YBj_oCad4k1nzSBC45I.woff2',
  './fonts/f21-Iura6YBj_oCad4k1nzGBCw.woff2',
  './fonts/f22-Iurf6YBj_oCad4k1l8KiHrRpiYlJ.woff2',
  './fonts/f23-Iurf6YBj_oCad4k1l8KiHrFpiQ.woff2',
  './fonts/f24-Iurf6YBj_oCad4k1l4qkHrRpiYlJ.woff2',
  './fonts/f25-Iurf6YBj_oCad4k1l4qkHrFpiQ.woff2',
  './fonts/f26-Iurf6YBj_oCad4k1l5anHrRpiYlJ.woff2',
  './fonts/f27-Iurf6YBj_oCad4k1l5anHrFpiQ.woff2',
  './fonts/f28-Iurf6YBj_oCad4k1l7KmHrRpiYlJ.woff2',
  './fonts/f29-Iurf6YBj_oCad4k1l7KmHrFpiQ.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function (err) { console.warn('SW precache failed', err); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // ignore cross-origin

  var path = url.pathname || '';
  var hasVersionQuery = url.search && url.search.indexOf('v=') >= 0;
  var isNavigate = req.mode === 'navigate';
  var isIndex = /\/index\.html$/.test(path) || /\/$/.test(path);
  var isWorldCupData = /\/js\/worldcup-data\.js$/.test(path);

  // Versioned assets and the World Cup data pack must be network-first.
  // The previous cache-first + ignoreSearch behavior could keep serving an old
  // worldcup-data.js even after index.html requested a newer ?v=... URL.
  if (isNavigate || isIndex || hasVersionQuery || isWorldCupData) {
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { try { c.put(req, copy); } catch (e2) {} });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: false }).then(function (cached) {
          if (cached) return cached;
          return caches.match(req, { ignoreSearch: true }).then(function (fallback) {
            if (fallback) return fallback;
            if (isNavigate) return caches.match('./index.html');
          });
        });
      })
    );
    return;
  }

  // Static app shell remains cache-first for offline support.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { try { c.put(req, copy); } catch (e2) {} });
        }
        return res;
      }).catch(function () {
        if (isNavigate) return caches.match('./index.html');
      });
    })
  );
});
