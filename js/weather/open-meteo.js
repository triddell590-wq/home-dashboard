// Open-Meteo place search and forecast, ported from search_places / fetch_forecast in mltrader/weather.py.
// fetch is injected: fetchImpl(url, options) resolves to a fetch Response. Any failure is a WeatherError.
import { guessRegion } from "./summary.js";

export const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export class WeatherError extends Error {
  constructor(message) { super(message); this.name = "WeatherError"; }
}

async function getJson(fetchImpl, url) {
  const where = url.split("?")[0];
  let text;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);
    text = await res.text();
  } catch (err) {
    throw new WeatherError(`could not fetch ${where}: ${err && err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new WeatherError(`bad JSON reply: ${err.message}`);
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function field(obj, key) {
  if (!isObject(obj) || !Object.hasOwn(obj, key)) throw new WeatherError(`missing ${key}`);
  return obj[key];
}
function at(arr, i) {
  if (!Array.isArray(arr) || i >= arr.length) throw new WeatherError("short forecast reply");
  return arr[i];
}
function number(v) {
  if (typeof v === "boolean" || v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) throw new WeatherError("not a number");
  return Number(v);
}
const orNull = (obj, key) => (Object.hasOwn(obj, key) && obj[key] !== undefined ? obj[key] : null);

export async function searchPlaces(text, fetchImpl = globalThis.fetch) {
  text = (text || "").trim();
  if (text.length < 2) return [];
  const url = GEOCODE_URL + "?" + new URLSearchParams({ name: text, count: 5, countryCode: "GB" });
  const data = await getJson(fetchImpl, url);
  if (!isObject(data)) throw new WeatherError("unexpected place reply");
  const results = data.results || [];
  if (!Array.isArray(results)) throw new WeatherError("unexpected place reply");
  return results.map((r) => ({
    name: field(r, "name"), county: orNull(r, "admin2"), nation: orNull(r, "admin1"), country: orNull(r, "country"),
    lat: number(field(r, "latitude")), lon: number(field(r, "longitude")),
    region: guessRegion(orNull(r, "admin1"), orNull(r, "admin2")),
  }));
}

export async function fetchForecast(lat, lon, fetchImpl = globalThis.fetch) {
  const url = FORECAST_URL + "?" + new URLSearchParams({
    latitude: lat, longitude: lon, forecast_days: 16,
    timezone: "Europe/London", temperature_unit: "celsius",
    wind_speed_unit: "mph", precipitation_unit: "mm",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
      + "precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset",
    hourly: "temperature_2m,precipitation_probability,precipitation,wind_gusts_10m,weather_code",
    current: "temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation",
  });
  const data = await getJson(fetchImpl, url);
  const cur = field(data, "current"), d = field(data, "daily"), h = field(data, "hourly");
  const current = { temp: field(cur, "temperature_2m"), code: field(cur, "weather_code"),
    wind: field(cur, "wind_speed_10m"), gust: field(cur, "wind_gusts_10m"), rain_mm: field(cur, "precipitation") };
  const dTime = field(d, "time");
  if (!Array.isArray(dTime)) throw new WeatherError("unexpected forecast reply");
  const daily = dTime.map((date, i) => ({
    date, code: at(field(d, "weather_code"), i), high: at(field(d, "temperature_2m_max"), i),
    low: at(field(d, "temperature_2m_min"), i), rain_mm: at(field(d, "precipitation_sum"), i),
    rain_chance: at(field(d, "precipitation_probability_max"), i), wind_max: at(field(d, "wind_speed_10m_max"), i),
    gust_max: at(field(d, "wind_gusts_10m_max"), i), sunrise: at(field(d, "sunrise"), i), sunset: at(field(d, "sunset"), i),
  }));
  const hTime = field(h, "time");
  if (!Array.isArray(hTime)) throw new WeatherError("unexpected forecast reply");
  const hourly = hTime.slice(0, 72).map((time, i) => ({
    time, temp: at(field(h, "temperature_2m"), i), rain_chance: at(field(h, "precipitation_probability"), i),
    rain_mm: at(field(h, "precipitation"), i), gust: at(field(h, "wind_gusts_10m"), i), code: at(field(h, "weather_code"), i),
  }));
  return { current, daily, hourly };
}
