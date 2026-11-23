import { test, eq } from "./harness.js";
import { parse } from "../calendar/parse.js";
import {
  formatTime, shortDate, dayHeading, lowerFirst, repeatWords, summaryLine, overdueText, dayPhrase, monthCells, comingUp,
} from "../calendar/text.js";
import { occurrences } from "../calendar/occurrences.js";

const T = "2026-11-23";
const ev = (over) => ({ id: "e1", title: "X", kind: "job", date: T, time: null, repeat: null, until: null, skipped: [], done: [], note: "", ...over });
const phrase = (events) => dayPhrase(occurrences(events, "2026-11-01", T), T);

test("formatTime", () => eq(["14:00", "14:30", "12:00", "00:00", "09:05", null].map(formatTime), ["2pm", "2.30pm", "12pm", "12am", "9.05am", ""]));
test("shortDate", () => eq(shortDate("2026-11-25"), "Wed 25 Nov"));
test("dayHeading", () => eq(["2026-11-23", "2026-11-24", "2026-11-26"].map((d) => dayHeading(d, T)), ["Today", "Tomorrow", "Thu 26 Nov"]));
test("lowerFirst keeps acronyms", () => eq(["Car tax", "MOT", "A", "Bins out"].map(lowerFirst), ["car tax", "MOT", "a", "bins out"]));
test("repeatWords for every rule", () => {
  eq(repeatWords({ unit: "week", every: 2, monthly: null }, "2026-11-24"), "every other Tuesday");
  eq(repeatWords({ unit: "week", every: 1, monthly: null }, "2026-11-24"), "every Tuesday");
  eq(repeatWords({ unit: "week", every: 3, monthly: null }, "2026-11-23"), "every 3 weeks on Monday");
  eq(repeatWords({ unit: "day", every: 1, monthly: null }, T), "every day");
  eq(repeatWords({ unit: "day", every: 2, monthly: null }, T), "every 2 days");
  eq(repeatWords({ unit: "month", every: 1, monthly: "date" }, "2026-12-01"), "every month on the 1st");
  eq(repeatWords({ unit: "month", every: 1, monthly: "weekday", nth: -1 }, "2026-11-27"), "the last Friday of every month");
  eq(repeatWords({ unit: "month", every: 1, monthly: "weekday", nth: 2 }, "2026-12-14"), "the second Monday of every month");
  eq(repeatWords({ unit: "year", every: 1, monthly: null }, "2027-03-14"), "every year on 14 Mar");
});
test("summaryLine says what was understood", () => {
  eq(summaryLine(parse("bins every other tuesday", T), T), "Bins — every other Tuesday, from Tue 24 Nov");
  eq(summaryLine(parse("dentist tuesday 2pm", T), T), "Dentist — Tue 24 Nov, 2pm");
  eq(summaryLine(parse("car tax due 28 nov", T), T), "Car tax — due Sat 28 Nov");
  eq(summaryLine(parse("swimming every tuesday until 30 june", T), T), "Swimming — every Tuesday, from Tue 24 Nov, until Wed 30 Jun");
  eq(summaryLine(parse("buy milk", T), T), "Buy milk — pick a date");
});
test("overdueText", () => { eq(overdueText("Car tax", "2026-11-21", T), "Overdue: car tax — 2 days"); eq(overdueText("MOT", "2026-11-22", T), "Overdue: MOT — 1 day"); });
test("dayPhrase, first match wins", () => {
  const tax = (over) => ev({ id: "t", title: "Car tax", kind: "deadline", ...over });
  const dentist = ev({ id: "d", title: "Dentist", kind: "appointment", time: "14:00" });
  eq(phrase([tax({ date: "2026-11-21" }), dentist]), "car tax overdue");
  eq(phrase([dentist, tax()]), "dentist at 2pm");
  eq(phrase([tax()]), "car tax due today");
  eq(phrase(["a", "b", "c"].map((id) => ev({ id, title: id }))), "3 things today");
  eq(phrase([ev({ title: "Bins" })]), "1 thing today");
  eq(phrase([]), null);
  eq(phrase([tax({ date: "2026-11-21", done: ["2026-11-21"] })]), null);
});
test("monthCells is Monday-first", () => {
  const c = monthCells("2026-11");
  eq(c.length, 6); eq(c[0], [null, null, null, null, null, null, "2026-11-01"]); eq([c[5][0], c[5][1]], ["2026-11-30", null]);
});
test("comingUp keeps every overdue deadline at the top and groups the rest by day", () => {
  const events = [
    ev({ id: "a", title: "Car tax", kind: "deadline", date: "2026-11-21" }),
    ev({ id: "b", title: "Old", kind: "deadline", date: "2026-11-10", done: ["2026-11-10"] }),
    ev({ id: "c", title: "Dentist", kind: "appointment", date: "2026-11-24", time: "14:00" }),
  ];
  const r = comingUp(events, { days: {}, settings: { timetable: [6, 0, 0, 0, 0, 0, 0], trackingSince: "2026-11-01" } }, T);
  eq(r.overdue.map((o) => o.text), ["Overdue: car tax — 2 days"]);
  eq(r.groups[0].heading, "Today"); eq(r.groups[0].items.map((i) => i.title), ["Lessons — usually 6"]);
  eq(r.groups[1].heading, "Tomorrow"); eq(r.groups[1].items.map((i) => i.title), ["Dentist"]);
});
test("comingUp looks back a year for overdue and ahead 60 days", () => {
  const r = comingUp([ev({ title: "Old", kind: "deadline", date: "2025-11-24" }), ev({ id: "z", title: "Far", date: "2027-01-22" }), ev({ id: "y", title: "Too far", date: "2027-01-23" })], null, T);
  eq(r.overdue.length, 1);
  eq(r.groups.map((g) => g.items[0].title), ["Far"]);
});
