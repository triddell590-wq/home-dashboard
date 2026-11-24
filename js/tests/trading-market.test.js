// Port of the Mac's tests/engine/test_market_calendar.py, case for case. No network.
import { test, eq, ok } from "./harness.js";
import { holidays, isTradingDay, earlyClose, nyToUtc, nyDay, marketStatus } from "../trading/market.js";

// An instant given as New York wall-clock time, as the Python test's ny() does.
const ny = (ymd, clock) => nyToUtc(ymd, clock);
const utc = (text) => new Date(text.replace(" ", "T") + ":00Z").getTime();

test("2026 holidays by rule", () => {
  const h = holidays(2026);
  eq(h.get("2026-01-01"), "New Year's Day");
  eq(h.get("2026-01-19"), "Martin Luther King Jr. Day");
  eq(h.get("2026-02-16"), "Presidents' Day");
  eq(h.get("2026-04-03"), "Good Friday");
  eq(h.get("2026-05-25"), "Memorial Day");
  eq(h.get("2026-06-19"), "Juneteenth");
  eq(h.get("2026-07-03"), "Independence Day");          // 4 July is a Saturday
  eq(h.get("2026-09-07"), "Labor Day");
  eq(h.get("2026-11-26"), "Thanksgiving");
  eq(h.get("2026-12-25"), "Christmas");
  eq(h.size, 10);
});

test("observed rules", () => {
  ok(holidays(2022).has("2022-12-26"));                  // Christmas on a Sunday
  ok(!holidays(2021).has("2021-12-31") && !holidays(2022).has("2022-01-01"));   // Saturday New Year
  ok(!isTradingDay("2026-11-26") && !isTradingDay("2026-11-14"));
  ok(isTradingDay("2026-11-27"));
});

test("early closes", () => {
  ok(earlyClose("2026-11-27") && earlyClose("2026-12-24"));
  ok(!earlyClose("2026-07-03"));                          // a holiday that year, not an early close
  ok(earlyClose("2025-07-03"));
});

test("status through a day", () => {
  const pre = marketStatus(ny("2026-11-12", "08:00"));
  eq(pre.state, "pre");
  eq(pre.next_open_at, "2026-11-12T14:30:00.000Z");
  const open = marketStatus(ny("2026-11-12", "10:00"));
  eq(open.state, "open");
  eq(open.closes_at, "2026-11-12T21:00:00.000Z");
  const after = marketStatus(ny("2026-11-12", "16:30"));
  eq(after.state, "after");
  eq(after.next_open_at, "2026-11-13T14:30:00.000Z");
});

test("weekend and holiday", () => {
  const s = marketStatus(ny("2026-11-14", "12:00"));
  eq([s.state, s.reason, s.next_open_at], ["closed", "weekend", "2026-11-16T14:30:00.000Z"]);
  eq([s.opens_at, s.closes_at, s.holiday_name], [null, null, null]);
  const t = marketStatus(ny("2026-11-26", "12:00"));
  eq([t.state, t.reason, t.holiday_name], ["closed", "holiday", "Thanksgiving"]);
  eq([t.next_open_at, t.next_close_at], ["2026-11-27T14:30:00.000Z", "2026-11-27T18:00:00.000Z"]);
});

test("weeks when UK and US clocks differ", () => {
  eq(marketStatus(ny("2026-03-10", "08:00")).opens_at, "2026-03-10T13:30:00.000Z");   // US summer time, UK not yet
  eq(marketStatus(ny("2026-10-27", "08:00")).opens_at, "2026-10-27T13:30:00.000Z");   // UK back to GMT, US not yet
});

test("nyToUtc across both clock changes", () => {
  eq(nyToUtc("2026-03-07", "09:30").getTime(), utc("2026-03-07 14:30"));   // day before US spring forward: EST
  eq(nyToUtc("2026-03-09", "09:30").getTime(), utc("2026-03-09 13:30"));   // day after: EDT
  eq(nyToUtc("2026-11-01", "09:30").getTime(), utc("2026-11-01 14:30"));   // fall-back day, after the change: EST
  eq(nyToUtc("2026-11-01", "00:30").getTime(), utc("2026-11-01 04:30"));   // before the change: still EDT
});

test("nyDay is the New York calendar day", () => {
  eq(nyDay(new Date("2026-11-24T03:30:00Z")), "2026-11-23");
  eq(nyDay(new Date("2026-11-24T05:30:00Z")), "2026-11-24");
});
