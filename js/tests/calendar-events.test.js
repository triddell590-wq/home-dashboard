import { test, eq, ok } from "./harness.js";
import { createMemoryData } from "../core/data-memory.js";
import {
  MSG_TITLE, MSG_DATE, MSG_TIME, MSG_REPEAT, MSG_UNTIL, MSG_KIND,
  checkEvent, eventsFrom, watchEvents, saveEvent, skipOccurrence, deleteEvent, setDone,
} from "../calendar/events.js";

const NOW = "2026-11-23T09:00:00.000Z";
const F = { title: "Dentist", kind: "appointment", date: "2026-11-24", time: "14:00", repeat: null, until: null, note: "" };
const WEEKLY = { unit: "week", every: 1, monthly: null };
const tick = () => new Promise((r) => setTimeout(r, 0));
const onFail = () => {};

test("add writes the spec's document", async () => {
  const d = createMemoryData();
  eq(saveEvent(d, F, { id: "e1", now: NOW, onFail }), { ok: true, id: "e1" });
  eq(await d.get("events/e1"), { ...F, skipped: [], done: [], createdAt: NOW, updatedAt: NOW });
});

test("add trims the title and generates an id when none is given", async () => {
  const d = createMemoryData();
  const r = saveEvent(d, { ...F, title: "  Dentist  " }, { now: NOW, onFail });
  ok(r.ok && typeof r.id === "string" && r.id.length > 0);
  eq((await d.get(`events/${r.id}`)).title, "Dentist");
});

test("edit keeps createdAt; moving the date clears skipped", async () => {
  const d = createMemoryData();
  const current = { id: "e1", ...F, repeat: WEEKLY, skipped: ["2026-12-01"], done: ["2026-11-24"], createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z" };
  saveEvent(d, { ...F, repeat: WEEKLY, title: "Dentist 2" }, { current, id: "e1", now: NOW, onFail });
  let doc = await d.get("events/e1");
  eq(doc.skipped, ["2026-12-01"]); eq(doc.done, ["2026-11-24"]); eq(doc.createdAt, "2026-11-01T08:00:00.000Z"); eq(doc.updatedAt, NOW);
  saveEvent(d, { ...F, repeat: WEEKLY, date: "2026-11-25" }, { current, id: "e1", now: NOW, onFail });
  doc = await d.get("events/e1");
  eq(doc.skipped, []); eq(doc.date, "2026-11-25"); eq(doc.createdAt, "2026-11-01T08:00:00.000Z"); eq(doc.updatedAt, NOW);
  saveEvent(d, { ...F, repeat: { unit: "week", every: 2, monthly: null } }, { current, id: "e1", now: NOW, onFail });
  eq((await d.get("events/e1")).skipped, []);
});

test("skip, tick and delete", async () => {
  const d = createMemoryData();
  saveEvent(d, { ...F, title: "Bins", kind: "job", repeat: WEEKLY }, { id: "e2", now: NOW, onFail });
  const bins = { id: "e2", ...(await d.get("events/e2")) };
  skipOccurrence(d, bins, "2026-12-01", { now: NOW, onFail });
  await tick();
  eq((await d.get("events/e2")).skipped, ["2026-12-01"]);
  skipOccurrence(d, { ...bins, skipped: ["2026-12-01"] }, "2026-12-01", { now: NOW, onFail });
  await tick();
  eq((await d.get("events/e2")).skipped, ["2026-12-01"]);
  saveEvent(d, { ...F, title: "Rent", kind: "deadline" }, { id: "e3", now: NOW, onFail });
  const rent = { id: "e3", ...(await d.get("events/e3")) };
  setDone(d, rent, "2026-11-28", true, { now: NOW, onFail });
  await tick();
  eq((await d.get("events/e3")).done, ["2026-11-28"]);
  eq((await d.get("events/e3")).updatedAt, NOW);
  setDone(d, { ...rent, done: ["2026-11-28"] }, "2026-11-28", false, { now: NOW, onFail });
  await tick();
  eq((await d.get("events/e3")).done, []);
  deleteEvent(d, bins, { onFail });
  await tick();
  eq(await d.get("events/e2"), null);
});

test("checks, in order, and nothing written", async () => {
  const d = createMemoryData();
  const cases = [[{ title: " " }, MSG_TITLE], [{ title: "x".repeat(81) }, MSG_TITLE], [{ kind: "party" }, MSG_KIND], [{ date: null }, MSG_DATE],
    [{ date: "2026-02-30" }, MSG_DATE], [{ time: "25:00" }, MSG_TIME], [{ repeat: { unit: "week", every: 0, monthly: null } }, MSG_REPEAT],
    [{ repeat: { unit: "week", every: 1, monthly: "date" } }, MSG_REPEAT], [{ until: "2026-11-01", repeat: { unit: "day", every: 1, monthly: null } }, MSG_UNTIL]];
  for (const [change, msg] of cases) eq(saveEvent(d, { ...F, ...change }, { id: "bad", now: NOW, onFail }), { error: msg });
  eq(await d.get("events/bad"), null);
  eq(checkEvent({ ...F, title: "", kind: "x", date: null }), MSG_TITLE);
  eq(checkEvent({ ...F, kind: "x", date: null }), MSG_KIND);
  eq(checkEvent({ ...F, date: null, time: "99:99" }), MSG_DATE);
  eq(checkEvent({ ...F, repeat: { unit: "week", every: 53, monthly: null } }), MSG_REPEAT);
  eq(checkEvent({ ...F, repeat: { unit: "week", every: 1.5, monthly: null } }), MSG_REPEAT);
  eq(checkEvent({ ...F, repeat: { unit: "fortnight", every: 1, monthly: null } }), MSG_REPEAT);
  eq(checkEvent({ ...F, repeat: { unit: "month", every: 1, monthly: null } }), MSG_REPEAT);
  eq(checkEvent({ ...F, repeat: { unit: "month", every: 1, monthly: "weekday", nth: 5 } }), MSG_REPEAT);
  eq(checkEvent({ ...F, until: "2026-02-30" }), MSG_UNTIL);
  eq(checkEvent({ ...F, time: null, until: "2026-11-24", repeat: { unit: "month", every: 2, monthly: "date" } }), null);
  eq(checkEvent({ ...F, repeat: { unit: "month", every: 1, monthly: "weekday", nth: -1 } }), null);
  eq(checkEvent(F), null);
});

test("eventsFrom skips documents that are not valid events", () => {
  eq(eventsFrom([{ id: "a", ...F, date: "2026-02-30" }, { id: "b", ...F, title: "" }, { id: "c", ...F, repeat: { unit: "week", every: 0 } },
    { id: "d", ...F, skipped: "x", done: ["nope", "2026-11-24"] }]).map((e) => [e.id, e.skipped, e.done]), [["d", [], ["2026-11-24"]]]);
});

test("eventsFrom normalises fields and tolerates non-documents", () => {
  const [e] = eventsFrom([null, 5, { id: "n", title: "T", kind: "job", date: "2026-11-24", skipped: ["2026-12-08", "2026-12-01", "2026-12-01", "bad"], note: 7 }]);
  eq(e.time, null); eq(e.until, null); eq(e.repeat, null); eq(e.note, ""); eq(e.skipped, ["2026-12-01", "2026-12-08"]); eq(e.done, []);
  eq(eventsFrom(null), []);
});

test("saveEvent reports saved without waiting for the server, and a rejected write plainly", async () => {
  const hang = { set: () => new Promise(() => {}) };
  eq(saveEvent(hang, F, { id: "h", now: NOW, onFail() { throw new Error("no"); } }), { ok: true, id: "h" });
  const seen = [];
  const reject = { set: () => Promise.reject(new Error("denied")), update: () => Promise.reject(new Error("denied")), remove: () => Promise.reject(new Error("denied")) };
  eq(saveEvent(reject, F, { id: "r", now: NOW, onFail: (m) => seen.push(m) }), { ok: true, id: "r" });
  skipOccurrence(reject, { id: "r", ...F, skipped: [], done: [] }, "2026-11-24", { now: NOW, onFail: (m) => seen.push(m) });
  setDone(reject, { id: "r", ...F, skipped: [], done: [] }, "2026-11-24", true, { now: NOW, onFail: (m) => seen.push(m) });
  deleteEvent(reject, { id: "r" }, { onFail: (m) => seen.push(m) });
  await tick();
  eq(seen, Array(4).fill("Couldn't save — try again"));
});

test("watchEvents fires again when another device saves", async () => {
  const d = createMemoryData();
  const seen = [];
  const stop = watchEvents(d, (events) => seen.push(events.map((e) => e.id)));
  eq(seen, [[]]);
  await d.set("events/x", { ...F, skipped: [], done: [], createdAt: NOW, updatedAt: NOW });
  await tick();
  eq(seen[seen.length - 1], ["x"]);
  stop();
  const n = seen.length;
  await d.set("events/y", { ...F });
  await tick();
  eq(seen.length, n);
});
