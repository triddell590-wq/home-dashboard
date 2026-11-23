import { test, eq } from "./harness.js";
import { buildDigest, digestBody, digestPayload, MAX_LINES } from "../calendar/digest.js";

const T = "2026-11-23";
const ev = (over) => ({ id: "e1", title: "X", kind: "job", date: T, time: null, repeat: null, until: null, skipped: [], done: [], note: "", ...over });
const LESSONS = { days: {}, settings: { timetable: [6, 0, 0, 0, 0, 0, 0], trackingSince: "2026-11-01" } };
const NONE = { title: null, lines: [], count: 0, items: [] };
const NO_LESSONS = { days: {}, settings: null };

test("an empty day sends nothing, and lesson days never trigger", () => {
  eq(buildDigest({ events: [], records: LESSONS, today: T }), NONE);
});
test("today's items, with lessons listed when something is on", () => {
  eq(buildDigest({ events: [ev({ id: "a", title: "Dentist", date: T, time: "14:00", kind: "appointment" }), ev({ id: "b", title: "Bins out", date: T })], records: LESSONS, today: T }),
    { title: "Today", lines: ["Bins out", "Dentist 2pm", "Lessons — usually 6"], count: 2, items: ["Bins out", "Dentist 2pm", "Lessons — usually 6"] });
});
test("deadlines: on the day, three days ahead, done ones dropped", () => {
  const dl = (title, date, done = []) => ev({ id: title, title, kind: "deadline", date, done });
  const r = buildDigest({ events: [dl("Car tax", T), dl("Council tax", "2026-11-26"), dl("Rates", "2026-11-25"), dl("Paid", T, [T])], records: NO_LESSONS, today: T });
  eq([r.title, r.lines, r.count], ["Today and coming up", ["Due today: Car tax", "Due Thu: Council tax"], 2]);
});
test("an overdue deadline is mentioned once, on its first day overdue", () => {
  const dl = (date) => ev({ title: "Car tax", kind: "deadline", date });
  eq(buildDigest({ events: [dl("2026-11-22")], records: NO_LESSONS, today: T }).lines, ["Overdue: Car tax"]);
  eq(buildDigest({ events: [dl("2026-11-21")], records: NO_LESSONS, today: T }), NONE);
});
test("a deadline three days away is enough on its own to send", () => {
  const r = buildDigest({ events: [ev({ title: "Council tax", kind: "deadline", date: "2026-11-26" })], records: LESSONS, today: T });
  eq([r.title, r.lines, r.count], ["Today and coming up", ["Lessons — usually 6", "Due Thu: Council tax"], 1]);
});
test("lines run overdue, due today, today's items, lessons, then due in three days", () => {
  const dl = (title, date) => ev({ id: title, title, kind: "deadline", date });
  const r = buildDigest({ events: [dl("Rates", "2026-11-26"), ev({ id: "j", title: "Bins" }), dl("Tax", T), dl("MOT", "2026-11-22")], records: LESSONS, today: T });
  eq(r.items, ["Overdue: MOT", "Due today: Tax", "Bins", "Lessons — usually 6"]);
  eq(r.lines, ["Overdue: MOT", "Due today: Tax", "Bins", "Lessons — usually 6", "+1 more"]);
  eq([r.title, r.count], ["Today and coming up", 4]);
});
test("at most 4 lines, then +N more", () => {
  const six = ["A", "B", "C", "D", "E", "F"].map((t) => ev({ id: t, title: t, date: T }));
  const r = buildDigest({ events: six, records: NO_LESSONS, today: T });
  eq([r.lines, r.count, digestBody(r.lines), MAX_LINES], [["A", "B", "C", "D", "+2 more"], 6, "A\nB\nC\nD\n+2 more", 4]);
});
test("digestPayload is plain strings for a data-only push", () => {
  eq(digestPayload({ title: "Today", lines: ["A", "+2 more"] }), { title: "Today", body: "A\n+2 more", url: "#/calendar" });
});
