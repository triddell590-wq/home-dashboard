// Ported from ml-trading-strategy/tests/test_weather_summary.py plus test_guess_region and
// test_describe_code from tests/test_weather.py.
import { test, eq } from "./harness.js";
import { summarise, guessRegion, describeCode, pyRound } from "../weather/summary.js";

const NOW = new Date("2026-11-23T08:00:00Z"); // a Monday, GMT
const D = [0.0, 10, 10];
const W = [5.0, 80, 10]; // a dry and a wet day

const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

/** A forecast from [rain_mm, rain_chance, gust] tuples; short lists are padded wet to 16. */
function days(rows, code = 3, first = "2026-11-23") {
  rows = [...rows, ...Array(Math.max(0, 16 - rows.length)).fill(W)];
  const daily = rows.map(([mm, chance, gust], i) => {
    const d = addDays(first, i);
    return { date: d, code, high: 10.0 + i, low: 2.0, rain_mm: mm, rain_chance: chance, wind_max: 12.0,
      gust_max: gust, sunrise: d + "T07:30", sunset: d + "T16:10" };
  });
  return { current: {}, daily, hourly: [] };
}

const warning = (level = "amber", kind = "wind", starts = "2026-11-24T06:00:00+00:00") =>
  ({ level, kind, title: "t", headline: "h", starts, ends: null, link: "" });

const S = (rows, warnings = [], now = NOW, code = 3) => summarise(days(rows, code), [...warnings], now);
const spells = (out) => out.dry_spells.map((s) => [s.start, s.end, s.length]);

test("test_dry_rule_edges", () => {
  const out = S([[0.9, 10, 10], [1.0, 10, 10], [0.0, 40, 10], [0.0, 39, 10]]);
  eq(out.days.slice(0, 4).map((d) => d.dry), [true, false, false, true]);
});

test("test_missing_values_are_unknown", () => {
  let out = S([D, [null, 10, null], D, D]);
  const unknown = out.days[1];
  eq([unknown.dry, unknown.gusty], [null, false]);
  eq(out.dry_spells.map((s) => [s.start, s.length]), [["2026-11-23", 1], ["2026-11-25", 2]]);
  out = S([[null, 10, null], D]);
  eq(out.next_dry_day, "2026-11-24");
});

test("test_spells_start_middle_end", () => {
  const out = S([D, D, W, D, D, D, ...Array(9).fill(W), D]);
  eq(spells(out), [["2026-11-23", "2026-11-24", 2], ["2026-11-26", "2026-11-28", 3], ["2026-12-08", "2026-12-08", 1]]);
});

test("test_dry_until_and_next_dry_day", () => {
  let out = S([D, D, D, D, W]);
  eq([out.dry_until, out.next_dry_day], ["2026-11-26", "2026-11-23"]);
  out = S([W, W, W, W, W, D]);
  eq([out.dry_until, out.next_dry_day], [null, "2026-11-28"]);
});

test("test_rain_every_day", () => {
  const out = S(Array(16).fill(W));
  eq([out.dry_spells, out.next_dry_day], [[], null]);
  eq(out.day_phrase, "no dry day in the next 16 days");
});

test("test_dry_every_day", () => {
  const out = S(Array(16).fill(D));
  eq(spells(out), [["2026-11-23", "2026-12-08", 16]]);
  eq(out.day_phrase, "dry for the next 16 days");
});

test("test_gust_thresholds", () => {
  const out = S([39, 40, 49, 50].map((g) => [0.0, 10, g]));
  eq(out.days.slice(0, 4).map((d) => d.gusty), [false, true, true, true]);
  eq(out.days.slice(0, 4).map((d) => d.flagged), [false, false, false, true]);
  eq(out.gusty_days, ["2026-11-24", "2026-11-25", "2026-11-26"]);
  eq(out.flagged_days, ["2026-11-26"]);
});

test("test_rough_guide_from_day_8", () => {
  const out = S(Array(16).fill(D));
  eq(out.days.map((d) => d.rough), [...Array(7).fill(false), ...Array(9).fill(true)]);
  eq(out.rough_guide_from, "2026-11-30");
});

test("test_old_copy_drops_past_days", () => {
  const out = S(Array(16).fill(D), [], new Date("2026-11-25T08:00:00Z"));
  eq([out.days[0].date, out.days.length], ["2026-11-25", 14]);
  eq(out.day_phrase, "dry for the next 14 days");
});

test("test_now_is_read_in_london_time", () => {
  // 23:30 UTC on 23 Nov is 23:30 in London (GMT), so still the 23rd; a +05:00 clock saying
  // 04:30 on the 24th is the same instant.
  const out = S(Array(16).fill(D), [], new Date("2026-11-24T04:30:00+05:00"));
  eq(out.days[0].date, "2026-11-23");
});

test("test_days_gain_words_and_icon", () => {
  const out = S([D, D, D], [], NOW, 61);
  eq([out.days[0].words, out.days[0].icon], ["Light rain", "rain"]);
});

test("test_card", () => {
  const out = S([D, W], [], NOW, 61);
  const card = out.card;
  eq([card.high, card.low, card.rain_chance], [10.0, 2.0, 10]);
  eq([card.words, card.icon, card.level], ["Light rain", "rain", "normal"]);
  eq(card.next_dry, { start: "2026-11-23", end: "2026-11-23", length: 1 });
  eq(S(Array(16).fill(W)).card.next_dry, null);
});

test("test_card_level_order", () => {
  const calm = Array(16).fill(D);
  const flag = [D, D, D, D, [0.0, 10, 55], ...Array(11).fill(D)];
  eq(S(calm, [warning("red")]).card.level, "red");
  eq(S(calm, [warning("yellow"), warning("red")]).card.level, "red");
  eq(S(calm, [warning("amber")]).card.level, "amber");
  eq(S([D, D, [0.0, 10, 55], ...Array(13).fill(D)], [warning("yellow")]).card.level, "amber");
  eq(S(flag).card.level, "normal");
  eq(S(calm, [warning("yellow")]).card.level, "normal");
});

test("test_phrase_warning_timing", () => {
  const p = (starts) => S(Array(16).fill(D), [warning("amber", "wind", starts)]).day_phrase;
  eq(p("2026-11-24T06:00:00+00:00"), "amber wind warning tomorrow");
  eq(p("2026-11-23T18:00:00+00:00"), "amber wind warning today");
  eq(p("2026-11-25T06:00:00+00:00"), "amber wind warning on Wednesday");
  eq(p(null), "amber wind warning in force");
  eq(p("2026-11-22T06:00:00+00:00"), "amber wind warning in force");
});

test("test_phrase_warning_beats_gust_and_red_beats_amber", () => {
  const flag = [D, [0.0, 10, 55], ...Array(14).fill(D)];
  const out = S(flag, [warning("yellow"), warning("amber", "rain", null), warning("red", "wind", null)]);
  eq(out.day_phrase, "red wind warning in force");
});

test("test_phrase_yellow_never_leads", () => {
  eq(S(Array(16).fill(D), [warning("yellow")]).day_phrase, "dry for the next 16 days");
  eq(S([D, D, D, D, W], [warning("yellow")]).day_phrase, "dry until Thursday");
});

test("test_phrase_gusts", () => {
  eq(S([D, [0.0, 10, 54.6]]).day_phrase, "gusts to 55 mph on Tuesday");
  eq(S([[0.0, 10, 55]]).day_phrase, "gusts to 55 mph today");
  eq(S([D, D, D, D, W, [0.0, 10, 55]]).day_phrase, "dry until Thursday");
});

test("test_phrase_dry_and_wet", () => {
  eq(S([D, D, D, D, W]).day_phrase, "dry until Thursday");
  eq(S([D]).day_phrase, "dry today");
  eq(S([W, W, W, W, W, D]).day_phrase, "rain today, next dry day Saturday");
});

test("test_unknown_level_counts_like_yellow", () => {
  const w = warning(null, "weather");
  const out = S(Array(16).fill(D), [w]);
  eq([out.day_phrase, out.card.level], ["dry for the next 16 days", "normal"]);
  eq(S(Array(16).fill(D), [w, warning("amber", "rain", null)]).day_phrase, "amber rain warning in force");
});

test("test_expired_warnings_are_dropped_from_summary", () => {
  const gone = { ...warning("red", "wind", null), ends: "2026-11-23T07:00:00+00:00" }; // before NOW
  const live = { ...warning("amber", "rain", null), ends: "2026-11-23T18:00:00+00:00" };
  eq(S(Array(16).fill(D), [gone]).day_phrase, "dry for the next 16 days");
  eq(S(Array(16).fill(D), [gone]).card.level, "normal");
  eq(S(Array(16).fill(D), [gone, live]).day_phrase, "amber rain warning in force");
});

test("test_no_days_left_says_no_forecast", () => {
  const out = S(Array(16).fill(D), [], new Date("2026-12-20T08:00:00Z"));
  eq([out.days, out.card], [[], null]);
  eq(out.day_phrase, "no forecast available");
});

test("test_guess_region", () => {
  eq(guessRegion("England", "Northumberland"), "ne");
  eq(guessRegion("England", "Devon"), "sw");
  eq(guessRegion("England", "Kent"), "se");
  eq(guessRegion("Wales", null), "wl");
  eq(guessRegion("Northern Ireland", "County Down"), "ni");
  eq(guessRegion("Scotland", "Highland"), "he");
  eq(guessRegion("England", "Nowhere"), null);
  eq(guessRegion("England", "constructor"), null);
});

test("test_describe_code", () => {
  eq(describeCode(0), ["Clear sky", "sun"]);
  eq(describeCode(61), ["Light rain", "rain"]);
  eq(describeCode(95), ["Thunderstorm", "storm"]);
  eq(describeCode(null), ["Unknown", "cloud"]);
  eq(describeCode(12345), ["Unknown", "cloud"]);
});

test("pyRound rounds halves to even, like Python", () => { eq([pyRound(54.5), pyRound(55.5), pyRound(54.6)], [54, 56, 55]); });
