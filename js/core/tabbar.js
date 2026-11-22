// The phone tab bar: up to five slots along the bottom. With more than five tabs the last slot is "More",
// which opens a sheet listing the rest. splitTabs and moreIsActive are pure; buildTabbar makes the elements.
import { el } from "./dom.js";

export function splitTabs(tabs, max = 5) {
  if (tabs.length <= max) return { bar: tabs, more: [] };
  return { bar: tabs.slice(0, max - 1), more: tabs.slice(max - 1) };
}

export function moreIsActive(more, activeId) {
  return more.some((tab) => tab.id === activeId);
}

/** Fills `nav` with the tab links and, when needed, a More button and its sheet. `icon(name)` returns an svg.
 *  Returns markActive(id). */
export function buildTabbar(nav, tabs, icon) {
  const { bar, more } = splitTabs(tabs);
  const links = new Map();
  const link = (tab) => {
    const a = el("a", { href: `#/${tab.id}`, "data-tab": tab.id }, icon(tab.icon || tab.id), el("span", {}, tab.label));
    links.set(tab.id, a);
    return a;
  };
  nav.replaceChildren(...bar.map(link));
  let moreButton = null;
  if (more.length) {
    const sheet = el("div", { class: "sheet", id: "more-sheet", hidden: true, role: "menu" }, more.map(link));
    const backdrop = el("div", { class: "sheet-backdrop", hidden: true });
    moreButton = el("button", { type: "button", "aria-expanded": "false", "aria-controls": "more-sheet" },
      icon("more"), el("span", {}, "More"));
    const setOpen = (open) => {
      sheet.hidden = !open;
      backdrop.hidden = !open;
      moreButton.setAttribute("aria-expanded", String(open));
    };
    moreButton.addEventListener("click", () => setOpen(sheet.hidden));
    backdrop.addEventListener("click", () => setOpen(false));
    sheet.addEventListener("click", () => setOpen(false));
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    window.addEventListener("hashchange", () => setOpen(false));
    nav.append(moreButton, backdrop, sheet);
  }
  return (activeId) => {
    for (const [id, a] of links) {
      a.classList.toggle("active", id === activeId);
      if (id === activeId) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    if (moreButton) moreButton.classList.toggle("active", moreIsActive(more, activeId));
  };
}
