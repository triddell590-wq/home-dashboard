import * as store from "../core/store.js";
import { eq, test } from "./harness.js";

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, all: () => Object.fromEntries(m) };
}

test("store keeps every key under home- (the site shares its storage with other apps)", () => {
  const s = fakeStorage();
  store.set("theme", "daylight", s);
  eq(s.all(), { "home-theme": '"daylight"' });
  eq(store.get("theme", null, s), "daylight");
  eq(store.get("nothing", "x", s), "x");
});

test("store neither reads nor changes another app's unprefixed theme or route", () => {
  const theirs = { theme: '"daylight"', route: '"#/settings"' };
  const s = fakeStorage(theirs);
  eq(store.get("theme", "none", s), "none");
  eq(store.get("route", "none", s), "none");
  eq(s.all(), theirs);
  store.set("theme", "midnight", s);
  store.set("route", "#/overview", s);
  eq(s.all(), { ...theirs, "home-theme": '"midnight"', "home-route": '"#/overview"' });
  eq(store.get("theme", null, s), "midnight");
});
