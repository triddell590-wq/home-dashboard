import { test, eq, ok } from "./harness.js";
import { chooseBackend, useData, data, startData } from "../core/data.js";
import { createMemoryData } from "../core/data-memory.js";

const full = { apiKey: "k" };
const tick = () => new Promise((r) => setTimeout(r, 0));
async function rejects(p) {
  try { await p; } catch (e) { return e.message; }
  throw new Error("expected a rejection");
}

test("chooseBackend picks memory or firebase", () => {
  eq(chooseBackend("?backend=memory", full), "memory");
  eq(chooseBackend("", null), "memory");
  eq(chooseBackend("", {}), "memory");
  eq(chooseBackend("", full), "firebase");
});

test("data: set then get round-trips, missing is null", async () => {
  const d = createMemoryData();
  eq(await d.get("settings/profile"), null);
  await d.set("settings/profile", { name: "Tom" });
  eq(await d.get("settings/profile"), { name: "Tom" });
});

test("data: stored values are cloned", async () => {
  const d = createMemoryData();
  const v = { a: 1 };
  await d.set("x/y", v);
  v.a = 2;
  const got = await d.get("x/y");
  got.a = 3;
  eq(await d.get("x/y"), { a: 1 });
});

test("data: update merges, missing rejects, remove clears", async () => {
  const d = createMemoryData();
  eq(await rejects(d.update("a/b", { x: 1 })), "Nothing to update");
  await d.set("a/b", { x: 1, y: 2 });
  await d.update("a/b", { y: 3, z: 4 });
  eq(await d.get("a/b"), { x: 1, y: 3, z: 4 });
  await d.remove("a/b");
  eq(await d.get("a/b"), null);
});

test("data: list returns children with ids", async () => {
  const d = createMemoryData();
  await d.set("settings/profile", { name: "Tom" });
  await d.set("other/x", { n: 1 });
  eq(await d.list("settings"), [{ id: "profile", name: "Tom" }]);
  eq(await d.list("empty"), []);
});

test("data: document watch fires now, then after set, then stops", async () => {
  const d = createMemoryData();
  const seen = [];
  const stop = d.watch("settings/profile", (v) => seen.push(v));
  eq(seen, [null]);
  await d.set("settings/profile", { name: "Tom" });
  await tick();
  eq(seen, [null, { name: "Tom" }]);
  stop();
  await d.set("settings/profile", { name: "Ann" });
  await tick();
  eq(seen.length, 2);
});

test("data: collection watch fires after set, update and remove of a child", async () => {
  const d = createMemoryData();
  const seen = [];
  d.watch("settings", (list) => seen.push(list));
  const base = seen.length;
  await d.set("settings/a", { n: 1 });
  await tick();
  await d.update("settings/a", { n: 2 });
  await tick();
  await d.remove("settings/a");
  await tick();
  eq(seen.length - base, 3);
  eq(seen[seen.length - 1], []);
  eq(seen[base + 1], [{ id: "a", n: 2 }]);
});

test("data: reset clears everything and stops watchers", async () => {
  const d = createMemoryData();
  await d.set("a/b", { x: 1 });
  let n = 0;
  d.watch("a/b", () => n++);
  const before = n;
  d.reset();
  eq(await d.get("a/b"), null);
  await d.set("a/b", { x: 2 });
  await tick();
  eq(n, before);
});

test("data: pending is false and onPending returns a stop", () => {
  const d = createMemoryData();
  eq(d.pending(), false);
  const stop = d.onPending(() => {});
  ok(typeof stop === "function");
});

test("startData scopes paths to users/{uid}; data() throws before", async () => {
  const mem = createMemoryData();
  useData(mem);
  let msg = "";
  try { data(); } catch (e) { msg = e.message; }
  eq(msg, "Not signed in");
  startData("u1");
  await data().set("settings/profile", { name: "Tom" });
  eq(await mem.get("users/u1/settings/profile"), { name: "Tom" });
  eq(await data().list("settings"), [{ id: "profile", name: "Tom" }]);
  const seen = [];
  const stop = data().watch("settings/profile", (v) => seen.push(v));
  eq(seen, [{ name: "Tom" }]);
  stop();
});
