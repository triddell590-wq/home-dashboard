// The forecast summary: dry days and spells, gusts, the card level and the "Your day" phrase.
// A line-for-line port of summarise() and friends in mltrader/weather.py. Pure: no `document`.
import { londonDay } from "../core/dom.js";
import { dayName } from "./text.js";

const COUNTIES = {
  ne: "Northumberland, Tyne and Wear, County Durham, Durham, Darlington, Hartlepool, Stockton-on-Tees, Middlesbrough, Redcar and Cleveland",
  nw: "Cumbria, Lancashire, Greater Manchester, Merseyside, Cheshire, Cheshire East, Cheshire West and Chester, Blackburn with Darwen, Blackpool, Warrington, Halton",
  yh: "North Yorkshire, West Yorkshire, South Yorkshire, East Riding of Yorkshire, Kingston upon Hull, York, North Lincolnshire, North East Lincolnshire",
  wm: "West Midlands, Staffordshire, Shropshire, Herefordshire, Worcestershire, Warwickshire, Stoke-on-Trent, Telford and Wrekin",
  em: "Derbyshire, Nottinghamshire, Leicestershire, Lincolnshire, Northamptonshire, Rutland, Derby, Nottingham, Leicester",
  ee: "Norfolk, Suffolk, Cambridgeshire, Essex, Hertfordshire, Bedfordshire, Peterborough, Luton, Southend-on-Sea, Thurrock",
  sw: "Cornwall, Devon, Somerset, Dorset, Wiltshire, Gloucestershire, Bristol, Plymouth, Torbay, Swindon, Bath and North East Somerset, North Somerset, South Gloucestershire, Isles of Scilly",
  se: "Greater London, London, Kent, Surrey, East Sussex, West Sussex, Hampshire, Berkshire, Oxfordshire, Buckinghamshire, Isle of Wight, Medway, Brighton and Hove, Southampton, Portsmouth, Milton Keynes",
  os: "Orkney, Orkney Islands, Shetland, Shetland Islands",
  he: "Highland, Eilean Siar, Na h-Eileanan Siar",
  gr: "Aberdeenshire, Aberdeen City, Moray",
  ta: "Angus, Dundee City, Perth and Kinross, Fife, Stirling, Falkirk, Clackmannanshire",
  st: "Argyll and Bute, Glasgow City, North Lanarkshire, South Lanarkshire, Renfrewshire, East Renfrewshire, Inverclyde, West Dunbartonshire, East Dunbartonshire, North Ayrshire, East Ayrshire, South Ayrshire",
  dg: "Dumfries and Galloway, Scottish Borders, City of Edinburgh, East Lothian, Midlothian, West Lothian",
};

/** Lower-cased county name -> region code. */
export const COUNTY_REGION = new Map(Object.entries(COUNTIES).flatMap(([code, names]) =>
  names.split(",").map((c) => [c.trim().toLowerCase(), code])));
const NATION_REGION = new Map([["wales", "wl"], ["northern ireland", "ni"]]);

export function guessRegion(nation, county) {
  const c = (county || "").trim().toLowerCase();
  if (c && COUNTY_REGION.has(c)) return COUNTY_REGION.get(c);
  return NATION_REGION.get((nation || "").trim().toLowerCase()) || null;
}

// WMO code -> [plain words, icon name]
const CODES = new Map();
for (const [codes, words, icon] of [
  [[0], "Clear sky", "sun"], [[1], "Mainly clear", "sun"],
  [[2], "Partly cloudy", "partcloud"], [[3], "Overcast", "cloud"],
  [[45, 48], "Fog", "fog"], [[51, 53, 55], "Drizzle", "drizzle"],
  [[56, 57], "Freezing drizzle", "drizzle"], [[61], "Light rain", "rain"],
  [[63], "Rain", "rain"], [[65], "Heavy rain", "rain"],
  [[66, 67], "Freezing rain", "rain"], [[71, 73, 75, 77], "Snow", "snow"],
  [[80, 81], "Showers", "rain"], [[82], "Heavy showers", "rain"],
  [[85, 86], "Snow showers", "snow"], [[95], "Thunderstorm", "storm"],
  [[96, 99], "Thunderstorm with hail", "storm"],
]) for (const c of codes) CODES.set(c, [words, icon]);

export function describeCode(code) {
  return [...(CODES.get(code) || ["Unknown", "cloud"])];
}

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const RANK = { yellow: 1, amber: 2, red: 3 };
const rankOf = (level) => (Object.hasOwn(RANK, level) ? RANK[level] : 0);

function isDry(row) {
  if (row.rain_mm == null || row.rain_chance == null) return null;
  return row.rain_mm < 1.0 && row.rain_chance < 40;
}

function spellsOf(rows) {
  const spells = [];
  let run = [];
  for (const row of [...rows, { dry: null }]) { // the sentinel closes a run at the end
    if (row.dry) run.push(row.date);
    else if (run.length) {
      spells.push({ start: run[0], end: run[run.length - 1], length: run.length });
      run = [];
    }
  }
  return spells;
}

const dayNumber = (iso) => Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86400e3;

function warningPhrase(warning, now, today) {
  const head = `${warning.level} ${warning.kind} warning`;
  const starts = warning.starts;
  if (!starts) return head + " in force";
  const start = new Date(starts);
  if (Number.isNaN(start.getTime()) || start <= now) return head + " in force";
  const startDay = londonDay(start);
  if (startDay === today) return head + " today";
  if (dayNumber(startDay) - dayNumber(today) === 1) return head + " tomorrow";
  return `${head} on ${dayName(startDay)}`;
}

/** Warnings that have not yet ended (no end time means still in force). */
export function activeWarnings(warnings, now) {
  return (warnings || []).filter((w) => {
    const ended = w.ends ? new Date(w.ends) < now : false; // an unreadable end is never "before now"
    return !ended;
  });
}

export function summarise(forecast, warnings, now) {
  const when = new Date(now);
  warnings = activeWarnings(warnings, when);
  const today = londonDay(when);
  const rows = forecast.daily.filter((r) => r.date >= today).map((src, i) => {
    const row = { ...src };
    const gust = row.gust_max;
    row.dry = isDry(row);
    row.gusty = gust != null && gust >= 40;
    row.flagged = gust != null && gust >= 50;
    row.rough = i >= 7;
    [row.words, row.icon] = describeCode(row.code);
    return row;
  });

  const spells = spellsOf(rows);
  const nextDry = (rows.find((r) => r.dry) || {}).date || null;
  const dryUntil = rows.length && rows[0].dry && spells.length ? spells[0].end : null;
  const flaggedDays = rows.filter((r) => r.flagged).map((r) => r.date);
  const flaggedSoon = rows.slice(0, 3).find((r) => r.flagged) || null;

  let topRank = 0;
  for (const w of warnings) topRank = Math.max(topRank, rankOf(w.level));
  const level = topRank >= 3 ? "red" : topRank === 2 || flaggedSoon ? "amber" : "normal";

  const first = rows[0] || null;
  const card = first ? { high: first.high, low: first.low, rain_chance: first.rain_chance, words: first.words,
    icon: first.icon, next_dry: spells[0] || null, level } : null;

  const count = rows.length;
  const leading = warnings.filter((w) => rankOf(w.level) >= 2).sort((a, b) => {
    if (rankOf(a.level) !== rankOf(b.level)) return rankOf(b.level) - rankOf(a.level);
    const x = a.starts || "", y = b.starts || "";
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let phrase;
  if (leading.length) phrase = warningPhrase(leading[0], when, today);
  else if (flaggedSoon) {
    const at = flaggedSoon.date === today ? "today" : "on " + dayName(flaggedSoon.date);
    phrase = `gusts to ${pyRound(flaggedSoon.gust_max)} mph ${at}`;
  } else if (first && first.dry) {
    if (spells[0].length === count) phrase = `dry for the next ${count} days`;
    else if (spells[0].length === 1) phrase = "dry today";
    else phrase = "dry until " + dayName(dryUntil);
  } else if (nextDry) phrase = (first && first.dry === false ? "rain today, " : "") + "next dry day " + dayName(nextDry);
  else if (!count) phrase = "no forecast available";
  else phrase = `no dry day in the next ${count} days`;

  return { days: rows, dry_spells: spells, next_dry_day: nextDry, dry_until: dryUntil,
    gusty_days: rows.filter((r) => r.gusty).map((r) => r.date), flagged_days: flaggedDays,
    rough_guide_from: count > 7 ? rows[7].date : null, card, day_phrase: phrase };
}
