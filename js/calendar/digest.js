// The morning digest, shared by the page and tools/notify.mjs, so it is pure: no DOM, no network.
// Output is plain strings only, so the sender can put them straight into a data-only push.
import { SHORT_DAYS } from "../core/dom.js";
import { addDays } from "../lessons/sums.js";
import { occurrences, lessonItems } from "./occurrences.js";
import { formatTime, lowerFirst } from "./text.js";

export const MAX_LINES = 4;
export const DIGEST_URL = "#/calendar";
const NONE = () => ({ title: null, lines: [], count: 0, items: [] });

// Appointments, jobs and deadlines count as "something on"; lesson days never trigger a send on their own.
export function buildDigest({ events, records, today }) {
  const ahead = addDays(today, 3);
  const occs = occurrences(events, addDays(today, -1), ahead);
  const open = (o) => o.kind === "deadline" && !o.done;
  const lines = [];
  for (const o of occs) if (open(o) && o.date === addDays(today, -1)) lines.push(`Overdue: ${lowerFirst(o.title)}`);
  for (const o of occs) if (open(o) && o.date === today) lines.push(`Due today: ${lowerFirst(o.title)}`);
  for (const o of occs) {
    if (o.date === today && o.kind !== "deadline") lines.push(o.time ? `${o.title} ${formatTime(o.time)}` : o.title);
  }
  const soon = occs.filter((o) => open(o) && o.date === ahead);
  const count = lines.length + soon.length;
  if (count === 0) return NONE();
  const lesson = lessonItems(records, today, today, today)[0];
  if (lesson) lines.push(lesson.title);
  for (const o of soon) lines.push(`Due ${SHORT_DAYS[new Date(`${o.date}T12:00:00Z`).getUTCDay()]}: ${lowerFirst(o.title)}`);
  const items = lines.slice(0, MAX_LINES);
  return {
    title: soon.length ? "Today and coming up" : "Today",
    lines: lines.length > MAX_LINES ? [...items, `+${lines.length - MAX_LINES} more`] : items,
    count,
    items,
  };
}

export const digestBody = (lines) => lines.join("\n");

// Plain strings for a data-only push: { title, body, url }.
export const digestPayload = (digest) => ({ title: digest.title, body: digestBody(digest.lines), url: DIGEST_URL });
