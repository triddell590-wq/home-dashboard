// The forecast copy on each device: a port of _weather() in mltrader/web/weather_api.py. The copy lives in
// store key "weather-forecast" (home-weather-forecast) as { lat, lon, fetchedAt, lastAttempt, data }.
import * as store from "../core/store.js";
import { londonHourStart } from "../core/dom.js";
import { fetchForecast, WeatherError } from "./open-meteo.js";
import { summarise, activeWarnings, describeCode } from "./summary.js";

export const COPY_LIFE_MS = 3600000;
export const REFRESH_GAP_MS = 60000;
export const WARNINGS_LIFE_MS = 21600000;
export const HOURS_SHOWN = 48;
export const FORECAST_ERROR = "Couldn't get the forecast right now";
export const REFRESH_ERROR = "Couldn't refresh the forecast, showing the last copy";

const KEY = "weather-forecast";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const parseTime = (text) => (typeof text === "string" && !Number.isNaN(Date.parse(text)) ? Date.parse(text) : null);
const withWords = (row) => { const [words, icon] = describeCode(row.code); return { ...row, words, icon }; };

/** The stored record for this place (or null); `copy` is set only when it also holds a usable forecast. */
function readRecord(place, storage) {
  const raw = store.get(KEY, null, storage);
  if (!isObject(raw) || raw.lat !== place.lat || raw.lon !== place.lon) return null;
  const d = raw.data;
  const usable = isObject(d) && d.daily && d.hourly && d.current && parseTime(raw.fetchedAt) !== null;
  return { lastAttempt: parseTime(raw.lastAttempt), copy: usable ? { fetchedAt: raw.fetchedAt, data: d } : null };
}

function warningsFor(place, doc, now) {
  if (!place.region || !isObject(doc) || doc.region !== place.region || !Array.isArray(doc.items)) return { list: [], ok: false };
  const fetched = parseTime(doc.fetchedAt);
  if (fetched === null || now.getTime() - fetched >= WARNINGS_LIFE_MS) return { list: [], ok: false };
  return { list: activeWarnings(doc.items, now), ok: doc.ok === true };
}

export async function getWeather({ place, warnings, force = false, now = new Date(), fetchImpl = globalThis.fetch, storage }) {
  if (!place) return { place: null };
  const nowMs = now.getTime();
  const stamp = now.toISOString();
  const record = readRecord(place, storage);
  let copy = record && record.copy;
  const old = (c) => nowMs - Date.parse(c.fetchedAt) >= COPY_LIFE_MS;
  const gated = !!record && record.lastAttempt !== null && nowMs - record.lastAttempt < REFRESH_GAP_MS;

  let refreshFailed = false;
  if (!copy || ((force || old(copy)) && !gated)) {
    try {
      const data = await fetchForecast(place.lat, place.lon, fetchImpl);
      copy = { fetchedAt: stamp, data };
      store.set(KEY, { lat: place.lat, lon: place.lon, fetchedAt: stamp, lastAttempt: stamp, data }, storage);
    } catch (err) {
      if (!(err instanceof WeatherError)) throw err;
      if (!copy) throw new Error(FORECAST_ERROR);
      refreshFailed = true;
      store.set(KEY, { lat: place.lat, lon: place.lon, fetchedAt: copy.fetchedAt, lastAttempt: stamp, data: copy.data }, storage);
    }
  }

  const stale = old(copy);
  const w = warningsFor(place, warnings, now);
  const data = copy.data;
  const floor = londonHourStart(now);
  const hourly = data.hourly.filter((r) => r.time >= floor).slice(0, HOURS_SHOWN).map(withWords);
  return {
    place,
    summary: summarise(data, w.list, now),
    current: withWords(data.current),
    hourly,
    warnings: w.list,
    fetched_at: copy.fetchedAt,
    stale,
    warnings_ok: w.ok,
    refresh_error: refreshFailed || stale ? REFRESH_ERROR : null,
  };
}
