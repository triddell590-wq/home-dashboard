// The wording for the online Trading tabs. Pure functions, tested in Node. The helpers up to matchStocks are
// copied unchanged from the Mac's views (day.js, trading-cards.js, research.js); the ones after are new.
import { countdown, londonDay } from "../core/dom.js";
import { isTradingDay, nyDay, nyToUtc } from "./market.js";

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Every time and date in Trading's wording is Europe/London, whatever the device's zone.
const LONDON_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
const LONDON_WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function localTime(iso) { return LONDON_CLOCK.format(new Date(iso)); }

function londonParts(iso) {
  const p = Object.fromEntries(LONDON_WEEKDAY.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, day: Number(p.day), month: p.month };
}

/** "today", "tomorrow", a weekday name within the week, else "Fri 14 Nov"; by the London calendar. */
export function relativeDay(iso, now = new Date()) {
  const day = (x) => new Date(`${londonDay(x)}T12:00:00Z`);
  const days = Math.round((day(iso) - day(now)) / 86400e3);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  const p = londonParts(iso);
  if (days > 1 && days < 7) return FULL_DAYS[day(iso).getUTCDay()];
  return `${p.weekday} ${p.day} ${p.month}`;
}

const FULL_SESSION_MS = 6.5 * 3600e3;

function isEarly(openIso, closeIso) {
  return Boolean(openIso && closeIso) && new Date(closeIso) - new Date(openIso) < FULL_SESSION_MS - 60e3;
}

function opensNext(market, now) {
  const when = `opens ${relativeDay(market.next_open_at, now)} ${localTime(market.next_open_at)}`;
  return isEarly(market.next_open_at, market.next_close_at)
    ? `${when}, closes early at ${localTime(market.next_close_at)}` : when;
}

export function marketPhrase(market, now = new Date()) {
  if (!market) return null;
  switch (market.state) {
    case "pre":
      return `Market opens at ${localTime(market.opens_at)} (in ${countdown(new Date(market.opens_at) - now)})`;
    case "open":
      return isEarly(market.opens_at, market.closes_at)
        ? `Market open · closes early at ${localTime(market.closes_at)}`
        : `Market open · closes at ${localTime(market.closes_at)}`;
    case "after":
      return `Market closed · ${opensNext(market, now)}`;
    case "closed":
      return market.reason === "holiday"
        ? `Closed for ${market.holiday_name} · ${opensNext(market, now)}`
        : `Closed for the weekend · ${opensNext(market, now)}`;
    default:
      return null;
  }
}

export function picksPhrase(picks, market, now = new Date()) {
  if (!picks) return null;
  if (picks.count === null || picks.count === undefined) {
    if (market && market.state === "closed") return null;
    if (picks.expected_after && now < new Date(picks.expected_after)) {
      return `The model prepares today's picks after ${localTime(picks.expected_after)}`;
    }
    return "Today's picks aren't ready yet";
  }
  if (picks.status === "market closed") return null;
  if (picks.status === "prices stale") return "No picks today: prices weren't up to date";
  if (picks.status === "no picks" || picks.count === 0) return "The model sits out today";
  if (picks.late) return "Late picks: published after the open";
  return `${picks.count} ${picks.count === 1 ? "pick" : "picks"} ready for today`;
}

export function growthSeries(forward) {
  const model = [];
  const spy = [];
  let m = 100000;
  let s = 100000;
  for (const d of forward.days || []) {
    m *= 1 + Number(d.pick_return || 0);
    s *= 1 + Number(d.spy_return || 0);
    model.push({ time: d.day, value: m });
    spy.push({ time: d.day, value: s });
  }
  return { model, spy };
}

export function excessVsSpy(forward) {
  const days = (forward.days || []).length;
  if (!days) return { excess: null, days: 0 };
  const { model, spy } = growthSeries(forward);
  return { excess: (model.at(-1).value - spy.at(-1).value) / 100000, days };
}

/** "Top 1% · #3 of 571": where a stock ranks today, instead of a score that looks like confidence. */
export function rankText(p) {
  if (!p || p.rank == null || !p.of) return "";
  return `Top ${p.top_pct ?? Math.ceil((p.rank / p.of) * 100)}% · #${p.rank} of ${p.of}`;
}

/** How long a pick is held, from the morning's payload. */
export function holdText(payload) {
  const hold = Number((payload && payload.hold) || 1);
  if (hold <= 1 || !payload.sell_on) return "sold at the next open";
  const d = new Date(`${payload.sell_on}T12:00:00`);
  return `held ${hold} trading days, sold at the open on ${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const OUTLOOK_SENTENCES = {
  "Stronger than usual": "Today's picks stand out from the other stocks more than usual",
  "Weaker than usual": "Today's picks stand out from the other stocks less than usual",
  "About usual": "Today's picks stand out from the other stocks about as much as usual",
  "Learning what's usual": "The model is still learning what a usual day looks like (it needs ten mornings)",
  "Sitting out": "No stock cleared the model's confidence level, so it stays in cash today",
};

/** The outlook in words. It never calls the market's direction: the model ranks stocks against each other. */
export function outlookText(o) {
  const base = OUTLOOK_SENTENCES[o.label] || "";
  const vix = o.vix == null || !isFinite(o.vix) ? "" : `market fear (VIX) ${Number(o.vix).toFixed(0)}`;
  return { label: o.label, sentence: [base, vix].filter(Boolean).join(" · ") };
}

/** The trader's chart check on a pick, in words ("" when the trader is off). */
export function chartText(pick) {
  const p = pick && pick.p_up;
  if (p == null || !isFinite(p)) return "";
  return `Chart check: ${Math.round(Number(p) * 100)}% chance it rises more than costs over the hold`;
}

/** Why the chart turned a shortlisted stock down: its warnings, joined in one sentence. */
export function skippedText(s) {
  const reasons = ((s && s.reasons) || []).map((r) => r.charAt(0).toLowerCase() + r.slice(1));
  return reasons.length ? `Skipped by the chart: ${reasons.join("; ")}` : "Skipped by the chart";
}

const CAUSE_WORDS = { shock: "shocks", research: "research misses", chart: "chart misses", unforeseeable: "unforeseeable" };

/** "Losses: 40% shocks, 25% research misses, …" from each loss cause's share. */
export function causeSplitText(split) {
  const parts = Object.keys(CAUSE_WORDS).filter((c) => split && split[c] != null)
    .map((c) => `${Math.round(split[c] * 100)}% ${CAUSE_WORDS[c]}`);
  return parts.length ? `Losses: ${parts.join(", ")}` : "";
}

const CHANGE_WORDS = {
  skip: () => "skip the stock",
  half: () => "buy half as much",
  entry: (c) => `the trader needs a ${Math.round((c.add || 0) * 100)}-point higher chart check`,
};

/** A lesson in one sentence: its condition, the change it makes, and where it stands. */
export function lessonText(l) {
  const change = (CHANGE_WORDS[l.change && l.change.kind] || (() => "change nothing"))(l.change || {});
  const w = l.judged && l.judged.with, wo = l.judged && l.judged.without;
  const scored = w && wo && isFinite(w.score) && isFinite(wo.score)
    ? ` · test year score ${Number(w.score).toFixed(2)} vs ${Number(wo.score).toFixed(2)} without` : "";
  return `When ${l.description}: ${change} (${l.status}${scored})`;
}

/** Suggestions for a search box: ticker prefixes first, then name prefixes, then names containing the text. */
export function matchStocks(list, query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const rank = (s) => {
    const t = s.ticker.toLowerCase();
    const n = (s.name || "").toLowerCase();
    if (t.startsWith(q)) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };
  return list.map((s) => [rank(s), s]).filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || a[1].ticker.localeCompare(b[1].ticker)).slice(0, limit).map(([, s]) => s);
}

// ------------------------------------------------------------------ new for the online dashboard

const STALE_RUN_MS = 2 * 3600e3;
const LAST_ARRIVAL = "09:30";

/** What /api/day's "picks" part gave, from trading/today: empty unless the picks are today's (New York day). */
export function picksSummary(today, now = new Date()) {
  const day = nyDay(now);
  const expected_after = nyToUtc(day, "06:00").toISOString();
  if (!today || today.day !== day) return { day: null, count: null, status: null, late: null, expected_after };
  return { day, count: ((today.payload && today.payload.picks) || []).length, status: today.status, late: Boolean(today.late), expected_after };
}

function previousTradingDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (!isTradingDay(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

/** A "YYYY-MM-DD" calendar day as "3 Nov 2026" (the day itself, so no time zone shifts it). */
export function dateText(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function shortDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The amber line when the morning run failed or no picks have arrived; null when all is well. */
export function runNotice(status, today, now = new Date()) {
  const day = nyDay(now);
  const lastDay = today && today.day ? today.day : null;
  if (lastDay === day) return null;
  const dated = lastDay ? `the picks from ${shortDate(lastDay)}` : null;
  const run = status && status.runs && status.runs.morning;
  if (run && run.day === day) {
    const stale = run.state === "running" && now - new Date(run.started) > STALE_RUN_MS;
    if (run.state === "failed" || stale) {
      const line = `This morning's run failed at ${localTime(run.finished || run.started)}`;
      if (!lastDay) return line;
      return `${line} — showing ${lastDay === previousTradingDay(day) ? "yesterday's picks" : dated}`;
    }
  }
  if (isTradingDay(day) && now >= nyToUtc(day, LAST_ARRIVAL)) {
    return dated ? `No picks yet today — showing ${dated}` : "No picks yet today";
  }
  return null;
}

/** Where a published figure came from: today's run by name, anything older by its date and time. */
export function madeText(madeAt, kind, now = new Date()) {
  if (!madeAt) return "";
  const when = relativeDay(madeAt, now);
  if (when === "today" && (kind === "morning" || kind === "evening")) return `As of this ${kind}'s run`;
  return `As of ${when} ${localTime(madeAt)}`;
}

/** The GitHub-minutes warning from 85% of the monthly limit; null before that. */
export function minutesText(minutes) {
  if (!minutes || !minutes.limit || minutes.used < 0.85 * minutes.limit) return null;
  const n = (x) => Number(x).toLocaleString("en-GB");
  return `GitHub minutes: ${n(minutes.used)} of ${n(minutes.limit)} used this month — retries are off until the 1st`;
}
