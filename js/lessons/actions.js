// Lessons writes. Each runs its checks first, issues the write without awaiting the server (a
// Firestore write only resolves once the server answers, which offline is never), and returns
// { ok: true } or { error }. Only a rejected write is reported, through onFail.
import { rateChangePreview } from "./sums.js";
import {
  checkDay, checkPayment, checkRate, checkLessonSettings, isRealDate, MSG_DATE, MSG_CONFIRM,
} from "./checks.js";

const FAIL = "Couldn't save — try again";
const stampOf = (now) => (now instanceof Date ? now.toISOString() : now);

function issue(write, onFail) {
  let p;
  try { p = Promise.resolve(write()); } catch (err) { p = Promise.reject(err); }
  p.catch(() => { if (onFail) onFail(FAIL); });
}

export function saveDay(d, date, lessons, note, { today, now, onFail }) {
  const bad = checkDay(date, lessons, today);
  if (bad) return { error: bad };
  issue(() => d.set(`lessonDays/${date}`, { lessons, note: typeof note === "string" ? note : "", confirmedAt: stampOf(now) }), onFail);
  return { ok: true };
}

export function removeDay(d, date, { onFail } = {}) {
  if (!isRealDate(date)) return { error: MSG_DATE };
  issue(() => d.remove(`lessonDays/${date}`), onFail);
  return { ok: true };
}

export function addPayment(d, { received, pence, month, note }, { today, now, onFail, id }) {
  const bad = checkPayment({ received, pence, month }, today);
  if (bad) return { error: bad };
  const key = id || crypto.randomUUID();
  issue(() => d.set(`lessonPayments/${key}`,
    { received, pence, month, note: typeof note === "string" ? note : "", addedAt: stampOf(now) }), onFail);
  return { ok: true };
}

export function removePayment(d, id, { onFail } = {}) {
  issue(() => d.remove(`lessonPayments/${id}`), onFail);
  return { ok: true };
}

export function previewRate(records, { pence, effectiveFrom }) {
  const bad = checkRate({ pence, effectiveFrom });
  if (bad) return { error: bad };
  return rateChangePreview(records.rates, pence, effectiveFrom, records.days);
}

export function saveRate(d, records, { pence, effectiveFrom, confirm }, { onFail } = {}) {
  const preview = previewRate(records, { pence, effectiveFrom });
  if (preview.error) return { error: preview.error };
  if (preview.changed_days > 0 && confirm !== true) return { error: MSG_CONFIRM, preview };
  issue(() => d.set(`lessonRates/${effectiveFrom}`, { pence }), onFail);
  return { ok: true };
}

// The first timetable save with no date starts tracking today; a later save without one keeps the stored date.
export function saveLessonSettings(d, current, { timetable, trackingSince }, { today, onFail }) {
  const given = trackingSince === "" ? null : trackingSince;
  const bad = checkLessonSettings({ timetable, trackingSince: given }, today);
  if (bad) return { error: bad };
  const since = given || (current && current.trackingSince) || today;
  issue(() => d.set("settings/lessons", { timetable: [...timetable], trackingSince: since }), onFail);
  return { ok: true, timetable: [...timetable], trackingSince: since };
}
