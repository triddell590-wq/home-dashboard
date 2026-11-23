// Plain-words parser for calendar entries. Pure: no DOM, no network, no clock (today is passed in).
// parse("dentist tuesday 2pm", "2026-11-23") -> { title, kind, date, time, repeat, until, unsure }.
// Each recognised phrase is cut out of the text (replaced by spaces, so spans stay aligned with the
// original casing) and what is left, tidied, is the title. Dates are "YYYY-MM-DD", UK day/month order.
import { addDays, weekdayIndex } from "../lessons/sums.js";

export const WEEKDAY_NAMES = {
  monday: 0, mon: 0, tuesday: 1, tues: 1, tue: 1, wednesday: 2, wed: 2,
  thursday: 3, thurs: 3, thur: 3, thu: 3, friday: 4, fri: 4, saturday: 5, sat: 5, sunday: 6, sun: 6,
};
// Months are numbered 1 to 12 (they feed daysInMonth and Date.UTC directly).
export const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const NTH_NAMES = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };
const UNITS = ["day", "week", "month", "year"];
const SEASONS = { spring: [3, 1], summer: [6, 1], autumn: [9, 1], winter: [12, 1] };
const CONNECTORS = "on|at|the|from|by|every|of";

const pad = (n, width = 2) => String(n).padStart(width, "0");
const iso = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const ymd = (day) => [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
const alt = (names) => Object.keys(names).sort((a, b) => b.length - a.length).join("|");
const W = alt(WEEKDAY_NAMES), M = alt(MONTH_NAMES), NTH = alt(NTH_NAMES);

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

// The nth (1-based) weekday (Monday 0) of a month; nth -1 is the last. null when the month has no such one.
export function nthWeekdayOf(year, month, weekday, nth) {
  const last = daysInMonth(year, month);
  if (nth === -1) {
    for (let d = last; d > last - 7; d--) if (weekdayIndex(iso(year, month, d)) === weekday) return iso(year, month, d);
    return null;
  }
  if (!(nth >= 1 && nth <= 5)) return null;
  let first = 1;
  while (weekdayIndex(iso(year, month, first)) !== weekday) first++;
  const day = first + 7 * (nth - 1);
  return day <= last ? iso(year, month, day) : null;
}

// ---- date arithmetic -------------------------------------------------------------------------
const nextWeekday = (today, w) => addDays(today, ((w - weekdayIndex(today) + 6) % 7) + 1); // today excluded
// Month + day with no year: the first such date on or after base (skips years without it, e.g. 29 Feb).
function onOrAfter(month, day, base) {
  const y = ymd(base)[0];
  for (let i = 0; i < 9; i++) {
    if (validDate(y + i, month, day) && iso(y + i, month, day) >= base) return iso(y + i, month, day);
  }
  return null;
}
// Day number d: this month if d >= today's day number, otherwise the first later month that has it.
function dayNumberOnOrAfter(d, today) {
  const [y, m, td] = ymd(today);
  for (let i = 0; i < 26; i++) {
    const yy = y + Math.floor((m - 1 + i) / 12), mm = ((m - 1 + i) % 12) + 1;
    if (validDate(yy, mm, d) && (i > 0 || d >= td)) return iso(yy, mm, d);
  }
  return null;
}
function nthOnOrAfter(w, nth, today) {
  const [y, m] = ymd(today);
  for (let i = 0; i < 26; i++) {
    const yy = y + Math.floor((m - 1 + i) / 12), mm = ((m - 1 + i) % 12) + 1;
    const found = nthWeekdayOf(yy, mm, w, nth);
    if (found && found >= today) return found;
  }
  return null;
}

// ---- finding phrases -------------------------------------------------------------------------
// scan returns every match of re at or after `from` as { start, end, ...make(match) }; make returns null to reject.
function scan(re, s, from, make) {
  const rx = new RegExp(re, "gi");
  rx.lastIndex = from;
  const out = [];
  let m;
  while ((m = rx.exec(s))) {
    if (m[0] === "") { rx.lastIndex++; continue; }
    const c = make(m);
    if (c) out.push({ start: m.index, end: m.index + m[0].length, ...c });
  }
  return out;
}
const earliestLongest = (c) => c.reduce((a, b) => (!a || b.start < a.start || (b.start === a.start && b.end > a.end) ? b : a), null);
const longest = (c) => c.reduce((a, b) => (!a || b.end - b.start > a.end - a.start ? b : a), null);

const PRE = "(?:\\b(?:on|from)\\s+)?";
const ORD = "(\\d{1,2})(?:st|nd|rd|th)?";
const validTime = (h, min) => h >= 0 && h <= 23 && min >= 0 && min <= 59;

// Date phrases (row 4). resolve(base) gives the date; base only matters for a day and month with no year.
function dateCandidates(s, from, today) {
  const wk = (name) => WEEKDAY_NAMES[name.toLowerCase()];
  const mo = (name) => MONTH_NAMES[name.toLowerCase()];
  const forms = [
    [`${PRE}\\btoday\\b`, () => ({ resolve: () => today })],
    [`${PRE}\\btomorrow\\b`, () => ({ resolve: () => addDays(today, 1) })],
    [`${PRE}\\bin\\s+(\\d{1,3})\\s+(day|week)s?\\b`, (m) => ({ resolve: () => addDays(today, Number(m[1]) * (m[2].toLowerCase() === "week" ? 7 : 1)) })],
    [`${PRE}\\bnext\\s+(${W})\\b(?!['’]\\w)`, (m) => ({ resolve: () => addDays(today, 7 - weekdayIndex(today) + wk(m[1])) })],
    [`${PRE}\\b(${W})\\b(?!['’]\\w)`, (m) => ({ resolve: () => nextWeekday(today, wk(m[1])) })],
    [`${PRE}\\b${ORD}\\s+(?:of\\s+)?(${M})\\b(?!['’]\\w)(?:\\s+(\\d{4})\\b)?`, (m) => dayMonth(Number(m[1]), mo(m[2]), m[3])],
    [`${PRE}\\b(${M})\\s+${ORD}\\b(?![:.]\\d)(?:\\s+(\\d{4})\\b)?`, (m) => dayMonth(Number(m[2]), mo(m[1]), m[3])],
    [`${PRE}(?<![\\d/.])(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])`, (m) => dayMonth(Number(m[1]), Number(m[2]), m[3] && (m[3].length === 2 ? `20${m[3]}` : m[3]))],
    [`${PRE}\\bthe\\s+${ORD}\\b(?!\\s*(?:of\\s+)?(?:${M})\\b)`, (m) => (m[1] >= 1 && m[1] <= 31 ? { resolve: () => dayNumberOnOrAfter(Number(m[1]), today) } : null)],
  ];
  function dayMonth(d, month, year) {
    if (year) return validDate(Number(year), month, d) ? { resolve: () => iso(Number(year), month, d) } : null;
    return onOrAfter(month, d, today) ? { resolve: (base) => onOrAfter(month, d, base) } : null; // never valid (30 Feb) = no match
  }
  return forms.flatMap(([re, make]) => scan(re, s, from, (m) => {
    const c = make(m);
    return c && c.resolve(today) !== null ? c : null;
  }));
}

// Repeat phrases (rows 2a to 2i). start(today) is the first date; weekday is set for weekly weekday repeats.
function repeatCandidates(s, today) {
  const wk = (name) => WEEKDAY_NAMES[name.toLowerCase()];
  const mo = (name) => MONTH_NAMES[name.toLowerCase()];
  const unitOf = (name) => name.toLowerCase();
  const rep = (unit, every, monthly = null) => ({ unit, every, monthly });
  const fixed = (unit, every) => ({ repeat: rep(unit, every, unit === "month" ? "date" : null), first: () => today });
  const nthRepeat = (nthWord, w) => ({
    repeat: { ...rep("month", 1, "weekday"), nth: NTH_NAMES[nthWord.toLowerCase()] },
    first: () => nthOnOrAfter(wk(w), NTH_NAMES[nthWord.toLowerCase()], today),
  });
  const monthDate = (d) => (d >= 1 && d <= 31 ? { repeat: rep("month", 1, "date"), first: () => dayNumberOnOrAfter(d, today) } : null);
  const yearly = (d, month) => (onOrAfter(month, d, today) ? { repeat: rep("year", 1), first: () => onOrAfter(month, d, today) } : null);
  const weekly = (every, w) => ({ repeat: rep("week", every), first: () => nextWeekday(today, wk(w)), weekday: wk(w) });
  const U = `(${UNITS.join("|")})`;
  const forms = [
    [`(?:\\bon\\s+)?\\bthe\\s+(${NTH})\\s+(${W})\\s+of\\s+every\\s+month\\b`, (m) => nthRepeat(m[1], m[2])],
    [`\\bevery\\s+(${NTH})\\s+(${W})\\b(?:\\s+of\\s+the\\s+month\\b)?`, (m) => nthRepeat(m[1], m[2])],
    [`\\bevery\\s+month\\s+on\\s+the\\s+${ORD}\\b`, (m) => monthDate(Number(m[1]))],
    [`(?:\\bon\\s+)?\\bthe\\s+${ORD}\\s+of\\s+every\\s+month\\b`, (m) => monthDate(Number(m[1]))],
    [`\\bevery\\s+other\\s+(${W})\\b`, (m) => weekly(2, m[1])],
    [`\\bevery\\s+(${W})\\b`, (m) => weekly(1, m[1])],
    [`\\bevery\\s+(\\d+)\\s+${U}s?\\b`, (m) => (Number(m[1]) >= 1 && Number(m[1]) <= 52 ? fixed(unitOf(m[2]), Number(m[1])) : null)],
    [`\\bevery\\s+other\\s+${U}\\b`, (m) => fixed(unitOf(m[1]), 2)],
    [`\\bevery\\s+${U}\\b`, (m) => fixed(unitOf(m[1]), 1)],
    ["\\bdaily\\b", () => fixed("day", 1)], ["\\bweekly\\b", () => fixed("week", 1)], ["\\bfortnightly\\b", () => fixed("week", 2)],
    ["\\bmonthly\\b", () => fixed("month", 1)], ["\\b(?:yearly|annually)\\b", () => fixed("year", 1)],
    [`\\bevery\\s+${ORD}\\s+(?:of\\s+)?(${M})\\b(?!['’]\\w)`, (m) => yearly(Number(m[1]), mo(m[2]))],
    [`\\bevery\\s+(${M})\\s+${ORD}\\b(?![:.]\\d)`, (m) => yearly(Number(m[2]), mo(m[1]))],
    [`\\bevery\\s+(spring|summer|autumn|winter)\\b`, (m) => {
      const [month, day] = SEASONS[m[1].toLowerCase()];
      return { repeat: rep("year", 1), first: () => onOrAfter(month, day, today), season: true };
    }],
  ];
  return forms.flatMap(([re, make]) => scan(re, s, 0, make));
}

function tidy(s) {
  let t = s.replace(/\s+/g, " ").trim();
  const lead = new RegExp(`^(?:(?:${CONNECTORS})\\b|[,\\-–])\\s*`, "i");
  const trail = new RegExp(`\\s*(?:\\b(?:${CONNECTORS})|[,\\-–])$`, "i");
  for (;;) {
    const next = t.replace(lead, "").replace(trail, "").trim();
    if (next === t) break;
    t = next;
  }
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80).trimEnd();
}

export function parse(text, today) {
  let s = String(text ?? "");
  const cut = (a, b) => { s = s.slice(0, a) + " ".repeat(b - a) + s.slice(b); };

  // 1. until <date>: resolved last, because a date with no year rolls on or after the start date.
  let untilResolve = null;
  for (const u of scan("\\buntil\\s+", s, 0, () => ({}))) {
    const d = earliestLongest(dateCandidates(s, u.end, today).filter((c) => c.start === u.end));
    if (d) { untilResolve = d.resolve; cut(u.start, d.end); break; }
  }

  // 2. repeats: the longest phrase wins.
  const rep = longest(repeatCandidates(s, today));
  if (rep) cut(rep.start, rep.end);

  // 3. due / deadline (and "by" directly before a date).
  let deadline = false;
  const due = earliestLongest(scan("\\b(?:due|deadline)\\b(?:\\s+on\\b|\\s*[:\\-–])?", s, 0, () => ({})));
  if (due) { deadline = true; cut(due.start, due.end); }

  // 4. the first date.
  const date = earliestLongest(dateCandidates(s, 0, today));
  if (date) {
    const by = /\bby\s+$/i.exec(s.slice(0, date.start));
    if (by) { deadline = true; cut(by.index, by.index + by[0].length); }
    cut(date.start, date.end);
  }

  // 5. the first time.
  const time = earliestLongest(timeCandidates(s));
  if (time) cut(time.start, time.end);

  const dateValue = date ? date.resolve(today) : null;
  const startDate = dateValue ?? (rep ? rep.first() : null);
  const unsure = [];
  if (rep && rep.weekday !== undefined && dateValue && weekdayIndex(dateValue) !== rep.weekday) unsure.push("date");
  if (rep && rep.season && !dateValue) unsure.push("date");
  return {
    title: tidy(s),
    kind: deadline ? "deadline" : rep ? "job" : "appointment",
    date: startDate,
    time: time ? time.value : null,
    repeat: rep ? rep.repeat : null,
    until: untilResolve ? untilResolve(startDate ?? today) : null,
    unsure,
  };
}

// Times (row 5).
function timeCandidates(s) {
  const hhmm = (h, min) => `${pad(h)}:${pad(min)}`;
  const forms = [
    ["\\b(?:noon|midday)\\b", () => ({ value: "12:00" })],
    ["(?:\\bat\\s+)?(?<![\\d:.])(\\d{1,2})(?:[.:](\\d{2}))?\\s?(am|pm)\\b", (m) => {
      const h = Number(m[1]), min = Number(m[2] ?? 0);
      if (h < 1 || h > 12 || min > 59) return null;
      return { value: hhmm((h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0), min) };
    }],
    ["\\bat\\s+(\\d{1,2})(?:[.:](\\d{2}))?(?![\\d/]|[.:]\\d)", (m) => {
      const h = Number(m[1]), min = Number(m[2] ?? 0);
      return validTime(h, min) ? { value: hhmm(h, min) } : null;
    }],
    ["(?<![\\d:.])(\\d{1,2}):(\\d{2})(?![\\d:])", (m) => (validTime(Number(m[1]), Number(m[2])) ? { value: hhmm(Number(m[1]), Number(m[2])) } : null)],
  ];
  return forms.flatMap(([re, make]) => scan(re, s, 0, make));
}
