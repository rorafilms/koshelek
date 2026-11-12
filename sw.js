// Версия кэша вычисляется командой node scripts/version-cache.mjs.
const VERSION = "726f3b67dd9c46a5";
const PREFIX = "koshelek:" + self.registration.scope + ":";
const CACHE = PREFIX + VERSION;
const ENTRY = new URL("index.html", self.registration.scope).href;
const ASSETS = [
  "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url => new Request(url, {cache: "reload"})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key !== CACHE && (key.startsWith(PREFIX) || /^koshelek-v\d+$/.test(key))
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function getPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, {cache: "no-cache"});
    if (response.ok) {
      try { await cache.put(ENTRY, response.clone()); } catch (error) { /* online response is usable */ }
      return response;
    }
  } catch (error) { /* offline */ }
  return (await cache.match(ENTRY)) || Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const home = new URL(self.registration.scope).pathname;
  if (request.mode === "navigate" && (url.pathname === home || url.pathname === home + "index.html")) {
    event.respondWith(getPage(request));
  } else if (ASSETS.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
  }
});
