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
