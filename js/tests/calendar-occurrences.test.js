// Occurrences and lesson days. Every case uses fixed dates; nothing reads the clock.
import { test, eq } from "./harness.js";
import { occurrences, dueDates, lessonItems } from "../calendar/occurrences.js";

const ev = (over) => ({ id: "e1", title: "X", kind: "job", date: "2026-11-23", time: null, repeat: null, until: null, skipped: [], done: [], note: "", ...over });
const dates = (e, from, to) => occurrences([e], from, to).map((o) => o.date);

test("a one-off is listed only inside the range", () => { eq(dates(ev({ date: "2026-11-24" }), "2026-11-23", "2026-11-30"), ["2026-11-24"]); eq(dates(ev({ date: "2026-11-24" }), "2026-11-25", "2026-11-30"), []); });
test("every N days from part-way through", () => eq(dates(ev({ date: "2026-11-01", repeat: { unit: "day", every: 2, monthly: null } }), "2026-11-23", "2026-11-27"), ["2026-11-23", "2026-11-25", "2026-11-27"]));
test("every 3 weeks", () => eq(dates(ev({ date: "2026-11-23", repeat: { unit: "week", every: 3, monthly: null } }), "2026-11-23", "2027-01-04"), ["2026-11-23", "2026-12-14", "2027-01-04"]));
test("weekly across the October clock change keeps the day and time", () => {
  eq(occurrences([ev({ date: "2026-10-20", time: "09:00", repeat: { unit: "week", every: 1, monthly: null } })], "2026-10-20", "2026-11-03").map((o) => [o.date, o.time]),
    [["2026-10-20", "09:00"], ["2026-10-27", "09:00"], ["2026-11-03", "09:00"]]);
});
test("daily and weekly across the March clock change", () => {
  eq(dates(ev({ date: "2027-03-26", repeat: { unit: "day", every: 1, monthly: null } }), "2027-03-26", "2027-03-30"), ["2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30"]);
  eq(dates(ev({ date: "2027-03-22", repeat: { unit: "week", every: 1, monthly: null } }), "2027-03-22", "2027-04-05"), ["2027-03-22", "2027-03-29", "2027-04-05"]);
});
test("the 31st in shorter months, and every 2 months", () => {
  eq(dates(ev({ date: "2027-01-31", repeat: { unit: "month", every: 1, monthly: "date" } }), "2027-01-01", "2027-05-31"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  eq(dates(ev({ date: "2026-12-31", repeat: { unit: "month", every: 2, monthly: "date" } }), "2026-12-01", "2027-04-30"), ["2026-12-31", "2027-02-28", "2027-04-30"]);
});
test("29 February in other years", () => eq(dates(ev({ date: "2024-02-29", repeat: { unit: "year", every: 1, monthly: null } }), "2025-01-01", "2028-12-31"), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]));
test("nth and last weekday of the month", () => {
  eq(dates(ev({ date: "2026-11-09", repeat: { unit: "month", every: 1, monthly: "weekday", nth: 2 } }), "2026-11-01", "2027-02-28"), ["2026-11-09", "2026-12-14", "2027-01-11", "2027-02-08"]);
  eq(dates(ev({ date: "2026-11-27", repeat: { unit: "month", every: 1, monthly: "weekday", nth: -1 } }), "2026-11-01", "2027-02-28"), ["2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26"]);
});
test("a range far after the start jumps straight there and stops", () => {
  eq(dates(ev({ date: "2020-01-15", repeat: { unit: "month", every: 3, monthly: "date" } }), "2026-11-01", "2027-03-31"), ["2027-01-15"]);
  eq(dueDates(ev({ date: "2020-01-01", repeat: { unit: "day", every: 1, monthly: null } }), "2026-11-23", "2026-11-24"), ["2026-11-23", "2026-11-24"]);
  eq(dueDates(ev({ date: "2026-11-23", repeat: { unit: "week", every: 1, monthly: null }, until: "2026-11-01" }), "2026-11-01", "2026-12-31"), []);
});
test("until, skipped and done", () => {
  const weekly = { unit: "week", every: 1, monthly: null };
  eq(dates(ev({ date: "2026-11-24", repeat: weekly, until: "2026-12-08" }), "2026-11-01", "2026-12-31"), ["2026-11-24", "2026-12-01", "2026-12-08"]);
  eq(dates(ev({ date: "2026-11-24", repeat: weekly, until: "2026-12-08", skipped: ["2026-12-01"] }), "2026-11-01", "2026-12-31"), ["2026-11-24", "2026-12-08"]);
  eq(occurrences([ev({ kind: "deadline", date: "2026-11-28", done: ["2026-11-28"] })], "2026-11-23", "2026-11-30")[0].done, true);
});
test("sorted by date, then all-day first, then title", () => {
  const list = occurrences([ev({ id: "a", title: "Dentist", date: "2026-11-24", time: "14:00" }), ev({ id: "b", title: "Bins", date: "2026-11-24" }),
    ev({ id: "c", title: "Abbey", date: "2026-11-24", time: "14:00" }), ev({ id: "d", title: "Zoo", date: "2026-11-23" })], "2026-11-23", "2026-11-30");
  eq(list.map((o) => o.eventId), ["d", "b", "c", "a"]);
});
test("lesson days: recorded past days, timetable from today on", () => {
  const records = { days: { "2026-11-20": { lessons: 6, note: "" }, "2026-11-21": { lessons: 0, note: "" }, "2026-11-23": { lessons: 1, note: "" } },
    settings: { timetable: [6, 0, 0, 4, 0, 0, 0], trackingSince: "2026-11-01" } };
  eq(lessonItems(records, "2026-11-20", "2026-11-30", "2026-11-23").map((i) => [i.date, i.title]),
    [["2026-11-20", "6 lessons"], ["2026-11-23", "1 lesson"], ["2026-11-26", "Lessons — usually 4"], ["2026-11-30", "Lessons — usually 6"]]);
  eq(lessonItems({ days: {}, settings: null }, "2026-11-23", "2026-11-30", "2026-11-23"), []);
});
test("lesson days: not before trackingSince, and the link", () => {
  const records = { days: {}, settings: { timetable: [6, 0, 0, 0, 0, 0, 0], trackingSince: "2026-11-30" } };
  eq(lessonItems(records, "2026-11-23", "2026-11-30", "2026-11-23").map((i) => i.date), ["2026-11-30"]);
  const one = lessonItems(records, "2026-11-30", "2026-11-30", "2026-11-23")[0];
  eq([one.kind, one.time, one.link], ["lessons", null, "#/lessons"]);
});
