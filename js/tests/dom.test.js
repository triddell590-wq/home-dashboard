import { countdown, greeting, localTime, money, pct, relativeDay } from "../core/dom.js";
import { eq, test } from "./harness.js";

test("money formats dollars with signs", () => {
  eq(money(104382.17), "$104,382.17");
  eq(money(1204.55, { sign: true }), "+$1,204.55");
  eq(money(-41, { sign: true }), "−$41.00");
  eq(money(-41), "−$41.00");
  eq(money(0, { sign: true }), "$0.00");
});

test("pct formats percentages", () => {
  eq(pct(0.0438), "+4.38%");
  eq(pct(-0.012), "−1.20%");
  eq(pct(0), "0.00%");
  eq(pct(0.5, { sign: false, digits: 0 }), "50%");
});

test("countdown reads like speech", () => {
  eq(countdown(2 * 3600e3 + 14 * 60e3), "2h 14m");
  eq(countdown(14 * 60e3 + 30e3), "14m");
  eq(countdown(30e3), "less than a minute");
  eq(countdown(-5e3), "less than a minute");
});

test("greeting by the hour", () => {
  eq(greeting(new Date(2026, 10, 13, 4, 59)), "Good evening");
  eq(greeting(new Date(2026, 10, 13, 5, 0)), "Good morning");
  eq(greeting(new Date(2026, 10, 13, 12, 0)), "Good afternoon");
  eq(greeting(new Date(2026, 10, 13, 18, 0)), "Good evening");
});

test("local time is 24-hour", () => {
  eq(localTime(new Date(2026, 10, 13, 14, 30).toISOString()), "14:30");
  eq(localTime(new Date(2026, 10, 13, 9, 5).toISOString()), "09:05");
});

test("relative days cross midnight and weekends", () => {
  const fri = new Date(2026, 10, 13, 22, 0);
  eq(relativeDay(new Date(2026, 10, 13, 23, 0).toISOString(), fri), "today");
  eq(relativeDay(new Date(2026, 10, 16, 14, 30).toISOString(), fri), "Monday");
  eq(relativeDay(new Date(2026, 10, 14, 0, 30).toISOString(), new Date(2026, 10, 13, 23, 50)), "tomorrow");
  eq(relativeDay(new Date(2026, 10, 23, 14, 30).toISOString(), fri), "Mon 23 Nov");
});
