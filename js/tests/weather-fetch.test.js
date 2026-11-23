// Node only (reads fixtures with node:fs). Ported from tests/test_weather.py and the place checks of
// tests/test_weather_api.py. Nothing goes online: fetch is a fake serving the fixtures.
import { readFileSync } from "node:fs";
import { test, eq, ok } from "./harness.js";
import { searchPlaces, fetchForecast, WeatherError } from "../weather/open-meteo.js";
import { checkPlace, savePlace } from "../weather/place.js";
import { createMemoryData } from "../core/data-memory.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/weather/${name}`, import.meta.url), "utf8");
function fake(name) {
  const f = async (url) => { f.calls.push(url); return { ok: true, status: 200, text: async () => fixture(name) }; };
  f.calls = [];
  return f;
}
const replying = (text, extra = {}) => async () => ({ ok: true, status: 200, text: async () => text, ...extra });
const rejects = async (promise) => { try { await promise; } catch (err) { return err; } throw new Error("expected a rejection"); };

const HEXHAM = { name: "Hexham", county: "Northumberland", lat: 54.97, lon: -2.1, region: "ne" };

test("test_search_places_returns_matches_with_region", async () => {
  const f = fake("places_hexham.json");
  const out = await searchPlaces("Hexham", f);
  eq([out[0].name, out[0].county, out[0].region], ["Hexham", "Northumberland", "ne"]);
  eq([out[0].lat, out[0].lon], [54.96986, -2.104]);
  eq(Object.keys(out[0]).sort(), ["country", "county", "lat", "lon", "name", "nation", "region"]);
  ok(f.calls[0].includes("countryCode=GB") && f.calls[0].includes("count=5"));
});

test("test_search_text_is_url_encoded", async () => {
  const f = fake("places_hexham.json");
  await searchPlaces("Bishop's Castle", f);
  ok(f.calls[0].includes("name=Bishop%27s+Castle"));
  ok(!f.calls[0].includes(" "));
});

test("test_short_search_text_returns_nothing_and_does_not_fetch", async () => {
  const f = fake("places_hexham.json");
  eq(await searchPlaces("a", f), []);
  eq(await searchPlaces("  ", f), []);
  eq(f.calls, []);
});

test("test_fetch_forecast_reduces_reply", async () => {
  const f = fake("forecast.json");
  const out = await fetchForecast(54.97, -2.10, f);
  eq([out.daily.length, out.hourly.length], [16, 72]);
  eq(Object.keys(out.daily[0]).sort(), ["code", "date", "gust_max", "high", "low", "rain_chance", "rain_mm", "sunrise", "sunset", "wind_max"]);
  eq(Object.keys(out.hourly[0]).sort(), ["code", "gust", "rain_chance", "rain_mm", "temp", "time"]);
  eq(Object.keys(out.current).sort(), ["code", "gust", "rain_mm", "temp", "wind"]);
  const d0 = out.daily[0];
  eq({ date: d0.date, high: d0.high, low: d0.low, rain_mm: d0.rain_mm, rain_chance: d0.rain_chance, wind_max: d0.wind_max, gust_max: d0.gust_max, code: d0.code },
    { date: "2026-11-21", high: 3.5, low: -3.7, rain_mm: 0.0, rain_chance: 0, wind_max: 4.9, gust_max: 9.8, code: 3 });
  eq([d0.sunrise, d0.sunset], ["2026-11-21T07:51", "2026-11-21T15:56"]);
  eq([out.daily[15].high, out.daily[15].rain_mm], [null, null]);
  eq([out.hourly[0].time, out.hourly[0].temp], ["2026-11-21T00:00", -1.1]);
  eq(out.current, { temp: -1.1, code: 2, wind: 2.2, gust: 4.7, rain_mm: 0.0 });
  for (const part of ["forecast_days=16", "wind_speed_unit=mph", "timezone=Europe%2FLondon"]) ok(f.calls[0].includes(part), part);
});

test("test_fetch_failure_raises_weather_error", async () => {
  const boom = async () => { throw new TypeError("no internet"); };
  ok((await rejects(fetchForecast(54.97, -2.10, boom))) instanceof WeatherError);
  ok((await rejects(searchPlaces("Hexham", replying("not json")))) instanceof WeatherError);
  ok((await rejects(fetchForecast(54.97, -2.10, replying("not json")))) instanceof WeatherError);
  ok((await rejects(fetchForecast(54.97, -2.10, replying('{"current":{}}')))) instanceof WeatherError);
  ok((await rejects(searchPlaces("Hexham", replying('{"results":[{"name":"X"}]}')))) instanceof WeatherError);
});

test("a non-OK reply is a WeatherError", async () => {
  const limited = async () => ({ ok: false, status: 429, text: async () => "{}" });
  ok((await rejects(searchPlaces("Hexham", limited))) instanceof WeatherError);
  ok((await rejects(fetchForecast(54.97, -2.10, limited))) instanceof WeatherError);
});

test("test_save_place_validates", () => {
  for (const change of [{ lat: 91 }, { lon: -181 }, { region: "xx" }, { name: "" }]) ok(checkPlace({ ...HEXHAM, ...change }), JSON.stringify(change));
  eq(checkPlace(HEXHAM), null);
  eq(checkPlace({ ...HEXHAM, name: "" }), "Choose a place");
  eq(checkPlace({ ...HEXHAM, lat: 91 }), "That place has no usable latitude");
  eq(checkPlace({ ...HEXHAM, lon: "x" }), "That place has no usable longitude");
  eq(checkPlace({ ...HEXHAM, region: "xx" }), "Unknown weather region");
  eq(checkPlace({ ...HEXHAM, county: 5 }), "Unknown county");
});

test("test_save_place_ok_and_region_may_be_none", async () => {
  const d = createMemoryData();
  const r = savePlace(d, { ...HEXHAM, name: " Hexham " }, { onFail() {} });
  eq(r.ok, true);
  eq(await d.get("settings/weather"), { place: { ...HEXHAM, nation: null } });
  eq(savePlace(d, { ...HEXHAM, region: null }, { onFail() {} }).ok, true);
  eq((await d.get("settings/weather")).place.region, null);
  eq(savePlace(d, { ...HEXHAM, lat: 91 }, { onFail() {} }), { error: "That place has no usable latitude" });
});
