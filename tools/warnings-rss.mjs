// Parses the Met Office warnings RSS feed. Port of fetch_warnings/_times in mltrader/weather.py.
// Regex-based because Node has no DOMParser.
export const WARNINGS_URL = "https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/";

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
});
function londonParts(ms) {
  const p = {};
  for (const { type, value } of LONDON.formatToParts(new Date(ms))) p[type] = Number(value);
  return p;
}
// Minutes London is ahead of UTC at instant ms (0 or 60).
const offsetAt = (ms) => {
  const p = londonParts(ms);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000;
};

const pad = (n) => String(n).padStart(2, "0");
export function londonStamp(y, mo, d, hh, mm) {
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  const back = new Date(wall);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
    || back.getUTCHours() !== hh || back.getUTCMinutes() !== mm) return null;
  const off = offsetAt(wall - offsetAt(wall) * 60000);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+0${off / 60}:00`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function text(raw) {
  const out = [];
  let rest = raw;
  for (;;) {
    const i = rest.indexOf("<![CDATA[");
    const j = i < 0 ? -1 : rest.indexOf("]]>", i);
    if (j < 0) { out.push(rest.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n])); break; }
    out.push(rest.slice(0, i).replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n]), rest.slice(i + 9, j));
    rest = rest.slice(j + 3);
  }
  return out.join("").trim();
}
const child = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? text(m[1]) : "";
};

const LEVEL = /\b(red|amber|yellow)\b/i;
const KIND = /warning of (\w+)/i;
const VALID = /valid from (\d{4}) \w{3} (\d{1,2}) (\w{3}) to (\d{4}) \w{3} (\d{1,2}) (\w{3})/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function times(description, pub) {
  const m = VALID.exec(description);
  if (!m || !pub) return [null, null];
  const [, t1, d1, m1, t2, d2, m2] = m;
  const mon1 = MONTHS.indexOf(m1.toLowerCase()) + 1;
  const mon2 = MONTHS.indexOf(m2.toLowerCase()) + 1;
  if (!mon1 || !mon2) return [null, null];
  const year1 = pub.year + (mon1 < pub.month ? 1 : 0);
  const year2 = year1 + (mon2 < mon1 ? 1 : 0);
  const stamp = (y, mo, d, hhmm) => londonStamp(y, mo, Number(d), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2)));
  const a = stamp(year1, mon1, d1, t1);
  const b = stamp(year2, mon2, d2, t2);
  return a && b ? [a, b] : [null, null];
}

export function parseWarnings(xmlText) {
  const ch = /<channel(?:\s[^>]*)?>([\s\S]*)<\/channel>/.exec(String(xmlText));
  if (!ch) throw new Error("no channel in warnings feed");
  const items = [...ch[1].matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const pubText = child(ch[1].replace(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g, ""), "pubDate");
  const ms = pubText ? Date.parse(pubText) : NaN;
  const pub = Number.isNaN(ms) ? null : londonParts(ms);
  return items.map((item) => {
    const title = child(item, "title");
    const headline = child(item, "description");
    const lv = LEVEL.exec(title);
    const kd = KIND.exec(title);
    const [starts, ends] = times(headline, pub);
    return { level: lv ? lv[1].toLowerCase() : null, kind: kd ? kd[1].toLowerCase() : "weather",
      title, headline, starts, ends, link: child(item, "link") };
  });
}
