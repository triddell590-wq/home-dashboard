// Settings: your name for the greeting, the theme, the signed-in account with Sign out, and the version.
import { checkForUpdate, currentRegistration } from "../core/update.js";
import { VERSION } from "../version.js";
import { auth } from "../core/auth.js";
import { data } from "../core/data.js";
import { depsFor, signOutFlow } from "../core/signout.js";
import { el, toast } from "../core/dom.js";
import { settingsCards } from "../core/registry.js";
import { currentTheme, setTheme } from "../core/theme.js";

export const tab = { id: "settings", label: "Settings", order: 90, foot: true, mount };

const NAME_MAX = 40;

/** Trim and cut to 40 characters. Markup is kept as plain text; the views only ever show it with textContent. */
export function cleanName(text) {
  return String(text ?? "").trim().slice(0, NAME_MAX);
}

/** Show "Saved" at once (an offline write only completes when the server answers) and report only a rejected write. */
export function saveName(set, profile, text, { saved, failed }) {
  const clean = cleanName(text);
  Promise.resolve().then(() => set("settings/profile", { ...profile, name: clean }))
    .catch(() => failed("Couldn't save — try again"));
  saved(clean);
}

function mount(container) {
  let alive = true;
  container.append(el("h1", { class: "page-title" }, "Settings"));
  const grid = el("div", { class: "grid" });
  container.append(grid);

  // name
  const name = el("input", { maxlength: String(NAME_MAX), placeholder: "e.g. Tom", autocomplete: "given-name" });
  const nameError = el("p", { class: "sub down", role: "alert" });
  const form = el("form", { class: "card half static", novalidate: true },
    el("div", { class: "label" }, "You"),
    el("div", { class: "form-grid", style: { gridTemplateColumns: "1fr", marginTop: "12px" } },
      el("label", {}, "Your name, for the greeting (optional)", name)),
    nameError, el("div", { class: "actions" }, el("button", { class: "btn primary", type: "submit" }, "Save")));
  let profile = {};
  let touched = false;
  name.addEventListener("input", () => { touched = true; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    nameError.textContent = "";
    saveName((path, value) => data().set(path, value), profile, name.value, {
      saved: (clean) => { name.value = clean; touched = true; toast("Saved"); },
      failed: (message) => { if (alive) nameError.textContent = message; },
    });
  });
  grid.append(form);
  const stopCards = settingsCards().map((spec) => spec.mount(grid, () => alive));
  // Watching (not get) fills the field from the local copy, supplies the merge base, and makes unsynced writes count as pending.
  const unwatch = data().watch("settings/profile", (p) => {
    profile = p || {};
    if (alive && !touched) name.value = cleanName(profile.name);
  });

  // theme
  const choices = ["midnight", "daylight"].map((value) => el("label", { class: "choice" },
    el("input", { type: "radio", name: "theme", value, checked: currentTheme() === value, onchange: () => setTheme(value) }),
    value === "midnight" ? "Midnight" : "Daylight"));
  const onTheme = (e) => { for (const l of choices) { const i = l.querySelector("input"); i.checked = i.value === e.detail; } };
  window.addEventListener("themechange", onTheme);
  grid.append(el("section", { class: "card half static" }, el("div", { class: "label" }, "Look"),
    el("p", { class: "sub" }, "Remembered on this device."), el("div", { class: "actions" }, choices)));

  // account
  const user = auth().current();
  const signOut = () => signOutFlow(depsFor({ data, auth }));
  grid.append(el("section", { class: "card half static" }, el("div", { class: "label" }, "Account"),
    el("p", { class: "sub" }, user ? `Signed in as ${user.email}` : "Signed in"),
    el("div", { class: "actions" }, el("button", { class: "btn danger", type: "button", onclick: signOut }, "Sign out"))));

  // version
  const updateStatus = el("p", { class: "sub", role: "status" });
  const check = el("button", { class: "btn", type: "button" }, "Check for update");
  check.addEventListener("click", async () => {
    check.disabled = true;
    updateStatus.textContent = "";
    try {
      const registration = await currentRegistration();
      const found = registration ? await checkForUpdate(registration) : null;
      if (alive) updateStatus.textContent = found === null ? "Updates need the installed app" : found ? "New version ready" : "You're up to date";
    } catch {
      if (alive) updateStatus.textContent = "Couldn't check — try again";
    } finally {
      check.disabled = false;
    }
  });
  grid.append(el("section", { class: "card half static" }, el("div", { class: "label" }, "About"),
    el("p", { class: "sub" }, `Version ${VERSION}`), el("div", { class: "actions" }, check), updateStatus));

  return () => { alive = false; for (const stop of stopCards) if (typeof stop === "function") stop(); if (typeof unwatch === "function") unwatch(); window.removeEventListener("themechange", onTheme); };
}
