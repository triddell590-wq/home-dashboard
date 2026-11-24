// The trading data layer. The engine runs online and publishes read-only documents (users/{uid}/trading/*,
// tradingTickers/{TICKER}); the page only reads them, always through data().
import { data } from "../core/data.js";

export const TRADING_PATHS = {
  status: "trading/status", today: "trading/today", account: "trading/account", record: "trading/record",
  unlock: "trading/unlock", lab: "trading/lab", universe: "trading/universe",
};
export const READ_WAIT_MS = 10000;
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pathOf = (name) => {
  if (!Object.prototype.hasOwnProperty.call(TRADING_PATHS, name)) throw new Error(`Unknown trading document: ${name}`);
  return TRADING_PATHS[name];
};

// Rejects if the read has not answered in waitMs, so a view can show its error instead of loading forever.
function withTimeout(promise, waitMs, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out reading ${what}`)), waitMs); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** One trading document, or null when it has not been published yet. */
export async function readTrading(name, waitMs = READ_WAIT_MS) {
  const path = pathOf(name);
  const doc = await withTimeout(Promise.resolve(data().get(path)), waitMs, path);
  return isObject(doc) ? doc : null;
}

/** One ticker's document, or null (without reading anything) when the symbol is not a plausible ticker. */
export async function readTicker(ticker, waitMs = READ_WAIT_MS) {
  if (typeof ticker !== "string" || !TICKER.test(ticker)) return null;
  const path = `tradingTickers/${ticker}`;
  const doc = await withTimeout(Promise.resolve(data().get(path)), waitMs, path);
  return isObject(doc) ? doc : null;
}

/** Calls onChange(name, doc) for every report of each named document, the first included, so a change between an
 * initial read and the first report is never lost; callers compare with what they last drew. Returns stop(). */
export function watchTrading(names, onChange) {
  const paths = names.map(pathOf);   // validate every name before subscribing to any
  let stopped = false;
  const stops = paths.map((path, i) => {
    const name = names[i];
    return data().watch(path, (doc) => {
      if (!stopped) onChange(name, isObject(doc) ? doc : null);
    });
  });
  return () => { stopped = true; for (const s of stops) if (typeof s === "function") s(); };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The compact record rows { d, p, s } as the engine's forward frame: { days: [{ day, pick_return, spy_return }] }. */
export function forwardFrom(record) {
  const rows = isObject(record) && Array.isArray(record.rows) ? record.rows : [];
  const days = [];
  for (const r of rows) {
    if (!isObject(r) || typeof r.d !== "string" || !isNum(r.p) || !isNum(r.s)) continue;
    days.push({ day: r.d, pick_return: r.p, spy_return: r.s });
  }
  return { days };
}
