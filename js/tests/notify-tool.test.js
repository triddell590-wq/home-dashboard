// Node only. The morning sender with an injected clock, a fake Firestore and a fake FCM. Nothing goes online.
import { test, eq, ok } from "./harness.js";
import { londonDay } from "../core/dom.js";
import { fcmMessage, runNotify, main, DEAD } from "../../tools/notify.mjs";

const UID = "OWNER";
const P = (rest) => `users/${UID}/${rest}`;

function fakeDb(docs = {}) {
  const writes = [], deletes = [], log = [];
  return {
    writes, deletes, docs, log,
    doc: (p) => ({
      create: async (v) => {
        if (p in docs) throw Object.assign(new Error("exists"), { code: 6 });
        log.push(["create", p]); docs[p] = v;
      },
      get: async () => ({ exists: p in docs, data: () => docs[p] }),
      set: async (v) => { writes.push([p, v]); log.push(["set", p]); docs[p] = v; },
      delete: async () => { deletes.push(p); log.push(["delete", p]); delete docs[p]; },
    }),
    collection: (p) => ({
      get: async () => ({ docs: Object.keys(docs).filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes("/"))
        .map((k) => ({ id: k.slice(p.length + 1), data: () => docs[k] })) }),
    }),
  };
}
const seed = (now, extra = {}) => ({
  [P("events/e1")]: { title: "Dentist", kind: "appointment", date: londonDay(now), time: "14:00", repeat: null, until: null, skipped: [], done: [], note: "", createdAt: "x", updatedAt: "x" },
  [P("devices/a")]: { token: "ta" },
  [P("devices/b")]: { token: "tb" },
  ...extra,
});
function fakeSend(results = {}) {
  const send = async (m) => { send.calls.push(m); return results[m.token] ?? { ok: true }; };
  send.calls = [];
  return send;
}
const run = (db, send, now, extra = {}) => runNotify({ firestore: db, send, uid: UID, now, log: () => {}, refresh: async () => {}, ...extra });

test("the 07:00–21:00 London window, in winter and summer and on clock-change days", async () => {
  const cases = [["2026-11-23T06:59:00Z", "early"], ["2026-11-23T07:00:00Z", "sent"], ["2026-11-23T20:59:00Z", "sent"], ["2026-11-23T21:00:00Z", "late"],
    ["2026-07-01T05:59:00Z", "early"], ["2026-07-01T06:00:00Z", "sent"], ["2026-06-30T23:30:00Z", "early"],
    ["2027-03-28T06:00:00Z", "sent"], ["2026-10-25T06:30:00Z", "early"], ["2026-10-25T07:00:00Z", "sent"]];
  for (const [iso, status] of cases) {
    const now = new Date(iso);
    eq([iso, (await run(fakeDb(seed(now)), fakeSend(), now)).status], [iso, status]);
  }
});

test("warnings are refreshed on every run, even outside the window", async () => {
  let n = 0;
  const early = new Date("2026-11-23T05:00:00Z");
  eq((await run(fakeDb(seed(early)), fakeSend(), early, { refresh: async () => { n++; } })).status, "early");
  eq(n, 1);
  const now = new Date("2026-11-23T07:00:00Z");
  const logs = [];
  const res = await run(fakeDb(seed(now)), fakeSend(), now, { refresh: async () => { throw new Error("secret-ish stack"); }, log: (m) => logs.push(m) });
  eq(res.status, "sent");
  ok(logs.includes("::warning::Met Office warnings couldn't be refreshed"));
  ok(!logs.join("").includes("secret-ish"), "no raw error text");
});

test("one notification per device, then the day is recorded", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now)), send = fakeSend();
  const res = await run(db, send, now);
  eq(res.status, "sent");
  eq(send.calls, [fcmMessage("ta", { title: "Today", body: "Dentist 2pm" }), fcmMessage("tb", { title: "Today", body: "Dentist 2pm" })]);
  eq(db.docs[P("reminders/2026-11-23")], { sentAt: "2026-11-23T07:00:00.000Z", items: ["Dentist 2pm"], count: 1, devices: 2, errors: [] });
});

test("devices without a string token are ignored", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now, { [P("devices/c")]: { token: 5 }, [P("devices/d")]: {} })), send = fakeSend();
  await run(db, send, now);
  eq(send.calls.length, 2);
});

test("a second run on the same day sends nothing", async () => {
  const db = fakeDb(seed(new Date("2026-11-23T07:00:00Z"))), send = fakeSend();
  eq((await run(db, send, new Date("2026-11-23T07:00:00Z"))).status, "sent");
  eq((await run(db, send, new Date("2026-11-23T08:00:00Z"))).status, "done-already");
  eq(send.calls.length, 2);
});

test("an empty day records count 0 and sends nothing", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb({ [P("devices/a")]: { token: "ta" } }), send = fakeSend();
  const res = await run(db, send, now);
  eq(res.status, "nothing");
  eq(send.calls.length, 0);
  eq(db.docs[P("reminders/2026-11-23")], { sentAt: "2026-11-23T07:00:00.000Z", items: [], count: 0, devices: 0, errors: [] });
});

test("dead tokens are removed and the rest still get it", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now)), send = fakeSend({ ta: { ok: false, error: "messaging/registration-token-not-registered", dead: true } });
  const res = await run(db, send, now);
  eq(res.status, "sent");
  eq(db.deletes, [P("devices/a")]);
  eq(res.removed, ["a"]);
  eq(db.docs[P("reminders/2026-11-23")].devices, 1);
});

test("a run where every send fails leaves the day open for the next hour", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const bad = { ok: false, error: "messaging/internal-error", dead: false };
  const db = fakeDb(seed(now)), send = fakeSend({ ta: bad, tb: bad });
  const res = await run(db, send, now);
  eq([res.status, res.exitCode], ["failed", 1]);
  eq(db.writes.length, 0);
  eq(db.deletes, [P("reminders/2026-11-23")]);
  ok(!(P("reminders/2026-11-23") in db.docs) && P("devices/a") in db.docs && P("devices/b") in db.docs);
});

test("a partial failure still records the day, with the error", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now)), send = fakeSend({ tb: { ok: false, error: "messaging/internal-error", dead: false } });
  const res = await run(db, send, now);
  eq([res.status, res.exitCode], ["sent", 0]);
  eq(db.docs[P("reminders/2026-11-23")].errors, [{ device: "b", error: "messaging/internal-error" }]);
});

test("dry run prints the digest and writes nothing", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now)), send = fakeSend(), logs = [];
  const res = await run(db, send, now, { dryRun: true, log: (m) => logs.push(m) });
  eq(res.status, "dry-run");
  const text = logs.join("\n");
  ok(text.includes("Today") && text.includes("Dentist 2pm"));
  eq([db.writes.length, db.deletes.length, send.calls.length], [0, 0, 0]);
});

test("--any-time skips the window and the once-a-day check in a dry run only", async () => {
  const now = new Date("2026-11-23T03:00:00Z");
  const db = fakeDb(seed(now, { [P("reminders/2026-11-23")]: { count: 1 } }));
  eq((await run(db, fakeSend(), now, { dryRun: true, argv: ["--dry-run", "--any-time"] })).status, "dry-run");
  eq((await run(db, fakeSend(), now, { argv: ["--any-time"] })).status, "early");
});

test("main exits 0 with a notice without the secret or the owner ID", async () => {
  const rules = (uid) => `function ownerUid() { return "${uid}"; }`;
  let connected = 0;
  const connect = () => { connected++; throw new Error("must not connect"); };
  for (const env of [{}, { FIREBASE_SERVICE_ACCOUNT: "  " }]) {
    const logs = [];
    eq(await main({ env, argv: [], rulesText: rules("abc"), log: (m) => logs.push(m), connect }), 0);
    eq(logs, ["::notice::FIREBASE_SERVICE_ACCOUNT is not set — reminders were not sent"]);
  }
  const logs = [];
  eq(await main({ env: { FIREBASE_SERVICE_ACCOUNT: "{}" }, argv: [], rulesText: rules("REPLACE_WITH_YOUR_UID"), log: (m) => logs.push(m), connect }), 0);
  eq(logs, ["::notice::firestore.rules still has the placeholder owner ID"]);
  eq(connected, 0);
});

test("main reports bad JSON and a failing connection without showing the secret", async () => {
  const rulesText = 'function ownerUid() { return "abc"; }';
  let logs = [];
  eq(await main({ env: { FIREBASE_SERVICE_ACCOUNT: "{not json SECRETVALUE" }, argv: [], rulesText, log: (m) => logs.push(m), connect: () => { throw new Error("no"); } }), 1);
  eq(logs, ["::error::FIREBASE_SERVICE_ACCOUNT is not valid JSON (contents not shown)"]);
  logs = [];
  eq(await main({ env: { FIREBASE_SERVICE_ACCOUNT: '{"a":1}' }, argv: [], rulesText, log: (m) => logs.push(m), connect: () => { throw new Error("SECRETVALUE stack"); } }), 1);
  eq(logs.length, 1);
  ok(logs[0].startsWith("::error::") && !logs[0].includes("SECRETVALUE"));
});

test("main runs the sender end to end with fakes and unexpected errors print a fixed line", async () => {
  const rulesText = 'function ownerUid() { return "abc"; }';
  const logs = [];
  const connect = () => ({ firestore: { doc: () => { throw new Error("SECRETVALUE boom"); }, collection: () => { throw new Error("x"); } }, send: async () => ({ ok: true }) });
  const code = await main({ env: { FIREBASE_SERVICE_ACCOUNT: '{"a":1}' }, argv: ["--dry-run"], rulesText, log: (m) => logs.push(m), connect, now: new Date("2026-11-23T07:00:00Z") });
  eq(code, 1);
  ok(logs.every((l) => !l.includes("SECRETVALUE")));
  ok(logs.some((l) => l.startsWith("::error::")));
});

test("fcmMessage is data-only and opens the Calendar", () => {
  eq(fcmMessage("t", { title: "Today", body: "A" }), { token: "t", data: { title: "Today", body: "A", url: "#/calendar", tag: "home-day" }, webpush: { headers: { Urgency: "high", TTL: "43200" } } });
  ok(!("notification" in fcmMessage("t", { title: "a", body: "b" })));
});

test("DEAD matches the FCM codes for a token that will never work again", () => {
  for (const c of ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]) ok(DEAD.test(c), c);
  for (const c of ["messaging/invalid-argument", "messaging/internal-error", "messaging/server-unavailable", "messaging/third-party-auth-error"]) ok(!DEAD.test(c), c);
});

test("a bad-message error (invalid-argument) on every device deletes nothing and fails the run", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const bad = { ok: false, error: "messaging/invalid-argument", dead: false };
  const db = fakeDb(seed(now));
  const res = await run(db, fakeSend({ ta: bad, tb: bad }), now);
  eq([res.status, res.exitCode], ["failed", 1]);
  ok(P("devices/a") in db.docs && P("devices/b") in db.docs);
  ok(!(P("reminders/2026-11-23") in db.docs));
});

test("when every device is dead nothing is deleted and no record is kept", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const dead = { ok: false, error: "messaging/registration-token-not-registered", dead: true };
  const db = fakeDb(seed(now));
  const res = await run(db, fakeSend({ ta: dead, tb: dead }), now);
  eq([res.status, res.exitCode], ["failed", 1]);
  eq(db.deletes.filter((d) => d.includes("devices/")), []);
  ok(!(P("reminders/2026-11-23") in db.docs));
});

test("the day is claimed before sending, finalised after, and released if all sends fail", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const R = P("reminders/2026-11-23");
  let db = fakeDb(seed(now));
  const send = async (m) => { send.seen.push([m.token, db.docs[R]?.status]); return { ok: true }; };
  send.seen = [];
  await run(db, send, now);
  eq(send.seen, [["ta", "sending"], ["tb", "sending"]]);
  eq(db.log[0], ["create", R]);
  eq(db.docs[R].devices, 2);
  ok(!("status" in db.docs[R]) || db.docs[R].status !== "sending");
  db = fakeDb(seed(now));
  const bad = { ok: false, error: "messaging/internal-error", dead: false };
  await run(db, fakeSend({ ta: bad, tb: bad }), now);
  eq(db.log.filter((l) => l[1] === R).map((l) => l[0]), ["create", "delete"]);
});

test("a claim already made by another run stops this one before sending", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb(seed(now)), send = fakeSend();
  const realGet = db.doc(P("reminders/2026-11-23")).get;
  // the once-a-day read sees nothing, but the claim finds the other run's document
  const origDoc = db.doc;
  db.doc = (p) => { const d = origDoc(p); if (p.includes("reminders/")) { d.get = async () => ({ exists: false }); d.create = async () => { throw Object.assign(new Error("x"), { code: 6 }); }; } return d; };
  const res = await run(db, send, now);
  eq(res.status, "done-already");
  eq(send.calls.length, 0);
});

test("a dry run does not refresh warnings, so it writes nothing at all", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  let n = 0;
  const db = fakeDb(seed(now));
  await run(db, fakeSend(), now, { dryRun: true, refresh: async () => { n++; } });
  eq(n, 0);
});

test("a day with items but no devices logs a notice and records devices 0", async () => {
  const now = new Date("2026-11-23T07:00:00Z");
  const db = fakeDb({ [P("events/e1")]: seed(now)[P("events/e1")] }), logs = [], send = fakeSend();
  const res = await run(db, send, now, { log: (m) => logs.push(m) });
  eq(res.status, "sent");
  eq(send.calls.length, 0);
  ok(logs.some((l) => l.startsWith("::notice::") && l.includes("no devices")));
  eq(db.docs[P("reminders/2026-11-23")], { sentAt: "2026-11-23T07:00:00.000Z", items: ["Dentist 2pm"], count: 1, devices: 0, errors: [] });
});
