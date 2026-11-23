// The home page: the greeting and "Your day" line, then every registered card. Until a part registers cards
// it says plainly what is coming.
import { mountCard } from "../core/card.js";
import { data } from "../core/data.js";
import { el, greeting, localDate } from "../core/dom.js";
import { cards, dayParts } from "../core/registry.js";
import { onVisible } from "../core/visible.js";
import { cleanName } from "./settings.js";

export const tab = { id: "overview", label: "Overview", order: 10, mount };

export function greetingText(name, date = new Date()) {
  const clean = cleanName(name);
  return clean ? `${greeting(date)}, ${clean}` : greeting(date);
}

export function summaryText(phrases) {
  return phrases.filter(Boolean).join(" · ") || null;
}

export function overviewEmpty(cardCount) {
  if (cardCount !== 0) return null;
  return ["Your calendar comes next. Lessons, weather and trading follow, one at a time.",
    "Until then, they're in the dashboard on your Mac."];
}

/** Shows the date and greeting now, on a new name, and whenever the page comes back into view: an app left open overnight must not show yesterday. */
export function keepDayFresh({ show, clock = () => new Date(), doc = document }) {
  let name = "";
  const refresh = () => {
    const now = clock();
    show({ date: localDate(now), greeting: greetingText(name, now) });
  };
  refresh();
  return { setName(text) { name = text; refresh(); }, stop: onVisible(refresh, doc) };
}

/** Starts each card's own watch (where it has one) so the card redraws when its data changes; the stop ends them all. */
export function watchCards(specs, refreshers) {
  const stops = [];
  specs.forEach((spec, i) => {
    if (typeof spec.watch !== "function") return;
    const stop = spec.watch(refreshers[i]);
    if (typeof stop === "function") stops.push(stop);
  });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const stop of stops) stop();
  };
}

function mount(container) {
  const now = new Date();
  let alive = true;
  const dateLine = el("span", {});
  const greetingLine = el("h1", {});
  const day = keepDayFresh({ show: ({ date, greeting }) => { dateLine.textContent = date; greetingLine.textContent = greeting; } });
  const banner = el("div", { class: "banner" }, el("div", { class: "eyebrow" }, dateLine), greetingLine);
  const grid = el("div", { class: "grid" });
  container.append(el("section", { class: "hero" }, banner), grid);

  const specs = cards();
  const empty = overviewEmpty(specs.length);
  if (empty) {
    grid.append(el("section", { class: "card wide static", "data-empty": "overview" },
      el("div", { class: "label" }, "Coming soon"), empty.map((line) => el("p", { class: "sub" }, line))));
  }
  const mounted = specs.map((spec, i) => {
    const card = mountCard(spec, grid);
    card.el.style.setProperty("--i", String(i));
    return card;
  });
  for (const card of mounted) card.refresh();
  const stopCards = watchCards(specs, mounted.map((card) => () => card.refresh()));

  const unwatch = data().watch("settings/profile", (profile) => {
    if (alive) day.setName(profile && profile.name);
  });

  Promise.all(dayParts().map((part) => Promise.resolve(part.load(now)).catch(() => null))).then((phrases) => {
    const text = summaryText(phrases);
    if (alive && text) banner.append(el("p", { class: "summary" }, text));
  });

  return () => {
    alive = false;
    day.stop();
    stopCards();
    if (typeof unwatch === "function") unwatch();
  };
}
