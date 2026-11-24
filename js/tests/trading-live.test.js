// mountLive (js/trading/live.js) on the memory backend with a tiny stand-in for the page. Never online.
import { test, eq, ok } from "./harness.js";
import { createMemoryData } from "../core/data-memory.js";
import { data, useData, startData } from "../core/data.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.style = {}; this.attrs = {}; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  walk() { return [this, ...this.children.flatMap((c) => (c instanceof FakeNode ? c.walk() : []))]; }
  get text() { return this.children.map((c) => (c instanceof FakeNode ? c.text : String(c.text ?? c))).join(" "); }
}

async function withPage(fn) {
  const had = { document: globalThis.document, Node: globalThis.Node };
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeNode(t), createTextNode: (text) => ({ text }), addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  try { await fn(); } finally {
    if (had.document === undefined) delete globalThis.document; else globalThis.document = had.document;
    if (had.Node === undefined) delete globalThis.Node; else globalThis.Node = had.Node;
  }
}

function backend() {
  const real = createMemoryData();
  const log = { watched: [], stopped: 0, gets: [] };
  const b = { ...real, watch(path, cb) { log.watched.push(path.replace("users/u1/", "")); const stop = real.watch(path, cb); return () => { log.stopped++; stop(); }; },
    get(path) { log.gets.push(path.replace("users/u1/", "")); return b.failGet ? Promise.reject(new Error("offline")) : real.get(path); } };
  useData(b);
  startData("u1");
  return { b, log };
}

test("mountLive re-reads on a real change only, and stops every listener and chart on teardown", async () => {
  await withPage(async () => {
    const { b, log } = backend();
    await data().set("trading/today", { day: "2026-11-20", n: 1 });
    await data().set("tradingTickers/AAPL", { ticker: "AAPL", n: 1 });
    const { mountLive } = await import("../trading/live.js");
    const body = new FakeNode("div");
    let draws = 0, disposed = 0, last = null;
    const stop = mountLive(body, { names: ["today"], optional: ["status"], ticker: "AAPL", render: (docs) => { draws++; last = docs; return () => { disposed++; }; } });
    await tick(20);
    eq(draws, 1);
    eq(last.today.n, 1);
    eq(log.watched.sort(), ["trading/status", "trading/today", "tradingTickers/AAPL"]);
    await data().set("trading/today", { day: "2026-11-20", n: 1 });   // same content: nothing to draw
    await tick(20);
    eq(draws, 1);
    await data().set("trading/today", { day: "2026-11-20", n: 2 });
    await tick(20);
    eq([draws, disposed, last.today.n], [2, 1, 2]);
    await data().set("tradingTickers/AAPL", { ticker: "AAPL", n: 2 });
    await tick(20);
    eq([draws, last.ticker.n], [3, 2]);
    stop();
    eq([disposed, log.stopped], [3, 3]);
    await data().set("trading/today", { day: "2026-11-20", n: 9 });
    await tick(20);
    eq(draws, 3, "nothing draws after stop");
  });
});

test("mountLive never subscribes to a ticker that is not a plausible symbol", async () => {
  await withPage(async () => {
    const { mountLive } = await import("../trading/live.js");
    for (const bad of ["..", "A/B", ".", "a b", "", "X".repeat(13), "../x"]) {
      const { log } = backend();
      const body = new FakeNode("div");
      let seen = "unset";
      const stop = mountLive(body, { names: [], optional: ["universe"], ticker: bad, render: (docs) => { seen = docs.ticker; } });
      await tick(20);
      eq(seen, null, `ticker ${JSON.stringify(bad)} reads as nothing`);
      ok(!log.watched.some((p) => p.startsWith("tradingTickers")), `no ticker watch for ${JSON.stringify(bad)}`);
      ok(!log.gets.some((p) => p.startsWith("tradingTickers")), `no ticker read for ${JSON.stringify(bad)}`);
      stop();
      eq(log.stopped, log.watched.length);
    }
  });
});

test("mountLive keeps every stop when a watch throws, and Retry loads again", async () => {
  await withPage(async () => {
    const { b, log } = backend();
    const { mountLive } = await import("../trading/live.js");
    b.failGet = true;
    const body = new FakeNode("div");
    let draws = 0;
    const stop = mountLive(body, { names: ["today"], render: () => { draws++; } });
    await tick(20);
    const retry = body.walk().find((n) => n.tag === "button");
    ok(retry && body.text.includes("Couldn't load"), "plain error with Retry");
    b.failGet = false;
    await data().set("trading/today", { day: "2026-11-20" });
    retry.handlers.click();
    await tick(20);
    eq(draws, 1);
    stop();
    eq(log.stopped, log.watched.length);
  });
  await withPage(async () => {
    const { b, log } = backend();
    const real = b.watch;
    let calls = 0;
    b.watch = (path, cb) => { if (++calls === 2) throw new Error("Bad path"); return real(path, cb); };
    const { mountLive } = await import("../trading/live.js");
    const stop = mountLive(new FakeNode("div"), { names: ["today"], optional: ["status"], render: () => {} });
    await tick(20);
    stop();
    eq(log.stopped, 1, "the listener that did start is stopped");
  });
});
