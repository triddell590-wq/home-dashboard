// Lesson sums: what has been earned, been paid and is still owed. A line-for-line port of
// ml-trading-strategy/mltrader/lessons.py. Pure functions only. Dates are "YYYY-MM-DD" strings
// (compared as strings), months are "YYYY-MM" and money is integer pence. Day arithmetic goes
// through Date.UTC, never local time.

export const LATE_AFTER_DAYS = 14;

const pad = (n, width = 2) => String(n).padStart(width, "0");
const fmt = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const parts = (day) => [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
const ms = (day) => { const [y, m, d] = parts(day); return Date.UTC(y, m - 1, d); };

export function addDays(day, n) {
  return fmt(ms(day) + n * 86400000);
}

// Monday is 0.
export function weekdayIndex(day) {
  return (new Date(ms(day)).getUTCDay() + 6) % 7;
}

// Rate with the latest effective-from <= day; null if none is in force.
export function rateOn(rates, day) {
  let best = null;
  for (const eff of Object.keys(rates)) {
    if (eff <= day && (best === null || eff > best)) best = eff;
  }
  return best === null ? null : rates[best];
}

// lessons x rate; unknown (null) when lessons were given but no rate applies.
export function dayAmount(lessons, rate) {
  if (lessons === 0) return 0;
  if (rate === null || rate === undefined) return null;
  return lessons * rate;
}

const monthKey = (day) => day.slice(0, 7);

function lastDay(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return fmt(Date.UTC(y, m, 0)); // day 0 of the next month
}

export function monthSummary(month, days, payments, rates, today) {
  const rows = [];
  let lessons = 0, earned = 0, missing = false;
  for (const day of Object.keys(days).filter((k) => monthKey(k) === month).sort()) {
    const rec = days[day];
    const n = rec.lessons;
    const rate = rateOn(rates, day);
    const amount = dayAmount(n, rate);
    if (amount === null) missing = true;
    else earned += amount;
    lessons += n;
    rows.push({ date: day, lessons: n, rate, amount, note: rec.note === undefined ? "" : rec.note });
  }
  const monthPayments = payments.filter((p) => p.month === month);
  const paid = monthPayments.reduce((sum, p) => sum + p.pence, 0);
  const owed = earned - paid;
  let status;
  if (lessons === 0 && monthPayments.length === 0) {
    status = "empty";
  } else if (missing && owed <= 0) {
    // Unrated days: the true amount is unknown, so never "paid"/"overpaid", and never "late" on
    // a figure that is zero or negative only because the unknown days count as nothing.
    status = "owed";
  } else if (owed < 0) {
    status = "overpaid";
  } else if (owed === 0) {
    status = "paid";
  } else if (today > addDays(lastDay(month), LATE_AFTER_DAYS)) {
    status = "late";
  } else {
    status = "owed";
  }
  return { month, lessons, earned, paid, owed, status, missing_rate: missing, days: rows };
}

export function allMonths(days, payments, rates, today) {
  const keys = Object.keys(days).map(monthKey).concat(payments.map((p) => p.month));
  if (!keys.length) return [];
  const first = keys.reduce((a, b) => (b < a ? b : a));
  let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  const endY = Number(today.slice(0, 4)), endM = Number(today.slice(5, 7));
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(monthSummary(`${pad(y, 4)}-${pad(m)}`, days, payments, rates, today));
    if (m === 12) { y += 1; m = 1; } else m += 1;
  }
  return out.reverse();
}

// What the school owes in total. A month with unrated days has an incomplete earned figure, so its
// owed counts as at least zero: it must not lower the total below what the rated days justify.
export function owedTotal(months) {
  return months.reduce((sum, m) => sum + (m.missing_rate ? Math.max(m.owed, 0) : m.owed), 0);
}

export function taxYearOf(day) {
  const year = Number(day.slice(0, 4));
  return day.slice(5) >= "04-06" ? year : year - 1;
}

export function taxYearSummary(year, days, payments, rates) {
  const start = `${pad(year, 4)}-04-06`, end = `${pad(year + 1, 4)}-04-05`;
  let lessons = 0, earned = 0, unratedDays = 0, unratedLessons = 0;
  for (const [day, rec] of Object.entries(days)) {
    if (start <= day && day <= end) {
      lessons += rec.lessons;
      const amount = dayAmount(rec.lessons, rateOn(rates, day));
      if (amount === null) { unratedDays += 1; unratedLessons += rec.lessons; }
      else earned += amount;
    }
  }
  let paid = 0, received = 0;
  for (const p of payments) {
    const y = Number(p.month.slice(0, 4)), m = Number(p.month.slice(5, 7));
    if ((m >= 4 ? y : y - 1) === year) paid += p.pence; // for this tax year's months
    if (start <= p.received && p.received <= end) received += p.pence; // received in this tax year
  }
  return { year, start, end, lessons, earned, paid, received,
    missing_rate: unratedDays > 0, unrated_days: unratedDays, unrated_lessons: unratedLessons };
}

// Dates from trackingSince to yesterday with a usual count > 0 and no row.
export function toConfirm(timetable, trackingSince, days, today) {
  if (trackingSince === null || trackingSince === undefined) return [];
  const out = [];
  let day = trackingSince;
  while (day < today) {
    const usual = timetable[weekdayIndex(day)];
    if (usual > 0 && !(day in days)) out.push({ date: day, usual });
    day = addDays(day, 1);
  }
  return out;
}

export function defaultPaymentMonth(months, today) {
  const owing = months.filter((m) => m.owed > 0).map((m) => m.month);
  if (owing.length) return owing.reduce((a, b) => (b < a ? b : a));
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (m === 1) { y -= 1; m = 12; } else m -= 1;
  return `${pad(y, 4)}-${pad(m)}`;
}

export function rateChangePreview(rates, newPence, effectiveFrom, days) {
  const newRates = { ...rates, [effectiveFrom]: newPence };
  let changed = 0, oldTotal = 0, newTotal = 0, unknown = 0;
  for (const [day, rec] of Object.entries(days)) {
    const n = rec.lessons;
    if (n === 0) continue;
    const oldRate = rateOn(rates, day), newRate = rateOn(newRates, day);
    if (oldRate === newRate) continue;
    changed += 1;
    if (oldRate === null) unknown += 1;
    oldTotal += dayAmount(n, oldRate) || 0;
    newTotal += n * newRate;
  }
  return { changed_days: changed, old_total: oldTotal, new_total: newTotal, old_unknown_days: unknown };
}
