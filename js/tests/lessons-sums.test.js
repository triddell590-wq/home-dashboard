// Ported case for case from ml-trading-strategy/tests/test_lessons_sums.py, plus the London-date tests.
import { test, eq } from "./harness.js";
import { londonDay, londonHourStart } from "../core/dom.js";
import {
  rateOn, dayAmount, monthSummary, allMonths, owedTotal, taxYearOf, taxYearSummary, toConfirm,
  defaultPaymentMonth, rateChangePreview, addDays, weekdayIndex,
} from "../lessons/sums.js";

const RATES = { "2026-09-01": 1800 };
const TODAY = "2026-11-22";
const d = (n, note = "") => ({ lessons: n, note });
const pay = (pence, month, id = 1) => ({ id, received: "2026-11-01", pence, month, note: "" });

test("test_rate_on_picks_latest_effective", () => {
  const rates = { "2026-09-01": 1800, "2026-11-15": 2000 };
  eq(rateOn(rates, "2026-11-14"), 1800);
  eq(rateOn(rates, "2026-11-15"), 2000);
  eq(rateOn(rates, "2026-08-31"), null);
});

test("test_day_amount", () => {
  eq(dayAmount(6, 1800), 10800);
  eq(dayAmount(6, null), null);
  eq(dayAmount(0, null), 0);
});

test("test_month_with_mid_month_rate_change", () => {
  const rates = { "2026-09-01": 1800, "2026-11-15": 2000 };
  const days = { "2026-11-10": d(6), "2026-11-20": d(6) };
  const m = monthSummary("2026-11", days, [], rates, TODAY);
  eq(m.earned, 6 * 1800 + 6 * 2000);
  eq(m.earned, 22800);
  eq(m.lessons, 12);
  eq(m.missing_rate, false);
  eq(m.days.map((x) => x.date), ["2026-11-10", "2026-11-20"]);
});

test("test_missing_rate_is_unknown_not_zero", () => {
  const days = { "2026-11-10": d(6) };
  const m = monthSummary("2026-11", days, [], {}, TODAY);
  eq(m.days[0].amount, null);
  eq(m.earned, 0);
  eq(m.missing_rate, true);
  eq(m.status, "owed");
});

test("test_zero_lesson_day_without_rate_is_not_missing", () => {
  const days = { "2026-11-10": d(0) };
  const m = monthSummary("2026-11", days, [], {}, TODAY);
  eq(m.days[0].amount, 0);
  eq(m.missing_rate, false);
  eq(m.status, "empty");
});

test("test_status_edges", () => {
  const days = { "2026-10-05": d(5) }; // 9000 earned
  let m = monthSummary("2026-10", days, [pay(9000, "2026-10")], RATES, TODAY);
  eq([m.status, m.owed], ["paid", 0]);
  m = monthSummary("2026-10", days, [pay(9500, "2026-10")], RATES, TODAY);
  eq([m.status, m.owed], ["overpaid", -500]);
  m = monthSummary("2026-10", days, [], RATES, "2026-11-14");
  eq([m.status, m.owed], ["owed", 9000]);
  m = monthSummary("2026-10", days, [], RATES, "2026-11-15");
  eq(m.status, "late");
  m = monthSummary("2026-10", {}, [], RATES, TODAY);
  eq(m.status, "empty");
});

test("test_payment_for_month_with_nothing_earned", () => {
  const days = { "2026-09-05": d(5) };
  const months = allMonths(days, [pay(5000, "2026-08")], RATES, TODAY);
  const aug = months.filter((m) => m.month === "2026-08")[0];
  eq([aug.status, aug.owed], ["overpaid", -5000]);
  const without = owedTotal(allMonths(days, [], RATES, TODAY));
  eq(owedTotal(months), without - 5000);
});

test("test_all_months_newest_first_and_gap_months", () => {
  const days = { "2026-09-05": d(1), "2026-11-05": d(1) };
  const months = allMonths(days, [], RATES, TODAY);
  eq(months.map((m) => m.month), ["2026-11", "2026-10", "2026-09"]);
  eq(months[1].status, "empty");
  eq(allMonths({}, [], RATES, TODAY), []);
});

test("test_tax_year_edges", () => {
  eq(taxYearOf("2026-04-05"), 2025);
  eq(taxYearOf("2026-04-06"), 2026);
  const days = { "2026-04-06": d(2), "2026-04-05": d(3) };
  const pays = [pay(1000, "2026-04", 1), pay(2000, "2026-03", 2)];
  const s = taxYearSummary(2026, days, pays, RATES);
  eq([s.lessons, s.paid], [2, 1000]);
  eq([s.start, s.end], ["2026-04-06", "2027-04-05"]);
  const s25 = taxYearSummary(2025, days, pays, RATES);
  eq([s25.lessons, s25.paid], [3, 2000]);
});

test("test_to_confirm", () => {
  const tt = [0, 6, 0, 4, 0, 0, 0];
  // 2026-11-22 is a Sunday: Thursdays are 12 and 19 Nov, Tuesday 17 Nov
  const days = { "2026-11-17": d(6) };
  eq(toConfirm(tt, "2026-11-12", days, TODAY), [
    { date: "2026-11-12", usual: 4 },
    { date: "2026-11-19", usual: 4 },
  ]);
  eq(toConfirm(tt, null, days, TODAY), []);
  // today is never listed
  eq(toConfirm(tt, "2026-11-19", {}, "2026-11-19"), []);
});

test("test_default_payment_month", () => {
  const days = { "2026-09-05": d(5), "2026-10-05": d(5) };
  let months = allMonths(days, [pay(9000, "2026-09")], RATES, TODAY);
  eq(defaultPaymentMonth(months, TODAY), "2026-10");
  months = allMonths(days, [pay(9000, "2026-09"), pay(9000, "2026-10")], RATES, TODAY);
  eq(defaultPaymentMonth(months, TODAY), "2026-10");
  eq(defaultPaymentMonth([], "2026-01-10"), "2025-12");
});

test("test_rate_change_preview", () => {
  const days = { "2026-11-10": d(6), "2026-11-20": d(6) };
  eq(rateChangePreview(RATES, 2000, "2026-11-15", days),
    { changed_days: 1, old_total: 10800, new_total: 12000, old_unknown_days: 0 });
  eq(rateChangePreview(RATES, 2000, "2026-12-01", days).changed_days, 0);
});

test("test_unrated_month_is_owed_never_paid_never_late_on_unknown", () => {
  const days = { "2026-10-05": d(6) };
  let m = monthSummary("2026-10", days, [], {}, "2026-11-14");
  eq([m.missing_rate, m.status], [true, "owed"]);
  m = monthSummary("2026-10", days, [], {}, "2026-11-15");
  eq(m.status, "owed"); // nothing known is owed, so never late
  m = monthSummary("2026-10", days, [pay(5000, "2026-10")], {}, "2026-11-14");
  eq(m.status, "owed");
});

test("test_tax_year_earned_with_rate_in_force", () => {
  const rates = { "2025-01-01": 1800 };
  const days = { "2026-04-05": d(3), "2026-04-06": d(2), "2027-04-05": d(4) };
  const s26 = taxYearSummary(2026, days, [], rates);
  eq([s26.lessons, s26.earned], [6, 6 * 1800]);
  const s25 = taxYearSummary(2025, days, [], rates);
  eq([s25.lessons, s25.earned], [3, 3 * 1800]);
});

test("test_tax_year_summary_reports_unrated_days", () => {
  const rates = { "2026-11-22": 1800 };
  const days = { "2026-10-06": d(5), "2026-10-07": d(0), "2026-11-22": d(6) };
  const s = taxYearSummary(2026, days, [], rates);
  eq(s.missing_rate, true);
  eq([s.unrated_days, s.unrated_lessons], [1, 5]); // a 0-lesson day is not unrated
  eq(s.earned, 6 * 1800);
  const ok = taxYearSummary(2026, { "2026-11-22": d(6) }, [], rates);
  eq([ok.missing_rate, ok.unrated_days, ok.unrated_lessons], [false, 0, 0]);
});

test("test_tax_year_received_is_by_received_date", () => {
  const pays = [
    { id: 1, received: "2026-04-05", pence: 1000, month: "2026-03", note: "" },
    { id: 2, received: "2026-04-06", pence: 2000, month: "2026-03", note: "" },
    { id: 3, received: "2027-04-05", pence: 4000, month: "2027-03", note: "" },
    { id: 4, received: "2027-04-06", pence: 8000, month: "2027-04", note: "" },
  ];
  const s = taxYearSummary(2026, {}, pays, RATES);
  eq(s.received, 2000 + 4000);
  eq(s.paid, 4000); // months 2026-04..2027-03: only id 3
});

test("test_owed_total_counts_unrated_month_as_at_least_zero", () => {
  const days = { "2026-10-06": d(6), "2026-11-22": d(6) };
  const rates = { "2026-11-22": 1800 };
  const months = allMonths(days, [pay(10800, "2026-10")], rates, TODAY);
  const oct = months.filter((m) => m.month === "2026-10")[0];
  eq([oct.missing_rate, oct.owed], [true, -10800]);
  eq(owedTotal(months), 10800); // November's 108; October's -108 is not trusted
});

test("test_unrated_month_late_only_when_known_owed_positive", () => {
  let days = { "2026-10-05": d(6) };
  let m = monthSummary("2026-10", days, [], {}, "2026-11-15");
  eq(m.status, "owed"); // nothing known is owed, so not late
  const rates = { "2026-10-05": 1800 };
  days = { "2026-10-04": d(6), "2026-10-05": d(6) };
  m = monthSummary("2026-10", days, [], rates, "2026-11-15");
  eq([m.missing_rate, m.owed, m.status], [true, 10800, "late"]);
  m = monthSummary("2026-10", days, [pay(10800, "2026-10")], rates, "2026-11-15");
  eq(m.status, "owed");
});

test("test_preview_counts_days_with_unknown_old_amount", () => {
  const days = { "2026-10-06": d(6), "2026-11-23": d(6) };
  const p = rateChangePreview({ "2026-11-01": 1800 }, 1800, "2026-10-01", days);
  eq(p, { changed_days: 1, old_total: 0, new_total: 10800, old_unknown_days: 1 });
  eq(rateChangePreview(RATES, 2000, "2026-12-01", days).old_unknown_days, 0);
});

test("londonDay and londonHourStart follow London summer time", () => {
  eq(londonDay(new Date("2026-06-30T23:30:00Z")), "2026-07-01");
  eq(londonDay(new Date("2026-11-24T23:30:00Z")), "2026-11-24");
  eq(londonDay(new Date("2026-11-25T01:30:00Z")), "2026-11-25"); // 20:30 New York on the 24th
  eq(londonHourStart(new Date("2026-06-30T23:30:00Z")), "2026-07-01T00:00");
  eq(londonHourStart(new Date("2026-11-21T18:30:00Z")), "2026-11-21T18:00");
});

test("weekdayIndex is Monday-first and addDays crosses month ends", () => {
  eq(weekdayIndex("2026-11-23"), 0); eq(weekdayIndex("2026-11-22"), 6);
  eq(addDays("2026-11-30", 1), "2026-12-01"); eq(addDays("2027-01-01", -1), "2026-12-31");
});
