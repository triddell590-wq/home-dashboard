// The Settings card for the trading engine: picks per day, the watchlist and the SEC contact. It writes only
// settings/trading (the engine reads it on its next run on GitHub); the published trading documents are never written.
import { data } from "../core/data.js";
import { el, toast } from "../core/dom.js";

const PATH = "settings/trading";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const TRADING_NOTE = "Used by the engine's next run on GitHub.";

/** Validates like the engine's save_settings (the same messages). Returns { value } or { error }. */
export function checkTradingSettings({ topN, watchlist, secContact }) {
  const contact = String(secContact ?? "").trim() || null;
  if (contact !== null && !EMAIL.test(contact)) return { error: "The SEC contact must be an email address" };
  const whole = String(topN ?? "").trim();
  if (!/^[+-]?\d+$/.test(whole)) return { error: "top_n must be a whole number" };
  const n = Number(whole);
  if (n < 1 || n > 10) return { error: "top_n must be between 1 and 10" };
  const list = String(watchlist ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  return { value: { topN: n, watchlist: list, secContact: contact } };
}

/** Validates, then shows "Saved" at once (an offline write only completes when the server answers) and reports only a rejected write. */
export function saveTradingSettings(set, current, fields, { saved, failed }) {
  const result = checkTradingSettings(fields);
  if (result.error) { failed(result.error); return false; }
  Promise.resolve().then(() => set(PATH, { ...current, ...result.value }))
    .catch(() => failed("Couldn't save — try again"));
  saved(result.value);
  return true;
}

export function mountTradingSettings(grid, isAlive = () => true) {
  let current = {};
  let touched = false;
  const topN = el("input", { type: "number", inputmode: "numeric", min: "1", max: "10", step: "1", "aria-label": "Picks per day", autocomplete: "off" });
  const watch = el("input", { type: "text", placeholder: "e.g. AAPL, MSFT", "aria-label": "Watchlist, tickers separated by commas", autocomplete: "off", autocapitalize: "characters" });
  const contact = el("input", { type: "email", inputmode: "email", placeholder: "you@example.com", "aria-label": "SEC contact email", autocomplete: "email" });
  const status = el("p", { class: "sub down", role: "alert" });
  for (const box of [topN, watch, contact]) box.addEventListener("input", () => { touched = true; });
  const fields = () => ({ topN: topN.value, watchlist: watch.value, secContact: contact.value });
  const form = el("form", { class: "card half static", "data-card": "trading-settings", novalidate: true },
    el("div", { class: "label" }, "Trading"),
    el("p", { class: "sub" }, TRADING_NOTE),
    el("div", { class: "form-grid", style: { gridTemplateColumns: "1fr", marginTop: "12px" } },
      el("label", {}, "Picks per day (1 to 10)", topN), el("label", {}, "Watchlist", watch), el("label", {}, "SEC contact email (optional)", contact)),
    status, el("div", { class: "actions" }, el("button", { class: "btn primary", type: "submit" }, "Save")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    status.textContent = "";
    saveTradingSettings((path, value) => data().set(path, value), current, fields(), {
      saved: (value) => {
        topN.value = String(value.topN); watch.value = value.watchlist.join(", "); contact.value = value.secContact || "";
        touched = true;
        toast("Saved");
      },
      failed: (message) => { if (isAlive()) status.textContent = message; },
    });
  });
  grid.append(form);
  // Watching fills the fields from the local copy, supplies the merge base, and makes unsynced writes count as pending.
  const stop = data().watch(PATH, (doc) => {
    if (!isAlive()) return;
    current = doc || {};
    if (touched) return;
    topN.value = Number.isFinite(current.topN) ? String(current.topN) : "5";
    watch.value = Array.isArray(current.watchlist) ? current.watchlist.join(", ") : "";
    contact.value = typeof current.secContact === "string" ? current.secContact : "";
  });
  return () => { if (typeof stop === "function") stop(); };
}
