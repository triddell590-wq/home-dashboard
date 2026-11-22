import { test, eq, ok } from "./harness.js";
import { useAuth, auth } from "../core/auth.js";
import { createMemoryAuth } from "../core/auth-memory.js";

async function rejects(p) {
  try { await p; } catch (e) { return e.message; }
  throw new Error("expected a rejection");
}
function make() {
  const a = createMemoryAuth();
  a.addUser("tom@example.com", "right", "u1");
  return a;
}
const BAD = "That email and password don't match";

test("auth: onChange fires null straight away", () => {
  const a = make();
  const seen = [];
  a.onChange((u) => seen.push(u));
  eq(seen, [null]);
  eq(a.current(), null);
});

test("auth: signIn resolves and onChange fires the user; signOut fires null", async () => {
  const a = make();
  const seen = [];
  a.onChange((u) => seen.push(u));
  const u = await a.signIn("tom@example.com", "right");
  eq(u, { uid: "u1", email: "tom@example.com" });
  eq(a.current(), { uid: "u1", email: "tom@example.com" });
  eq(seen[seen.length - 1], { uid: "u1", email: "tom@example.com" });
  await a.signOut();
  eq(seen[seen.length - 1], null);
  eq(a.current(), null);
});

test("auth: stop ends notifications", async () => {
  const a = make();
  const seen = [];
  const stop = a.onChange((u) => seen.push(u));
  stop();
  await a.signIn("tom@example.com", "right");
  eq(seen, [null]);
});

test("auth: wrong password and unknown email reject with the same message", async () => {
  const a = make();
  eq(await rejects(a.signIn("tom@example.com", "nope")), BAD);
  eq(await rejects(a.signIn("who@example.com", "x")), BAD);
});

test("auth: offline rejects with the no-connection message", async () => {
  const a = make();
  a.setOffline(true);
  eq(await rejects(a.signIn("tom@example.com", "right")), "No connection — try again when you're online");
  eq(await rejects(a.sendReset("tom@example.com")), "No connection — try again when you're online");
});

test("auth: 6th try after 5 wrong ones is locked even with the right password", async () => {
  const a = make();
  for (let i = 0; i < 5; i++) eq(await rejects(a.signIn("tom@example.com", "bad")), BAD);
  eq(await rejects(a.signIn("tom@example.com", "right")), "Too many tries — wait a few minutes");
});

test("auth: a successful sign-in resets the wrong-try counter", async () => {
  const a = make();
  for (let i = 0; i < 4; i++) await rejects(a.signIn("tom@example.com", "bad"));
  await a.signIn("tom@example.com", "right");
  for (let i = 0; i < 4; i++) eq(await rejects(a.signIn("tom@example.com", "bad")), BAD);
});

test("auth: sendReset resolves for known and unknown addresses", async () => {
  const a = make();
  await a.sendReset("tom@example.com");
  await a.sendReset("nobody@example.com");
  ok(true);
});

test("useAuth/auth return the active implementation", () => {
  const a = make();
  useAuth(a);
  ok(auth() === a);
});
