// Service worker minimal : rend l'app installable sur l'écran d'accueil. Pas de cache des données.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});
