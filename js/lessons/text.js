// Lessons wording and parsing. Pure: no `document`, so Node tests cover them.
// Money is integer pence. Dates from the server are London calendar dates ("2026-11-22"), read as written.
import { dayName } from "../weather/text.js";

const MINUS = "−";
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

/** 10800 -> "£108", 10850 -> "£108.50", -2000 -> "−£20", null -> "—". */
export function pounds(pence) {
  if (pence === null || pence === undefined || Number.isNaN(Number(pence))) return "—";
  const n = Math.round(Number(pence));
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  const text = `£${whole}${rest ? "." + String(rest).padStart(2, "0") : ""}`;
  return n < 0 ? MINUS + text : text;
}

/** What someone typed -> pence, or null. Accepts "108", "£108", "108.5", "108.50", "1,080". Nothing else. */
export function parsePounds(text) {
  if (typeof text !== "string") return null;
  const m = /^£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ""));
  const frac = Number((m[2] || "").padEnd(2, "0") || 0);
  const pence = whole * 100 + frac;
  return pence > 0 && Number.isSafeInteger(pence) ? pence : null;
}

/** Drops null/undefined so native append/replaceChildren never writes the text "null". */
export const compact = (list) => list.filter((x) => x !== null && x !== undefined);

const STATUS = { paid: "Paid", owed: "Owed", late: "Late", overpaid: "Overpaid", empty: "Nothing recorded" };
export const statusText = (status) => STATUS[status] || "—";

/** "2026-11" -> "November 2026". */
export function monthName(month) {
  const [y, m] = String(month).split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

const monthOnly = (month) => LONG_MONTHS[Number(String(month).slice(5, 7)) - 1];

/** "2026-11-17" -> "Tuesday 17 November". */
export function dateText(date) {
  const [, m, d] = String(date).slice(0, 10).split("-").map(Number);
  return `${dayName(date)} ${d} ${LONG_MONTHS[m - 1]}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The "Your day" phrase; the first match wins. */
export function dayPhrase(data) {
  if (!data) return null;
  const late = (data.months || []).filter((m) => m.status === "late").map((m) => m.month).sort();
  if (late.length) return `${monthOnly(late[0])} unpaid`;
  const pending = (data.to_confirm || []).length;
  if (pending) return `${plural(pending, "day")} to confirm`;
  const entry = ((data.this_month && data.this_month.days) || []).find((d) => d.date === data.today);
  const n = entry ? entry.lessons : data.expected_today;
  return n > 0 ? `${plural(n, "lesson")} today` : null;
}

/** "2026-11-01" -> "1 November 2026". */
export function longDate(date) {
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`;
}

/** Months for the payment "For month" list: this month back to the earliest record (or tracking start), newest first. */
export function paymentMonths(data) {
  const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  const [ty, tm] = data.today.split("-").map(Number);
  const known = (data.months || []).map((m) => m.month);
  if (data.tracking_since) known.push(String(data.tracking_since).slice(0, 7));
  if (data.default_payment_month) known.push(data.default_payment_month);
  const earliest = known.reduce((a, b) => (b < a ? b : a), key(ty, tm));
  const [ey, em] = earliest.split("-").map(Number);
  const out = [];
  for (let y = ty, m = tm; y > ey || (y === ey && m >= em); m === 1 ? (y--, m = 12) : m--) out.push(key(y, m));
  return out;
}

/** The sentence shown before a rate change is confirmed. Old amounts that were unknown say so. */
export function previewText(p) {
  const unknown = p.old_unknown_days || 0;
  let old = pounds(p.old_total);
  if (unknown >= p.changed_days) old = "no rate";
  else if (unknown > 0) old = `${old} plus ${unknown} with no rate`;
  return `This changes ${plural(p.changed_days, "day")} already recorded (${old} → ${pounds(p.new_total)})`;
}

/** "Owed £432, including £108 from October". */
export function owedLine(data) {
  const total = data.owed_total || 0;
  if (data.owed_incomplete) {
    // Some days have no rate, so the true figure is unknown: never "Nothing owed" or "Overpaid".
    return total > 0 ? `Owed at least ${pounds(total)} — some days have no rate` : "Owed amount unknown — some days have no rate";
  }
  if (total < 0) return `Overpaid by ${pounds(-total)}`;
  if (total === 0) return "Nothing owed";
  const current = data.this_month && data.this_month.month;
  const earlier = (data.months || []).filter((m) => m.month !== current && m.owed > 0).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (earlier.length === 1) return `Owed ${pounds(total)}, including ${pounds(earlier[0].owed)} from ${monthOnly(earlier[0].month)}`;
  if (earlier.length > 1) {
    return `Owed ${pounds(total)}, including ${pounds(earlier.reduce((s, m) => s + m.owed, 0))} from earlier months`;
  }
  return `Owed ${pounds(total)}`;
}

/**
 * The rate change gate: preview first, and only a previewed change can be confirmed. The previewed pence and date
 * are captured together and Confirm sends exactly those; reset() drops them (the page calls it when a box changes).
 * Errors from `preview` and `save` propagate to the caller.
 */
export function createRateFlow({ preview, save }) {
  let pending = null;
  return {
    reset() { pending = null; },
    async submit(pence, effectiveFrom) {
      pending = null;
      const result = await preview(pence, effectiveFrom);
      if (result.changed_days > 0) {
        pending = { pence, effective_from: effectiveFrom };
        return { state: "confirm", preview: result };
      }
      await save({ pence, effective_from: effectiveFrom, confirm: false });
      return { state: "saved" };
    },
    async confirm() {
      if (!pending) return { state: "none" };
      const body = { ...pending, confirm: true };
      pending = null;
      await save(body);
      return { state: "saved" };
    },
  };
}
