// Reminders on this device (spec §5/§6): which state the browser is in, turning push on from a tap, listing and
// removing devices, and keeping this device's token fresh. Pure apart from what is passed in, so Node can test it.
// A device document holds only { token, label, addedAt } — never the user's email.
import { issue } from "../core/issue.js";
import { londonDay } from "../core/dom.js";
import * as store from "../core/store.js";
import { shortDate } from "./text.js";

export const STATUS_TEXT = {
  "not-set-up": "Reminders aren't set up yet",
  "ios-install": "On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. Open the app from your Home Screen and turn reminders on there. Needs iOS 16.4 or later.",
  unsupported: "This browser can't show reminders",
  denied: "Notifications are blocked for this app — allow them in your settings, then try again",
};
export const ON_TEXT = "Reminders are on for this device";
export const OFF_TEXT = "Notifications are turned off for this app in your phone's settings";
export const NOT_READY_TEXT = "The app is still getting ready — wait a moment, then try again";
export const TURN_ON_FAILED = "Couldn't turn on reminders — try again";

const isIos = (ua, touch) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);

/** "not-set-up" | "ios-install" | "unsupported" | "denied" | "ready", checked in that order. */
export function pushState({ vapidKey, ua = "", maxTouchPoints = 0, standalone, hasNotification, hasPush, permission }) {
  if (!vapidKey) return "not-set-up";
  if (isIos(ua, maxTouchPoints) && !standalone) return "ios-install";
  if (!hasNotification || !hasPush) return "unsupported";
  if (permission === "denied") return "denied";
  return "ready";
}

/** The browser's own answers, for pushState. */
export function browserEnv(g = globalThis) {
  const nav = g.navigator || {};
  let standalone = false;
  try { standalone = !!nav.standalone || !!(g.matchMedia && g.matchMedia("(display-mode: standalone)").matches); } catch { /* none */ }
  return {
    ua: nav.userAgent || "", maxTouchPoints: nav.maxTouchPoints || 0, standalone,
    hasNotification: "Notification" in g, hasPush: "PushManager" in g,
    permission: "Notification" in g ? g.Notification.permission : "denied",
  };
}

export function deviceLabel(ua = "") {
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** This device's id, made once and kept in store under "device-id" (so localStorage "home-device-id"). */
export function deviceId(storage) {
  const have = store.get("device-id", null, storage);
  if (typeof have === "string" && have) return have;
  const id = globalThis.crypto.randomUUID();
  store.set("device-id", id, storage);
  return id;
}

/** firebase.messaging() — only for the Firebase backend, with a VAPID key, where the browser supports it. */
export async function messagingFor({ firebase, mode, vapidKey }) {
  try {
    if (mode !== "firebase" || !vapidKey || !firebase || typeof firebase.messaging !== "function") return null;
    if (typeof firebase.messaging.isSupported === "function" && !(await firebase.messaging.isSupported())) return null;
    return firebase.messaging();
  } catch {
    return null;
  }
}

/** The app's service worker once it is active (first visit: it may still be installing), or null after a short wait. */
export async function whenActive(serviceWorker, ms = 4000) {
  if (!serviceWorker || !serviceWorker.ready) return null;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(serviceWorker.ready),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Must be called straight from the tap, because the permission prompt needs a user gesture. */
export async function turnOn({ d, messaging, registration, ready, vapidKey, id, label, now, onFail, requestPermission }) {
  let permission;
  try { permission = await requestPermission(); } catch { permission = "denied"; }
  if (permission !== "granted") return { error: STATUS_TEXT.denied };
  if (ready) {
    const live = await ready();
    if (!live) return { error: NOT_READY_TEXT };
    registration = live;
  }
  let token = null;
  try {
    // The app's own service worker is passed in, so Firebase never registers its own firebase-messaging-sw.js.
    token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
  } catch { token = null; }
  if (!token) return { error: TURN_ON_FAILED };
  issue(() => d.set(`devices/${id}`, { token, label, addedAt: now instanceof Date ? now.toISOString() : now }), onFail);
  return { ok: true };
}

export function removeDevice(d, id, { thisId, messaging, onFail } = {}) {
  issue(() => d.remove(`devices/${id}`), onFail);
  if (id === thisId && messaging && typeof messaging.deleteToken === "function") {
    try { Promise.resolve(messaging.deleteToken()).catch(() => {}); } catch { /* ignored */ }
  }
}

/** Tokens can change; keeps this device's saved one current. Does nothing unless reminders are on here. */
export async function refreshToken({ d, messaging, registration, ready, vapidKey, id, permission, onFail }) {
  if (permission !== "granted" || !messaging) return;
  const doc = await d.get(`devices/${id}`);
  if (!doc) return;
  if (ready) {
    const live = await ready();
    if (!live) return;
    registration = live;
  }
  const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
  if (token && token !== doc.token) issue(() => d.update(`devices/${id}`, { token }), onFail);
}

/** The line for a device that is listed: "on", unless the browser has since blocked notifications. */
export const onStatus = (permission) => (permission === "denied" ? OFF_TEXT : ON_TEXT);

/** "Added Mon 23 Nov", or "" for a missing or hand-edited date. */
export function addedText(addedAt) {
  const t = typeof addedAt === "string" ? new Date(addedAt) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  try { return `Added ${shortDate(londonDay(t))}`; } catch { return ""; }
}
