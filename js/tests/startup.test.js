import { guarded, nextStep, reloadOnce } from "../core/startup.js";
import { eq, test } from "./harness.js";

const USER = { uid: "u1", email: "tom@example.com" };
const step = (over) => nextStep({ user: USER, started: false, signinShown: false, claimReload: () => true, ...over });
const soon = () => new Promise((r) => setTimeout(r, 0));

test("nextStep: a restored session opens the app without a reload", () => {
  let claimed = 0;
  eq(step({ claimReload: () => { claimed++; return true; } }), "app");
  eq(claimed, 0);
});

test("nextStep: signing in on the form reloads first, so the data layer starts fresh", () => {
  eq(step({ signinShown: true }), "reload");
});

test("nextStep: the app opens without a reload when the reload cannot be claimed", () => {
  eq(step({ signinShown: true, claimReload: () => false }), "app");
});

test("nextStep: signed out shows the form once, or ends a session that was running", () => {
  eq(step({ user: null }), "signin");
  eq(step({ user: null, signinShown: true }), "stay");
  eq(step({ user: null, started: true }), "end");
  eq(step({ started: true }), "stay");
});

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

test("reloadOnce can be claimed once until it is cleared (a session that is not kept must not loop)", () => {
  const storage = fakeStorage();
  const first = reloadOnce(() => storage);
  eq(first.claim(), true);
  const afterReload = reloadOnce(() => storage);
  eq(afterReload.claim(), false);
  afterReload.clear();
  eq(afterReload.claim(), true);
});

test("reloadOnce never claims when storage is blocked", () => {
  const blocked = reloadOnce(() => { throw new Error("blocked"); });
  eq(blocked.claim(), false);
  blocked.clear();
  const silent = reloadOnce(() => ({ getItem: () => null, setItem() {}, removeItem() {} }));
  eq(silent.claim(), false);
});

test("guarded reports an exception or a rejection from the handler, and passes the value through", async () => {
  const seen = [], failed = [];
  guarded((u) => { seen.push(u); }, (e) => failed.push(e.message))(USER);
  guarded(() => { throw new Error("sync"); }, (e) => failed.push(e.message))(USER);
  guarded(async () => { throw new Error("async"); }, (e) => failed.push(e.message))(USER);
  await soon();
  eq(seen, [USER]);
  eq(failed, ["sync", "async"]);
});
