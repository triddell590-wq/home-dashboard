// Settings: your name for the greeting, the theme, the signed-in account with Sign out, and the version.
import { checkForUpdate } from "../core/update.js";
import { auth } from "../core/auth.js";
import { data } from "../core/data.js";
import { el, toast } from "../core/dom.js";
import { currentTheme, setTheme } from "../core/theme.js";

export const tab = { id: "settings", label: "Settings", order: 90, foot: true, mount };

export const VERSION = "0.1.0";
const NAME_MAX = 40;

/** Trim and cut to 40 characters. Markup is kept as plain text; the views only ever show it with textContent. */
export function cleanName(text) {
  return String(text ?? "").trim().slice(0, NAME_MAX);
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
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    nameError.textContent = "";
    try {
      const profile = (await data().get("settings/profile")) || {};
      const clean = cleanName(name.value);
      await data().set("settings/profile", { ...profile, name: clean });
      name.value = clean;
      toast("Saved");
    } catch (err) {
      nameError.textContent = err.message;
    }
  });
  grid.append(form);
  data().get("settings/profile").then((p) => { if (alive && p && !name.value) name.value = cleanName(p.name); }).catch(() => {});

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
  const signOut = async () => {
    if (!window.confirm("Sign out of this device?")) return;
    try {
      await data().reset();
      await auth().signOut();
    } catch (err) {
      console.error(err);
    } finally {
      location.reload();
    }
  };
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
      const found = await checkForUpdate();
      if (alive) updateStatus.textContent = found ? "New version ready" : "You're up to date";
    } catch {
      if (alive) updateStatus.textContent = "Couldn't check — try again when you're online";
    } finally {
      check.disabled = false;
    }
  });
  grid.append(el("section", { class: "card half static" }, el("div", { class: "label" }, "About"),
    el("p", { class: "sub" }, `Version ${VERSION}`), el("div", { class: "actions" }, check), updateStatus));

  return () => { alive = false; window.removeEventListener("themechange", onTheme); };
}
