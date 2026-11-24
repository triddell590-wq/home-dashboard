// The trading Overview cards, the "Your day" phrases and the Settings card, on the memory backend. Never online.
import { test, eq, ok } from "./harness.js";
import { createMemoryData } from "../core/data-memory.js";
import { useData, startData } from "../core/data.js";
import { createRegistry } from "../core/registry.js";
import { registerTrading, PRACTICE_NOTE, moneyLines, winRateOf } from "../trading/cards.js";
import { checkTradingSettings, saveTradingSettings } from "../trading/settings-card.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
function fresh() {
  const backend = createMemoryData();
  useData(backend);
  startData("u1");
  return backend;
}
function registered() {
  const r = createRegistry();
  registerTrading({ registerCard: r.registerCard, registerDayPart: r.registerDayPart, registerSettingsCard: r.registerSettingsCard });
  return r;
}
const card = (r, id) => r.cards().find((c) => c.id === id);
const part = (r, id) => r.dayParts().find((p) => p.id === id);

test("cards register once with the Mac ids and orders", () => {
  const r = registered();
  eq(r.cards().map((c) => [c.id, c.order, c.size]), [
    ["outlook", 5, "large"], ["money", 10, "small"], ["vs_spy", 20, "small"], ["win_rate", 30, "small"],
    ["unlock", 40, "small"], ["growth", 100, "wide"], ["todays_picks", 110, "wide"]]);
  eq(r.dayParts().map((p) => [p.id, p.order]), [["market", 10], ["picks", 20]]);
  eq(r.settingsCards().map((c) => [c.id, c.order]), [["trading", 30]]);
  let threw = false;
  try { registerTrading({ registerCard: r.registerCard, registerDayPart: r.registerDayPart, registerSettingsCard: r.registerSettingsCard }); } catch { threw = true; }
  ok(threw, "a second registration is refused");
});

test("market day part uses the ported status", async () => {
  fresh();
  const now = new Date("2026-11-12T13:00:00Z");          // 08:00 in New York, a Thursday
  const phrase = await part(registered(), "market").load(now);
  ok(phrase.startsWith("Market opens at"), phrase);
});

test("picks day part says picks are ready only for today's document", async () => {
  const backend = fresh();
  const now = new Date("2026-11-12T13:00:00Z");
  const r = registered();
  await backend.set("users/u1/trading/today", { day: "2026-11-11", status: "published", late: false, payload: { picks: [{}, {}] } });
  ok(!/ready for today/.test(await part(r, "picks").load(now)), "yesterday's picks are not today's");
  await backend.set("users/u1/trading/today", { day: "2026-11-12", status: "published", late: false, payload: { picks: [{}, {}, {}] } });
  eq(await part(r, "picks").load(now), "3 picks ready for today");
});

test("win_rate card reads rose and total from trading/record", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/record", { rows: [], rose: 7, total: 12, madeAt: "2026-11-12T23:10:00Z" });
  const c = card(registered(), "win_rate");
  const got = await c.load();
  eq(winRateOf(got.doc), { rose: 7, total: 12 });
  eq(c.empty(got), null);
  await backend.set("users/u1/trading/record", { rows: [], rose: 0, total: 0 });
  ok(typeof c.empty(await c.load()) === "string", "no graded picks gives the empty message");
});

test("money card reads only trading/account and ends with the practice note", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/account", { equity: 101500, capital: 100000, openBatches: 1,
    equityRows: [{ d: "2026-11-02", e: 100000 }, { d: "2026-11-12", e: 101500 }], madeAt: "2026-11-12T23:10:00Z" });
  const asked = [];
  const real = backend.get;
  useData({ ...backend, get: (p) => { asked.push(p); return real(p); } });
  startData("u1");
  const c = card(registered(), "money");
  const got = await c.load();
  eq(asked, ["users/u1/trading/account"]);
  const lines = moneyLines(got.doc);
  eq(lines.at(-1), "Practice sessions are on your Mac");
  eq(PRACTICE_NOTE, "Practice sessions are on your Mac");
  ok(lines.includes("since 2026-11-02") && lines.includes("1 batch open"), lines.join("|"));
});

test("todays_picks shows the amber notice and keeps the last picks", async () => {
  const backend = fresh();
  const c = card(registered(), "todays_picks");
  await backend.set("users/u1/trading/today", { day: "2026-11-11", status: "published", payload: { picks: [{ ticker: "AAPL" }] } });
  await backend.set("users/u1/trading/status", { runs: { morning: { day: "2026-11-12", state: "failed", started: "2026-11-12T11:40:00Z", finished: "2026-11-12T11:50:00Z" } } });
  const got = await c.load(new Date("2026-11-12T15:00:00Z"));
  eq(c.empty(got), null);
  ok(/^This morning's run failed at \d\d:\d\d — showing yesterday's picks$/.test(got.notice), got.notice);
});

test("cards redraw only when the watched documents changed", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/record", { rows: [], rose: 1, total: 2 });
  const c = card(registered(), "win_rate");
  await c.load();
  let calls = 0;
  const stop = c.watch(() => { calls += 1; });
  await tick();
  eq(calls, 0);                                           // the first report equals what was read
  await backend.set("users/u1/trading/record", { rows: [], rose: 1, total: 2 });
  await tick();
  eq(calls, 0);
  await backend.set("users/u1/trading/record", { rows: [], rose: 2, total: 3 });
  await tick();
  eq(calls, 1);
  stop();
});

test("settings card rejects topN 11 and a bad email and saves a cleaned watchlist", async () => {
  eq(checkTradingSettings({ topN: "11", watchlist: "", secContact: "" }), { error: "top_n must be between 1 and 10" });
  eq(checkTradingSettings({ topN: "abc", watchlist: "", secContact: "" }), { error: "top_n must be a whole number" });
  eq(checkTradingSettings({ topN: "5", watchlist: "", secContact: "nope" }), { error: "The SEC contact must be an email address" });
  eq(checkTradingSettings({ topN: "5", watchlist: " aapl, msft ,, ", secContact: " me@example.com " }),
    { value: { topN: 5, watchlist: ["AAPL", "MSFT"], secContact: "me@example.com" } });
  eq(checkTradingSettings({ topN: "3", watchlist: "", secContact: "  " }).value.secContact, null);

  const writes = [];
  const events = [];
  const set = (path, value) => { writes.push([path, value]); return Promise.resolve(); };
  saveTradingSettings(set, { other: 1 }, { topN: "11", watchlist: "", secContact: "" }, { saved: () => events.push("saved"), failed: (m) => events.push(m) });
  eq(writes, []);
  eq(events, ["top_n must be between 1 and 10"]);
  events.length = 0;
  saveTradingSettings(set, { other: 1 }, { topN: "4", watchlist: "aapl, msft", secContact: "" }, { saved: () => events.push("saved"), failed: (m) => events.push(m) });
  eq(events, ["saved"]);
  await tick();
  eq(writes, [["settings/trading", { other: 1, topN: 4, watchlist: ["AAPL", "MSFT"], secContact: null }]]);
  // a write the server rejects is reported
  const got = [];
  saveTradingSettings(() => Promise.reject(new Error("raw")), {}, { topN: "4", watchlist: "", secContact: "" }, { saved() {}, failed: (m) => got.push(m) });
  await tick();
  eq(got, ["Couldn't save — try again"]);
});

test("the trading card files never assign innerHTML and the settings card only writes settings/trading", async () => {
  for (const file of ["cards.js", "settings-card.js"]) {
    const url = new URL(`../trading/${file}`, import.meta.url);
    const source = typeof document === "undefined" ? await (await import("node:fs/promises")).readFile(url, "utf8")
      : await (await fetch(url)).text();
    ok(!/innerHTML|html\s*:/.test(source), `${file} sets markup`);
    if (file === "settings-card.js") ok(!/trading\/(status|today|account|record|unlock|lab|universe)|tradingTickers|tradingPicks/.test(source), "touches a read-only path");
  }
});
