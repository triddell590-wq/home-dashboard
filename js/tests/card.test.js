// Browser-only: needs a document.
import { mountCard } from "../core/card.js";
import { eq, ok, test } from "./harness.js";

const box = () => document.getElementById("sandbox").appendChild(document.createElement("div"));
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

test("a failing load shows Retry, and Retry recovers", async () => {
  let fail = true;
  const card = mountCard({
    id: "t1", size: "small",
    load: async () => { if (fail) throw new Error("boom"); return { n: 3 }; },
    render: (data, el) => { el.textContent = `n is ${data.n}`; },
  }, box());
  await card.refresh();
  ok(text(card.el).includes("Couldn't load this"), text(card.el));
  const retry = card.el.querySelector("button");
  ok(retry && retry.textContent.includes("Retry"), "no Retry button");
  fail = false;
  retry.click();
  await new Promise((r) => setTimeout(r, 0));
  await card.refresh();
  ok(text(card.el).includes("n is 3"), text(card.el));
});

test("an empty message replaces the content", async () => {
  const card = mountCard({
    id: "t2", size: "small", load: async () => ({ days: [] }),
    empty: (data) => (data.days.length ? null : "No live days yet"),
    render: (data, el) => { el.textContent = "chart"; },
  }, box());
  await card.refresh();
  ok(text(card.el).includes("No live days yet") && !text(card.el).includes("chart"), text(card.el));
});

test("refresh updates in place", async () => {
  let n = 1;
  const card = mountCard({ id: "t3", size: "wide", load: async () => n, render: (d, el) => { el.textContent = `v${d}`; } }, box());
  await card.refresh();
  const first = card.el;
  n = 2;
  await card.refresh();
  eq(card.el === first, true);
  ok(text(card.el).includes("v2"), text(card.el));
  ok(card.el.classList.contains("wide"), card.el.className);
});
