// Shows trading documents in a page body: Loading…, then the drawing, or a plain error with Retry. It redraws only
// when what was read really changed (or the day moved on), so a metadata-only report from Firestore draws nothing.
// `render(docs, body)` may return a function that undoes what it set up (a chart); it runs before the next drawing.
import { data } from "../core/data.js";
import { el } from "../core/dom.js";
import { onVisible } from "../core/visible.js";
import { readTicker, readTrading, watchTrading } from "./load.js";
import { nyDay } from "./market.js";

export const LOAD_FAILED = "Couldn't load this. Check your connection and try again.";
const text = (v) => JSON.stringify(v ?? null);

/** Returns stop(). `names` are required documents, `optional` ones read as null when they cannot be read, and
 * `ticker` adds that ticker's document as docs.ticker. `extraKey(docs)` adds anything else the drawing depends on. */
export function mountLive(body, { names, optional = [], ticker = null, render, extraKey = () => "" }) {
  let alive = true;
  let shownKey = null;
  let dispose = null;
  let stopWatch = () => {};
  let stopVisible = () => {};
  let inflight = null;
  let again = false;      // a change arrived while a read was running, so that read may be out of date
  const seen = new Map();

  const undo = () => { if (dispose) { try { dispose(); } catch { /* the chart is already gone */ } dispose = null; } };

  async function read() {
    const docs = {};
    for (const name of names) { docs[name] = await readTrading(name); seen.set(name, text(docs[name])); }
    for (const name of optional) {
      try { docs[name] = await readTrading(name); } catch { docs[name] = null; }
      seen.set(name, text(docs[name]));
    }
    if (ticker) { docs.ticker = await readTicker(ticker); seen.set("ticker", text(docs.ticker)); }
    return docs;
  }

  function load() {
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      try {
        const docs = await read();
        if (!alive) return;
        const key = `${text(docs)}|${nyDay(new Date())}|${extraKey(docs)}`;
        if (key === shownKey) return;
        undo();
        body.replaceChildren();
        dispose = render(docs, body) || null;
        shownKey = key;
      } catch (err) {
        if (!alive) return;
        console.warn("trading view:", err);
        if (shownKey === null) {
          body.replaceChildren(el("div", { class: "card wide static card-error", role: "alert" }, el("p", { class: "sub" }, LOAD_FAILED),
            el("button", { class: "btn ghost small", type: "button", onclick: () => { body.replaceChildren(el("p", { class: "sub", role: "status" }, "Loading…")); load(); } }, "Retry")));
        }
      } finally {
        inflight = null;
        if (again && alive) { again = false; load(); }
      }
    })();
    return inflight;
  }

  body.replaceChildren(el("p", { class: "sub", role: "status" }, "Loading…"));
  load().then(() => {
    if (!alive) return;
    const all = [...names, ...optional];
    const changed = (name, doc) => { const t = text(doc); if (seen.get(name) === t) return; seen.set(name, t); load(); };
    try {
      const stops = [watchTrading(all, changed)];
      if (ticker) stops.push(data().watch(`tradingTickers/${ticker}`, (doc) => changed("ticker", doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null)));
      stopWatch = () => { for (const s of stops) if (typeof s === "function") s(); };
    } catch { /* no live updates; the page still shows what was read */ }
    stopVisible = typeof document === "undefined" ? () => {} : onVisible(load);   // an app left open overnight moves on to the new day
  });

  return () => { alive = false; stopWatch(); stopVisible(); undo(); };
}
