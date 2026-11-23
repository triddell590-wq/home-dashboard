// Checks run before any lessons write. A port of the validation in
// ml-trading-strategy/mltrader/web/lessons_api.py; each returns a message, or null when fine.
// Whole numbers only: true, "3" and 2.5 all fail.
export const MSG_LESSONS = "Lessons must be a whole number from 0 to 30";
export const MSG_FUTURE = "That date is in the future";
export const MSG_DATE = "That is not a date";
export const MSG_PAYMENT = "A payment must be between £0.01 and £10,000";
export const MSG_MONTH = "That month hasn't started yet";
export const MSG_RATE = "A rate must be between £0.01 and £1,000";
export const MSG_TIMETABLE = "The timetable needs seven numbers from 0 to 30";
export const MSG_CONFIRM = "This changes days already recorded";

export const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

// A real zero-padded YYYY-MM-DD calendar date (ASCII digits, year 0001 or later).
export function isRealDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const y = Number(text.slice(0, 4)), m = Number(text.slice(5, 7)), d = Number(text.slice(8, 10));
  if (y < 1) return false;
  const probe = new Date(Date.UTC(2000, m - 1, d));
  probe.setUTCFullYear(y);
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// A real "YYYY-MM" month.
export function isRealMonth(text) {
  return typeof text === "string" && /^\d{4}-\d{2}$/.test(text) && isRealDate(text + "-01");
}

function pastDate(date, today) {
  if (!isRealDate(date)) return MSG_DATE;
  return date > today ? MSG_FUTURE : null;
}

export function checkDay(date, lessons, today) {
  const bad = pastDate(date, today);
  if (bad) return bad;
  return inRange(lessons, 0, 30) ? null : MSG_LESSONS;
}

export function checkPayment({ received, pence, month }, today) {
  if (!inRange(pence, 1, 1_000_000)) return MSG_PAYMENT;
  const bad = pastDate(received, today);
  if (bad) return bad;
  if (!isRealMonth(month)) return MSG_DATE;
  return month > today.slice(0, 7) ? MSG_MONTH : null;
}

// A rate date in the future is allowed.
export function checkRate({ pence, effectiveFrom }) {
  if (!inRange(pence, 1, 100_000)) return MSG_RATE;
  return isRealDate(effectiveFrom) ? null : MSG_DATE;
}

export function checkLessonSettings({ timetable, trackingSince }, today) {
  if (!Array.isArray(timetable) || timetable.length !== 7 || !timetable.every((n) => inRange(n, 0, 30))) return MSG_TIMETABLE;
  if (trackingSince !== null && trackingSince !== undefined) return pastDate(trackingSince, today);
  return null;
}
