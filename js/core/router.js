// Hash routes: #/overview, #/research/NVDA, #/trade?new=NVDA. Back and Forward work, and the last
// route is remembered so the app reopens where it was left.
import * as store from "./store.js";

// Tabs add their ids in start(); until then every route falls back to the overview.
const KNOWN = new Set();
const HOME = { view: "overview", arg: null, query: {} };

export function parseHash(hash) {
  const text = String(hash || "").replace(/^#\/?/, "");
  if (!text) return { ...HOME, query: {} };
  const [path, search = ""] = text.split("?");
  const [view, ...rest] = path.split("/").filter(Boolean);
  if (!KNOWN.has(view)) return { ...HOME, query: {} };
  const query = Object.fromEntries(new URLSearchParams(search));
  return { view, arg: rest.length ? decodeURIComponent(rest.join("/")) : null, query };
}

export function hashFor(view, arg = null, query = {}) {
  const search = new URLSearchParams(query).toString();
  return `#/${view}${arg ? "/" + encodeURIComponent(arg) : ""}${search ? "?" + search : ""}`;
}

/** The route to reopen next time: the tab and its argument, without one-off actions such as ?new=. */
export function rememberedRoute(hash) {
  const r = parseHash(hash);
  return hashFor(r.view, r.arg);
}

/** The hash from the service worker's {type:"open", hash} message (a tapped notification), or null unless it is `#/` and lowercase letters or hyphens only. */
export function hashFromMessage(message) {
  if (!message || typeof message !== "object" || message.type !== "open") return null;
  return typeof message.hash === "string" && /^#\/[a-z-]+$/.test(message.hash) ? message.hash : null;
}

/** Moves to the tab a notification asked for. Returns stop(). */
export function listenForOpen(target = globalThis.navigator && navigator.serviceWorker) {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  const onMessage = (event) => {
    const hash = hashFromMessage(event && event.data);
    if (hash) location.hash = hash;
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}

let state = null;

export function go(view, arg = null, query = {}) {
  location.hash = hashFor(view, arg, query);
}

/** Shows the first page; the returned promise rejects if that page cannot be built. */
export function start(container, tabs, onChange = () => {}) {
  for (const tab of tabs) KNOWN.add(tab.id);
  state = { container, tabs, onChange, unmount: null, token: 0 };
  window.addEventListener("hashchange", show);
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    const saved = store.get("route");
    if (saved && saved.startsWith("#/")) {
      history.replaceState(null, "", saved);
    }
  }
  return show();
}

/** Leave the page empty and stop reacting to the address bar (used when the session ends). */
export function stop() {
  if (!state) return;
  window.removeEventListener("hashchange", show);
  state.token++;
  if (state.unmount) {
    try { state.unmount(); } catch (err) { console.error(err); }
    state.unmount = null;
  }
  state.container.replaceChildren();
}

async function show() {
  const route = parseHash(location.hash);
  const tab = state.tabs.find((t) => t.id === route.view) || state.tabs.find((t) => t.id === "overview") || state.tabs[0];
  store.set("route", rememberedRoute(location.hash));
  const token = ++state.token;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (state.unmount) {
    try { state.unmount(); } catch (err) { console.error(err); }
    state.unmount = null;
  }
  const page = state.container;
  if (!reduce && page.childElementCount) {
    page.classList.add("leaving");
    await new Promise((r) => setTimeout(r, 200));
    if (token !== state.token) return;
  }
  page.replaceChildren();
  page.classList.remove("leaving");
  page.classList.add("entering");
  state.onChange(tab ? tab.id : null);
  if (tab) {
    const result = await tab.mount(page, { arg: route.arg, query: route.query });
    if (token !== state.token) {
      if (typeof result === "function") result();
      return;
    }
    state.unmount = typeof result === "function" ? result : null;
  }
  requestAnimationFrame(() => page.classList.remove("entering"));
  window.scrollTo({ top: 0 });
}
