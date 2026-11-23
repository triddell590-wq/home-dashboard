// Calendar event records, their checks and their writes (spec §2). Writes go through data(), are issued
// without awaiting the server (offline never answers) and only a rejected write is reported, through onFail.
import { issue } from "../core/issue.js";
import { isInt, isRealDate } from "../lessons/checks.js";

export const MSG_TITLE = "A title needs 1 to 80 characters";
export const MSG_DATE = "Pick a date";
export const MSG_TIME = "That isn't a time";
export const MSG_REPEAT = "Repeat every 1 to 52";
export const MSG_UNTIL = "The end date is before the start";
export const MSG_KIND = "Choose appointment, job or deadline";

const KINDS = ["appointment", "job", "deadline"];
const UNITS = ["day", "week", "month", "year"];
const str = (v) => (typeof v === "string" ? v : "");
const stampOf = (now) => (now instanceof Date ? now.toISOString() : now);

function repeatOk(r) {
  if (!r || typeof r !== "object" || !UNITS.includes(r.unit) || !isInt(r.every) || r.every < 1 || r.every > 52) return false;
  const monthly = r.monthly ?? null;
  if (r.unit !== "month") return monthly === null && r.nth === undefined;
  if (monthly === "date") return r.nth === undefined;
  return monthly === "weekday" && isInt(r.nth) && (r.nth === -1 || (r.nth >= 1 && r.nth <= 4));
}

export function checkEvent(f) {
  if (!f || typeof f !== "object") return MSG_TITLE;
  if (typeof f.title !== "string" || f.title.trim().length < 1 || f.title.trim().length > 80) return MSG_TITLE;
  if (!KINDS.includes(f.kind)) return MSG_KIND;
  if (!isRealDate(f.date)) return MSG_DATE;
  if (f.time != null && !(typeof f.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(f.time))) return MSG_TIME;
  if (f.repeat != null && !repeatOk(f.repeat)) return MSG_REPEAT;
  if (f.until != null && !(isRealDate(f.until) && f.until >= f.date)) return MSG_UNTIL;
  return null;
}

const cleanRepeat = (r) => (r == null ? null
  : { unit: r.unit, every: r.every, monthly: r.unit === "month" ? r.monthly ?? null : null, ...(r.monthly === "weekday" ? { nth: r.nth } : {}) });
const dates = (v) => (Array.isArray(v) ? [...new Set(v.filter(isRealDate))].sort() : []);

// Skips any document that is not a valid event, so a half-synced or hand-edited doc never crashes a reader.
export function eventsFrom(docs) {
  const out = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc || typeof doc !== "object" || checkEvent(doc)) continue;
    out.push({
      id: doc.id, title: doc.title.trim(), kind: doc.kind, date: doc.date, time: doc.time ?? null,
      repeat: cleanRepeat(doc.repeat), until: doc.until ?? null, skipped: dates(doc.skipped), done: dates(doc.done),
      note: str(doc.note), createdAt: str(doc.createdAt), updatedAt: str(doc.updatedAt),
    });
  }
  return out;
}

export function watchEvents(d, cb) {
  let stopped = false;
  const stop = d.watch("events", (docs) => { if (!stopped) cb(eventsFrom(docs)); });
  return () => { stopped = true; if (typeof stop === "function") stop(); };
}

export function saveEvent(d, fields, { current = null, id = crypto.randomUUID(), now, onFail } = {}) {
  const bad = checkEvent(fields);
  if (bad) return { error: bad };
  const repeat = cleanRepeat(fields.repeat);
  const moved = current && (current.date !== fields.date || JSON.stringify(cleanRepeat(current.repeat)) !== JSON.stringify(repeat));
  const stamp = stampOf(now);
  issue(() => d.set(`events/${id}`, {
    title: fields.title.trim(), kind: fields.kind, date: fields.date, time: fields.time ?? null, repeat,
    until: fields.until ?? null, skipped: current && !moved ? dates(current.skipped) : [], done: current ? dates(current.done) : [],
    note: str(fields.note), createdAt: (current && current.createdAt) || stamp, updatedAt: stamp,
  }), onFail);
  return { ok: true, id };
}

export function skipOccurrence(d, event, date, { now, onFail } = {}) {
  issue(() => d.update(`events/${event.id}`, { skipped: dates([...(event.skipped || []), date]), updatedAt: stampOf(now) }), onFail);
}

export function deleteEvent(d, event, { onFail } = {}) {
  issue(() => d.remove(`events/${event.id}`), onFail);
}

export function setDone(d, event, date, isDone, { now, onFail } = {}) {
  const rest = (event.done || []).filter((x) => x !== date);
  issue(() => d.update(`events/${event.id}`, { done: dates(isDone ? [...rest, date] : rest), updatedAt: stampOf(now) }), onFail);
}
