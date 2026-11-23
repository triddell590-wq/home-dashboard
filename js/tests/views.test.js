import { greetingText, overviewEmpty } from "../views/overview.js";
import { cleanName } from "../views/settings.js";
import { eq, ok, test } from "./harness.js";

test("cleanName trims, cuts to 40 characters and keeps markup as plain text", () => {
  eq(cleanName("  Tom  "), "Tom");
  eq(cleanName("   "), "");
  eq(cleanName("a".repeat(45)), "a".repeat(40));
  eq(cleanName("<b>x</b>"), "<b>x</b>");
  eq(cleanName(undefined), "");
});

test("overviewEmpty gives the two lines only when no cards are registered", () => {
  eq(overviewEmpty(0), [
    "Your calendar comes next. Lessons, weather and trading follow, one at a time.",
    "Until then, they're in the dashboard on your Mac.",
  ]);
  eq(overviewEmpty(1), null);
});

test("greetingText returns a plain string, with or without a name", () => {
  const morning = new Date(Date.UTC(2026, 10, 22, 8, 0));
  eq(greetingText("Tom", morning), "Good morning, Tom");
  eq(greetingText("", morning), "Good morning");
  eq(typeof greetingText("<b>x</b>", morning), "string");
  eq(greetingText("<b>x</b>", morning), "Good morning, <b>x</b>");
});

test("the Overview and Settings views never assign innerHTML", async () => {
  for (const file of ["overview.js", "settings.js", "signin.js"]) {
    const url = new URL(`../views/${file}`, import.meta.url);
    const source = typeof document === "undefined" ? await (await import("node:fs/promises")).readFile(url, "utf8")
      : await (await fetch(url)).text();
    ok(!/innerHTML/.test(source), `${file} uses innerHTML`);
    ok(!/html\s*:/.test(source), `${file} uses the el html option`);
  }
});

test("saveName shows Saved at once without waiting for the server, and reports a rejected write plainly", async () => {
  const { saveName } = await import("../views/settings.js");
  const events = [];
  const never = () => new Promise(() => {});
  saveName(never, { other: 1 }, "  Tom ", { saved: (n) => events.push(["saved", n]), failed: (m) => events.push(["failed", m]) });
  eq(events, [["saved", "Tom"]]);
  const got = [];
  saveName(() => Promise.reject(new Error("FirebaseError: raw")), {}, "Tom", { saved() {}, failed: (m) => got.push(m) });
  await new Promise((r) => setTimeout(r, 0));
  eq(got, ["Couldn't save — try again"]);
});

test("summaryText joins the phrases and is null when there are none", async () => {
  const { summaryText } = await import("../views/overview.js");
  eq(summaryText(["a", null, "b"]), "a · b");
  eq(summaryText([]), null);
  eq(summaryText([null, ""]), null);
});

// A page that can be hidden and shown, with no real document.
function fakeDocument() {
  const handlers = new Set();
  return {
    visibilityState: "visible",
    addEventListener: (type, fn) => { if (type === "visibilitychange") handlers.add(fn); },
    removeEventListener: (type, fn) => handlers.delete(fn),
    become(state) { this.visibilityState = state; for (const fn of [...handlers]) fn(); },
    listeners: () => handlers.size,
  };
}

test("keepDayFresh shows the date and greeting now, and again each time the page comes back into view", async () => {
  const { keepDayFresh } = await import("../views/overview.js");
  const doc = fakeDocument();
  let now = new Date(Date.UTC(2026, 10, 22, 8, 0));
  const seen = [];
  const day = keepDayFresh({ show: (lines) => seen.push(lines), clock: () => now, doc });
  eq(seen, [{ date: "Sunday 22 November", greeting: "Good morning" }]);
  day.setName("Tom");
  eq(seen[1], { date: "Sunday 22 November", greeting: "Good morning, Tom" });
  now = new Date(Date.UTC(2026, 10, 23, 19, 0));
  doc.become("hidden");
  eq(seen.length, 2);
  doc.become("visible");
  eq(seen[2], { date: "Monday 23 November", greeting: "Good evening, Tom" });
  day.stop();
  doc.become("visible");
  eq([seen.length, doc.listeners()], [3, 0]);
});

test("watchCards watches only cards that ask, and stops them all", async () => {
  const { watchCards } = await import("../views/overview.js");
  const log = [];
  const specs = [
    { id: "a" },
    { id: "b", watch: (refresh) => { log.push("watch b"); refresh(); return () => log.push("stop b"); } },
    { id: "c", watch: () => { log.push("watch c"); return () => log.push("stop c"); } },
  ];
  const refreshers = [() => log.push("refresh a"), () => log.push("refresh b"), () => log.push("refresh c")];
  const stop = watchCards(specs, refreshers);
  eq(log, ["watch b", "refresh b", "watch c"]);
  stop();
  eq(log.slice(3), ["stop b", "stop c"]);
  stop();
  eq(log.length, 5, "stop is idempotent");
});

async function sourceOf(path) {
  const url = new URL(path, import.meta.url);
  return typeof document === "undefined" ? await (await import("node:fs/promises")).readFile(url, "utf8")
    : await (await fetch(url)).text();
}

test("test_mobile_table_rule_is_scoped_to_lessons_cards", async () => {
  const css = await sourceOf("../../css/views.css");
  ok(css.includes(".card.lz-section .table"), "scoped rule present");
  ok(!/\.card \.table\s*\{/.test(css), "no global card table rule");
  const view = await sourceOf("../views/lessons.js");
  ok(!view.includes('class: "card wide static'), "sections use lz-section");
});

test("the Lessons view places text only with textContent", async () => {
  const view = await sourceOf("../views/lessons.js");
  ok(!/innerHTML/.test(view), "uses innerHTML");
  ok(!/html\s*:/.test(view), "uses the el html option");
});

test("watchLive reports data, and an error if nothing arrives in time or the watch throws", async () => {
  const { watchLive } = await import("../views/lessons.js");
  // data arrives: no error, timer cleared
  const events = [];
  const timers = [];
  const fakeData = { watch: (path, cb) => { Promise.resolve().then(() => cb(path.startsWith("settings") ? null : [])); return () => events.push("stop " + path); } };
  const stop = watchLive(fakeData, { onData: (r) => events.push(["data", Object.keys(r).sort().join()]), onError: () => events.push("error"),
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => events.push("cleared") });
  await new Promise((r) => setTimeout(r, 0));
  eq(events.filter((e) => Array.isArray(e)), [["data", "days,payments,rates,settings"]]);
  ok(events.includes("cleared"));
  stop();
  eq(events.filter((e) => typeof e === "string" && e.startsWith("stop")).length, 4);
  // nothing ever arrives: the timer fires the error
  const e2 = [];
  const t2 = [];
  watchLive({ watch: () => () => {} }, { onData: () => e2.push("data"), onError: () => e2.push("error"),
    setTimer: (fn) => { t2.push(fn); return 1; }, clearTimer: () => {} });
  t2[0]();
  eq(e2, ["error"]);
  // the watch throws at once
  const e3 = [];
  watchLive({ watch: () => { throw new Error("boom"); } }, { onData: () => {}, onError: () => e3.push("error"), setTimer: () => 1, clearTimer: () => {} });
  eq(e3, ["error"]);
});

test("the rate flow previews and saves from the live records at the moment of saving", async () => {
  const { makeRateFlow } = await import("../views/lessons.js");
  const { createMemoryData } = await import("../core/data-memory.js");
  const { recordsFrom } = await import("../lessons/records.js");
  const d = createMemoryData();
  let records = recordsFrom({ dayDocs: [], rateDocs: [{ id: "2026-01-01", pence: 1500 }] });
  const failures = [];
  const flow = makeRateFlow(d, () => records, (m) => failures.push(m));
  // no recorded days change: saves straight away
  eq((await flow.submit(1800, "2026-11-01")).state, "saved");
  eq(await d.get("lessonRates/2026-11-01"), { pence: 1800 });
  // the preview shows no change, but by the time of saving another device has recorded a day: the save is refused, not slipped through
  const quiet = recordsFrom({ dayDocs: [], rateDocs: [{ id: "2026-01-01", pence: 1500 }] });
  const busy = recordsFrom({ dayDocs: [{ id: "2026-11-10", lessons: 2 }], rateDocs: [{ id: "2026-01-01", pence: 1500 }] });
  let reads = 0;
  const flow2 = makeRateFlow(d, () => (reads++ === 0 ? quiet : busy), () => {});
  let message = null;
  try { await flow2.submit(2000, "2026-11-02"); } catch (e) { message = e.message; }
  eq(message, "This changes days already recorded");
  eq(await d.get("lessonRates/2026-11-02"), null);
  // with the day already in the records, the same change waits for Confirm and then writes what was previewed
  records = busy;
  const flow3 = makeRateFlow(d, () => records, () => {});
  eq((await flow3.submit(2000, "2026-11-02")).state, "confirm");
  await flow3.confirm();
  eq(await d.get("lessonRates/2026-11-02"), { pence: 2000 });
  // a bad rate is thrown as its message
  let bad = null;
  try { await flow.submit(0, "2026-11-01"); } catch (e) { bad = e.message; }
  ok(bad && bad.includes("rate"), "bad rate message");
});

test("the Weather view uses innerHTML only for its fixed icon table", async () => {
  const url = new URL("../views/weather.js", import.meta.url);
  const source = typeof document === "undefined" ? await (await import("node:fs/promises")).readFile(url, "utf8")
    : await (await fetch(url)).text();
  eq((source.match(/innerHTML/g) || []).length, 1);
  ok(/svg\.innerHTML = WEATHER_ICONS\[/.test(source), "the one innerHTML is the icon table");
  ok(!/html\s*:/.test(source), "uses the el html option");
});

test("loadWeather shares one fetch between the card, the day phrase and the tab", async () => {
  if (typeof document !== "undefined") return;               // reads a fixture with node:fs
  const { readFileSync } = await import("node:fs");
  const { createMemoryData } = await import("../core/data-memory.js");
  const { useData, startData, data } = await import("../core/data.js");
  const { loadWeather } = await import("../views/weather.js");
  useData(createMemoryData());
  startData("u1");
  await data().set("settings/weather", { place: { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" } });
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => readFileSync(new URL("./fixtures/weather/forecast.json", import.meta.url), "utf8") };
  };
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const now = new Date("2026-11-21T12:00:00Z");
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => loadWeather({ force: false, fetchImpl, storage, now })));
  eq(calls, 1);
  eq([a.place.name, b.place.name, c.place.name], ["Hexham", "Hexham", "Hexham"]);
  ok(a.summary.days.length > 0);
  eq(a.warnings_ok, false);
  await data().set("settings/weather", {});
  eq((await loadWeather({ force: false, fetchImpl, storage, now })).place, null);
});

async function weatherHarness() {
  const { createMemoryData } = await import("../core/data-memory.js");
  const { useData, startData, data } = await import("../core/data.js");
  const { weatherController, loadWeather, canon } = await import("../views/weather.js");
  useData(createMemoryData());
  startData("u1");
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { data, weatherController, tick, canon, loadWeather };
}
const PLACE_A = { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" };
const PLACE_B = { name: "Plymouth", county: "Devon", nation: "England", lat: 50.37, lon: -4.14, region: "sw" };

test("a place changed between the initial load and the first report ends with the new place drawn", async () => {
  if (typeof document !== "undefined") return;
  const { data, weatherController, tick, canon } = await weatherHarness();
  await data().set("settings/weather", { place: PLACE_A });
  const drawn = [];
  // A load that read the old place, then another device saves a new one before the watch's report is handled.
  const load = async () => {
    const doc = await data().get("settings/weather");
    await data().set("settings/weather", { place: PLACE_B });
    await tick();
    const now = await data().get("settings/weather");
    const read = drawn.length === 0 && !load.reloaded ? doc : now;
    load.reloaded = true;
    return { place: read.place, used: { place: canon(read.place), warnings: canon(null) } };
  };
  const ctl = weatherController({ draw: (r) => drawn.push(r.place.name), fail: (e) => { throw e; }, load });
  await ctl.show(false);
  await tick();
  eq(drawn, ["Plymouth"]);
  ctl.stop();
});

test("a result for an old place arriving after a newer one is dropped", async () => {
  if (typeof document !== "undefined") return;
  const { data, weatherController, tick, canon } = await weatherHarness();
  await data().set("settings/weather", { place: PLACE_B });
  const slots = [];
  const load = () => new Promise((resolve) => slots.push(resolve));
  const result = (p) => ({ place: p, used: { place: canon(p), warnings: canon(null) } });
  const drawn = [];
  const ctl = weatherController({ draw: (r) => drawn.push(r.place.name), fail: (e) => { throw e; }, load });
  const first = ctl.show(false);
  const second = ctl.show(true);
  slots[1](result(PLACE_B));
  await second;
  slots[0](result(PLACE_A));
  await first;
  await tick();
  eq(drawn, ["Plymouth"]);
  ctl.stop();
});

// ---- fix wave: lessons redraw gate, London midnight, weather offline warnings and plain error wording

test("a same-data watch report does not redraw the Lessons tab, a changed one does", async () => {
  const { makeDrawGate } = await import("../views/lessons.js");
  const { recordsFrom } = await import("../lessons/records.js");
  const make = (extra = []) => recordsFrom({ dayDocs: [{ id: "2026-11-10", lessons: 2, note: "a" }, ...extra], rateDocs: [{ id: "2026-01-01", pence: 1500 }] });
  const drawn = [];
  const gate = makeDrawGate((records, today) => drawn.push(today));
  gate.draw(make(), "2026-11-23");
  gate.draw(make(), "2026-11-23");                       // metadata-only report: the same data again
  eq(drawn.length, 1);
  gate.draw(make([{ id: "2026-11-11", lessons: 1 }]), "2026-11-23");
  eq(drawn.length, 2);
  gate.draw(make([{ id: "2026-11-11", lessons: 1 }]), "2026-11-24");   // a new day redraws
  eq(drawn.length, 3);
  gate.draw(make([{ id: "2026-11-11", lessons: 1 }]), "2026-11-24", true);   // a local action forces it
  eq(drawn.length, 4);
});

test("watchToday ticks when the page comes back into view and at the next London midnight", async () => {
  const { watchToday, msToLondonMidnight } = await import("../views/lessons.js");
  // 23:30 UTC on 30 June is 00:30 on 1 July in London (summer time): the next midnight is 23h30m away
  eq(msToLondonMidnight(new Date("2026-06-30T23:30:00Z")), 23.5 * 3600000);
  eq(msToLondonMidnight(new Date("2026-11-23T23:30:00Z")), 30 * 60000);
  const doc = fakeDocument();
  let now = new Date("2026-11-23T23:30:00Z");
  const timers = new Map();
  let nextId = 1;
  const setTimer = (fn, ms) => { timers.set(nextId, { fn, ms }); return nextId++; };
  const clearTimer = (id) => timers.delete(id);
  let ticks = 0;
  const stop = watchToday({ onTick: () => { ticks++; }, clock: () => now, doc, setTimer, clearTimer });
  eq([...timers.values()].map((t) => t.ms), [30 * 60000 + 50]);
  doc.become("hidden");
  eq(ticks, 0);
  doc.become("visible");
  eq(ticks, 1);
  now = new Date("2026-11-24T00:00:00Z");
  const [[id, t]] = [...timers.entries()];
  timers.delete(id);                                    // a timer that has fired is gone
  t.fn();
  eq(ticks, 2);
  eq([...timers.values()].map((x) => x.ms), [24 * 3600000 + 50]);   // the next midnight is armed
  stop();
  eq([timers.size, doc.listeners()], [0, 0]);
});

test("a failed warnings read still gives the forecast and the place", async () => {
  if (typeof document !== "undefined") return;
  const { readFileSync } = await import("node:fs");
  const { createMemoryData } = await import("../core/data-memory.js");
  const { useData, startData, data } = await import("../core/data.js");
  const { loadWeather } = await import("../views/weather.js");
  const mem = createMemoryData();
  useData({ ...mem, get: (p) => (p.endsWith("/weather/warnings") ? Promise.reject(new Error("Failed to get document because the client is offline")) : mem.get(p)) });
  startData("u1");
  await data().set("settings/weather", { place: { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" } });
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => readFileSync(new URL("./fixtures/weather/forecast.json", import.meta.url), "utf8") });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const result = await loadWeather({ force: true, fetchImpl, storage, now: new Date("2026-11-21T12:00:00Z") });
  eq(result.place.name, "Hexham");
  eq(result.warnings_ok, false);
  ok(result.summary.days.length > 0);
});

test("the forecast error card uses plain wording, never the raw error text", async () => {
  const { failText } = await import("../views/weather.js");
  const plain = "Couldn't load the forecast \u2014 check your connection and try Refresh";
  eq(failText(new Error("Failed to get document because the client is offline")), plain);
  eq(failText(new Error("Timed out")), plain);
  eq(failText(new Error("Couldn't get the forecast right now")), plain);
  eq(failText(null), plain);
});
