// Weather wording and small helpers. Pure: no `document`, so Node tests cover them.
// Hourly and daily times from the server are London local strings with no offset ("2026-11-22T18:00",
// "2026-11-22"); they are read as given, never passed through Date-as-UTC.
import { DAY_NAMES, SHORT_DAYS, localTime } from "../core/dom.js";

// Met Office warning regions. Keep identical to REGIONS in mltrader/weather.py.
export const REGIONS = {
  os: "Orkney and Shetland", he: "Highlands and Eilean Siar", gr: "Grampian",
  st: "Strathclyde", ta: "Central, Tayside and Fife", dg: "SW Scotland, Lothian Borders",
  ni: "Northern Ireland", wl: "Wales", nw: "North West England",
  ne: "North East England", yh: "Yorkshire and Humber", wm: "West Midlands",
  em: "East Midlands", ee: "East of England", sw: "South West England",
  se: "London and South East England",
};

/** "2026-11-24" or "2026-11-24T18:00" -> "Tuesday" (the calendar day as written). */
export function dayIndex(text) {
  const [y, m, d] = String(text).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const dayName = (text) => DAY_NAMES[dayIndex(text)];
export const shortDayName = (text) => SHORT_DAYS[dayIndex(text)];

/** Only https links are shown; anything else (javascript:, data:, garbage, null) gives null. */
export function safeLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "2026-11-22T18:00" -> "18:00". */
export function clock(text) {
  return String(text).slice(11, 16);
}

/** Wording for the dry spell. "Today" is the first forecast day, which is a London date from the server. */
export function spellText(summary) {
  if (summary && summary.days && summary.days.length === 0) return "No forecast available";
  const today = summary && summary.days && summary.days[0] ? summary.days[0].date : "";
  const spell = ((summary && summary.dry_spells) || []).find((s) => s.end >= today);
  if (spell && spell.start <= today) {
    return spell.length > 1 ? `Dry until ${dayName(spell.end)} — ${spell.length} days` : "Dry today only";
  }
  if (spell && spell.length > 1) return `Dry from ${dayName(spell.start)} to ${dayName(spell.end)} — ${spell.length} days`;
  const next = (summary && summary.next_dry_day) || (spell && spell.start);
  if (next) return `Next dry day: ${dayName(next)}`;
  return "No dry day in the next 16 days";
}

export function gustClass(gust) {
  if (gust == null) return "";
  if (gust >= 50) return "flagged";
  if (gust >= 40) return "gusty";
  return "";
}

/** The time a copy was fetched, with the day unless it was today: "18:40", "yesterday 18:40", "Fri 18:40". */
export function whenText(iso, now = new Date()) {
  const d = new Date(iso);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((start(new Date(now)) - start(d)) / 86400e3);
  const time = localTime(iso);
  if (days === 0) return time;
  if (days === 1) return `yesterday ${time}`;
  return `${SHORT_DAYS[d.getDay()]} ${time}`;
}

export const forecastFrom = (fetchedAt, now = new Date()) => `Forecast from ${whenText(fetchedAt, now)}`;

export function staleText(fetchedAt, refreshError, now = new Date()) {
  if (!refreshError) return null;
  return `${forecastFrom(fetchedAt, now)} — couldn't refresh (no internet?)`;
}

/** "as of yesterday 18:40" for the figures of an old copy; null when the copy is current. */
export function asOfText(data, now = new Date()) {
  return data && data.stale ? `as of ${whenText(data.fetched_at, now)}` : null;
}

/** What the Overview card says instead of figures when the copy has no days left; null when it has them. */
export function cardMessage(data, now = new Date()) {
  if (data.summary && data.summary.card) return null;
  return staleText(data.fetched_at, data.refresh_error, now) || "No forecast yet";
}

export function warningText(w) {
  const level = String(w.level || "");
  const kind = w.kind || "";
  const head = level ? `${level.charAt(0).toUpperCase()}${level.slice(1)} ${kind}`.trim()
    : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  const base = `${head} warning`;
  return w.starts && w.ends ? `${base} · ${localTime(w.starts)} to ${localTime(w.ends)}` : base;
}

export function rainText(day) {
  if (!day || day.rain_mm == null || day.rain_chance == null) return "—";
  return `${day.rain_mm} mm · ${day.rain_chance}%`;
}

// Weather icon name -> inline SVG paths (24x24, stroke, currentColor), like ICONS in main.js.
export const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partcloud: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1M2 8h1M3.8 3.8l.7.7M12.2 3.8l-.7.7"/><path d="M8 20a3.5 3.5 0 0 1-.4-7A5 5 0 0 1 17.3 12 4 4 0 0 1 17 20z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 .5 9.5z"/>',
  fog: '<path d="M6 13a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 17 4.5 4.75 4.75 0 0 1 17.5 13"/><path d="M3 17h18M5 21h14"/>',
  drizzle: '<path d="M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 5.5a4.75 4.75 0 0 1 .5 9.5z"/><path d="M8 19v1M12 19v1M16 19v1"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 4.5 4.75 4.75 0 0 1 17.5 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  snow: '<path d="M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 4.5 4.75 4.75 0 0 1 17.5 14z"/><path d="M8 18v.01M12 18v.01M16 18v.01M10 21v.01M14 21v.01"/>',
  storm: '<path d="M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 4.5 4.75 4.75 0 0 1 17.5 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
};
