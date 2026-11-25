/* Service worker: lets the app open from the phone's home screen, even with no signal.
   Pages and scripts are fetched fresh when online (so updates arrive at once) and from the saved copy when offline.
   Data (/api/...) is never saved here: orders taken offline are kept by the app itself and sent when the signal returns. */
var V = "wms-v4";
var SHELL = ["/", "/index.html", "/manifest.webmanifest", "/sku.js", "/client.js", "/orders.js", "/payments.js", "/customers.js", "/documents.js", "/help.js",
  "/vendor/jspdf.umd.min.js", "/vendor/JsBarcode.all.min.js", "/img/dedsilva-icon.png", "/img/dedsilva-logo.jpg", "/img/kaynes-logo.png", "/img/kaynes-icon.png",
  "/img/pitwan-logo.png", "/img/slayer-logo.png", "/img/icon-192.png", "/img/icon-512.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.indexOf("/api/") === 0 || u.pathname === "/healthz") return;
  e.respondWith(fetch(r).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(V).then(function (c) { c.put(r, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(r).then(function (hit) { return hit || (r.mode === "navigate" ? caches.match("/index.html") : Response.error()); });
  }));
});
