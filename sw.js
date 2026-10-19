/* Service worker: tine aplicatia deschisa si fara semnal.
   Schimba VERSIUNE la fiecare modificare, ca telefoanele sa ia codul nou. */
var VERSIUNE = "ug-comenzi-v16";
var FISIERE = [
  "./", "./index.html", "./app.js?v=16", "./produse.js?v=16", "./config.js?v=16",
  "./manifest.webmanifest",
  "./assets/logo.png", "./assets/favicon.png", "./assets/icon-192.png",
  "./assets/icon-512.png", "./assets/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSIUNE).then(function (c) { return c.addAll(FISIERE); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (chei) {
    return Promise.all(chei.map(function (k) { return k === VERSIUNE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // cererile catre baza de date trec mereu prin retea
  if (url.origin !== location.origin) return;
  // retea intai pentru cod, ca o versiune noua sa ajunga repede; cache ca rezerva
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(function (r) {
      var copie = r.clone();
      caches.open(VERSIUNE).then(function (c) { c.put(req, copie); });
      return r;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match("./index.html"); });
    })
  );
});
