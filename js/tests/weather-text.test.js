import { localTime } from "../core/dom.js";
import { REGIONS, dayName, gustClass, rainText, safeLink, shortDayName, spellText, staleText, warningText } from "../weather/text.js";
import { eq, test } from "./harness.js";

const days = [{ date: "2026-11-22" }]; // today per the server (London), Sunday 22 November 2026

test("spell text: dry today until a day", () => {
  eq(spellText({ days, dry_spells: [{ start: "2026-11-22", end: "2026-11-26", length: 4 }], next_dry_day: "2026-11-22" }),
    "Dry until Thursday — 4 days");
});

test("spell text: wet today, a dry run later", () => {
  eq(spellText({ days, dry_spells: [{ start: "2026-11-24", end: "2026-11-27", length: 4 }], next_dry_day: "2026-11-24" }),
    "Dry from Tuesday to Friday — 4 days");
});

test("spell text: a single next dry day", () => {
  eq(spellText({ days, dry_spells: [{ start: "2026-11-28", end: "2026-11-28", length: 1 }], next_dry_day: "2026-11-28" }),
    "Next dry day: Saturday");
});

test("spell text: no dry day", () => {
  eq(spellText({ days, dry_spells: [], next_dry_day: null }), "No dry day in the next 16 days");
  eq(spellText(null), "No dry day in the next 16 days");
  // today is the server's first day, not the browser clock
  eq(spellText({ days: [{ date: "2026-11-24" }], dry_spells: [{ start: "2026-11-24", end: "2026-11-26", length: 3 }] }), "Dry until Thursday — 3 days");
});

test("gust classes", () => {
  eq(gustClass(39), "");
  eq(gustClass(40), "gusty");
  eq(gustClass(49), "gusty");
  eq(gustClass(50), "flagged");
  eq(gustClass(null), "");
});

test("stale text", () => {
  const t = "2026-11-22T07:10:00Z";
  eq(staleText(t, null, new Date(t)), null);
  eq(staleText(t, "offline", new Date(t)), `Forecast from ${localTime(t)} — couldn't refresh (no internet?)`);
});

test("warning text", () => {
  const starts = "2026-11-23T06:00:00Z";
  const ends = "2026-11-23T18:00:00Z";
  eq(warningText({ level: "amber", kind: "wind", starts, ends }), `Amber wind warning · ${localTime(starts)} to ${localTime(ends)}`);
  eq(warningText({ level: "amber", kind: "wind" }), "Amber wind warning");
});

test("rain text", () => {
  eq(rainText({ rain_mm: 2.4, rain_chance: 70 }), "2.4 mm · 70%");
  eq(rainText({ rain_mm: null, rain_chance: null }), "—");
});

test("the 16 warning regions match the server's", () => {
  eq(Object.keys(REGIONS).length, 16);
  eq(REGIONS.se, "London and South East England");
});

test("safe links allow only https", () => {
  eq(safeLink("https://www.metoffice.gov.uk/x"), "https://www.metoffice.gov.uk/x");
  eq(safeLink("javascript:alert(1)"), null);
  eq(safeLink("data:text/html,hi"), null);
  eq(safeLink("http://example.com"), null);
  eq(safeLink("not a url"), null);
  eq(safeLink(null), null);
});

test("day names come from the written date", () => {
  eq(dayName("2026-11-24"), "Tuesday");
  eq(shortDayName("2026-11-24T18:00"), "Tue");
});

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);       // local time, as the browser shows it

test("stale text names the day unless the forecast is from today", async () => {
  const { forecastFrom } = await import("../weather/text.js");
  const now = at(2026, 11, 22, 9, 0);                                // Sunday
  const today = at(2026, 11, 22, 7, 10).toISOString();
  const yesterday = at(2026, 11, 21, 18, 40).toISOString();
  const older = at(2026, 11, 20, 18, 40).toISOString();             // Friday
  eq(staleText(today, "offline", now), "Forecast from 07:10 — couldn't refresh (no internet?)");
  eq(staleText(yesterday, "offline", now), "Forecast from yesterday 18:40 — couldn't refresh (no internet?)");
  eq(staleText(older, "offline", now), "Forecast from Fri 18:40 — couldn't refresh (no internet?)");
  eq(staleText(older, null, now), null);
  eq(forecastFrom(yesterday, now), "Forecast from yesterday 18:40");
  eq(forecastFrom(today, now), "Forecast from 07:10");
});

test("when stale, the now figures are labelled with the time they are from", async () => {
  const { asOfText } = await import("../weather/text.js");
  const now = at(2026, 11, 22, 9, 0);
  const old = at(2026, 11, 21, 18, 40).toISOString();
  eq(asOfText({ stale: true, fetched_at: old }, now), "as of yesterday 18:40");
  eq(asOfText({ stale: false, fetched_at: old }, now), null);
});

test("no days left: the spell line says there is no forecast; the card message explains", async () => {
  const { cardMessage } = await import("../weather/text.js");
  eq(spellText({ days: [], dry_spells: [], next_dry_day: null }), "No forecast available");
  const now = at(2026, 11, 22, 9, 0);
  const old = at(2026, 11, 21, 18, 40).toISOString();
  eq(cardMessage({ summary: { card: null }, fetched_at: old, refresh_error: "x" }, now),
    "Forecast from yesterday 18:40 — couldn't refresh (no internet?)");
  eq(cardMessage({ summary: { card: null }, fetched_at: old, refresh_error: null }, now), "No forecast yet");
  eq(cardMessage({ summary: { card: {} } }, now), null);
});

test("a warning with no known level shows without a level word", () => {
  eq(warningText({ level: null, kind: "weather" }), "Weather warning");
});
