// Service worker: keeps a copy of the app so it opens offline, and lets a new version wait until Tom taps Update.
// A classic script on purpose (no import/export): older iOS Safari cannot run module workers.
// Every path is relative to the registration scope, because the app is served from /home-dashboard/.
var VERSION = "dev";
var CACHE = "home-" + VERSION;
var FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/tokens.css",
  "./css/shell.css",
  "./css/components.css",
  "./css/views.css",
  "./js/config.js",
  "./js/main.js",
  "./js/version.js",
  "./js/core/auth-firebase.js",
  "./js/core/auth-memory.js",
  "./js/core/auth.js",
  "./js/core/card.js",
  "./js/core/data-firebase.js",
  "./js/core/data-memory.js",
  "./js/core/data.js",
  "./js/core/dom.js",
  "./js/core/registry.js",
  "./js/core/router.js",
  "./js/core/signout.js",
  "./js/core/startup.js",
  "./js/core/store.js",
  "./js/core/sync-status.js",
  "./js/core/tabbar.js",
  "./js/core/theme.js",
  "./js/core/update.js",
  "./js/core/visible.js",
  "./js/lessons/sums.js",
  "./js/lessons/checks.js",
  "./js/lessons/records.js",
  "./js/lessons/actions.js",
  "./js/lessons/csv.js",
  "./js/lessons/text.js",
  "./js/weather/text.js",
  "./js/weather/summary.js",
  "./js/weather/open-meteo.js",
  "./js/weather/place.js",
  "./js/weather/forecast.js",
  "./js/views/lessons.js",
  "./js/views/overview.js",
  "./js/views/settings.js",
  "./js/views/signin.js",
  "./vendor/firebase-app-compat.js",
  "./vendor/firebase-auth-compat.js",
  "./vendor/firebase-firestore-compat.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

/** Every cache this app made earlier (home-...) except the current one. */
function cachesToDelete(names) {
  return names.filter(function (name) { return name.indexOf("home-") === 0 && name !== CACHE; });
}

/** True for a request to this site under the worker's scope. Firebase, Google and anything else is left alone. */
function isAppRequest(url, scope) {
  return String(url).indexOf(scope) === 0;
}

async function answer(request) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode === "navigate") {
      var page = await cache.match(self.registration.scope + "index.html");
      if (page) return page;
    }
    throw err;
  }
}

self.addEventListener("install", function (event) {
  // cache: "reload" skips the browser's HTTP cache, so a new version never stores the previous version's files.
  var scope = self.registration.scope;
  var requests = FILES.map(function (file) {
    return new Request(file === "./" ? scope : scope + file.replace(/^\.\//, ""), { cache: "reload" });
  });
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(requests); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(cachesToDelete(names).map(function (name) { return caches.delete(name); }));
  }));
});

// A new version waits until the page asks for it (the Update button); it never takes over on its own.
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || !isAppRequest(request.url, self.registration.scope)) return;
  event.respondWith(answer(request));
});
