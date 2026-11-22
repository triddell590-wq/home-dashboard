// Tests for sw.js (a classic worker script, run here inside a fake worker scope) and js/core/update.js. Node only.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { applyUpdate, checkForUpdate, shouldRegisterWorker, watchForUpdate } from "../core/update.js";
import { eq, ok, test } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCOPE = "https://x.github.io/home-dashboard/";

function loadWorker({ cacheEntries = {}, fetchImpl = async () => { throw new Error("offline"); } } = {}) {
  const handlers = {};
  const calls = { skipWaiting: 0, deleted: [], added: [], claimed: 0 };
  const store = new Map(Object.entries(cacheEntries));
  const cache = {
    addAll: async (files) => { calls.added.push(...files); },
    match: async (req) => store.get(typeof req === "string" ? req : req.url) ?? undefined,
  };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { scope: SCOPE },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { calls.claimed++; return Promise.resolve(); } },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["home-dev", "home-old", "other"],
    delete: async (n) => { calls.deleted.push(n); return true; },
  };
  class Request { constructor(url, init = {}) { this.url = url; this.cache = init.cache; } }
  const context = vm.createContext({ self, caches, fetch: fetchImpl, Promise, Request });
  vm.runInContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context, { filename: "sw.js" });
  return { context, handlers, calls, self };
}

function fetchEvent(url, over = {}) {
  const e = { request: { url, method: "GET", mode: "same-origin", ...over }, responded: undefined };
  e.respondWith = (p) => { e.responded = Promise.resolve(p); };
  return e;
}

test("sw.js is a classic script (no import or export)", () => {
  const text = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  ok(!/^\s*(import|export)\s/m.test(text), "sw.js must not use module syntax");
});

test("cachesToDelete keeps the current cache and other sites' caches", () => {
  const { context } = loadWorker();
  eq(context.cachesToDelete(["home-dev", "home-abc", "other"]), ["home-abc"]);
  eq(context.CACHE, "home-" + context.VERSION);
});

test("isAppRequest is true only for the same site under the scope", () => {
  const { context } = loadWorker();
  ok(context.isAppRequest("https://x.github.io/home-dashboard/js/main.js", SCOPE));
  ok(!context.isAppRequest("https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen", SCOPE));
  ok(!context.isAppRequest("https://x.github.io/other/", SCOPE));
  ok(!context.isAppRequest("https://x.github.io/home-dashboard-evil/a.js", SCOPE));
});

test("FILES lists the entry page, main.js and every vendor file, and every entry exists", () => {
  const { context } = loadWorker();
  const files = Array.from(context.FILES);
  ok(files.includes("./index.html") && files.includes("./js/main.js") && files.includes("./"));
  for (const v of fs.readdirSync(path.join(root, "vendor")).filter((n) => n.endsWith(".js"))) ok(files.includes(`./vendor/${v}`), `missing vendor/${v}`);
  for (const f of files) ok(fs.existsSync(path.join(root, f === "./" ? "index.html" : f)), `${f} does not exist`);
});

test("FILES covers every app script, stylesheet and icon", () => {
  const { context } = loadWorker();
  const files = Array.from(context.FILES);
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? (d.name === "tests" ? [] : walk(`${dir}/${d.name}`)) : [`./${dir}/${d.name}`]);
  for (const f of [...walk("js"), ...walk("css"), ...walk("icons")]) ok(files.includes(f), `${f} missing from FILES`);
  ok(files.includes("./manifest.webmanifest"));
});

test("install caches FILES; it does not skip waiting", async () => {
  const w = loadWorker();
  let waited;
  w.handlers.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  eq(w.calls.added.length, w.context.FILES.length);
  w.calls.added.forEach((r, i) => {
    const f = w.context.FILES[i];
    eq(r.url, f === "./" ? SCOPE : SCOPE + f.slice(2));
    eq(r.cache, "reload");
  });
  eq(w.calls.skipWaiting, 0);
});

test("activate deletes old home- caches", async () => {
  const w = loadWorker();
  let waited;
  w.handlers.activate({ waitUntil: (p) => { waited = p; } });
  await waited;
  eq(w.calls.deleted, ["home-old"]);
});

test("the skip-waiting message (and only it) calls skipWaiting", () => {
  const w = loadWorker();
  w.handlers.message({ data: { type: "other" } });
  eq(w.calls.skipWaiting, 0);
  w.handlers.message({ data: { type: "skip-waiting" } });
  eq(w.calls.skipWaiting, 1);
});

test("fetch passes Google and out-of-scope requests straight through", () => {
  const w = loadWorker();
  for (const url of ["https://firestore.googleapis.com/x", "https://x.github.io/other/", "https://www.gstatic.com/a.js"]) {
    const e = fetchEvent(url);
    w.handlers.fetch(e);
    eq(e.responded, undefined);
  }
  const post = fetchEvent(SCOPE + "js/main.js", { method: "POST" });
  w.handlers.fetch(post);
  eq(post.responded, undefined);
});

test("fetch answers app files from the cache first, without the network", async () => {
  let hit = 0;
  const w = loadWorker({ cacheEntries: { [SCOPE + "js/main.js"]: "CACHED" }, fetchImpl: async () => { hit++; return "NET"; } });
  const e = fetchEvent(SCOPE + "js/main.js");
  w.handlers.fetch(e);
  eq(await e.responded, "CACHED");
  eq(hit, 0);
});

test("a navigation to the scope root is served index.html from the cache", async () => {
  const w = loadWorker({ cacheEntries: { [SCOPE]: "INDEX" } });
  const e = fetchEvent(SCOPE, { mode: "navigate" });
  w.handlers.fetch(e);
  eq(await e.responded, "INDEX");
});

test("an uncached app file comes from the network; an uncached offline navigation falls back to index.html", async () => {
  const net = loadWorker({ fetchImpl: async () => "NET" });
  const a = fetchEvent(SCOPE + "css/new.css");
  net.handlers.fetch(a);
  eq(await a.responded, "NET");

  const off = loadWorker({ cacheEntries: { [SCOPE + "index.html"]: "INDEX" } });
  const nav = fetchEvent(SCOPE + "somewhere", { mode: "navigate" });
  off.handlers.fetch(nav);
  eq(await nav.responded, "INDEX");
});

// ---- update.js ----
function fakeWorker(state = "installing") {
  const listeners = [];
  return { state, addEventListener: (t, fn) => { if (t === "statechange") listeners.push(fn); }, change(next) { this.state = next; listeners.forEach((fn) => fn()); }, posted: [], postMessage(m) { this.posted.push(m); } };
}
function fakeRegistration(over = {}) {
  const l = {};
  return { installing: null, waiting: null, addEventListener: (t, fn) => { l[t] = fn; }, fire: (t) => l[t]?.(), ...over };
}
const fakeContainer = (controller) => {
  const l = {};
  return { controller, addEventListener: (t, fn) => { l[t] = fn; }, fire: (t) => l[t]?.() };
};

test("watchForUpdate shows the bar once when a worker installs while a controller exists", () => {
  const worker = fakeWorker();
  const reg = fakeRegistration({ installing: worker });
  let shown = 0;
  watchForUpdate(reg, () => shown++, fakeContainer({}));
  worker.change("installed");
  worker.change("installed");
  eq(shown, 1);
});

test("watchForUpdate never shows the bar for the first install (no controller)", () => {
  const worker = fakeWorker();
  const reg = fakeRegistration({ installing: worker });
  let shown = 0;
  watchForUpdate(reg, () => shown++, fakeContainer(null));
  worker.change("installed");
  eq(shown, 0);
});

test("watchForUpdate also follows a worker found later, and one already waiting", () => {
  const reg = fakeRegistration();
  let shown = 0;
  watchForUpdate(reg, () => shown++, fakeContainer({}));
  const later = fakeWorker();
  reg.installing = later;
  reg.fire("updatefound");
  later.change("installed");
  eq(shown, 1);
  const waiting = fakeRegistration({ waiting: fakeWorker("installed") });
  watchForUpdate(waiting, () => shown++, fakeContainer({}));
  eq(shown, 2);
});

test("applyUpdate posts skip-waiting, then reloads once however many times the controller changes", () => {
  const waiting = fakeWorker("installed");
  const reg = fakeRegistration({ waiting });
  const container = fakeContainer({});
  let reloads = 0;
  applyUpdate(reg, container, () => reloads++);
  eq(waiting.posted, [{ type: "skip-waiting" }]);
  eq(reloads, 0);
  container.fire("controllerchange");
  container.fire("controllerchange");
  eq(reloads, 1);
});

test("checkForUpdate asks the browser to look, and reports whether a new version is waiting", async () => {
  const none = fakeRegistration({ update: async () => {} });
  eq(await checkForUpdate(none), false);
  const waiting = fakeRegistration({ waiting: fakeWorker("installed"), update: async () => {} });
  eq(await checkForUpdate(waiting), true);
  const worker = fakeWorker();
  const installing = fakeRegistration({ update: async () => { installing.installing = worker; setTimeout(() => { installing.waiting = worker; worker.change("installed"); }, 5); } });
  eq(await checkForUpdate(installing), true);
  eq(await checkForUpdate(undefined), false);
});

test("applyUpdate with nothing waiting (another tab already updated) reloads straight away", () => {
  let reloads = 0;
  applyUpdate(fakeRegistration(), fakeContainer({}), () => reloads++);
  eq(reloads, 1);
});

test("shouldRegisterWorker: https yes, local only with ?sw=1, never with ?backend=memory", () => {
  const r = (protocol, hostname, search = "") => shouldRegisterWorker({ protocol, hostname, search });
  eq(r("https:", "x.github.io"), true);
  eq(r("https:", "x.github.io", "?backend=memory"), false);
  eq(r("http:", "127.0.0.1"), false);
  eq(r("http:", "localhost", "?sw=1"), true);
  eq(r("http:", "127.0.0.1", "?sw=1"), true);
  eq(r("http:", "example.com"), false);
  eq(r("http:", "example.com", "?sw=1"), false);
  eq(r("http:", "127.0.0.1", "?sw=1&backend=memory"), false);
});
