// Lessons records from Firestore documents, and the overview the Lessons tab draws. buildLessons
// returns exactly the keys of the Mac's GET /api/lessons (overview() in lessons_api.py).
import { isInt, isRealDate, isRealMonth } from "./checks.js";
import {
  rateOn, allMonths, monthSummary, owedTotal, taxYearOf, taxYearSummary, toConfirm, defaultPaymentMonth, weekdayIndex,
} from "./sums.js";

const str = (v) => (typeof v === "string" ? v : "");

// Skips any document that is not a valid record, so a half-synced or hand-edited doc never becomes NaN.
export function recordsFrom({ dayDocs = [], paymentDocs = [], rateDocs = [], settingsDoc = null }) {
  const days = {};
  for (const doc of dayDocs || []) {
    if (!doc || !isRealDate(doc.id) || !isInt(doc.lessons) || doc.lessons < 0 || doc.lessons > 30) continue;
    days[doc.id] = { lessons: doc.lessons, note: str(doc.note) };
  }
  const payments = [];
  for (const doc of paymentDocs || []) {
    if (!doc || !isRealDate(doc.received) || !isRealMonth(doc.month) || !isInt(doc.pence) || doc.pence < 1) continue;
    payments.push({ id: doc.id, received: doc.received, pence: doc.pence, month: doc.month, note: str(doc.note), addedAt: str(doc.addedAt) });
  }
  const rates = {};
  for (const doc of rateDocs || []) {
    if (!doc || !isRealDate(doc.id) || !isInt(doc.pence) || doc.pence < 1) continue;
    rates[doc.id] = doc.pence;
  }
  let settings = null;
  if (settingsDoc && typeof settingsDoc === "object") {
    const t = settingsDoc.timetable;
    const timetable = Array.isArray(t) && t.length === 7 && t.every((n) => isInt(n) && n >= 0 && n <= 30) ? [...t] : null;
    settings = { timetable, trackingSince: isRealDate(settingsDoc.trackingSince) ? settingsDoc.trackingSince : null };
  }
  return { days, payments, rates, settings };
}

export async function readLessons(d) {
  const [dayDocs, paymentDocs, rateDocs, settingsDoc] = await Promise.all([
    d.list("lessonDays"), d.list("lessonPayments"), d.list("lessonRates"), d.get("settings/lessons")]);
  return recordsFrom({ dayDocs, paymentDocs, rateDocs, settingsDoc });
}

// Calls cb(records) once all four sources have reported, then on every change. Returns stop().
export function watchLessons(d, cb) {
  const got = {};
  let stopped = false;
  const names = ["dayDocs", "paymentDocs", "rateDocs", "settingsDoc"];
  const fire = () => {
    if (!stopped && names.every((n) => n in got)) cb(recordsFrom(got));
  };
  const on = (name) => (value) => { got[name] = value; fire(); };
  const stops = [
    d.watch("lessonDays", on("dayDocs")), d.watch("lessonPayments", on("paymentDocs")),
    d.watch("lessonRates", on("rateDocs")), d.watch("settings/lessons", on("settingsDoc"))];
  return () => { stopped = true; for (const s of stops) if (typeof s === "function") s(); };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function buildLessons(records, today) {
  const { days, payments, rates } = records;
  const settings = records.settings || { timetable: null, trackingSince: null };
  const timetable = settings.timetable, since = settings.trackingSince;
  const months = allMonths(days, payments, rates, today);
  let expected = null;
  if (timetable && !(today in days) && timetable[weekdayIndex(today)] > 0) expected = timetable[weekdayIndex(today)];
  const pending = timetable ? toConfirm(timetable, since, days, today) : [];
  const unrated = Object.keys(days).filter((d) => rateOn(rates, d) === null).sort();
  const inForce = Object.keys(rates).filter((eff) => eff <= today).sort().pop();
  return {
    today,
    this_month: monthSummary(today.slice(0, 7), days, payments, rates, today),
    months,
    owed_total: owedTotal(months),
    owed_incomplete: months.some((m) => m.missing_rate),
    tax_year: taxYearSummary(taxYearOf(today), days, payments, rates),
    to_confirm: pending,
    expected_today: expected,
    rate: inForce === undefined ? null : { pence: rates[inForce], effective_from: inForce },
    timetable: timetable || null,
    tracking_since: since || null,
    rate_default_from: unrated.length ? unrated[0] : (since || today),
    default_payment_month: defaultPaymentMonth(months, today),
    payments: [...payments].sort((a, b) => cmp(b.received, a.received) || cmp(b.addedAt, a.addedAt) || cmp(String(b.id), String(a.id)))
      .map((p) => ({ id: p.id, received: p.received, month: p.month, pence: p.pence, note: p.note })),
  };
}
