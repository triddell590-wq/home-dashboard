import { parseHash, start } from "../core/router.js";
import * as store from "../core/store.js";
import { eq, test } from "./harness.js";

test("router: unknown views fall back to overview until a tab registers them", () => {
  eq(parseHash("#/picks").view, "overview");
});

// start() is what teaches the router its tab ids. It touches window, location and history, so
// under Node (no browser) those are stubbed; in the browser the real ones are used and the saved
// route is put back afterwards.
test("start registers each tab id as a known view", async () => {
  const saved = store.get("route");
  const stubbed = typeof window === "undefined";
  if (stubbed) {
    globalThis.window = { addEventListener() {}, scrollTo() {} };
    globalThis.location = { hash: "#/overview" };
    globalThis.history = { replaceState() {} };
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.requestAnimationFrame = (fn) => fn();
  }
  const tabs = ["overview", "picks", "trade", "research"].map((id) => ({ id, mount() {} }));
  const container = stubbed ? { childElementCount: 0, classList: { add() {}, remove() {} }, replaceChildren() {} } : document.createElement("div");
  try {
    await start(container, tabs);
  } finally {
    if (stubbed) for (const k of ["window", "location", "history", "matchMedia", "requestAnimationFrame"]) delete globalThis[k];
    else store.set("route", saved);
  }
  eq(parseHash("#/picks").view, "picks");
});

test("parseHash reads view, argument and query", () => {
  eq(parseHash("#/research/NVDA?new=1"), { view: "research", arg: "NVDA", query: { new: "1" } });
  eq(parseHash("#/trade?new=AAPL"), { view: "trade", arg: null, query: { new: "AAPL" } });
  eq(parseHash("#/picks"), { view: "picks", arg: null, query: {} });
});

test("unknown or empty routes go to the Overview", () => {
  eq(parseHash("#/nope"), { view: "overview", arg: null, query: {} });
  eq(parseHash(""), { view: "overview", arg: null, query: {} });
  eq(parseHash("#/"), { view: "overview", arg: null, query: {} });
});

test("parseHash decodes the argument", () => {
  eq(parseHash("#/research/BRK.B").arg, "BRK.B");
  eq(parseHash("#/research/A%20B").arg, "A B");
});

test("the remembered route drops one-off actions like ?new=", async () => {
  const { rememberedRoute } = await import("../core/router.js");
  eq(rememberedRoute("#/trade?new=NVDA"), "#/trade");
  eq(rememberedRoute("#/research/NVDA"), "#/research/NVDA");
  eq(rememberedRoute(""), "#/overview");
});
