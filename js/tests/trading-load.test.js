// The trading data layer: reads the engine's published documents through data() only. Memory backend; never online.
import { test, eq, ok } from "./harness.js";
import { createMemoryData } from "../core/data-memory.js";
import { useData, startData } from "../core/data.js";
import { TRADING_PATHS, readTrading, readTicker, watchTrading, forwardFrom } from "../trading/load.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
function fresh() {
  const backend = createMemoryData();
  useData(backend);
  startData("u1");
  return backend;
}

test("TRADING_PATHS names the seven documents", () => {
  eq(TRADING_PATHS, {
    status: "trading/status", today: "trading/today", account: "trading/account", record: "trading/record",
    unlock: "trading/unlock", lab: "trading/lab", universe: "trading/universe",
  });
});

test("readTrading returns the document or null", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/today", { day: "2026-11-20", madeAt: "2026-11-20T11:00:00+00:00" });
  eq(await readTrading("today"), { day: "2026-11-20", madeAt: "2026-11-20T11:00:00+00:00" });
  eq(await readTrading("account"), null);
});

test("readTrading rejects after the wait", async () => {
  useData({ ...createMemoryData(), get: () => new Promise(() => {}) });
  startData("u1");
  let message = null;
  try { await readTrading("status", 5); } catch (err) { message = err.message; }
  ok(message !== null, "expected a rejection");
});

test("readTrading refuses an unknown name", async () => {
  fresh();
  let failed = false;
  try { await readTrading("../x"); } catch { failed = true; }
  ok(failed);
});

test("readTicker reads tradingTickers/{TICKER}", async () => {
  const backend = fresh();
  await backend.set("users/u1/tradingTickers/AAPL", { ticker: "AAPL", prices: [] });
  eq(await readTicker("AAPL"), { ticker: "AAPL", prices: [] });
  eq(await readTicker("MSFT"), null);
});

test("readTicker refuses odd symbols", async () => {
  const reads = [];
  useData({ ...createMemoryData(), get: async (p) => { reads.push(p); return null; } });
  startData("u1");
  for (const bad of ["../x", "aapl", "", "A/B", "TOOLONGSYMBOLS1", null, 5]) eq(await readTicker(bad), null);
  eq(reads, []);
  eq(await readTicker("BRK.B"), null);
  eq(await readTicker("^GSPC"), null);
  eq(reads.length, 2);
});

test("forwardFrom maps compact rows", () => {
  eq(forwardFrom({ rows: [{ d: "2026-11-20", p: 0.01, s: -0.002 }] }),
    { days: [{ day: "2026-11-20", pick_return: 0.01, spy_return: -0.002 }] });
});

test("forwardFrom skips bad rows and tolerates no record", () => {
  eq(forwardFrom({ rows: [{ d: "2026-11-20", p: 0.01, s: 0 }, { d: 5, p: 1, s: 1 }, null, { d: "2026-11-21", p: "x", s: 0 }] }),
    { days: [{ day: "2026-11-20", pick_return: 0.01, spy_return: 0 }] });
  eq(forwardFrom(null), { days: [] });
  eq(forwardFrom({}), { days: [] });
});

test("watchTrading delivers every report, the first included, and stops", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/today", { day: "a" });
  const seen = [];
  const stop = watchTrading(["today", "status"], (name, doc) => seen.push([name, doc]));
  await tick();
  eq(seen, [["today", { day: "a" }], ["status", null]]);
  await backend.set("users/u1/trading/today", { day: "b" });
  await tick();
  eq(seen.length, 3);
  eq(seen[2], ["today", { day: "b" }]);
  stop();
  await backend.set("users/u1/trading/today", { day: "c" });
  await tick();
  eq(seen.length, 3);
});

test("a document changed between readTrading and the first watch report is delivered", async () => {
  const backend = fresh();
  await backend.set("users/u1/trading/today", { day: "old" });
  eq(await readTrading("today"), { day: "old" });
  await backend.set("users/u1/trading/today", { day: "new" });   // lands after the read, before the watch starts
  const seen = [];
  const stop = watchTrading(["today"], (name, doc) => seen.push(doc));
  await tick();
  eq(seen[0], { day: "new" });
  stop();
});
