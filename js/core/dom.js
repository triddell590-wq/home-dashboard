// Building elements and formatting numbers and times. Formatting functions touch no `document`,
// so they also run in Node for the page-logic tests.

const MINUS = "−";
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "html") node.innerHTML = value;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function table(headers, rows) {
  return el("table", { class: "table" },
    el("thead", {}, el("tr", {}, headers.map((h) => el("th", typeof h === "object" ? h.attrs : {}, typeof h === "object" ? h.label : h)))),
    el("tbody", {}, rows.map((cells) => (cells instanceof Node && cells.tagName === "TR" ? cells
      : el("tr", {}, cells.map((c) => (c instanceof Node && c.tagName === "TD" ? c : el("td", {}, c))))))));
}

export function toast(message) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const item = el("div", { class: "toast", role: "status" }, message);
  host.append(item);
  setTimeout(() => item.remove(), 4000);
}

function signed(value, text, sign) {
  if (value < 0) return MINUS + text;
  if (sign && value > 0) return "+" + text;
  return text;
}

export function money(n, { sign = false } = {}) {
  const value = Number(n) || 0;
  const text = "$" + Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return signed(Math.round(value * 100) / 100, text, sign);
}

export function pct(x, { sign = true, digits = 2 } = {}) {
  const value = Number(x) || 0;
  const rounded = Number((value * 100).toFixed(digits));
  return signed(rounded, Math.abs(rounded).toFixed(digits) + "%", sign);
}

const pad = (n) => String(n).padStart(2, "0");

export function localTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Dates and the greeting follow Europe/London whatever the device's time zone is.
const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23",
  weekday: "long", day: "numeric", month: "long", hour: "numeric" });
const londonParts = (date) => Object.fromEntries(LONDON.formatToParts(new Date(date)).map((p) => [p.type, p.value]));

export function localDate(date) {
  const p = londonParts(date);
  return `${p.weekday} ${Number(p.day)} ${p.month}`;
}

// The London calendar date and hour, as sortable strings: "YYYY-MM-DD" and "YYYY-MM-DDTHH:00".
const LONDON_NUMERIC = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
const londonNumbers = (date) => Object.fromEntries(LONDON_NUMERIC.formatToParts(new Date(date)).map((p) => [p.type, p.value]));

export function londonDay(date) {
  const p = londonNumbers(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function londonHourStart(date) {
  const p = londonNumbers(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

export function relativeDay(iso, now = new Date()) {
  const d = new Date(iso);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((start(d) - start(new Date(now))) / 86400e3);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return DAY_NAMES[d.getDay()];
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function countdown(ms) {
  const minutes = Math.floor(ms / 60e3);
  if (minutes < 1) return "less than a minute";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function greeting(date = new Date()) {
  const h = Number(londonParts(date).hour);
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}
