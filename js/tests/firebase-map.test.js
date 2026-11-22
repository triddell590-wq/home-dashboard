import { test, eq } from "./harness.js";
import { authMessage, createFirebaseAuth, resetMessage } from "../core/auth-firebase.js";
import { fullPath } from "../core/data-firebase.js";

const BAD = "That email and password don't match";

test("authMessage: wrong credentials codes", () => {
  for (const code of ["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential", "auth/invalid-email", "auth/missing-password"]) eq(authMessage(code), BAD);
});
test("authMessage: offline", () => {
  eq(authMessage("auth/network-request-failed"), "No connection — try again when you're online");
});
test("authMessage: too many tries", () => {
  eq(authMessage("auth/too-many-requests"), "Too many tries — wait a few minutes");
});
test("authMessage: unknown code", () => {
  eq(authMessage("auth/something-else"), "Couldn't sign in — try again");
  eq(authMessage(undefined), "Couldn't sign in — try again");
});

test("resetMessage: the reset email has its own failure text; offline and too many tries stay plain", () => {
  for (const code of ["auth/invalid-email", "auth/something-else", undefined]) eq(resetMessage(code), "Couldn't send the reset email — try again");
  eq(resetMessage("auth/network-request-failed"), "No connection — try again when you're online");
  eq(resetMessage("auth/too-many-requests"), "Too many tries — wait a few minutes");
});

// A fake of the compat SDK that records what gapi was in the scope when auth() was first called.
function fakeFirebase(scope, sendPasswordResetEmail = async () => {}) {
  const seen = [];
  const auth = () => { seen.push(scope.gapi); return { setPersistence: async () => {}, sendPasswordResetEmail }; };
  auth.Auth = { Persistence: { LOCAL: "local" } };
  return { firebase: { apps: [], initializeApp() { this.apps.push({}); }, auth }, seen };
}

test("auth: sendReset rejects with the reset text, and still hides an unknown address", async () => {
  const failing = (code) => createFirebaseAuth(fakeFirebase({}, async () => { throw { code }; }).firebase, {}, {});
  let message = null;
  try { await failing("auth/invalid-email").sendReset("x"); } catch (e) { message = e.message; }
  eq(message, "Couldn't send the reset email — try again");
  await failing("auth/user-not-found").sendReset("nobody@example.com");
});

test("auth: a gapi stub is in place before auth() is called, and reports a timeout so Google's script is never fetched", () => {
  const scope = {};
  const { firebase, seen } = fakeFirebase(scope);
  createFirebaseAuth(firebase, {}, scope);
  eq(typeof seen[0]?.load, "function");
  let timedOut = 0;
  seen[0].load("gapi.iframes", { callback() { throw new Error("must not load"); }, ontimeout: () => timedOut++, timeout: 1 });
  eq(timedOut, 1);
});

test("auth: an existing gapi is left alone", () => {
  const existing = { load() {} };
  const scope = { gapi: existing };
  const { firebase, seen } = fakeFirebase(scope);
  createFirebaseAuth(firebase, {}, scope);
  eq(scope.gapi === existing && seen[0] === existing, true);
});

function throwsMsg(fn) {
  try { fn(); } catch (e) { return e.message; }
  throw new Error("expected a throw");
}
test("fullPath: good path", () => {
  eq(fullPath("u1", "settings/profile"), "users/u1/settings/profile");
});
test("fullPath: no uid", () => {
  eq(throwsMsg(() => fullPath("", "a/b")), "Not signed in");
});
test("fullPath: bad paths", () => {
  for (const p of ["", "/x", "a//b", "a/../b", "a/"]) eq(throwsMsg(() => fullPath("u1", p)), "Bad path");
});

test("data: a failed listener clears pending and warns once", async () => {
  const { createFirebaseData } = await import("../core/data-firebase.js");
  let next, error;
  const fake = {
    apps: [{}],
    firestore: () => ({
      enablePersistence: async () => {},
      onSnapshotsInSync: () => () => {},
      doc: () => ({ onSnapshot: (_o, n, e) => { next = n; error = e; return () => {}; } }),
    }),
  };
  const d = createFirebaseData(fake, {});
  const seen = [];
  d.onPending((v) => seen.push(v));
  d.watch("users/u1/settings/profile", () => {});
  await Promise.resolve(); await Promise.resolve();
  next({ metadata: { hasPendingWrites: true }, exists: true, data: () => ({}) });
  eq(d.pending(), true);
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try { error({ code: "permission-denied" }); } finally { console.warn = orig; }
  eq(d.pending(), false);
  eq(seen, [true, false]);
  eq(warns.length, 1);
});
