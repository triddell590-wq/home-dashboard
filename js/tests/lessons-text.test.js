import { compact, createRateFlow, dateText, dayPhrase, longDate, monthName, owedLine, parsePounds, paymentMonths, pounds, previewText, statusText } from "../lessons/text.js";
import { eq, test } from "./harness.js";

test("pounds formats pence", () => {
  eq(pounds(10800), "£108");
  eq(pounds(10850), "£108.50");
  eq(pounds(5), "£0.05");
  eq(pounds(-2000), "−£20");
  eq(pounds(null), "—");
  eq(pounds(1234500), "£12,345");
});

test("parsePounds accepts plain amounts", () => {
  eq(parsePounds("108.50"), 10850);
  eq(parsePounds("£108"), 10800);
  eq(parsePounds("108.5"), 10850);
  eq(parsePounds(" 1,080 "), 108000);
  eq(parsePounds("0.05"), 5);
});

test("parsePounds refuses everything else", () => {
  for (const bad of ["-5", "1e3", "abc", "", "10.555", "   ", null, undefined, "1,08", "£", "0", "1.2.3"]) eq(parsePounds(bad), null);
});

test("status words", () => {
  eq(statusText("paid"), "Paid");
  eq(statusText("owed"), "Owed");
  eq(statusText("late"), "Late");
  eq(statusText("overpaid"), "Overpaid");
  eq(statusText("empty"), "Nothing recorded");
});

test("month and date wording", () => {
  eq(monthName("2026-11"), "November 2026");
  eq(dateText("2026-11-17"), "Tuesday 17 November");
});

const base = (over = {}) => ({
  today: "2026-11-22",
  this_month: { month: "2026-11", days: [] },
  months: [],
  owed_total: 0,
  to_confirm: [],
  expected_today: null,
  ...over,
});

test("day phrase: a late month beats the rest", () => {
  const data = base({
    months: [{ month: "2026-10", status: "late", owed: 10800 }, { month: "2026-11", status: "owed", owed: 5000 }],
    to_confirm: [{ date: "2026-11-17", usual: 6 }], expected_today: 6,
  });
  eq(dayPhrase(data), "October unpaid");
});

test("day phrase: days to confirm", () => {
  const two = [{ date: "2026-11-12", usual: 6 }, { date: "2026-11-17", usual: 6 }];
  eq(dayPhrase(base({ to_confirm: [...two, { date: "2026-11-19", usual: 4 }] })), "3 days to confirm");
  eq(dayPhrase(base({ to_confirm: [two[0]], expected_today: 6 })), "1 day to confirm");
});

test("day phrase: a teaching day", () => {
  eq(dayPhrase(base({ expected_today: 6 })), "6 lessons today");
  eq(dayPhrase(base({ expected_today: 1 })), "1 lesson today");
  const entered = base({ this_month: { month: "2026-11", days: [{ date: "2026-11-22", lessons: 6 }] } });
  eq(dayPhrase(entered), "6 lessons today");
  eq(dayPhrase(base()), null);
});

test("owed line", () => {
  const months = [{ month: "2026-10", status: "owed", owed: 10800 }, { month: "2026-11", status: "owed", owed: 32400 }];
  eq(owedLine(base({ owed_total: 43200, months })), "Owed £432, including £108 from October");
  eq(owedLine(base({ owed_total: 32400, months: [months[1]] })), "Owed £324");
  eq(owedLine(base({ owed_total: 0 })), "Nothing owed");
  eq(owedLine(base({ owed_total: -2000 })), "Overpaid by £20");
});

function fakeFlow(changed) {
  const calls = [];
  const preview = async (pence, effectiveFrom) => {
    calls.push({ kind: "preview", pence, effectiveFrom });
    return { changed_days: changed, old_total: 1000, new_total: 2000 };
  };
  const save = async (body) => { calls.push({ kind: "save", body }); return { ok: true }; };
  return { preview, save, calls };
}
const puts = (calls) => calls.filter((c) => c.kind === "save");

test("rate flow: a change to recorded days waits for Confirm", async () => {
  const { preview, save, calls } = fakeFlow(3);
  const flow = createRateFlow({ preview, save });
  const r = await flow.submit(1800, "2026-11-01");
  eq(r.state, "confirm");
  eq(r.preview.changed_days, 3);
  eq(puts(calls).length, 0);
  await flow.confirm();
  eq(puts(calls).map((c) => c.body), [{ pence: 1800, effective_from: "2026-11-01", confirm: true }]);
});

test("rate flow: Confirm sends the previewed values, and is gone after an edit", async () => {
  const { preview, save, calls } = fakeFlow(3);
  const flow = createRateFlow({ preview, save });
  await flow.submit(1800, "2026-11-01");
  // the boxes are edited afterwards; the page resets the flow, so there is nothing to confirm
  flow.reset();
  eq((await flow.confirm()).state, "none");
  eq(puts(calls).length, 0);
  // a fresh preview confirms exactly what it previewed, whatever the boxes say now
  await flow.submit(2000, "2026-10-01");
  await flow.confirm();
  eq(puts(calls).map((c) => c.body), [{ pence: 2000, effective_from: "2026-10-01", confirm: true }]);
  eq((await flow.confirm()).state, "none");
});

test("rate flow: no recorded days changed saves straight away without confirm", async () => {
  const { preview, save, calls } = fakeFlow(0);
  const flow = createRateFlow({ preview, save });
  eq((await flow.submit(1800, "2026-11-01")).state, "saved");
  eq(puts(calls).map((c) => c.body), [{ pence: 1800, effective_from: "2026-11-01", confirm: false }]);
});

test("compact drops null and undefined so append never writes the text \"null\"", () => {
  const a = {};
  const b = {};
  eq(compact([null, a, undefined, b, null]), [a, b]);
  eq(compact([null, null]), []);
});

test("owed line while some days have no rate is never 'Nothing owed' or 'Overpaid'", () => {
  const months = [{ month: "2026-10", status: "owed", owed: 10800 }];
  eq(owedLine(base({ owed_total: 10800, owed_incomplete: true, months })), "Owed at least £108 — some days have no rate");
  eq(owedLine(base({ owed_total: 0, owed_incomplete: true })), "Owed amount unknown — some days have no rate");
  eq(owedLine(base({ owed_total: -2000, owed_incomplete: true })), "Owed amount unknown — some days have no rate");
  eq(owedLine(base({ owed_total: 0, owed_incomplete: false })), "Nothing owed");
});

test("rate preview text says 'no rate' for days whose old amount was unknown", () => {
  eq(previewText({ changed_days: 2, old_total: 0, new_total: 21600, old_unknown_days: 2 }),
    "This changes 2 days already recorded (no rate → £216)");
  eq(previewText({ changed_days: 3, old_total: 10800, new_total: 32400, old_unknown_days: 2 }),
    "This changes 3 days already recorded (£108 plus 2 with no rate → £324)");
  eq(previewText({ changed_days: 1, old_total: 10800, new_total: 12000, old_unknown_days: 0 }),
    "This changes 1 day already recorded (£108 → £120)");
  eq(previewText({ changed_days: 1, old_total: 10800, new_total: 12000 }),
    "This changes 1 day already recorded (£108 → £120)");
});

test("long dates are friendly, not ISO", () => {
  eq(longDate("2026-11-01"), "1 November 2026");
  eq(longDate("2027-01-22"), "22 January 2027");
});

test("payment months run from the earliest record to this month, newest first", () => {
  const months = [{ month: "2026-11" }, { month: "2026-10" }, { month: "2026-09" }];
  const list = paymentMonths({ today: "2026-11-22", months, tracking_since: null, default_payment_month: "2026-10" });
  eq(list, ["2026-11", "2026-10", "2026-09"]);
  const long = [{ month: "2026-11" }, ...Array.from({ length: 19 }, (_, i) => ({ month: i < 10 ? `2026-${String(10 - i).padStart(2, "0")}` : `2025-${String(22 - i).padStart(2, "0")}` }))];
  const all = paymentMonths({ today: "2026-11-22", months: long, tracking_since: "2025-01-05", default_payment_month: "2026-10" });
  eq(all[0], "2026-11");
  eq(all[all.length - 1], "2025-01");
  eq(all.length, 23);
  eq(paymentMonths({ today: "2026-11-22", months: [], tracking_since: "2026-08-03", default_payment_month: "2026-10" }),
    ["2026-11", "2026-10", "2026-09", "2026-08"]);
  eq(paymentMonths({ today: "2026-11-22", months: [], tracking_since: null, default_payment_month: "2026-10" }), ["2026-11", "2026-10"]);
});
