// Tests for index.html: its small inline scripts are run here with fakes. Node only.
import fs from "node:fs";
import vm from "node:vm";
import { eq, ok, test } from "./harness.js";

const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const inline = (id) => {
  const m = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html);
  if (!m) throw new Error(`no inline script #${id} in index.html`);
  return m[1];
};

// ---- first paint ----
function runOpening({ stillOpening }) {
  const nodes = { opening: { hidden: false }, "opening-slow": { hidden: true } };
  const timers = [];
  const document = { getElementById: (id) => (stillOpening() ? nodes[id] : null) };
  vm.runInNewContext(inline("opening-watch"), { document, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
  return { nodes, timers };
}

test("index.html shows Opening… in the page before any script has run", () => {
  const page = /<main id="page"[^>]*>([\s\S]*?)<\/main>/.exec(html)[1];
  ok(/<p[^>]*id="opening"[^>]*>Opening…<\/p>/.test(page));
  ok(/id="opening-slow"[^>]*hidden/.test(page) && page.includes("Still connecting — check your signal"));
  ok(/<button[^>]*>Reload<\/button>/.test(page));
});

test("after 5 seconds without an answer the page says it is still connecting", () => {
  const { nodes, timers } = runOpening({ stillOpening: () => true });
  eq(timers.map((t) => t.ms), [5000]);
  eq(nodes["opening-slow"].hidden, true);
  timers[0].fn();
  eq([nodes.opening.hidden, nodes["opening-slow"].hidden], [true, false]);
});

test("the still-connecting message does nothing once the page has been replaced", () => {
  const { nodes, timers } = runOpening({ stillOpening: () => false });
  timers[0].fn();
  eq(nodes["opening-slow"].hidden, true);
});

// ---- head ----
test("the iPhone status bar is readable in both themes", () => {
  ok(/name="apple-mobile-web-app-status-bar-style" content="default"/.test(html));
});

// ---- the theme before the first paint ----
function runTheme(entries, over = {}) {
  const m = new Map(Object.entries(entries));
  const localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, ...over };
  const meta = { content: "#05070c" };
  const document = { documentElement: { dataset: { theme: "midnight" } }, querySelector: () => meta };
  vm.runInNewContext(inline("early-theme"), { localStorage, document });
  return { theme: document.documentElement.dataset.theme, colour: meta.content, stored: Object.fromEntries(m) };
}

test("the early theme script reads home-theme", () => {
  eq(runTheme({ "home-theme": '"daylight"' }), { theme: "daylight", colour: "#e9eef7", stored: { "home-theme": '"daylight"' } });
  eq(runTheme({}).theme, "midnight");
  eq(runTheme({}, { getItem: () => { throw new Error("blocked"); } }).theme, "midnight");
});

test("the early theme script neither reads nor changes another app's unprefixed theme", () => {
  eq(runTheme({ theme: '"daylight"' }), { theme: "midnight", colour: "#05070c", stored: { theme: '"daylight"' } });
  eq(runTheme({ theme: '"daylight"', "home-theme": '"midnight"' }), { theme: "midnight", colour: "#05070c", stored: { theme: '"daylight"', "home-theme": '"midnight"' } });
});
