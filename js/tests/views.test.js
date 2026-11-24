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

// ---- Calendar tab, Overview card and "Your day"
test("previewState shows what was understood and needs a date to save", async () => {
  const { previewState } = await import("../views/calendar.js");
  const { parse } = await import("../calendar/parse.js");
  eq(previewState("dentist tuesday 2pm", "2026-11-23"), { fields: parse("dentist tuesday 2pm", "2026-11-23"), line: "Dentist — Tue 24 Nov, 2pm", canSave: true });
  eq(previewState("buy milk", "2026-11-23").canSave, false);
  eq(previewState("tuesday", "2026-11-23").canSave, false);   // no title
  eq(previewState("bins every other tuesday", "2026-11-23").line, "Bins — every other Tuesday, from Tue 24 Nov");
});

test("the preview marks every guess the parser was unsure about", async () => {
  const { unsureNotes } = await import("../views/calendar.js");
  const { parse } = await import("../calendar/parse.js");
  eq(unsureNotes(parse("meet jo at 5:30", "2026-11-23")), ["Is 5.30pm right?"]);
  eq(unsureNotes(parse("tidy garden every spring", "2026-11-23")), ["Check the date"]);
  eq(unsureNotes(parse("tuesday", "2026-11-23")), ["Add a title"]);
  eq(unsureNotes(parse("dentist tuesday 2pm", "2026-11-23")), []);
});

test("when Save is off, a note says why (date first, then title)", async () => {
  const { saveNote } = await import("../views/calendar.js");
  eq(saveNote({ date: null, title: "" }), "Pick a date to save");
  eq(saveNote({ date: null, title: "Dentist" }), "Pick a date to save");
  eq(saveNote({ date: "2026-11-24", title: "  " }), "Add a title to save");
  eq(saveNote({ date: "2026-11-24", title: "Dentist" }), "");
});

test("the Reminders settings card is registered after the lessons card", async () => {
  const { registerCalendar } = await import("../views/calendar.js");
  const { createRegistry } = await import("../core/registry.js");
  const r = createRegistry();
  registerCalendar({ registerCard: r.registerCard, registerDayPart: r.registerDayPart, registerSettingsCard: r.registerSettingsCard });
  eq(r.settingsCards().map((c) => [c.id, c.order]), [["reminders", 40]]);
});

test("the Overview card lists today, then deadlines due in the next 3 days, and flags overdue", async () => {
  const { cardModel } = await import("../views/calendar.js");
  const ev = (over) => ({ id: "e", title: "X", kind: "job", date: "2026-11-23", time: null, repeat: null, until: null, skipped: [], done: [], note: "", ...over });
  const m = cardModel([
    ev({ id: "a", title: "Dentist", kind: "appointment", time: "14:00" }),
    ev({ id: "b", title: "Tax", kind: "deadline", date: "2026-11-26" }),
    ev({ id: "c", title: "Later", kind: "deadline", date: "2026-11-27" }),
    ev({ id: "d", title: "Old", kind: "deadline", date: "2026-11-20" }),
    ev({ id: "f", title: "Done", kind: "deadline", date: "2026-11-24", done: ["2026-11-24"] }),
  ], { days: {}, settings: null }, "2026-11-23");
  eq(m.today.map((o) => o.title), ["Dentist"]);
  eq(m.soon.map((o) => o.title), ["Tax"]);
  eq(m.overdue.map((o) => o.title), ["Old"]);
  eq(m.empty, false);
  eq(cardModel([], null, "2026-11-23").empty, true);
});

test("the Calendar view places text only with textContent", async () => {
  const view = await sourceOf("../views/calendar.js");
  ok(!/innerHTML/.test(view), "uses innerHTML");
  ok(!/html\s*:/.test(view), "uses the el html option");
});

test("the calendar card and day part are registered in the right places", async () => {
  const { registerCalendar } = await import("../views/calendar.js");
  const { createRegistry } = await import("../core/registry.js");
  const r = createRegistry();
  registerCalendar({ registerCard: r.registerCard, registerDayPart: r.registerDayPart, registerSettingsCard: r.registerSettingsCard });
  eq(r.cards().map((c) => [c.id, c.order, c.size, c.title]), [["calendar", 20, "small", "Calendar"]]);
  eq(r.dayParts().map((p) => [p.id, p.order]), [["calendar", 10]]);
  eq(r.cards()[0].empty({ empty: true }), "Nothing on today");
  eq(r.cards()[0].empty({ empty: false }), null);
});

test("the Calendar tab is the second tab", async () => {
  const { tab } = await import("../views/calendar.js");
  eq([tab.id, tab.label, tab.icon, tab.order], ["calendar", "Calendar", "calendar", 20]);
});

// ------------------------------------------------------------------ Trading, Research and Strategy lab

test("trading tabs register with ids trading, research and lab in that order", async () => {
  const { createRegistry } = await import("../core/registry.js");
  const trading = await import("../views/trading.js");
  const research = await import("../views/research.js");
  const lab = await import("../views/lab.js");
  const r = createRegistry();
  for (const view of [lab, trading, research]) r.registerTab(view.tab);
  eq(r.tabs().map((t) => [t.id, t.label, t.order]), [["trading", "Trading", 50], ["research", "Research", 60], ["lab", "Strategy lab", 70]]);
  eq(trading.tab.icon, "picks");
  eq(typeof trading.tab.mount, "function");
  eq(typeof research.tab.mount, "function");
  eq(typeof lab.tab.mount, "function");
});

test("research says a missing ticker is not followed", async () => {
  const { tickerState, NOT_FOLLOWED } = await import("../views/research.js");
  eq(NOT_FOLLOWED, "The model doesn't follow this stock");
  const universe = [{ ticker: "AAPL", name: "Apple", sector: "Technology", source: "sp500" }];
  eq(tickerState("ZZZZ", universe, null), { followed: false, message: "The model doesn't follow this stock" });
  eq(tickerState("AAPL", universe, null).followed, false, "in the list but no document yet is still not followed");
  const doc = { ticker: "AAPL", prices: [{ date: "2026-11-20", close: 100 }], rank: null };
  const found = tickerState("AAPL", universe, doc);
  eq([found.followed, found.stock.name], [true, "Apple"]);
  eq(tickerState("XLE", universe, { ticker: "XLE", prices: [] }).stock, { ticker: "XLE", name: "", sector: "", source: "" }, "a followed ETF that is not in the list still shows");
});

test("research picks the newest rows and never trusts missing arrays", async () => {
  const { newest, earningsSummary } = await import("../views/research.js");
  eq(newest(undefined, 10), []);
  eq(newest([1, 2, 3], 2), [1, 2]);
  const e = earningsSummary([
    { report_at: "2026-10-30 16:00:00", eps_actual: 1.5, eps_estimate: 1.4, surprise_pct: 7 },
    { report_at: "2027-01-30 16:00:00", eps_actual: null, eps_estimate: 1.6 },
    { report_at: "2026-07-30 16:00:00", eps_actual: 1.2, eps_estimate: 1.2, surprise_pct: 0 }], new Date("2026-11-24T12:00:00Z"));
  eq([e.last.report_at, e.next.report_at], ["2026-10-30 16:00:00", "2027-01-30 16:00:00"]);
  eq(earningsSummary([], new Date()), { last: null, next: null });
});

test("trading pieces: latest evaluations, drawdown text and blocks", async () => {
  const { latestRows, blocksText, outcomeKind } = await import("../views/lab.js");
  const evals = [
    { name: "v1", as_of: "2026-11-08", is_champion: false }, { name: "v1", as_of: "2026-11-15", is_champion: true },
    { name: "trader", as_of: "2026-11-15" }, { name: "v2", as_of: "2026-11-15", failed_rules: [1, 3] }];
  eq(latestRows(evals).latest, "2026-11-15");
  eq(latestRows(evals).rows.map((e) => e.name), ["v1", "v2"]);
  eq(latestRows([]), { latest: null, rows: [] });
  eq(blocksText({ blocks: [0.1, -0.2, 0.3] }), "2 of 3");
  eq(blocksText({}), "—");
  eq(outcomeKind({ error: "x" }), "error");
  eq(outcomeKind({ is_champion: true }), "champion");
  eq(outcomeKind({ failed_rules: [] }), "passed");
  eq(outcomeKind({ failed_rules: [2] }), "failed");
  eq(outcomeKind({}), "none");
});

test("the trading page builds its notices and rows from the documents", async () => {
  const { noticeLines, rankingRows } = await import("../views/trading.js");
  const today = { day: "2026-11-20", late: true, status: "ok", published_at: "2026-11-20T11:45:00Z",
    payload: { picks: [], problems: ["A source failed"], sources_missing: ["news"], champion: "hgb", universe_size: 571, signal_date: "2026-11-19", message: null } };
  const lines = noticeLines(today, { engine: { sold_early: [{ ticker: "NVDA", opened: "2026-11-17", sold_on: "2026-11-19", sell_on: "2026-11-24" }] } });
  ok(lines.some(([cls, t]) => cls === "warn" && t.startsWith("Published after the market opened")));
  ok(lines.some(([, t]) => t === "A source failed"));
  ok(lines.some(([, t]) => t === "Not available this morning: news."));
  ok(lines.some(([, t]) => t.startsWith("Sold early: NVDA")));
  ok(lines.at(-1)[1].includes("model hgb · 571 stocks ranked · prices from Thu 19 Nov"));
  eq(rankingRows(undefined), []);
  const rows = rankingRows([{ ticker: "AAPL", name: "Apple", sector: "Tech", source: "sp500", top_pct: 1, change: 0.01 }, { ticker: "X", source: "weird" }]);
  eq(rows.map((r) => [r.n, r.ticker, r.from, r.rank, r.tone]), [[1, "AAPL", "S&P 500", "Top 1%", "up"], [2, "X", "weird", "—", ""]]);
});

test("chart helpers show signs by the value as shown", async () => {
  const { pctOrDash, signClass } = await import("../trading/charts.js");
  eq(pctOrDash(0.0123), "+1.23%");
  eq(pctOrDash(-0.5), "−50.00%");
  eq(pctOrDash(-0.00003), "0.00%");
  eq(pctOrDash(null), "—");
  eq(pctOrDash(NaN), "—");
  eq([signClass(0.02), signClass(-0.02), signClass(-0.00003), signClass(null)], ["up", "down", "", ""]);
});

test("the Trading, Research and Lab views and chart helpers place text only with textContent", async () => {
  for (const file of ["../views/trading.js", "../views/research.js", "../views/lab.js", "../trading/charts.js"]) {
    const view = await sourceOf(file);
    ok(!/innerHTML/.test(view), `${file} uses innerHTML`);
    ok(!/html\s*:/.test(view), `${file} uses the el html option`);
    ok(!/\/api\//.test(view), `${file} calls /api`);
    ok(!/simulator/i.test(view.replace(/\/\/.*$/gm, "")), `${file} mentions the simulator in code`);
  }
});

test("the vendored Lightweight Charts file matches the hash in vendor/README.md and is cached", async () => {
  const readme = await sourceOf("../../vendor/README.md");
  const { createHash } = typeof document === "undefined" ? await import("node:crypto") : { createHash: null };
  const file = "lightweight-charts.standalone.production.js";
  const m = new RegExp("`" + file.replace(/\./g, "\\.") + "`[^`]*`([0-9a-f]{64})`").exec(readme);
  ok(m, "vendor/README.md lists the file with its SHA-256");
  ok(/4\.2\.3/.test(readme), "version noted");
  if (createHash) {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(new URL("../../vendor/" + file, import.meta.url));
    eq(createHash("sha256").update(bytes).digest("hex"), m[1]);
  }
  ok((await sourceOf("../../index.html")).includes(`<script defer src="vendor/${file}"></script>`), "index.html loads it");
});

test("the trading fixtures follow the document contract and feed the pure pieces", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = async (name) => JSON.parse(await readFile(new URL(`./fixtures/trading/${name}.json`, import.meta.url), "utf8"));
  const docs = {};
  for (const name of ["status", "today", "account", "record", "unlock", "lab", "universe"]) {
    docs[name] = await load(name);
    ok(typeof docs[name].madeAt === "string", `${name} has madeAt`);
  }
  const ticker = await load("tradingTickers/AAPL");
  const day = await load("tradingPicks/2026-11-20");
  eq([ticker.ticker, ticker.prices.length, typeof ticker.rank], ["AAPL", 126, "object"]);
  eq(day.day, "2026-11-20");
  eq(Object.keys(ticker.prices[0]), ["date", "open", "high", "low", "close"]);
  const { noticeLines, rankingRows } = await import("../views/trading.js");
  ok(noticeLines(docs.today, docs.status).length >= 1);
  ok(rankingRows(docs.today.payload.ranking).some((r) => r.name.length === 80), "an 80-character unbroken name is seeded");
  const { latestRows } = await import("../views/lab.js");
  eq(latestRows(docs.lab.evaluations).latest, "2026-11-15");
  const { tickerState } = await import("../views/research.js");
  eq(tickerState("AAPL", docs.universe.rows, ticker).followed, true);
});

test("cleanSeries sorts by date, drops duplicates and invalid points", async () => {
  const { cleanSeries } = await import("../trading/charts.js");
  const out = cleanSeries([
    { time: "2026-11-19", value: 3 }, { time: "2026-11-17", value: 1 }, { time: "2026-11-19", value: 4 }, { time: "bad", value: 2 },
    { time: "2026-11-18", value: NaN }, { time: "2026-11-18", value: null }, null, { time: "2026-11-20", value: 5 }]);
  eq(out, [{ time: "2026-11-17", value: 1 }, { time: "2026-11-19", value: 4 }, { time: "2026-11-20", value: 5 }]);
  eq(cleanSeries(undefined), []);
});

test("trading dates are written by the London formatters, not raw", async () => {
  const { dayText, londonDate } = await import("../trading/text.js");
  eq(dayText("2026-11-20"), "Fri 20 Nov");
  eq(dayText("nonsense"), "nonsense");
  eq(dayText(null), "—");
  eq(londonDate("2026-07-01T23:30:00Z"), "Thu 2 Jul");   // 00:30 in London, though still 1 July in UTC
  eq(londonDate(null), "—");
});

test("an empty Trading page says there are no picks once", async () => {
  const { emptyLines } = await import("../views/trading.js");
  const now = new Date("2026-11-24T15:00:00Z");          // after the arrival time on a trading day
  const lines = emptyLines(null, { minutes: { used: 100, limit: 2000 } }, now);
  eq(lines.filter(([, t]) => t.startsWith("No picks yet today")).length, 1);
  ok(lines.some(([, t]) => t.startsWith("The model prepares them after")));
});

test("the trading views show no raw date strings", async () => {
  for (const file of ["../views/trading.js", "../views/research.js", "../views/lab.js"]) {
    const src = await sourceOf(file);
    ok(!/\.slice\(0,\s*10\)/.test(src), `${file} slices a date out of a timestamp`);
    ok(!/\$\{[^}]*\.(day|as_of|signal_date|champion_since)\}/.test(src), `${file} shows a raw date`);
  }
});

test("tab orders are unique and the phone bar's first four are Overview, Calendar, Lessons, Weather", async () => {
  const { createRegistry } = await import("../core/registry.js");
  const { splitTabs } = await import("../core/tabbar.js");
  const r = createRegistry();
  for (const file of ["overview", "calendar", "lessons", "weather", "trading", "research", "lab", "settings"]) r.registerTab((await import(`../views/${file}.js`)).tab);
  const orders = r.tabs().map((t) => t.order);
  eq(new Set(orders).size, orders.length, "no ties");
  eq(r.tabs().map((t) => t.id), ["overview", "calendar", "lessons", "weather", "trading", "research", "lab", "settings"]);
  const { bar, more } = splitTabs(r.tabs());
  eq(bar.map((t) => t.id), ["overview", "calendar", "lessons", "weather"]);
  eq(more.map((t) => t.id), ["trading", "research", "lab", "settings"]);
});

test("research with no published stock list says stocks appear after the first run", async () => {
  const { tickerState, NO_UNIVERSE } = await import("../views/research.js");
  eq(NO_UNIVERSE, "Stocks appear here after the trading engine's first online run");
  eq(tickerState("AAPL", null, null), { followed: false, message: NO_UNIVERSE });
  eq(tickerState("AAPL", [], null).message, "The model doesn't follow this stock", "a published list that lacks it still says not followed");
});

test("a closed-market day shows only that the market was closed", async () => {
  const { sitOutLine } = await import("../views/trading.js");
  const now = new Date("2026-11-24T15:00:00Z");
  eq(sitOutLine({ day: "2026-11-24", status: "market closed", payload: { picks: [] } }, now), null);
  eq(sitOutLine({ day: "2026-11-24", status: "no picks", payload: { picks: [] } }, now), "The model sits out today: no stock scored above its confidence level.");
});

test("trading wording uses the date while London is a day ahead of New York", async () => {
  const { onToday, picksPhrase } = await import("../trading/text.js");
  const early = new Date("2026-11-24T02:00:00Z");   // 02:00 Tue in London, 21:00 Mon in New York
  const noon = new Date("2026-11-24T15:00:00Z");
  eq(onToday(noon), "today");
  eq(onToday(early), "on Mon 23 Nov");
  eq(picksPhrase({ count: 0, status: "no picks" }, null, noon), "The model sits out today");
  eq(picksPhrase({ count: 0, status: "no picks" }, null, early), "The model sits out on Mon 23 Nov");
  eq(picksPhrase({ count: 3, status: "ok" }, null, early), "3 picks ready for Mon 23 Nov");
  eq(picksPhrase({ count: null, expected_after: "2026-11-23T11:00:00Z" }, null, early), "The picks for Mon 23 Nov aren't ready yet");
});
