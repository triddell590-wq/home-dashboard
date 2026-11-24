// The NYSE's trading days, holidays and early closes, worked out by rule. A port of the Mac's
// mltrader/engine/market_calendar.py. Pure: no DOM, no network.

const NY = "America/New_York";
const OPEN = "09:30";
const CLOSE = "16:00";
const EARLY_CLOSE = "13:00";
const DAY_MS = 86400e3;

const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const weekday = (d) => (d.getUTCDay() + 6) % 7;            // Monday = 0, as in Python

/** The nth `wd` (Monday = 0) of a month; n = -1 is the last one. */
function nthWeekday(year, month, wd, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    return addDays(first, ((wd - weekday(first) + 7) % 7) + 7 * (n - 1));
  }
  const last = addDays(new Date(Date.UTC(year, month, 1)), -1);
  return addDays(last, -((weekday(last) - wd + 7) % 7));
}

/** Easter Sunday (anonymous Gregorian algorithm). */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return new Date(Date.UTC(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1));
}

function observed(d) {
  if (weekday(d) === 5) return addDays(d, -1);
  if (weekday(d) === 6) return addDays(d, 1);
  return d;
}

const cache = new Map();

/** Map of "YYYY-MM-DD" -> name for the exchange's full-day holidays in `year`. */
export function holidays(year) {
  if (cache.has(year)) return cache.get(year);
  const out = new Map();
  const set = (d, name) => out.set(ymdOf(d), name);
  const newYear = new Date(Date.UTC(year, 0, 1));
  if (weekday(newYear) !== 5) set(observed(newYear), "New Year's Day");   // a Saturday New Year's Day is not observed on the Friday
  set(nthWeekday(year, 1, 0, 3), "Martin Luther King Jr. Day");
  set(nthWeekday(year, 2, 0, 3), "Presidents' Day");
  set(addDays(easter(year), -2), "Good Friday");
  set(nthWeekday(year, 5, 0, -1), "Memorial Day");
  if (year >= 2022) set(observed(new Date(Date.UTC(year, 5, 19))), "Juneteenth");
  set(observed(new Date(Date.UTC(year, 6, 4))), "Independence Day");
  set(nthWeekday(year, 9, 0, 1), "Labor Day");
  set(nthWeekday(year, 11, 3, 4), "Thanksgiving");
  set(observed(new Date(Date.UTC(year, 11, 25))), "Christmas");
  cache.set(year, out);
  return out;
}

const holidayName = (ymd) => holidays(Number(ymd.slice(0, 4))).get(ymd) || null;

export function isTradingDay(ymd) {
  return weekday(parse(ymd)) < 5 && holidayName(ymd) === null;
}

/** 13:00 closes: the day after Thanksgiving, 24 December and 3 July, on trading days. */
export function earlyClose(ymd) {
  if (!isTradingDay(ymd)) return false;
  const year = Number(ymd.slice(0, 4));
  const afterThanksgiving = ymdOf(addDays(nthWeekday(year, 11, 3, 4), 1));
  return [afterThanksgiving, `${year}-12-24`, `${year}-07-03`].includes(ymd);
}

const NY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const nyParts = (date) => Object.fromEntries(NY_PARTS.formatToParts(date).map((p) => [p.type, p.value]));

/** The New York calendar day of an instant, "YYYY-MM-DD". */
export function nyDay(date) {
  const p = nyParts(new Date(date));
  return `${p.year}-${p.month}-${p.day}`;
}

// New York's wall-clock reading of an instant, minus the instant, both as if UTC: the zone's offset then.
function nyOffset(ms) {
  const p = nyParts(new Date(ms));
  return Date.UTC(p.year, Number(p.month) - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant (a Date) at which New York's clocks read `clock` ("HH:MM") on `ymd`: one guess, then one correction. */
export function nyToUtc(ymd, clock) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = clock.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const guess = wall - nyOffset(wall);
  return new Date(wall - nyOffset(guess));
}

const closeAt = (ymd) => nyToUtc(ymd, earlyClose(ymd) ? EARLY_CLOSE : CLOSE);

function nextTradingDay(ymd) {
  let d = addDays(parse(ymd), 1);
  while (!isTradingDay(ymdOf(d))) d = addDays(d, 1);
  return ymdOf(d);
}

const iso = (d) => (d === null ? null : d.toISOString());

/** Where the market stands at `now`. Times are ISO strings in UTC; the page shows them in local time. */
export function marketStatus(now) {
  const t = new Date(now).getTime();
  const today = nyDay(new Date(t));
  let state, nextDay, reason = null, name = null, opens = null, closes = null;
  if (isTradingDay(today)) {
    opens = nyToUtc(today, OPEN);
    closes = closeAt(today);
    nextDay = nextTradingDay(today);
    if (t < opens.getTime()) { state = "pre"; nextDay = today; }
    else if (t < closes.getTime()) state = "open";
    else state = "after";
  } else {
    state = "closed";
    nextDay = nextTradingDay(today);
    name = holidayName(today);
    reason = name ? "holiday" : "weekend";
  }
  return { state, reason, holiday_name: name, opens_at: iso(opens), closes_at: iso(closes),
    next_open_at: iso(nyToUtc(nextDay, OPEN)), next_close_at: iso(closeAt(nextDay)) };
}
