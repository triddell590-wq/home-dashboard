// Midnight (default) or Daylight, remembered between visits.
import * as store from "./store.js";

const THEMES = ["midnight", "daylight"];

export function currentTheme() {
  const saved = store.get("theme");
  return THEMES.includes(saved) ? saved : "midnight";
}

export function setTheme(name) {
  const theme = THEMES.includes(name) ? name : "midnight";
  document.documentElement.dataset.theme = theme;
  store.set("theme", theme);
  window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

export function toggleTheme() {
  setTheme(currentTheme() === "midnight" ? "daylight" : "midnight");
}

export function applySavedTheme() {
  document.documentElement.dataset.theme = currentTheme();
}
