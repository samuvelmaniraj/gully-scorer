// Gully Scorer service worker.
// Keeps a copy of the app's own files on the phone so it opens fast (or at all) on weak signal at the ground.
// It only ever touches files from this site. Relay traffic and anything else pass straight through, untouched.
// Updates: it always tries the network first, so a new version shows up on the next open when online.
// Bump CACHE only if the FILES list changes.
const CACHE = "gully-v1";
const FILES = ["./", "./qrcode.min.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const WAIT = 3500; // ms to wait for the network before using the saved copy

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // not ours: leave it alone
  // every page load is the same single page; the #match part never reaches here
  const key = req.mode === "navigate" ? new URL("./", self.location).href : url.origin + url.pathname;
  e.respondWith(fresh(req, key));
});

async function fresh(req, key) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res.ok && !res.redirected && res.type === "basic") cache.put(key, res.clone());
    return res;
  });
  const saved = await cache.match(key);
  if (!saved) return net;
  const timeout = new Promise(r => setTimeout(() => r(saved), WAIT));
  return Promise.race([net.then(res => res.ok ? res : saved, () => saved), timeout]);
}
