// Starts the dashboard: picks the backends, waits to learn who is signed in, then shows either the sign-in
// screen or the app (sidebar, phone tab bar, router).
import { FIREBASE_CONFIG } from "./config.js";
import { auth, useAuth } from "./core/auth.js";
import { createFirebaseAuth } from "./core/auth-firebase.js";
import { createMemoryAuth } from "./core/auth-memory.js";
import { chooseBackend, data, startData, useData } from "./core/data.js";
import { createFirebaseData } from "./core/data-firebase.js";
import { createMemoryData } from "./core/data-memory.js";
import { el } from "./core/dom.js";
import { registerTab, tabs } from "./core/registry.js";
import * as router from "./core/router.js";
import { configureScreen, depsFor, endSession } from "./core/signout.js";
import { guarded, nextStep, reloadOnce } from "./core/startup.js";
import { startSyncStatus } from "./core/sync-status.js";
import { buildTabbar } from "./core/tabbar.js";
import { applySavedTheme, currentTheme, toggleTheme } from "./core/theme.js";
import { applyUpdate, shouldRegisterWorker, watchForUpdate } from "./core/update.js";
import * as overview from "./views/overview.js";
import * as settings from "./views/settings.js";
import { mountSignin } from "./views/signin.js";

const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};

const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || ICONS.overview;
  return svg;
};

const $ = (id) => document.getElementById(id);
const rail = document.querySelector(".rail");
const page = $("page");

for (const view of [overview, settings]) registerTab(view.tab);

function buildRail() {
  const main = $("rail-tabs");
  const foot = $("rail-foot");
  const links = new Map();
  for (const tab of tabs()) {
    const link = el("a", { href: `#/${tab.id}`, "data-tab": tab.id, title: tab.label }, icon(tab.icon || tab.id), el("span", {}, tab.label));
    links.set(tab.id, link);
    (tab.foot ? foot : main).append(link);
  }
  const themeButton = el("button", { type: "button", "aria-label": "Switch theme" });
  const showTheme = () => {
    const daylight = currentTheme() === "daylight";
    themeButton.replaceChildren(icon(daylight ? "moon" : "sun"), el("span", {}, daylight ? "Midnight" : "Daylight"));
    themeButton.title = daylight ? "Switch to Midnight" : "Switch to Daylight";
  };
  themeButton.addEventListener("click", toggleTheme);
  window.addEventListener("themechange", showTheme);
  showTheme();
  foot.append(themeButton);
  return (active) => {
    for (const [id, link] of links) {
      link.classList.toggle("active", id === active);
      if (id === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
}

let started = false;
let stopSignin = null;
let stopSync = () => {};
let closeMore = () => {};

/** A plain full-page message with one button, for when the app cannot go on. */
function showFatal(text, label, onClick = () => location.reload()) {
  rail.hidden = true;
  $("tabbar").hidden = true;
  page.classList.remove("leaving", "entering"); // a page change that stopped half-way leaves #page transparent
  page.replaceChildren(el("div", { class: "signin-wrap" }, el("div", { class: "card signin static", role: "alert" },
    el("p", {}, text), el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", onclick: onClick }, label)))));
}

configureScreen({
  hideChrome() { rail.hidden = true; $("tabbar").hidden = true; $("sync").hidden = true; closeMore(); },
  stopSync: () => stopSync(),
  unmountView: () => router.stop(),
  showMessage: (text) => showFatal(text, "Reload"),
});

function showApp(user) {
  startData(user.uid);
  stopSignin?.();
  stopSignin = null;
  page.replaceChildren();
  const markRail = buildRail();
  const tabbar = $("tabbar");
  const markBar = buildTabbar(tabbar, tabs(), icon);
  closeMore = markBar.close;
  rail.hidden = false;
  tabbar.hidden = false;
  stopSync = startSyncStatus($("sync"), data());
  started = true;
  return router.start(page, tabs(), (id) => { markRail(id); markBar(id); });
}

function showSignin() {
  rail.hidden = true;
  $("tabbar").hidden = true;
  page.replaceChildren();
  stopSignin = mountSignin(page);
}

function startFailed(err) {
  console.error(err);
  showFatal("Couldn't start the app. Check your connection and reload.", "Reload");
}

applySavedTheme();
try {
  const mode = chooseBackend(location.search, FIREBASE_CONFIG);
  if (mode === "memory") {
    const memoryAuth = createMemoryAuth();
    memoryAuth.addUser("test@example.com", "test-only-password", "owner"); // memory backend only
    useAuth(memoryAuth);
    useData(createMemoryData());
    const band = $("band");
    band.textContent = "Test mode — nothing is saved";
    band.hidden = false;
  } else {
    useAuth(createFirebaseAuth(globalThis.firebase, FIREBASE_CONFIG));
    useData(createFirebaseData(globalThis.firebase, FIREBASE_CONFIG));
  }

  const freshStart = reloadOnce(() => sessionStorage);
  // Until the first callback (Firebase restores a saved session first) the page keeps its "Opening…" text.
  auth().onChange(guarded((user) => {
    const step = nextStep({ user, started, signinShown: !!stopSignin,
      // The memory backend forgets everything on a reload, so it never reloads here.
      claimReload: () => mode === "firebase" && freshStart.claim() });
    if (step === "reload") location.reload();
    else if (step === "app") {
      if (!stopSignin) freshStart.clear(); // the session survived the reload
      return showApp(user);
    }
    // Signed out elsewhere: clear this device's offline copy the same way Sign out does, then start clean.
    else if (step === "end") return endSession(depsFor({ data, auth }));
    else if (step === "signin") showSignin();
  }, startFailed));
} catch (err) {
  startFailed(err);
}

/** Keeps an offline copy of the app (sw.js); see shouldRegisterWorker for when. */
function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!shouldRegisterWorker(location)) return;
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    watchForUpdate(registration, () => {
      const bar = $("update");
      bar.replaceChildren(el("span", {}, "New version ready"),
        el("button", { type: "button", onclick: () => applyUpdate(registration) }, "Update"));
      bar.hidden = false;
    });
  }).catch((err) => console.error("Offline copy unavailable", err));
}
registerWorker();
