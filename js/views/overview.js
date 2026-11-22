// The home page: the greeting and "Your day" line, then every registered card. Until a part registers cards
// it says plainly what is coming.
import { mountCard } from "../core/card.js";
import { data } from "../core/data.js";
import { el, greeting, localDate } from "../core/dom.js";
import { cards, dayParts } from "../core/registry.js";
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

function mount(container) {
  const now = new Date();
  let alive = true;
  const greetingLine = el("h1", {}, greetingText("", now));
  const banner = el("div", { class: "banner" },
    el("div", { class: "eyebrow" }, el("span", {}, localDate(now))), greetingLine);
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

  const unwatch = data().watch("settings/profile", (profile) => {
    if (alive) greetingLine.textContent = greetingText(profile && profile.name, new Date());
  });

  Promise.all(dayParts().map((part) => Promise.resolve(part.load(now)).catch(() => null))).then((phrases) => {
    const text = summaryText(phrases);
    if (alive && text) banner.append(el("p", { class: "summary" }, text));
  });

  return () => {
    alive = false;
    if (typeof unwatch === "function") unwatch();
  };
}
