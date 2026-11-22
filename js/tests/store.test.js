import * as store from "../core/store.js";
import { eq, test } from "./harness.js";

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, all: () => Object.fromEntries(m) };
}

test("store keeps every key under home- (the site shares its storage with other apps)", () => {
  const s = fakeStorage();
  store.set("theme", "daylight", s);
  eq(s.all(), { "home-theme": '"daylight"' });
  eq(store.get("theme", null, s), "daylight");
  eq(store.get("nothing", "x", s), "x");
});

test("store moves an old unprefixed theme or route across once", () => {
  const s = fakeStorage({ theme: '"daylight"', route: '"#/settings"' });
  eq(store.get("theme", null, s), "daylight");
  eq(store.get("route", null, s), "#/settings");
  eq(s.all(), { "home-theme": '"daylight"', "home-route": '"#/settings"' });
});

test("store leaves an unprefixed value alone once this app has its own", () => {
  const s = fakeStorage({ theme: '"daylight"', "home-theme": '"midnight"' });
  eq(store.get("theme", null, s), "midnight");
  eq(s.all().theme, '"daylight"');
});

test("store leaves another app's unprefixed value alone", () => {
  const s = fakeStorage({ theme: "dark", route: '"ledger"', other: '"daylight"' });
  eq(store.get("theme", "none", s), "none");
  eq(store.get("route", "none", s), "none");
  eq(store.get("other", "none", s), "none");
  eq(s.all(), { theme: "dark", route: '"ledger"', other: '"daylight"' });
});

test("store still reads an old value when the new one cannot be written", () => {
  const s = fakeStorage({ theme: '"daylight"' });
  s.setItem = () => { throw new Error("full"); };
  eq(store.get("theme", null, s), "daylight");
  eq(s.all(), { theme: '"daylight"' });
});
