// Occurrences of calendar events and lesson days. Pure: no DOM, no clock. Every date is a London
// "YYYY-MM-DD" string, and all arithmetic goes through Date.UTC, so clock changes never move a day.
import { addDays, weekdayIndex } from "../lessons/sums.js";
import { daysInMonth, nthWeekdayOf } from "./parse.js";

const utc = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const dayGap = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const pad = (n) => String(n).padStart(2, "0");

// Every date the event falls on within [from, to] (and not past `until`), before skipped dates are removed.
// No open-ended loop: each rule jumps to the first step that can reach `from` and stops past the end.
export function dueDates(ev, from, to) {
  const S = ev.date, end = ev.until && ev.until < to ? ev.until : to;
  if (!ev.repeat) return S >= from && S <= end ? [S] : [];
  const { unit, every: n } = ev.repeat, out = [];
  // Odd documents never loop or expand: unknown unit, or a step that is not a whole number of at least 1.
  if (!["day", "week", "month", "year"].includes(unit) || !Number.isInteger(n) || n < 1) return [];
  const nth = ev.repeat.nth;
  if (unit === "month" && ev.repeat.monthly === "weekday" && nth !== undefined && nth !== null && ![1, 2, 3, 4, -1].includes(nth)) return [];
  const [sy, sm, sd] = S.split("-").map(Number);
  if (unit === "day" || unit === "week") {
    const step = unit === "day" ? n : 7 * n;
    let k = Math.max(0, Math.ceil(dayGap(S, from) / step));
    for (let d = addDays(S, k * step); d <= end; d = addDays(S, ++k * step)) if (d >= from) out.push(d);
    return out;
  }
  const [fy, fm] = from.split("-").map(Number);
  const stepMonths = unit === "year" ? 12 * n : n;
  const monthsFrom = (fy - sy) * 12 + (fm - sm);
  for (let k = Math.max(0, Math.floor(monthsFrom / stepMonths)); ; k++) {
    const t = sm - 1 + k * stepMonths, y = sy + Math.floor(t / 12), m = (t % 12) + 1;
    if (`${y}-${pad(m)}-01` > end) break;
    const d = unit === "month" && ev.repeat.monthly === "weekday"
      ? nthWeekdayOf(y, m, weekdayIndex(S), nth ?? Math.ceil(sd / 7))
      : `${y}-${pad(m)}-${pad(Math.min(sd, daysInMonth(y, m)))}`;
    if (d && d <= end && d >= from && d >= S) out.push(d);
  }
  return out;
}

// [{ eventId, date, time, title, kind, done }], inclusive range, skipped dates dropped.
export function occurrences(events, from, to) {
  const out = [];
  for (const ev of events) {
    const skipped = Array.isArray(ev.skipped) ? ev.skipped : [], done = Array.isArray(ev.done) ? ev.done : [];
    for (const date of dueDates(ev, from, to)) {
      if (skipped.includes(date)) continue;
      out.push({ eventId: ev.id, date, time: ev.time ?? null, title: ev.title, kind: ev.kind, done: done.includes(date) });
    }
  }
  return out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
      : a.time === b.time ? a.title.localeCompare(b.title)
        : a.time === null ? -1 : b.time === null ? 1 : a.time < b.time ? -1 : 1);
}

// Read-only lesson items. Recorded days up to today say what happened; from today on, days with no
// recorded row come from the timetable (Monday-first), but only from settings.trackingSince.
export function lessonItems(records, from, to, today) {
  const days = (records && records.days) || {}, settings = records && records.settings;
  const timetable = settings && Array.isArray(settings.timetable) ? settings.timetable : null;
  const since = settings && settings.trackingSince;
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const row = days[d];
    let title = null;
    if (row && d <= today) {
      if (row.lessons > 0) title = row.lessons === 1 ? "1 lesson" : `${row.lessons} lessons`;
    } else if (!row && d >= today && timetable && (!since || d >= since)) {
      const n = timetable[weekdayIndex(d)];
      if (n > 0) title = `Lessons — usually ${n}`;
    }
    if (title) out.push({ date: d, kind: "lessons", title, time: null, link: "#/lessons" });
  }
  return out;
}
