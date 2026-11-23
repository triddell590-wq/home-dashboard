// Node only (reads fixtures with node:fs). Ported from tests/test_weather_api.py: the Mac server's
// _weather() becomes getWeather(), with the copy kept per device in home-weather-forecast.
import { readFileSync } from "node:fs";
import { test, eq, ok } from "./harness.js";
import { getWeather, FORECAST_ERROR, REFRESH_ERROR, COPY_LIFE_MS, REFRESH_GAP_MS, WARNINGS_LIFE_MS, HOURS_SHOWN } from "../weather/forecast.js";

const T0 = new Date("2026-11-21T12:00:00Z");
const HEXHAM = { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" };
const PLYMOUTH = { name: "Plymouth", county: "Devon", nation: "England", lat: 50.37, lon: -4.14, region: "sw" };
const at = (ms) => new Date(T0.getTime() + ms);
const MIN = 60000, HOUR = 3600000;

// The two warnings in fixtures/weather/warnings_two.xml, as the job would write them.
const ITEMS = () => [
  { level: "yellow", kind: "wind", title: "Yellow warning of wind affecting North East England",
    headline: "Strong winds may cause some disruption. valid from 0600 Sun 22 Nov to 2100 Sun 22 Nov",
    starts: "2026-11-22T06:00:00+00:00", ends: "2026-11-22T21:00:00+00:00",
    link: "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings#?date=2026-11-22&id=aaa111" },
  { level: "amber", kind: "rain", title: "Amber warning of rain affecting North East England",
    headline: "Heavy rain likely to cause flooding.", starts: null, ends: null,
    link: "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings#?date=2026-11-23&id=bbb222" },
];
const warningsDoc = (over = {}) => ({ region: "ne", fetchedAt: T0.toISOString(), ok: true, items: ITEMS(), ...over });

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, keys: () => [...m.keys()] };
}
const brokenStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

/** A counting fake fetch serving the forecast fixture; switch `fail` to make it reject. */
function net() {
  const f = async () => {
    f.calls++;
    if (f.fail) throw new TypeError("down");
    return { ok: true, status: 200, text: async () => readFileSync(new URL("./fixtures/weather/forecast.json", import.meta.url), "utf8") };
  };
  f.calls = 0;
  f.fail = false;
  return f;
}
const get = (f, storage, o = {}) => getWeather({ place: HEXHAM, warnings: warningsDoc(), now: T0, fetchImpl: f, storage, ...o });
const rejection = async (p) => { try { await p; } catch (e) { return e.message; } throw new Error("expected a rejection"); };

test("constants", () => {
  eq([COPY_LIFE_MS, REFRESH_GAP_MS, WARNINGS_LIFE_MS, HOURS_SHOWN], [3600000, 60000, 21600000, 48]);
});

test("test_no_place", async () => {
  const f = net();
  eq(await getWeather({ place: null, warnings: null, now: T0, fetchImpl: f, storage: fakeStorage() }), { place: null });
  eq(f.calls, 0);
});

test("test_save_place_ok_and_region_may_be_none", async () => {
  const f = net(), s = fakeStorage();
  eq((await get(f, s)).place, HEXHAM);
  const body = await get(f, s, { place: { ...HEXHAM, region: null } });
  eq([body.warnings_ok, body.warnings], [false, []]);
});

test("test_first_get_fetches_and_stores", async () => {
  const f = net(), s = fakeStorage();
  const body = await get(f, s);
  eq(f.calls, 1);
  eq([body.stale, body.refresh_error, body.warnings_ok], [false, null, true]);
  eq(body.fetched_at, T0.toISOString());
  eq(body.warnings.length, 2);
  ok(body.current.words && body.current.icon);
  ok(body.hourly[0].words && body.hourly[0].icon);
  ok(body.summary.days.length);
});

test("test_second_get_within_hour_uses_copy", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  await get(f, s, { now: at(59 * MIN) });
  eq(f.calls, 1);
});

test("test_get_after_hour_refetches", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  const body = await get(f, s, { now: at(61 * MIN) });
  eq(f.calls, 2);
  eq(body.fetched_at, at(61 * MIN).toISOString());
});

test("test_hourly_starts_at_current_london_hour", async () => {
  const f = net(), s = fakeStorage();
  const now = new Date("2026-11-21T18:30:00Z");
  const hourly = (await get(f, s, { now })).hourly;
  ok(hourly[0].time.endsWith("T18:00"));
  eq(hourly.length, 48);
});

test("test_forecast_failure_with_copy_is_stale", async () => {
  const f = net(), s = fakeStorage();
  const first = await get(f, s);
  f.fail = true;
  const body = await get(f, s, { now: at(61 * MIN) });
  eq([body.stale, body.refresh_error], [true, REFRESH_ERROR]);
  eq(body.fetched_at, first.fetched_at);
  eq(body.current, first.current);
});

test("test_forecast_failure_without_copy_is_error", async () => {
  const f = net();
  f.fail = true;
  eq(await rejection(get(f, fakeStorage())), "Couldn't get the forecast right now");
  eq(FORECAST_ERROR, "Couldn't get the forecast right now");
});

test("test_warnings_failure_keeps_forecast", async () => {
  const body = await get(net(), fakeStorage(), { warnings: warningsDoc({ ok: false, items: [] }) });
  ok(body.current);
  eq([body.warnings_ok, body.warnings, body.stale], [false, [], false]);
});

test("test_place_change_clears_copy", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  f.fail = true;
  eq(await rejection(get(f, s, { place: PLYMOUTH, warnings: null })), FORECAST_ERROR);
});

test("test_copy_for_another_place_is_ignored", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  f.fail = true;
  eq(await rejection(get(f, s, { place: PLYMOUTH, warnings: null, now: at(5 * MIN) })), FORECAST_ERROR);
});

test("test_refresh_rate_limit", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s, { force: true });
  eq(f.calls, 1);
  await get(f, s, { force: true, now: at(30000) });
  eq(f.calls, 1);
  await get(f, s, { force: true, now: at(61000) });
  eq(f.calls, 2);
});

test("test_failed_refresh_backs_off", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  f.fail = true;
  await get(f, s, { now: at(61 * MIN) });
  eq(f.calls, 2);
  const body = await get(f, s, { now: at(61 * MIN + 30000) });
  eq(f.calls, 2);
  eq([body.stale, !!body.refresh_error], [true, true]);
  await get(f, s, { now: at(61 * MIN + 61000) });
  eq(f.calls, 3);
});

test("test_failed_forced_refresh_keeps_copy", async () => {
  const f = net(), s = fakeStorage();
  const first = await get(f, s);
  f.fail = true;
  const body = await get(f, s, { force: true, now: at(90000) });
  eq(f.calls, 2);
  eq([body.current, body.fetched_at], [first.current, first.fetched_at]);
  eq(body.refresh_error, REFRESH_ERROR);
});

test("test_no_copy_recovers_despite_backoff", async () => {
  const f = net(), s = fakeStorage();
  f.fail = true;
  await rejection(get(f, s));
  f.fail = false;
  ok((await get(f, s, { now: at(5000) })).current);
});

test("test_expired_warnings_are_not_returned", async () => {
  const items = ITEMS();
  items[0].ends = "2026-11-21T11:00:00+00:00"; // before T0 (12:00)
  items[1].ends = "2026-11-21T20:00:00+00:00";
  const body = await get(net(), fakeStorage(), { warnings: warningsDoc({ items }) });
  eq(body.warnings.map((w) => w.level), ["amber"]);
  eq(body.summary.day_phrase, "amber rain warning in force");
});

test("test_copy_with_no_days_left_still_answers", async () => {
  const f = net(), s = fakeStorage();
  await get(f, s);
  f.fail = true;
  const body = await get(f, s, { warnings: null, now: at(30 * 24 * HOUR) });
  eq([body.stale, body.summary.card, body.summary.day_phrase], [true, null, "no forecast available"]);
});

test("warnings older than 6 hours, or for another region, count as unavailable", async () => {
  const f = net(), s = fakeStorage();
  let body = await get(f, s, { warnings: warningsDoc({ fetchedAt: at(-6 * HOUR).toISOString() }) });
  eq([body.warnings, body.warnings_ok], [[], false]);
  body = await get(f, s, { warnings: warningsDoc({ fetchedAt: at(-6 * HOUR + 1000).toISOString() }) });
  eq([body.warnings.length, body.warnings_ok], [2, true]);
  body = await get(f, s, { warnings: warningsDoc({ region: "sw" }) });
  eq([body.warnings, body.warnings_ok], [[], false]);
  body = await get(f, s, { warnings: null });
  eq([body.warnings, body.warnings_ok], [[], false]);
});

test("a broken or foreign forecast copy counts as none", async () => {
  for (const raw of ["not json", '"a string"', '{"lat":54.97}', JSON.stringify({ lat: 54.97, lon: -2.1, fetchedAt: "x", data: {} })]) {
    const f = net(), s = fakeStorage({ "home-weather-forecast": raw });
    const body = await get(f, s);
    eq(f.calls, 1);
    ok(body.current && body.summary.days.length, raw);
  }
  const f = net();
  ok((await get(f, brokenStorage)).current);
  await get(f, brokenStorage, { now: at(MIN) });
  eq(f.calls, 2);
});

test("the copy is kept under home-weather-forecast and nothing else is touched", async () => {
  const s = fakeStorage({ "farm-ledger": "theirs", "home-theme": '"dark"' });
  await get(net(), s);
  eq(s.keys().sort(), ["farm-ledger", "home-theme", "home-weather-forecast"]);
  eq(s.getItem("farm-ledger"), "theirs");
});
