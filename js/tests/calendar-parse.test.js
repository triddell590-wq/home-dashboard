// The plain-words parser. T is a Monday; every case uses fixed dates, never the real clock.
import { test, eq } from "./harness.js";
import { parse, daysInMonth, nthWeekdayOf, MONTH_NAMES, WEEKDAY_NAMES } from "../calendar/parse.js";

const T = "2026-11-23";
const R = (unit, every, monthly = null, nth) => (nth === undefined ? { unit, every, monthly } : { unit, every, monthly, nth });
const none = { title: "", kind: "appointment", date: null, time: null, repeat: null, until: null, unsure: [] };

test("single dates", () => {
  const cases = [
    ["dentist today", "2026-11-23"], ["dentist tomorrow", "2026-11-24"],
    ["dentist tuesday", "2026-11-24"], ["dentist monday", "2026-11-30"],          // today excluded
    ["dentist next tuesday", "2026-12-01"], ["dentist next friday", "2026-12-04"], ["dentist next monday", "2026-11-30"],
    ["dentist 25 nov", "2026-11-25"], ["dentist 25th november", "2026-11-25"], ["dentist november 25", "2026-11-25"],
    ["dentist 20 nov", "2027-11-20"], ["dentist 25/11", "2026-11-25"], ["dentist 25/11/2027", "2027-11-25"],
    ["dentist 3/1", "2027-01-03"], ["dentist the 30th", "2026-11-30"], ["dentist the 20th", "2026-12-20"],
    ["dentist the 31st", "2026-12-31"], ["dentist in 3 days", "2026-11-26"], ["dentist in 2 weeks", "2026-12-07"],
    // extra forms from the grammar table
    ["dentist 23 nov", "2026-11-23"], ["dentist 25/11/27", "2027-11-25"], ["dentist nov 25th", "2026-11-25"],
    ["dentist on friday", "2026-11-27"], ["dentist from 1 dec", "2026-12-01"], ["dentist in 1 day", "2026-11-24"],
    ["dentist in 1 week", "2026-11-30"], ["dentist wed", "2026-11-25"], ["dentist thurs", "2026-11-26"],
    ["dentist sept 9", "2027-09-09"], ["dentist 9 sept 2028", "2028-09-09"], ["dentist 29 feb 2028", "2028-02-29"],
    ["dentist 29 feb", "2028-02-29"], ["dentist the 23rd", "2026-11-23"], ["dentist the 22nd", "2026-12-22"],
  ];
  for (const [text, date] of cases) eq([text, parse(text, T).date, parse(text, T).title], [text, date, "Dentist"]);
});
test("dates across month and year ends", () => {
  eq(parse("x in 3 days", "2026-12-30").date, "2027-01-02");
  eq(parse("x tomorrow", "2026-12-31").date, "2027-01-01");
  eq(parse("x next tuesday", "2026-11-25").date, "2026-12-01");   // this week's has passed: same as the coming one
  eq(parse("x the 1st", "2026-12-31").date, "2027-01-01");
  eq(parse("x the 31st", "2026-11-23").date, "2026-12-31");
  eq(parse("x the 31st", "2026-12-31").date, "2026-12-31");
  eq(parse("x the 30th", "2027-01-31").date, "2027-03-30");       // February has no 30th
  eq(parse("x 1 jan", "2026-12-31").date, "2027-01-01");
  eq(parse("x in 1 week", "2026-12-28").date, "2027-01-04");
  eq(parse("x monday", "2026-12-28").date, "2027-01-04");
  eq(parse("x 5 jan", "2026-01-05").date, "2026-01-05");           // today counts as not passed
});
test("only the first date counts; later dates stay in the title", () => {
  const p = parse("trip friday 5 dec", T);
  eq([p.date, p.title], ["2026-11-27", "Trip 5 dec"]);
});
test("times", () => {
  for (const [text, time] of [["a 2pm", "14:00"], ["a 2.30pm", "14:30"], ["a 2:30 pm", "14:30"], ["a 14:00", "14:00"], ["a at 9", "09:00"],
    ["a at 9.15", "09:15"], ["a noon", "12:00"], ["a midday", "12:00"], ["a 12am", "00:00"], ["a 12pm", "12:00"], ["a 9am", "09:00"],
    ["a at 9am", "09:00"], ["a at 2.30 pm", "14:30"], ["a at 0", "00:00"], ["a at 23", "23:00"], ["a at 23:30", "23:30"],
    ["a 00:05", "00:05"], ["a 23:59", "23:59"], ["a 9:05", "09:05"], ["a 12:30am", "00:30"], ["a 12:30pm", "12:30"], ["a at 12pm", "12:00"]])
    eq([text, parse(text, T).time, parse(text, T).title], [text, time, "A"]);
});
test("date and time together", () => {
  eq(parse("dentist tuesday 2pm", T), { ...none, title: "Dentist", date: "2026-11-24", time: "14:00" });
  eq(parse("dentist 2pm 25 nov", T), { ...none, title: "Dentist", date: "2026-11-25", time: "14:00" });
  eq(parse("dentist 25/11 at 9.30", T), { ...none, title: "Dentist", date: "2026-11-25", time: "09:30" });
  eq(parse("dentist on 25 november at 14:15", T), { ...none, title: "Dentist", date: "2026-11-25", time: "14:15" });
});
test("repeats", () => {
  const cases = [
    ["bins every other tuesday", "Bins", "2026-11-24", R("week", 2)],
    ["walk every day", "Walk", "2026-11-23", R("day", 1)],
    ["gym every tuesday", "Gym", "2026-11-24", R("week", 1)],
    ["filter every 3 weeks", "Filter", "2026-11-23", R("week", 3)],
    ["meter every month", "Meter", "2026-11-23", R("month", 1, "date")],
    ["rent every month on the 1st", "Rent", "2026-12-01", R("month", 1, "date")],
    ["pay rent on the 1st of every month", "Pay rent", "2026-12-01", R("month", 1, "date")],
    ["quiz the last friday of every month", "Quiz", "2026-11-27", R("month", 1, "weekday", -1)],
    ["club every second monday", "Club", "2026-12-14", R("month", 1, "weekday", 2)],
    ["boiler every year", "Boiler", "2026-11-23", R("year", 1)], ["boiler yearly", "Boiler", "2026-11-23", R("year", 1)],
    ["bins weekly", "Bins", "2026-11-23", R("week", 1)], ["bins fortnightly", "Bins", "2026-11-23", R("week", 2)],
    ["rent monthly", "Rent", "2026-11-23", R("month", 1, "date")],
    ["mum birthday every 14 march", "Mum birthday", "2027-03-14", R("year", 1)],
    ["swimming every tuesday from 1 dec", "Swimming", "2026-12-01", R("week", 1)],
    // the rest of the table
    ["walk daily", "Walk", "2026-11-23", R("day", 1)],
    ["boiler annually", "Boiler", "2026-11-23", R("year", 1)],
    ["walk every other day", "Walk", "2026-11-23", R("day", 2)],
    ["meter every other week", "Meter", "2026-11-23", R("week", 2)],
    ["meter every other month", "Meter", "2026-11-23", R("month", 2, "date")],
    ["boiler every other year", "Boiler", "2026-11-23", R("year", 2)],
    ["filter every 52 weeks", "Filter", "2026-11-23", R("week", 52)],
    ["filter every 1 day", "Filter", "2026-11-23", R("day", 1)],
    ["filter every 6 months", "Filter", "2026-11-23", R("month", 6, "date")],
    ["filter every 2 years", "Filter", "2026-11-23", R("year", 2)],
    ["filter every 10 days", "Filter", "2026-11-23", R("day", 10)],
    ["gym every monday", "Gym", "2026-11-30", R("week", 1)],                       // today excluded
    ["gym every other monday", "Gym", "2026-11-30", R("week", 2)],
    ["gym every thurs", "Gym", "2026-11-26", R("week", 1)],
    ["club every first friday", "Club", "2026-12-04", R("month", 1, "weekday", 1)],
    ["club every 1st friday of the month", "Club", "2026-12-04", R("month", 1, "weekday", 1)],
    ["club every last friday", "Club", "2026-11-27", R("month", 1, "weekday", -1)],
    ["club every third tuesday", "Club", "2026-12-15", R("month", 1, "weekday", 3)],
    ["club every 4th monday", "Club", "2026-11-23", R("month", 1, "weekday", 4)],
    ["club on the second tuesday of every month", "Club", "2026-12-08", R("month", 1, "weekday", 2)],
    ["club the 2nd monday of every month", "Club", "2026-12-14", R("month", 1, "weekday", 2)],
    ["club every 4th monday of the month", "Club", "2026-11-23", R("month", 1, "weekday", 4)],
    ["rent every month on the 30th", "Rent", "2026-11-30", R("month", 1, "date")],
    ["rent every month on the 23rd", "Rent", "2026-11-23", R("month", 1, "date")],
    ["rent every month on the 22nd", "Rent", "2026-12-22", R("month", 1, "date")],
    ["rent on the 15th of every month", "Rent", "2026-12-15", R("month", 1, "date")],
    ["rent every month on the 31st", "Rent", "2026-12-31", R("month", 1, "date")],
    ["mum birthday every march 14", "Mum birthday", "2027-03-14", R("year", 1)],
    ["mum birthday every 14th of march", "Mum birthday", "2027-03-14", R("year", 1)],
    ["mum birthday every 25 nov", "Mum birthday", "2026-11-25", R("year", 1)],
    ["mum birthday every 23 nov", "Mum birthday", "2026-11-23", R("year", 1)],
    ["mum birthday every 22 nov", "Mum birthday", "2027-11-22", R("year", 1)],
    ["leap day every 29 feb", "Leap day", "2028-02-29", R("year", 1)],
  ];
  for (const [text, title, date, repeat] of cases) {
    const p = parse(text, T);
    eq([text, p.title, p.kind, p.date, p.repeat], [text, title, "job", date, repeat]);
  }
  eq(parse("swimming every tuesday until 30 june", T).until, "2027-06-30");
  eq(parse("prune every spring", T), { title: "Prune", kind: "job", date: "2027-03-01", time: null, repeat: R("year", 1), until: null, unsure: ["date"] });
  eq(parse("grit every winter", T).date, "2026-12-01");
  eq([parse("x every summer", T).date, parse("x every summer", T).unsure], ["2027-06-01", ["date"]]);
  eq([parse("x every autumn", T).date, parse("x every autumn", T).unsure], ["2027-09-01", ["date"]]);
  eq([parse("x every spring", "2027-03-01").date], ["2027-03-01"]);
});
test("repeats across month and year ends", () => {
  eq(parse("x every month on the 1st", "2026-12-31").date, "2027-01-01");
  eq(parse("x every month on the 31st", "2027-01-31").date, "2027-01-31");
  eq(parse("x every month on the 31st", "2027-02-01").date, "2027-03-31");
  eq(parse("x every month on the 30th", "2027-01-31").date, "2027-03-30");
  eq(parse("x the last friday of every month", "2026-11-28").date, "2026-12-25");
  eq(parse("x the last friday of every month", "2026-12-31").date, "2027-01-29");
  eq(parse("x every second monday", "2026-12-31").date, "2027-01-11");
  eq(parse("x every winter", "2026-12-31").date, "2027-12-01");
  eq(parse("x every tuesday", "2026-12-29").date, "2027-01-05");
});
test("until", () => {
  const u = (text) => parse(text, T);
  eq(u("swimming every tuesday until 30 june").title, "Swimming");
  eq(u("swimming every tuesday until 30 june").date, "2026-11-24");
  eq(u("swim every day until 25 dec").until, "2026-12-25");
  eq(u("swim every day until 25/12/2027").until, "2027-12-25");
  eq(u("swim every day until december 25").until, "2026-12-25");
  eq(u("swim every day until the 30th").until, "2026-11-30");
  eq(u("swim every day until tomorrow").until, "2026-11-24");
  eq(u("swim every day until next friday").until, "2026-12-04");
  eq(u("swim every day until in 2 weeks").until, "2026-12-07");
  eq(u("swim every day until on 25 dec").until, "2026-12-25");
  eq(u("swim every tuesday from 1 dec until 20 nov").until, "2027-11-20");     // rolls on or after the start
  eq(u("swim every tuesday from 1 dec until 5 dec").until, "2026-12-05");
  eq(u("swim every tuesday from 1 dec until 1 dec").until, "2026-12-01");
  eq(u("swim every day until 25 dec at 9"), { title: "Swim", kind: "job", date: "2026-11-23", time: "09:00", repeat: R("day", 1), until: "2026-12-25", unsure: [] });
  eq(u("swim every day").until, null);
});
test("a repeat with a date: the date is the start", () => {
  const p = parse("swimming every tuesday from 8 dec", T);
  eq([p.date, p.unsure], ["2026-12-08", []]);
  eq(parse("swimming every tuesday starting 25 nov", T).unsure, ["date"]);       // 25 Nov is a Wednesday
  eq(parse("gym every tuesday on 25 nov", T), { ...none, title: "Gym", kind: "job", date: "2026-11-25", repeat: R("week", 1), unsure: ["date"] });
  eq(parse("gym every other tuesday 25 nov", T).unsure, ["date"]);
  eq(parse("gym every other wednesday 25 nov", T).unsure, []);
  eq(parse("gym every day 25 nov", T).unsure, []);                                // only weekly weekday repeats are checked
  eq(parse("rent monthly 25 nov", T).date, "2026-11-25");
  eq(parse("club every second monday from 1 dec", T).date, "2026-12-01");
  eq(parse("prune every spring from 1 apr", T).unsure, []);                       // an explicit date needs no check
});
test("deadlines", () => {
  eq(parse("car tax due 28 nov", T), { title: "Car tax", kind: "deadline", date: "2026-11-28", time: null, repeat: null, until: null, unsure: [] });
  eq([parse("tax return deadline 31 jan", T).kind, parse("tax return deadline 31 jan", T).date], ["deadline", "2027-01-31"]);
  eq([parse("council tax by friday", T).title, parse("council tax by friday", T).kind, parse("council tax by friday", T).date], ["Council tax", "deadline", "2026-11-27"]);
  eq(parse("MOT due every 14 march", T).kind, "deadline");
  eq(parse("book by tom", T), { title: "Book by tom", kind: "appointment", date: null, time: null, repeat: null, until: null, unsure: [] });
  eq(parse("car tax due on 28 nov", T), { ...none, title: "Car tax", kind: "deadline", date: "2026-11-28" });
  eq(parse("car tax due: 28 nov", T), { ...none, title: "Car tax", kind: "deadline", date: "2026-11-28" });
  eq(parse("car tax due - 28 nov", T), { ...none, title: "Car tax", kind: "deadline", date: "2026-11-28" });
  eq(parse("car tax deadline on friday", T), { ...none, title: "Car tax", kind: "deadline", date: "2026-11-27" });
  eq(parse("car tax DUE 28 NOV", T), { ...none, title: "Car tax", kind: "deadline", date: "2026-11-28" });
  eq(parse("pay by 28/11", T), { ...none, title: "Pay", kind: "deadline", date: "2026-11-28" });
  eq(parse("pay by 28 november", T).kind, "deadline");
  eq(parse("pay by tomorrow", T).kind, "deadline");
  eq(parse("pay by next tuesday", T).kind, "deadline");
  eq(parse("pay by the 30th", T), { ...none, title: "Pay", kind: "deadline", date: "2026-11-30" });
  eq(parse("pay by in 3 days", T).kind, "deadline");
  eq(parse("pay by 5 pm", T).kind, "appointment");                                // a time is not a date
  eq(parse("pay by", T), { ...none, title: "Pay" });                                 // a trailing connector is trimmed
  eq(parse("due", T), { ...none, kind: "deadline" });
  eq([parse("tax due, 28 nov", T).title, parse("tax due, 28 nov", T).kind], ["Tax", "deadline"]);
});
test("kind: deadline beats job beats appointment", () => {
  eq(parse("x every day", T).kind, "job");
  eq(parse("x due every day", T).kind, "deadline");
  eq(parse("x tuesday", T).kind, "appointment");
});
test("titles keep Tom's words and casing", () => {
  eq(parse("  call   MOT garage  on friday at 9 ", T), { title: "Call MOT garage", kind: "appointment", date: "2026-11-27", time: "09:00", repeat: null, until: null, unsure: [] });
  eq(parse("DENTIST TUESDAY 2PM", T).title, "DENTIST");
  eq(parse("buy milk", T), { title: "Buy milk", kind: "appointment", date: null, time: null, repeat: null, until: null, unsure: [] });
  eq(parse("tuesday 2pm", T).title, "");
  eq(parse("x".repeat(100) + " tuesday", T).title.length, 80);
  eq(parse("", T), none);
  eq(parse("   ", T), none);
  eq(parse("dentist at the tuesday", T).title, "Dentist");                      // connectors trimmed from the end
  eq(parse("on the tuesday dentist", T).title, "Dentist");                       // and from the start
  eq(parse("- , on dentist - ,", T).title, "Dentist");
  eq(parse("– dentist –", T).title, "Dentist");
  eq(parse("by on of the", T).title, "");
  eq(parse("iPhone repair tuesday", T).title, "IPhone repair");                  // first letter only is changed
  eq(parse("pick up the kids tuesday 3pm", T).title, "Pick up the kids");
  eq(parse("dentist tuesday, 2pm", T).title, "Dentist");
});
test("titles are cut at 80 characters after tidying", () => {
  const long = "a".repeat(79) + " b c d";
  eq(parse(long, T).title, "A" + "a".repeat(78));
  eq(parse("a".repeat(80) + "z tuesday", T).title.length, 80);
});
test("text that is not a date or time stays in the title", () => {
  eq([parse("a 31/2", T).date, parse("a 31/2", T).title], [null, "A 31/2"]);
  eq([parse("a 13pm", T).time, parse("a 13pm", T).title], [null, "A 13pm"]);
  eq([parse("a at 25", T).time, parse("a at 25", T).title], [null, "A at 25"]);
  eq([parse("a every 0 weeks", T).repeat, parse("a every 0 weeks", T).kind], [null, "appointment"]);
  eq(parse("a 30 feb", T).date, null);
  eq(parse("a 9:75", T).time, null);
  eq(parse("a 9:75", T).title, "A 9:75");
  eq(parse("a at 9:75", T).time, null);
  eq(parse("a 24:00", T).time, null);
  eq(parse("a at 24", T).time, null);
  eq(parse("a 0pm", T).time, null);
  eq(parse("a 0am", T).time, null);
  eq(parse("a 13am", T).time, null);
  eq(parse("a 2.75pm", T).time, null);
  eq(parse("a every 53 weeks", T).repeat, null);
  eq(parse("a every 0 days", T).repeat, null);
  eq(parse("a every 100 years", T).repeat, null);
  eq(parse("a 0/5", T).date, null);
  eq(parse("a 5/0", T).date, null);
  eq(parse("a 5/13", T).date, null);
  eq(parse("a 32 nov", T).date, null);
  eq(parse("a 0 nov", T).date, null);
  eq(parse("a 29 feb 2027", T).date, null);
  eq(parse("a 31 apr", T).date, null);
  eq(parse("a 31/6/2027", T).date, null);
  eq(parse("a the 32nd", T).date, null);
  eq(parse("a the 0th", T).date, null);
  eq(parse("a every 31 feb", T).repeat, null);
  eq(parse("a every month on the 32nd", T).repeat, R("month", 1, "date"));     // only the plain "every month" matches
  eq(parse("a every month on the 32nd", T).title, "A on the 32nd");
  eq(parse("a every month on the 0th", T).date, "2026-11-23");
  eq(parse("a 99/99/99", T), { ...none, title: "A 99/99/99" });
  eq(parse("a 13pm tuesday", T), { ...none, title: "A 13pm", date: "2026-11-24" });
  eq(parse("a every 0 weeks tuesday", T).repeat, null);
  eq(parse("a every 0 weeks tuesday", T).date, "2026-11-24");
  eq(parse("a until 31/2", T).until, null);
});
test("words that merely contain a month or weekday are left alone", () => {
  eq(parse("monday's meeting", T).title, "Monday's meeting");
  eq(parse("decorate the lounge", T), { ...none, title: "Decorate the lounge" });
  eq(parse("sunbathe", T), { ...none, title: "Sunbathe" });
  eq(parse("march band", T), { ...none, title: "March band" });
  eq(parse("may i come", T), { ...none, title: "May i come" });
  eq(parse("check the 5 apples", T).date, "2026-12-05");                          // "the N" is a day number by the grammar
  eq(parse("todays news", T), { ...none, title: "Todays news" });
  eq(parse("everyday objects", T), { ...none, title: "Everyday objects" });
  eq(parse("daily mail", T).repeat, R("day", 1));
});
test("name tables", () => {
  eq([WEEKDAY_NAMES.monday, WEEKDAY_NAMES.mon, WEEKDAY_NAMES.tues, WEEKDAY_NAMES.tue, WEEKDAY_NAMES.thur, WEEKDAY_NAMES.thurs, WEEKDAY_NAMES.thu, WEEKDAY_NAMES.sunday, WEEKDAY_NAMES.sun],
    [0, 0, 1, 1, 3, 3, 3, 6, 6]);
  eq([MONTH_NAMES.january, MONTH_NAMES.jan, MONTH_NAMES.sept, MONTH_NAMES.sep, MONTH_NAMES.september, MONTH_NAMES.december, MONTH_NAMES.dec, MONTH_NAMES.may],
    [1, 1, 9, 9, 9, 12, 12, 5]);
  eq(Object.keys(WEEKDAY_NAMES).length, 7 * 2 + 3);                              // full, 3-letter, tues, thur, thurs
  eq(Object.keys(MONTH_NAMES).length, 12 * 2 - 1 + 1);                           // full + 3-letter (may is both) + sept
});
test("nthWeekdayOf and daysInMonth", () => {
  eq(nthWeekdayOf(2026, 11, 4, -1), "2026-11-27"); eq(nthWeekdayOf(2027, 2, 0, 2), "2027-02-08");
  eq([daysInMonth(2027, 2), daysInMonth(2028, 2), daysInMonth(2026, 11)], [28, 29, 30]);
  eq(nthWeekdayOf(2026, 11, 0, 1), "2026-11-02");
  eq(nthWeekdayOf(2026, 11, 0, 4), "2026-11-23");
  eq(nthWeekdayOf(2026, 11, 0, 5), "2026-11-30");
  eq(nthWeekdayOf(2026, 11, 1, 5), null);                                         // only four Tuesdays in Nov 2026
  eq(nthWeekdayOf(2026, 12, 3, -1), "2026-12-31");
  eq(nthWeekdayOf(2027, 1, 6, 1), "2027-01-03");
  eq(daysInMonth(1900, 2), 28); eq(daysInMonth(2000, 2), 29); eq(daysInMonth(2026, 12), 31);
});
