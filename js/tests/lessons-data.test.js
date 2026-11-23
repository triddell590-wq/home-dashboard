// Ported from ml-trading-strategy/tests/test_lessons_api.py: each HTTP call becomes the matching
// action on a fresh in-memory backend, each GET /api/lessons becomes buildLessons(readLessons()).
import { test, eq, ok } from "./harness.js";
import { londonDay } from "../core/dom.js";
import { createMemoryData } from "../core/data-memory.js";
import { useData, startData, data } from "../core/data.js";
import {
  checkDay, checkPayment, checkRate, checkLessonSettings, isRealDate,
  MSG_LESSONS, MSG_FUTURE, MSG_DATE, MSG_PAYMENT, MSG_MONTH, MSG_RATE, MSG_TIMETABLE, MSG_CONFIRM,
} from "../lessons/checks.js";
import { recordsFrom, readLessons, watchLessons, buildLessons } from "../lessons/records.js";
import {
  saveDay, removeDay, addPayment, removePayment, previewRate, saveRate, saveLessonSettings,
} from "../lessons/actions.js";
import { monthCsv, taxYearCsv } from "../lessons/csv.js";

const TODAY = "2026-11-22";
const NOW = "2026-11-22T14:00:00.000Z";
const onFail = () => {};
const opts = (today = TODAY, now = NOW) => ({ today, now, onFail });
const tick = () => new Promise((r) => setTimeout(r, 0));

const get = async (d, today = TODAY) => buildLessons(await readLessons(d), today);
const putDay = (d, day, n, note = "", today = TODAY) => saveDay(d, day, n, note, opts(today));
async function setRate(d, pence = 1800, from = "2026-01-01", confirm) {
  eq(saveRate(d, await readLessons(d), { pence, effectiveFrom: from, confirm }, { onFail }), { ok: true });
}
let nextId = 0;
const pay = (d, month, pence, received = "2026-11-20", note = "", today = TODAY) =>
  addPayment(d, { received, pence, month, note }, { ...opts(today), id: `p${++nextId}` });
async function setTimetable(d, timetable, trackingSince, today = TODAY) {
  const current = (await readLessons(d)).settings;
  return saveLessonSettings(d, current, { timetable, trackingSince }, { today, onFail });
}

// A quote-aware CSV reader (the Python tests use csv.reader).
function rows(text) {
  const out = [];
  let row = [], f = "", quoted = false, any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') quoted = false; else f += c;
    } else if (c === '"') { quoted = true; any = true; }
    else if (c === ",") { row.push(f); f = ""; any = true; }
    else if (c === "\r" && text[i + 1] === "\n") { if (any || f) row.push(f); out.push(row); row = []; f = ""; any = false; i++; }
    else { f += c; any = true; }
  }
  if (any || f) { row.push(f); out.push(row); }
  return out;
}
const has = (table, row) => table.some((r) => JSON.stringify(r) === JSON.stringify(row));

test("test_empty_state", async () => {
  const body = await get(createMemoryData());
  ok(body.rate === null && body.timetable === null);
  eq(body.months, []); eq(body.owed_total, 0);
  ok(body.expected_today === null && body.tracking_since === null);
  eq(body.today, "2026-11-22");
  eq(body.this_month.status, "empty");
  eq(body.to_confirm, []);
  eq(Object.keys(body).sort(), ["today", "this_month", "months", "owed_total", "owed_incomplete", "tax_year", "to_confirm",
    "expected_today", "rate", "timetable", "tracking_since", "rate_default_from", "default_payment_month", "payments"].sort());
});

test("test_today_is_london_date", async () => {
  const d = createMemoryData();
  const today = londonDay(new Date("2026-11-25T01:30:00Z"));
  eq(today, "2026-11-25");
  eq((await setTimetable(d, [0, 0, 6, 0, 0, 0, 0], "2026-11-24", today)).ok, true);
  const body = await get(d, today);
  eq(body.today, "2026-11-25");
  eq(body.expected_today, 6);
  eq(body.to_confirm.map((c) => c.date), []);
  putDay(d, "2026-11-25", 5, "", today);
  ok((await get(d, today)).expected_today === null);
});

test("test_save_day_and_month_totals", async () => {
  const d = createMemoryData();
  await setRate(d);
  eq(putDay(d, "2026-11-18", 6), { ok: true });
  let body = await get(d);
  eq(body.this_month.earned, 10800);
  eq(body.rate, { pence: 1800, effective_from: "2026-01-01" });
  eq(body.this_month.days[0].date, "2026-11-18");
  eq(putDay(d, "2026-11-18", 5), { ok: true });
  body = await get(d);
  eq(body.this_month.earned, 9000);
  eq(body.months[0].month, "2026-11");
  eq(body.owed_total, 9000);
});

test("test_day_checks", async () => {
  const cases = [
    ["2026-11-18", 31, MSG_LESSONS], ["2026-11-18", -1, MSG_LESSONS], ["2026-11-18", 2.5, MSG_LESSONS],
    ["2026-11-18", true, MSG_LESSONS], ["2026-11-18", "3", MSG_LESSONS],
    ["2026-11-23", 3, "That date is in the future"], ["2026-02-30", 3, "That is not a date"]];
  for (const [day, lessons, message] of cases) {
    const d = createMemoryData();
    eq(checkDay(day, lessons, TODAY), message);
    eq(putDay(d, day, lessons), { error: message });
    eq((await get(d)).months, []);
    eq(await d.list("lessonDays"), []);
  }
  eq(MSG_LESSONS, "Lessons must be a whole number from 0 to 30");
  ok(checkDay("2026-11-18", 0, TODAY) === null && checkDay("2026-11-22", 30, TODAY) === null);
  ok(!isRealDate("2026-2-3") && !isRealDate("٢٠٢٦-١١-١٨") && !isRealDate(20261118) && isRealDate("2028-02-29"));
});

test("test_delete_day", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 6);
  eq(removeDay(d, "2026-11-18", { onFail }), { ok: true });
  eq((await get(d)).months, []);
  eq(removeDay(d, "2026-11-18", { onFail }), { ok: true });
  eq(removeDay(d, "nonsense", { onFail }), { error: MSG_DATE });
});

test("test_payment_flow", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 5);
  eq(addPayment(d, { received: "2026-11-20", pence: 9000, month: "2026-11", note: "bacs" }, { ...opts(), id: "p1" }), { ok: true });
  let body = await get(d);
  ok(body.owed_total === 0 && body.this_month.status === "paid");
  removePayment(d, "p1", { onFail });
  body = await get(d);
  eq(body.owed_total, 9000);
  eq(removePayment(d, "p1", { onFail }), { ok: true });
});

test("addPayment makes an id when none is given", async () => {
  const d = createMemoryData();
  addPayment(d, { received: "2026-11-20", pence: 500, month: "2026-11", note: "" }, opts());
  const list = await d.list("lessonPayments");
  eq(list.length, 1);
  ok(typeof list[0].id === "string" && list[0].id.length > 10);
});

test("test_payment_checks", async () => {
  const cases = [
    [{ received: "2026-11-20", pence: 0, month: "2026-11" }, MSG_PAYMENT],
    [{ received: "2026-11-20", pence: 1_000_001, month: "2026-11" }, MSG_PAYMENT],
    [{ received: "2026-11-20", pence: 10.5, month: "2026-11" }, MSG_PAYMENT],
    [{ received: "2026-11-23", pence: 9000, month: "2026-11" }, "That date is in the future"],
    [{ received: "2026-11-20", pence: 9000, month: "2026-12" }, "That month hasn't started yet"],
    [{ received: "nope", pence: 9000, month: "2026-11" }, "That is not a date"],
    [{ received: "2026-11-20", pence: 9000, month: "2026-13" }, "That is not a date"]];
  for (const [payload, message] of cases) {
    const d = createMemoryData();
    eq(checkPayment(payload, TODAY), message);
    eq(addPayment(d, { ...payload, note: "" }, { ...opts(), id: "x" }), { error: message });
    eq(await d.list("lessonPayments"), []);
  }
  eq([MSG_PAYMENT, MSG_MONTH], ["A payment must be between £0.01 and £10,000", "That month hasn't started yet"]);
  ok(checkPayment({ received: "2026-11-20", pence: 1_000_000, month: "2026-11" }, TODAY) === null);
});

test("test_rate_change_needs_confirm", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 6);
  const change = { pence: 2000, effectiveFrom: "2026-11-01" };
  eq(saveRate(d, await readLessons(d), change, { onFail }),
    { error: "This changes days already recorded", preview: { changed_days: 1, old_total: 10800, new_total: 12000, old_unknown_days: 0 } });
  eq(MSG_CONFIRM, "This changes days already recorded");
  eq((await d.list("lessonRates")).map((r) => r.id), ["2026-01-01"]);
  eq((await get(d)).this_month.earned, 10800);
  eq(saveRate(d, await readLessons(d), { ...change, confirm: true }, { onFail }), { ok: true });
  eq((await get(d)).this_month.earned, 12000);
  // a rate dated after every recorded day saves without confirm
  eq(saveRate(d, await readLessons(d), { pence: 2200, effectiveFrom: "2026-11-19" }, { onFail }), { ok: true });
  eq((await get(d)).rate, { pence: 2200, effective_from: "2026-11-19" });
  // confirm must be exactly true
  eq(saveRate(d, await readLessons(d), { pence: 3000, effectiveFrom: "2026-11-01", confirm: "yes" }, { onFail }).error, MSG_CONFIRM);
});

test("test_rate_checks", async () => {
  const d = createMemoryData();
  for (const pence of [0, 100_001, 18.5, true]) {
    eq(checkRate({ pence, effectiveFrom: "2026-11-01" }), MSG_RATE);
    eq(saveRate(d, await readLessons(d), { pence, effectiveFrom: "2026-11-01" }, { onFail }), { error: MSG_RATE });
  }
  eq(checkRate({ pence: 1800, effectiveFrom: "x" }), "That is not a date");
  eq(MSG_RATE, "A rate must be between £0.01 and £1,000");
  eq(await d.list("lessonRates"), []);
});

test("test_rate_preview_endpoint", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 6);
  eq(previewRate(await readLessons(d), { pence: 2000, effectiveFrom: "2026-11-01" }),
    { changed_days: 1, old_total: 10800, new_total: 12000, old_unknown_days: 0 });
  eq((await get(d)).rate.pence, 1800);   // preview saves nothing
  eq(previewRate(await readLessons(d), { pence: 0, effectiveFrom: "2026-11-01" }), { error: MSG_RATE });
});

test("test_settings_and_to_confirm", async () => {
  const d = createMemoryData();
  eq((await setTimetable(d, [6, 0, 0, 0, 0, 0, 0])).ok, true);
  eq((await get(d)).tracking_since, "2026-11-22");   // first save defaults to today
  eq(await setTimetable(d, [6, 0, 0, 0, 0, 0, 0], "2026-11-09"), { ok: true, timetable: [6, 0, 0, 0, 0, 0, 0], trackingSince: "2026-11-09" });
  const body = await get(d);
  eq(body.timetable, [6, 0, 0, 0, 0, 0, 0]);
  eq(body.tracking_since, "2026-11-09");
  eq(body.to_confirm, [{ date: "2026-11-09", usual: 6 }, { date: "2026-11-16", usual: 6 }]);
  // a later save without a date keeps what was set
  await setTimetable(d, [3, 0, 0, 0, 0, 0, 0]);
  eq((await get(d)).tracking_since, "2026-11-09");
});

test("test_expected_today_zero_is_none", async () => {
  const d = createMemoryData();
  await setTimetable(d, [6, 6, 6, 6, 6, 6, 0]);   // Sunday is 0
  ok((await get(d)).expected_today === null);
});

test("test_settings_checks", async () => {
  const cases = [
    [{ timetable: [1, 2, 3, 4, 5, 6] }, MSG_TIMETABLE], [{ timetable: [1, 2, 3, 4, 5, 6, 31] }, MSG_TIMETABLE],
    [{ timetable: [1, 2, 3, 4, 5, 6, 2.5] }, MSG_TIMETABLE], [{ timetable: [1, 2, 3, 4, 5, 6, true] }, MSG_TIMETABLE],
    [{ timetable: "1234567" }, MSG_TIMETABLE],
    [{ timetable: [1, 2, 3, 4, 5, 6, 7], trackingSince: "2026-11-23" }, "That date is in the future"],
    [{ timetable: [1, 2, 3, 4, 5, 6, 7], trackingSince: "x" }, "That is not a date"]];
  for (const [payload, message] of cases) {
    const d = createMemoryData();
    eq(checkLessonSettings(payload, TODAY), message);
    eq(saveLessonSettings(d, null, payload, { today: TODAY, onFail }), { error: message });
    ok((await get(d)).timetable === null);
  }
  eq(MSG_TIMETABLE, "The timetable needs seven numbers from 0 to 30");
});

test("test_csv_month_and_tax_year", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 6, "cover");
  putDay(d, "2026-03-31", 2);   // previous tax year (2025)
  pay(d, "2026-11", 5000, "2026-11-20", "bacs");
  const records = await readLessons(d);
  const m = monthCsv(records, "2026-11", TODAY);
  eq(m.name, "lessons-2026-11.csv");
  ok(m.text.endsWith("\r\n") && !m.text.replace(/\r\n/g, "").includes("\n"));
  let table = rows(m.text);
  eq(table[0], ["date", "lessons", "rate", "amount"]);
  ok(has(table, ["2026-11-18", "6", "18.00", "108.00"]));
  ok(!has(table, ["2026-03-31", "2", "18.00", "36.00"]));
  ok(has(table, ["payment received", "month", "amount", "note"]));
  ok(has(table, ["2026-11-20", "2026-11", "50.00", "bacs"]));
  ok(has(table, ["total", "6", "", "108.00"]));
  ok(has(table, ["paid", "", "", "50.00"]));
  ok(has(table, ["owed", "", "", "58.00"]));

  const t = taxYearCsv(records, 2026);
  eq(t.name, "lessons-tax-year-2026.csv");
  table = rows(t.text);
  ok(has(table, ["2026-11-18", "6", "18.00", "108.00"]));
  ok(!table.some((r) => r.length && r[0] === "2026-03-31"));
  ok(has(table, ["total", "6", "", "108.00"]));
  ok(has(rows(taxYearCsv(records, 2025).text), ["2026-03-31", "2", "18.00", "36.00"]));
});

test("test_csv_unrated_day_is_blank", async () => {
  const d = createMemoryData();
  putDay(d, "2026-11-18", 6);
  ok(has(rows(monthCsv(await readLessons(d), "2026-11", TODAY).text), ["2026-11-18", "6", "", ""]));
});

test("test_to_confirm_uses_london_date", async () => {
  const d = createMemoryData();
  const today = "2026-11-25";
  eq((await setTimetable(d, [0, 6, 0, 0, 0, 0, 0], "2026-11-23", today)).ok, true);
  const body = await get(d, today);
  eq(body.today, "2026-11-25");
  eq(body.to_confirm, [{ date: "2026-11-24", usual: 6 }]);   // Tue 24 is yesterday in London
});

test("test_csv_notes_are_not_formulas", async () => {
  for (const note of ["=1+1", "+1", "-2", "@SUM(A1)", "\tx", "\rx"]) {
    const d = createMemoryData();
    await setRate(d);
    putDay(d, "2026-11-18", 1);
    pay(d, "2026-11", 500, "2026-11-20", note);
    const table = rows(monthCsv(await readLessons(d), "2026-11", TODAY).text);
    ok(has(table, ["2026-11-20", "2026-11", "5.00", "'" + note]), `note ${JSON.stringify(note)}`);
  }
});

test("test_csv_plain_note_unchanged", async () => {
  const d = createMemoryData();
  pay(d, "2026-11", 500, "2026-11-20", "bacs");
  ok(has(rows(monthCsv(await readLessons(d), "2026-11", TODAY).text), ["2026-11-20", "2026-11", "5.00", "bacs"]));
});

test("csv fields are quoted like Python's csv.writer", async () => {
  const d = createMemoryData();
  pay(d, "2026-11", 500, "2026-11-20", 'say "hi", ok');
  pay(d, "2026-11", 600, "2026-11-21", "two\nlines");
  const text = monthCsv(await readLessons(d), "2026-11", TODAY).text;
  ok(text.includes('2026-11-20,2026-11,5.00,"say ""hi"", ok"\r\n'));
  ok(text.includes('2026-11-21,2026-11,6.00,"two\nlines"\r\n'));
  ok(has(rows(text), ["2026-11-20", "2026-11", "5.00", 'say "hi", ok']));
});

test("test_payments_listed_newest_first", async () => {
  const d = createMemoryData();
  addPayment(d, { received: "2026-11-10", pence: 5000, month: "2026-10", note: "first" }, { ...opts(TODAY, "2026-11-22T10:00:00.000Z"), id: "a" });
  addPayment(d, { received: "2026-11-15", pence: 7000, month: "2026-11", note: "" }, { ...opts(TODAY, "2026-11-22T10:00:01.000Z"), id: "b" });
  addPayment(d, { received: "2026-11-15", pence: 100, month: "2026-11", note: "x" }, { ...opts(TODAY, "2026-11-22T10:00:02.000Z"), id: "c" });
  eq((await get(d)).payments, [
    { id: "c", received: "2026-11-15", month: "2026-11", pence: 100, note: "x" },
    { id: "b", received: "2026-11-15", month: "2026-11", pence: 7000, note: "" },
    { id: "a", received: "2026-11-10", month: "2026-10", pence: 5000, note: "first" }]);
});

test("test_reviewer_scenario_backfilled_days_before_rate", async () => {
  const d = createMemoryData();
  await setRate(d, 1800, "2026-11-22");
  for (const day of ["2026-10-06", "2026-10-13", "2026-10-20"]) putDay(d, day, 6);
  putDay(d, "2026-11-22", 6);
  pay(d, "2026-10", 10800);
  const body = await get(d);
  const ty = body.tax_year;
  ok(ty.missing_rate === true && ty.unrated_days === 3 && ty.unrated_lessons === 18);
  ok(body.owed_incomplete === true);
  const oct = body.months.find((m) => m.month === "2026-10");
  ok(oct.missing_rate && oct.status !== "late");
  ok(!body.months.some((m) => m.status === "late"));
  eq(body.owed_total, 10800);   // November's day; October's -£108 is not trusted
});

test("test_owed_incomplete_false_when_every_day_has_a_rate", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-11-18", 6);
  const body = await get(d);
  ok(body.owed_incomplete === false);
  ok(body.tax_year.missing_rate === false);
});

test("test_tax_year_received_and_paid_for_months", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-03-30", 2);
  pay(d, "2026-03", 3600, "2026-04-07");   // for last tax year, received in this one
  pay(d, "2026-11", 5000, "2026-11-20");
  const ty = (await get(d)).tax_year;
  ok(ty.paid === 5000 && ty.received === 8600);
});

test("test_rate_default_from", async () => {
  const d = createMemoryData();
  eq((await get(d)).rate_default_from, "2026-11-22");   // today
  await setTimetable(d, [0, 0, 0, 0, 0, 0, 0], "2026-10-01");
  eq((await get(d)).rate_default_from, "2026-10-01");   // tracking since
  putDay(d, "2026-10-06", 6);
  putDay(d, "2026-10-13", 6);
  eq((await get(d)).rate_default_from, "2026-10-06");   // earliest day with no rate
  await setRate(d, 1800, "2026-10-06", true);
  eq((await get(d)).rate_default_from, "2026-10-01");   // all covered: tracking since
});

test("test_future_rate_date_is_accepted", async () => {
  const d = createMemoryData();
  eq(saveRate(d, await readLessons(d), { pence: 2000, effectiveFrom: "2027-01-01" }, { onFail }), { ok: true });
});

test("test_preview_reports_days_with_no_old_rate", async () => {
  const d = createMemoryData();
  putDay(d, "2026-10-06", 6);
  eq(previewRate(await readLessons(d), { pence: 3600, effectiveFrom: "2026-10-01" }),
    { changed_days: 1, old_total: 0, new_total: 21600, old_unknown_days: 1 });
});

test("test_csv_unrated_days_row_and_blank_total", async () => {
  const d = createMemoryData();
  await setRate(d, 1800, "2026-11-01");
  putDay(d, "2026-10-06", 5);
  putDay(d, "2026-11-02", 6);
  const records = await readLessons(d);
  const tax = rows(taxYearCsv(records, 2026).text);
  ok(has(tax, ["unrated days", "1", "5", ""]));
  ok(has(tax, ["total", "11", "", ""]));
  ok(tax.findIndex((r) => r[0] === "unrated days") < tax.findIndex((r) => r[0] === "total"));
  const month = rows(monthCsv(records, "2026-10", TODAY).text);
  ok(has(month, ["unrated days", "1", "5", ""]) && has(month, ["total", "5", "", ""]));
  ok(!month.some((r) => r.length && r[0] === "owed" && r[3]));
  const complete = rows(monthCsv(records, "2026-11", TODAY).text);
  ok(!complete.some((r) => r.length && r[0] === "unrated days"));
  ok(has(complete, ["total", "6", "", "108.00"]));
});

test("test_tax_year_csv_has_payment_rows_and_both_payment_totals", async () => {
  const d = createMemoryData();
  await setRate(d);
  putDay(d, "2026-03-30", 2);
  putDay(d, "2026-11-18", 6);
  pay(d, "2026-03", 3600, "2026-04-07", "late");
  pay(d, "2026-11", 5000, "2026-11-20", "bacs");
  const table = rows(taxYearCsv(await readLessons(d), 2026).text);
  ok(has(table, ["payment received", "month", "amount", "note"]));
  ok(has(table, ["2026-11-20", "2026-11", "50.00", "bacs"]));
  ok(has(table, ["2026-04-07", "2026-03", "36.00", "late"]));   // received this tax year
  ok(has(table, ["paid for this tax year's months", "", "", "50.00"]));
  ok(has(table, ["received in this tax year", "", "", "86.00"]));
  ok(has(table, ["total", "6", "", "108.00"]));
});

// --- new tests ---------------------------------------------------------------------------

test("written documents have the spec's shape", async () => {
  const mem = createMemoryData();
  saveDay(mem, "2026-11-18", 6, "cover", opts());
  addPayment(mem, { received: "2026-11-20", pence: 9000, month: "2026-11", note: "bacs" }, { ...opts(), id: "p1" });
  saveRate(mem, await readLessons(mem), { pence: 1800, effectiveFrom: "2026-01-01", confirm: true }, { onFail });
  saveLessonSettings(mem, null, { timetable: [0, 6, 0, 4, 0, 0, 0], trackingSince: "2026-11-09" }, { today: TODAY, onFail });
  eq(await mem.get("lessonDays/2026-11-18"), { lessons: 6, note: "cover", confirmedAt: NOW });
  eq(await mem.get("lessonPayments/p1"), { received: "2026-11-20", pence: 9000, month: "2026-11", note: "bacs", addedAt: NOW });
  eq(await mem.get("lessonRates/2026-01-01"), { pence: 1800 });
  eq(await mem.get("settings/lessons"), { timetable: [0, 6, 0, 4, 0, 0, 0], trackingSince: "2026-11-09" });
});

test("saveDay reports saved without waiting for the server", () => {
  const d = { ...createMemoryData(), set: () => new Promise(() => {}) };
  eq(saveDay(d, "2026-11-18", 6, "", { today: TODAY, now: NOW, onFail() {} }), { ok: true });   // synchronous return
});

test("a rejected write is reported plainly", async () => {
  const failed = [];
  const d = { ...createMemoryData(), set: () => Promise.reject(new Error("denied")), remove: () => { throw new Error("denied"); } };
  eq(saveDay(d, "2026-11-18", 6, "", { today: TODAY, now: NOW, onFail: (m) => failed.push(m) }), { ok: true });
  removeDay(d, "2026-11-18", { onFail: (m) => failed.push(m) });
  await tick();
  eq(failed, ["Couldn't save — try again", "Couldn't save — try again"]);
});

test("recordsFrom skips documents that are not valid records", () => {
  const r = recordsFrom({
    dayDocs: [{ id: "2026-02-30", lessons: 3 }, { id: "2026-11-18", lessons: "6" }, { id: "2026-11-19", lessons: 4 }],
    paymentDocs: [{ id: "x", received: "2026-11-20", month: "2026-11" }], rateDocs: [{ id: "nope", pence: 1800 }], settingsDoc: null });
  eq(r, { days: { "2026-11-19": { lessons: 4, note: "" } }, payments: [], rates: {}, settings: null });
});

test("recordsFrom normalises notes and rejects bad numbers and ids", () => {
  const r = recordsFrom({
    dayDocs: [{ id: "2026-11-18", lessons: 6, note: null }, { id: "2026-11-17", lessons: 31 }, { id: "2026-1-17", lessons: 2 }, { id: "2026-11-16", lessons: 2.5 }],
    paymentDocs: [{ id: "p", received: "2026-11-20", month: "2026-11", pence: 100, note: null, addedAt: NOW },
      { id: "q", received: "2026-11-20", month: "2026-11", pence: "100" }, { id: "r", received: "2026-11-20", month: "2026-13", pence: 100 }],
    rateDocs: [{ id: "2026-01-01", pence: 1800 }, { id: "2026-02-01", pence: 0 }, { id: "2026-03-01", pence: NaN }],
    settingsDoc: { timetable: [1, 2, 3], trackingSince: "2026-11-09" } });
  eq(r.days, { "2026-11-18": { lessons: 6, note: "" } });
  eq(r.payments, [{ id: "p", received: "2026-11-20", pence: 100, month: "2026-11", note: "", addedAt: NOW }]);
  eq(r.rates, { "2026-01-01": 1800 });
  eq(r.settings, { timetable: null, trackingSince: "2026-11-09" });
});

test("watchLessons fires again when another writer saves a day", async () => {
  useData(createMemoryData());
  startData("u1");
  const d = data();
  const seen = [];
  const stop = watchLessons(d, (r) => seen.push(r));
  eq(seen.length, 1);   // once all four have reported
  eq(seen[0].days, {});
  data().set("lessonDays/2026-11-18", { lessons: 6, note: "", confirmedAt: NOW });   // a second handle, same backend
  await tick();
  ok("2026-11-18" in seen[seen.length - 1].days);
  stop();
  const n = seen.length;
  await data().set("lessonDays/2026-11-19", { lessons: 4, note: "", confirmedAt: NOW });
  await data().set("settings/lessons", { timetable: [1, 1, 1, 1, 1, 1, 1], trackingSince: "2026-11-01" });
  await tick();
  eq(seen.length, n);
});
