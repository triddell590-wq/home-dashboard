// Weather: the tab (now and today, rain and dry spells, wind, next 48 hours), the Overview card, the "Your day"
// phrase and the Settings "Farm location" card. The place and the Met Office warnings come from Firestore through
// data(); the forecast itself is fetched by this device and kept in its own copy (weather/forecast.js). All three
// pieces call loadWeather, so one forecast serves them. Place names, warning titles and links are free text and are
// placed with textContent (el text nodes) only; the one markup string is the fixed icon table.
import { data } from "../core/data.js";
import { el, toast } from "../core/dom.js";
import { go } from "../core/router.js";
import { getWeather } from "../weather/forecast.js";
import { WeatherError, searchPlaces } from "../weather/open-meteo.js";
import { savePlace } from "../weather/place.js";
import {
  REGIONS, WEATHER_ICONS, asOfText, cardMessage, clock, dayName, forecastFrom, gustClass, rainText, safeLink, shortDayName, spellText,
  staleText, warningText,
} from "../weather/text.js";

export const tab = { id: "weather", label: "Weather", icon: "weather", order: 40, mount };

const NO_PLACE = "Add your farm's location in Settings to see the forecast";
const NO_REGION = "Choose a warning region in Settings to see Met Office warnings";
const WARNINGS_UNAVAILABLE = "Met Office warnings unavailable";
const SEARCH_FAILED = "Couldn't search for places right now";
const READ_FAILED = "Couldn't read the saved location.";
const WAIT_MS = 10000;
const FORECAST_FAILED = "Couldn't load the forecast \u2014 check your connection and try Refresh";

/** What the error card says: always plain wording, never the technical error text. */
export const failText = () => FORECAST_FAILED;

// ------------------------------------------------------------------ loading

const inflight = new Map();   // force flag -> the one running load, shared by the card, the day phrase and the tab

function readBoth(d, waitMs) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out")), waitMs); });
  // Warnings that can't be read (offline, nothing cached) count as "no warnings available"; the place still matters.
  const reads = Promise.all([d.get("settings/weather"), Promise.resolve().then(() => d.get("weather/warnings")).catch(() => null)]);
  return Promise.race([reads, timeout]).finally(() => clearTimeout(timer));
}

/** The forecast result for the saved place (`{ place: null }` when none). Concurrent calls with the same `force` share one promise. */
export function loadWeather({ force = false, fetchImpl, storage, now } = {}) {
  const key = !!force;
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    const [settings, warnings] = await readBoth(data(), WAIT_MS);
    const place = settings && settings.place ? settings.place : null;
    const options = { place, warnings, force: key };
    if (fetchImpl) options.fetchImpl = fetchImpl;
    if (storage) options.storage = storage;
    if (now) options.now = now;
    const result = await getWeather(options);
    return { ...result, used: { place: canon(place), warnings: canon(warnings) } };   // what this result was built from
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Text of a value with keys in a fixed order, so two copies of the same document compare equal. */
export function canon(value) {
  const sorted = (v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : Array.isArray(v) ? v.map(sorted) : v);
  return JSON.stringify(sorted(value ?? null));
}

/**
 * Watches the saved place and the warnings. Every report is kept; `onChange()` runs when a report differs from what
 * the last drawn load used (`usedFn()`, null while nothing is drawn yet). `differs(used)` tells a finished load whether
 * a newer report has already arrived. Returns { stop, differs }.
 */
export function watchWeather(onChange, usedFn) {
  const reported = { place: undefined, warnings: undefined };
  const differs = (used) => !!used && ((reported.place !== undefined && reported.place !== used.place)
    || (reported.warnings !== undefined && reported.warnings !== used.warnings));
  const stops = [];
  const report = (name, text) => { reported[name] = text; if (differs(usedFn())) onChange(); };
  try {
    stops.push(data().watch("settings/weather", (doc) => report("place", canon(doc && doc.place ? doc.place : null))));
    stops.push(data().watch("weather/warnings", (doc) => report("warnings", canon(doc))));
  } catch {
    // no watch: the page still loads once; it just won't redraw on its own
  }
  return { stop: () => { for (const x of stops) if (typeof x === "function") x(); }, differs };
}

const MAX_RELOADS = 3;

/**
 * Runs the loads for a Weather view: the newest load wins (an older result arriving later is dropped), and a result
 * built from older data than the watch has reported is never drawn, a reload starts instead.
 * `draw(result)` and `fail(err)` paint; `busy(flag)` tells the Refresh button.
 */
export function weatherController({ draw, fail, busy = () => {}, load = loadWeather }) {
  let seq = 0;
  let used = null;
  let alive = true;
  const watcher = watchWeather(() => { if (alive) show(false); }, () => used);
  async function show(force, reloads = 0) {
    const mine = ++seq;
    busy(true);
    try {
      const result = await load({ force });
      if (!alive || mine !== seq) return;
      if (watcher.differs(result.used) && reloads < MAX_RELOADS) return show(false, reloads + 1);
      used = result.used;
      draw(result);
    } catch (err) {
      if (alive && mine === seq) fail(err);
    } finally {
      if (mine === seq) busy(false);
    }
  }
  return { show, stop() { alive = false; watcher.stop(); } };
}

// ------------------------------------------------------------------ icons and small formats

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "wx-icon");
  svg.innerHTML = WEATHER_ICONS[name] || WEATHER_ICONS.cloud;
  return svg;
}

const deg = (n) => (n == null ? "—" : `${Math.round(n)}°`);
const mph = (n) => (n == null ? "—" : `${Math.round(n)} mph`);
const pctText = (n) => (n == null ? "—" : `${Math.round(n)}%`);
const dayOfMonth = (date) => Number(date.slice(8, 10));

// ------------------------------------------------------------------ sections

function nowSection(result) {
  const { place, current, summary, warnings } = result;
  const today = summary.days[0] || {};
  const notes = [staleText(result.fetched_at, result.refresh_error)];
  if (!place.region) notes.push(NO_REGION);
  else if (!result.warnings_ok) notes.push(WARNINGS_UNAVAILABLE);
  const banners = (warnings || []).map((w) => el("div", { class: `wx-warning level-${w.level || "yellow"}`, role: "alert" },
    el("strong", {}, warningText(w)),
    w.headline ? el("span", {}, w.headline) : null,
    safeLink(w.link) ? el("a", { href: safeLink(w.link), target: "_blank", rel: "noopener noreferrer" }, "Met Office →") : null));
  return el("section", { class: "card wide static wx-now" },
    el("div", { class: "label" }, el("span", {}, place.name + (place.county ? `, ${place.county}` : "")),
      el("span", {}, forecastFrom(result.fetched_at))),
    banners,
    el("div", { class: "wx-now-main" },
      icon(current.icon),
      el("div", {}, el("div", { class: "wx-temp" }, deg(current.temp)),
        el("div", { class: "sub" }, asOfText(result) ? `${current.words} · ${asOfText(result)}` : current.words)),
      el("dl", { class: "wx-facts" },
        el("div", {}, el("dt", {}, "Rain today"), el("dd", {}, pctText(today.rain_chance))),
        el("div", {}, el("dt", {}, "Wind"), el("dd", {}, mph(current.wind))),
        el("div", {}, el("dt", {}, "Gusts"), el("dd", { class: gustClass(current.gust) }, mph(current.gust))),
        el("div", {}, el("dt", {}, "Sunrise"), el("dd", {}, today.sunrise ? clock(today.sunrise) : "—")),
        el("div", {}, el("dt", {}, "Sunset"), el("dd", {}, today.sunset ? clock(today.sunset) : "—")))),
    notes.filter(Boolean).map((n) => el("p", { class: "sub wx-note" }, n)));
}

function stripSection(result) {
  const days = result.summary.days;
  const cells = [];
  days.forEach((d, i) => {
    if (d.rough && !days[i - 1]?.rough) cells.push(el("div", { class: "wx-rough-label", "aria-hidden": "true" }, "rough guide"));
    cells.push(el("div", { class: `wx-day${d.rough ? " rough" : ""}${d.dry ? " dry" : ""}`, title: d.words },
      el("div", { class: "wx-dow" }, i === 0 ? "Today" : shortDayName(d.date)),
      el("div", { class: "sub" }, dayOfMonth(d.date)),
      icon(d.icon),
      el("div", { class: "wx-hl" }, el("b", {}, deg(d.high)), " ", el("span", { class: "muted" }, deg(d.low))),
      el("div", { class: "sub" }, rainText(d)),
      d.dry ? el("div", { class: "wx-dry-tag" }, "dry") : null));
  });
  return el("section", { class: "card wide static" },
    el("div", { class: "label" }, "Rain and dry spells"),
    el("p", { class: "wx-spell" }, spellText(result.summary)),
    el("div", { class: "wx-strip", role: "list" }, cells));
}

function windSection(result) {
  const days = result.summary.days;
  return el("section", { class: "card wide static" },
    el("div", { class: "label" }, "Wind", el("span", { class: "sub" }, "highest gust each day · 40+ gusty · 50+ flagged")),
    el("div", { class: "wx-strip wx-wind" }, days.map((d, i) => el("div", { class: `wx-day${d.rough ? " rough" : ""}` },
      el("div", { class: "wx-dow" }, i === 0 ? "Today" : shortDayName(d.date)),
      el("div", { class: `wx-gust ${gustClass(d.gust_max)}` }, d.gust_max == null ? "—" : Math.round(d.gust_max)),
      el("div", { class: "sub" }, "mph")))));
}

function hourlySection(result) {
  return el("section", { class: "card wide static" },
    el("div", { class: "label" }, "Next 48 hours"),
    el("div", { class: "wx-strip wx-hours" }, (result.hourly || []).map((h) => {
      const first = h.time.slice(11, 13) === "00";
      return el("div", { class: "wx-hour" },
        el("div", { class: "wx-dow" }, first ? dayName(h.time).slice(0, 3) : clock(h.time)),
        icon(h.icon),
        el("div", {}, el("b", {}, deg(h.temp))),
        el("div", { class: "sub", title: "chance of rain" }, pctText(h.rain_chance)),
        el("div", { class: `wx-gust small ${gustClass(h.gust)}`, title: "gust" }, h.gust == null ? "—" : Math.round(h.gust)));
    })));
}

// ------------------------------------------------------------------ tab

function mount(container) {
  container.append(el("h1", { class: "page-title" }, "Weather"));
  const body = el("div", { class: "grid" }, el("p", { class: "sub wx-loading", role: "status" }, "Loading…"));
  const refreshButton = el("button", { class: "btn ghost small", type: "button", onclick: () => show(true) }, "Refresh");
  container.append(el("div", { class: "actions wx-actions" }, refreshButton), body);
  const ctl = weatherController({
    busy: (flag) => { refreshButton.disabled = flag; },
    draw(result) {
      if (!result.place) {
        body.replaceChildren(el("section", { class: "card wide static" }, el("p", { class: "sub" }, NO_PLACE)));
      } else {
        body.replaceChildren(nowSection(result), stripSection(result), windSection(result), hourlySection(result));
      }
    },
    fail(err) {
      body.replaceChildren(el("section", { class: "card wide static card-error", role: "alert" },
        el("p", { class: "sub" }, failText(err)),
        el("button", { class: "btn ghost small", type: "button", onclick: () => show(false) }, "Retry")));
    },
  });
  const show = (force) => ctl.show(force);
  show(false);
  return () => ctl.stop();
}

// ------------------------------------------------------------------ Overview card and "Your day"

function renderCard(result, body) {
  const c = result.summary.card;
  const card = body.closest(".card");
  if (card) {
    card.classList.remove("level-amber", "level-red", "weather-card");
    card.classList.add("weather-card");
    if (c && (c.level === "amber" || c.level === "red")) card.classList.add(`level-${c.level}`);
  }
  const open = { class: "wx-card", role: "link", tabindex: "0", onclick: () => go("weather"),
    onkeydown: (e) => { if (e.key === "Enter") go("weather"); } };
  if (!c) {      // an old copy with no days left: say so rather than failing
    body.replaceChildren(el("div", open,
      el("div", { class: "label" }, el("span", {}, "Weather"), el("span", {}, result.place.name)),
      el("p", { class: "sub" }, cardMessage(result))));
    return;
  }
  const stale = staleText(result.fetched_at, result.refresh_error);
  body.replaceChildren(el("div", open,
    el("div", { class: "label" }, el("span", {}, "Weather"), el("span", {}, result.place.name)),
    el("div", { class: "wx-card-main" }, icon(c.icon),
      el("div", {}, el("div", { class: "big" }, `${deg(c.high)} / ${deg(c.low)}`), el("div", { class: "sub" }, c.words))),
    el("p", { class: "sub" }, `Rain ${pctText(c.rain_chance)}`),
    el("p", { class: "sub" }, spellText(result.summary)),
    stale ? el("p", { class: "sub wx-note" }, stale) : null));
}

export function registerWeather({ registerCard, registerDayPart, registerSettingsCard }) {
  let used = null;      // what the card's last load used
  let differs = () => false;
  registerCard({ id: "weather", order: 50, size: "small", title: "Weather",
    async load() {
      let result = await loadWeather({ force: false });
      for (let n = 0; differs(result.used) && n < MAX_RELOADS; n++) result = await loadWeather({ force: false });   // newer data arrived while loading
      used = result.used;
      return result;
    },
    empty: (result) => (!result || !result.place ? NO_PLACE : null),
    render: renderCard,
    watch(refresh) {
      const watcher = watchWeather(refresh, () => used);
      differs = watcher.differs;
      return () => { watcher.stop(); differs = () => false; used = null; };
    } });
  registerDayPart({ id: "weather", order: 30, async load() {
    try {
      const result = await loadWeather({ force: false });
      return result && result.place && result.summary ? result.summary.day_phrase || null : null;
    } catch {
      return null;
    }
  } });
  registerSettingsCard({ id: "weather", order: 20, mount: mountSettingsCard });
}

// ------------------------------------------------------------------ Settings card: Farm location

export function mountSettingsCard(grid, isAlive = () => true) {
  const placeBox = el("input", { type: "search", placeholder: "Town or village, e.g. Hexham", "aria-label": "Search for a place", autocomplete: "off" });
  const placeStatus = el("p", { class: "sub", role: "status" }, "Loading…");
  const placeResults = el("div", { class: "place-results" });
  const regionSelect = el("select", { "aria-label": "Warning region" },
    el("option", { value: "" }, "None (no Met Office warnings)"),
    Object.entries(REGIONS).map(([code, label]) => el("option", { value: code }, label)));
  let savedPlace = null;
  let loaded = false;
  let searchSeq = 0;
  const showPlace = () => {
    placeStatus.textContent = savedPlace ? `Saved: ${savedPlace.name}${savedPlace.county ? `, ${savedPlace.county}` : ""}` : "No location saved yet.";
    regionSelect.value = (savedPlace && savedPlace.region) || "";
  };
  const save = (place) => {
    const result = savePlace(data(), place, { onFail: toast });
    if (result.error) { showPlace(); placeStatus.textContent = result.error; return; }
    savedPlace = result.place;
    showPlace();
    placeResults.replaceChildren();
    toast("Farm location saved");
  };
  const search = async () => {
    const q = placeBox.value.trim();
    if (!q) return;
    const mine = ++searchSeq;
    placeResults.replaceChildren();
    try {
      const found = await searchPlaces(q);
      if (!isAlive() || mine !== searchSeq) return;
      placeResults.replaceChildren(...(found.length ? found.map((p) => el("button", { class: "btn ghost", type: "button", onclick: () => save(p) },
        el("span", {}, p.name), el("span", { class: "sub" }, p.county || p.nation || ""))) : [el("p", { class: "sub" }, "No places found")]));
    } catch (err) {
      if (!isAlive() || mine !== searchSeq) return;
      if (!(err instanceof WeatherError)) console.warn("place search:", err);
      placeStatus.textContent = SEARCH_FAILED;
    }
  };
  placeBox.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  regionSelect.addEventListener("change", () => {
    if (!savedPlace) { regionSelect.value = ""; placeStatus.textContent = "Search for and choose a location first."; return; }
    save({ ...savedPlace, region: regionSelect.value || null });
  });
  grid.append(el("section", { class: "card half static", "data-card": "farm-location" }, el("div", { class: "label" }, "Farm location"),
    el("p", { class: "sub" }, "Used for the weather forecast and Met Office warnings."),
    el("div", { class: "actions" }, placeBox, el("button", { class: "btn", type: "button", onclick: search }, "Search")),
    placeResults,
    el("div", { class: "form-grid", style: { gridTemplateColumns: "1fr", marginTop: "12px" } }, el("label", {}, "Warning region", regionSelect)),
    placeStatus));

  let timer = setTimeout(() => {
    timer = null;
    if (isAlive() && !loaded) { savedPlace = null; placeStatus.textContent = READ_FAILED; }
  }, WAIT_MS);
  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  let stopWatch = () => {};
  try {
    stopWatch = data().watch("settings/weather", (doc) => {
      if (!isAlive()) return;
      loaded = true;
      clear();
      savedPlace = doc && doc.place ? doc.place : null;
      showPlace();
    });
  } catch {
    clear();
    placeStatus.textContent = READ_FAILED;
  }
  return () => { clear(); if (typeof stopWatch === "function") stopWatch(); };
}
