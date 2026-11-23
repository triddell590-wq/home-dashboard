// CSV exports for a month or a tax year: rows, columns, order and totals exactly as export() in
// ml-trading-strategy/mltrader/web/lessons_api.py, written the way Python's csv.writer writes.
import { monthSummary, taxYearSummary, rateOn, dayAmount } from "./sums.js";

const pounds = (pence) => (pence === null || pence === undefined ? "" : (pence / 100).toFixed(2));
// Free text must not open as a spreadsheet formula.
const cell = (text) => {
  const s = text === null || text === undefined ? "" : String(text);
  return "=+-@\t\r".includes(s.slice(0, 1)) && s !== "" ? "'" + s : s;
};
const field = (v) => {
  const s = String(v);
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (row) => row.map(field).join(",") + "\r\n";

const byReceived = (a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : 0)
  || ((a.addedAt || "") < (b.addedAt || "") ? -1 : (a.addedAt || "") > (b.addedAt || "") ? 1 : 0)
  || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

function build(dayRows, payRows, summary, month) {
  let text = line(["date", "lessons", "rate", "amount"]);
  for (const r of dayRows) text += line([r.date, r.lessons, pounds(r.rate), pounds(r.amount)]);
  text += line([]);
  text += line(["payment received", "month", "amount", "note"]);
  for (const p of [...payRows].sort(byReceived)) text += line([p.received, p.month, pounds(p.pence), cell(p.note)]);
  text += line([]);
  const unrated = dayRows.filter((r) => r.amount === null);
  const incomplete = unrated.length > 0;
  if (incomplete) text += line(["unrated days", unrated.length, unrated.reduce((s, r) => s + r.lessons, 0), ""]);
  text += line(["total", summary.lessons, "", incomplete ? "" : pounds(summary.earned)]);
  if (month) {
    text += line(["paid", "", "", pounds(summary.paid)]);
    text += line(["owed", "", "", incomplete ? "" : pounds(summary.owed)]);
  } else {
    text += line(["paid for this tax year's months", "", "", pounds(summary.paid)]);
    text += line(["received in this tax year", "", "", pounds(summary.received)]);
  }
  return text;
}

export function monthCsv(records, month, today) {
  const summary = monthSummary(month, records.days, records.payments, records.rates, today);
  const payRows = records.payments.filter((p) => p.month === month);
  return { name: `lessons-${month}.csv`, text: build(summary.days, payRows, summary, month) };
}

export function taxYearCsv(records, year) {
  const start = `${String(year).padStart(4, "0")}-04-06`, end = `${String(year + 1).padStart(4, "0")}-04-05`;
  const dayRows = Object.keys(records.days).filter((d) => start <= d && d <= end).sort().map((date) => {
    const lessons = records.days[date].lessons;
    const rate = rateOn(records.rates, date);
    return { date, lessons, rate, amount: dayAmount(lessons, rate) };
  });
  const summary = taxYearSummary(year, records.days, records.payments, records.rates);
  const forYear = (p) => {
    const y = Number(p.month.slice(0, 4)), m = Number(p.month.slice(5, 7));
    return (m >= 4 ? y : y - 1) === year;
  };
  const payRows = records.payments.filter((p) => forYear(p) || (start <= p.received && p.received <= end));
  return { name: `lessons-tax-year-${year}.csv`, text: build(dayRows, payRows, summary, null) };
}
