// Midnight (default) or Daylight, remembered between visits.
import * as store from "./store.js";

const THEMES = ["midnight", "daylight"];

// The browser's address-bar / status-bar colour follows the app's own theme, which can differ from the system's.
const THEME_COLOURS = { midnight: "#05070c", daylight: "#e9eef7" };

function paint(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOURS[theme];
}

export function currentTheme() {
  const saved = store.get("theme");
  return THEMES.includes(saved) ? saved : "midnight";
}

export function setTheme(name) {
  const theme = THEMES.includes(name) ? name : "midnight";
  paint(theme);
  store.set("theme", theme);
  window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

export function toggleTheme() {
  setTheme(currentTheme() === "midnight" ? "daylight" : "midnight");
}

export function applySavedTheme() {
  paint(currentTheme());
}
