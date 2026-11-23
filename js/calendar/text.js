// Calendar wording. Pure: no DOM, no clock (today is always passed in). Dates are London "YYYY-MM-DD" strings.
import { SHORT_DAYS } from "../core/dom.js";
import { addDays, weekdayIndex } from "../lessons/sums.js";
import { daysInMonth } from "./parse.js";
import { occurrences, lessonItems } from "./occurrences.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]; // Monday-first
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NTH = { 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" };
const utc = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const dayGap = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dayNum = (day) => Number(day.slice(8, 10));
const month3 = (day) => MONTHS[Number(day.slice(5, 7)) - 1];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatTime(t) {
  if (typeof t !== "string") return "";
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `.${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

export const shortDate = (day) => `${SHORT_DAYS[(weekdayIndex(day) + 1) % 7]} ${dayNum(day)} ${month3(day)}`;

export function dayHeading(date, today) {
  return date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : shortDate(date);
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

export function repeatWords(repeat, date) {
  const n = repeat.every, wd = DAYS[weekdayIndex(date)];
  if (repeat.unit === "day") return n === 1 ? "every day" : `every ${n} days`;
  if (repeat.unit === "week") return n === 1 ? `every ${wd}` : n === 2 ? `every other ${wd}` : `every ${n} weeks on ${wd}`;
  if (repeat.unit === "month") {
    const every = n === 1 ? "every month" : `every ${n} months`;
    return repeat.monthly === "weekday" ? `the ${NTH[repeat.nth]} ${wd} of ${every}` : `${every} on the ${ordinal(dayNum(date))}`;
  }
  return `${n === 1 ? "every year" : `every ${n} years`} on ${dayNum(date)} ${month3(date)}`;
}

// What the parser understood, in one line.
export function summaryLine(f, today) {
  const parts = [];
  if (!f.date) parts.push("pick a date");
  else {
    if (f.repeat) parts.push(repeatWords(f.repeat, f.date), `from ${shortDate(f.date)}`);
    else parts.push(`${f.kind === "deadline" ? "due " : ""}${shortDate(f.date)}`);
    if (f.time) parts.push(formatTime(f.time));
    if (f.until) parts.push(`until ${shortDate(f.until)}`);
  }
  return `${f.title || "No title"} — ${parts.join(", ")}`;
}

export const overdueText = (title, date, today) => `Overdue: ${title} — ${plural(dayGap(date, today), "day")}`;

// "Your day" phrase from today's-and-earlier occurrences (lessons excluded); first match wins.
export function dayPhrase(occs, today) {
  const todays = occs.filter((o) => o.date === today && !(o.kind === "deadline" && o.done));
  const overdue = occs.find((o) => o.kind === "deadline" && o.date < today && !o.done);
  if (overdue) return `${overdue.title} overdue`;
  const timed = todays.find((o) => o.time);
  if (timed) return `${timed.title} at ${formatTime(timed.time)}`;
  const due = todays.find((o) => o.kind === "deadline");
  if (due) return `${due.title} due today`;
  return todays.length ? `${todays.length} ${todays.length === 1 ? "thing" : "things"} today` : null;
}

// Weeks (Monday-first) of "YYYY-MM-DD" strings, null outside the month.
export function monthCells(month) {
  const [y, m] = month.split("-").map(Number);
  const lead = weekdayIndex(`${month}-01`), cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const order = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1)
  : a.time === b.time ? a.title.localeCompare(b.title) : a.time === null ? -1 : b.time === null ? 1 : a.time < b.time ? -1 : 1);

export function comingUp(events, records, today, days = 60) {
  const overdue = occurrences(events, addDays(today, -365), addDays(today, -1))
    .filter((o) => o.kind === "deadline" && !o.done)
    .map((o) => ({ ...o, text: overdueText(o.title, o.date, today) }));
  const end = addDays(today, days);
  const items = [...occurrences(events, today, end), ...lessonItems(records, today, end, today)].sort(order);
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, heading: dayHeading(item.date, today), items: [item] });
  }
  return { overdue, groups };
}
