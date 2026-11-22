// Browser-only: needs a document.
import { currentTheme, setTheme, toggleTheme } from "../core/theme.js";
import { eq, ok, test } from "./harness.js";

test("theme defaults to midnight and survives broken storage", () => {
  const original = Storage.prototype.getItem;
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.getItem = () => { throw new Error("blocked"); };
  Storage.prototype.setItem = () => { throw new Error("blocked"); };
  try {
    eq(currentTheme(), "midnight");
    setTheme("daylight");
    eq(document.documentElement.dataset.theme, "daylight");
  } finally {
    Storage.prototype.getItem = original;
    Storage.prototype.setItem = originalSet;
  }
});

test("toggle flips the theme, remembers it and announces it", () => {
  let heard = null;
  const listen = (e) => { heard = e.detail; };
  window.addEventListener("themechange", listen);
  setTheme("midnight");
  toggleTheme();
  window.removeEventListener("themechange", listen);
  eq(currentTheme(), "daylight");
  eq(heard, "daylight");
  ok(document.documentElement.dataset.theme === "daylight");
  setTheme("midnight");
});
