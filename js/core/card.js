// A glass card that loads its own data: loading, content, an empty message, or an error with Retry.
// One card failing never blanks the page.
import { el } from "./dom.js";

export function mountCard(spec, container) {
  const body = el("div", { class: "card-body" }, el("div", { class: "card-loading" }, "Loading…"));
  const card = el("section", { class: `card ${spec.size || "small"}`, "data-card": spec.id }, body);
  if (spec.className) card.classList.add(...spec.className.split(" "));
  container.append(card);
  let busy = null;

  async function refresh() {
    if (busy) return busy;
    busy = (async () => {
      try {
        const data = spec.load ? await spec.load() : null;
        const message = spec.empty ? spec.empty(data) : null;
        if (message) {
          body.replaceChildren(el("div", { class: "card-empty" }, spec.title ? el("div", { class: "label" }, spec.title) : null,
            el("p", { class: "sub" }, message)));
        } else {
          if (!body.dataset.rendered) body.replaceChildren();
          spec.render(data, body);
          body.dataset.rendered = "1";
        }
        card.classList.remove("failed");
      } catch (err) {
        console.warn(`card ${spec.id}:`, err);
        delete body.dataset.rendered;
        body.replaceChildren(el("div", { class: "card-error" },
          spec.title ? el("div", { class: "label" }, spec.title) : null,
          el("p", { class: "sub" }, "Couldn't load this"),
          el("button", { class: "btn ghost small", type: "button", onclick: () => refresh() }, "Retry")));
        card.classList.add("failed");
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  return { refresh, el: card };
}
