// The reason chips on a pick (DOM). Kept apart from text.js so that module stays pure.
import { el } from "../core/dom.js";

export function chips(reasons) {
  return el("div", { class: "chips" }, (reasons || []).map((r) => el("span", { class: "chip" }, r)));
}
