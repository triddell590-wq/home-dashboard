// Pure wording for the online Trading tabs. Ported from the Mac's day, overview and research tests, plus the online notices.
import { test, eq } from "./harness.js";
import { marketPhrase, picksPhrase, picksSummary, runNotice, madeText, minutesText, growthSeries, excessVsSpy, rankText,
  holdText, outlookText, chartText, skippedText, causeSplitText, lessonText, matchStocks } from "../trading/text.js";

// Times are Europe/London whatever the device's zone, so these run the same under any TZ. November is GMT, so 14:30Z reads 14:30.
const Z = (text) => new Date(text);

test("market phrases for each state", () => {
  const opens = "2026-11-12T14:30:00Z";
  const now = Z("2026-11-12T12:16:00Z");
  eq(marketPhrase({ state: "pre", opens_at: opens, closes_at: "2026-11-12T21:00:00Z" }, now), "Market opens at 14:30 (in 2h 14m)");
  eq(marketPhrase({ state: "open", opens_at: opens, closes_at: "2026-11-12T21:00:00Z" }, now), "Market open · closes at 21:00");
  eq(marketPhrase({ state: "after", next_open_at: "2026-11-13T14:30:00Z", next_close_at: "2026-11-13T21:00:00Z" }, Z("2026-11-12T21:30:00Z")),
    "Market closed · opens tomorrow 14:30");
});

test("market phrases read London time, not UTC, in summer", () => {
  eq(marketPhrase({ state: "open", opens_at: "2026-07-14T13:30:00Z", closes_at: "2026-07-14T20:00:00Z" }, Z("2026-07-14T15:00:00Z")),
    "Market open · closes at 21:00");
});

test("weekend phrase names the day", () => {
  eq(marketPhrase({ state: "closed", reason: "weekend", next_open_at: "2026-11-16T14:30:00Z", next_close_at: "2026-11-16T21:00:00Z" },
    Z("2026-11-14T12:00:00Z")), "Closed for the weekend · opens Monday 14:30");
});

test("holiday phrase mentions an early close", () => {
  eq(marketPhrase({ state: "closed", reason: "holiday", holiday_name: "Thanksgiving", next_open_at: "2026-11-27T14:30:00Z",
    next_close_at: "2026-11-27T18:00:00Z" }, Z("2026-11-26T12:00:00Z")), "Closed for Thanksgiving · opens tomorrow 14:30, closes early at 18:00");
});

test("an early close today is mentioned while open", () => {
  eq(marketPhrase({ state: "open", opens_at: "2026-11-27T14:30:00Z", closes_at: "2026-11-27T18:00:00Z" }, Z("2026-11-27T15:00:00Z")),
    "Market open · closes early at 18:00");
});

test("picks phrases", () => {
  const pre = { state: "pre" };
  const expected = "2026-11-12T11:00:00Z";
  const at = (h) => Z(`2026-11-12T${h}:00:00Z`);
  eq(picksPhrase({ count: 5, status: "published", late: false, expected_after: expected }, pre, at("12")), "5 picks ready for today");
  eq(picksPhrase({ count: 1, status: "published", late: false, expected_after: expected }, pre, at("12")), "1 pick ready for today");
  eq(picksPhrase({ count: 0, status: "no picks", late: false, expected_after: expected }, pre, new Date()), "The model sits out today");
  eq(picksPhrase({ count: 4, status: "published", late: true, expected_after: expected }, pre, new Date()), "Late picks: published after the open");
  eq(picksPhrase({ count: null, status: null, late: null, expected_after: expected }, pre, at("07")), "The model prepares today's picks after 11:00");
  eq(picksPhrase({ count: null, status: null, late: null, expected_after: expected }, pre, at("12")), "Today's picks aren't ready yet");
  eq(picksPhrase({ count: null, status: null, late: null, expected_after: expected }, { state: "closed", reason: "weekend" },
    Z("2026-11-14T12:00:00Z")), null);
});

// ---- the pure parts of the Mac's overview.test.js
const fwd = { days: [{ day: "2026-11-12", pick_return: 0.01, spy_return: 0.005 }, { day: "2026-11-13", pick_return: -0.02, spy_return: 0.0 }] };

test("growth of $100,000 for the model and SPY", () => {
  const g = growthSeries(fwd);
  eq(g.model.map((p) => Math.round(p.value * 100) / 100), [101000, 98980]);
  eq(g.spy.map((p) => Math.round(p.value * 100) / 100), [100500, 100500]);
  eq(g.model.map((p) => p.time), ["2026-11-12", "2026-11-13"]);
  eq(growthSeries({ days: [] }), { model: [], spy: [] });
});

test("excess over SPY compounds both sides", () => {
  const e = excessVsSpy(fwd);
  eq(e.days, 2);
  eq(Math.round(e.excess * 1e6) / 1e6, Math.round((1.01 * 0.98 - 1.005) * 1e6) / 1e6);
  eq(excessVsSpy({ days: [] }), { excess: null, days: 0 });
});

test("ranks replace scores", () => {
  eq(rankText({ rank: 3, of: 571, top_pct: 1 }), "Top 1% · #3 of 571");
  eq(rankText({ score: 99.5 }), "");
});

test("hold wording for 1-day and 5-day picks", () => {
  eq(holdText({ hold: 1, sell_on: "2026-11-18" }), "sold at the next open");
  eq(holdText({ hold: 5, sell_on: "2026-11-23" }), "held 5 trading days, sold at the open on Mon 23 Nov");
  eq(holdText({}), "sold at the next open");
});

test("outlook wording makes no market-direction call", () => {
  eq(outlookText({ label: "Stronger than usual", vix: 17.4 }),
    { label: "Stronger than usual", sentence: "Today's picks stand out from the other stocks more than usual · market fear (VIX) 17" });
  eq(outlookText({ label: "Weaker than usual", vix: null }).sentence, "Today's picks stand out from the other stocks less than usual");
  eq(outlookText({ label: "About usual" }).sentence, "Today's picks stand out from the other stocks about as much as usual");
  eq(outlookText({ label: "Learning what's usual" }).sentence, "The model is still learning what a usual day looks like (it needs ten mornings)");
  eq(outlookText({ label: "Sitting out" }).sentence, "No stock cleared the model's confidence level, so it stays in cash today");
  eq(outlookText({ label: "Bullish", share_positive: 1 }).label, "Bullish");
});

test("chart check wording", () => {
  eq(chartText({ p_up: 0.642 }), "Chart check: 64% chance it rises more than costs over the hold");
  eq(chartText({}), "");
});

test("skipped-by-the-chart wording", () => {
  eq(skippedText({ ticker: "NVDA", reasons: ["Overbought (RSI 14 above 75)", "Just under resistance"] }),
    "Skipped by the chart: overbought (RSI 14 above 75); just under resistance");
  eq(skippedText({ ticker: "X", reasons: [] }), "Skipped by the chart");
});

test("losses split by cause, in words", () => {
  eq(causeSplitText({ shock: 0.4, research: 0.25, chart: 0.15, unforeseeable: 0.2 }),
    "Losses: 40% shocks, 25% research misses, 15% chart misses, 20% unforeseeable");
  eq(causeSplitText({}), "");
});

test("a lesson in words", () => {
  eq(lessonText({ description: "VIX is in its top fifth", change: { kind: "skip" }, status: "adopted",
    judged: { with: { score: 0.82 }, without: { score: 0.55 } } }),
    "When VIX is in its top fifth: skip the stock (adopted · test year score 0.82 vs 0.55 without)");
  eq(lessonText({ description: "RSI 14 is in its top fifth", change: { kind: "entry", add: 0.1 }, status: "waiting: trader off" }),
    "When RSI 14 is in its top fifth: the trader needs a 10-point higher chart check (waiting: trader off)");
  eq(lessonText({ description: "VIX is in its top fifth", change: { kind: "half" }, status: "candidate" }),
    "When VIX is in its top fifth: buy half as much (candidate)");
});

// ---- from the Mac's research.test.js
const list = [{ ticker: "NVDA", name: "NVIDIA" }, { ticker: "NVR", name: "NVR Inc." }, { ticker: "INVH", name: "Invitation Homes" },
  { ticker: "ANVS", name: "Annovis Bio" }];

test("ticker prefixes first, then name prefixes, then names containing the text", () => {
  eq(matchStocks(list, "nv").map((s) => s.ticker), ["NVDA", "NVR", "INVH"]);
  eq(matchStocks(list, "annov").map((s) => s.ticker), ["ANVS"]);
  eq(matchStocks(list, "  NVID ").map((s) => s.ticker), ["NVDA"]);
});

test("empty text matches nothing and the limit holds", () => {
  eq(matchStocks(list, ""), []);
  eq(matchStocks(list, "   "), []);
  eq(matchStocks(list, "n", 2).length, 2);
});

// ---- new for the online dashboard
const T = (s) => new Date(s);
const picksOf = (day, n = 3) => ({ day, status: "published", late: false, payload: { picks: Array(n).fill({}) } });

test("picksSummary has the shape /api/day gave, for today's picks", () => {
  const now = T("2026-11-24T14:00:00Z");
  eq(picksSummary(picksOf("2026-11-24"), now), { day: "2026-11-24", count: 3, status: "published", late: false,
    expected_after: "2026-11-24T11:00:00.000Z" });
});

test("picksSummary is empty when the last picks are from an earlier day", () => {
  const now = T("2026-11-24T14:00:00Z");
  eq(picksSummary(picksOf("2026-11-23"), now), { day: null, count: null, status: null, late: null,
    expected_after: "2026-11-24T11:00:00.000Z" });
  eq(picksSummary({ day: null }, now).count, null);
  eq(picksSummary(null, now).day, null);
});

const failed = (finished, day = "2026-11-24") => ({ runs: { morning: { day, state: "failed", started: "2026-11-24T10:50:00Z", finished } } });

test("runNotice says the morning failed and shows yesterday's picks", () => {
  const now = T("2026-11-24T14:00:00Z");
  const fin = "2026-11-24T11:24:00Z";
  eq(runNotice(failed(fin), picksOf("2026-11-23"), now), "This morning's run failed at 11:24 — showing yesterday's picks");
  eq(runNotice(failed(fin), picksOf("2025-11-14"), now), "This morning's run failed at 11:24 — showing the picks from Fri 14 Nov");
  eq(runNotice(failed(fin), picksOf("2026-11-24"), now), null);          // today's picks did arrive
});

test("runNotice treats a run older than 2 hours as failed", () => {
  const now = T("2026-11-24T12:00:00Z");                                 // 07:00 in New York, too early for the no-picks line
  const running = (mins) => ({ runs: { morning: { day: "2026-11-24", state: "running",
    started: new Date(now.getTime() - mins * 60e3).toISOString(), finished: null } } });
  const line = runNotice(running(121), picksOf("2026-11-23"), now);
  eq(line, "This morning's run failed at 09:59 — showing yesterday's picks");
  eq(runNotice(running(119), picksOf("2026-11-23"), now), null);
});

test("runNotice says \"No picks yet today\" after 09:30 New York on a trading day with no picks", () => {
  const ok = { runs: { morning: { day: "2026-11-24", state: "ok", started: "2026-11-24T11:00:00Z", finished: "2026-11-24T11:20:00Z" } } };
  eq(runNotice(ok, picksOf("2026-11-23"), T("2026-11-24T14:31:00Z")), "No picks yet today — showing the picks from Mon 23 Nov");
  eq(runNotice(ok, picksOf("2026-11-23"), T("2026-11-24T14:29:00Z")), null);        // before 09:30
  eq(runNotice(ok, picksOf("2026-11-20"), T("2026-11-21T15:00:00Z")), null);        // a Saturday
  eq(runNotice(ok, picksOf("2026-11-24"), T("2026-11-24T15:00:00Z")), null);        // picks are in
  eq(runNotice(ok, { day: null }, T("2026-11-24T15:00:00Z")), "No picks yet today");
});

test("madeText says which run the data came from, by the London day", () => {
  const now = T("2026-11-24T20:00:00Z");
  eq(madeText("2026-11-24T11:20:00Z", "morning", now), "As of this morning's run");
  eq(madeText("2026-11-24T19:10:00Z", "evening", now), "As of this evening's run");
  eq(madeText("2025-11-14T22:41:00Z", "evening", now), "As of Fri 14 Nov 22:41");
  // 23:30Z in July is 00:30 next day in London, so a "today" in London is not "today" in UTC
  eq(madeText("2026-07-14T23:30:00Z", "evening", T("2026-07-15T08:00:00Z")), "As of this evening's run");
  eq(madeText("2026-07-14T22:30:00Z", "evening", T("2026-07-15T08:00:00Z")), "As of Tue 14 Jul 23:30");
});

test("minutesText warns from 1,700 of 2,000", () => {
  eq(minutesText({ used: 1700, limit: 2000 }), "GitHub minutes: 1,700 of 2,000 used this month — retries are off until the 1st");
  eq(minutesText({ used: 1699, limit: 2000 }), null);
  eq(minutesText(null), null);
});
