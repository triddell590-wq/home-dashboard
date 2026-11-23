// The saved place: checks (from put_place in mltrader/web/weather_api.py) and the write to settings/weather.
import { REGIONS } from "./text.js";
import { issue } from "../core/issue.js";

const usable = (v, low, high) => typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;

export function checkPlace(place) {
  const p = place || {};
  if (typeof p.name !== "string" || !p.name.trim()) return "Choose a place";
  if (!usable(p.lat, -90, 90)) return "That place has no usable latitude";
  if (!usable(p.lon, -180, 180)) return "That place has no usable longitude";
  if (p.region != null && !Object.hasOwn(REGIONS, p.region)) return "Unknown weather region";
  if (p.county != null && typeof p.county !== "string") return "Unknown county";
  return null;
}

export function savePlace(d, place, { onFail } = {}) {
  const bad = checkPlace(place);
  if (bad) return { error: bad };
  const saved = { name: place.name.trim(), county: place.county ?? null, nation: place.nation ?? null,
    lat: place.lat, lon: place.lon, region: place.region ?? null };
  issue(() => d.set("settings/weather", { place: saved }), onFail);
  return { ok: true, place: saved };
}
